import {apiErrorMessage} from '../api/errors.js';
import {escapeHtml, renderStatus} from '../utils/dom.js';
import {renderAuthView} from './auth-view.js';
import {renderFavoritesView} from './favorites-view.js';
import {renderFeedView} from './feed-view.js';
import {renderPlansView} from './plans-view.js';
import {renderRecipesView} from './recipes-view.js';
import {renderShoppingView} from './shopping-view.js';
import {plansUnavailable} from '../components/plans-error.js';

const NAV_ITEMS = [
  ['feed', 'Лента'],
  ['recipes', 'Рецепты'],
  ['favorites', 'Избранное'],
  ['plans', 'Рационы'],
  ['shopping', 'Покупки'],
];

function viewContent(state) {
  if (state.initialLoading) {
    return renderStatus({kind: 'loading', title: 'Загружаем FoodTinder'});
  }
  const renderers = {
    feed: renderFeedView,
    recipes: renderRecipesView,
    favorites: renderFavoritesView,
    plans: renderPlansView,
    shopping: renderShoppingView,
    auth: renderAuthView,
  };
  return (renderers[state.view] || renderFeedView)(state);
}

function errorBanner(state) {
  if (!state.error) return '';
  // The section explains a missing collection endpoint; do not add an unrelated "not found" banner.
  if (['plans', 'shopping'].includes(state.view) && plansUnavailable(state)
    && state.error === state.plansError) return '';
  const login = state.error.type === 'auth'
    ? '<button class="banner-link" data-action="show-auth">Войти снова</button>'
    : '';
  return `<div class="error-banner" role="alert"><span>${escapeHtml(apiErrorMessage(state.error))}</span>${login}<button class="banner-close" data-action="dismiss-error" aria-label="Закрыть">×</button></div>`;
}

export function renderShell(state) {
  return `<a class="skip-link" href="#main-content">К содержимому</a>
    <div class="app-shell">
      <header class="site-header">
        <button class="brand" data-action="open-feed" aria-label="FoodTinder, на главную">FoodTinder</button>
        <nav class="site-nav" aria-label="Основная навигация">
          ${NAV_ITEMS.map(([view, label]) => `<button class="nav-item" data-action="navigate" data-view="${view}"${state.view === view ? ' aria-current="page"' : ''}>${label}</button>`).join('')}
        </nav>
        <button class="account-button" data-action="navigate" data-view="auth"${state.view === 'auth' ? ' aria-current="page"' : ''}>
          ${state.session.authenticated ? 'Аккаунт' : 'Войти'}
        </button>
      </header>
      ${errorBanner(state)}
      <main id="main-content" tabindex="-1">${viewContent(state)}</main>
      <footer class="site-footer"><span>FoodTinder</span><a href="/assets/editorial/photo-credits.html">Авторы фотографий</a></footer>
    </div>`;
}
