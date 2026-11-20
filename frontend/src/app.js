import {ApiError, apiErrorMessage} from './api/errors.js';
import {generatePlanSlots} from './utils/auto-plan.js';
import {PlanTransfer, slotAddress} from './components/plan-transfer.js';
import {renderRecipeDetail} from './components/recipe-card.js';
import {MEAL_LABELS} from './constants.js';
import {PlanDrafts} from './state/plan-drafts.js';
import {clearPrivateState, createInitialState, defaultFavoriteFilters, setFavorites} from './state/state.js';
import {renderStatus} from './utils/dom.js';
import {saveBlob} from './utils/download.js';
import {
  compatibleFavorites, duplicatePlanDraft, hasValidPlanDates, includedSlots, invalidateShopping,
  makePlanDraft, planContentKey, planDraftPayload, slotFor,
} from './utils/plans.js';
import {planDrop, unavailableDraftSlot} from './utils/plan-drop.js';
import {isAppPath, isPrivateView, readRoute, routeUrl} from './utils/routes.js';
import {UNDO_WINDOW_MS} from './utils/swipe-notice.js';
import {renderShell} from './views/shell.js';
import {favoriteSearchCount, renderFavoriteResults} from './views/favorites-view.js';
import {catalogSearchCount, renderCatalogResults} from './views/recipes-view.js';
import {renderConfirmation} from './views/confirmation.js';
import {renderLibraryResults} from './views/plan-library.js';
import {draftStatus, renderNavigationDecision} from './views/plans-view.js';
import {pickedRecipeTitle, renderPickerResults, renderSlotPicker} from './views/slot-picker.js';

export class FoodTinderApp {
  constructor({root, dialog, toast, api, browser = globalThis.window, now = Date.now}) {
    this.root = root;
    this.dialog = dialog;
    this.toastElement = toast;
    this.api = api;
    this.browser = browser;
    this.now = now;
    this.swipeTimer = null;
    this.browser?.document?.addEventListener('visibilitychange', () => this.updateSwipeNotice());
    this.initializingSession = false;
    this.authReturnView = null;
    this.authReturnPlanId = null;
    this.state = createInitialState();
    this.planDrafts = new PlanDrafts(browser);
    this.historyIndex = browser?.history.state?.foodTinderIndex ?? 0;
    this.historyReturn = null;
    this.historyReplay = null;
    this.confirmUnload = (event) => {
      event.preventDefault();
      event.returnValue = true;
    };
    this.confirmation = null;
    this.navigationDecision = null;
    this.editorDraft = null;
    this.libraryQuery = '';
    this.editRevision = 0;
    this.transferUndo = null;
    this.transfer = new PlanTransfer(root, browser, {
      getSource: (source, handle) => this.transferSource(source, handle),
      inspect: (context, target) => this.inspectTransfer(context, target),
      drop: (context, target) => this.applyTransfer(context, target),
    });
    this.sessionGeneration = 0;
    this.requestVersions = new Map();
    this.toastTimer = null;
    this.slotPicker = null;
    this.mutation = null;
    this.browser?.addEventListener('popstate', () => this.restoreRoute());
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('submit', (event) => this.onSubmit(event));
    this.root.addEventListener('change', (event) => this.onChange(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.dialog.addEventListener('click', (event) => this.onClick(event));
    this.dialog.addEventListener('submit', (event) => this.onSubmit(event));
    this.dialog.addEventListener('input', (event) => this.onInput(event));
    this.dialog.addEventListener('change', (event) => this.onChange(event));
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.dataset.input === 'picker-search') event.preventDefault();
      if (event.key === 'Escape' && this.slotPicker) {
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
      this.beginRequest('recipe-detail');
      const picker = this.slotPicker;
      this.navigationDecision = null;
      this.settleConfirmation(false);
      this.slotPicker = null;
      if (picker) this.focusSlot(picker);
    });
  }

  render() {
    this.expireSwipeNotice();
    this.watchUnsavedChanges();
    const sameDraft = this.editorDraft && this.editorDraft === this.state.planDraft;
    const library = this.root.querySelector?.('[data-plan-library]');
    const results = library?.querySelector('[data-library-results]');
    const left = sameDraft ? results?.scrollLeft : 0;
    const top = sameDraft ? results?.scrollTop : 0;
    const open = sameDraft && library ? library.open : true;
    if (!sameDraft) {
      this.libraryQuery = '';
      this.clearTransferUndo();
    }
    this.editorDraft = this.state.planDraft;
    this.transfer.cancel();
    this.root.innerHTML = renderShell(this.state, {open, query: this.libraryQuery});
    const nextResults = this.root.querySelector?.('[data-library-results]');
    if (nextResults) {
      nextResults.scrollLeft = left ?? 0;
      nextResults.scrollTop = top ?? 0;
    }
    this.updateTransferUndo();
    this.updateSwipeNotice();
  }

  clearSwipeNotice() {
    clearTimeout(this.swipeTimer);
    this.swipeTimer = null;
    this.state.lastSwipe = null;
  }

  expireSwipeNotice() {
    if (this.state.lastSwipe?.deadline > this.now()) return;
    const notice = this.root.querySelector?.('[data-swipe-notice]');
    const focused = notice?.contains(this.browser?.document?.activeElement);
    this.clearSwipeNotice();
    notice?.remove();
    if (focused) this.focusFeedRecipe() || this.root.querySelector('#main-content')?.focus();
  }

  updateSwipeNotice() {
    clearTimeout(this.swipeTimer);
    this.expireSwipeNotice();
    if (!this.state.lastSwipe) return;
    const remaining = this.state.lastSwipe.deadline - this.now();
    const seconds = Math.ceil(remaining / 1000);
    const number = this.root.querySelector?.('[data-swipe-seconds]');
    const description = this.root.querySelector?.('[data-swipe-description]');
    if (number) {
      if (number.textContent !== String(seconds)) number.textContent = seconds;
      number.parentElement.style.setProperty('--swipe-progress', remaining / UNDO_WINDOW_MS);
    }
    if (description) {
      const text = `До окончания отмены — ${seconds} сек.`;
      if (description.textContent !== text) description.textContent = text;
    }
    const reducedMotion = this.browser?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const interval = reducedMotion || this.browser?.document?.hidden ? 1000 : 32;
    this.swipeTimer = setTimeout(() => this.updateSwipeNotice(), Math.min(interval, remaining % 1000 || 1000));
    this.swipeTimer?.unref?.();
  }

  sessionContext() {
    return {
      generation: this.sessionGeneration,
      userId: this.state.session.id,
      authenticated: this.state.session.authenticated,
    };
  }

  isCurrentSession(context) {
    return context.generation === this.sessionGeneration
      && context.userId === this.state.session.id
      && context.authenticated === this.state.session.authenticated;
  }

  setSession(session, reset = false) {
    const previous = this.state.session;
    if (reset || session.id !== this.state.session.id
      || session.authenticated !== this.state.session.authenticated) {
      this.sessionGeneration += 1;
      this.transfer.cancel();
      this.clearTransferUndo();
      this.historyReplay = null;
      if (this.historyReturn) this.historyReturn.destination = null;
      this.navigationDecision = null;
      if (this.dialog.open) this.dismissDialog();
      this.slotPicker = null;
      if (this.state.busy !== 'auth') {
        this.mutation = null;
        this.state.busy = null;
      }
      this.clearSwipeNotice();
      clearPrivateState(this.state);
      this.state.feed = null;
      this.state.feedStatus = 'idle';
      this.state.guestHidden = new Set();
    }
    if (session.authenticated || reset) this.planDrafts.keepOnly(session.authenticated ? session.id : null);
    this.state.session = session;
    this.state.sessionKnown = true;
    this.watchUnsavedChanges();
    if (previous.authenticated && previous.id !== session.id && this.state.view === 'recipes') {
      this.writeRoute(true);
    }
  }

