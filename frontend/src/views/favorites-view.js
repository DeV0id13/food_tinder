import {renderRecipeTile} from '../components/recipe-card.js';
import {renderStatus} from '../utils/dom.js';

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
  if (!state.favorites?.length) {
    return renderStatus({title: 'В избранном пусто', text: 'Сохраните рецепт закладкой, чтобы добавить его в рацион.', action: 'open-feed', actionLabel: 'Перейти в ленту'});
  }
  return `<header class="page-heading"><h1>Избранное</h1></header>
    <div class="recipe-grid">${state.favorites.map((recipe) => renderRecipeTile(recipe, {
      isFavorite: true,
      busy: state.busy === `recipe-${recipe.id}`,
    })).join('')}</div>`;
}
