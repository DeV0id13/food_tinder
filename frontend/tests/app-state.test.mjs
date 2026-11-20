import test from 'node:test';
import assert from 'node:assert/strict';
import {FoodTinderApp} from '../src/app.js';
import {ApiError} from '../src/api/errors.js';
import {RealApi} from '../src/api/real-api.js';
import {makePlanDraft} from '../src/utils/plans.js';
import {setFavorites} from '../src/state/state.js';

const userA = {authenticated: true, id: 1, email: 'a@example.com'};
const userB = {authenticated: true, id: 2, email: 'b@example.com'};
const guest = {authenticated: false, id: null, email: null};
const networkError = () => new ApiError({type: 'network'});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function savedPlan(id = 1, slots = []) {
  return {id, title: '', version: 1, start_date: '2026-11-20', duration_days: 3, enabled_meals: ['lunch'], slots};
}

function editSavedPlan(app, plan) {
  Object.assign(app.state, {
    view: 'plans', planMode: 'edit', activePlan: plan,
    activePlanId: plan.id, activePlanStatus: 'ready', planDraft: makePlanDraft(plan),
  });
}

function createApp(overrides = {}, browser) {
  const element = () => ({addEventListener() {}, innerHTML: ''});
  const dialog = Object.assign(new EventTarget(), {
    innerHTML: '',
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  });
  const api = {
    getFeed: async () => ({count: 0, results: []}),
    getFavorites: async () => [{id: 22}],
    getPlans: async () => [],
    getSession: async () => guest,
    logout: async () => guest,
    login: async () => userB,
    ...overrides,
  };
  const app = new FoodTinderApp({root: element(), dialog, toast: element(), api, browser});
  app.setSession(userA);
  app.messages = [];
  app.toast = (message) => app.messages.push(message);
  return app;
}

for (const resource of ['plan', 'shopping']) {
  for (const staleOutcome of ['success', 'network error', '403']) {
    test(`${resource}: ignore stale ${staleOutcome} when A → B resolves B → A`, async () => {
      const a = deferred();
      const b = deferred();
      let sessionReads = 0;
      const apiMethod = resource === 'plan' ? 'getPlan' : 'getShoppingList';
      const app = createApp({
        [apiMethod]: (id) => id === 1 ? a.promise : b.promise,
        getSession: async () => { sessionReads += 1; return guest; },
      });
      const select = async (id) => {
        if (resource === 'plan') {
          app.state.activePlanId = id;
          return app.loadActivePlan();
        }
        app.state.shoppingPlanId = id;
        return app.loadShopping();
      };
      const pendingA = select(1);
      const pendingB = select(2);
      const resultB = resource === 'plan'
        ? {id: 2, start_date: '2026-10-16', duration_days: 1, enabled_meals: ['lunch'], slots: []}
        : {plan_id: 2, items: [{name: 'Рис', quantity: '100.000', unit: 'g'}]};
      b.resolve(resultB);
      await pendingB;
      if (staleOutcome === 'success') a.resolve(resource === 'plan' ? {id: 1} : {plan_id: 1, items: []});
      else a.reject(staleOutcome === '403' ? new ApiError({type: 'auth', status: 403}) : networkError());
      await pendingA;
      assert.deepEqual(resource === 'plan' ? app.state.activePlan : app.state.shopping, resultB);
      assert.equal(resource === 'plan' ? app.state.activePlanStatus : app.state.shoppingStatus, 'ready');
      assert.equal(app.state.error, null);
      assert.equal(app.state.session.id, userA.id);
      assert.equal(sessionReads, 0, 'A stale 403 must not trigger session reconciliation');
    });
  }
}

test('a newer request for the same plan wins even when the selection ID has not changed', async () => {
  const old = deferred();
  let calls = 0;
  const app = createApp({getPlan: () => ++calls === 1 ? old.promise : Promise.resolve({id: 1, slots: ['new']})});
  app.state.activePlanId = 1;
  const first = app.loadActivePlan();
  await app.loadActivePlan();
  old.resolve({id: 1, slots: ['old']});
  await first;
  assert.deepEqual(app.state.activePlan.slots, ['new']);
});

test('plan save and shopping export refuse a mismatch between displayed and selected data', async () => {
  const calls = [];
  const app = createApp(Object.fromEntries(['updatePlan', 'createPlan', 'deletePlan', 'downloadShoppingList']
    .map((key) => [key, async (...args) => calls.push({key, args})])));
  editSavedPlan(app, savedPlan(1));
  app.state.activePlanId = 2;
  app.state.shoppingStatus = 'ready';
  app.state.shoppingPlanId = 2;
  app.state.shopping = {plan_id: 1, items: []};
  await app.savePlan();
  await app.deletePlan(2);
  await app.exportShopping('csv');
  assert.deepEqual(calls, []);
});