  beginRequest(key) {
    const version = (this.requestVersions.get(key) || 0) + 1;
    this.requestVersions.set(key, version);
    return {version, session: this.sessionContext()};
  }

  isCurrentRequest(key, request) {
    return this.requestVersions.get(key) === request.version
      && this.isCurrentSession(request.session);
  }

  invalidateShopping() {
    this.beginRequest('shopping');
    invalidateShopping(this.state);
  }

  editablePlanId() {
    if (!this.state.session.authenticated || this.state.activePlanStatus !== 'ready') return null;
    const {planDraft, planMode, activePlanId} = this.state;
    if (!planDraft) return null;
    if (planMode === 'new' && !planDraft.plan.id) return 0;
    return planMode === 'edit' && planDraft.plan.id === activePlanId ? activePlanId : null;
  }

  toast(message) {
    clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add('visible');
    this.toastTimer = setTimeout(() => this.toastElement.classList.remove('visible'), 3000);
  }

  async start() {
    if (this.browser) {
      this.applyRoute(readRoute(this.browser.location));
      this.browser.history.replaceState({
        ...this.browser.history.state, foodTinderIndex: this.historyIndex,
      }, '', this.browser.location.href);
    }
    this.initializingSession = true;
    this.render();
    const context = this.sessionContext();
    try {
      try {
        const session = await this.api.getSession();
        if (this.isCurrentSession(context)) this.setSession(session);
      } catch (error) {
        await this.handleError(error, () => this.isCurrentSession(context));
      } finally {
        this.initializingSession = false;
      }
      if (this.browser) this.applyRoute(readRoute(this.browser.location));
      await this.loadView(this.state.view);
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.state.initialLoading = false;
      this.render();
    }
  }

  async handleError(error, isCurrent) {
    const context = this.sessionContext();
    const current = isCurrent || (() => this.isCurrentSession(context));
    const normalized = error instanceof ApiError
      ? error
      : new ApiError({type: 'http', details: String(error?.message || error)});
    if (!current()) return normalized;
    this.state.error = normalized;
    if (normalized.type === 'auth') {
      try {
        const session = await this.api.getSession();
        if (!current()) return normalized;
        this.setSession(session);
        this.render();
      } catch {
        // Keep the original actionable error; show API errors without replacing server data.
      }
    }
    return normalized;
  }

  async runMutation(key, operation) {
    if (this.state.busy) return;
    const context = this.sessionContext();
    const mutation = {};
    this.mutation = mutation;
    this.state.busy = key;
    this.state.error = null;
    this.render();
    try {
      await operation();
    } catch (error) {
      await this.handleError(error, () => this.isCurrentSession(context));
    } finally {
      if (this.mutation === mutation) {
        this.mutation = null;
        this.state.busy = null;
        this.render();
      }
    }
  }

  async loadFeed(shouldRender = true) {
    const request = this.beginRequest('feed');
    const current = () => this.isCurrentRequest('feed', request);
    this.state.feedStatus = 'loading';
    if (shouldRender) this.render();
    try {
      const feed = await this.api.getFeed();
      if (!current()) return;
      this.state.feed = feed;
      this.state.feedStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.feedStatus = 'error';
      await this.handleError(error, current);
    }
    if (shouldRender && current()) this.render();
  }

  async loadCatalog(shouldRender = true) {
    const request = this.beginRequest('catalog');
    const current = () => this.isCurrentRequest('catalog', request);
    this.state.catalogStatus = 'loading';
    if (shouldRender) this.render();
    try {
      const catalog = await this.api.getRecipes();
      if (!current()) return;
      this.state.catalog = catalog;
      this.state.catalogStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.catalogStatus = 'error';
      await this.handleError(error, current);
    }
    if (shouldRender && current()) this.render();
  }

  async loadAccount(shouldRender = true) {
    if (!this.state.session.authenticated) return;
    const request = this.beginRequest('account');
    const current = () => this.isCurrentRequest('account', request);
    this.state.accountStatus = 'loading';
    if (shouldRender) this.render();
    try {
      const account = await this.api.getAccount();
      if (!current()) return;
      this.state.account = account;
      this.state.accountStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.accountStatus = 'error';
      await this.handleError(error, current);
    }
    if (shouldRender && current()) this.render();
  }

  async updateAccountNames(payload) {
    if (!this.state.session.authenticated || this.state.busy) return;
    const context = this.sessionContext();
    await this.runMutation('account', async () => {
      const account = await this.api.updateAccount(payload);
      if (!this.isCurrentSession(context)) return;
      this.beginRequest('account');
      this.state.account = account;
      this.state.accountStatus = 'ready';
      this.toast('Личные данные сохранены');
    });
  }

  async updateAccountEmail(payload) {
    if (!this.state.session.authenticated || this.state.busy) return;
    if (payload.email.toLowerCase() === this.state.session.email.toLowerCase()) {
      this.toast('Новый email совпадает с текущим');
      return;
    }
    const context = this.sessionContext();
    await this.runMutation('account', async () => {
      const account = await this.api.changeEmail(payload);
      if (!this.isCurrentSession(context)) return;
      this.beginRequest('account');
      this.state.account = account;
      this.state.accountStatus = 'ready';
      this.state.session = {...this.state.session, email: account.email};
      this.toast('Email изменён');
    });
  }

  async loadFavorites(shouldRender = true) {
    if (!this.state.session.authenticated) return;
    const request = this.beginRequest('favorites');
    const current = () => this.isCurrentRequest('favorites', request);
    this.state.favoritesStatus = 'loading';
    if (shouldRender) this.render();
    try {
      const favorites = await this.api.getFavorites();
      if (!current()) return;
      setFavorites(this.state, favorites);
      this.state.favoritesStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.favoritesStatus = 'error';
      await this.handleError(error, current);
    }
    if (shouldRender && current()) this.render();
  }

  async loadPlans(shouldRender = true) {
    if (!this.state.session.authenticated) return;
    const request = this.beginRequest('plans');
    const current = () => this.isCurrentRequest('plans', request);
    if (this.state.error === this.state.plansError) this.state.error = null;
    this.state.plansError = null;
    this.state.plansStatus = 'loading';
    if (shouldRender) this.render();
    try {
      const plans = await this.api.getPlans();
      if (!current()) return;
      this.state.plans = plans;
      this.state.plansStatus = 'ready';
      if (!this.state.shoppingPlanId) this.state.shoppingPlanId = this.state.activePlanId ?? plans[0]?.id ?? null;
    } catch (error) {
      if (!current()) return;
      this.state.plansStatus = 'error';
      this.state.plansError = error;
      await this.handleError(error, current);
    }
    if (shouldRender && current()) this.render();
  }

