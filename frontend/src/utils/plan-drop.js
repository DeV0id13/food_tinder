import {DURATIONS, MEAL_LABELS} from '../constants.js';
import {hasValidPlanDates, slotFor} from './plans.js';

const isRecipeId = (id) => Number.isSafeInteger(id) && id > 0;
const validServings = (servings) => Number.isInteger(servings) && servings >= 1 && servings <= 20;
const at = (slot, address) => slot.day_index === address.day_index && slot.meal_type === address.meal_type;

export function validSlot(plan, address) {
  return Boolean(address && Number.isInteger(address.day_index)
    && address.day_index >= 0 && address.day_index < plan.duration_days
    && Object.hasOwn(MEAL_LABELS, address.meal_type) && plan.enabled_meals.includes(address.meal_type));
}

function canTransferRecipe(recipe, meal) {
  if (!recipe || recipe.is_active === false) return 'Доступны только активные рецепты из избранного.';
  if (!recipe.meal_types?.includes(meal)) return `Блюдо не подходит для приёма пищи «${MEAL_LABELS[meal]}».`;
  return '';
}

export function planDrop(source, destination, draft, favorites) {
  const plan = draft?.plan;
  const unchanged = (result, reason = '') => ({nextSlots: plan?.slots, result, reason});
  const blocked = (reason) => unchanged('blocked', reason);
  if (!Array.isArray(plan?.slots) || !Array.isArray(plan.enabled_meals)
    || !DURATIONS.includes(plan.duration_days) || !hasValidPlanDates(plan)) {
    return blocked('Откройте черновик с корректными настройками рациона.');
  }
  if (!validSlot(plan, destination)) return blocked('Выберите включённый приём пищи в этом рационе.');

  const {day_index, meal_type} = destination;
  const target = slotFor(plan, day_index, meal_type);
  if (source?.type === 'slot') {
    if (!validSlot(plan, source)) return blocked('Исходный слот недоступен.');
    const origin = slotFor(plan, source.day_index, source.meal_type);
    if (!origin || origin.recipe_id !== source.recipe_id || !isRecipeId(origin.recipe_id)
      || !validServings(origin.servings)) return blocked('Исходное блюдо изменилось.');
    if (at(origin, destination)) return unchanged('noop');
    const reason = canTransferRecipe(favorites.find(({id}) => id === origin.recipe_id), meal_type)
      || (target && canTransferRecipe(favorites.find(({id}) => id === target.recipe_id), origin.meal_type));
    if (reason) return blocked(target ? `Обмен невозможен. ${reason}` : reason);
    if (target && (!isRecipeId(target.recipe_id) || !validServings(target.servings))) {
      return blocked('Данные целевого блюда некорректны.');
    }
    if (target?.recipe_id === origin.recipe_id && target.servings === origin.servings) return unchanged('noop');
    return {
      nextSlots: plan.slots.flatMap((slot) => {
        if (at(slot, source)) return target ? [{...target, day_index: origin.day_index, meal_type: origin.meal_type}] : [];
        if (at(slot, destination)) return [{...origin, day_index, meal_type}];
        return [slot];
      }).concat(target ? [] : [{...origin, day_index, meal_type}]),
      result: target ? 'swapped' : 'moved', reason: '',
    };
  }
  if (source?.type !== 'favorite' || !isRecipeId(source.recipe_id)) return blocked('Исходный рецепт недоступен.');
  const recipe = favorites.find(({id}) => id === source.recipe_id);
  const reason = canTransferRecipe(recipe, meal_type);
  if (reason) return blocked(reason);
  if (target?.recipe_id === recipe.id) return unchanged('noop');
  const servings = target?.servings ?? draft.generationServings ?? 1;
  if (!validServings(servings)) return blocked('Укажите количество порций от 1 до 20.');
  return {
    nextSlots: [...plan.slots.filter((slot) => !at(slot, destination)), {
      day_index, meal_type, recipe_id: recipe.id, servings,
      recipe_title: recipe.title, recipe_image_url: recipe.image_url,
    }],
    result: target ? 'replaced' : 'added', reason: '',
  };
}

// The existing editor allows a saved recipe to remain at its original address.
export function unavailableDraftSlot(plan, saved, favorites) {
  return plan.slots.find((slot) => {
    if (!validSlot(plan, slot)) return true;
    const original = slotFor(saved, slot.day_index, slot.meal_type);
    if (original?.recipe_id === slot.recipe_id) return false;
    return Boolean(canTransferRecipe(favorites.find(({id}) => id === slot.recipe_id), slot.meal_type));
  });
}
