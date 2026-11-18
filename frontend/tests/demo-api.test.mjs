import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoApi, demoCredentials} from '../src/api/demo-api.js';
import {createApi, resolveApiMode} from '../src/api/index.js';
import {ApiError} from '../src/api/errors.js';

test('demo mode is explicit and real mode remains the default', () => {
  assert.equal(resolveApiMode(''), 'real');
  assert.equal(resolveApiMode('?demo=0'), 'real');
  assert.equal(resolveApiMode('?demo=1'), 'demo');
  assert.equal(resolveApiMode('?mode=demo'), 'demo');
  assert.equal(createApi('real').mode, 'real');
  assert.equal(createApi('demo').mode, 'demo');
});

test('registration does not create an authenticated session', async () => {
  const api = new DemoApi();
  const account = await api.register({email: 'New@Example.com', password: 'StrongPass_1'});
  assert.equal(account.email, 'new@example.com');
  assert.equal((await api.getSession()).authenticated, false);
  assert.equal((await api.login({email: 'new@example.com', password: 'StrongPass_1'})).authenticated, true);
});

test('demo API covers favorite, swipe, plan, shopping and both exports', async () => {
  const api = new DemoApi();
  await api.login(demoCredentials);
  await api.setFavorite(2, true);
  assert.deepEqual((await api.getFavorites()).map(({id}) => id), [2]);

  const plan = await api.createPlan({
    start_date: '2026-10-16',
    duration_days: 1,
    enabled_meals: ['lunch', 'dinner'],
  });
  await api.putSlot(plan.id, 0, 'lunch', {recipe_id: 2, servings: 3});
  let shopping = await api.getShoppingList(plan.id);
  assert.deepEqual(shopping.items.find(({ingredient_id}) => ingredient_id === 5), {
    ingredient_id: 5,
    name: 'Помидоры',
    unit: 'g',
    quantity: '300.000',
  });

  await api.putSlot(plan.id, 0, 'lunch', {recipe_id: 2, servings: 1});
  shopping = await api.getShoppingList(plan.id);
  assert.equal(shopping.items.find(({ingredient_id}) => ingredient_id === 5).quantity, '100.000');

  const csv = await api.downloadShoppingList(plan.id, 'csv');
  const txt = await api.downloadShoppingList(plan.id, 'txt');
  assert.equal(csv.filename, `shopping-list-${plan.id}.csv`);
  assert.match(await csv.blob.text(), /ingredient;quantity;unit/);
  assert.match(await txt.blob.text(), /Помидоры — 100\.000 g/);

  await api.swipe(1, 'like');
  assert.ok(!(await api.getFeed()).results.some(({id}) => id === 1));
  await api.deleteSlot(plan.id, 0, 'lunch');
  assert.deepEqual((await api.getPlan(plan.id)).slots, []);
  await api.deletePlan(plan.id);
  assert.deepEqual(await api.getPlans(), []);
});

test('demo plan rejects recipes that are not favorites', async () => {
  const api = new DemoApi();
  await api.login(demoCredentials);
  const plan = await api.createPlan({start_date: '2026-10-16', duration_days: 1, enabled_meals: ['dinner']});
  await assert.rejects(
    api.putSlot(plan.id, 0, 'dinner', {recipe_id: 4, servings: 1}),
    (error) => error instanceof ApiError && error.type === 'validation',
  );
});
