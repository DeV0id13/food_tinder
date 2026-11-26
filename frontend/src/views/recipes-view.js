import {renderRecipeTile} from '../components/recipe-card.js';
import {renderRecipeFilters} from '../components/recipe-filters.js';
import {CATALOG_PAGE_SIZE, CATALOG_SORTS} from '../constants.js';
import {renderStatus} from '../utils/dom.js';

export function catalogSearchCount(state) {
  if (state.catalogStatus !== 'ready') return '';
  const {count, results} = state.catalog;
  const first = results.length ? state.catalogOffset + 1 : 0;
  return `Показано: ${first}–${state.catalogOffset + results.length} из ${count}`;
}

export function renderCatalogResults(state) {
  if (state.catalogStatus === 'loading' || state.catalogStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем каталог'});
  }
  if (state.catalogStatus === 'error') {
    return renderStatus({kind: 'error', title: 'Каталог не загрузился', action: 'retry-recipes'});
  }
  const {results, next, previous} = state.catalog;
  if (!results.length) {
    return renderStatus({title: 'Ничего не найдено', text: 'Измените условия поиска или сбросьте фильтры.'});
  }
  const page = (offset, label) => `<button class="button button-secondary" data-action="catalog-page" data-offset="${offset}">${label}</button>`;
  return `<div class="recipe-grid">${results.map((recipe) => renderRecipeTile(recipe, {
    isFavorite: state.catalogFavoritesOnly || state.favoriteIds.has(recipe.id),
    busy: Boolean(state.busy),
  })).join('')}</div>
    ${next || previous ? `<nav class="catalog-pages" aria-label="Страницы каталога">
      ${previous ? page(Math.max(0, state.catalogOffset - CATALOG_PAGE_SIZE), 'Назад') : ''}
      ${next ? page(state.catalogOffset + CATALOG_PAGE_SIZE, 'Далее') : ''}
    </nav>` : ''}`;
}

export function renderRecipesView(state) {
  const signedIn = state.session.authenticated;
  return `<header class="page-heading"><h1>Все рецепты</h1></header>
    ${renderRecipeFilters('catalog', {
      query: state.catalogQuery, meal: state.catalogMeal, maxTime: state.catalogMaxTime,
    }, {
      extra: `<label>Сортировка<select data-change="catalog-sort" aria-controls="recipe-results">
        ${Object.entries(CATALOG_SORTS).map(([value, label]) => `<option value="${value}" ${state.catalogSort === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select></label>
      <label class="catalog-favorites"><input type="checkbox" data-change="catalog-favorites" aria-controls="recipe-results"
        ${signedIn && state.catalogFavoritesOnly ? 'checked' : ''}
        ${signedIn ? '' : 'disabled aria-describedby="catalog-sign-in"'} /> Только избранные</label>`,
      note: signedIn ? '' : `<p id="catalog-sign-in"><button class="text-button" data-action="navigate" data-view="auth">Войдите</button>, чтобы фильтровать избранное.</p>`,
      count: catalogSearchCount(state), results: renderCatalogResults(state),
    })}`;
}
