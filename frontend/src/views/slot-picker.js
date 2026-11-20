import {picture} from '../components/recipe-card.js';
import {MEAL_LABELS} from '../constants.js';
import {escapeHtml, renderStatus} from '../utils/dom.js';
import {calendarDay} from '../utils/format.js';
import {filterRecipes} from '../utils/search.js';

export function renderPickerResults(picker, favoritesStatus) {
  if (favoritesStatus === 'loading') return renderStatus({kind: 'loading', title: 'Загружаем избранное'});
  if (favoritesStatus === 'error') {
    return renderStatus({kind: 'error', title: 'Избранное не загрузилось', action: 'retry-picker'});
  }
  const recipes = filterRecipes(picker.recipes, picker.query);
  if (!recipes.length) {
    return `<div class="compact-empty"><strong>${picker.recipes.length ? 'Ничего не найдено' : 'Нет подходящих рецептов'}</strong>
      ${picker.recipes.length ? '<p>Попробуйте другое название блюда.</p>' : `<div class="slot-actions">
        <button type="button" class="text-button" data-action="navigate" data-view="favorites">Перейти в избранное</button>
        <button type="button" class="text-button" data-action="open-recipes">Открыть каталог</button>
      </div>`}
    </div>`;
  }
  return `<div class="picker-grid">${recipes.map((recipe) => `<label class="picker-choice">
    <input type="radio" name="picker-recipe" value="${recipe.id}" data-change="picker-recipe"
      ${picker.recipeId === recipe.id ? 'checked' : ''} />
    <span class="picker-card">
      <span class="picker-photo-wrap">${picture(recipe, 'picker-photo', true, '')}</span>
      <span class="picker-card-body"><strong>${escapeHtml(recipe.title)}</strong>
        <span>${recipe.cooking_time_minutes} мин${picker.slot?.recipe_id === recipe.id ? ' · Сейчас в рационе' : ''}</span>
      </span>
    </span>
  </label>`).join('')}</div>`;
}

export function pickedRecipeTitle(picker) {
  return picker.recipes.find(({id}) => id === picker.recipeId)?.title
    ?? (picker.slot?.recipe_id === picker.recipeId ? picker.slot.recipe_title : '');
}

export function renderSlotPicker(picker, favoritesStatus) {
  const date = calendarDay(picker.startDate, picker.dayIndex);
  const localDate = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(date);
  const currentOutsideFavorites = picker.slot && !picker.recipes.some(({id}) => id === picker.slot.recipe_id);
  return `<div class="dialog-content slot-picker">
    <button type="button" class="dialog-close" data-action="close-dialog" aria-label="Закрыть выбор блюда">×</button>
    <h2 id="dialog-title">${picker.slot ? 'Изменить блюдо' : 'Выбрать блюдо'}</h2>
    <p class="muted" id="picker-target">${escapeHtml(localDate)} · ${escapeHtml(MEAL_LABELS[picker.mealType])}</p>
    <form data-form="slot-picker" aria-describedby="picker-target">
      <fieldset class="picker-fields">
        <legend class="visually-hidden">Блюдо и количество порций</legend>
        <label>Поиск в избранном<input type="search" data-input="picker-search" autocomplete="off"
          aria-controls="picker-results" autofocus /></label>
        ${currentOutsideFavorites ? '<p class="muted">Текущее блюдо можно оставить и изменить его порции.</p>' : ''}
        <div id="picker-results" class="picker-results" data-picker-results>${renderPickerResults(picker, favoritesStatus)}</div>
        <div class="picker-footer">
          <p data-picker-selection role="status">${escapeHtml(pickedRecipeTitle(picker))}</p>
          <label>Порции<input name="servings" type="number" min="1" max="20" step="1" value="${picker.slot?.servings || 1}" required /></label>
          <button class="button button-primary" type="submit" ${picker.recipeId ? '' : 'disabled'}>Добавить в черновик</button>
        </div>
      </fieldset>
    </form>
  </div>`;
}
