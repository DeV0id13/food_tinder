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

test('collection helpers follow DRF next links and combine results', async () => {
  const calls = [];
  const client = {
    async request(path, options = {}) {
      calls.push({path, options});
      if (path === 'recipes/') {
        return {
          count: 2,
          next: 'http://testserver/api/v1/recipes/?limit=100&offset=100',
          previous: null,
          results: [{id: 1}],
        };
      }
      return {count: 2, next: null, previous: '/api/v1/recipes/?limit=100', results: [{id: 2}]};
    },
  };
  const recipes = await new RealApi(client).getRecipes();
  assert.deepEqual(recipes, [{id: 1}, {id: 2}]);
  assert.equal(calls[0].options.query.limit, 100);
  assert.equal(calls[1].path, 'http://testserver/api/v1/recipes/?limit=100&offset=100');
});

test('feed always requests the first page', async () => {
  let captured;
  const client = {request: async (path, options) => { captured = {path, options}; return {results: []}; }};
  await new RealApi(client).getFeed();
  assert.equal(captured.path, 'preferences/feed/');
  assert.deepEqual(captured.options.query, {limit: 30, offset: 0});
});
