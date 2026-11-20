import {ApiClient} from './api-client.js';

export class RealApi {
  constructor(client = new ApiClient()) {
    this.client = client;
  }

  getSession() {
    return this.client.request('auth/session/');
  }

  getAccount() {
    return this.client.request('auth/account/');
  }

  updateAccount(payload) {
    return this.client.request('auth/account/', {method: 'PATCH', body: payload});
  }

  changeEmail(payload) {
    return this.client.request('auth/account/email/', {method: 'POST', body: payload});
  }

  register(payload) {
    return this.client.request('auth/register/', {method: 'POST', body: payload});
  }

  async login(payload) {
    await this.client.request('auth/login/', {method: 'POST', body: payload});
    return this.getSession();
  }

  async logout() {
    await this.client.request('auth/logout/', {method: 'POST', body: {}});
    return {authenticated: false, id: null, email: null};
  }

  async collectAll(path) {
    const results = [];
    const visited = new Set();
    let next = path;
    let first = true;
    while (next) {
      const requestPath = first ? path : next;
      const page = await this.client.request(requestPath, first ? {query: {limit: 100, offset: 0}} : {});
      results.push(...(page.results || []));
      next = page.next;
      first = false;
      if (next && visited.has(next)) throw new Error('Pagination returned the same page twice.');
      if (next) visited.add(next);
    }
    return results;
  }

  getFeed() {
    return this.client.request('preferences/feed/', {query: {limit: 30, offset: 0}});
  }

  getRecipes() {
    return this.collectAll('recipes/');
  }

  getRecipe(recipeId) {
    return this.client.request(`recipes/${recipeId}/`);
  }

  swipe(recipeId, action) {
    return this.client.request('preferences/swipes/', {
      method: 'POST',
      body: {recipe_id: recipeId, action},
    });
  }

  undoSwipe(token) {
    return this.client.request('preferences/swipes/undo/', {
      method: 'POST',
      body: {undo_token: token},
    });
  }

  setFavorite(recipeId, isFavorite) {
    return this.client.request(`preferences/favorites/${recipeId}/`, {
      method: 'PUT',
      body: {is_favorite: isFavorite},
    });
  }

  getFavorites() {
    return this.collectAll('preferences/favorites/');
  }

  getPlans() {
    return this.collectAll('meal-plans/');
  }

  createPlan(payload) {
    return this.client.request('meal-plans/', {method: 'POST', body: payload});
  }

  updatePlan(planId, payload) {
    return this.client.request(`meal-plans/${planId}/`, {method: 'PUT', body: payload});
  }

  getPlan(planId) {
    return this.client.request(`meal-plans/${planId}/`);
  }

  deletePlan(planId) {
    return this.client.request(`meal-plans/${planId}/`, {method: 'DELETE'});
  }

  putSlot(planId, dayIndex, mealType, payload) {
    return this.client.request(`meal-plans/${planId}/slots/${dayIndex}/${mealType}/`, {
      method: 'PUT',
      body: payload,
    });
  }

  deleteSlot(planId, dayIndex, mealType) {
    return this.client.request(`meal-plans/${planId}/slots/${dayIndex}/${mealType}/`, {
      method: 'DELETE',
    });
  }

  getShoppingList(planId) {
    return this.client.request('shopping-list/', {query: {plan_id: planId}});
  }

  setPurchased(planId, ingredientId, payload) {
    return this.client.request(`shopping-list/${planId}/purchases/${ingredientId}/`, {
      method: 'PUT',
      body: payload,
    });
  }

  clearPurchases(planId) {
    return this.client.request(`shopping-list/${planId}/purchases/`, {method: 'DELETE'});
  }

  downloadShoppingList(planId, fileType) {
    return this.client.request('shopping-list/export/', {
      query: {plan_id: planId, file_type: fileType},
      responseType: 'blob',
    });
  }
}
