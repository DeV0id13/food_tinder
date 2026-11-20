import {renderRecipeTile} from '../components/recipe-card.js';
import {escapeAttr, renderStatus} from '../utils/dom.js';

function normalizeSearch(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

export function filterRecipes(recipes, query) {
  const search = normalizeSearch(query);
  if (!search) return recipes;
  return recipes.filter(({title}) => normalizeSearch(title).includes(search));
}

export function catalogSearchCount(state) {
  return `Найдено: ${filterRecipes(state.catalog || [], state.catalogQuery).length} из ${state.catalog?.length || 0}`;
}

export function renderCatalogResults(state) {
  const matching = filterRecipes(state.catalog || [], state.catalogQuery);
  if (!matching.length) {
    return renderStatus({title: 'Ничего не найдено', text: 'Попробуйте другое название блюда.'});
  }
  return `<div class="recipe-grid">${matching.map((recipe) => renderRecipeTile(recipe, {
    isFavorite: state.favoriteIds.has(recipe.id),
    busy: state.busy === `recipe-${recipe.id}`,
  })).join('')}</div>`;
}

export function renderRecipesView(state) {
  if (state.catalogStatus === 'loading' || state.catalogStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем каталог'});
  }
  if (state.catalogStatus === 'error') {
    return renderStatus({kind: 'error', title: 'Каталог не загрузился', action: 'retry-recipes'});
  }
  if (!state.catalog?.length) {
    return renderStatus({title: 'Рецептов пока нет'});
  }
  return `<header class="page-heading"><h1>Все рецепты</h1></header>
    <div class="recipe-search">
      <label for="recipe-search">Поиск по названию</label>
      <input id="recipe-search" type="search" data-input="recipe-search"
        value="${escapeAttr(state.catalogQuery)}" placeholder="Например, борщ"
        autocomplete="off" aria-controls="recipe-results" />
      <p data-catalog-count role="status" aria-live="polite">${catalogSearchCount(state)}</p>
    </div>
    <section id="recipe-results" data-catalog-results>${renderCatalogResults(state)}</section>`;
}