test('plan save is bound to the open editor and blocks duplicate saves or navigation', async () => {
  const save = deferred();
  const calls = [];
  const app = createApp({
    updatePlan: (id) => { calls.push(id); return save.promise; },
    getPlan: () => assert.fail('Changed editor before the save finished'),
  });
  editSavedPlan(app, savedPlan(1));
  const saving = app.savePlan();
  await app.savePlan();
  await app.openPlanEditor('edit', 2);
  assert.equal(app.state.activePlanId, 1);
  save.resolve({...savedPlan(1), version: 2});
  await saving;
  assert.deepEqual(calls, [1]);
  assert.equal(app.state.planDraft.plan.version, 2);
});

for (const outcome of ['success', 'error']) {
  test(`late favorites ${outcome} from A cannot overwrite B after logout → login`, async () => {
    const delayedA = deferred();
    let reads = 0;
    const app = createApp({getFavorites: () => ++reads === 1 ? delayedA.promise : Promise.resolve([{id: 22}])});
    const oldRequest = app.loadFavorites();
    await app.logout();
    await app.login({email: userB.email, password: 'TestPassword_1'});
    const snapshot = structuredClone(app.state);
    if (outcome === 'success') delayedA.resolve([{id: 11}]);
    else delayedA.reject(new ApiError({type: 'auth', status: 403}));
    await oldRequest;
    assert.deepEqual(app.state, snapshot);
    assert.equal(app.state.session.id, userB.id);
    assert.deepEqual([...app.state.favoriteIds], [22]);
  });
}

for (const resource of ['plans', 'activePlan', 'shopping', 'feed']) {
  test(`${resource}: responses from a previous session are discarded`, async () => {
    const old = deferred();
    const methods = {plans: 'getPlans', activePlan: 'getPlan', shopping: 'getShoppingList', feed: 'getFeed'};
    const loaders = {plans: 'loadPlans', activePlan: 'loadActivePlan', shopping: 'loadShopping', feed: 'loadFeed'};
    const app = createApp({[methods[resource]]: () => old.promise});
    app.state.activePlanId = 1;
    app.state.shoppingPlanId = 1;
    const loading = app[loaders[resource]]();
    app.setSession(guest, true);
    app.setSession(userB, true);
    const snapshot = structuredClone(app.state);
    old.resolve(resource === 'plans' ? [{id: 1}] : resource === 'feed' ? {results: [{id: 11}]} : {id: 1, plan_id: 1});
    await loading;
    assert.deepEqual(app.state, snapshot);
  });
}

test('re-login to the same user also invalidates old private requests', async () => {
  const old = deferred();
  const app = createApp({getFavorites: () => old.promise});
  const loading = app.loadFavorites();
  app.setSession(userA, true);
  setFavorites(app.state, [{id: 22}]);
  old.resolve([{id: 11}]);
  await loading;
  assert.deepEqual([...app.state.favoriteIds], [22]);
});

test('a delayed session check for an old 403 cannot clear a newer login', async () => {
  const session = deferred();
  const app = createApp({getSession: () => session.promise});
  const handling = app.handleError(new ApiError({type: 'auth', status: 403}));
  app.setSession(userB, true);
  session.resolve(guest);
  await handling;
  assert.equal(app.state.session.id, userB.id);
});

test('logout 204 clears private state even if the subsequent GET session fails', async () => {
  const calls = [];
  const client = {
    async request(path) {
      calls.push(path);
      if (path === 'auth/logout/') return null;
      if (path === 'auth/session/') throw networkError();
      return {results: []};
    },
  };
  const app = createApp();
  app.api = new RealApi(client);
  setFavorites(app.state, [{id: 11}]);
  app.state.plans = [{id: 1}];
  app.state.activePlan = {id: 1};
  app.state.shopping = {plan_id: 1, items: ['private']};
  await app.logout();
  assert.equal(app.state.session.authenticated, false);
  assert.equal(app.state.favorites, null);
  assert.equal(app.state.favoriteIds.size, 0);
  assert.equal(app.state.plans, null);
  assert.equal(app.state.activePlan, null);
  assert.equal(app.state.shopping, null);
  assert.equal(app.state.error.type, 'network');
  assert.ok(app.messages.includes('Вы вышли из аккаунта'));
  assert.deepEqual(calls.slice(0, 2), ['auth/logout/', 'auth/session/']);
});

test('a failed logout POST keeps the session and does not announce success', async () => {
  const app = createApp({logout: async () => { throw networkError(); }});
  setFavorites(app.state, [{id: 11}]);
  await app.logout();
  assert.equal(app.state.session.authenticated, true);
  assert.deepEqual([...app.state.favoriteIds], [11]);
  assert.equal(app.state.error.type, 'network');
  assert.deepEqual(app.messages, []);
});

test('logout clears private data immediately while optional session refresh is still pending', async () => {
  const refresh = deferred();
  const app = createApp({getSession: () => refresh.promise});
  setFavorites(app.state, [{id: 11}]);
  const logout = app.logout();
  await Promise.resolve();
  assert.equal(app.state.session.authenticated, false);
  assert.equal(app.state.favorites, null);
  assert.match(app.root.innerHTML, /data-action="navigate" data-view="auth"[^>]*>\s*Войти\s*<\/button>/);
  refresh.resolve(guest);
  await logout;
});

