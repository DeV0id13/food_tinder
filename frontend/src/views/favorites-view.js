import {renderRecipeFilters} from '../components/recipe-filters.js';
import {FAVORITE_SORTS} from '../constants.js';
import {renderRecipeTile} from '../components/recipe-card.js';
import {renderStatus} from '../utils/dom.js';
import {matchesRecipeFilters} from '../utils/search.js';

const titleOrder = new Intl.Collator('ru', {sensitivity: 'base'});

export function favoriteMatches(state) {
  const matches = matchesRecipeFilters(state.favorites || [], state.favoriteFilters);
  return matches.sort((a, b) => {
    const order = state.favoriteFilters.sort === 'added'
      ? (b.favorited_at ? Date.parse(b.favorited_at) : -Infinity)
        - (a.favorited_at ? Date.parse(a.favorited_at) : -Infinity)
      : state.favoriteFilters.sort === 'time' ? a.cooking_time_minutes - b.cooking_time_minutes : 0;
    return order || titleOrder.compare(a.title, b.title) || a.id - b.id;
  });
}

export function favoriteSearchCount(state) {
  return `Найдено ${favoriteMatches(state).length} из ${state.favorites?.length || 0}`;
}

export function renderFavoriteResults(state) {
  if (!state.favorites?.length) {
    return renderStatus({title: 'В избранном пусто', text: 'Сохраните рецепт закладкой, чтобы добавить его в рацион.', action: 'open-feed', actionLabel: 'Перейти в ленту'});
  }
  const matches = favoriteMatches(state);
  if (!matches.length) {
    return renderStatus({title: 'Ничего не найдено', text: 'Измените условия поиска или сбросьте фильтры.'});
  }
  return `<div class="recipe-grid">${matches.map((recipe) => renderRecipeTile(recipe, {
    isFavorite: true,
    busy: state.busy === `recipe-${recipe.id}`,
  })).join('')}</div>`;
}

export function renderFavoritesView(state) {
  if (!state.session.authenticated) {
    return renderStatus({kind: 'empty', title: 'Избранное доступно после входа', action: 'show-auth', actionLabel: 'Войти'});
  }
  if (state.favoritesStatus === 'loading' || state.favoritesStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем избранное'});
  }
  if (state.favoritesStatus === 'error') {
    return renderStatus({kind: 'error', title: 'Избранное не загрузилось', action: 'retry-favorites'});
  }
  return `<header class="page-heading"><h1>Избранное</h1></header>
    ${renderRecipeFilters('favorites', state.favoriteFilters, {
      extra: `<label>Сортировка<select data-change="favorites-sort" aria-controls="favorite-results">
        ${Object.entries(FAVORITE_SORTS).map(([id, label]) => `<option value="${id}" ${state.favoriteFilters.sort === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select></label>`,
      count: favoriteSearchCount(state), results: renderFavoriteResults(state),
    })}`;
}
