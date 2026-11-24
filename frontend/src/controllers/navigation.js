import {isAppPath, readRoute, routeUrl} from '../utils/routes.js';
import {renderConfirmation} from '../views/confirmation.js';
import {renderNavigationDecision} from '../views/plans-view.js';

export class NavigationController {
  constructor(app) {
    this.app = app;
    this.browser = app.browser;
    this.dialog = app.dialog;
    this.root = app.root;
    this.state = app.state;
    this.authReturnView = null;
    this.authReturnPlanId = null;
    this.historyIndex = this.browser?.history.state?.foodTinderIndex ?? 0;
    this.historyReturn = null;
    this.historyReplay = null;
    this.confirmUnload = (event) => {
      event.preventDefault();
      event.returnValue = true;
    };
    this.confirmation = null;
    this.navigationDecision = null;
    this.browser?.addEventListener('popstate', () => this.restoreRoute());
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.dataset.input === 'picker-search') event.preventDefault();
      if (event.key === 'Escape' && this.app.plans.slotPicker) {
        event.preventDefault();
        this.dismissDialog();
      }
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dismissDialog();
    });
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.dismissDialog();
    });
    this.dialog.addEventListener('close', () => {
      // A queued close event can arrive after another recipe has been opened.
      if (this.dialog.open) return;
      this.app.beginRequest('recipe-detail');
      const picker = this.app.plans.slotPicker;
      this.navigationDecision = null;
      this.settleConfirmation(false);
      this.app.plans.slotPicker = null;
      if (picker) this.app.plans.focusSlot(picker);
    });
  }

  applyRoute({view, filters, favoriteFilters, next, planId, planMode}) {
    this.state.view = view;
    this.authReturnView = next ?? null;
    this.authReturnPlanId = next ? planId : null;
    if (view === 'plans') this.app.plans.selectPlanRoute(planMode, planId);
    if (view === 'shopping') this.state.shoppingPlanId = planId;
    if (favoriteFilters) this.state.favoriteFilters = favoriteFilters;
    if (filters) {
      Object.assign(this.state, filters, {
        catalogFavoritesOnly: this.state.session.authenticated && filters.catalogFavoritesOnly,
      });
    }
  }

  writeRoute(replace = false) {
    if (!this.browser) return;
    const {pathname, search} = this.browser.location;
    const url = routeUrl(this.state.view, this.state, this.authReturnView, this.authReturnPlanId);
    if (url === pathname + search) return;
    if (!replace) this.historyIndex++;
    const data = {...this.browser.history.state, foodTinderIndex: this.historyIndex};
    if (replace) this.browser.history.replaceState(data, '', url);
    else this.browser.history.pushState(data, '', url);
  }

  hasUnsavedChanges() {
    return this.state.view === 'plans' && Boolean(this.state.planDraft?.dirty);
  }

  watchUnsavedChanges() {
    if (this.hasUnsavedChanges()) this.browser?.addEventListener('beforeunload', this.confirmUnload);
    else this.browser?.removeEventListener('beforeunload', this.confirmUnload);
  }

  settleConfirmation(accepted) {
    const confirmation = this.confirmation;
    this.confirmation = null;
    confirmation?.(accepted);
  }

  dismissDialog() {
    this.app.beginRequest('recipe-detail');
    this.navigationDecision = null;
    this.settleConfirmation(false);
    if (this.dialog.open) this.dialog.close();
  }

  async askConfirmation(message, actionLabel) {
    if (this.dialog.open || this.state.busy) return false;
    this.app.plans.transfer.cancel();
    this.app.beginRequest('recipe-detail');
    const session = this.app.account.sessionContext();
    const viewVersion = this.app.requestVersions.get('view');
    const accepted = await new Promise((resolve) => {
      this.confirmation = resolve;
      this.dialog.innerHTML = renderConfirmation(message, actionLabel);
      this.dialog.showModal();
    });
    return accepted && this.app.account.isCurrentSession(session) && viewVersion === this.app.requestVersions.get('view');
  }

  navigationNeeded({view, planMode, planId}) {
    return view !== 'plans' || this.state.view !== view
      || planMode !== this.state.planMode || (planId ?? null) !== this.state.activePlanId;
  }

  shoppingNeedsSave({view, shoppingPlanId}) {
    return view === 'shopping' && !shoppingPlanId && this.state.planMode === 'new'
      && this.state.view === 'plans' && Boolean(this.state.planDraft);
  }

  restoreRoute() {
    const route = readRoute(this.browser.location);
    const index = this.browser.history.state?.foodTinderIndex ?? this.historyIndex;
    const restoring = this.historyReturn;
    if (restoring) {
      if (index === this.historyIndex) {
        this.historyReturn = null;
        restoring.resolve();
        if (restoring.destination && this.app.account.isCurrentSession(restoring.session) && !this.state.busy) {
          this.showNavigationDecision(restoring.destination);
        }
      } else {
        this.browser.history.go(this.historyIndex - index);
      }
      return;
    }
    const replay = this.historyReplay;
    this.historyReplay = null;
    if (replay?.index === index && this.app.account.isCurrentSession(replay.session)) {
      return this.commitHistoryRoute(route, index, replay.shoppingPlanId);
    }
    const destination = {
      ...route, historyIndex: index,
      shoppingPlanId: route.view === 'shopping' ? route.planId ?? this.state.activePlanId : undefined,
    };
    if (this.state.busy === 'save-plan' || (this.navigationNeeded(destination)
      && (this.hasUnsavedChanges() || this.shoppingNeedsSave(destination)))) {
      if (index === this.historyIndex) return;
      const returning = {
        destination: this.state.busy === 'save-plan' ? null : destination, session: this.app.account.sessionContext(),
      };
      returning.done = new Promise((resolve) => { returning.resolve = resolve; });
      this.historyReturn = returning;
      this.browser.history.go(this.historyIndex - index);
      return;
    }
    return this.commitHistoryRoute(route, index, destination.shoppingPlanId);
  }

  commitHistoryRoute(route, index, shoppingPlanId) {
    this.historyIndex = index;
    // Apply filters and editor selection only once an actual traversal has been accepted.
    this.applyRoute(route);
    if (route.view === 'shopping' && shoppingPlanId && !route.planId) {
      this.state.shoppingPlanId = shoppingPlanId;
      this.writeRoute(true);
    }
    return this.commitNavigation(route.view, {fromHistory: true, shoppingPlanId});
  }

  async navigate(view, options = {}) {
    const destination = {...options, view};
    if (view === 'plans') destination.planMode ??= 'list';
    if (view === 'shopping') destination.shoppingPlanId ??= this.state.activePlanId ?? undefined;
    if (this.state.busy === 'save-plan' || this.historyReturn || this.historyReplay) return;
    if (!this.navigationNeeded(destination)) return;
    if (this.hasUnsavedChanges() || this.shoppingNeedsSave(destination)) {
      this.showNavigationDecision(destination);
      return;
    }
    return this.commitNavigation(view, destination);
  }

  async commitNavigation(view, {
    replace = false, fromHistory = false, next = null, nextPlanId = null,
    planMode, planId, shoppingPlanId, filters, favoriteFilters,
  } = {}) {
    this.navigationDecision = null;
    this.app.plans.transfer.cancel();
    this.app.plans.clearTransferUndo();
    if (this.dialog.open) this.dismissDialog();
    const request = this.app.beginRequest('view');
    if (view !== 'plans') {
      this.app.beginRequest('active-plan');
      this.state.activePlan = null;
      this.state.planDraft = null;
      this.state.restoredDraft = false;
    }
    if (planMode) this.app.plans.selectPlanRoute(planMode, planId);
    if (view === 'shopping') {
      this.state.shoppingPlanId = shoppingPlanId ?? this.state.shoppingPlanId;
      this.app.shopping.invalidateShopping();
    }
    if (view === 'plans' && this.state.planMode === 'edit' && !this.state.planDraft) {
      this.state.activePlanStatus = 'loading';
    }
    this.state.view = view;
    if (!fromHistory) {
      if (favoriteFilters) this.state.favoriteFilters = favoriteFilters;
      if (filters) Object.assign(this.state, filters, {
        catalogFavoritesOnly: this.state.session.authenticated && filters.catalogFavoritesOnly,
      });
      this.authReturnView = next;
      this.authReturnPlanId = nextPlanId;
      this.writeRoute(replace);
    }
    this.state.error = null;
    this.app.render();
    if (!this.app.initializingSession) await this.app.loadView(view);
    if (this.app.isCurrentRequest('view', request)) {
      this.root.querySelector?.('#main-content')?.focus({preventScroll: fromHistory});
    }
  }

  followInternalLink(event) {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
      || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== this.browser?.location.origin || !isAppPath(url.pathname)) return;
    if (link.classList.contains('skip-link')) {
      event.preventDefault();
      return this.root.querySelector('#main-content')?.focus();
    }
    if (url.hash) return;
    event.preventDefault();
    const route = readRoute(url);
    const options = route.view === 'shopping' ? {...route, shoppingPlanId: route.planId}
      : route.view === 'auth' ? {...route, nextPlanId: route.planId} : route;
    return this.navigate(route.view, options);
  }

  showNavigationDecision(destination) {
    if (this.navigationDecision && this.dialog.open) return;
    this.app.plans.transfer.cancel();
    this.settleConfirmation(false);
    this.app.beginRequest('recipe-detail');
    this.app.plans.slotPicker = null;
    const needsSavedPlan = this.shoppingNeedsSave(destination);
    this.navigationDecision = {
      destination, needsSavedPlan, draft: this.state.planDraft, session: this.app.account.sessionContext(),
    };
    this.dialog.innerHTML = renderNavigationDecision(needsSavedPlan);
    if (!this.dialog.open) this.dialog.showModal();
    else this.dialog.querySelector?.('[autofocus]')?.focus();
  }

  async resolveNavigationDecision(save) {
    const decision = this.navigationDecision;
    if (this.state.busy || this.historyReturn || !this.dialog.open || !decision || decision.draft !== this.state.planDraft
      || !this.app.account.isCurrentSession(decision.session) || (!save && decision.needsSavedPlan)) return;
    this.navigationDecision = null;
    this.dialog.close();
    const destination = decision.destination;
    if (save) {
      const savedId = await this.app.plans.savePlan({focus: false});
      if (!this.app.account.isCurrentSession(decision.session)) return;
      if (!savedId) {
        this.root.querySelector?.('.error-banner')?.focus();
        return;
      }
      if (destination.view === 'shopping') destination.shoppingPlanId ??= savedId;
    }
    if (destination.historyIndex !== undefined) {
      this.historyReplay = {index: destination.historyIndex, session: decision.session,
        shoppingPlanId: destination.shoppingPlanId};
      this.browser.history.go(destination.historyIndex - this.historyIndex);
      return;
    }
    return this.commitNavigation(destination.view, destination);
  }
}