test('shopping invalidation also discards an already pending response for the same plan', async () => {
  const old = deferred();
  const app = createApp({getShoppingList: () => old.promise});
  app.state.shoppingPlanId = 1;
  const loading = app.loadShopping();
  app.invalidateShopping();
  old.resolve({plan_id: 1, items: ['outdated']});
  await loading;
  assert.equal(app.state.shopping, null);
  assert.equal(app.state.shoppingStatus, 'idle');
});

for (const plansAfter of [[savedPlan(2)], []]) {
  test(`deleting a plan invalidates an in-flight shopping read with ${plansAfter.length} plans remaining`, async () => {
    const mutation = deferred();
    const stale = deferred();
    const reads = [];
    const selected = plansAfter[0]?.id ?? null;
    const fresh = {plan_id: selected, items: [{name: 'Свежий список', quantity: '2', unit: 'pcs'}]};
    const app = createApp({
      deletePlan: () => mutation.promise,
      getPlans: async () => plansAfter,
      getShoppingList: (id) => {
        reads.push(id);
        return reads.length === 1 ? stale.promise : Promise.resolve(fresh);
      },
    });
    app.confirm = () => true;
    Object.assign(app.state, {
      initialLoading: false, view: 'plans', plans: [savedPlan(1), ...plansAfter],
      plansStatus: 'ready', shoppingPlanId: 1,
    });
    const deleting = app.deletePlan(1);
    const navigating = app.navigate('shopping');
    assert.deepEqual(reads, [1]);
    mutation.resolve();
    await deleting;
    stale.resolve({plan_id: 1, items: [{name: 'Старый список', quantity: '1', unit: 'pcs'}]});
    await navigating;
    assert.equal(app.state.shoppingPlanId, selected);
    assert.equal(app.state.error, null);
    if (selected === null) {
      assert.deepEqual(reads, [1]);
      assert.equal(app.state.shopping, null);
      assert.match(app.root.innerHTML, /Сначала создайте рацион/);
    } else {
      assert.deepEqual(reads, [1, selected]);
      assert.deepEqual(app.state.shopping, fresh);
      assert.match(app.root.innerHTML, /Свежий список/);
      assert.doesNotMatch(app.root.innerHTML, /Рассчитываем покупки|Старый список/);
    }
  });
}

for (const outcome of ['success', '403']) {
  test(`recipe detail ignores late ${outcome} after dismissal and reopening`, async () => {
    const a = deferred();
    const b = deferred();
    let sessionReads = 0;
    const app = createApp({
      getRecipe: (id) => id === 1 ? a.promise : b.promise,
      getSession: async () => { sessionReads += 1; return guest; },
    });
    const old = app.openRecipeDetail(1);
    app.dialog.close();
    const next = app.openRecipeDetail(2);
    app.dialog.dispatchEvent(new Event('close'));
    b.resolve({title: 'Новый рецепт'});
    await next;
    assert.match(app.dialog.innerHTML, /Новый рецепт/);
    if (outcome === 'success') a.resolve({title: 'Старый рецепт'});
    else a.reject(new ApiError({type: 'auth', status: 403}));
    await old;
    assert.match(app.dialog.innerHTML, /Новый рецепт/);
    assert.doesNotMatch(app.dialog.innerHTML, /Старый рецепт|Рецепт не загрузился/);
    assert.equal(app.state.error, null);
    assert.equal(app.state.session.id, userA.id);
    assert.equal(sessionReads, 0);
  });
}

test('plans 404 is kept with its resource and a successful retry clears only that error', async () => {
  let calls = 0;
  const missing = new ApiError({type: 'not_found', status: 404});
  const app = createApp({getPlans: async () => {
    if (++calls === 1) throw missing;
    return [];
  }});
  await app.loadPlans();
  assert.equal(app.state.plansError, missing);
  assert.equal(app.state.error, missing);
  assert.equal(app.state.plansStatus, 'error');
  await app.loadPlans();
  assert.equal(app.state.plansError, null);
  assert.equal(app.state.error, null);
  assert.equal(app.state.plansStatus, 'ready');
  assert.deepEqual(app.state.plans, []);
});

test('liking a recipe refreshes favorites in the frontend', async () => {
  const calls = [];
  const app = createApp({
    swipe: async (id, action) => { calls.push({id, action}); },
    getFavorites: async () => [{id: 11, title: 'Борщ'}],
  });
  await app.swipe(11, 'like');
  assert.deepEqual(calls, [{id: 11, action: 'like'}]);
  assert.deepEqual([...app.state.favoriteIds], [11]);
  assert.ok(app.messages.includes('Добавлено в избранное'));
});

test('catalog search updates results without rerendering the input', () => {
  const app = createApp();
  app.state.catalogStatus = 'ready';
  app.state.catalog = [
    {id: 1, title: 'Борщ с говядиной', meal_types: ['lunch'], cooking_time_minutes: 60, difficulty: 2},
    {id: 2, title: 'Омлет с сыром', meal_types: ['breakfast'], cooking_time_minutes: 15, difficulty: 1},
  ];
  const results = {innerHTML: ''};
  const count = {textContent: ''};
  app.root.querySelector = (selector) => ({
    '[data-catalog-results]': results,
    '[data-catalog-count]': count,
  })[selector];
  app.onInput({target: {dataset: {input: 'recipe-search'}, value: 'омлет'}});
  assert.equal(app.state.catalogQuery, 'омлет');
  assert.match(results.innerHTML, /Омлет с сыром/);
  assert.doesNotMatch(results.innerHTML, /Борщ с говядиной/);
  assert.equal(count.textContent, 'Найдено: 1 из 2');
  assert.match(app.root.innerHTML, /^$/);
});

