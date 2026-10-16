import {ApiError} from './api/errors.js';
import {renderRecipeDetail} from './components/recipe-card.js';
import {clearPrivateState, createInitialState, setFavorites} from './state/state.js';
import {escapeHtml, renderStatus} from './utils/dom.js';
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

  toast(message) {
    clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add('visible');
    this.toastTimer = setTimeout(() => this.toastElement.classList.remove('visible'), 3000);
  }

  async start() {
    this.render();
    try {
      try {
        this.state.session = await this.api.getSession();
        this.state.sessionKnown = true;
      } catch (error) {
        await this.handleError(error);
      }

      // Feed is public and must get its own state even when session initialization fails.
      await this.loadFeed(false);
      if (this.state.sessionKnown && this.state.session.authenticated) {
        await Promise.all([this.loadFavorites(false), this.loadPlans(false)]);
      }
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.state.initialLoading = false;
      this.render();
    }
  }

  async handleError(error) {
    const normalized = error instanceof ApiError
      ? error
      : new ApiError({type: 'http', details: String(error?.message || error)});
    this.state.error = normalized;
    if (normalized.type === 'auth') {
      try {
        const session = await this.api.getSession();
        this.state.session = session;
        this.state.sessionKnown = true;
        if (!session.authenticated) clearPrivateState(this.state);
      } catch {
        // Keep the original actionable error; never switch to demo automatically.
      }
    }
    return normalized;
  }

  async runMutation(key, operation) {
    if (this.state.busy) return;
    this.state.busy = key;
    this.state.error = null;
    this.render();
    try {
      await operation();
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.state.busy = null;
      this.render();
    }
  }

  async loadFeed(shouldRender = true) {
    this.state.feedStatus = 'loading';
    if (shouldRender) this.render();
    try {
      this.state.feed = await this.api.getFeed();
      this.state.feedStatus = 'ready';
    } catch (error) {
      this.state.feedStatus = 'error';
      await this.handleError(error);
    }
    if (shouldRender) this.render();
  }

  async loadCatalog(shouldRender = true) {
    this.state.catalogStatus = 'loading';
    if (shouldRender) this.render();
    try {
      this.state.catalog = await this.api.getRecipes();
      this.state.catalogStatus = 'ready';
    } catch (error) {
      this.state.catalogStatus = 'error';
      await this.handleError(error);
    }
    if (shouldRender) this.render();
  }

  async loadFavorites(shouldRender = true) {
    if (!this.state.session.authenticated) return;
    this.state.favoritesStatus = 'loading';
    if (shouldRender) this.render();
    try {
      setFavorites(this.state, await this.api.getFavorites());
      this.state.favoritesStatus = 'ready';
    } catch (error) {
      this.state.favoritesStatus = 'error';
      await this.handleError(error);
    }
    if (shouldRender) this.render();
  }

  async loadPlans(shouldRender = true) {
    if (!this.state.session.authenticated) return;
    this.state.plansStatus = 'loading';
    if (shouldRender) this.render();
    try {
      this.state.plans = await this.api.getPlans();
      this.state.plansStatus = 'ready';
      if (!this.state.plans.length) {
        this.state.activePlanId = null;
        this.state.activePlan = null;
        this.state.activePlanStatus = 'idle';
        this.state.shoppingPlanId = null;
      } else {
        const ids = new Set(this.state.plans.map(({id}) => id));
        if (!ids.has(Number(this.state.activePlanId))) this.state.activePlanId = this.state.plans[0].id;
        if (!ids.has(Number(this.state.shoppingPlanId))) this.state.shoppingPlanId = this.state.activePlanId;
        await this.loadActivePlan(false);
      }
    } catch (error) {
      this.state.plansStatus = 'error';
      await this.handleError(error);
    }
    if (shouldRender) this.render();
  }

  async loadActivePlan(shouldRender = true) {
    if (!this.state.activePlanId) return;
    this.state.activePlanStatus = 'loading';
    if (shouldRender) this.render();
    try {
      this.state.activePlan = await this.api.getPlan(this.state.activePlanId);
      this.state.activePlanStatus = 'ready';
    } catch (error) {
      this.state.activePlanStatus = 'error';
      await this.handleError(error);
    }
    if (shouldRender) this.render();
  }

  async loadShopping(shouldRender = true) {
    if (!this.state.shoppingPlanId) return;
    this.state.shoppingStatus = 'loading';
    if (shouldRender) this.render();
    try {
      this.state.shopping = await this.api.getShoppingList(this.state.shoppingPlanId);
      this.state.shoppingStatus = 'ready';
    } catch (error) {
      this.state.shoppingStatus = 'error';
      await this.handleError(error);
    }
    if (shouldRender) this.render();
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
    if (event.target.dataset.change === 'active-plan') {
      this.state.activePlanId = Number(event.target.value);
      return this.loadActivePlan();
    }
    if (event.target.dataset.change === 'shopping-plan') {
      this.state.shoppingPlanId = Number(event.target.value);
      return this.loadShopping();
    }
  }

  async login(payload) {
    await this.runMutation('auth', async () => {
      this.state.session = await this.api.login(payload);
      this.state.sessionKnown = true;
      this.state.guestHidden = new Set();
      this.state.authNotice = null;
      await Promise.all([this.loadFavorites(false), this.loadPlans(false), this.loadFeed(false)]);
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
      this.state.session = await this.api.logout();
      clearPrivateState(this.state);
      this.state.view = 'feed';
      await this.loadFeed(false);
      this.toast('Вы вышли из аккаунта');
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
    await this.runMutation('create-plan', async () => {
      const plan = await this.api.createPlan(payload);
      this.state.activePlanId = plan.id;
      this.state.shoppingPlanId = plan.id;
      await this.loadPlans(false);
      this.state.activePlan = plan;
      this.state.activePlanStatus = 'ready';
      invalidateShopping(this.state);
      this.toast('Рацион создан');
    });
  }

  async saveSlot(dayIndex, mealType, payload) {
    await this.runMutation(`slot-${dayIndex}-${mealType}`, async () => {
      await this.api.putSlot(this.state.activePlanId, dayIndex, mealType, payload);
      await this.loadActivePlan(false);
      invalidateShopping(this.state);
      this.toast('Слот сохранён');
    });
  }

  async deleteSlot(dayIndex, mealType) {
    await this.runMutation(`slot-${dayIndex}-${mealType}`, async () => {
      await this.api.deleteSlot(this.state.activePlanId, dayIndex, mealType);
      await this.loadActivePlan(false);
      invalidateShopping(this.state);
      this.toast('Слот удалён');
    });
  }

  async deletePlan() {
    if (!globalThis.confirm('Удалить выбранный рацион и все его слоты?')) return;
    await this.runMutation('delete-plan', async () => {
      await this.api.deletePlan(this.state.activePlanId);
      this.state.activePlanId = null;
      invalidateShopping(this.state);
      await this.loadPlans(false);
      this.toast('Рацион удалён');
    });
  }

  async exportShopping(fileType) {
    await this.runMutation(`export-${fileType}`, async () => {
      const file = await this.api.downloadShoppingList(this.state.shoppingPlanId, fileType);
      saveBlob(file);
      this.toast(`Файл ${fileType.toUpperCase()} получен с backend`);
    });
  }
}
