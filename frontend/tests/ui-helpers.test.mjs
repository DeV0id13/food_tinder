import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleFavorites, buildPlanDays, slotFor} from '../src/utils/plans.js';
import {validationMessages} from '../src/api/errors.js';
import {renderFeedView, visibleFeedRecipes} from '../src/views/feed-view.js';
import {renderRecipeDetail} from '../src/components/recipe-card.js';
import {filterRecipes} from '../src/utils/search.js';
import {renderRecipesView} from '../src/views/recipes-view.js';
import {favoriteMatches, renderFavoritesView} from '../src/views/favorites-view.js';
import {renderAuthView} from '../src/views/auth-view.js';
import {renderShell} from '../src/views/shell.js';
import {createInitialState, clearPrivateState} from '../src/state/state.js';
import {ApiError} from '../src/api/errors.js';
import {groupShoppingItems} from '../src/utils/shopping.js';

test('account screens use product language and registration explains the password and separate login', () => {
  const state = createInitialState();
  for (const [tab, title] of [['login', 'Вход'], ['register', 'Регистрация']]) {
    state.authTab = tab;
    const html = renderAuthView(state);
    assert.match(html, new RegExp(`<h1(?:\\s[^>]*)?>\\s*${title}\\s*</h1>`));
    assert.match(html, /<label(?:\s[^>]*)?>\s*Электронная почта/);
    assert.match(html, new RegExp(`data-form="${tab}"`));
    assert.doesNotMatch(html, /backend|CSRF|cookie|localStorage|reload|Session/i);
  }
  const register = renderAuthView(state);
  assert.match(register, /name="first_name"[^>]*required/);
  assert.match(register, /aria-describedby="password-help"/);
  assert.match(register, /id="password-help"[^>]*>[^<]*10\s+символов[^<]*латинск[^<]*цифр[^<]*_/);
  assert.match(register, /После регистрации войдите/);
  state.session = {authenticated: true, id: 1, email: 'person@example.com'};
  assert.doesNotMatch(renderAuthView(state), /Django|cookie|localStorage/i);
});

test('missing plans endpoint has one clear unavailable state in plans and shopping', () => {
  const state = createInitialState();
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
    assert.match(html, /data-action="open-recipes"[^>]*>\s*Перейти к рецептам/);
    assert.doesNotMatch(html, /Запрошенные данные не найдены|error-banner|retry-plans|Рационов пока нет/);
  }
  clearPrivateState(state);
  assert.equal(state.plansError, null);
});

