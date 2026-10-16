import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoApi, demoCredentials} from '../src/api/demo-api.js';
import {createApi, resolveApiMode} from '../src/api/index.js';
import {ApiError} from '../src/api/errors.js';
import {compatibleFavorites} from '../src/utils/plans.js';
import {existsSync} from 'node:fs';

test('demo catalog contains at least 52 distinct, complete, selectable recipes', async () => {
  const api = new DemoApi();
  const catalog = await api.getRecipes();
  const feed = await api.getFeed();
  assert.ok(catalog.length >= 52);
  assert.equal(new Set(catalog.map(({id}) => id)).size, catalog.length);
  assert.equal(new Set(catalog.map(({title}) => title)).size, catalog.length);
  assert.deepEqual(feed.results, catalog);
  assert.equal(feed.count, catalog.length);

  const ingredientRegistry = new Map();
  for (const item of catalog) {
    const detail = await api.getRecipe(item.id);
    assert.equal(detail.title, item.title);
    assert.ok(detail.cooking_time_minutes > 0);
    assert.ok(detail.base_servings > 0);
    assert.ok(detail.difficulty >= 1 && detail.difficulty <= 5);
    assert.ok(detail.description.length > 0);
    assert.ok(detail.steps.length >= 2);
    assert.ok(detail.steps.every((step) => step.trim().length > 0));
    assert.ok(detail.meal_types.length > 0);
    assert.equal(new Set(detail.meal_types).size, detail.meal_types.length);
    assert.ok(detail.meal_types.every((meal) => ['breakfast', 'lunch', 'snack', 'dinner'].includes(meal)));
    assert.ok(detail.ingredients.length > 0);
    assert.equal(new Set(detail.ingredients.map(({ingredient_id}) => ingredient_id)).size, detail.ingredients.length);
    if (detail.image_url) {
      assert.ok(existsSync(new URL(`../public${detail.image_url}`, import.meta.url)), detail.image_url);
    }
    for (const line of detail.ingredients) {
      assert.ok(line.ingredient_id > 0);
      assert.ok(line.name.trim().length > 0);
      assert.ok(['g', 'ml', 'pcs'].includes(line.unit));
      assert.match(line.quantity, /^\d+\.\d{3}$/);
      assert.ok(Number(line.quantity) > 0);
      if (line.unit === 'pcs') assert.ok(Number.isInteger(Number(line.quantity)));
      const identity = {name: line.name, unit: line.unit};
      if (ingredientRegistry.has(line.ingredient_id)) {
        assert.deepEqual(identity, ingredientRegistry.get(line.ingredient_id));
      }
      ingredientRegistry.set(line.ingredient_id, identity);
    }
  }

  for (const meal of ['breakfast', 'lunch', 'snack', 'dinner']) {
    assert.ok(compatibleFavorites(catalog, meal).length >= 10, `Enough choices for ${meal}`);
  }
});

test('all demo recipes can become favorites and fill compatible plan slots', async () => {
  const api = new DemoApi();
  await api.login(demoCredentials);
  const catalog = await api.getRecipes();
  const plan = await api.createPlan({
    start_date: '2026-10-16', duration_days: 1,
    enabled_meals: ['breakfast', 'lunch', 'snack', 'dinner'],
  });
  for (const recipe of catalog) {
    await api.setFavorite(recipe.id, true);
    const meal = recipe.meal_types[0];
    await api.putSlot(plan.id, 0, meal, {recipe_id: recipe.id, servings: 2});
    const saved = (await api.getPlan(plan.id)).slots.find((slot) => slot.meal_type === meal);
    assert.equal(saved.recipe_id, recipe.id);
    const shopping = await api.getShoppingList(plan.id);
    assert.ok(shopping.items.length > 0);
    assert.ok(shopping.items.every((item) => Number(item.quantity) > 0));
  }
  assert.equal((await api.getFavorites()).length, catalog.length);
});

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
