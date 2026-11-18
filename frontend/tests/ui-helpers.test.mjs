import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleFavorites, buildPlanDays, slotFor} from '../src/utils/plans.js';
import {validationMessages} from '../src/api/errors.js';
import {visibleFeedRecipes} from '../src/views/feed-view.js';
import {renderAuthView} from '../src/views/auth-view.js';
import {renderShell} from '../src/views/shell.js';
import {createInitialState, clearPrivateState} from '../src/state/state.js';
import {ApiError} from '../src/api/errors.js';

test('account screens use product language and registration explains the password and separate login', () => {
  const state = createInitialState('real');
  for (const tab of ['login', 'register']) {
    state.authTab = tab;
    const html = renderAuthView(state);
    assert.match(html, /Готовьте то, что нравится/);
    assert.doesNotMatch(html, /backend|CSRF|cookie|localStorage|reload|Session/i);
  }
  assert.match(renderAuthView(state), /От 10 символов: латинские буквы, цифры и _/);
  assert.match(renderAuthView(state), /После регистрации войдите/);
  state.session = {authenticated: true, id: 1, email: 'person@example.com'};
  assert.doesNotMatch(renderAuthView(state), /Django|cookie|localStorage/i);
});

test('missing plans endpoint has one clear unavailable state in plans and shopping without a mock fallback', () => {
  const state = createInitialState('real');
  Object.assign(state, {
    initialLoading: false,
    session: {authenticated: true, id: 1, email: 'person@example.com'},
    plansStatus: 'error',
    plansError: new ApiError({type: 'not_found', status: 404}),
  });
  state.error = state.plansError;
  for (const view of ['plans', 'shopping']) {
    state.view = view;
    const html = renderShell(state);
    assert.match(html, /пока недоступ/);
    assert.match(html, /Перейти к рецептам/);
    assert.doesNotMatch(html, /Запрошенные данные не найдены|error-banner|retry-plans|Рационов пока нет|Демо-режим/);
    assert.equal(state.mode, 'real');
  }
  clearPrivateState(state);
  assert.equal(state.plansError, null);
});

test('network, server and auth errors remain actionable and are not called unavailable features', () => {
  for (const [type, status] of [['network', 0], ['server', 500], ['auth', 403]]) {
    const state = createInitialState('real');
    Object.assign(state, {
      view: 'plans', initialLoading: false,
      session: {authenticated: true, id: 1, email: 'person@example.com'},
      plansStatus: 'error', plansError: new ApiError({type, status}),
    });
    state.error = state.plansError;
    const html = renderShell(state);
    assert.match(html, /error-banner/);
    assert.match(html, /retry-plans/);
    assert.doesNotMatch(html, /Рационы пока недоступны/);
    if (status === 403) assert.match(html, /Войти снова/);
  }
});

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
