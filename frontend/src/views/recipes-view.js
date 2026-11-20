import {renderRecipeTile} from '../components/recipe-card.js';
import {MEALS} from '../constants.js';
import {escapeAttr, renderStatus} from '../utils/dom.js';
import {filterRecipes} from '../utils/search.js';

export {filterRecipes} from '../utils/search.js';

export function catalogMatches(state) {
  return filterRecipes(state.catalog || [], state.catalogQuery).filter((recipe) =>
    (!state.catalogMeal || recipe.meal_types?.includes(state.catalogMeal))
    && (!state.catalogMaxTime || recipe.cooking_time_minutes <= state.catalogMaxTime)
    && (!state.session.authenticated || !state.catalogFavoritesOnly || state.favoriteIds.has(recipe.id)));
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
    <div class="recipe-search">
      <label>Поиск по названию
        <input id="recipe-search" type="search" data-input="recipe-search"
          value="${escapeAttr(state.catalogQuery)}" placeholder="Например, борщ"
          autocomplete="off" aria-controls="recipe-results" />
      </label>
      <div class="catalog-filters">
        <label>Приём пищи<select data-change="catalog-meal" aria-controls="recipe-results">
          <option value="">Все</option>
          ${MEALS.map(({id, label}) => `<option value="${id}" ${state.catalogMeal === id ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label>Время готовки<select data-change="catalog-time" aria-controls="recipe-results">
          <option value="">Любое</option>
          ${[15, 30, 60].map((time) => `<option value="${time}" ${state.catalogMaxTime === time ? 'selected' : ''}>До ${time} мин</option>`).join('')}
        </select></label>
        <label class="catalog-favorites"><input type="checkbox" data-change="catalog-favorites" aria-controls="recipe-results"
          ${signedIn && state.catalogFavoritesOnly ? 'checked' : ''}
          ${signedIn ? '' : 'disabled aria-describedby="catalog-sign-in"'} /> Только избранные</label>
      </div>
      ${signedIn ? '' : `<p id="catalog-sign-in"><button class="text-button" data-action="navigate" data-view="auth">Войдите</button>, чтобы фильтровать избранное.</p>`}
      <div class="catalog-summary">
        <p data-catalog-count role="status">${catalogSearchCount(state)}</p>
        <button class="text-button" data-action="reset-catalog">Сбросить фильтры</button>
      </div>
    </div>
    <section id="recipe-results" data-catalog-results>${renderCatalogResults(state)}</section>`;
}
