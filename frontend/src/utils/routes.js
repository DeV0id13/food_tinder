import {COOKING_TIMES, FAVORITE_SORTS, MEAL_LABELS} from '../constants.js';

const VIEW_PATHS = {
  feed: '/',
  recipes: '/recipes',
  favorites: '/favorites',
  plans: '/plans',
  shopping: '/shopping',
  auth: '/account',
};
const PATH_VIEWS = new Map(Object.entries(VIEW_PATHS).map(([view, path]) => [path, view]));

export function isAppPath(pathname) {
  return PATH_VIEWS.has(pathname.replace(/\/$/, '') || '/');
}

export function isPrivateView(view) {
  return ['favorites', 'plans', 'shopping'].includes(view);
}

export function readRoute({pathname, search}) {
  const view = PATH_VIEWS.get(pathname.replace(/\/$/, '') || '/') ?? 'feed';
  const params = new URLSearchParams(search);
  if (view === 'recipes' || view === 'favorites') {
    const meal = params.get('meal');
    const time = Number(params.get('time'));
    const query = params.get('q') ?? '';
    const mealType = Object.hasOwn(MEAL_LABELS, meal) ? meal : '';
    const maxTime = COOKING_TIMES.includes(time) ? time : 0;
    if (view === 'favorites') {
      const sort = params.get('sort');
      return {view, favoriteFilters: {
        query, meal: mealType, maxTime, sort: Object.hasOwn(FAVORITE_SORTS, sort) ? sort : 'added',
      }};
    }
    return {
      view,
      filters: {
        catalogQuery: query, catalogMeal: mealType, catalogMaxTime: maxTime,
        catalogFavoritesOnly: params.get('favorites') === '1',
      },
    };
  }
  const next = params.get('next');
  const rawPlanId = params.get('plan_id') ?? '';
  const planId = /^\d+$/.test(rawPlanId) && Number.isSafeInteger(Number(rawPlanId))
    ? Number(rawPlanId) || null : null;
  if (view === 'plans') return {view, planId, planMode: planId ? 'edit' : params.get('draft') === 'new' ? 'new' : 'list'};
  if (view === 'shopping') return {view, planId};
  return {view, next: view === 'auth' && isPrivateView(next) ? next : null, planId};
}

export function routeUrl(view, state, next, nextPlanId) {
  const params = new URLSearchParams();
  if (view === 'recipes') {
    if (state.catalogQuery) params.set('q', state.catalogQuery);
    if (state.catalogMeal) params.set('meal', state.catalogMeal);
    if (state.catalogMaxTime) params.set('time', state.catalogMaxTime);
    if (state.session.authenticated && state.catalogFavoritesOnly) params.set('favorites', '1');
  }
  if (view === 'favorites') {
    const {query, meal, maxTime, sort} = state.favoriteFilters;
    if (query) params.set('q', query);
    if (meal) params.set('meal', meal);
    if (maxTime) params.set('time', maxTime);
    if (sort !== 'added') params.set('sort', sort);
  }
  if (view === 'plans' && state.planMode === 'new') params.set('draft', 'new');
  if (view === 'plans' && state.planMode === 'edit') params.set('plan_id', state.activePlanId);
  if (view === 'shopping' && state.shoppingPlanId) params.set('plan_id', state.shoppingPlanId);
  if (view === 'auth' && isPrivateView(next)) {
    params.set('next', next);
    if (nextPlanId) params.set('plan_id', nextPlanId);
  }
  return (VIEW_PATHS[view] ?? '/') + (params.size ? `?${params}` : '');
}