test('network, server and auth errors remain actionable and are not called unavailable features', () => {
  for (const [type, status] of [['network', 0], ['server', 500], ['auth', 403]]) {
    const state = createInitialState();
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

test('empty and unavailable Django results render different states', () => {
  const state = createInitialState();
  Object.assign(state, {feed: {results: []}, feedStatus: 'ready', catalog: [], catalogStatus: 'ready'});
  assert.match(renderFeedView(state), /В ленте пока пусто/);
  assert.match(renderRecipesView(state), /Рецептов пока нет/);
  state.catalogStatus = 'error';
  assert.match(renderRecipesView(state), /data-action="retry-recipes"/);
});

test('recipe detail uses the media URL from Django and renders a fallback without one', () => {
  const recipe = {title: 'Каша', image_url: '/media/recipes/oats.webp', ingredients: [], steps: []};
  assert.match(renderRecipeDetail(recipe), /src="\/media\/recipes\/oats\.webp"/);
  const noPhoto = renderRecipeDetail({...recipe, image_url: ''});
  assert.doesNotMatch(noPhoto, /<img\b/);
  assert.match(noPhoto, /Без фотографии/);
});

test('DRF validation mappings become readable messages', () => {
  assert.deepEqual(validationMessages({email: ['Already used.'], non_field_errors: ['Try again.']}), [
    'email: Already used.',
    'Try again.',
  ]);
});

test('recipe search filters by title without case or ё differences and escapes input', () => {
  const recipes = [
    {id: 1, title: 'Борщ с говядиной', meal_types: ['lunch'], cooking_time_minutes: 50, difficulty: 2},
    {id: 2, title: 'Творожная запеканка', meal_types: ['breakfast'], cooking_time_minutes: 40, difficulty: 1},
    {id: 3, title: 'Ёжики с рисом', meal_types: ['dinner'], cooking_time_minutes: 45, difficulty: 2},
  ];
  assert.deepEqual(filterRecipes(recipes, '  БОРЩ ').map(({id}) => id), [1]);
  assert.deepEqual(filterRecipes(recipes, 'ежики').map(({id}) => id), [3]);
  assert.equal(filterRecipes(recipes, '').length, 3);

  const state = createInitialState();
  state.catalog = recipes;
  state.catalogStatus = 'ready';
  state.catalogQuery = 'борщ';
  const html = renderRecipesView(state);
  assert.match(html, /Поиск по названию/);
  assert.match(html, /Борщ с говядиной/);
  assert.doesNotMatch(html, /Творожная запеканка/);
  assert.match(html, /Найдено: 1 из 3/);

  state.catalogQuery = '<img src=x onerror=alert(1)>';
  const safe = renderRecipesView(state);
  assert.doesNotMatch(safe, /value="<img/);
  assert.match(safe, /value="&lt;img/);
  assert.match(safe, /Ничего не найдено/);
});

test('shopping checklist groups known ingredients, uses a fallback and labels purchased items', () => {
  const state = createInitialState();
  const plan = {id: 3, start_date: '2026-11-20', duration_days: 1};
  Object.assign(state, {
    view: 'shopping', initialLoading: false, session: {authenticated: true},
    plans: [plan], plansStatus: 'ready', shoppingStatus: 'ready', shoppingPlanId: plan.id,
    shopping: {plan_id: plan.id, items: [
      {ingredient_id: 1, name: 'Рис', unit: 'g', quantity: '200.000', purchased: true},
      {ingredient_id: 2, name: 'Трюфель', unit: 'g', quantity: '10.000', purchased: false},
    ]},
  });
  const html = renderShell(state);
  assert.match(html, /Куплено 1 из 2/);
  assert.match(html, /Бакалея/);
  assert.match(html, /Прочее/);
  assert.match(html, /aria-label="Куплено: Рис" checked/);
  assert.match(html, /data-action="clear-purchases"\s+data-plan-id="3"/);
});

test('shopping categories match ingredient words, including yogurt and cucumbers', () => {
  const groups = groupShoppingItems(['Греческий йогурт', 'Огурец', 'Молотая корица'].map((name) => ({name})));
  assert.deepEqual(groups.map(([label, items]) => [label, items.map(({name}) => name)]), [
    ['Овощи и фрукты', ['Огурец']],
    ['Молочные продукты и яйца', ['Греческий йогурт']],
    ['Бакалея', ['Молотая корица']],
  ]);
});

test('favorite date and title sorting are deterministic and missing dates come last', () => {
  const state = createInitialState();
  Object.assign(state, {
    session: {authenticated: true}, favoritesStatus: 'ready',
    favorites: [
      {id: 1, title: 'Яичница', favorited_at: '2026-11-20T00:00:00Z'},
      {id: 2, title: 'Борщ', favorited_at: null},
      {id: 3, title: 'Ёжики', favorited_at: '2026-11-21T00:00:00Z'},
    ],
  });
  assert.deepEqual(favoriteMatches(state).map(({id}) => id), [3, 1, 2]);
  state.favoriteFilters.sort = 'title';
  assert.deepEqual(favoriteMatches(state).map(({id}) => id), [2, 3, 1]);
  state.favoriteFilters.query = 'нет совпадений';
  assert.match(renderFavoritesView(state), /Ничего не найдено/);
  state.favorites = [];
  assert.match(renderFavoritesView(state), /В избранном пусто/);
});

test('account view renders editable first/last names and protected email change form', () => {
  const state = createInitialState();
  state.session = {authenticated: true, id: 1, email: 'reader@example.com'};
  state.accountStatus = 'ready';
  state.account = {first_name: 'Иван', last_name: 'Иванов', email: 'reader@example.com'};
  const html = renderAuthView(state);
  assert.match(html, /data-form="account-names"/);
  assert.match(html, /data-form="account-email"/);
  assert.match(html, /name="current_password" type="password"/);
  assert.match(html, /value="Иванов"/);
  assert.match(html, /Подтверждение нового адреса пока не настроено/);
});