  async loadActivePlan(shouldRender = true) {
    if (!this.state.session.authenticated || !this.state.activePlanId) return;
    this.transfer.cancel();
    const planId = Number(this.state.activePlanId);
    const request = this.beginRequest('active-plan');
    const current = () => this.isCurrentRequest('active-plan', request)
      && Number(this.state.activePlanId) === planId;
    if (this.state.planMode === 'edit') this.state.planDraft = null;
    this.state.activePlan = null;
    this.state.activePlanStatus = 'loading';
    if (shouldRender) this.render();
    try {
      const plan = await this.api.getPlan(planId);
      if (!current()) return;
      this.state.activePlan = plan;
      if (this.state.view === 'plans' && this.state.planMode === 'edit') {
        const draft = this.planDrafts.get(this.state.session.id, planId);
        this.state.planDraft = draft || makePlanDraft(plan);
        this.state.restoredDraft = Boolean(draft?.dirty);
        this.state.draftStorageUnavailable = Boolean(draft?.storageUnavailable);
      }
      this.state.activePlanStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.activePlanStatus = 'error';
      await this.handleError(error, current);
    }
    if (shouldRender && current()) this.render();
  }

  async loadShopping(shouldRender = true) {
    if (!this.state.session.authenticated || !this.state.shoppingPlanId) return;
    const planId = Number(this.state.shoppingPlanId);
    const request = this.beginRequest('shopping');
    const current = () => this.isCurrentRequest('shopping', request)
      && Number(this.state.shoppingPlanId) === planId;
    this.state.shopping = null;
    this.state.shoppingStatus = 'loading';
    if (shouldRender) this.render();
    try {
      const shopping = await this.api.getShoppingList(planId);
      if (!current()) return;
      this.state.shopping = shopping;
      this.state.shoppingStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.shoppingStatus = 'error';
      await this.handleError(error, current);
    }
    if (shouldRender && current()) this.render();
  }

  showAuth(message) {
    this.state.authTab = 'login';
    this.state.authNotice = message || 'Войдите, чтобы сохранить это действие.';
    const {view, activePlanId, shoppingPlanId} = this.state;
    const requestedRoute = this.browser ? readRoute(this.browser.location) : null;
    const routePlanId = requestedRoute?.view === view ? requestedRoute.planId : null;
    return this.navigate('auth', {
      next: isPrivateView(view) ? view : null,
      nextPlanId: view === 'plans' ? activePlanId ?? routePlanId : view === 'shopping' ? shoppingPlanId ?? routePlanId : null,
    });
  }

