import test from 'node:test';
import assert from 'node:assert/strict';
import {FoodTinderApp} from '../src/app.js';
import {ApiError} from '../src/api/errors.js';
import {RealApi} from '../src/api/real-api.js';
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

function createApp(overrides = {}) {
  const element = () => ({addEventListener() {}, innerHTML: ''});
  const api = {
    getFeed: async () => ({count: 0, results: []}),
    getFavorites: async () => [{id: 22}],
    getPlans: async () => [],
    getSession: async () => guest,
    logout: async () => guest,
    login: async () => userB,
    ...overrides,
  };
  const app = new FoodTinderApp({root: element(), dialog: element(), toast: element(), api, mode: 'real'});
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

test('plan mutations and export refuse a mismatch between displayed and selected data', async () => {
  const calls = [];
  const app = createApp(Object.fromEntries(['putSlot', 'deleteSlot', 'deletePlan', 'downloadShoppingList']
    .map((key) => [key, async (...args) => calls.push({key, args})])));
  app.state.activePlanStatus = 'ready';
  app.state.activePlanId = 2;
  app.state.activePlan = {id: 1};
  app.state.shoppingStatus = 'ready';
  app.state.shoppingPlanId = 2;
  app.state.shopping = {plan_id: 1, items: []};
  await app.saveSlot(0, 'lunch', {recipe_id: 2, servings: 1});
  await app.deleteSlot(0, 'lunch');
  await app.deletePlan();
  await app.exportShopping('csv');
  assert.deepEqual(calls, []);
});

test('slot mutation keeps its captured plan ID and selection is locked while saving', async () => {
  const save = deferred();
  const calls = [];
  const app = createApp({
    putSlot: (id) => { calls.push(id); return save.promise; },
    getPlan: async (id) => ({id, slots: []}),
  });
  app.state.activePlanId = 1;
  app.state.activePlan = {id: 1};
  app.state.activePlanStatus = 'ready';
  const saving = app.saveSlot(0, 'lunch', {recipe_id: 2, servings: 1});
  await app.onChange({target: {dataset: {change: 'active-plan'}, value: '2'}});
  assert.equal(app.state.activePlanId, 1);
  save.resolve();
  await saving;
  assert.deepEqual(calls, [1]);
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
  assert.ok(app.root.innerHTML.includes('Войти / регистрация'));
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
  assert.equal(app.state.mode, 'real');
  await app.loadPlans();
  assert.equal(app.state.plansError, null);
  assert.equal(app.state.error, null);
  assert.equal(app.state.plansStatus, 'ready');
  assert.deepEqual(app.state.plans, []);
});
