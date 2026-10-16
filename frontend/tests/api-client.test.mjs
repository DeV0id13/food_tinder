import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiClient, buildApiUrl, filenameFromDisposition, readCookie} from '../src/api/api-client.js';
import {ApiError} from '../src/api/errors.js';

test('default browser fetch keeps its global receiver instead of the ApiClient instance', async (t) => {
  t.mock.method(globalThis, 'fetch', async function (url) {
    assert.equal(this, globalThis);
    assert.equal(url, '/api/v1/auth/session/');
    return new Response(JSON.stringify({authenticated: false}), {
      headers: {'content-type': 'application/json'},
    });
  });
  assert.deepEqual(await new ApiClient().request('auth/session/'), {authenticated: false});
});

test('buildApiUrl keeps every request under /api/v1 and supports pagination URLs', () => {
  assert.equal(buildApiUrl('recipes/', {limit: 30, offset: 0}), '/api/v1/recipes/?limit=30&offset=0');
  assert.equal(
    buildApiUrl('http://testserver/api/v1/recipes/?limit=100&offset=100'),
    '/api/v1/recipes/?limit=100&offset=100',
  );
  assert.throws(() => buildApiUrl('/admin/'), /API path/);
});

test('cookie and Content-Disposition helpers decode safe values', () => {
  assert.equal(readCookie('csrftoken', 'sessionid=one; csrftoken=a%2Bb%3D; theme=dark'), 'a+b=');
  assert.equal(filenameFromDisposition('attachment; filename="shopping-list-7.csv"'), 'shopping-list-7.csv');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''shopping%20list.txt"), 'shopping list.txt');
});

test('unsafe request initializes CSRF, sends cookie credentials and JSON', async () => {
  let cookies = '';
  const calls = [];
  const client = new ApiClient({
    cookieReader: () => cookies,
    fetchImpl: async (url, options) => {
      calls.push({url, options});
      if (url.endsWith('/auth/session/')) {
        cookies = 'csrftoken=csrf-token';
        return new Response(JSON.stringify({authenticated: false, id: null, email: null}), {
          status: 200,
          headers: {'content-type': 'application/json'},
        });
      }
      return new Response(JSON.stringify({recipe_id: 3, is_favorite: false}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      });
    },
  });

  await client.request('preferences/swipes/', {method: 'POST', body: {recipe_id: 3, action: 'like'}});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/v1/auth/session/');
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(calls[1].options.headers.get('X-CSRFToken'), 'csrf-token');
  assert.equal(calls[1].options.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), {recipe_id: 3, action: 'like'});
});

test('204 response returns null', async () => {
  const client = new ApiClient({
    cookieReader: () => 'csrftoken=token',
    fetchImpl: async () => new Response(null, {status: 204}),
  });
  assert.equal(await client.request('auth/logout/', {method: 'POST', body: {}}), null);
});

test('HTTP statuses are classified and validation body is preserved', async (t) => {
  const cases = [[400, 'validation'], [403, 'auth'], [404, 'not_found'], [500, 'server']];
  for (const [status, type] of cases) {
    await t.test(`${status} -> ${type}`, async () => {
      const client = new ApiClient({
        fetchImpl: async () => new Response(JSON.stringify({field: ['problem']}), {
          status,
          headers: {'content-type': 'application/json'},
        }),
      });
      await assert.rejects(client.request('recipes/'), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.type, type);
        assert.deepEqual(error.details, {field: ['problem']});
        return true;
      });
    });
  }
});

test('network failure is not converted to demo data', async () => {
  const client = new ApiClient({fetchImpl: async () => { throw new TypeError('offline'); }});
  await assert.rejects(client.request('recipes/'), (error) => error instanceof ApiError && error.type === 'network');
});

test('blob response uses backend filename', async () => {
  const client = new ApiClient({
    fetchImpl: async () => new Response('ingredient;quantity;unit', {
      status: 200,
      headers: {'content-disposition': 'attachment; filename="shopping-list-9.csv"'},
    }),
  });
  const result = await client.request('shopping-list/export/', {responseType: 'blob'});
  assert.equal(result.filename, 'shopping-list-9.csv');
  assert.equal(await result.blob.text(), 'ingredient;quantity;unit');
});
