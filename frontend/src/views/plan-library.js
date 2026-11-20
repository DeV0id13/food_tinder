import {picture} from '../components/recipe-card.js';
import {escapeAttr, escapeHtml} from '../utils/dom.js';
import {filterRecipes} from '../utils/search.js';

export function transferHandle(address, title, label, disabled) {
  return `<button type="button" class="plan-drag-handle" data-transfer-source ${address} ${disabled ? 'disabled' : ''}
    aria-label="${label}: ${escapeAttr(title)}" aria-describedby="plan-transfer-help" aria-pressed="false">
    <span aria-hidden="true">⠿</span></button>`;
}

export function renderLibraryResults(state, query) {
  if (state.favoritesStatus === 'loading' || state.favoritesStatus === 'idle') return '<p>Загружаем избранное…</p>';
  if (state.favoritesStatus === 'error') {
    return '<p>Избранное не загрузилось.</p><button class="text-button" data-action="retry-favorites">Повторить</button>';
  }
  const recipes = filterRecipes((state.favorites ?? []).filter((recipe) => recipe.is_active !== false), query);
  if (!recipes.length) return `<p>${query.trim() ? 'По вашему запросу ничего не найдено.' : 'Сохраните любимые блюда в избранное.'}</p>`;
  return recipes.map((recipe) => `<article class="plan-library-card">
    <div class="plan-library-photo">${picture(recipe, 'slot-photo', true, '')}</div>
    <div><strong>${escapeHtml(recipe.title)}</strong><p class="muted">${escapeHtml(recipe.cooking_time_minutes ?? '—')} мин</p></div>
    ${transferHandle(`data-recipe-id="${recipe.id}"`, recipe.title, 'Добавить в рацион', state.busy)}
  </article>`).join('');
}

export function renderPlanLibrary(state, {query, open}) {
  return `<details class="plan-library" data-plan-library ${open ? 'open' : ''}>
    <summary>Избранные рецепты</summary>
    <div class="plan-library-content">
      <label>Поиск рецептов<input type="search" data-library-search value="${escapeAttr(query)}" ${state.busy ? 'disabled' : ''}></label>
      <p id="plan-transfer-help" class="muted">Потяните за ⠿ или нажмите на него и выберите слот.</p>
      <div class="plan-library-results" data-library-results>${renderLibraryResults(state, query)}</div>
    </div>
  </details>`;
}
