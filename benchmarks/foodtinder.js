import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const origin = 'http://127.0.0.1:8080';
if (__ENV.FT_ENABLE_LOCAL_BENCHMARK !== '1') {
  throw new Error('Run this benchmark explicitly on the isolated make demo stack.');
}
const api = '/api/v1/';
const phase = __ENV.FT_PHASE || 'smoke';
const fixture = JSON.parse(open(__ENV.FT_FIXTURE));
const nonce = __ENV.FT_NONCE || 'sample';
const rate = Number(__ENV.FT_RATE || 1);
const duration = __ENV.FT_DURATION || '120s';
const vuCap = Math.min(fixture.sessions.length, Number(__ENV.FT_VUS || 96));
const starts = new Counter('ft_started');
const finishes = new Counter('ft_finished');
const responses = new Counter('ft_responses');
const unexpected = new Rate('ft_unexpected');
const failedJourney = new Rate('ft_journey_failed');
const meals = ['breakfast', 'lunch', 'snack', 'dinner'];
const additionalAssets = new Set();
let user;
let flow;
let loaded = false;

if (!/^[a-f0-9]{16}$/.test(fixture.run) || !/^[a-z0-9-]{1,20}$/.test(nonce) ||
    !['smoke', 'baseline', 'load', 'stress', 'spike', 'soak', 'recovery', 'auth'].includes(phase) ||
    !Number.isInteger(rate) || rate < 1 || rate > 24 || !Number.isInteger(vuCap) || vuCap < 1 || vuCap > 192) {
  throw new Error('Invalid benchmark configuration');
}

const openArrival = {
  executor: 'constant-arrival-rate', rate, timeUnit: `${__ENV.FT_INTERVAL || '1'}s`, duration,
  preAllocatedVUs: vuCap, maxVUs: vuCap, gracefulStop: '6s',
};
const authArrival = {
  executor: 'constant-arrival-rate', rate: 1, timeUnit: '34s', duration,
  preAllocatedVUs: 1, maxVUs: 1, gracefulStop: '6s', exec: 'authOnly',
};
export const options = {
  scenarios: { benchmark: phase === 'smoke'
    ? { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '3m', exec: 'smoke' }
    : phase === 'auth' ? authArrival : openArrival },
  noCookiesReset: true,
  maxRedirects: 0,
  discardResponseBodies: true,
  systemTags: ['name', 'method', 'status', 'error_code', 'scenario', 'expected_response'],
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    ft_unexpected: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '10s' }],
    ft_journey_failed: ['rate<0.01'],
  },
};

