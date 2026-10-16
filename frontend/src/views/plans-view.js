import {DURATIONS, MEALS} from '../constants.js';
import {compatibleFavorites, buildPlanDays} from '../utils/plans.js';
import {escapeAttr, escapeHtml, renderStatus} from '../utils/dom.js';
import {formatDate, isoToday} from '../utils/format.js';
import {renderPlansError} from '../components/plans-error.js';

function planPicker(state) {
  if (!state.plans?.length) return '';
  return `<label class="select-label">Активный рацион
    <select data-change="active-plan" ${state.busy ? 'disabled' : ''}>
      ${state.plans.map((plan) => `<option value="${plan.id}" ${Number(state.activePlanId) === plan.id ? 'selected' : ''}>#${plan.id} · ${escapeHtml(formatDate(plan.start_date))} · ${plan.duration_days} дн.</option>`).join('')}
    </select>
  </label>`;
}

function createPlanForm(state) {
  return `<details class="create-plan" ${!state.plans?.length ? 'open' : ''}>
    <summary>Создать новый рацион</summary>
    <form data-form="create-plan" class="create-plan-form">
      <label>Дата начала<input name="start_date" type="date" value="${isoToday()}" required /></label>
      <fieldset><legend>Период</legend><div class="choice-row">${DURATIONS.map((days, index) => `<label><input type="radio" name="duration_days" value="${days}" ${index === 1 ? 'checked' : ''} />${days} ${days === 1 ? 'день' : 'дня'}</label>`).join('')}</div></fieldset>
      <fieldset><legend>Приёмы пищи</legend><div class="choice-row meals-choice">${MEALS.map(({id, label}) => `<label><input type="checkbox" name="enabled_meals" value="${id}" ${id !== 'snack' ? 'checked' : ''} />${label}</label>`).join('')}</div></fieldset>
      <button class="button button-primary" type="submit" ${state.busy === 'create-plan' ? 'disabled' : ''}>Создать рацион</button>
    </form>
  </details>`;
}

function recipeOptions(state, mealType, slot) {
  const options = compatibleFavorites(state.favorites, mealType);
  const hasCurrent = slot && options.some(({id}) => id === slot.recipe_id);
  const current = slot && !hasCurrent ? `<option value="${slot.recipe_id}" selected>${escapeHtml(slot.recipe_title)} (уже в слоте)</option>` : '';
  return `<option value="">Выберите рецепт</option>${current}${options.map((recipe) => `<option value="${recipe.id}" ${slot?.recipe_id === recipe.id ? 'selected' : ''}>${escapeHtml(recipe.title)}</option>`).join('')}`;
}

function slotEditor(state, plan, dayIndex, meal) {
  const slot = meal.slot;
  const compatible = compatibleFavorites(state.favorites, meal.id);
  return `<form class="slot-card ${slot ? 'slot-filled' : ''}" data-form="slot" data-day-index="${dayIndex}" data-meal-type="${escapeAttr(meal.id)}">
    <div class="slot-heading"><span>${escapeHtml(meal.label)}</span>${slot ? '<b>Заполнен</b>' : '<b>Пусто</b>'}</div>
    <label>Рецепт<select name="recipe_id" required ${!compatible.length && !slot ? 'disabled' : ''}>${recipeOptions(state, meal.id, slot)}</select></label>
    <label>Порции<input name="servings" type="number" min="1" max="20" step="1" value="${slot?.servings || 1}" required /></label>
    <div class="slot-actions">
      <button class="button button-small button-primary" type="submit" ${state.busy === `slot-${dayIndex}-${meal.id}` || (!compatible.length && !slot) ? 'disabled' : ''}>${slot ? 'Сохранить' : 'Добавить'}</button>
      ${slot ? `<button class="button button-small button-ghost" type="button" data-action="delete-slot" data-day-index="${dayIndex}" data-meal-type="${escapeAttr(meal.id)}" ${state.busy === `slot-${dayIndex}-${meal.id}` ? 'disabled' : ''}>Удалить</button>` : ''}
    </div>
    ${!compatible.length && !slot ? '<p class="slot-help">Нет совместимых рецептов в избранном.</p>' : ''}
  </form>`;
}

function activePlan(state) {
  if (state.activePlanStatus === 'loading') return renderStatus({kind: 'loading', title: 'Загружаем рацион'});
  if (state.activePlanStatus === 'error') return renderStatus({kind: 'error', title: 'Рацион не загрузился', action: 'retry-active-plan'});
  if (!state.activePlan || state.activePlan.id !== Number(state.activePlanId)) return renderStatus({title: 'Выберите или создайте рацион'});
  const plan = state.activePlan;
  const days = buildPlanDays(plan);
  return `<section class="active-plan">
    <div class="active-plan-header"><div><p class="eyebrow">РАЦИОН #${plan.id}</p><h2>${escapeHtml(formatDate(plan.start_date))} · ${plan.duration_days} дн.</h2></div><button class="button button-danger" data-action="delete-plan" ${state.busy === 'delete-plan' ? 'disabled' : ''}>Удалить рацион</button></div>
    ${days.map((day) => `<section class="plan-day"><div class="plan-day-title"><b>День ${day.dayIndex + 1}</b><span>${escapeHtml(new Intl.DateTimeFormat('ru-RU', {weekday: 'long', day: 'numeric', month: 'long'}).format(day.date))}</span></div><div class="slots-grid">${day.meals.map((meal) => slotEditor(state, plan, day.dayIndex, meal)).join('')}</div></section>`).join('')}
  </section>`;
}

export function renderPlansView(state) {
  if (!state.session.authenticated) {
    return renderStatus({title: 'Рационы доступны после входа', text: 'Войдите, чтобы составлять и сохранять свой план питания.', action: 'show-auth', actionLabel: 'Войти'});
  }
  if (state.plansStatus === 'loading' || state.plansStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем рационы'});
  }
  if (state.plansStatus === 'error') {
    return renderPlansError(state);
  }
  return `<div class="page-heading"><div><p class="eyebrow">КОНСТРУКТОР</p><h1>Рационы</h1><p class="page-subtitle">Создайте период, затем назначайте совместимые рецепты из избранного.</p></div>${planPicker(state)}</div>
    ${createPlanForm(state)}
    ${!state.plans?.length ? renderStatus({title: 'Рационов пока нет', text: 'Создайте первый план на 1, 3 или 7 дней.'}) : activePlan(state)}`;
}