test('catalog combines all filters, preserves them on navigation and drops private filters on user change', async () => {
  const app = createApp();
  app.state.catalogStatus = 'ready';
  app.state.catalog = [
    {id: 1, title: 'Суп с копчёностями', meal_types: ['lunch', 'dinner'], cooking_time_minutes: 60},
    {id: 2, title: 'Суп с грибами', meal_types: ['lunch'], cooking_time_minutes: 70},
    {id: 3, title: 'Суп-пюре', meal_types: ['dinner'], cooking_time_minutes: 25},
    {id: 4, title: 'Суп с фасолью', meal_types: ['lunch'], cooking_time_minutes: 30},
  ];
  app.state.favoritesStatus = 'ready';
  setFavorites(app.state, app.state.catalog.slice(0, 3));
  const results = {innerHTML: ''};
  const count = {textContent: ''};
  app.root.querySelector = (selector) => ({
    '[data-catalog-results]': results,
    '[data-catalog-count]': count,
  })[selector];
  app.onInput({target: {dataset: {input: 'recipe-search'}, value: '  СУП  '}});
  await app.onChange({target: {dataset: {change: 'catalog-meal'}, value: 'lunch'}});
  await app.onChange({target: {dataset: {change: 'catalog-time'}, value: '60'}});
  await app.onChange({target: {dataset: {change: 'catalog-favorites'}, checked: true}});
  assert.match(results.innerHTML, /Суп с копчёностями/);
  assert.doesNotMatch(results.innerHTML, /Суп с грибами|Суп-пюре|Суп с фасолью/);
  assert.equal(count.textContent, 'Найдено: 1 из 4');
  await app.navigate('feed');
  await app.navigate('recipes');
  assert.equal(app.state.catalogFavoritesOnly, true);
  app.setSession(userB);
  assert.equal(app.state.catalogFavoritesOnly, false);
  assert.equal(app.state.favoriteIds.size, 0);
  assert.equal(app.state.catalogMeal, 'lunch');
  await app.onClick({target: {closest: () => ({dataset: {action: 'reset-catalog'}})}});
  assert.deepEqual([app.state.catalogQuery, app.state.catalogMeal, app.state.catalogMaxTime], ['', '', 0]);
});

test('guests can undo the last local hide without restoring earlier hides', async () => {
  const app = createApp({swipe: () => assert.fail('Guest called the server')});
  app.setSession(guest);
  await app.swipe(1, 'dislike');
  await app.swipe(2, 'dislike');
  await app.undoSwipe();
  assert.deepEqual([...app.state.guestHidden], [1]);
  assert.equal(app.state.lastSwipe, null);
});

test('successful undo refreshes feed and favorites, and duplicate clicks make one request', async () => {
  const pending = deferred();
  const calls = [];
  const recipe = {id: 3, title: 'Омлет'};
  let undone = false;
  const app = createApp({
    swipe: async () => ({undo_token: 'latest'}),
    undoSwipe: (token) => { calls.push(token); return pending.promise; },
    getFavorites: async () => undone ? [] : [recipe],
    getFeed: async () => ({results: undone ? [recipe] : []}),
  });
  await app.swipe(recipe.id, 'like');
  assert.ok(app.state.favoriteIds.has(recipe.id));
  const undo = app.undoSwipe();
  await app.undoSwipe();
  undone = true;
  pending.resolve();
  await undo;
  assert.deepEqual(calls, ['latest']);
  assert.deepEqual(app.state.feed.results, [recipe]);
  assert.equal(app.state.favoriteIds.size, 0);
  assert.equal(app.state.lastSwipe, null);
});

test('late swipe response from old session cannot create an undo action or reload private data', async () => {
  const pending = deferred();
  const app = createApp({
    swipe: () => pending.promise,
    getFavorites: () => assert.fail('Old user triggered a refresh'),
  });
  const swipe = app.swipe(11, 'like');
  app.setSession(userB);
  const snapshot = structuredClone(app.state);
  pending.resolve({undo_token: 'old'});
  await swipe;
  assert.deepEqual(app.state, snapshot);
});

function preparePicker(app, slot) {
  editSavedPlan(app, savedPlan(1, slot ? [slot] : []));
  app.state.favoritesStatus = 'ready';
  const fields = new Map();
  app.dialog.querySelector = (selector) => {
    if (!fields.has(selector)) fields.set(selector, {disabled: false, focus() {}});
    return fields.get(selector);
  };
  setFavorites(app.state, [
    {id: 5, title: 'Суп с чечевицей', cooking_time_minutes: 25, image_url: '/media/soup.webp', meal_types: ['lunch']},
    {id: 6, title: 'Омлет', cooking_time_minutes: 10, meal_types: ['breakfast']},
  ]);
}