  applyRoute({view, filters, favoriteFilters, next, planId, planMode}) {
    this.state.view = view;
    this.authReturnView = next ?? null;
    this.authReturnPlanId = next ? planId : null;
    if (view === 'plans') this.selectPlanRoute(planMode, planId);
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

  selectPlanRoute(mode, planId = null) {
    if (this.state.planMode === mode && this.state.activePlanId === planId) return;
    this.beginRequest('active-plan');
    Object.assign(this.state, {
      planMode: mode, activePlanId: planId, activePlan: null, planDraft: null,
      restoredDraft: false, draftStorageUnavailable: false,
      activePlanStatus: mode === 'edit' ? 'loading' : 'idle',
    });
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
    this.beginRequest('recipe-detail');
    this.navigationDecision = null;
    this.settleConfirmation(false);
    if (this.dialog.open) this.dialog.close();
  }

  async askConfirmation(message, actionLabel) {
    if (this.dialog.open || this.state.busy) return false;
    this.transfer.cancel();
    this.beginRequest('recipe-detail');
    const session = this.sessionContext();
    const viewVersion = this.requestVersions.get('view');
    const accepted = await new Promise((resolve) => {
      this.confirmation = resolve;
      this.dialog.innerHTML = renderConfirmation(message, actionLabel);
      this.dialog.showModal();
    });
    return accepted && this.isCurrentSession(session) && viewVersion === this.requestVersions.get('view');
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
        if (restoring.destination && this.isCurrentSession(restoring.session) && !this.state.busy) {
          this.showNavigationDecision(restoring.destination);
        }
      } else {
        this.browser.history.go(this.historyIndex - index);
      }
      return;
    }
    const replay = this.historyReplay;
    this.historyReplay = null;
    if (replay?.index === index && this.isCurrentSession(replay.session)) {
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
        destination: this.state.busy === 'save-plan' ? null : destination, session: this.sessionContext(),
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
    this.transfer.cancel();
    this.clearTransferUndo();
    if (this.dialog.open) this.dismissDialog();
    const request = this.beginRequest('view');
    if (view !== 'plans') {
      this.beginRequest('active-plan');
      this.state.activePlan = null;
      this.state.planDraft = null;
      this.state.restoredDraft = false;
    }
    if (planMode) this.selectPlanRoute(planMode, planId);
    if (view === 'shopping') {
      this.state.shoppingPlanId = shoppingPlanId ?? this.state.shoppingPlanId;
      this.invalidateShopping();
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
    this.render();
    if (!this.initializingSession) await this.loadView(view);
    if (this.isCurrentRequest('view', request)) {
      this.root.querySelector?.('#main-content')?.focus({preventScroll: fromHistory});
    }
  }

  async loadView(view) {
    const {authenticated} = this.state.session;
    const needsFavorites = authenticated && !['ready', 'loading'].includes(this.state.favoritesStatus);
    if (view === 'feed') {
      await Promise.all([this.loadFeed(), needsFavorites ? this.loadFavorites() : undefined]);
    }
    if (view === 'recipes') {
      await Promise.all([
        this.state.catalog ? undefined : this.loadCatalog(),
        needsFavorites ? this.loadFavorites() : undefined,
      ]);
    }
    if (view === 'favorites' && authenticated) await this.loadFavorites();
    if (view === 'auth' && authenticated) await this.loadAccount();
    if (view === 'plans' && authenticated) {
      if (this.state.planMode === 'list') {
        await this.loadPlans();
      } else {
        if (this.state.planMode === 'new' && !this.state.planDraft) {
          const draft = this.planDrafts.get(this.state.session.id, null);
          this.state.planDraft = draft ?? makePlanDraft();
          this.state.restoredDraft = Boolean(draft?.dirty);
          this.state.draftStorageUnavailable = Boolean(draft?.storageUnavailable);
          this.state.activePlanStatus = 'ready';
          this.render();
        }
        await Promise.all([
          this.state.planDraft ? undefined : this.loadActivePlan(),
          this.loadFavorites(),
        ]);
      }
    }
    if (view === 'shopping' && authenticated) {
      const request = this.beginRequest('shopping-view');
      if (!this.state.plans || this.state.plansStatus !== 'ready') await this.loadPlans(false);
      if (!this.isCurrentRequest('shopping-view', request) || this.state.view !== view) return;
      this.state.shoppingPlanId ??= this.state.activePlanId ?? this.state.plans?.[0]?.id ?? null;
      if (this.state.plans?.length) await this.loadShopping();
      this.render();
    }
  }

  async onClick(event) {
    const control = event.target.closest('[data-action]');
    if (!control) {
      const handle = event.target.closest('[data-transfer-source]');
      if (handle) return this.transfer.choose(handle);
      return this.followInternalLink(event);
    }
    const {action} = control.dataset;
    if (action === 'navigate') return this.navigate(control.dataset.view);
    if (action === 'open-feed') return this.navigate('feed');
    if (action === 'open-recipes') return this.navigate('recipes');
    if (action === 'open-plans') return this.navigate('plans');
    if (action === 'show-auth') return this.showAuth('Войдите снова, чтобы продолжить.');
    if (action === 'dismiss-error') {
      this.state.error = null;
      return this.render();
    }
    if (action === 'auth-tab') {
      this.state.authTab = control.dataset.tab;
      this.state.authNotice = null;
      return this.render();
    }
    if (action === 'retry-feed') return this.loadFeed();
    if (action === 'retry-recipes') return this.loadCatalog();
    if (action === 'reset-catalog') {
      Object.assign(this.state, {catalogQuery: '', catalogMeal: '', catalogMaxTime: 0, catalogFavoritesOnly: false});
      this.writeRoute(true);
      this.render();
      this.root.querySelector?.('#recipe-search')?.focus();
      return;
    }
    if (action === 'reset-favorites') {
      this.state.favoriteFilters = defaultFavoriteFilters();
      this.writeRoute(true);
      this.render();
      this.root.querySelector?.('#favorite-search')?.focus();
      return;
    }
    if (action === 'retry-favorites') return this.loadFavorites();
    if (action === 'retry-account') return this.loadAccount();
    if (action === 'retry-plans') return this.loadPlans();
    if (action === 'retry-active-plan') return this.loadActivePlan();
    if ((action === 'retry-shopping' || action === 'refresh-shopping') && !this.state.busy) return this.loadShopping();
    if (action === 'close-dialog') return this.dismissDialog();
    if (action === 'accept-confirmation' && this.confirmation) {
      this.settleConfirmation(true);
      return this.dialog.close();
    }
    if (action === 'recipe-detail') return this.openRecipeDetail(Number(control.dataset.recipeId));
    if (action === 'toggle-favorite') return this.toggleFavorite(Number(control.dataset.recipeId));
    if (action === 'swipe') return this.swipe(Number(control.dataset.recipeId), control.dataset.swipe);
    if (action === 'undo-swipe') return this.undoSwipe();
    if (action === 'logout') return this.logout();
    if (action === 'pick-slot') return this.openSlotPicker(Number(control.dataset.planId), Number(control.dataset.dayIndex), control.dataset.mealType);
    if (action === 'retry-picker') return this.loadPickerFavorites(this.slotPicker);
    if (action === 'delete-slot') return this.deleteSlot(Number(control.dataset.dayIndex), control.dataset.mealType, Number(control.dataset.planId));
    if (action === 'plan-list') return this.navigate('plans', {planMode: 'list'});
    if (action === 'new-plan') return this.openPlanEditor('new');
    if (action === 'auto-fill-plan') return this.autoFillPlan();
    if (action === 'regenerate-plan') return this.autoFillPlan({replace: true});
    if (action === 'edit-plan') return this.openPlanEditor('edit', Number(control.dataset.planId));
    if (action === 'duplicate-plan') return this.duplicatePlan(Number(control.dataset.planId));
    if (action === 'delete-plan') return this.deletePlan(Number(control.dataset.planId));
    if (action === 'discard-draft') return this.discardDraft();
    if (action === 'plan-shopping') return this.openPlanShopping(Number(control.dataset.planId));
    if (action === 'save-and-navigate' || action === 'keep-draft-and-navigate') {
      return this.resolveNavigationDecision(action === 'save-and-navigate');
    }
    if (action === 'place-transfer') return this.transfer.place(control.closest('[data-transfer-target]'));
    if (action === 'cancel-transfer') return this.transfer.cancel(true);
    if (action === 'undo-transfer') return this.undoTransfer();
    if (action === 'export-shopping') return this.exportShopping(control.dataset.fileType);
    if (action === 'clear-purchases') return this.clearPurchases(Number(control.dataset.planId));
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

  async onSubmit(event) {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === 'login') {
      return this.login({email: data.get('email'), password: data.get('password')});
    }
    if (form.dataset.form === 'register') {
      return this.register({
        first_name: data.get('first_name'), email: data.get('email'), password: data.get('password'),
      });
    }
    if (form.dataset.form === 'account-names') {
      return this.updateAccountNames({
        first_name: data.get('first_name'), last_name: data.get('last_name'),
      });
    }
    if (form.dataset.form === 'account-email') {
      return this.updateAccountEmail({
        email: data.get('email'), current_password: data.get('current_password'),
      });
    }
    if (form.dataset.form === 'plan-editor') return this.savePlan();
    if (form.dataset.form === 'slot-picker' && this.dialog.contains(form)) {
      return this.savePickedSlot(Number(data.get('servings')));
    }
  }

  onInput(event) {
    if (Object.hasOwn(event.target.dataset, 'librarySearch')) {
      this.transfer.cancel();
      this.libraryQuery = event.target.value;
      this.root.querySelector('[data-library-results]').innerHTML = renderLibraryResults(this.state, this.libraryQuery);
      return;
    }
    if (event.target.dataset.input === 'plan-title' && this.state.planDraft && !this.state.busy) {
      if (this.state.planDraft.plan.title === event.target.value) return;
      this.state.planDraft.plan.title = event.target.value;
      this.markDraftChanged();
      return;
    }
    if (event.target.dataset.input === 'picker-search' && this.isCurrentPicker(this.slotPicker)) {
      this.slotPicker.query = event.target.value;
      this.updatePickerResults();
      return;
    }
    if (event.target.dataset.input === 'favorite-search') {
      this.state.favoriteFilters.query = event.target.value;
      return this.updateRecipeResults('favorites');
    }
    if (event.target.dataset.input !== 'recipe-search') return;
    this.state.catalogQuery = event.target.value;
    this.updateRecipeResults('catalog');
  }

  updateRecipeResults(scope) {
    const favorites = scope === 'favorites';
    this.writeRoute(true);
    const results = this.root.querySelector(`[data-${scope}-results]`);
    if (results) results.innerHTML = favorites ? renderFavoriteResults(this.state) : renderCatalogResults(this.state);
    const count = this.root.querySelector(`[data-${scope}-count]`);
    if (count) count.textContent = favorites ? favoriteSearchCount(this.state) : catalogSearchCount(this.state);
  }

  async onChange(event) {
    const {change} = event.target.dataset;
    if (change === 'catalog-meal' || change === 'catalog-time' || change === 'catalog-favorites') {
      if (change === 'catalog-meal') this.state.catalogMeal = event.target.value;
      if (change === 'catalog-time') this.state.catalogMaxTime = Number(event.target.value);
      if (change === 'catalog-favorites' && this.state.session.authenticated) {
        this.state.catalogFavoritesOnly = event.target.checked;
      }
      this.updateRecipeResults('catalog');
      return;
    }
    if (['favorites-meal', 'favorites-time', 'favorites-sort'].includes(change)) {
      const {value} = event.target;
      if (change === 'favorites-meal') this.state.favoriteFilters.meal = value;
      if (change === 'favorites-time') this.state.favoriteFilters.maxTime = Number(value);
      if (change === 'favorites-sort') this.state.favoriteFilters.sort = value;
      this.updateRecipeResults('favorites');
      return;
    }
    if (this.state.busy) return;
    if (event.target.dataset.change === 'picker-recipe' && this.isCurrentPicker(this.slotPicker)) {
      this.slotPicker.recipeId = Number(event.target.value);
      this.updatePickerSelection();
      return;
    }
    if (change === 'plan-auto-servings') {
      if (!this.state.planDraft || this.state.busy) return;
      const servings = Number(event.target.value);
      if (servings === this.state.planDraft.generationServings) return;
      this.editRevision += 1;
      this.clearTransferUndo();
      this.transfer.cancel();
      this.state.planDraft.generationServings = servings;
      this.persistDraft();
      return;
    }
    if (['plan-date', 'plan-duration', 'plan-meal'].includes(change)) return this.changePlanSettings(event.target);
    if (change === 'shopping-plan') {
      this.state.error = null;
      this.state.shoppingPlanId = Number(event.target.value);
      this.writeRoute();
      return this.loadShopping();
    }
    if (change === 'purchase') {
      const {planId, ingredientId} = event.target.dataset;
      return this.setPurchased(Number(planId), Number(ingredientId), event.target.checked);
    }
  }

  async login(payload) {
    await this.runMutation('auth', async () => {
      const next = this.authReturnView || 'feed';
      const planId = this.authReturnPlanId;
      this.setSession(await this.api.login(payload), true);
      this.state.authNotice = null;
      if (this.state.view === 'auth') {
        await this.navigate(next, {
          replace: true,
          ...(planId && next === 'plans' ? {planMode: 'edit', planId} : {}),
          ...(planId && next === 'shopping' ? {shoppingPlanId: planId} : {}),
        });
      } else await this.loadView(this.state.view);
      this.toast('Вход выполнен');
    });
  }

  async register(payload) {
    await this.runMutation('auth', async () => {
      const account = await this.api.register(payload);
      this.state.registeredEmail = account.email;
      this.state.authTab = 'login';
      this.state.authNotice = 'Аккаунт создан. Теперь можно войти.';
      this.toast('Регистрация завершена');
    });
  }

  async logout() {
    await this.runMutation('auth', async () => {
      await this.api.logout();
      this.setSession({authenticated: false, id: null, email: null}, true);
      this.state.view = 'feed';
      this.authReturnView = null;
      this.writeRoute(true);
      this.render();
      // The POST confirmed logout. A failed CSRF/session refresh cannot undo it.
      this.toast('Вы вышли из аккаунта');
      try {
        await this.api.getSession();
      } catch (error) {
        await this.handleError(error);
      }
      await this.loadFeed(false);
    });
  }

  async swipe(recipeId, action) {
    if (this.state.busy) return;
    const context = this.sessionContext();
    if (!this.state.session.authenticated) {
      if (action === 'dislike') {
        this.state.guestHidden.add(recipeId);
        this.state.lastSwipe = {recipeId, message: 'Скрыто до перезагрузки', deadline: this.now() + UNDO_WINDOW_MS};
        this.render();
        this.focusUndo();
        return;
      }
      return this.showAuth('Войдите, чтобы оценивать рецепты.');
    }
    let succeeded = false;
    await this.runMutation(`recipe-${recipeId}`, async () => {
      const result = await this.api.swipe(recipeId, action);
      if (!this.isCurrentSession(context)) return;
      const message = action === 'like' ? 'Добавлено в избранное' : 'Скрыто до завтра';
      const remaining = result?.undo_remaining_ms ?? UNDO_WINDOW_MS;
      const deadline = this.now() + Math.min(UNDO_WINDOW_MS, remaining);
      this.state.lastSwipe = result?.undo_token ? {recipeId, token: result.undo_token, message, deadline} : null;
      if (this.state.feed) {
        this.state.feed = {...this.state.feed, results: this.state.feed.results.filter(({id}) => id !== recipeId)};
      }
      succeeded = true;
      if (!this.state.lastSwipe) this.toast(message);
    });
    if (!succeeded || !this.isCurrentSession(context)) return;
    this.focusUndo();
    await Promise.all([
      this.loadFeed(false),
      action === 'like' ? this.loadFavorites(false) : undefined,
    ]);
    if (this.isCurrentSession(context) && !this.state.busy && this.state.view === 'feed') {
      const focusedUndo = this.browser?.document?.activeElement?.dataset?.action === 'undo-swipe';
      this.render();
      if (focusedUndo) this.focusUndo();
    }
  }

  focusUndo() {
    if (this.state.view === 'feed') {
      this.root.querySelector?.('[data-action="undo-swipe"]')?.focus({preventScroll: true});
    }
  }

  async undoSwipe() {
    this.expireSwipeNotice();
    const swipe = this.state.lastSwipe;
    if (!swipe || this.state.busy) return;
    const context = this.sessionContext();
    if (!context.authenticated) {
      this.state.guestHidden.delete(swipe.recipeId);
      this.clearSwipeNotice();
      this.render();
      this.toast('Действие отменено');
      this.focusFeedRecipe();
      return;
    }
    let completed = false;
    await this.runMutation('undo-swipe', async () => {
      let message = 'Действие отменено';
      try {
        await this.api.undoSwipe(swipe.token);
      } catch (error) {
        if (error.status !== 409) throw error;
        message = 'Это действие уже нельзя отменить';
      }
      if (!this.isCurrentSession(context)) return;
      this.clearSwipeNotice();
      await Promise.all([this.loadFeed(false), this.loadFavorites(false)]);
      if (!this.isCurrentSession(context)) return;
      this.toast(message);
      completed = true;
    });
    if (completed && this.isCurrentSession(context)) this.focusFeedRecipe();
  }

  focusFeedRecipe() {
    const recipe = this.state.view === 'feed'
      && this.root.querySelector?.('.feature-recipe [data-action="recipe-detail"]');
    if (recipe) recipe.focus();
    return Boolean(recipe);
  }

  async toggleFavorite(recipeId) {
    if (!this.state.session.authenticated) return this.showAuth('Войдите, чтобы сохранять рецепты.');
    const shouldFavorite = !this.state.favoriteIds.has(recipeId);
    const context = this.sessionContext();
    await this.runMutation(`recipe-${recipeId}`, async () => {
      await this.api.setFavorite(recipeId, shouldFavorite);
      if (!this.isCurrentSession(context)) return;
      if (this.state.lastSwipe?.recipeId === recipeId) this.clearSwipeNotice();
      if (!shouldFavorite && this.state.favoritesStatus === 'ready') {
        this.beginRequest('favorites');
        setFavorites(this.state, this.state.favorites.filter(({id}) => id !== recipeId));
      } else {
        await this.loadFavorites(false);
      }
      if (this.isCurrentSession(context)) this.toast(shouldFavorite ? 'Добавлено в избранное' : 'Удалено из избранного');
    });
  }

  async openRecipeDetail(recipeId) {
    this.slotPicker = null;
    const request = this.beginRequest('recipe-detail');
    const current = () => this.dialog.open
      && this.requestVersions.get('recipe-detail') === request.version;
    this.dialog.innerHTML = renderStatus({kind: 'loading', title: 'Загружаем рецепт'});
    if (!this.dialog.open) this.dialog.showModal();
    try {
      const recipe = await this.api.getRecipe(recipeId);
      if (current()) this.dialog.innerHTML = renderRecipeDetail(recipe);
    } catch (error) {
      if (!current()) return;
      await this.handleError(error, () => current() && this.isCurrentSession(request.session));
      if (!current()) return;
      this.dialog.innerHTML = `${renderStatus({kind: 'error', title: 'Рецепт не загрузился', text: 'Закройте окно и попробуйте снова.'})}<button class="button button-secondary" data-action="close-dialog">Закрыть</button>`;
      this.render();
    }
  }

  isCurrentPicker(picker) {
    return Boolean(picker && this.slotPicker === picker && this.dialog.open
      && this.state.view === 'plans' && this.editablePlanId() === picker.planId
      && this.state.planDraft === picker.draft
      && this.isCurrentSession(picker.session));
  }

  focusSlot({planId, dayIndex, mealType, session}) {
    if (this.state.view === 'plans' && this.editablePlanId() === planId && this.isCurrentSession(session)) {
      this.root.querySelector?.(`#pick-meal-${dayIndex}-${mealType}`)?.focus();
    }
  }

  openSlotPicker(planId, dayIndex, mealType) {
    if (this.dialog.open || this.state.busy || this.state.view !== 'plans' || planId !== this.editablePlanId()) return;
    const draft = this.state.planDraft;
    const plan = draft.plan;
    if (!hasValidPlanDates(plan) || !Object.hasOwn(MEAL_LABELS, mealType) || !plan.enabled_meals.includes(mealType)
      || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.duration_days) return;
    const slot = slotFor(plan, dayIndex, mealType);
    const picker = {
      draft, planId, dayIndex, mealType, slot, startDate: plan.start_date, query: '',
      recipes: compatibleFavorites(this.state.favorites, mealType),
      recipeId: slot?.recipe_id ?? null,
      session: this.sessionContext(),
    };
    this.transfer.cancel();
    this.beginRequest('recipe-detail');
    this.slotPicker = picker;
    this.dialog.innerHTML = renderSlotPicker(picker, this.state.favoritesStatus);
    if (!this.dialog.open) this.dialog.showModal();
    if (this.state.favoritesStatus === 'idle' || this.state.favoritesStatus === 'loading') {
      return this.loadPickerFavorites(picker);
    }
  }

  updatePickerResults() {
    this.dialog.querySelector('[data-picker-results]').innerHTML =
      renderPickerResults(this.slotPicker, this.state.favoritesStatus);
  }

  updatePickerSelection() {
    this.dialog.querySelector('[data-picker-selection]').textContent = pickedRecipeTitle(this.slotPicker);
    this.dialog.querySelector('[data-form="slot-picker"] button[type="submit"]').disabled = !this.slotPicker.recipeId;
  }

  async loadPickerFavorites(picker) {
    if (!this.isCurrentPicker(picker)) return;
    const loading = this.loadFavorites(false);
    this.updatePickerResults();
    await loading;
    if (!this.isCurrentPicker(picker)) return;
    picker.recipes = compatibleFavorites(this.state.favorites, picker.mealType);
    if (picker.recipeId !== picker.slot?.recipe_id && !picker.recipes.some(({id}) => id === picker.recipeId)) {
      picker.recipeId = null;
    }
    this.updatePickerResults();
    this.updatePickerSelection();
  }

  async savePickedSlot(servings) {
    const picker = this.slotPicker;
    if (this.state.busy || !this.isCurrentPicker(picker) || !picker.recipeId
      || !Number.isInteger(servings) || servings < 1 || servings > 20) return;
    const {draft, dayIndex, mealType, recipeId} = picker;
    const recipe = picker.recipes.find(({id}) => id === recipeId);
    if (recipeId !== picker.slot?.recipe_id && !recipe) return;
    if (recipeId === picker.slot?.recipe_id && servings === picker.slot.servings) {
      this.dialog.close();
      this.focusSlot(picker);
      return;
    }
    draft.plan.slots = draft.plan.slots.filter((slot) => slot.day_index !== dayIndex || slot.meal_type !== mealType);
    draft.plan.slots.push({
      day_index: dayIndex, meal_type: mealType, recipe_id: recipeId, servings,
      recipe_title: recipe?.title ?? picker.slot.recipe_title,
      recipe_image_url: recipe?.image_url ?? picker.slot?.recipe_image_url ?? '',
    });
    this.markDraftChanged();
    this.dialog.close();
    this.render();
    this.focusSlot(picker);
  }

  async autoFillPlan({replace = false} = {}) {
    const draft = this.state.planDraft;
    if (!draft || this.state.busy || this.state.view !== 'plans' || this.editablePlanId() === null) return;
    const {plan} = draft;
    const revision = this.editRevision;
    if (!hasValidPlanDates(plan) || !plan.enabled_meals.length) {
      this.toast('Укажите корректную дату и хотя бы один приём пищи.');
      return;
    }
    const servings = Number(draft.generationServings ?? 1);
    if (!Number.isInteger(servings) || servings < 1 || servings > 20) {
      this.toast('Укажите количество человек от 1 до 20.');
      return;
    }
    if (replace && plan.slots.length
      && !await this.askConfirmation('Пересобрать меню? Все выбранные вручную блюда в черновике будут заменены.', 'Пересобрать меню')) return;
    if (this.state.planDraft !== draft) return;

    const request = this.beginRequest('auto-fill-plan');
    if (this.state.favoritesStatus !== 'ready') await this.loadFavorites(false);
    if (!this.isCurrentRequest('auto-fill-plan', request) || this.state.planDraft !== draft
      || revision !== this.editRevision || this.state.busy || this.dialog.open
      || this.state.view !== 'plans' || this.editablePlanId() === null
      || this.state.favoritesStatus !== 'ready') return;

    const rotation = (draft.generationRotation ?? 0) + (replace ? 1 : 0);
    const result = generatePlanSlots(plan, this.state.favorites, {servings, replace, rotation});
    if (!result.generated) {
      this.toast(result.missing ? 'В избранном нет блюд для выбранных приёмов пищи.'
        : 'Все приёмы пищи уже заполнены. Для нового варианта нажмите «Пересобрать меню».');
      return;
    }
    plan.slots = result.slots;
    draft.generationRotation = rotation;
    draft.generationNotice = `Подобрано блюд: ${result.generated}.${result.repeated ? ` Повторов: ${result.repeated}.` : ''}${result.missing ? ` Пустых слотов: ${result.missing} — нет подходящих блюд в избранном.` : ''} Проверьте меню и нажмите «Сохранить рацион».`;
    this.markDraftChanged();
    this.render();
    this.root.querySelector?.('[data-action="auto-fill-plan"]')?.focus();
  }

  transferSource(source, handle) {
    const context = {source, handle, draft: this.state.planDraft,
      session: this.sessionContext(), revision: this.editRevision};
    const reason = this.transferBlockReason(context);
    if (reason) {
      this.transfer.announce(reason);
      return null;
    }
    const {plan} = context.draft;
    const recipe = this.state.favorites.find(({id}) => id === source.recipe_id);
    const slot = source.type === 'slot' ? slotFor(plan, source.day_index, source.meal_type) : null;
    if (!recipe || recipe.is_active === false || (source.type === 'slot' && slot?.recipe_id !== source.recipe_id)) {
      this.transfer.announce('Для переноса доступны только активные рецепты из избранного.');
      return null;
    }
    return {...context, title: slot?.recipe_title ?? recipe.title};
  }

  transferBlockReason(context) {
    if (this.state.view !== 'plans' || this.editablePlanId() === null || this.state.busy || this.dialog.open
      || this.historyReturn || this.historyReplay
      || context.draft !== this.state.planDraft || context.revision !== this.editRevision
      || !this.isCurrentSession(context.session)) return 'Черновик изменился или сейчас недоступен.';
    const {plan} = context.draft;
    if (plan.id && this.state.activePlan?.version !== plan.version) {
      return 'Версия рациона изменилась. Проверьте сохранённый рацион перед переносом блюд.';
    }
    if (!hasValidPlanDates(plan) || !plan.enabled_meals.length) return 'Укажите корректную дату и приёмы пищи.';
    if (this.state.favoritesStatus !== 'ready') return 'Дождитесь загрузки избранного.';
    return '';
  }

  inspectTransfer(context, target) {
    const reason = context ? this.transferBlockReason(context) : 'Исходное блюдо недоступно.';
    return reason ? {result: 'blocked', reason}
      : planDrop(context.source, target, context.draft, this.state.favorites);
  }

  applyTransfer(context, target) {
    const outcome = this.inspectTransfer(context, target);
    const messages = {added: 'Блюдо добавлено.', replaced: 'Блюдо в слоте заменено.',
      moved: 'Блюдо перенесено вместе с порциями.', swapped: 'Блюда и порции поменялись местами.'};
    const message = messages[outcome.result];
    if (!message) return outcome;
    const {draft, source} = context;
    const {scrollX, scrollY} = this.browser ?? {};
    const previous = {slots: draft.plan.slots, dirty: draft.dirty};
    draft.plan.slots = outcome.nextSlots;
    this.markDraftChanged();
    this.transferUndo = {draft, previous, source, target, message, revision: this.editRevision,
      session: context.session};
    this.transferUndo.timer = setTimeout(() => this.clearTransferUndo(), 8000);
    this.transferUndo.timer.unref?.();
    this.render();
    this.browser?.scrollTo?.(scrollX, scrollY);
    this.transfer.announce(message);
    this.focusTransferSlot(target);
    return outcome;
  }

  focusTransferSlot({day_index, meal_type}) {
    this.root.querySelector?.(`#pick-meal-${day_index}-${meal_type}`)?.focus({preventScroll: true});
  }

  updateTransferUndo() {
    const button = this.root.querySelector?.('[data-action="undo-transfer"]');
    if (button) {
      button.hidden = !this.transferUndo;
      button.disabled = Boolean(this.state.busy);
    }
  }

  clearTransferUndo() {
    clearTimeout(this.transferUndo?.timer);
    this.transferUndo = null;
    this.updateTransferUndo();
  }

  undoTransfer() {
    const operation = this.transferUndo;
    if (!operation || operation.draft !== this.state.planDraft || operation.revision !== this.editRevision
      || !this.isCurrentSession(operation.session) || this.editablePlanId() === null
      || this.state.busy || this.dialog.open) return;
    operation.draft.plan.slots = operation.previous.slots;
    this.markDraftChanged(operation.previous.dirty);
    this.render();
    this.transfer.announce('Перестановка отменена.');
    this.focusTransferSlot(operation.source.type === 'slot' ? operation.source : operation.target);
  }

  markDraftChanged(previousDirty) {
    this.editRevision += 1;
    this.clearTransferUndo();
    this.transfer.cancel();
    const {planDraft, activePlan} = this.state;
    const {plan} = planDraft;
    const baseline = plan.id && activePlan?.version === plan.version
      ? planContentKey(activePlan) : planDraft.initialContent;
    planDraft.dirty = previousDirty ?? (baseline === undefined || planContentKey(plan) !== baseline);
    if (!planDraft.dirty) this.state.restoredDraft = false;
    this.persistDraft();
    this.watchUnsavedChanges();
    const status = this.root.querySelector?.('[data-draft-status]');
    if (status) status.textContent = draftStatus(this.state);
    const discard = this.root.querySelector?.('[data-action="discard-draft"]');
    if (discard) discard.hidden = Boolean(planDraft.plan.id && !planDraft.dirty);
  }

  persistDraft() {
    const {planDraft, session} = this.state;
    planDraft.storageUnavailable = false;
    const stored = this.planDrafts.put(session.id, planDraft.plan.id, planDraft);
    planDraft.storageUnavailable = !stored;
    this.state.draftStorageUnavailable = !stored;
    const warning = this.root.querySelector?.('[data-draft-storage-warning]');
    if (warning) warning.hidden = stored;
  }

  async changePlanSettings(control) {
    const draft = this.state.planDraft;
    if (this.state.view !== 'plans' || !draft || this.state.busy) return;
    const {change} = control.dataset;
    const next = {...draft.plan};
    if (change === 'plan-date') next.start_date = control.value;
    if (change === 'plan-duration') next.duration_days = Number(control.value);
    if (change === 'plan-meal') {
      const meals = new Set(next.enabled_meals);
      if (control.checked) meals.add(control.value);
      else meals.delete(control.value);
      next.enabled_meals = [...meals];
    }
    if (next.start_date === draft.plan.start_date && next.duration_days === draft.plan.duration_days
      && next.enabled_meals.length === draft.plan.enabled_meals.length
      && next.enabled_meals.every((meal) => draft.plan.enabled_meals.includes(meal))) return;
    const remaining = includedSlots(next);
    const removed = draft.plan.slots.length - remaining.length;
    const focus = change === 'plan-date'
      ? '[data-change="plan-date"]' : `[data-change="${change}"][value="${control.value}"]`;
    const accepted = !removed || await this.askConfirmation(
      `После сохранения из рациона будут удалены блюда · ${removed}. Продолжить?`, 'Применить настройки',
    );
    if (this.state.planDraft !== draft || this.state.view !== 'plans') return;
    if (accepted) {
      draft.plan = {...next, slots: remaining};
      draft.generationNotice = '';
      this.markDraftChanged();
    }
    this.render();
    this.root.querySelector?.(focus)?.focus({preventScroll: true});
  }

  async openPlanEditor(mode, id = null) {
    const context = this.sessionContext();
    await this.navigate('plans', {planMode: mode, planId: id});
    if (this.isCurrentSession(context) && this.state.view === 'plans'
      && this.state.planMode === mode && this.state.activePlanId === id) {
      this.root.querySelector?.('#plan-editor-title')?.focus();
    }
  }

  async duplicatePlan(planId) {
    if (!this.state.session.authenticated || this.state.planMode !== 'list'
      || !this.state.plans?.some(({id}) => id === planId) || this.state.busy) return;
    const userId = this.state.session.id;
    if (this.planDrafts.get(userId, null)?.dirty
      && !await this.askConfirmation('Заменить текущий новый черновик копией рациона?', 'Заменить черновик')) return;
    const request = this.beginRequest('duplicate');
    const viewVersion = this.requestVersions.get('view');
    let draft;
    await this.runMutation('duplicate-plan', async () => {
      const [source, favorites] = await Promise.all([this.api.getPlan(planId), this.api.getFavorites()]);
      if (!this.isCurrentRequest('duplicate', request) || this.requestVersions.get('view') !== viewVersion) return;
      draft = duplicatePlanDraft(source, favorites);
      this.planDrafts.put(userId, null, draft);
    });
    if (draft && this.isCurrentRequest('duplicate', request)) await this.openPlanEditor('new');
  }

  async discardDraft() {
    const {planDraft, session} = this.state;
    if (!planDraft || this.state.busy) return;
    if (planDraft.dirty && !await this.askConfirmation('Удалить несохранённые изменения в этом черновике?', 'Отменить изменения')) return;
    if (this.state.planDraft !== planDraft) return;
    this.planDrafts.remove(session.id, planDraft.plan.id);
    this.state.error = null;
    this.state.planDraft = null;
    this.watchUnsavedChanges();
    if (planDraft.plan.id) await this.loadActivePlan();
    else await this.navigate('plans', {planMode: 'list', replace: true});
  }

  async savePlan({focus = true} = {}) {
    const {planDraft, session} = this.state;
    if (this.dialog.open || this.state.view !== 'plans' || !session.authenticated || !planDraft
      || this.editablePlanId() === null || this.state.busy) return;
    const {plan} = planDraft;
    const context = this.sessionContext();

    if (!hasValidPlanDates(plan) || !plan.enabled_meals.length) {
      this.state.error = new ApiError({
        type: 'validation', message: 'Выберите корректную дату и хотя бы один приём пищи.',
      });
      this.render();
      return;
    }
    const unavailable = this.state.favoritesStatus === 'ready'
      && unavailableDraftSlot(plan, this.state.activePlan, this.state.favorites);
    if (unavailable) {
      this.state.error = new ApiError({type: 'validation',
        message: `День ${unavailable.day_index + 1}, ${MEAL_LABELS[unavailable.meal_type]}: выберите подходящий активный рецепт из избранного.`,
      });
      this.render();
      return;
    }
    let savedId;
    await this.runMutation('save-plan', async () => {
      const payload = planDraftPayload(planDraft);
      let saved;
      try {
        saved = plan.id ? await this.api.updatePlan(plan.id, payload) : await this.api.createPlan(payload);
      } catch (error) {
        if (error.status !== 409) throw error;
        throw new ApiError({
          status: 409,
          message: plan.id
            ? 'Рацион изменился в другой вкладке. Отмените изменения, чтобы загрузить сохранённую версию.'
            : 'Этот черновик уже был сохранён с другими данными. Проверьте список рационов.',
        });
      }
      if (this.historyReturn) await this.historyReturn.done;
      if (!this.isCurrentSession(context) || this.state.planDraft !== planDraft) return;
      this.planDrafts.remove(session.id, plan.id);
      this.beginRequest('plans');
      this.beginRequest('active-plan');
      this.invalidateShopping();
      this.state.plans = null;
      this.state.plansStatus = 'idle';
      Object.assign(this.state, {
        activePlanId: saved.id, activePlan: saved, activePlanStatus: 'ready',
        planMode: 'edit', planDraft: makePlanDraft(saved), restoredDraft: false, draftStorageUnavailable: false,
      });
      this.watchUnsavedChanges();
      this.writeRoute(true);
      this.toast('Рацион сохранён');
      savedId = saved.id;
    });
    if (savedId && this.isCurrentSession(context)) {
      if (focus) this.root.querySelector?.('[data-draft-status]')?.focus({preventScroll: true});
      return savedId;
    }
    if (focus) this.root.querySelector?.('.error-banner')?.focus();
  }

  async deleteSlot(dayIndex, mealType, planId) {
    const draft = this.state.planDraft;
    const slot = slotFor(draft?.plan, dayIndex, mealType);
    if (!slot || this.state.busy || this.editablePlanId() !== planId) return;
    if (!await this.askConfirmation(`Убрать блюдо «${slot.recipe_title}» из этого слота?`, 'Удалить блюдо')
      || this.state.planDraft !== draft || slotFor(draft.plan, dayIndex, mealType) !== slot) return;
    draft.plan.slots = draft.plan.slots.filter((slot) => slot.day_index !== dayIndex || slot.meal_type !== mealType);
    this.markDraftChanged();
    this.render();
    this.root.querySelector?.(`#pick-meal-${dayIndex}-${mealType}`)?.focus();
  }

  async deletePlan(planId) {
    if (!this.state.session.authenticated || !this.state.plans?.some(({id}) => id === planId) || this.state.busy) return;
    const context = this.sessionContext();
    if (!await this.askConfirmation('Удалить рацион и все блюда в нём?', 'Удалить рацион')) return;
    await this.runMutation('delete-plan', async () => {
      await this.api.deletePlan(planId);
      if (!this.isCurrentSession(context)) return;
      this.planDrafts.remove(this.state.session.id, planId);
      if (this.state.shoppingPlanId === planId) this.state.shoppingPlanId = null;
      this.invalidateShopping();
      await this.loadPlans(false);
      if (!this.isCurrentSession(context)) return;
      if (this.state.view === 'shopping') await this.loadView('shopping');
      if (this.isCurrentSession(context)) this.toast('Рацион удалён');
    });
  }

  openPlanShopping(planId) {
    if (!this.state.session.authenticated || !planId) return;
    return this.navigate('shopping', {shoppingPlanId: planId});
  }

  showNavigationDecision(destination) {
    if (this.navigationDecision && this.dialog.open) return;
    this.transfer.cancel();
    this.settleConfirmation(false);
    this.beginRequest('recipe-detail');
    this.slotPicker = null;
    const needsSavedPlan = this.shoppingNeedsSave(destination);
    this.navigationDecision = {
      destination, needsSavedPlan, draft: this.state.planDraft, session: this.sessionContext(),
    };
    this.dialog.innerHTML = renderNavigationDecision(needsSavedPlan);
    if (!this.dialog.open) this.dialog.showModal();
    else this.dialog.querySelector?.('[autofocus]')?.focus();
  }

  async resolveNavigationDecision(save) {
    const decision = this.navigationDecision;
    if (this.state.busy || this.historyReturn || !this.dialog.open || !decision || decision.draft !== this.state.planDraft
      || !this.isCurrentSession(decision.session) || (!save && decision.needsSavedPlan)) return;
    this.navigationDecision = null;
    this.dialog.close();
    const destination = decision.destination;
    if (save) {
      const savedId = await this.savePlan({focus: false});
      if (!this.isCurrentSession(decision.session)) return;
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

  editableShoppingPlanId() {
    return this.state.session.authenticated && this.state.shoppingStatus === 'ready'
      && this.state.shopping?.plan_id === Number(this.state.shoppingPlanId)
      ? this.state.shopping.plan_id : null;
  }

  async setPurchased(planId, ingredientId, purchased) {
    if (this.state.busy || planId !== this.editableShoppingPlanId()) return;
    const item = this.state.shopping.items.find((entry) => entry.ingredient_id === ingredientId);
    if (!item) return;
    await this.changePurchases(planId, async () => {
      await this.api.setPurchased(planId, ingredientId, {purchased, quantity_version: item.quantity_version});
    }, `#purchase-${ingredientId}`);
  }

  async clearPurchases(planId) {
    if (this.state.busy || planId !== this.editableShoppingPlanId()
      || !this.state.shopping.items.some((item) => item.purchased)) return;
    if (!await this.askConfirmation('Снять все отметки о покупках в выбранном рационе?', 'Снять отметки')
      || this.state.view !== 'shopping' || planId !== this.editableShoppingPlanId()) return;
    await this.changePurchases(planId, () => this.api.clearPurchases(planId), '[data-action="refresh-shopping"]');
  }

  async changePurchases(planId, write, focusSelector) {
    const context = this.sessionContext();
    const current = () => this.isCurrentSession(context) && Number(this.state.shoppingPlanId) === planId;
    await this.runMutation('purchases', async () => {
      let stale = false;
      try {
        await write();
      } catch (error) {
        if (![404, 409].includes(error.status)) {
          if (current()) throw error;
          return;
        }
        stale = true;
      }
      if (!current()) return;
      await this.loadShopping(false);
      if (stale && current() && this.state.shoppingStatus === 'ready') {
        this.toast('Список покупок изменился. Проверьте количество и повторите отметку.');
      }
    });
    if (current() && this.state.view === 'shopping') this.root.querySelector?.(focusSelector)?.focus();
  }

  async exportShopping(fileType) {
    const planId = this.editableShoppingPlanId();
    if (!planId) return;
    const context = this.sessionContext();
    await this.runMutation(`export-${fileType}`, async () => {
      const file = await this.api.downloadShoppingList(planId, fileType);
      if (!this.isCurrentSession(context) || Number(this.state.shoppingPlanId) !== planId) return;
      saveBlob(file);
      this.toast(`Файл ${fileType.toUpperCase()} готов`);
    });
  }
}
