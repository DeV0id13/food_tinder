import {COOKING_TIMES, MEALS} from '../constants.js';
import {escapeAttr} from '../utils/dom.js';

export function renderRecipeFilters(scope, {query, meal, maxTime}, {extra, note = '', count, results}) {
  const search = scope === 'catalog' ? 'recipe-search' : 'favorite-search';
  const resultsId = scope === 'catalog' ? 'recipe-results' : 'favorite-results';
  return `<div class="recipe-search">
      <label>Поиск по названию
        <input id="${search}" type="search" data-input="${search}"
          value="${escapeAttr(query)}" placeholder="Например, борщ"
          ${scope === 'catalog' ? 'maxlength="200"' : ''} autocomplete="off" aria-controls="${resultsId}" />
      </label>
      <div class="catalog-filters">
        <label>Приём пищи<select data-change="${scope}-meal" aria-controls="${resultsId}">
          <option value="">Все</option>
          ${MEALS.map(({id, label}) => `<option value="${id}" ${meal === id ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label>Время готовки<select data-change="${scope}-time" aria-controls="${resultsId}">
          <option value="">Любое</option>
          ${COOKING_TIMES.map((time) => `<option value="${time}" ${maxTime === time ? 'selected' : ''}>До ${time} мин</option>`).join('')}
        </select></label>
        ${extra}
      </div>
      ${note}
      <div class="catalog-summary">
        <p data-${scope}-count role="status">${count}</p>
        <button class="text-button" data-action="reset-${scope}">Сбросить фильтры</button>
      </div>
    </div>
    <section id="${resultsId}" data-${scope}-results ${scope === 'catalog' ? 'tabindex="-1"' : ''}>${results}</section>`;
}
