import {renderRecipeDetail} from '../components/recipe-card.js';
import {CATALOG_PAGE_SIZE} from '../constants.js';
import {setFavorites} from '../state/state.js';
import {renderStatus} from '../utils/dom.js';
import {UNDO_WINDOW_MS} from '../utils/swipe-notice.js';
import {favoriteSearchCount, renderFavoriteResults} from '../views/favorites-view.js';
import {catalogSearchCount, renderCatalogResults} from '../views/recipes-view.js';

export class RecipesController {
  constructor(app) {
    this.app = app;
    this.browser = app.browser;
    this.dialog = app.dialog;
    this.root = app.root;
    this.state = app.state;
    this.swipeTimer = null;
    this.catalogTimer = null;
    this.catalogAbort = null;
    this.browser?.document?.addEventListener('visibilitychange', () => this.updateSwipeNotice());
  }

  clearSwipeNotice() {
    clearTimeout(this.swipeTimer);
    this.swipeTimer = null;
    this.state.lastSwipe = null;
  }

  expireSwipeNotice() {
    if (this.state.lastSwipe?.deadline > this.app.now()) return;
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
    const remaining = this.state.lastSwipe.deadline - this.app.now();
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

  async loadFeed(shouldRender = true) {
    const request = this.app.beginRequest('feed');
    const current = () => this.app.isCurrentRequest('feed', request);
    this.state.feedStatus = 'loading';
    if (shouldRender) this.app.render();
    try {
      const feed = await this.app.api.getFeed();
      if (!current()) return;
      this.state.feed = feed;
      this.state.feedStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.feedStatus = 'error';
      await this.app.handleError(error, current);
    }
    if (shouldRender && current()) this.app.render();
  }

  invalidateCatalog() {
    clearTimeout(this.catalogTimer);
    this.catalogAbort?.abort();
    this.catalogAbort = null;
  }

  paintCatalog() {
    const results = this.root.querySelector?.('[data-catalog-results]');
    if (results) results.innerHTML = renderCatalogResults(this.state);
    const count = this.root.querySelector?.('[data-catalog-count]');
    if (count) count.textContent = catalogSearchCount(this.state);
  }

  changeCatalogFilters({debounce = false} = {}) {
    this.state.catalogOffset = 0;
    this.app.navigation.writeRoute(true);
    if (!debounce) return this.loadCatalog();
    this.invalidateCatalog();
    this.state.catalogStatus = 'loading';
    this.paintCatalog();
    this.catalogTimer = setTimeout(() => this.loadCatalog(), 250);
  }

  async changeCatalogPage(offset) {
    this.state.catalogOffset = offset;
    this.app.navigation.writeRoute();
    await this.loadCatalog();
    if (this.state.view === 'recipes' && this.state.catalogOffset === offset) {
      this.root.querySelector?.('[data-catalog-results]')?.focus?.();
    }
  }

  async loadCatalog() {
    this.invalidateCatalog();
    const abort = new AbortController();
    this.catalogAbort = abort;
    const request = this.app.beginRequest('catalog');
    const current = () => !abort.signal.aborted && this.app.isCurrentRequest('catalog', request);
    const state = this.state;
    state.catalogStatus = 'loading';
    this.paintCatalog();
    try {
      const page = await this.app.api.getRecipes({
        query: state.catalogQuery.trim(), meal: state.catalogMeal, maxTime: state.catalogMaxTime,
        favorites: state.session.authenticated && state.catalogFavoritesOnly, sort: state.catalogSort,
        offset: state.catalogOffset, signal: abort.signal,
      });
      if (!current()) return;
      if (!page.results.length && state.catalogOffset >= page.count && state.catalogOffset) {
        state.catalogOffset = Math.floor(Math.max(0, page.count - 1) / CATALOG_PAGE_SIZE) * CATALOG_PAGE_SIZE;
        this.app.navigation.writeRoute(true);
        return this.loadCatalog();
      }
      state.catalog = page;
      state.catalogStatus = 'ready';
    } catch {
      if (!current()) return;
      state.catalogStatus = 'error';
    }
    this.paintCatalog();
  }

  async loadFavorites(shouldRender = true) {
    if (!this.state.session.authenticated) return;
    const request = this.app.beginRequest('favorites');
    const current = () => this.app.isCurrentRequest('favorites', request);
    this.state.favoritesStatus = 'loading';
    if (shouldRender) this.app.render();
    try {
      const favorites = await this.app.api.getFavorites();
      if (!current()) return;
      setFavorites(this.state, favorites);
      this.state.favoritesStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.favoritesStatus = 'error';
      await this.app.handleError(error, current);
    }
    if (shouldRender && current()) this.app.render();
  }

  updateFavoriteResults() {
    this.app.navigation.writeRoute(true);
    const results = this.root.querySelector('[data-favorites-results]');
    if (results) results.innerHTML = renderFavoriteResults(this.state);
    const count = this.root.querySelector('[data-favorites-count]');
    if (count) count.textContent = favoriteSearchCount(this.state);
  }

  async swipe(recipeId, action) {
    if (this.state.busy) return;
    const context = this.app.account.sessionContext();
    if (!this.state.session.authenticated) {
      if (action === 'dislike') {
        this.state.guestHidden.add(recipeId);
        this.state.lastSwipe = {recipeId, message: 'Скрыто до перезагрузки', deadline: this.app.now() + UNDO_WINDOW_MS};
        this.app.render();
        this.focusUndo();
        return;
      }
      return this.app.account.showAuth('Войдите, чтобы оценивать рецепты.');
    }
    let succeeded = false;
    await this.app.runMutation(`recipe-${recipeId}`, async () => {
      const result = await this.app.api.swipe(recipeId, action);
      if (!this.app.account.isCurrentSession(context)) return;
      const message = action === 'like' ? 'Добавлено в избранное' : 'Скрыто до завтра';
      const remaining = result?.undo_remaining_ms ?? UNDO_WINDOW_MS;
      const deadline = this.app.now() + Math.min(UNDO_WINDOW_MS, remaining);
      this.state.lastSwipe = result?.undo_token ? {recipeId, token: result.undo_token, message, deadline} : null;
      if (this.state.feed) {
        this.state.feed = {...this.state.feed, results: this.state.feed.results.filter(({id}) => id !== recipeId)};
      }
      succeeded = true;
      if (!this.state.lastSwipe) this.app.toast(message);
    });
    if (!succeeded || !this.app.account.isCurrentSession(context)) return;
    this.focusUndo();
    await Promise.all([
      this.loadFeed(false),
      action === 'like' ? this.loadFavorites(false) : undefined,
    ]);
    if (this.app.account.isCurrentSession(context) && !this.state.busy && this.state.view === 'feed') {
      const focusedUndo = this.browser?.document?.activeElement?.dataset?.action === 'undo-swipe';
      this.app.render();
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
    const context = this.app.account.sessionContext();
    if (!context.authenticated) {
      this.state.guestHidden.delete(swipe.recipeId);
      this.clearSwipeNotice();
      this.app.render();
      this.app.toast('Действие отменено');
      this.focusFeedRecipe();
      return;
    }
    let completed = false;
    await this.app.runMutation('undo-swipe', async () => {
      let message = 'Действие отменено';
      try {
        await this.app.api.undoSwipe(swipe.token);
      } catch (error) {
        if (error.status !== 409) throw error;
        message = 'Это действие уже нельзя отменить';
      }
      if (!this.app.account.isCurrentSession(context)) return;
      this.clearSwipeNotice();
      await Promise.all([this.loadFeed(false), this.loadFavorites(false)]);
      if (!this.app.account.isCurrentSession(context)) return;
      this.app.toast(message);
      completed = true;
    });
    if (completed && this.app.account.isCurrentSession(context)) this.focusFeedRecipe();
  }

  focusFeedRecipe() {
    const recipe = this.state.view === 'feed'
      && this.root.querySelector?.('.feature-recipe [data-action="recipe-detail"]');
    if (recipe) recipe.focus();
    return Boolean(recipe);
  }

  async toggleFavorite(recipeId) {
    if (!this.state.session.authenticated) return this.app.account.showAuth('Войдите, чтобы сохранять рецепты.');
    const inFilteredCatalog = this.state.view === 'recipes' && this.state.catalogFavoritesOnly;
    const shouldFavorite = !inFilteredCatalog && !this.state.favoriteIds.has(recipeId);
    const context = this.app.account.sessionContext();
    await this.app.runMutation(`recipe-${recipeId}`, async () => {
      await this.app.api.setFavorite(recipeId, shouldFavorite);
      if (!this.app.account.isCurrentSession(context)) return;
      if (this.state.lastSwipe?.recipeId === recipeId) this.clearSwipeNotice();
      if (!shouldFavorite && this.state.favoritesStatus === 'ready') {
        this.app.beginRequest('favorites');
        setFavorites(this.state, this.state.favorites.filter(({id}) => id !== recipeId));
      } else {
        await this.loadFavorites(false);
      }
      if (this.state.view === 'recipes' && this.state.catalogFavoritesOnly) await this.loadCatalog();
      if (this.app.account.isCurrentSession(context)) this.app.toast(shouldFavorite ? 'Добавлено в избранное' : 'Удалено из избранного');
    });
  }

  async openRecipeDetail(recipeId) {
    this.app.plans.slotPicker = null;
    const request = this.app.beginRequest('recipe-detail');
    const current = () => this.dialog.open
      && this.app.requestVersions.get('recipe-detail') === request.version;
    this.dialog.innerHTML = renderStatus({kind: 'loading', title: 'Загружаем рецепт'});
    if (!this.dialog.open) this.dialog.showModal();
    try {
      const recipe = await this.app.api.getRecipe(recipeId);
      if (current()) this.dialog.innerHTML = renderRecipeDetail(recipe);
    } catch (error) {
      if (!current()) return;
      await this.app.handleError(error, () => current() && this.app.account.isCurrentSession(request.session));
      if (!current()) return;
      this.dialog.innerHTML = `${renderStatus({kind: 'error', title: 'Рецепт не загрузился', text: 'Закройте окно и попробуйте снова.'})}<button class="button button-secondary" data-action="close-dialog">Закрыть</button>`;
      this.app.render();
    }
  }
}
