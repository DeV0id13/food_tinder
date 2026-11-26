import {ApiError} from './api/errors.js';
import {createInitialState, defaultCatalogFilters, defaultFavoriteFilters} from './state/state.js';
import {readRoute} from './utils/routes.js';
import {renderShell} from './views/shell.js';
import {renderLibraryResults} from './views/plan-library.js';
import {AccountController} from './controllers/account.js';
import {RecipesController} from './controllers/recipes.js';
import {PlansController} from './controllers/plans.js';
import {ShoppingController} from './controllers/shopping.js';
import {NavigationController} from './controllers/navigation.js';

export class FoodTinderApp {
  constructor({root, dialog, toast, api, browser = globalThis.window, now = Date.now}) {
    this.root = root;
    this.dialog = dialog;
    this.toastElement = toast;
    this.api = api;
    this.browser = browser;
    this.now = now;
    this.state = createInitialState();
    this.initializingSession = false;
    this.requestVersions = new Map();
    this.toastTimer = null;
    this.mutation = null;
    this.account = new AccountController(this);
    this.recipes = new RecipesController(this);
    this.plans = new PlansController(this);
    this.shopping = new ShoppingController(this);
    this.navigation = new NavigationController(this);
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('submit', (event) => this.onSubmit(event));
    this.root.addEventListener('change', (event) => this.onChange(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.dialog.addEventListener('click', (event) => this.onClick(event));
    this.dialog.addEventListener('submit', (event) => this.onSubmit(event));
    this.dialog.addEventListener('input', (event) => this.onInput(event));
    this.dialog.addEventListener('change', (event) => this.onChange(event));
  }

  render() {
    this.recipes.expireSwipeNotice();
    this.navigation.watchUnsavedChanges();
    const {options, scroll} = this.plans.prepareRender();
    this.root.innerHTML = renderShell(this.state, options);
    this.plans.restoreRender(scroll);
    this.recipes.updateSwipeNotice();
  }

  beginRequest(key) {
    const version = (this.requestVersions.get(key) || 0) + 1;
    this.requestVersions.set(key, version);
    return {version, session: this.account.sessionContext()};
  }

  isCurrentRequest(key, request) {
    return this.requestVersions.get(key) === request.version
      && this.account.isCurrentSession(request.session);
  }

  toast(message) {
    clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add('visible');
    this.toastTimer = setTimeout(() => this.toastElement.classList.remove('visible'), 3000);
  }

  async start() {
    if (this.browser) {
      this.navigation.applyRoute(readRoute(this.browser.location));
      this.browser.history.replaceState({
        ...this.browser.history.state, foodTinderIndex: this.navigation.historyIndex,
      }, '', this.browser.location.href);
    }
    this.initializingSession = true;
    this.render();
    const context = this.account.sessionContext();
    try {
      try {
        const session = await this.api.getSession();
        if (this.account.isCurrentSession(context)) this.account.setSession(session);
      } catch (error) {
        await this.handleError(error, () => this.account.isCurrentSession(context));
      } finally {
        this.initializingSession = false;
      }
      if (this.browser) this.navigation.applyRoute(readRoute(this.browser.location));
      await this.loadView(this.state.view);
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.state.initialLoading = false;
      this.render();
    }
  }

  async handleError(error, isCurrent) {
    const context = this.account.sessionContext();
    const current = isCurrent || (() => this.account.isCurrentSession(context));
    const normalized = error instanceof ApiError
      ? error
      : new ApiError({type: 'http', details: String(error?.message || error)});
    if (!current()) return normalized;
    this.state.error = normalized;
    if (normalized.type === 'auth') {
      try {
        const session = await this.api.getSession();
        if (!current()) return normalized;
        this.account.setSession(session);
        this.render();
      } catch {
        // Keep the original actionable error; show API errors without replacing server data.
      }
    }
    return normalized;
  }

  async runMutation(key, operation) {
    if (this.state.busy) return;
    const context = this.account.sessionContext();
    const mutation = {};
    this.mutation = mutation;
    this.state.busy = key;
    this.state.error = null;
    this.render();
    try {
      await operation();
    } catch (error) {
      await this.handleError(error, () => this.account.isCurrentSession(context));
    } finally {
      if (this.mutation === mutation) {
        this.mutation = null;
        this.state.busy = null;
        this.render();
      }
    }
  }

  async loadView(view) {
    const {authenticated} = this.state.session;
    const needsFavorites = authenticated && !['ready', 'loading'].includes(this.state.favoritesStatus);
    if (view === 'feed') {
      await Promise.all([this.recipes.loadFeed(), needsFavorites ? this.recipes.loadFavorites() : undefined]);
    }
    if (view === 'recipes') {
      await Promise.all([
        this.recipes.loadCatalog(),
        needsFavorites ? this.recipes.loadFavorites() : undefined,
      ]);
    }
    if (view === 'favorites' && authenticated) await this.recipes.loadFavorites();
    if (view === 'auth' && authenticated) await this.account.loadAccount();
    if (view === 'plans' && authenticated) await this.plans.loadEditorView();
    if (view === 'shopping' && authenticated) await this.shopping.loadShoppingView();
  }

  async onClick(event) {
    const control = event.target.closest('[data-action]');
    if (!control) {
      const handle = event.target.closest('[data-transfer-source]');
      if (handle) return this.plans.transfer.choose(handle);
      return this.navigation.followInternalLink(event);
    }
    const {action} = control.dataset;
    if (action === 'navigate') return this.navigation.navigate(control.dataset.view);
    if (action === 'open-feed') return this.navigation.navigate('feed');
    if (action === 'open-recipes') return this.navigation.navigate('recipes');
    if (action === 'open-plans') return this.navigation.navigate('plans');
    if (action === 'show-auth') return this.account.showAuth('Войдите снова, чтобы продолжить.');
    if (action === 'dismiss-error') {
      this.state.error = null;
      return this.render();
    }
    if (action === 'auth-tab') {
      this.state.authTab = control.dataset.tab;
      this.state.authNotice = null;
      return this.render();
    }
    if (action === 'retry-feed') return this.recipes.loadFeed();
    if (action === 'retry-recipes') return this.recipes.loadCatalog();
    if (action === 'catalog-page') return this.recipes.changeCatalogPage(Number(control.dataset.offset));
    if (action === 'reset-catalog') {
      Object.assign(this.state, defaultCatalogFilters());
      const loading = this.recipes.changeCatalogFilters();
      this.render();
      this.root.querySelector?.('#recipe-search')?.focus();
      return loading;
    }
    if (action === 'reset-favorites') {
      this.state.favoriteFilters = defaultFavoriteFilters();
      this.navigation.writeRoute(true);
      this.render();
      this.root.querySelector?.('#favorite-search')?.focus();
      return;
    }
    if (action === 'retry-favorites') return this.recipes.loadFavorites();
    if (action === 'retry-account') return this.account.loadAccount();
    if (action === 'retry-plans') return this.plans.loadPlans();
    if (action === 'retry-active-plan') return this.plans.loadActivePlan();
    if ((action === 'retry-shopping' || action === 'refresh-shopping') && !this.state.busy) return this.shopping.loadShopping();
    if (action === 'close-dialog') return this.navigation.dismissDialog();
    if (action === 'accept-confirmation' && this.navigation.confirmation) {
      this.navigation.settleConfirmation(true);
      return this.dialog.close();
    }
    if (action === 'recipe-detail') return this.recipes.openRecipeDetail(Number(control.dataset.recipeId));
    if (action === 'toggle-favorite') return this.recipes.toggleFavorite(Number(control.dataset.recipeId));
    if (action === 'swipe') return this.recipes.swipe(Number(control.dataset.recipeId), control.dataset.swipe);
    if (action === 'undo-swipe') return this.recipes.undoSwipe();
    if (action === 'logout') return this.account.logout();
    if (action === 'pick-slot') return this.plans.openSlotPicker(Number(control.dataset.planId), Number(control.dataset.dayIndex), control.dataset.mealType);
    if (action === 'retry-picker') return this.plans.loadPickerFavorites(this.plans.slotPicker);
    if (action === 'delete-slot') return this.plans.deleteSlot(Number(control.dataset.dayIndex), control.dataset.mealType, Number(control.dataset.planId));
    if (action === 'plan-list') return this.navigation.navigate('plans', {planMode: 'list'});
    if (action === 'new-plan') return this.plans.openPlanEditor('new');
    if (action === 'auto-fill-plan') return this.plans.autoFillPlan();
    if (action === 'regenerate-plan') return this.plans.autoFillPlan({replace: true});
    if (action === 'edit-plan') return this.plans.openPlanEditor('edit', Number(control.dataset.planId));
    if (action === 'duplicate-plan') return this.plans.duplicatePlan(Number(control.dataset.planId));
    if (action === 'delete-plan') return this.plans.deletePlan(Number(control.dataset.planId));
    if (action === 'discard-draft') return this.plans.discardDraft();
    if (action === 'plan-shopping') return this.shopping.openPlanShopping(Number(control.dataset.planId));
    if (action === 'save-and-navigate' || action === 'keep-draft-and-navigate') {
      return this.navigation.resolveNavigationDecision(action === 'save-and-navigate');
    }
    if (action === 'place-transfer') return this.plans.transfer.place(control.closest('[data-transfer-target]'));
    if (action === 'cancel-transfer') return this.plans.transfer.cancel(true);
    if (action === 'undo-transfer') return this.plans.undoTransfer();
    if (action === 'export-shopping') return this.shopping.exportShopping(control.dataset.fileType);
    if (action === 'clear-purchases') return this.shopping.clearPurchases(Number(control.dataset.planId));
  }

  async onSubmit(event) {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === 'login') {
      return this.account.login({email: data.get('email'), password: data.get('password')});
    }
    if (form.dataset.form === 'register') {
      return this.account.register({
        first_name: data.get('first_name'), email: data.get('email'), password: data.get('password'),
      });
    }
    if (form.dataset.form === 'account-names') {
      return this.account.updateAccountNames({
        first_name: data.get('first_name'), last_name: data.get('last_name'),
      });
    }
    if (form.dataset.form === 'account-email') {
      return this.account.updateAccountEmail({
        email: data.get('email'), current_password: data.get('current_password'),
      });
    }
    if (form.dataset.form === 'plan-editor') return this.plans.savePlan();
    if (form.dataset.form === 'slot-picker' && this.dialog.contains(form)) {
      return this.plans.savePickedSlot(Number(data.get('servings')));
    }
  }

  onInput(event) {
    if (Object.hasOwn(event.target.dataset, 'librarySearch')) {
      this.plans.transfer.cancel();
      this.plans.libraryQuery = event.target.value;
      this.root.querySelector('[data-library-results]').innerHTML = renderLibraryResults(this.state, this.plans.libraryQuery);
      return;
    }
    if (event.target.dataset.input === 'plan-title' && this.state.planDraft && !this.state.busy) {
      if (this.state.planDraft.plan.title === event.target.value) return;
      this.state.planDraft.plan.title = event.target.value;
      this.plans.markDraftChanged();
      return;
    }
    if (event.target.dataset.input === 'picker-search' && this.plans.isCurrentPicker(this.plans.slotPicker)) {
      this.plans.slotPicker.query = event.target.value;
      this.plans.updatePickerResults();
      return;
    }
    if (event.target.dataset.input === 'favorite-search') {
      this.state.favoriteFilters.query = event.target.value;
      return this.recipes.updateFavoriteResults();
    }
    if (event.target.dataset.input !== 'recipe-search') return;
    this.state.catalogQuery = event.target.value;
    this.recipes.changeCatalogFilters({debounce: true});
  }

  async onChange(event) {
    const {change} = event.target.dataset;
    if (['catalog-meal', 'catalog-time', 'catalog-favorites', 'catalog-sort'].includes(change)) {
      if (change === 'catalog-meal') this.state.catalogMeal = event.target.value;
      if (change === 'catalog-time') this.state.catalogMaxTime = Number(event.target.value);
      if (change === 'catalog-favorites' && this.state.session.authenticated) {
        this.state.catalogFavoritesOnly = event.target.checked;
      }
      if (change === 'catalog-sort') this.state.catalogSort = event.target.value;
      return this.recipes.changeCatalogFilters();
    }
    if (['favorites-meal', 'favorites-time', 'favorites-sort'].includes(change)) {
      const {value} = event.target;
      if (change === 'favorites-meal') this.state.favoriteFilters.meal = value;
      if (change === 'favorites-time') this.state.favoriteFilters.maxTime = Number(value);
      if (change === 'favorites-sort') this.state.favoriteFilters.sort = value;
      this.recipes.updateFavoriteResults();
      return;
    }
    if (this.state.busy) return;
    if (event.target.dataset.change === 'picker-recipe' && this.plans.isCurrentPicker(this.plans.slotPicker)) {
      this.plans.slotPicker.recipeId = Number(event.target.value);
      this.plans.updatePickerSelection();
      return;
    }
    if (change === 'plan-auto-servings') {
      if (!this.state.planDraft || this.state.busy) return;
      const servings = Number(event.target.value);
      if (servings === this.state.planDraft.generationServings) return;
      this.plans.editRevision += 1;
      this.plans.clearTransferUndo();
      this.plans.transfer.cancel();
      this.state.planDraft.generationServings = servings;
      this.plans.persistDraft();
      return;
    }
    if (['plan-date', 'plan-duration', 'plan-meal'].includes(change)) return this.plans.changePlanSettings(event.target);
    if (change === 'shopping-plan') {
      this.state.error = null;
      this.state.shoppingPlanId = Number(event.target.value);
      this.navigation.writeRoute();
      return this.shopping.loadShopping();
    }
    if (change === 'purchase') {
      const {planId, ingredientId} = event.target.dataset;
      return this.shopping.setPurchased(Number(planId), Number(ingredientId), event.target.checked);
    }
  }
}
