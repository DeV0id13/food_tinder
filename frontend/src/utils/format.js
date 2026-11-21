import {MEAL_LABELS} from '../constants.js';

export function calendarDay(dateString, offset = 0) {
  const day = new Date(`${dateString}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day;
}

export function formatMealTypes(types = []) {
  return types.map((type, index) => {
    const label = MEAL_LABELS[type] || type;
    return index === 0 ? label : label.toLowerCase();
  }).join(', ');
}

export function formatQuantity(value) {
  return String(value ?? '').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1').replace('.', ',');
}

// Keep recipe quantities precise in the API, but show whole units to people.
// Most catalog amounts are fixed-point decimal strings. Parse those exactly,
// avoiding floating-point rounding near an integer boundary.
export function formatIngredientQuantity(value) {
  const raw = String(value ?? '').trim();
  const match = /^(\\d+)(?:\\.(\\d+))?$/.exec(raw);
  if (match) {
    const fraction = match[2] || '';
    return String(BigInt(match[1]) + (/[1-9]/.test(fraction) ? 1n : 0n));
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(Math.ceil(numeric)) : formatQuantity(value);
}

export function formatUnit(unit) {
  return {g: 'г', ml: 'мл', pcs: 'шт.'}[unit] ?? unit;
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
