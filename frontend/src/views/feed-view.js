import {renderFeatureRecipe} from '../components/recipe-card.js';
import {renderStatus} from '../utils/dom.js';

export function visibleFeedRecipes(state) {
  return (state.feed?.results || []).filter(({id}) => !state.guestHidden.has(id));
}

export function renderFeedView(state) {
  if (state.feedStatus === 'loading' || state.feedStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем ленту', text: 'Получаем актуальные рецепты с backend.'});
  }
  if (state.feedStatus === 'error') {
    return renderStatus({kind: 'error', title: 'Лента не загрузилась', text: 'Настоящий API недоступен или вернул ошибку.', action: 'retry-feed'});
  }
  const recipes = visibleFeedRecipes(state);
  if (!recipes.length) {
    return renderStatus({
      title: 'В ленте пока пусто',
      text: state.session.authenticated
        ? 'Вы уже оценили доступные рецепты. Загляните в общий каталог или попробуйте позже.'
        : 'Вы скрыли все карточки на этой странице. После перезагрузки гостевые скрытия исчезнут.',
      action: 'open-recipes',
      actionLabel: 'Открыть все рецепты',
    });
  }
  const recipe = recipes[0];
  return `<div class="page-heading">
      <div><p class="eyebrow">ВЫБОР БЛЮДА</p><h1>Что хочется приготовить?</h1><p class="page-subtitle">Like и «Не сегодня» убирают карточку только после подтверждения backend.</p></div>
      <div class="queue-counter"><strong>${recipes.length}</strong><span>в текущей выдаче</span></div>
    </div>
    <div class="feed-layout">
      ${renderFeatureRecipe(recipe, {
        isFavorite: state.favoriteIds.has(recipe.id),
        authenticated: state.session.authenticated,
        busy: state.busy === `recipe-${recipe.id}`,
      })}
      <aside class="feed-aside">
        <p class="eyebrow">КАК ЭТО РАБОТАЕТ</p>
        <h2>Три независимых действия</h2>
        <ol>
          <li><b>Нравится</b><span>Сохраняет like и обновляет первую страницу ленты.</span></li>
          <li><b>Не сегодня</b><span>Скрывает рецепт до следующей полуночи UTC.</span></li>
          <li><b>Звезда</b><span>Меняет избранное и не убирает карточку.</span></li>
        </ol>
        ${!state.session.authenticated ? '<div class="guest-note">Вы смотрите каталог как гость. Для сохранения действий понадобится вход.</div>' : ''}
      </aside>
    </div>`;
}
