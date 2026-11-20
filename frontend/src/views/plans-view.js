import {picture} from '../components/recipe-card.js';
import {DURATIONS, MEALS} from '../constants.js';
import {buildPlanDays} from '../utils/plans.js';
import {escapeAttr, escapeHtml, renderStatus} from '../utils/dom.js';
import {formatDate, isoToday} from '../utils/format.js';
import {renderPlansError} from '../components/plans-error.js';

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', {weekday: 'long', day: 'numeric', month: 'long'});
const DURATION_LABELS = {1: '1 день', 3: '3 дня', 7: '7 дней'};

function planPicker(state) {
  if (!state.plans?.length) return '';
  return `<label class="select-label">Выбранный рацион
    <select data-change="active-plan" ${state.busy ? 'disabled' : ''}>
      ${state.plans.map((plan) => `<option value="${plan.id}" ${Number(state.activePlanId) === plan.id ? 'selected' : ''}>${escapeHtml(formatDate(plan.start_date))}, ${DURATION_LABELS[plan.duration_days]} (№ ${plan.id})</option>`).join('')}
    </select>
  </label>`;
}

function createPlanForm(state) {
  return `<details class="create-plan" ${!state.plans?.length ? 'open' : ''}>
    <summary>Новый рацион</summary>
    <form data-form="create-plan" class="create-plan-form">
      <label>Дата начала<input name="start_date" type="date" value="${isoToday()}" required /></label>
      <fieldset><legend>Период</legend><div class="choice-row">${DURATIONS.map((days, index) => `<label><input type="radio" name="duration_days" value="${days}" ${index === 1 ? 'checked' : ''} />${DURATION_LABELS[days]}</label>`).join('')}</div></fieldset>
      <fieldset><legend>Приёмы пищи</legend><div class="choice-row meals-choice">${MEALS.map(({id, label}) => `<label><input type="checkbox" name="enabled_meals" value="${id}" ${id !== 'snack' ? 'checked' : ''} />${label}</label>`).join('')}</div></fieldset>
      <button class="button button-primary" type="submit" ${state.busy === 'create-plan' ? 'disabled' : ''}>Создать рацион</button>
    </form>
  </details>`;
}

function slotCard(state, dayIndex, meal) {
  const {slot} = meal;
  const mealId = `meal-${dayIndex}-${escapeAttr(meal.id)}`;
  const target = `data-plan-id="${state.activePlan.id}" data-day-index="${dayIndex}" data-meal-type="${escapeAttr(meal.id)}"`;
  const disabled = state.busy ? 'disabled' : '';
  return `<section class="slot-card ${slot ? 'slot-filled' : ''}" aria-labelledby="${mealId} plan-day-${dayIndex}">
    <h4 class="slot-heading" id="${mealId}">${escapeHtml(meal.label)}</h4>
    ${slot ? `<div class="slot-recipe">
      <div class="slot-photo-wrap">${picture({image_url: slot.recipe_image_url}, 'slot-photo', true, '')}</div>
      <div><strong>${escapeHtml(slot.recipe_title)}</strong><p>Порций: ${slot.servings}</p></div>
    </div>` : ''}
    <div class="slot-actions">
      <button id="pick-${mealId}" class="button button-small button-secondary" data-action="pick-slot" ${target} ${disabled}
        aria-haspopup="dialog" aria-describedby="${mealId} plan-day-${dayIndex}">${slot ? 'Заменить блюдо' : 'Выбрать блюдо'}</button>
      ${slot ? `<button class="button button-small button-ghost" data-action="delete-slot" ${target} ${disabled}
        aria-describedby="${mealId} plan-day-${dayIndex}">Удалить</button>` : ''}
    </div>
  </section>`;
}

function activePlan(state) {
  if (state.activePlanStatus === 'loading') return renderStatus({kind: 'loading', title: 'Загружаем рацион'});
  if (state.activePlanStatus === 'error') return renderStatus({kind: 'error', title: 'Рацион не загрузился', action: 'retry-active-plan'});
  if (!state.activePlan || state.activePlan.id !== Number(state.activePlanId)) return renderStatus({title: 'Выберите или создайте рацион'});
  const plan = state.activePlan;
  const days = buildPlanDays(plan);
  return `<section class="active-plan">
    <header class="active-plan-header">
      <h2>Меню на ${DURATION_LABELS[plan.duration_days]}</h2>
      <button class="button button-danger" data-action="delete-plan" ${state.busy === 'delete-plan' ? 'disabled' : ''}>Удалить рацион</button>
    </header>
    ${days.map((day) => `<section class="plan-day">
      <header class="plan-day-title"><h3 id="plan-day-${day.dayIndex}">${escapeHtml(DAY_FORMAT.format(day.date))}</h3></header>
      <div class="slots-grid">${day.meals.map((meal) => slotCard(state, day.dayIndex, meal)).join('')}</div>
    </section>`).join('')}
  </section>`;
}

export function renderPlansView(state) {
  if (!state.session.authenticated) {
    return renderStatus({title: 'Рационы доступны после входа', text: 'Для рациона можно выбрать блюда из избранного.', action: 'show-auth', actionLabel: 'Войти'});
  }
  if (state.plansStatus === 'loading' || state.plansStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем рационы'});
  }
  if (state.plansStatus === 'error') {
    return renderPlansError(state);
  }
  return `<div class="page-heading"><h1>Рационы</h1></div>
    <div class="plan-workspace${!state.plans?.length ? ' plan-workspace-single' : ''}">
      <div class="plan-tools">${planPicker(state)}${createPlanForm(state)}</div>
      ${!state.plans?.length ? renderStatus({title: 'Рационов пока нет', text: 'Добавьте в рацион блюда из избранного.'}) : activePlan(state)}
    </div>`;
}