test('visual picker stages the exact slot, rejects stale triggers and writes only with a plan save', async () => {
  const calls = [];
  const app = createApp({
    updatePlan: async (id, payload) => {
      calls.push([id, payload]);
      return {...app.state.planDraft.plan, version: 2};
    },
  });
  preparePicker(app);
  app.openSlotPicker(2, 1, 'lunch');
  assert.equal(app.dialog.open, false);
  app.openSlotPicker(1, 1, 'lunch');
  assert.match(app.dialog.innerHTML, /Суп с чечевицей/);
  assert.match(app.dialog.innerHTML, /\/media\/soup.webp/);
  assert.match(app.dialog.innerHTML, /25 мин/);
  assert.match(app.dialog.innerHTML, /aria-label="Закрыть выбор блюда"/);
  assert.match(app.dialog.innerHTML, /min="1" max="20"/);
  assert.doesNotMatch(app.dialog.innerHTML, /Омлет/);
  app.onInput({target: {dataset: {input: 'picker-search'}, value: 'омлет'}});
  assert.match(app.dialog.querySelector('[data-picker-results]').innerHTML, /Ничего не найдено/);
  app.onInput({target: {dataset: {input: 'picker-search'}, value: 'СУП'}});
  await app.onChange({target: {dataset: {change: 'picker-recipe'}, value: '5'}});
  await app.savePickedSlot(21);
  assert.equal(app.state.planDraft.plan.slots.length, 0);
  await app.savePickedSlot(2);
  await app.savePickedSlot(2);
  assert.equal(app.dialog.open, false);
  assert.equal(app.state.activePlan.slots.length, 0);
  assert.deepEqual(calls, []);
  await app.savePlan();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1);
  assert.deepEqual(calls[0][1].slots, [{day_index: 1, meal_type: 'lunch', recipe_id: 5, servings: 2}]);
});

test('a saved recipe removed from favorites remains editable without becoming a picker choice', async () => {
  const app = createApp();
  preparePicker(app, {day_index: 0, meal_type: 'lunch', recipe_id: 7, recipe_title: 'Щи', servings: 2});
  app.openSlotPicker(1, 0, 'lunch');
  assert.match(app.dialog.innerHTML, /Текущее блюдо можно оставить/);
  assert.doesNotMatch(app.dialog.innerHTML, /value="7"/);
  await app.savePickedSlot(3);
  assert.equal(app.state.planDraft.plan.slots[0].servings, 3);
  assert.equal(app.state.activePlan.slots[0].servings, 2);
});

test('purchase mutation is bound to the displayed plan and late results cannot affect another session', async () => {
  const pending = deferred();
  const calls = [];
  const app = createApp({
    setPurchased: (...args) => { calls.push(args); return pending.promise; },
    getShoppingList: () => assert.fail('Old mutation triggered a refresh'),
  });
  const item = {ingredient_id: 7, quantity: '10.000', quantity_version: 'v1', unit: 'g', purchased: false};
  Object.assign(app.state, {shoppingPlanId: 1, shoppingStatus: 'ready', shopping: {plan_id: 1, items: [item]}});
  await app.setPurchased(2, 7, true);
  const mutation = app.setPurchased(1, 7, true);
  await app.setPurchased(1, 7, true);
  assert.deepEqual(calls, [[1, 7, {purchased: true, quantity_version: 'v1'}]]);
  app.setSession(userB);
  const snapshot = structuredClone(app.state);
  pending.resolve();
  await mutation;
  assert.deepEqual(app.state, snapshot);
});

test('purchase conflict refreshes amounts before another attempt', async () => {
  const item = {ingredient_id: 7, quantity: '10.000', quantity_version: 'v1', unit: 'g', purchased: false};
  const updated = {plan_id: 1, items: [{...item, quantity: '20.000', quantity_version: 'v2'}]};
  const app = createApp({
    setPurchased: async () => { throw new ApiError({status: 409}); },
    getShoppingList: async () => updated,
  });
  Object.assign(app.state, {shoppingPlanId: 1, shoppingStatus: 'ready', shopping: {plan_id: 1, items: [item]}});
  await app.setPurchased(1, 7, true);
  assert.deepEqual(app.state.shopping, updated);
  assert.equal(app.state.error, null);
  assert.match(app.messages[0], /Список покупок изменился/);
});

function createBrowser(path) {
  const browser = new EventTarget();
  const origin = 'https://foodtinder.test';
  const entry = (url, data) => ({url: new URL(url, origin), data});
  const entries = [entry(path)];
  let cursor = 0;
  Object.defineProperty(browser, 'location', {get: () => entries[cursor].url});
  const traverse = (offset) => {
    cursor += offset;
    browser.dispatchEvent(new Event('popstate'));
  };
  browser.history = {
    get state() { return entries[cursor].data; },
    pushState(data, _title, url) { entries.splice(++cursor, entries.length, entry(url, data)); },
    replaceState(data, _title, url) { entries[cursor] = entry(url ?? entries[cursor].url, data); },
    back() { traverse(-1); },
    forward() { traverse(1); },
    go(offset) { traverse(offset); },
  };
  const storage = new Map();
  browser.sessionStorage = {
    get length() { return storage.size; },
    key: (index) => [...storage.keys()][index],
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, value),
  };
  return browser;
}

