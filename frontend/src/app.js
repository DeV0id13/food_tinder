import {ApiError, apiErrorMessage} from './api/errors.js';
import {renderRecipeDetail} from './components/recipe-card.js';
import {MEAL_LABELS} from './constants.js';
import {clearPrivateState, createInitialState, setFavorites} from './state/state.js';
import {renderStatus} from './utils/dom.js';
import {saveBlob} from './utils/download.js';
import {compatibleFavorites, invalidateShopping, slotFor} from './utils/plans.js';
import {isPrivateView, readRoute, routeUrl} from './utils/routes.js';
import {renderShell} from './views/shell.js';
import {catalogSearchCount, renderCatalogResults} from './views/recipes-view.js';
import {pickedRecipeTitle, renderPickerResults, renderSlotPicker} from './views/slot-picker.js';

export class FoodTinderApp {
  constructor({root, dialog, toast, api, browser = globalThis.window}) {
    this.root = root;
    this.dialog = dialog;
    this.toastElement = toast;
    this.api = api;
    this.browser = browser;
    this.initializingSession = false;
    this.authReturnView = null;
    this.state = createInitialState();
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
        this.dialog.close();
      }
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.dialog.addEventListener('close', () => {
      // A queued close event can arrive after another recipe has been opened.
      if (this.dialog.open) return;
      this.beginRequest('recipe-detail');
      const picker = this.slotPicker;
      this.slotPicker = null;
      if (picker) this.focusSlot(picker);
    });
  }

  render() {
    this.root.innerHTML = renderShell(this.state);
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
      if (this.slotPicker) this.dialog.close();
      this.slotPicker = null;
      if (this.state.busy !== 'auth') {
        this.mutation = null;
        this.state.busy = null;
      }
      clearPrivateState(this.state);
      this.state.feed = null;
      this.state.feedStatus = 'idle';
      this.state.guestHidden = new Set();
    }
    this.state.session = session;
    this.state.sessionKnown = true;
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

  async reloadVisibleShopping() {
    if (this.state.view === 'shopping') await this.loadShopping();
  }

  async refreshAfterSlotChange(planId) {
    this.invalidateShopping();
    await Promise.all([
      Number(this.state.activePlanId) === planId ? this.loadActivePlan(false) : undefined,
      this.reloadVisibleShopping(),
    ]);
  }

  editablePlanId() {
    return this.state.session.authenticated && this.state.activePlanStatus === 'ready'
      && this.state.activePlan?.id === Number(this.state.activePlanId)
      ? this.state.activePlan.id : null;
  }

  toast(message) {
    clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add('visible');
    this.toastTimer = setTimeout(() => this.toastElement.classList.remove('visible'), 3000);
  }

  async start() {
    if (this.browser) this.applyRoute(readRoute(this.browser.location));
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
      if (!this.state.plans.length) {
        this.state.activePlanId = null;
        this.state.activePlan = null;
        this.state.activePlanStatus = 'idle';
        this.state.shoppingPlanId = null;
        this.invalidateShopping();
      } else {
        const ids = new Set(this.state.plans.map(({id}) => id));
        if (!ids.has(Number(this.state.activePlanId))) this.state.activePlanId = this.state.plans[0].id;
        if (!ids.has(Number(this.state.shoppingPlanId))) this.state.shoppingPlanId = this.state.activePlanId;
        await this.loadActivePlan(false);
      }
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
    const planId = Number(this.state.activePlanId);
    const request = this.beginRequest('active-plan');
    const current = () => this.isCurrentRequest('active-plan', request)
      && Number(this.state.activePlanId) === planId;
    this.state.activePlan = null;
    this.state.activePlanStatus = 'loading';
    if (shouldRender) this.render();
    try {
      const plan = await this.api.getPlan(planId);
      if (!current()) return;
      this.state.activePlan = plan;
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
    return this.navigate('auth', {next: isPrivateView(this.state.view) ? this.state.view : null});
  }

  applyRoute({view, filters, next}) {
    this.state.view = view;
    this.authReturnView = next ?? null;
    if (filters) {
      Object.assign(this.state, filters, {
        catalogFavoritesOnly: this.state.session.authenticated && filters.catalogFavoritesOnly,
      });
    }
  }

  writeRoute(replace = false) {
    if (!this.browser) return;
    const {pathname, search} = this.browser.location;
    const url = routeUrl(this.state.view, this.state, this.authReturnView);
    if (url !== pathname + search) {
      if (replace) this.browser.history.replaceState(null, '', url);
      else this.browser.history.pushState(null, '', url);
    }
  }

  restoreRoute() {
    const route = readRoute(this.browser.location);
    this.applyRoute(route);
    return this.navigate(route.view, {fromHistory: true, next: route.next});
  }

  async navigate(view, {replace = false, fromHistory = false, next = null} = {}) {
    if (this.dialog.open) this.dialog.close();
    this.state.view = view;
    this.authReturnView = next ?? null;
    this.state.error = null;
    if (!fromHistory) this.writeRoute(replace);
    this.render();
    if (!this.initializingSession) await this.loadView(view);
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
    if (view === 'plans' && authenticated) {
      await Promise.all([
        this.loadFavorites(false),
        this.loadPlans(false),
      ]);
      this.render();
    }
    if (view === 'shopping' && authenticated) {
      if (!this.state.plans) await this.loadPlans(false);
      if (this.state.view === view && this.state.plans?.length) await this.loadShopping(false);
      this.render();
    }
  }

  async onClick(event) {
    const control = event.target.closest('[data-action]');
    if (!control) return;
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
    if (action === 'retry-favorites') return this.loadFavorites();
    if (action === 'retry-plans') return this.loadPlans();
    if (action === 'retry-active-plan') return this.loadActivePlan();
    if ((action === 'retry-shopping' || action === 'refresh-shopping') && !this.state.busy) return this.loadShopping();
    if (action === 'close-dialog') return this.dialog.close();
    if (action === 'recipe-detail') return this.openRecipeDetail(Number(control.dataset.recipeId));
    if (action === 'toggle-favorite') return this.toggleFavorite(Number(control.dataset.recipeId));
    if (action === 'swipe') return this.swipe(Number(control.dataset.recipeId), control.dataset.swipe);
    if (action === 'undo-swipe') return this.undoSwipe();
    if (action === 'logout') return this.logout();
    if (action === 'pick-slot') return this.openSlotPicker(Number(control.dataset.planId), Number(control.dataset.dayIndex), control.dataset.mealType);
    if (action === 'retry-picker') return this.loadPickerFavorites(this.slotPicker);
    if (action === 'delete-slot') return this.deleteSlot(Number(control.dataset.dayIndex), control.dataset.mealType, Number(control.dataset.planId));
    if (action === 'delete-plan') return this.deletePlan();
    if (action === 'export-shopping') return this.exportShopping(control.dataset.fileType);
    if (action === 'clear-purchases') return this.clearPurchases(Number(control.dataset.planId));
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
      return this.register({email: data.get('email'), password: data.get('password')});
    }
    if (form.dataset.form === 'create-plan') {
      return this.createPlan({
        start_date: data.get('start_date'),
        duration_days: Number(data.get('duration_days')),
        enabled_meals: data.getAll('enabled_meals'),
      });
    }
    if (form.dataset.form === 'slot-picker' && this.dialog.contains(form)) {
      return this.savePickedSlot(Number(data.get('servings')));
    }
  }

  onInput(event) {
    if (event.target.dataset.input === 'picker-search' && this.isCurrentPicker(this.slotPicker)) {
      this.slotPicker.query = event.target.value;
      this.updatePickerResults();
      return;
    }
    if (event.target.dataset.input !== 'recipe-search') return;
    this.state.catalogQuery = event.target.value;
    this.updateCatalogResults();
  }

  updateCatalogResults() {
    if (this.state.view === 'recipes') this.writeRoute(true);
    const results = this.root.querySelector('[data-catalog-results]');
    if (results) results.innerHTML = renderCatalogResults(this.state);
    const count = this.root.querySelector('[data-catalog-count]');
    if (count) count.textContent = catalogSearchCount(this.state);
  }

  async onChange(event) {
    const {change} = event.target.dataset;
    if (change === 'catalog-meal' || change === 'catalog-time' || change === 'catalog-favorites') {
      if (change === 'catalog-meal') this.state.catalogMeal = event.target.value;
      if (change === 'catalog-time') this.state.catalogMaxTime = Number(event.target.value);
      if (change === 'catalog-favorites' && this.state.session.authenticated) {
        this.state.catalogFavoritesOnly = event.target.checked;
      }
      this.updateCatalogResults();
      return;
    }
    if (this.state.busy) return;
    if (event.target.dataset.change === 'picker-recipe' && this.isCurrentPicker(this.slotPicker)) {
      this.slotPicker.recipeId = Number(event.target.value);
      this.updatePickerSelection();
      return;
    }
    if (event.target.dataset.change === 'active-plan') {
      if (this.slotPicker) this.dialog.close();
      this.state.error = null;
      this.state.activePlanId = Number(event.target.value);
      return this.loadActivePlan();
    }
    if (event.target.dataset.change === 'shopping-plan') {
      this.state.error = null;
      this.state.shoppingPlanId = Number(event.target.value);
      return this.loadShopping();
    }
    if (change === 'purchase') {
      const {planId, ingredientId} = event.target.dataset;
      return this.setPurchased(Number(planId), Number(ingredientId), event.target.checked);
    }
  }

  async login(payload) {
    await this.runMutation('auth', async () => {
      this.setSession(await this.api.login(payload), true);
      this.state.authNotice = null;
      if (this.state.view === 'auth') await this.navigate(this.authReturnView || 'feed', {replace: true});
      else await this.loadView(this.state.view);
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
        this.state.lastSwipe = {recipeId, message: 'Скрыто до перезагрузки'};
        this.render();
        this.focusUndo();
        return;
      }
      return this.showAuth('Войдите, чтобы оценивать рецепты.');
    }
    let completed = false;
    await this.runMutation(`recipe-${recipeId}`, async () => {
      const result = await this.api.swipe(recipeId, action);
      if (!this.isCurrentSession(context)) return;
      const message = action === 'like' ? 'Добавлено в избранное' : 'Скрыто до завтра';
      this.state.lastSwipe = result?.undo_token ? {recipeId, token: result.undo_token, message} : null;
      await Promise.all([
        this.loadFeed(false),
        action === 'like' ? this.loadFavorites(false) : undefined,
      ]);
      if (!this.isCurrentSession(context)) return;
      completed = true;
      if (this.state.view !== 'feed' || !this.state.lastSwipe) this.toast(message);
    });
    if (completed && this.isCurrentSession(context)) this.focusUndo();
  }

  focusUndo() {
    if (this.state.view === 'feed') this.root.querySelector?.('[data-action="undo-swipe"]')?.focus();
  }

  async undoSwipe() {
    const swipe = this.state.lastSwipe;
    if (!swipe || this.state.busy) return;
    const context = this.sessionContext();
    if (!context.authenticated) {
      this.state.guestHidden.delete(swipe.recipeId);
      this.state.lastSwipe = null;
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
      this.state.lastSwipe = null;
      await Promise.all([this.loadFeed(false), this.loadFavorites(false)]);
      if (!this.isCurrentSession(context)) return;
      this.toast(message);
      completed = true;
    });
    if (completed && this.isCurrentSession(context)) this.focusFeedRecipe();
  }

  focusFeedRecipe() {
    if (this.state.view === 'feed') this.root.querySelector?.('.feature-recipe [data-action="recipe-detail"]')?.focus();
  }

  async toggleFavorite(recipeId) {
    if (!this.state.session.authenticated) return this.showAuth('Войдите, чтобы сохранять рецепты.');
    const shouldFavorite = !this.state.favoriteIds.has(recipeId);
    const context = this.sessionContext();
    await this.runMutation(`recipe-${recipeId}`, async () => {
      await this.api.setFavorite(recipeId, shouldFavorite);
      if (!this.isCurrentSession(context)) return;
      if (this.state.lastSwipe?.recipeId === recipeId) this.state.lastSwipe = null;
      await this.loadFavorites(false);
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
      && this.isCurrentSession(picker.session));
  }

  focusSlot({planId, dayIndex, mealType, session}) {
    if (this.state.view === 'plans' && this.editablePlanId() === planId && this.isCurrentSession(session)) {
      this.root.querySelector?.(`#pick-meal-${dayIndex}-${mealType}`)?.focus();
    }
  }

  openSlotPicker(planId, dayIndex, mealType) {
    if (this.state.busy || this.state.view !== 'plans' || planId !== this.editablePlanId()) return;
    const plan = this.state.activePlan;
    if (!Object.hasOwn(MEAL_LABELS, mealType) || !plan.enabled_meals.includes(mealType)
      || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.duration_days) return;
    const slot = slotFor(plan, dayIndex, mealType);
    const picker = {
      planId, dayIndex, mealType, slot, startDate: plan.start_date, query: '',
      recipes: compatibleFavorites(this.state.favorites, mealType),
      recipeId: slot?.recipe_id ?? null,
      session: this.sessionContext(),
    };
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
    const {dayIndex, mealType, planId, recipeId} = picker;
    if (recipeId !== picker.slot?.recipe_id && !picker.recipes.some(({id}) => id === recipeId)) return;
    const fields = this.dialog.querySelector('.picker-fields');
    const message = this.dialog.querySelector('[data-picker-error]');
    fields.disabled = true;
    message.hidden = true;
    const saved = await this.saveSlot(dayIndex, mealType, {recipe_id: recipeId, servings}, planId);
    fields.disabled = false;
    if (saved) {
      this.focusSlot(picker);
    } else if (this.isCurrentPicker(picker) && this.state.error) {
      message.textContent = apiErrorMessage(this.state.error);
      message.hidden = false;
      this.dialog.querySelector('button[type="submit"]').focus();
    }
  }

  async createPlan(payload) {
    const context = this.sessionContext();
    await this.runMutation('create-plan', async () => {
      const plan = await this.api.createPlan(payload);
      if (!this.isCurrentSession(context)) return;
      this.state.activePlanId = plan.id;
      this.state.shoppingPlanId = plan.id;
      this.invalidateShopping();
      await this.loadPlans(false);
      if (!this.isCurrentSession(context)) return;
      if (this.state.plansStatus === 'ready') await this.reloadVisibleShopping();
      this.toast('Рацион создан');
    });
  }

  async saveSlot(dayIndex, mealType, payload, targetPlanId = this.editablePlanId()) {
    const planId = this.editablePlanId();
    if (!planId || planId !== targetPlanId) return false;
    const context = this.sessionContext();
    const picker = this.slotPicker;
    let saved = false;
    await this.runMutation(`slot-${dayIndex}-${mealType}`, async () => {
      await this.api.putSlot(planId, dayIndex, mealType, payload);
      if (!this.isCurrentSession(context)) return;
      if (this.isCurrentPicker(picker)) this.dialog.close();
      saved = true;
      await this.refreshAfterSlotChange(planId);
      if (this.isCurrentSession(context)) this.toast('Блюдо сохранено');
    });
    return saved;
  }

  async deleteSlot(dayIndex, mealType, targetPlanId = this.editablePlanId()) {
    const planId = this.editablePlanId();
    if (!planId || planId !== targetPlanId) return;
    const context = this.sessionContext();
    await this.runMutation(`slot-${dayIndex}-${mealType}`, async () => {
      await this.api.deleteSlot(planId, dayIndex, mealType);
      if (!this.isCurrentSession(context)) return;
      await this.refreshAfterSlotChange(planId);
      this.toast('Блюдо удалено из рациона');
    });
  }

  async deletePlan() {
    const planId = this.editablePlanId();
    if (!planId || this.state.busy) return;
    const context = this.sessionContext();
    if (!globalThis.confirm('Удалить рацион и все блюда в нём?')) return;
    await this.runMutation('delete-plan', async () => {
      await this.api.deletePlan(planId);
      if (!this.isCurrentSession(context)) return;
      this.state.activePlanId = null;
      this.invalidateShopping();
      await this.loadPlans(false);
      if (!this.isCurrentSession(context)) return;
      if (this.state.plansStatus === 'ready') await this.reloadVisibleShopping();
      this.toast('Рацион удалён');
    });
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
    if (!globalThis.confirm('Снять все отметки о покупках в выбранном рационе?')) return;
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
