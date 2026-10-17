import {renderRecipeTile} from '../components/recipe-card.js';
import {renderStatus} from '../utils/dom.js';

export function renderRecipesView(state) {
  if (state.catalogStatus === 'loading' || state.catalogStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем каталог'});
  }
  if (state.catalogStatus === 'error') {
    return renderStatus({kind: 'error', title: 'Каталог не загрузился', text: 'Проверьте backend и повторите запрос.', action: 'retry-recipes'});
  }
  if (!state.catalog?.length) {
    return renderStatus({title: 'Рецептов пока нет', text: 'Активные рецепты появятся здесь после добавления в каталог.'});
  }
  return `<div class="page-heading"><div><p class="eyebrow">КАТАЛОГ</p><h1>Все рецепты</h1><p class="page-subtitle">Публичный список активных рецептов из backend.</p></div><span class="count-pill">${state.catalog.length}</span></div>
    <div class="recipe-grid">${state.catalog.map((recipe) => renderRecipeTile(recipe, {
      isFavorite: state.favoriteIds.has(recipe.id),
      busy: state.busy === `recipe-${recipe.id}`,
    })).join('')}</div>`;
}