test('private direct links and reload wait for the session before loading the requested data', async () => {
  const browser = createBrowser('/shopping');
  const session = deferred();
  const calls = [];
  const plan = {id: 2, start_date: '2026-11-20', duration_days: 1, enabled_meals: ['lunch'], slots: []};
  const app = createApp({
    getSession: () => { calls.push('session'); return session.promise; },
    getPlans: async () => { calls.push('plans'); return [plan]; },
    getPlan: async () => plan,
    getShoppingList: async (id) => { calls.push('shopping'); return {plan_id: id, items: []}; },
    getFeed: () => assert.fail('Requested shopping, not feed'),
  }, browser);
  app.setSession(guest);
  const starting = app.start();
  assert.deepEqual(calls, ['session']);
  assert.equal(app.state.view, 'shopping');
  session.resolve(userA);
  await starting;
  assert.deepEqual(calls, ['session', 'plans', 'shopping']);
  assert.equal(app.state.shopping.plan_id, 2);
  assert.equal(browser.location.pathname, '/shopping');
});

test('anonymous direct links stay on the private view and sign-in returns to it', async () => {
  const browser = createBrowser('/favorites');
  const favorites = [{id: 42, title: 'Сырники'}];
  let reads = 0;
  const app = createApp({getSession: async () => guest, getFavorites: async () => {
    reads += 1;
    return favorites;
  }}, browser);
  await app.start();
  assert.equal(reads, 0);
  assert.equal(browser.location.pathname, '/favorites');
  assert.match(app.root.innerHTML, /Избранное доступно после входа/i);
  await app.showAuth();
  assert.equal(browser.location.pathname + browser.location.search, '/account?next=favorites');
  await app.login({});
  assert.equal(reads, 1);
  assert.equal(browser.location.pathname, '/favorites');
  assert.equal(app.state.view, 'favorites');
  assert.deepEqual(app.state.favorites, favorites);
});

test('catalog URL restores filters across reload and browser history without an entry per edit', async () => {
  const browser = createBrowser('/');
  const catalog = [
    {id: 1, title: 'Суп с копчёностями', meal_types: ['lunch'], cooking_time_minutes: 45},
    {id: 2, title: 'Суп с грибами', meal_types: ['lunch'], cooking_time_minutes: 25},
  ];
  const api = {getSession: async () => userA, getRecipes: async () => catalog, getFavorites: async () => catalog.slice(0, 1)};
  const app = createApp(api, browser);
  app.root.querySelector = () => null;
  await app.start();
  await app.navigate('recipes');
  app.onInput({target: {dataset: {input: 'recipe-search'}, value: 'копчен'}});
  await app.onChange({target: {dataset: {change: 'catalog-meal'}, value: 'lunch'}});
  await app.onChange({target: {dataset: {change: 'catalog-time'}, value: '60'}});
  await app.onChange({target: {dataset: {change: 'catalog-favorites'}, checked: true}});
  const filteredUrl = browser.location.pathname + browser.location.search;
  assert.equal(browser.location.searchParams.get('favorites'), '1');
  const reloaded = createApp(api, createBrowser(filteredUrl));
  await reloaded.start();
  assert.equal(reloaded.state.view, 'recipes');
  assert.equal(reloaded.state.catalogQuery, 'копчен');
  assert.equal(reloaded.state.catalogMeal, 'lunch');
  assert.equal(reloaded.state.catalogMaxTime, 60);
  assert.equal(reloaded.state.catalogFavoritesOnly, true);
  assert.match(reloaded.root.innerHTML, /Найдено: 1 из 2/);
  await app.navigate('plans');
  browser.history.back();
  assert.equal(app.state.view, 'recipes');
  assert.equal(app.state.catalogQuery, 'копчен');
  browser.history.back();
  assert.equal(app.state.view, 'feed');
  browser.history.forward();
  browser.history.forward();
  assert.equal(app.state.view, 'plans');
  await new Promise(setImmediate);
});

test('logout removes private data and back navigation shows sign-in without private API calls', async () => {
  const browser = createBrowser('/favorites');
  let authenticated = true;
  let reads = 0;
  const app = createApp({
    getSession: async () => authenticated ? userA : guest,
    getFavorites: async () => { reads += 1; return [{id: 10, title: 'Личный рецепт'}]; },
    logout: async () => { authenticated = false; return guest; },
  }, browser);
  await app.start();
  assert.match(app.root.innerHTML, /Личный рецепт/);
  await app.navigate('auth');
  await app.logout();
  assert.equal(browser.location.pathname, '/');
  browser.history.back();
  assert.equal(browser.location.pathname, '/favorites');
  assert.equal(reads, 1);
  assert.match(app.root.innerHTML, /Избранное доступно после входа/i);
  assert.doesNotMatch(app.root.innerHTML, /Личный рецепт/);
  assert.equal(app.state.favoriteIds.size, 0);
});

