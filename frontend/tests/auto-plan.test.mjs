import test from 'node:test';
import assert from 'node:assert/strict';

import {generatePlanSlots} from '../src/utils/auto-plan.js';
import {createInitialState} from '../src/state/state.js';
import {renderPlansView} from '../src/views/plans-view.js';

const favorite = (id, mealTypes, title = `Рецепт ${id}`) => ({
  id, title, image_url: `/media/recipes/${id}.webp`, meal_types: mealTypes, cooking_time_minutes: 30,
});
const plan = (days, enabledMeals, slots = []) => ({
  title: '', start_date: '2026-11-20', duration_days: days, enabled_meals: enabledMeals, slots,
});

test('auto-fill picks compatible favorites, preserves dates and fills every available slot', () => {
  const favorites = [
    favorite(1, ['breakfast']), favorite(2, ['breakfast']), favorite(3, ['breakfast']),
    favorite(4, ['lunch']), favorite(5, ['lunch']), favorite(6, ['lunch']),
    favorite(7, ['dinner']), favorite(8, ['dinner']), favorite(9, ['dinner']),
  ];
  const original = plan(3, ['breakfast', 'lunch', 'dinner']);
  const snapshot = structuredClone(original);
  const result = generatePlanSlots(original, favorites, {servings: 3});
  assert.equal(result.generated, 9);
  assert.equal(result.missing, 0);
  assert.equal(result.repeated, 0);
  assert.equal(result.slots.length, 9);
  assert.deepEqual(original, snapshot, 'generation must never mutate the saved or current draft');
  for (const slot of result.slots) {
    assert.equal(slot.servings, 3);
    assert.equal(favorites.find(({id}) => id === slot.recipe_id).meal_types.includes(slot.meal_type), true);
    assert.equal(slot.recipe_image_url, `/media/recipes/${slot.recipe_id}.webp`);
    assert.ok(slot.day_index >= 0 && slot.day_index < 3);
  }
});

test('fill-only mode keeps manually selected recipes, quantities and metadata', () => {
  const existing = {
    day_index: 0, meal_type: 'lunch', recipe_id: 2, recipe_title: 'Выбранное вручную',
    recipe_image_url: '/media/manual.webp', servings: 5,
  };
  const current = plan(3, ['lunch'], [existing]);
  const result = generatePlanSlots(current, [
    favorite(1, ['lunch']), favorite(2, ['lunch']), favorite(3, ['lunch']),
  ], {servings: 2});
  assert.deepEqual(result.slots[0], existing);
  assert.equal(result.generated, 2);
  assert.equal(result.repeated, 0);
  assert.deepEqual(result.slots.map(({recipe_id}) => recipe_id).sort(), [1, 2, 3]);
});

test('limited favorites are reused only when needed, never creating incompatible slots', () => {
  const current = plan(3, ['breakfast', 'lunch']);
  const result = generatePlanSlots(current, [favorite(1, ['breakfast'])], {servings: 2});
  assert.equal(result.generated, 3);
  assert.equal(result.missing, 3);
  assert.equal(result.repeated, 2);
  assert.ok(result.slots.every((slot) => slot.meal_type === 'breakfast' && slot.recipe_id === 1));
  assert.equal(generatePlanSlots(current, [], {servings: 2}).generated, 0);
});

test('regenerate explicitly replaces previous choices, rotates choices, and never alters input', () => {
  const favorites = [
    favorite(1, ['lunch']), favorite(2, ['lunch']), favorite(3, ['lunch']), favorite(4, ['lunch']),
  ];
  const current = plan(2, ['lunch'], [{
    day_index: 0, meal_type: 'lunch', recipe_id: 1, servings: 4, recipe_title: 'Ручное блюдо',
  }]);
  const kept = generatePlanSlots(current, favorites, {servings: 2});
  const replaced = generatePlanSlots(current, favorites, {servings: 2, replace: true, rotation: 1});
  assert.equal(kept.slots[0].recipe_title, 'Ручное блюдо');
  assert.equal(replaced.generated, 2);
  assert.equal(replaced.slots[0].recipe_id, 2);
  assert.equal(replaced.slots[0].servings, 2);
  assert.equal(current.slots[0].servings, 4);
  assert.notDeepEqual(replaced.slots.map(({recipe_id}) => recipe_id),
    generatePlanSlots(current, favorites, {servings: 2, replace: true, rotation: 0}).slots.map(({recipe_id}) => recipe_id));
});

test('rejects invalid amounts and ignores duplicate or malformed favorite records', () => {
  const input = plan(1, ['lunch']);
  for (const servings of [0, 21, 1.5, -1]) {
    assert.throws(() => generatePlanSlots(input, [], {servings}), RangeError);
  }
  const result = generatePlanSlots(input, [
    favorite(1, ['lunch']), favorite(1, ['lunch']), {id: 2, title: 'Без типов'},
  ]);
  assert.equal(result.generated, 1);
  assert.equal(result.slots[0].recipe_id, 1);
});

test('plan editor explains auto-fill and keeps explicit save separate', () => {
  const state = createInitialState();
  state.initialLoading = false;
  state.view = 'plans';
  state.session = {authenticated: true, id: 1, email: 'test@example.com'};
  state.planMode = 'new';
  state.activePlanStatus = 'ready';
  state.planDraft = {
    plan: plan(3, ['lunch']), dirty: false, duplicate: false,
    generationServings: 2, generationNotice: '',
  };
  const html = renderPlansView(state);
  assert.match(html, /Автоматически подобрать блюда/);
  assert.match(html, /data-change="plan-auto-servings" value="2"/);
  assert.match(html, /data-action="auto-fill-plan"/);
  assert.match(html, /data-action="regenerate-plan"/);
  assert.match(html, /Сохранить рацион/);
  assert.match(html, /Все изменения останутся черновиком/);
});
