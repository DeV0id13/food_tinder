import {renderRecipeTile} from '../components/recipe-card.js';
import {renderStatus} from '../utils/dom.js';

export function renderFavoritesView(state) {
  if (!state.session.authenticated) {
    return renderStatus({kind: 'empty', title: 'Войдите, чтобы увидеть избранное', text: 'Избранные рецепты принадлежат аккаунту и загружаются с backend.', action: 'show-auth', actionLabel: 'Войти'});
  }
  if (state.favoritesStatus === 'loading' || state.favoritesStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем избранное'});
  }
  if (state.favoritesStatus === 'error') {
    return renderStatus({kind: 'error', title: 'Избранное не загрузилось', action: 'retry-favorites'});
  }
  if (!state.favorites?.length) {
    return renderStatus({title: 'В избранном пусто', text: 'Отметьте рецепт звездой. Это не считается лайком и не скрывает карточку.', action: 'open-feed', actionLabel: 'Перейти в ленту'});
  }
  return `<div class="page-heading"><div><p class="eyebrow">ВАША КОЛЛЕКЦИЯ</p><h1>Избранные рецепты</h1><p class="page-subtitle">Только эти рецепты можно назначать в новые слоты рациона.</p></div><span class="count-pill">${state.favorites.length}</span></div>
    <div class="recipe-grid">${state.favorites.map((recipe) => renderRecipeTile(recipe, {
      isFavorite: true,
      busy: state.busy === `recipe-${recipe.id}`,
      removable: true,
    })).join('')}</div>`;
}
