import {MEALS} from '../constants.js';
import {includedSlots} from './plans.js';

/**
 * Fill only missing meal slots by default. The result is a local draft; this
 * function never writes to the API or mutates the caller's plan.
 *
 * Choose the least-used compatible favorite, strongly penalizing recipes
 * already assigned on the same day and mildly penalizing consecutive days.
 * A deterministic rotation allows the user to request a different menu.
 */
export function generatePlanSlots(plan, favorites, {servings = 1, replace = false, rotation = 0} = {}) {
  if (!Number.isInteger(servings) || servings < 1 || servings > 20) {
    throw new RangeError('Количество порций должно быть от 1 до 20.');
  }
  const unique = new Map();
  for (const recipe of favorites || []) {
    if (Number.isInteger(recipe.id) && recipe.id > 0 && typeof recipe.title === 'string'
      && Array.isArray(recipe.meal_types) && !unique.has(recipe.id)) unique.set(recipe.id, recipe);
  }
  const recipes = [...unique.values()].sort((a, b) => a.id - b.id);
  const slots = replace ? [] : includedSlots(plan).map((slot) => ({...slot}));
  const count = new Map();
  const usedDays = new Map();

  for (const slot of slots) {
    count.set(slot.recipe_id, (count.get(slot.recipe_id) || 0) + 1);
    if (!usedDays.has(slot.recipe_id)) usedDays.set(slot.recipe_id, new Set());
    usedDays.get(slot.recipe_id).add(slot.day_index);
  }

  const meals = MEALS.filter(({id}) => plan.enabled_meals.includes(id));
  let generated = 0;
  let missing = 0;
  let repeated = 0;

  for (let day = 0; day < plan.duration_days; day++) {
    for (const {id: mealType} of meals) {
      if (slots.some((slot) => slot.day_index === day && slot.meal_type === mealType)) continue;

      const compatible = recipes.filter((recipe) => recipe.meal_types.includes(mealType));
      if (!compatible.length) {
        missing += 1;
        continue;
      }

      const shift = ((rotation % compatible.length) + compatible.length) % compatible.length;
      const ranked = compatible.map((recipe, index) => {
        const days = usedDays.get(recipe.id);
        const onSameDay = days?.has(day) ? 1 : 0;
        const adjacentDay = days && [...days].some((previousDay) => Math.abs(day - previousDay) === 1) ? 1 : 0;
        const usage = count.get(recipe.id) || 0;
        const tie = (index - shift + compatible.length) % compatible.length;
        return {recipe, score: onSameDay * 10000 + usage * 100 + adjacentDay * 25 + tie};
      });
      ranked.sort((a, b) => a.score - b.score);
      const {recipe} = ranked[0];
      if (count.has(recipe.id)) repeated += 1;
      slots.push({
        day_index: day,
        meal_type: mealType,
        recipe_id: recipe.id,
        recipe_title: recipe.title,
        recipe_image_url: recipe.image_url || '',
        servings,
      });
      count.set(recipe.id, (count.get(recipe.id) || 0) + 1);
      if (!usedDays.has(recipe.id)) usedDays.set(recipe.id, new Set());
      usedDays.get(recipe.id).add(day);
      generated += 1;
    }
  }

  const mealOrder = new Map(MEALS.map(({id}, index) => [id, index]));
  slots.sort((a, b) => a.day_index - b.day_index
    || mealOrder.get(a.meal_type) - mealOrder.get(b.meal_type));

  return {slots, generated, missing, repeated, total: plan.duration_days * meals.length};
}
