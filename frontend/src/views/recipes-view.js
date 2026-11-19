import {renderRecipeTile} from '../components/recipe-card.js';
import {renderStatus} from '../utils/dom.js';

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
    <div class="recipe-grid">${state.catalog.map((recipe) => renderRecipeTile(recipe, {
      isFavorite: state.favoriteIds.has(recipe.id),
      busy: state.busy === `recipe-${recipe.id}`,
    })).join('')}</div>`;
}