test('returning to plans shows loading before any stale slot buttons can be used', async () => {
  const plans = deferred();
  const app = createApp({getPlans: () => plans.promise});
  const plan = {
    id: 1, start_date: '2026-11-20', duration_days: 1, enabled_meals: ['lunch'], slots: [],
  };
  Object.assign(app.state, {
    initialLoading: false, plans: [plan], plansStatus: 'ready',
    activePlan: plan, activePlanId: plan.id, activePlanStatus: 'ready',
  });
  const navigating = app.navigate('plans');
  assert.match(app.root.innerHTML, /Загружаем рационы/);
  assert.doesNotMatch(app.root.innerHTML, /Выбрать блюдо/);
  plans.resolve([]);
  await navigating;
});

test('swipe clock updates in place, replaces the old deadline and expires on visibility change', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const browser = createBrowser('/');
  browser.document = Object.assign(new EventTarget(), {hidden: false});
  browser.matchMedia = () => ({matches: true});
  const app = createApp({swipe: () => assert.fail('Guest called the server')}, browser);
  app.setSession(guest);
  app.state.initialLoading = false;
  let now = 0;
  app.now = () => now;
  let removed = 0;
  const number = {parentElement: {style: {setProperty() {}}}};
  const description = {};
  const nodes = {
    '[data-swipe-seconds]': number, '[data-swipe-description]': description,
    '[data-swipe-notice]': {remove() { removed++; }, contains: () => false},
  };
  app.root.querySelector = (selector) => app.state.lastSwipe ? nodes[selector] : null;

  await app.swipe(1, 'dislike');
  assert.equal(number.textContent, 5);
  const html = app.root.innerHTML;
  now = 1000;
  t.mock.timers.tick(1000);
  assert.equal(number.textContent, 4);
  assert.match(description.textContent, /4 сек/);
  assert.equal(app.root.innerHTML, html);

  await app.swipe(2, 'dislike');
  browser.document.hidden = true;
  now = 5000;
  browser.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(number.textContent, 1);
  now = 6000;
  browser.document.hidden = false;
  browser.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(removed, 1);
  assert.equal(app.state.lastSwipe, null);
  await app.undoSwipe();
  assert.deepEqual([...app.state.guestHidden], [1, 2]);
});

test('a late server rejection removes undo and refreshes both collections', async () => {
  let refreshed = 0;
  const app = createApp({
    swipe: async () => ({undo_token: 'current', undo_remaining_ms: 4800}),
    undoSwipe: async () => { throw new ApiError({status: 409}); },
    getFeed: async () => { refreshed++; return {results: []}; },
    getFavorites: async () => { refreshed++; return []; },
  });
  await app.swipe(1, 'like');
  await app.undoSwipe();
  assert.equal(refreshed, 4);
  assert.equal(app.state.lastSwipe, null);
  assert.match(app.messages.at(-1), /уже нельзя отменить/);
});

test('favorite filters survive reload and removing a bookmark updates the count without another read', async () => {
  const browser = createBrowser('/favorites?q=%D0%B5%D0%B6&meal=lunch&time=30&sort=time');
  const recipes = [
    {id: 1, title: 'Ёжики', meal_types: ['lunch'], cooking_time_minutes: 28},
    {id: 2, title: 'Ёжики с рисом', meal_types: ['lunch'], cooking_time_minutes: 17},
    ...Array.from({length: 101}, (_, index) => ({
      id: index + 3, title: 'Ёжики', cooking_time_minutes: 31, meal_types: ['lunch'],
    })),
  ];
  let reads = 0;
  const app = createApp({
    getSession: async () => userA,
    getFavorites: async () => { reads++; return recipes; },
    setFavorite: async (id, value) => assert.deepEqual([id, value], [2, false]),
  }, browser);
  await app.start();
  assert.match(app.root.innerHTML, /Найдено 2 из 103/);
  assert.ok(app.root.innerHTML.indexOf('Ёжики с рисом') < app.root.innerHTML.lastIndexOf('Ёжики'));
  await app.toggleFavorite(2);
  assert.match(app.root.innerHTML, /Найдено 1 из 102/);
  assert.doesNotMatch(app.root.innerHTML, /Ёжики с рисом/);
  assert.equal(reads, 1);
  assert.equal(browser.location.searchParams.get('sort'), 'time');
});

test('new plan stays local until explicit save and survives a failed save with the same creation key', async () => {
  const browser = createBrowser('/plans');
  const attempts = [];
  const app = createApp({
    getSession: async () => userA,
    createPlan: async (payload) => {
      attempts.push(payload);
      if (attempts.length === 1) throw networkError();
      return {...payload, id: 9, version: 1};
    },
  }, browser);
  await app.start();
  await app.openPlanEditor('new');
  app.onInput({target: {dataset: {input: 'plan-title'}, value: 'План на праздник'}});
  await app.onChange({target: {dataset: {change: 'plan-date'}, value: '2027-04-05'}});
  assert.match(app.root.innerHTML, /Есть несохранённые изменения/);
  assert.deepEqual(attempts, []);
  await app.savePlan();
  assert.equal(browser.location.search, '?draft=new');
  assert.equal(app.state.planDraft.dirty, true);
  assert.equal(app.state.error.type, 'network');
  assert.equal(app.planDrafts.get(userA.id, null).plan.title, 'План на праздник');
  await app.savePlan();
  assert.equal(browser.location.search, '?plan_id=9');
  assert.deepEqual(attempts[0], attempts[1]);
  assert.equal(app.planDrafts.get(userA.id, null), null);
  assert.match(app.root.innerHTML, /Сохранено/);
});

