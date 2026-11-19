import {MEALS} from '../constants.js';

export function compatibleFavorites(favorites, mealType) {
  return (favorites || []).filter((recipe) => recipe.meal_types?.includes(mealType));
}

export function slotFor(plan, dayIndex, mealType) {
  return plan?.slots?.find((slot) => slot.day_index === Number(dayIndex) && slot.meal_type === mealType) || null;
}

export function buildPlanDays(plan) {
  if (!plan) return [];
  const start = new Date(`${plan.start_date}T12:00:00`);
  return Array.from({length: plan.duration_days}, (_, dayIndex) => {
    const date = new Date(start);
    date.setDate(start.getDate() + dayIndex);
    return {
      dayIndex,
      date,
      meals: MEALS.filter(({id}) => plan.enabled_meals.includes(id)).map((meal) => ({
        ...meal,
        slot: slotFor(plan, dayIndex, meal.id),
      })),
    };
  });
}

export function invalidateShopping(state) {
  state.shopping = null;
  state.shoppingStatus = 'idle';
}
