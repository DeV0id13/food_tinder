import {difficultyLabel, formatMealTypes, nutritionItems} from '../utils/format.js';
import {escapeAttr, escapeHtml} from '../utils/dom.js';

function picture(recipe, className = 'recipe-photo') {
  if (!recipe.image_url) {
    return `<div class="${className} recipe-photo-placeholder" aria-label="Изображение отсутствует"><span>FoodTinder</span></div>`;
  }
  return `<img class="${className}" src="${escapeAttr(recipe.image_url)}" alt="${escapeAttr(recipe.title)}" loading="lazy" />`;
}

function metrics(recipe) {
  const items = nutritionItems(recipe);
  if (!items.length) return '<span class="muted">Пищевая ценность не указана</span>';
  return items.map(([label, value, unit = '']) => `<span><b>${escapeHtml(value)}${unit}</b><small>${escapeHtml(label)}</small></span>`).join('');
}

export function renderFeatureRecipe(recipe, {isFavorite = false, authenticated = false, busy = false} = {}) {
  return `<article class="feature-recipe" data-recipe-id="${recipe.id}">
    <div class="feature-photo-wrap">
      ${picture(recipe, 'feature-photo')}
      <div class="feature-photo-shade"></div>
      <span class="meal-badge">${escapeHtml(formatMealTypes(recipe.meal_types))}</span>
      <button class="favorite-button ${isFavorite ? 'is-favorite' : ''}" data-action="toggle-favorite" data-recipe-id="${recipe.id}" aria-pressed="${isFavorite}" aria-label="${isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}" ${busy ? 'disabled' : ''}>★</button>
      <div class="feature-title">
        <p>${authenticated ? 'Персональная лента' : 'Открытый каталог'}</p>
        <h2>${escapeHtml(recipe.title)}</h2>
      </div>
    </div>
    <div class="feature-body">
      <div class="recipe-facts">
        <span>⏱ ${recipe.cooking_time_minutes} мин</span>
        <span>◇ ${escapeHtml(difficultyLabel(recipe.difficulty))}</span>
        <span>◌ ${recipe.base_servings} баз. порц.</span>
        <button class="text-button" data-action="recipe-detail" data-recipe-id="${recipe.id}">Подробнее</button>
      </div>
      <div class="feature-footer">
        <div class="nutrition">${metrics(recipe)}</div>
        <div class="swipe-buttons">
          <button class="button button-dislike" data-action="swipe" data-swipe="dislike" data-recipe-id="${recipe.id}" ${busy ? 'disabled' : ''}>Не сегодня</button>
          <button class="button button-primary" data-action="swipe" data-swipe="like" data-recipe-id="${recipe.id}" ${busy ? 'disabled' : ''}>Нравится</button>
        </div>
      </div>
    </div>
  </article>`;
}

export function renderRecipeTile(recipe, {isFavorite = false, busy = false, removable = false} = {}) {
  return `<article class="recipe-tile" data-recipe-id="${recipe.id}">
    <div class="tile-photo-wrap">
      ${picture(recipe, 'tile-photo')}
      <button class="favorite-button ${isFavorite ? 'is-favorite' : ''}" data-action="toggle-favorite" data-recipe-id="${recipe.id}" aria-pressed="${isFavorite}" aria-label="${removable ? 'Убрать из избранного' : isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}" ${busy ? 'disabled' : ''}>★</button>
    </div>
    <div class="tile-body">
      <p class="eyebrow">${escapeHtml(formatMealTypes(recipe.meal_types))}</p>
      <h3>${escapeHtml(recipe.title)}</h3>
      <p class="tile-meta">${recipe.cooking_time_minutes} мин · ${escapeHtml(difficultyLabel(recipe.difficulty))}</p>
      <button class="text-button" data-action="recipe-detail" data-recipe-id="${recipe.id}">Смотреть рецепт</button>
    </div>
  </article>`;
}

export function renderRecipeDetail(recipe) {
  const ingredients = recipe.ingredients?.length
    ? recipe.ingredients.map((item) => `<li><span>${escapeHtml(item.name)}</span><b>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</b></li>`).join('')
    : '<li class="muted">Состав не указан</li>';
  const steps = recipe.steps?.length
    ? recipe.steps.map((step, index) => `<li><span>${index + 1}</span><p>${escapeHtml(step)}</p></li>`).join('')
    : '<li class="muted">Шаги не указаны</li>';
  return `<div class="dialog-header">
      <div><p class="eyebrow">${escapeHtml(formatMealTypes(recipe.meal_types))}</p><h2 id="dialog-title">${escapeHtml(recipe.title)}</h2></div>
      <button class="dialog-close" data-action="close-dialog" aria-label="Закрыть">×</button>
    </div>
    <p class="dialog-description">${escapeHtml(recipe.description || 'Описание не указано.')}</p>
    <div class="detail-columns">
      <section><h3>Ингредиенты</h3><ul class="ingredient-list">${ingredients}</ul></section>
      <section><h3>Приготовление</h3><ol class="steps-list">${steps}</ol></section>
    </div>`;
}
