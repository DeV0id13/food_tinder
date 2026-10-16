import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleFavorites, buildPlanDays, slotFor} from '../src/utils/plans.js';
import {validationMessages} from '../src/api/errors.js';
import {visibleFeedRecipes} from '../src/views/feed-view.js';

test('favorite recipe choices are filtered by meal type', () => {
  const recipes = [
    {id: 1, meal_types: ['breakfast', 'snack']},
    {id: 2, meal_types: ['lunch', 'dinner']},
    {id: 3, meal_types: ['dinner']},
  ];
  assert.deepEqual(compatibleFavorites(recipes, 'dinner').map(({id}) => id), [2, 3]);
  assert.deepEqual(compatibleFavorites(recipes, 'breakfast').map(({id}) => id), [1]);
});

test('plan days contain enabled meals and matching slots', () => {
  const plan = {
    start_date: '2026-10-16',
    duration_days: 3,
    enabled_meals: ['breakfast', 'dinner'],
    slots: [{day_index: 1, meal_type: 'dinner', recipe_id: 4, recipe_title: 'Лосось', servings: 2}],
  };
  const days = buildPlanDays(plan);
  assert.equal(days.length, 3);
  assert.deepEqual(days[0].meals.map(({id}) => id), ['breakfast', 'dinner']);
  assert.equal(days[1].meals[1].slot.recipe_id, 4);
  assert.equal(slotFor(plan, 2, 'breakfast'), null);
});

test('guest dislike hides a card only from page-memory set', () => {
  const state = {
    feed: {results: [{id: 1}, {id: 2}, {id: 3}]},
    guestHidden: new Set([1, 3]),
  };
  assert.deepEqual(visibleFeedRecipes(state).map(({id}) => id), [2]);
});

test('DRF validation mappings become readable messages', () => {
  assert.deepEqual(validationMessages({email: ['Already used.'], non_field_errors: ['Try again.']}), [
    'email: Already used.',
    'Try again.',
  ]);
});
