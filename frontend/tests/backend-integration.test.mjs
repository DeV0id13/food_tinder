import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {FoodTinderApp} from '../src/app.js';
import {ApiClient} from '../src/api/api-client.js';
import {RealApi} from '../src/api/real-api.js';

// Explicit live check: run against the local Vite proxy and a development database only.
const origin = process.env.FOODTINDER_ORIGIN || 'http://localhost:5173';
const address = new URL(origin);
if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) {
  throw new Error('The integration check only supports a local development server.');
}

function browserApi() {
  const cookies = new Map();
  const cookieReader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const fetchImpl = async (path, options) => {
    const headers = new Headers(options.headers);
    if (cookies.size) headers.set('Cookie', cookieReader());
    headers.set('Origin', address.origin);
    const response = await fetch(new URL(path, address.origin), {...options, headers});
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    return response;
  };
  return new RealApi(new ApiClient({fetchImpl, cookieReader}));
}

test('real proxy persists favorites and plans across independent sessions and exports shopping', async () => {
  const api = browserApi();
  const otherBrowser = browserApi();
  const unrelated = browserApi();
  const account = {
    email: `ft06-smoke-${randomUUID()}@example.test`,
    password: `LocalCheck_9${randomUUID().replaceAll('-', '')}`,
  };
  const planIds = [];
  let recipe;
  let authenticated = false;
  try {
    assert.equal((await api.getSession()).authenticated, false);
    const {results: recipes} = await api.getRecipes();
    assert.ok(recipes.length, 'Import reviewed recipes or create them in Django Admin before this check.');
    recipe = recipes[0];
    const detail = await api.getRecipe(recipe.id);
    assert.ok(detail.ingredients.length);
    await api.register({...account, first_name: 'Тест'});
    assert.equal((await api.getSession()).authenticated, false, 'Registration must not log in.');
    assert.equal((await api.login(account)).authenticated, true);
    authenticated = true;
    await api.setFavorite(recipe.id, true);
    assert.ok((await api.getFavorites()).some(({id}) => id === recipe.id));
    assert.ok((await api.getFeed()).results.some(({id}) => id === recipe.id));
    await api.swipe(recipe.id, 'like');
    assert.ok(!(await api.getFeed()).results.some(({id}) => id === recipe.id));
    const meal = recipe.meal_types[0];
    const replacement = recipes.find(({id, meal_types}) =>
      id !== recipe.id && meal_types.includes(meal));
    assert.ok(replacement, 'The integration check needs another recipe for the same meal.');
    await api.swipe(replacement.id, 'dislike');
    assert.ok(!(await api.getFeed()).results.some(({id}) => id === replacement.id));

    for (const duration_days of [1, 3, 7]) {
      const plan = await api.createPlan({
        start_date: '2026-11-19', duration_days, enabled_meals: [recipe.meal_types[0]],
      });
      planIds.push(plan.id);
    }
    const planId = planIds[0];
    await api.putSlot(planId, 0, recipe.meal_types[0], {recipe_id: recipe.id, servings: 2});
    const shopping = await api.getShoppingList(planId);
    assert.ok(shopping.items.length);
    await api.putSlot(planId, 0, recipe.meal_types[0], {recipe_id: recipe.id, servings: 4});
    const updated = await api.getShoppingList(planId);
    assert.notDeepEqual(updated.items, shopping.items, 'Servings must change server quantities.');
    for (const type of ['csv', 'txt']) {
      const file = await api.downloadShoppingList(planId, type);
      assert.equal(file.filename, `shopping-list-${planId}.${type}`);
      const text = await file.blob.text();
      assert.ok(text.includes(updated.items[0].quantity));
    }

    assert.equal((await otherBrowser.getSession()).authenticated, false);
    await assert.rejects(otherBrowser.getPlan(planId), {status: 403});
    await otherBrowser.login(account);
    assert.ok((await otherBrowser.getFavorites()).some(({id}) => id === recipe.id));
    assert.equal((await otherBrowser.getPlans()).length, 3);
    assert.equal((await otherBrowser.getPlan(planId)).slots[0].servings, 4);
    assert.deepEqual(await otherBrowser.getShoppingList(planId), updated);

    const unrelatedAccount = {...account, email: `ft06-other-${randomUUID()}@example.test`};
    await unrelated.register({...unrelatedAccount, first_name: 'Другой'});
    await unrelated.login(unrelatedAccount);
    assert.deepEqual(await unrelated.getFavorites(), []);
    assert.deepEqual(await unrelated.getPlans(), []);
    await assert.rejects(unrelated.getPlan(planId), {status: 404});
    await unrelated.logout();

    await api.setFavorite(replacement.id, true);
    try {
      await api.putSlot(planId, 0, meal, {recipe_id: replacement.id, servings: 4});
      assert.equal((await otherBrowser.getPlan(planId)).slots[0].recipe_id, replacement.id);
      await api.putSlot(planId, 0, meal, {recipe_id: recipe.id, servings: 4});
    } finally {
      await api.setFavorite(replacement.id, false);
    }
    await api.setFavorite(recipe.id, false);
    await api.putSlot(planId, 0, recipe.meal_types[0], {recipe_id: recipe.id, servings: 3});
    assert.equal((await otherBrowser.getPlan(planId)).slots[0].servings, 3);
    await api.deleteSlot(planId, 0, recipe.meal_types[0]);
    assert.deepEqual((await api.getShoppingList(planId)).items, []);
  } finally {
    // Delete only plans created by this check; leave existing development data alone.
    for (const id of planIds) await api.deletePlan(id);
    if (authenticated) {
      if (recipe) await api.setFavorite(recipe.id, false);
      await api.logout();
      await otherBrowser.logout();
    }
  }
  assert.equal((await api.getSession()).authenticated, false);
  await assert.rejects(api.getPlans(), {status: 403});
});

