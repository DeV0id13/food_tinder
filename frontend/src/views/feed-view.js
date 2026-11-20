import {renderFeatureRecipe, renderRecipeTile} from '../components/recipe-card.js';
import {renderStatus} from '../utils/dom.js';

export function visibleFeedRecipes(state) {
  return (state.feed?.results || []).filter(({id}) => !state.guestHidden.has(id));
}

function swipeNotice(state) {
  const message = state.lastSwipe?.message;
  return `<div class="swipe-notice${message ? ' swipe-notice-active' : ''}">
    <p role="status">${message || ''}</p>
    ${message ? `<button class="button button-small button-secondary" data-action="undo-swipe"
      ${state.busy ? 'disabled' : ''}>Отменить</button>` : ''}
  </div>`;
}

export function renderFeedView(state) {
  const notice = swipeNotice(state);
  if (state.feedStatus === 'loading' || state.feedStatus === 'idle') {
    return notice + renderStatus({kind: 'loading', title: 'Загружаем ленту'});
  }
  if (state.feedStatus === 'error') {
    return notice + renderStatus({kind: 'error', title: 'Лента не загрузилась', action: 'retry-feed'});
  }
  const recipes = visibleFeedRecipes(state);
  if (!recipes.length) {
    return notice + renderStatus({
      title: 'В ленте пока пусто',
      text: state.session.authenticated
        ? 'Другие блюда можно найти в каталоге.'
        : 'Скрытые рецепты вернутся после перезагрузки.',
      action: 'open-recipes',
      actionLabel: 'Открыть все рецепты',
    });
  }
  const [recipe, ...upNext] = recipes;
  return `${notice}<div class="feed-layout">
      ${renderFeatureRecipe(recipe, {
        isFavorite: state.favoriteIds.has(recipe.id),
        busy: Boolean(state.busy),
      })}
      ${upNext.length ? `<section class="feed-next" aria-labelledby="feed-next-title">
        <div class="section-heading"><h2 id="feed-next-title">Дальше в ленте</h2><button class="text-button" data-action="open-recipes">Все рецепты</button></div>
        <div class="recipe-grid">${upNext.slice(0, 3).map((nextRecipe) => renderRecipeTile(nextRecipe, {
            isFavorite: state.favoriteIds.has(nextRecipe.id),
          busy: Boolean(state.busy),
        })).join('')}</div>
      </section>` : ''}
    </div>`;
}