test('unsaved navigation can be canceled and an accepted Back keeps the draft for Forward', async () => {
  const browser = createBrowser('/plans');
  const api = {getSession: async () => userA, getPlan: async () => savedPlan()};
  const app = createApp(api, browser);
  await app.start();
  await app.openPlanEditor('edit', 1);
  app.onInput({target: {dataset: {input: 'plan-title'}, value: 'Мой черновик'}});
  const reload = new Event('beforeunload', {cancelable: true});
  assert.equal(browser.dispatchEvent(reload), false);
  browser.confirm = () => false;
  browser.history.back();
  assert.equal(browser.location.search, '?plan_id=1');
  assert.equal(app.state.planDraft.plan.title, 'Мой черновик');
  browser.confirm = () => true;
  browser.history.back();
  assert.equal(browser.location.search, '');
  browser.history.forward();
  await new Promise(setImmediate);
  assert.equal(browser.location.search, '?plan_id=1');
  assert.equal(app.state.planDraft.plan.title, 'Мой черновик');
});

test('duplicate uses eligible source slots only, writes no plan and clears private drafts on account change', async () => {
  const source = savedPlan(1, [
    {day_index: 0, meal_type: 'lunch', recipe_id: 2, recipe_title: 'Суп', servings: 3},
    {day_index: 1, meal_type: 'lunch', recipe_id: 3, recipe_title: 'Личный рецепт', servings: 1},
  ]);
  const browser = createBrowser('/plans');
  const app = createApp({
    getSession: async () => userA, getPlans: async () => [source], getPlan: async () => source,
    getFavorites: async () => [{id: 2, meal_types: ['lunch']}],
    createPlan: () => assert.fail('Duplication created a plan before Save'),
  }, browser);
  await app.start();
  await app.duplicatePlan(1);
  assert.equal(browser.location.search, '?draft=new');
  assert.deepEqual(app.state.planDraft.plan.slots, source.slots.slice(0, 1));
  assert.match(app.root.innerHTML, /Пропущено блюд · 1/);
  assert.match(app.root.innerHTML, /1 из 3 приёмов пищи заполнено/);
  assert.equal(browser.sessionStorage.length, 1);
  app.setSession(userB);
  app.render();
  assert.equal(browser.sessionStorage.length, 0);
  assert.equal(app.state.planDraft, null);
  assert.doesNotMatch(app.root.innerHTML, /Личный рецепт/);
});

test('shopping from a dirty plan offers save or discard and opens the selected plan', async () => {
  const original = savedPlan(2);
  const browser = createBrowser('/plans?plan_id=2');
  const shoppingReads = [];
  const app = createApp({
    getSession: async () => userA, getPlan: async () => original,
    getPlans: async () => [savedPlan(9), original],
    updatePlan: () => assert.fail('Discard sent an editor write'),
    getShoppingList: async (id) => { shoppingReads.push(id); return {plan_id: id, items: []}; },
  }, browser);
  await app.start();
  app.onInput({target: {dataset: {input: 'plan-title'}, value: 'Будет отменено'}});
  await app.openPlanShopping(2);
  assert.equal(app.state.view, 'plans');
  assert.match(app.dialog.innerHTML, /Сохранить и открыть покупки/);
  assert.deepEqual(shoppingReads, []);
  await app.resolveShoppingDecision('discard-and-shop');
  assert.equal(browser.location.pathname + browser.location.search, '/shopping?plan_id=2');
  assert.deepEqual(shoppingReads, [2]);
  browser.history.back();
  await new Promise(setImmediate);
  assert.equal(app.state.planDraft.plan.title, '');
});

test('shortening a draft asks before dropping occupied days and keeps saved slots untouched', async () => {
  const original = savedPlan(1, [
    {day_index: 0, meal_type: 'lunch', recipe_id: 5, servings: 1},
    {day_index: 2, meal_type: 'lunch', recipe_id: 6, servings: 2},
  ]);
  const app = createApp({updatePlan: () => assert.fail('Changing duration sent a write')});
  app.state.initialLoading = false;
  editSavedPlan(app, original);
  const duration = {dataset: {change: 'plan-duration'}, value: '1'};
  app.confirm = () => false;
  await app.onChange({target: duration});
  assert.equal(app.state.planDraft.plan.duration_days, 3);
  app.confirm = (warning) => {
    assert.match(warning, /удалены блюда · 1/);
    return true;
  };
  await app.onChange({target: duration});
  assert.equal(app.state.planDraft.plan.duration_days, 1);
  assert.deepEqual(app.state.planDraft.plan.slots, original.slots.slice(0, 1));
  assert.equal(app.state.activePlan.slots.length, 2);
  assert.match(app.root.innerHTML, /1 из 1 приёмов пищи заполнено/);
});