test('the editor keeps drops local on leave and only saves the accepted draft to PostgreSQL', async () => {
  const api = browserApi();
  const otherBrowser = browserApi();
  const account = {email: `ft12-smoke-${randomUUID()}@example.test`, password: `LocalCheck_9${randomUUID().replaceAll('-', '')}`};
  await api.register({...account, first_name: 'Редактор'});
  await api.login(account);
  await otherBrowser.login(account);
  let id;
  try {
    const {results: [recipe]} = await api.getRecipes();
    const meal = recipe.meal_types[0];
    await api.setFavorite(recipe.id, true);
    ({id} = await api.createPlan({
      start_date: '2027-04-05', duration_days: 3, enabled_meals: [meal],
    }));
    const element = () => ({addEventListener() {}, innerHTML: ''});
    const app = new FoodTinderApp({
      root: element(), toast: element(), api, dialog: {
        ...element(), open: false,
        showModal() { this.open = true; },
        close() { this.open = false; },
      },
    });
    app.toast = () => {};
    await app.start();
    await app.plans.openPlanEditor('edit', id);
    const favorite = {type: 'favorite', recipe_id: recipe.id};
    const day = (day_index) => ({day_index, meal_type: meal});
    app.state.planDraft.generationServings = 4;
    assert.equal(app.plans.applyTransfer(app.plans.transferSource(favorite), day(0)).result, 'added');
    const source = {type: 'slot', recipe_id: recipe.id, ...day(0)};
    assert.equal(app.plans.applyTransfer(app.plans.transferSource(source), day(1)).result, 'moved');
    await app.navigation.navigate('shopping');
    assert.equal(app.dialog.open, true);
    await app.navigation.resolveNavigationDecision(false);
    assert.equal(app.state.shoppingPlanId, id);
    assert.deepEqual((await otherBrowser.getPlan(id)).slots, []);
    assert.deepEqual((await otherBrowser.getShoppingList(id)).items, []);
    await app.plans.openPlanEditor('edit', id);
    assert.equal(app.state.restoredDraft, true);
    assert.equal(app.state.planDraft.plan.slots[0].servings, 4);
    await app.navigation.navigate('shopping');
    await app.navigation.resolveNavigationDecision(true);
    assert.equal(app.state.view, 'shopping');
    assert.equal(app.state.shoppingPlanId, id);
    const record = (await otherBrowser.getPlan(id)).slots[0];
    assert.equal(record.recipe_id, recipe.id);
    assert.equal(record.day_index, 1);
    assert.equal(record.servings, 4);
    assert.ok(app.state.shopping.items.length);
  } finally {
    if (id) await api.deletePlan(id);
    await api.logout();
    await otherBrowser.logout();
  }
});
