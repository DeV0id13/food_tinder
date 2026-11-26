import test from 'node:test';
import assert from 'node:assert/strict';
import {RealApi} from '../src/api/real-api.js';

test('logout resolves as guest after the confirmed POST without depending on GET session', async () => {
  const calls = [];
  const api = new RealApi({request: async (path) => {
    calls.push(path);
    if (path === 'auth/session/') throw new Error('offline');
    return null;
  }});
  assert.deepEqual(await api.logout(), {authenticated: false, id: null, email: null});
  assert.deepEqual(calls, ['auth/logout/']);
});

test('login explicitly refreshes session after the unsafe request', async () => {
  const calls = [];
  const client = {
    async request(path, options = {}) {
      calls.push({path, options});
      if (path === 'auth/login/') return {authenticated: true, id: 9, email: 'old@example.com'};
      return {authenticated: true, id: 9, email: 'fresh@example.com'};
    },
  };
  const session = await new RealApi(client).login({email: 'fresh@example.com', password: 'StrongPass_1'});
  assert.deepEqual(calls.map(({path}) => path), ['auth/login/', 'auth/session/']);
  assert.deepEqual(session, {authenticated: true, id: 9, email: 'fresh@example.com'});
});

test('catalog requests one page and forwards filters, pagination and cancellation', async () => {
  const calls = [];
  const page = {count: 400, next: '/api/v1/recipes/?offset=30', previous: null, results: [{id: 1}]};
  const client = {request: async (path, options) => { calls.push({path, options}); return page; }};
  const api = new RealApi(client);
  const {signal} = new AbortController();
  const filters = {query: 'ёжики', meal: 'lunch', maxTime: 30, favorites: true, sort: 'time', signal};
  assert.equal(await api.getRecipes(filters), page);
  assert.equal(calls.length, 1);
  await api.getRecipes({...filters, offset: 30});
  assert.deepEqual(calls, [0, 30].map((offset) => ({
    path: 'recipes/',
    options: {query: {q: 'ёжики', meal: 'lunch', max_time: 30, favorites: 1, sort: 'time', limit: 30, offset}, signal},
  })));
});

test('favorites and plans still follow DRF next links', async () => {
  for (const endpoint of ['preferences/favorites/', 'meal-plans/']) {
    const next = `/api/v1/${endpoint}?limit=100&offset=100`;
    const calls = [];
    const client = {request: async (path, options = {}) => {
      calls.push({path, options});
      return path === endpoint ? {next, results: [{id: 1}]} : {next: null, results: [{id: 2}]};
    }};
    const api = new RealApi(client);
    assert.deepEqual(await (endpoint === 'meal-plans/' ? api.getPlans() : api.getFavorites()), [{id: 1}, {id: 2}]);
    assert.deepEqual(calls, [{path: endpoint, options: {query: {limit: 100, offset: 0}}}, {path: next, options: {}}]);
  }
});

test('feed always requests the first page', async () => {
  let captured;
  const client = {request: async (path, options) => { captured = {path, options}; return {results: []}; }};
  await new RealApi(client).getFeed();
  assert.equal(captured.path, 'preferences/feed/');
  assert.deepEqual(captured.options.query, {limit: 30, offset: 0});
});

test('account API methods use strict authenticated endpoints and expected HTTP methods', async () => {
  const calls = [];
  const client = {request: async (path, options = {}) => {
    calls.push({path, options});
    return {email: 'new@example.com', first_name: 'Иван', last_name: 'Иванов'};
  }};
  const api = new RealApi(client);
  await api.getAccount();
  await api.updateAccount({first_name: 'Иван', last_name: 'Иванов'});
  await api.changeEmail({email: 'new@example.com', current_password: 'Valid_pass123'});
  assert.deepEqual(calls.map(({path, options}) => [path, options.method || 'GET']), [
    ['auth/account/', 'GET'], ['auth/account/', 'PATCH'], ['auth/account/email/', 'POST'],
  ]);
  assert.equal(calls[2].options.body.current_password, 'Valid_pass123');
});
