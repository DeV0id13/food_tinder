import {renderRecipeTile} from '../components/recipe-card.js';
import {renderStatus} from '../utils/dom.js';
import {matchesRecipeFilters} from '../utils/search.js';

import {renderRecipeFilters} from '../components/recipe-filters.js';

export {filterRecipes} from '../utils/search.js';

export function catalogMatches(state) {
  return matchesRecipeFilters(state.catalog || [], {
    query: state.catalogQuery, meal: state.catalogMeal, maxTime: state.catalogMaxTime,
  }).filter((recipe) =>
    !state.session.authenticated || !state.catalogFavoritesOnly || state.favoriteIds.has(recipe.id));
}

function waitingForFavorites(state) {
  return state.catalogFavoritesOnly && state.session.authenticated && state.favoritesStatus !== 'ready';
}

export function catalogSearchCount(state) {
  if (waitingForFavorites(state)) return '';
  return `Найдено: ${catalogMatches(state).length} из ${state.catalog?.length || 0}`;
}

export function renderCatalogResults(state) {
  if (waitingForFavorites(state)) {
    return state.favoritesStatus === 'error'
      ? renderStatus({kind: 'error', title: 'Избранное не загрузилось', action: 'retry-favorites'})
      : renderStatus({kind: 'loading', title: 'Загружаем избранное'});
  }
  const matching = catalogMatches(state);
  if (!matching.length) {
    return renderStatus({title: 'Ничего не найдено', text: 'Измените условия поиска или сбросьте фильтры.'});
  }
  return `<div class="recipe-grid">${matching.map((recipe) => renderRecipeTile(recipe, {
    isFavorite: state.favoriteIds.has(recipe.id),
    busy: Boolean(state.busy),
  })).join('')}</div>`;
}

export function renderRecipesView(state) {
  if (state.catalogStatus === 'loading' || state.catalogStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем каталог'});
  }
  if (state.catalogStatus === 'error') {
    return renderStatus({kind: 'error', title: 'Каталог не загрузился', action: 'retry-recipes'});
  }
  if (!state.catalog?.length) return renderStatus({title: 'Рецептов пока нет'});

  const signedIn = state.session.authenticated;
  return `<header class="page-heading"><h1>Все рецепты</h1></header>
    ${renderRecipeFilters('catalog', {
      query: state.catalogQuery, meal: state.catalogMeal, maxTime: state.catalogMaxTime,
    }, {
      extra: `<label class="catalog-favorites"><input type="checkbox" data-change="catalog-favorites" aria-controls="recipe-results"
        ${signedIn && state.catalogFavoritesOnly ? 'checked' : ''}
        ${signedIn ? '' : 'disabled aria-describedby="catalog-sign-in"'} /> Только избранные</label>`,
      note: signedIn ? '' : `<p id="catalog-sign-in"><button class="text-button" data-action="navigate" data-view="auth">Войдите</button>, чтобы фильтровать избранное.</p>`,
      count: catalogSearchCount(state), results: renderCatalogResults(state),
    })}`;
}
