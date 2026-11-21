import {difficultyLabel, formatIngredientQuantity, formatMealTypes, formatQuantity, formatUnit, nutritionItems} from '../utils/format.js';
import {escapeAttr, escapeHtml} from '../utils/dom.js';
export function picture(recipe, className, lazy = false, alt = recipe.title) {
  const fallback = `<span class="${className} recipe-photo-placeholder">Без фотографии</span>`;
  if (!recipe.image_url) return fallback;
  return `<img class="${className} recipe-image" src="${escapeAttr(recipe.image_url)}" alt="${escapeAttr(alt)}" ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'} />${fallback}`;
}

function favoriteButton(recipe, isFavorite, busy) {
  return `<button type="button" class="favorite-button" data-action="toggle-favorite" data-recipe-id="${recipe.id}" aria-pressed="${isFavorite}" aria-label="${isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}" ${busy ? 'disabled' : ''}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h12v16l-6-4-6 4z"/></svg>
  </button>`;
}

function recipeFacts(recipe, includeServings = false) {
  return `<ul class="recipe-facts">
    <li>${recipe.cooking_time_minutes} мин</li>
    <li>${escapeHtml(difficultyLabel(recipe.difficulty))}</li>
    ${includeServings ? `<li>Порций: ${recipe.base_servings}</li>` : ''}
  </ul>`;
}

function metrics(recipe) {
  const items = nutritionItems(recipe);
  if (!items.length) return '';
  return `<dl class="nutrition" aria-label="На одну порцию">${items.map(([label, value, unit = '']) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatQuantity(value))}${unit ? `&nbsp;${unit}` : ''}</dd></div>`).join('')}</dl>`;
}

export function renderFeatureRecipe(recipe, {isFavorite = false, busy = false} = {}) {
  return `<article class="feature-recipe" data-recipe-id="${recipe.id}">
    <div class="feature-body">
      <h1>${escapeHtml(recipe.title)}</h1>
      <p class="recipe-meals">${escapeHtml(formatMealTypes(recipe.meal_types))}</p>
      ${recipeFacts(recipe, true)}
      ${metrics(recipe)}
      <button class="text-button" data-action="recipe-detail" data-recipe-id="${recipe.id}">Смотреть рецепт</button>
      <div class="swipe-buttons" aria-label="Действия с рецептом" role="group">
        <button class="button button-dislike" data-action="swipe" data-swipe="dislike" data-recipe-id="${recipe.id}" ${busy ? 'disabled' : ''}>Не сегодня</button>
        <button class="button button-primary" data-action="swipe" data-swipe="like" data-recipe-id="${recipe.id}" ${busy ? 'disabled' : ''}>Нравится</button>
        ${favoriteButton(recipe, isFavorite, busy)}
      </div>
    </div>
    <div class="feature-photo-wrap">${picture(recipe, 'feature-photo')}</div>
  </article>`;
}

export function renderRecipeTile(recipe, {isFavorite = false, busy = false} = {}) {
  return `<article class="recipe-tile" data-recipe-id="${recipe.id}">
    <div class="tile-photo-wrap">
      ${picture(recipe, 'tile-photo', true)}
      ${favoriteButton(recipe, isFavorite, busy)}
    </div>
    <h3 class="tile-title">
      <button class="tile-title-button" data-action="recipe-detail" data-recipe-id="${recipe.id}">${escapeHtml(recipe.title)}</button>
    </h3>
    <p class="recipe-meals">${escapeHtml(formatMealTypes(recipe.meal_types))}</p>
    ${recipeFacts(recipe)}
  </article>`;
}

export function renderRecipeDetail(recipe) {
  const ingredients = recipe.ingredients?.length
    ? recipe.ingredients.map((item) => `<li><span>${escapeHtml(item.name)}</span><b>${escapeHtml(formatIngredientQuantity(item.quantity))} ${escapeHtml(formatUnit(item.unit))}</b></li>`).join('')
    : '<li class="muted">Состав не указан</li>';
  const steps = recipe.steps?.length
    ? recipe.steps.map((step, index) => `<li><span aria-hidden="true">${index + 1}</span><p>${escapeHtml(step)}</p></li>`).join('')
    : '<li class="muted">Шаги не указаны</li>';
  return `<div class="dialog-content">
    <button type="button" class="dialog-close" data-action="close-dialog" aria-label="Закрыть">×</button>
    <div class="detail-intro">
      <div class="dialog-header">
        <h2 id="dialog-title">${escapeHtml(recipe.title)}</h2>
        <p class="recipe-meals">${escapeHtml(formatMealTypes(recipe.meal_types))}</p>
        ${recipeFacts(recipe, true)}
        ${recipe.description ? `<p class="dialog-description">${escapeHtml(recipe.description)}</p>` : ''}
      </div>
      ${picture(recipe, 'detail-photo')}
    </div>
    <div class="detail-columns">
      <section><h3>Ингредиенты</h3><ul class="ingredient-list">${ingredients}</ul></section>
      <section><h3>Приготовление</h3><ol class="steps-list" role="list">${steps}</ol></section>
    </div>
  </div>`;
}
