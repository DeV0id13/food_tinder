import {VIEW_TITLES} from '../constants.js';
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
  ['feed', '♥', 'Лента'],
  ['recipes', '▦', 'Рецепты'],
  ['favorites', '★', 'Избранное'],
  ['plans', '□', 'Рационы'],
  ['shopping', '✓', 'Покупки'],
];

function viewContent(state) {
  if (state.initialLoading) {
    return renderStatus({kind: 'loading', title: 'Подключаемся к FoodTinder', text: 'Проверяем сессию и загружаем первую страницу ленты.'});
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
  const favoriteCount = state.favorites?.length || 0;
  const planCount = state.plans?.length || 0;
  return `${state.mode === 'demo' ? `<div class="demo-banner"><b>Демо-режим</b><span>Данные живут только в памяти вкладки и сбросятся после перезагрузки.</span><a href="/">Вернуться к real API</a></div>` : ''}
    <div class="app-shell ${state.mode === 'demo' ? 'has-demo-banner' : ''}">
      <aside class="sidebar">
        <button class="brand" data-action="open-feed" aria-label="На главную"><span>Food</span>Tinder<i>●</i></button>
        <p class="sidebar-caption">ПЕРВАЯ ИТЕРАЦИЯ</p>
        <nav aria-label="Основная навигация">
          ${NAV_ITEMS.map(([view, icon, label]) => `<button class="nav-item ${state.view === view ? 'active' : ''}" data-action="navigate" data-view="${view}"><span aria-hidden="true">${icon}</span>${label}${view === 'favorites' && favoriteCount ? `<b>${favoriteCount}</b>` : view === 'plans' && planCount ? `<b>${planCount}</b>` : ''}</button>`).join('')}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="mode-card"><span class="mode-dot"></span><div><b>${state.mode === 'demo' ? 'Demo API' : 'Real API'}</b><small>${state.mode === 'demo' ? 'Явно включён' : '/api/v1/'}</small></div></div>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <div><span>FoodTinder</span><i>/</i><b>${escapeHtml(VIEW_TITLES[state.view] || 'Лента')}</b></div>
          <button class="account-button" data-action="navigate" data-view="auth">
            <span class="account-dot">${state.session.authenticated ? escapeHtml(state.session.email?.slice(0, 1).toUpperCase()) : '?'}</span>
            <span>${state.session.authenticated ? escapeHtml(state.session.email) : 'Войти / регистрация'}</span>
          </button>
        </header>
        ${errorBanner(state)}
        <main>${viewContent(state)}</main>
        <footer><span>FoodTinder</span><span>Выбирайте блюда. Планируйте питание.</span></footer>
      </div>
    </div>`;
}