function check(value, code) {
  if (!value) throw new Error(code);
}
function localPath(value, prefix) {
  const clean = value.startsWith(origin + '/') ? value.slice(origin.length) : value;
  check(clean.startsWith(prefix) && !clean.startsWith('//') && !clean.includes('\\'), 'origin');
  return clean;
}
function sample(rows) {
  check(rows.length > 0, 'empty_collection');
  return rows[Math.floor(Math.random() * rows.length)];
}
function think(min = 0.35, max = 1.5) {
  if (phase !== 'smoke') sleep(min + Math.random() * (max - min));
}
function observe(res, name, type, expected, expectedConflict) {
  const status = res.status;
  const ok = expected.includes(status);
  const normalConflict = status === 409 && expectedConflict && res.json('detail') === expectedConflict;
  const limited = status === 429 && ['auth_register', 'auth_login'].includes(name) &&
    Number(res.headers['Retry-After']) > 0;
  const outcome = ok ? 'ok' : normalConflict ? 'conflict' : limited ? 'rate_limited' : 'unexpected';
  const tags = { name, type, flow, outcome, code: String(status) };
  responses.add(1, tags);
  unexpected.add(outcome === 'unexpected', { type, name });
  if (!ok) throw new Error(`${outcome}_${name}_${status}`);
  return res;
}
function call(name, route, method = 'GET', body, expected = [200], expectedConflict) {
  const path = localPath(route.startsWith('/') || route.startsWith(origin) ? route : api + route, api);
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRFToken'] = http.cookieJar().cookiesForURL(origin).csrftoken?.[0] || '';
    headers.Origin = origin;
  }
  const tags = { name, type: 'api', flow };
  return observe(http.request(method, origin + path, body === undefined ? null : JSON.stringify(body),
    { headers, tags, timeout: '4s', responseType: 'text' }), name, 'api', expected, expectedConflict);
}
function get(name, path) { return call(name, path).json(); }
function all(name, path) {
  let route = path + '?limit=100&offset=0';
  const results = [];
  const visited = new Set();
  while (route) {
    check(!visited.has(route) && visited.size < 32, 'pagination_loop');
    visited.add(route);
    const page = get(name, route);
    results.push(...page.results);
    route = page.next;
  }
  return results;
}
function assets(paths) {
  const needed = paths.filter(([path]) => path && !additionalAssets.has(path));
  const unique = [...new Map(needed.map(row => [row[0], row])).values()];
  const batch = unique.map(([path, type]) => ({
    method: 'GET',
    url: origin + localPath(path, type === 'photo' ? '/media/recipes/' : '/assets/'),
    params: { tags: { name: type, type, flow }, timeout: '4s' },
  }));
  if (!batch.length) return;
  let failure;
  for (const [i, res] of http.batch(batch).entries()) {
    const [path, type] = unique[i];
    try {
      observe(res, type, type, [200, 304]);
      additionalAssets.add(path);
    } catch (error) {
      failure ||= error;
    }
  }
  if (failure) throw failure;
}
function photos(recipes, limit) {
  assets(recipes.slice(0, limit).filter(r => r.image_url?.startsWith('/media/recipes/'))
    .map(r => [r.image_url, 'photo']));
}
function page() {
  const res = observe(http.get(origin + '/', { tags: { name: 'html', type: 'html', flow },
    responseType: 'text', timeout: '4s' }), 'html', 'html', [200]);
  const files = [...res.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)];
  check(files.some(m => m[1].endsWith('.js')) && files.some(m => m[1].endsWith('.css')), 'html_assets');
  assets(files.map(([, path]) => [path, path.endsWith('.js') ? 'js' :
    path.endsWith('.css') ? 'css' : 'static']));
  loaded = true;
}
function details(recipe) {
  const result = get('recipe_detail', `recipes/${recipe.id}/`);
  check(result.id === recipe.id && Array.isArray(result.ingredients) &&
    Array.isArray(result.steps), 'recipe_integrity');
  photos([result], 1);
}
function feed() {
  if (!loaded || Math.random() < 0.2) page();
  check(get('session', 'auth/session/').id === user.id, 'session_owner');
  const recipes = get('feed', 'preferences/feed/?limit=30&offset=0').results;
  photos(recipes, 3);
  for (const card of recipes.slice(0, 2)) {
    think();
    if (Math.random() < 0.35) details(card);
    const action = card === recipes[0] ? 'like' : 'dislike';
    const saved = call('swipe', 'preferences/swipes/', 'POST',
      { recipe_id: card.id, action }).json();
    get('feed', 'preferences/feed/?limit=30&offset=0');
    if (action === 'like') all('favorites', 'preferences/favorites/');
    if (phase === 'smoke' || Math.random() < 0.14) {
      think(0.25, 0.9);
      call('swipe_undo', 'preferences/swipes/undo/', 'POST', { undo_token: saved.undo_token },
        [200], 'This swipe can no longer be undone.');
      get('feed', 'preferences/feed/?limit=30&offset=0');
      all('favorites', 'preferences/favorites/');
    }
  }
}
function catalog() {
  if (!loaded) page();
  const filter = Math.random() < 0.5 ? '&meal=lunch&max_time=40&sort=time' : '';
  const first = get('catalog', 'recipes/?limit=30&offset=0' + filter);
  const recipes = first.next && Math.random() < 0.3 ? get('catalog', first.next).results : first.results;
  photos(recipes, 10);
  for (let i = 0; i < 2; i++) {
    think();
    details(sample(recipes));
  }
}
function payload(plan) {
  const slots = plan.slots.map(({ day_index, meal_type, recipe_id, servings }) =>
    ({ day_index, meal_type, recipe_id, servings }));
  const { start_date, duration_days, enabled_meals, title, version } = plan;
  return { start_date, duration_days, enabled_meals, title, version, slots };
}
function save(plan, data) {
  const saved = call('plan_update', `meal-plans/${plan.id}/`, 'PUT', data, [200],
    'The plan has changed since it was opened.').json();
  check(saved.version > plan.version && saved.slots.length === data.slots.length, 'plan_integrity');
  return saved;
}
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const bits = Math.floor(Math.random() * 16);
    return (ch === 'x' ? bits : (bits & 3) | 8).toString(16);
  });
}
function plans(days) {
  const favorites = all('favorites', 'preferences/favorites/');
  const saved = all('plans', 'meal-plans/');
  const prior = saved.find(row => row.id === user.plan);
  check(prior, 'plan_list_owner');
  get('plan_detail', `meal-plans/${prior.id}/`);
  photos(favorites, 6);
  think(0.8, 2.2);
  const durationDays = days || sample([1, 3, 7]);
  const slots = Array.from({ length: durationDays }, (_, day) => meals.map(meal =>
    ({ day_index: day, meal_type: meal,
      recipe_id: sample(favorites.filter(r => r.meal_types.includes(meal))).id,
      servings: sample([1, 2, 3, 4]) }))).flat();
  const created = call('plan_create', 'meal-plans/', 'POST', {
    creation_key: uuid(), start_date: new Date().toISOString().slice(0, 10),
    duration_days: durationDays, enabled_meals: meals, title: 'Тест FoodTinder', slots,
  }, [201]).json();
  const reopened = get('plan_detail', `meal-plans/${created.id}/`);
  check(reopened.slots.length === 4 * durationDays, 'plan_slot_count');
  think();
  const data = payload(reopened);
  const slot = data.slots[0];
  const replacement = favorites.filter(r => r.meal_types.includes(slot.meal_type) &&
    r.id !== slot.recipe_id);
  slot.recipe_id = sample(replacement).id;
  slot.servings += 1;
  const edited = save(reopened, data);
  check(edited.slots[0].servings === slot.servings &&
    edited.slots[0].recipe_id === slot.recipe_id, 'stored_plan_values');
}
function shopping() {
  const plan = get('plan_detail', `meal-plans/${user.plan}/`);
  const path = `shopping-list/?plan_id=${plan.id}`;
  const list = get('shopping', path);
  check(list.plan_id === plan.id, 'shopping_owner');
  const item = sample(list.items);
  const purchase = `shopping-list/${plan.id}/purchases/${item.ingredient_id}/`;
  for (const purchased of [true, false]) {
    think();
    call('purchase', purchase, 'PUT', { purchased, quantity_version: item.quantity_version },
      [204], 'The shopping quantity has changed.');
    if (phase === 'smoke') {
      check(get('shopping', path).items.find(i => i.ingredient_id === item.ingredient_id)
        .purchased === purchased, 'purchased_state');
    }
  }
  const data = payload(plan);
  data.slots[0].servings = data.slots[0].servings === 20 ? 19 : data.slots[0].servings + 1;
  save(plan, data);
  check(get('shopping', path).items.length > 0, 'shopping_recalculation');
  for (const type of ['csv', 'txt']) {
    const response = call(`export_${type}`, `shopping-list/export/?plan_id=${plan.id}&file_type=${type}`);
    check(response.headers['Content-Disposition']?.includes('.' + type) && response.body.length > 0,
      'export_content');
  }
}
function favorites() {
  const current = all('favorites', 'preferences/favorites/');
  photos(current, 8);
  details(sample(current));
  const saved = new Set(current.map(r => r.id));
  const available = get('feed', 'preferences/feed/?limit=30&offset=0').results
    .filter(r => !saved.has(r.id));
  const candidate = available[0] || all('catalog', 'recipes/').find(r => !saved.has(r.id));
  const recipe = candidate || sample(current);
  for (const isFavorite of (candidate ? [true, false] : [false, true])) {
    think();
    const updated = call('favorite_set', `preferences/favorites/${recipe.id}/`, 'PUT',
      { is_favorite: isFavorite }).json();
    check(updated.is_favorite === isFavorite, 'favorite_state');
  }
}
function account() {
  get('account_get', 'auth/account/');
  think();
  const lastName = 'Проверка';
  const result = call('account_patch', 'auth/account/', 'PATCH', { last_name: lastName }).json();
  check(result.last_name === lastName, 'account_edit');
}
function authorize() {
  http.cookieJar().clear(origin);
  try {
    check(!get('session', 'auth/session/').authenticated, 'guest_session');
    const email = `ftbench-${fixture.run}-auth-${nonce}-${exec.scenario.iterationInTest}@example.test`;
    const password = 'Aa1_' + fixture.password.replace(/-/g, '_');
    const registered = call('auth_register', 'auth/register/', 'POST',
      { email, password, first_name: 'Тест FoodTinder' }, [201]).json();
    call('auth_login', 'auth/login/', 'POST', { email, password });
    check(get('session', 'auth/session/').id === registered.id, 'registered_session');
    account();
    get('profile_get', 'auth/profile/');
    call('profile_patch', 'auth/profile/', 'PATCH', { height_cm: 171 });
    call('auth_logout', 'auth/logout/', 'POST', {}, [204]);
    check(!get('session', 'auth/session/').authenticated, 'logout_session');
  } finally {
    http.cookieJar().clear(origin);
  }
}
function identify() {
  user = fixture.sessions[exec.vu.idInTest - 1];
  check(user, 'fixture_vu');
  http.cookieJar().set(origin, 'sessionid', user.key, { path: '/' });
  if (!http.cookieJar().cookiesForURL(origin).csrftoken) {
    check(get('session', 'auth/session/').id === user.id, 'initial_session');
  }
}
function run(name, handler, authenticated = true) {
  flow = name;
  starts.add(1, { flow });
  let result = 'ok';
  try {
    if (authenticated) identify();
    handler();
  } catch (error) {
    // Only controlled error codes belong in the measurement output.
    result = /^(unexpected|conflict|rate_limited)_[a-z_]+_[0-9]+$/.test(error.message)
      ? error.message : 'scenario_assertion';
  } finally {
    finishes.add(1, { flow, result });
    failedJourney.add(result !== 'ok', { flow });
  }
  if (phase === 'smoke' && result !== 'ok') {
    exec.test.abort('Smoke step failed: ' + name + ' ' + result);
  }
}
export function smoke() {
  run('feed', feed);
  run('catalog', catalog);
  for (const days of [1, 3, 7]) run('plans', () => plans(days));
  run('shopping', shopping);
  run('favorites', favorites);
  run('auth', authorize, false);
}
export function authOnly() { run('auth', authorize, false); }
export default function () {
  const bucket = (exec.scenario.iterationInTest * 37) % 100;
  if (bucket < 30) run('feed', feed);
  else if (bucket < 55) run('catalog', catalog);
  else if (bucket < 75) run('plans', plans);
  else if (bucket < 90) run('shopping', shopping);
  else if (bucket < 97) run('favorites', favorites);
  else run('account', account);
}
