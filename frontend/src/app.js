import {ApiError} from './api/errors.js';
import {renderRecipeDetail} from './components/recipe-card.js';
import {clearPrivateState, createInitialState, setFavorites} from './state/state.js';
import {renderStatus} from './utils/dom.js';
import {saveBlob} from './utils/download.js';
import {invalidateShopping} from './utils/plans.js';
import {renderShell} from './views/shell.js';

export class FoodTinderApp {
  constructor({root, dialog, toast, api, mode}) {
    this.root = root;
    this.dialog = dialog;
    this.toastElement = toast;
    this.api = api;
    this.state = createInitialState(mode);
    this.sessionGeneration = 0;
    this.requestVersions = new Map();
    this.toastTimer = null;
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('submit', (event) => this.onSubmit(event));
    this.root.addEventListener('change', (event) => this.onChange(event));
    this.dialog.addEventListener('click', (event) => this.onClick(event));
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
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
    if (reset || session.id !== this.state.session.id
      || session.authenticated !== this.state.session.authenticated) {
      this.sessionGeneration += 1;
      clearPrivateState(this.state);
      this.state.feed = null;
      this.state.feedStatus = 'idle';
      this.state.guestHidden = new Set();
    }
    this.state.session = session;
    this.state.sessionKnown = true;
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
    this.render();
    const context = this.sessionContext();
    try {
      try {
        const session = await this.api.getSession();
        if (this.isCurrentSession(context)) this.setSession(session);
      } catch (error) {
        await this.handleError(error, () => this.isCurrentSession(context));
      }

      // Feed is public and must get its own state even when session initialization fails.
      await this.loadFeed(false);
      if (this.state.sessionKnown && this.state.session.authenticated) {
        await this.loadFavorites(false);
      }
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
        // Keep the original actionable error; never switch to demo automatically.
      }
    }
    return normalized;
  }

  async runMutation(key, operation) {
    if (this.state.busy) return;
    const context = this.sessionContext();
    this.state.busy = key;
    this.state.error = null;
    this.render();
    try {
      await operation();
    } catch (error) {
      await this.handleError(error, () => this.isCurrentSession(context));
    } finally {
      this.state.busy = null;
      this.render();
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
    this.state.view = 'auth';
    this.state.authTab = 'login';
    this.state.authNotice = message || 'Войдите, чтобы сохранить это действие.';
    this.render();
  }

  async navigate(view) {
    this.state.view = view;
    this.state.error = null;
    this.render();
    if (view === 'feed') await this.loadFeed();
    if (view === 'recipes' && !this.state.catalog) await this.loadCatalog();
    if (view === 'favorites' && this.state.session.authenticated) await this.loadFavorites();
    if (view === 'plans' && this.state.session.authenticated) {
      await Promise.all([
        this.loadFavorites(false),
        this.loadPlans(false),
      ]);
      this.render();
    }
    if (view === 'shopping' && this.state.session.authenticated) {
      if (!this.state.plans) await this.loadPlans(false);
      if (this.state.plans?.length) await this.loadShopping(false);
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
    if (action === 'retry-favorites') return this.loadFavorites();
    if (action === 'retry-plans') return this.loadPlans();
    if (action === 'retry-active-plan') return this.loadActivePlan();
    if (action === 'retry-shopping' || action === 'refresh-shopping') return this.loadShopping();
    if (action === 'close-dialog') return this.dialog.close();
    if (action === 'recipe-detail') return this.openRecipeDetail(Number(control.dataset.recipeId));
    if (action === 'toggle-favorite') return this.toggleFavorite(Number(control.dataset.recipeId));
    if (action === 'swipe') return this.swipe(Number(control.dataset.recipeId), control.dataset.swipe);
    if (action === 'logout') return this.logout();
    if (action === 'delete-slot') return this.deleteSlot(Number(control.dataset.dayIndex), control.dataset.mealType);
    if (action === 'delete-plan') return this.deletePlan();
    if (action === 'export-shopping') return this.exportShopping(control.dataset.fileType);
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
    if (form.dataset.form === 'slot') {
      return this.saveSlot(
        Number(form.dataset.dayIndex),
        form.dataset.mealType,
        {recipe_id: Number(data.get('recipe_id')), servings: Number(data.get('servings'))},
      );
    }
  }

  async onChange(event) {
    if (this.state.busy) return;
    if (event.target.dataset.change === 'active-plan') {
      this.state.error = null;
      this.state.activePlanId = Number(event.target.value);
      return this.loadActivePlan();
    }
    if (event.target.dataset.change === 'shopping-plan') {
      this.state.error = null;
      this.state.shoppingPlanId = Number(event.target.value);
      return this.loadShopping();
    }
  }

  async login(payload) {
    await this.runMutation('auth', async () => {
      this.setSession(await this.api.login(payload), true);
      this.state.authNotice = null;
      await Promise.all([this.loadFavorites(false), this.loadFeed(false)]);
      this.state.view = 'feed';
      this.toast('Вход выполнен');
    });
  }

  async register(payload) {
    await this.runMutation('auth', async () => {
      const account = await this.api.register(payload);
      this.state.registeredEmail = account.email;
      this.state.authTab = 'login';
      this.state.authNotice = 'Аккаунт создан. Теперь войдите — регистрация не открывает сессию автоматически.';
      this.toast('Регистрация завершена');
    });
  }

  async logout() {
    await this.runMutation('auth', async () => {
      await this.api.logout();
      this.setSession({authenticated: false, id: null, email: null}, true);
      this.state.view = 'feed';
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
    if (!this.state.session.authenticated) {
      if (action === 'dislike') {
        this.state.guestHidden.add(recipeId);
        this.toast('Скрыто только до перезагрузки');
        return this.render();
      }
      return this.showAuth('Чтобы поставить «Нравится», войдите в аккаунт.');
    }
    await this.runMutation(`recipe-${recipeId}`, async () => {
      await this.api.swipe(recipeId, action);
      await this.loadFeed(false);
      this.toast(action === 'like' ? 'Лайк сохранён' : 'Рецепт скрыт до завтра');
    });
  }

  async toggleFavorite(recipeId) {
    if (!this.state.session.authenticated) return this.showAuth('Чтобы менять избранное, войдите в аккаунт.');
    const shouldFavorite = !this.state.favoriteIds.has(recipeId);
    await this.runMutation(`recipe-${recipeId}`, async () => {
      await this.api.setFavorite(recipeId, shouldFavorite);
      await this.loadFavorites(false);
      this.toast(shouldFavorite ? 'Добавлено в избранное' : 'Удалено из избранного');
    });
  }

  async openRecipeDetail(recipeId) {
    this.dialog.innerHTML = renderStatus({kind: 'loading', title: 'Загружаем рецепт'});
    if (!this.dialog.open) this.dialog.showModal();
    try {
      const recipe = await this.api.getRecipe(recipeId);
      this.dialog.innerHTML = renderRecipeDetail(recipe);
    } catch (error) {
      await this.handleError(error);
      this.dialog.innerHTML = `${renderStatus({kind: 'error', title: 'Рецепт не загрузился', text: 'Закройте окно и попробуйте снова.'})}<button class="button button-secondary" data-action="close-dialog">Закрыть</button>`;
      this.render();
    }
  }

  async createPlan(payload) {
    const context = this.sessionContext();
    await this.runMutation('create-plan', async () => {
      const plan = await this.api.createPlan(payload);
      if (!this.isCurrentSession(context)) return;
      this.state.activePlanId = plan.id;
      this.state.shoppingPlanId = plan.id;
      await this.loadPlans(false);
      if (!this.isCurrentSession(context)) return;
      this.invalidateShopping();
      this.toast('Рацион создан');
    });
  }

  async saveSlot(dayIndex, mealType, payload) {
    const planId = this.editablePlanId();
    if (!planId) return;
    const context = this.sessionContext();
    await this.runMutation(`slot-${dayIndex}-${mealType}`, async () => {
      await this.api.putSlot(planId, dayIndex, mealType, payload);
      if (!this.isCurrentSession(context)) return;
      this.invalidateShopping();
      if (Number(this.state.activePlanId) === planId) await this.loadActivePlan(false);
      this.toast('Слот сохранён');
    });
  }

  async deleteSlot(dayIndex, mealType) {
    const planId = this.editablePlanId();
    if (!planId) return;
    const context = this.sessionContext();
    await this.runMutation(`slot-${dayIndex}-${mealType}`, async () => {
      await this.api.deleteSlot(planId, dayIndex, mealType);
      if (!this.isCurrentSession(context)) return;
      this.invalidateShopping();
      if (Number(this.state.activePlanId) === planId) await this.loadActivePlan(false);
      this.toast('Слот удалён');
    });
  }

  async deletePlan() {
    const planId = this.editablePlanId();
    if (!planId || this.state.busy) return;
    const context = this.sessionContext();
    if (!globalThis.confirm('Удалить выбранный рацион и все его слоты?')) return;
    await this.runMutation('delete-plan', async () => {
      await this.api.deletePlan(planId);
      if (!this.isCurrentSession(context)) return;
      this.state.activePlanId = null;
      this.invalidateShopping();
      await this.loadPlans(false);
      this.toast('Рацион удалён');
    });
  }

  async exportShopping(fileType) {
    const planId = Number(this.state.shoppingPlanId);
    if (!this.state.session.authenticated || this.state.shoppingStatus !== 'ready'
      || this.state.shopping?.plan_id !== planId) return;
    const context = this.sessionContext();
    await this.runMutation(`export-${fileType}`, async () => {
      const file = await this.api.downloadShoppingList(planId, fileType);
      if (!this.isCurrentSession(context) || Number(this.state.shoppingPlanId) !== planId) return;
      saveBlob(file);
      this.toast(`Файл ${fileType.toUpperCase()} получен с backend`);
    });
  }
}
