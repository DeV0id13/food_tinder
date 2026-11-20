import {calendarDay, isoToday} from './format.js';
import {MEALS} from '../constants.js';

export function compatibleFavorites(favorites, mealType) {
  return (favorites || []).filter((recipe) => recipe.meal_types?.includes(mealType));
}

export function slotFor(plan, dayIndex, mealType) {
  return plan?.slots?.find((slot) => slot.day_index === Number(dayIndex) && slot.meal_type === mealType) || null;
}

export function buildPlanDays(plan) {
  if (!plan || !hasValidPlanDates(plan)) return [];
  return Array.from({length: plan.duration_days}, (_, dayIndex) => ({
    dayIndex,
    date: calendarDay(plan.start_date, dayIndex),
    meals: MEALS.filter(({id}) => plan.enabled_meals.includes(id)).map((meal) => ({
      ...meal,
      slot: slotFor(plan, dayIndex, meal.id),
    })),
  }));
}

export function invalidateShopping(state) {
  state.shopping = null;
  state.shoppingStatus = 'idle';
}

const planRangeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

export function hasValidPlanDates(plan) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.start_date) || plan.start_date.startsWith('0000-')) return false;
  const start = calendarDay(plan.start_date);
  return Number.isFinite(start.valueOf()) && start.toISOString().slice(0, 10) === plan.start_date
    && calendarDay(plan.start_date, plan.duration_days - 1).getUTCFullYear() <= 9999;
}

export function planRange(plan) {
  return hasValidPlanDates(plan) ? planRangeFormat.formatRange(
    calendarDay(plan.start_date), calendarDay(plan.start_date, plan.duration_days - 1),
  ) : '';
}

export function planTitle(plan) {
  return plan.title?.trim() || (hasValidPlanDates(plan) ? `Рацион ${planRange(plan)}` : 'Рацион');
}

export function includedSlots(plan) {
  return plan.slots.filter(({day_index, meal_type}) =>
    day_index >= 0 && day_index < plan.duration_days && plan.enabled_meals.includes(meal_type));
}

export function planProgress(plan) {
  return {
    filled: plan.slots ? includedSlots(plan).length : plan.filled_slots ?? 0,
    total: plan.duration_days * plan.enabled_meals.length,
  };
}

function creationKey() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  // randomUUID requires a secure context; the LAN dev server also supports HTTP.
  const hex = [...globalThis.crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function makePlanDraft(saved = null) {
  const plan = saved ? structuredClone(saved) : {
    title: '', start_date: isoToday(), duration_days: 3, enabled_meals: ['breakfast', 'lunch', 'dinner'], slots: [],
  };
  return {
    plan, dirty: false, creationKey: saved ? null : creationKey(), omitted: 0, duplicate: false,
    generationServings: saved?.slots?.[0]?.servings || 1,
    generationRotation: 0, generationNotice: '',
  };
}

export function duplicatePlanDraft(source, favorites) {
  const draft = makePlanDraft();
  const allowed = new Map(favorites.map((recipe) => [recipe.id, recipe.meal_types]));
  const slots = includedSlots(source).filter((slot) => allowed.get(slot.recipe_id)?.includes(slot.meal_type));
  const copySuffix = ' (копия)';
  const title = [...(source.title || '')].slice(0, 120 - copySuffix.length).join('');
  Object.assign(draft.plan, {
    title: title ? title + copySuffix : '',
    duration_days: source.duration_days,
    enabled_meals: [...source.enabled_meals],
    slots: structuredClone(slots),
  });
  draft.duplicate = true;
  draft.dirty = true;
  draft.omitted = source.slots.length - slots.length;
  draft.generationServings = slots[0]?.servings || 1;
  return draft;
}

export function planDraftPayload(draft) {
  const {plan} = draft;
  return {
    title: plan.title?.trim() || '',
    start_date: plan.start_date,
    duration_days: plan.duration_days,
    enabled_meals: plan.enabled_meals,
    slots: includedSlots(plan).map(({day_index, meal_type, recipe_id, servings}) =>
      ({day_index, meal_type, recipe_id, servings})),
    ...(plan.id ? {version: plan.version} : {creation_key: draft.creationKey}),
  };
}
