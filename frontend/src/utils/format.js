import {MEAL_LABELS} from '../constants.js';

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', year: 'numeric'});

export function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateString : DATE_FORMAT.format(date);
}

export function formatMealTypes(types = []) {
  return types.map((type) => MEAL_LABELS[type] || type).join(' · ');
}

export function difficultyLabel(value) {
  const labels = ['Очень просто', 'Просто', 'Средне', 'Сложно', 'Для опытных'];
  return labels[Number(value) - 1] || `Сложность ${value}`;
}

export function nutritionItems(recipe) {
  return [
    ['ккал', recipe.kcal_per_serving],
    ['белки', recipe.protein_g_per_serving, 'г'],
    ['жиры', recipe.fat_g_per_serving, 'г'],
    ['углеводы', recipe.carbs_g_per_serving, 'г'],
    ['цена', recipe.estimated_price_rub_per_serving, '₽'],
  ].filter(([, value]) => value !== null && value !== undefined);
}

export function isoToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
