import {picture} from '../components/recipe-card.js';
import {DURATIONS, MEALS} from '../constants.js';
import {buildPlanDays, planProgress, planRange, planTitle} from '../utils/plans.js';
import {escapeAttr, escapeHtml, renderStatus} from '../utils/dom.js';
import {renderPlansError} from '../components/plans-error.js';

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'});
const DURATION_LABELS = {1: '1 день', 3: '3 дня', 7: '7 дней'};

function slotCard(state, dayIndex, meal) {
  const {slot} = meal;
  const mealId = `meal-${dayIndex}-${escapeAttr(meal.id)}`;
  const target = `data-plan-id="${state.planDraft.plan.id ?? 0}" data-day-index="${dayIndex}" data-meal-type="${escapeAttr(meal.id)}"`;
  const disabled = state.busy ? 'disabled' : '';
  return `<section class="slot-card ${slot ? 'slot-filled' : ''}" aria-labelledby="${mealId} plan-day-${dayIndex}">
    <h4 class="slot-heading" id="${mealId}">${escapeHtml(meal.label)}</h4>
    ${slot ? `<div class="slot-recipe">
      <div class="slot-photo-wrap">${picture({image_url: slot.recipe_image_url}, 'slot-photo', true, '')}</div>
      <div><strong>${escapeHtml(slot.recipe_title)}</strong><p>Порций: ${slot.servings}</p></div>
    </div>` : ''}
    <div class="slot-actions">
      <button id="pick-${mealId}" class="button button-small button-secondary" data-action="pick-slot" ${target} ${disabled}
        aria-haspopup="dialog" aria-describedby="${mealId} plan-day-${dayIndex}">${slot ? 'Изменить блюдо' : 'Выбрать блюдо'}</button>
      ${slot ? `<button class="button button-small button-ghost" data-action="delete-slot" ${target} ${disabled}
        aria-describedby="${mealId} plan-day-${dayIndex}">Удалить</button>` : ''}
    </div>
  </section>`;
}

function progress(plan) {
  const {filled, total} = planProgress(plan);
  return `<div class="plan-progress">
    <p>${filled} из ${total} приёмов пищи заполнено</p>
    <progress aria-label="Заполненные приёмы пищи" value="${filled}" max="${total || 1}"></progress>
  </div>`;
}

function savedPlans(state) {
  const {plans} = state;
  const disabled = state.busy ? 'disabled' : '';
  return `<header class="page-heading plans-heading">
    <div><h1>Мои рационы</h1><p class="muted">Сохранено рационов · ${plans.length}</p></div>
    ${plans.length ? `<button class="button button-primary" data-action="new-plan" ${disabled}>Создать рацион</button>` : ''}
  </header>
    ${plans.length ? `<div class="saved-plan-grid">${plans.map((plan) => `<article class="saved-plan">
      <header><h2>${escapeHtml(planTitle(plan))}</h2>
        <p class="muted">${escapeHtml(planRange(plan))} · ${DURATION_LABELS[plan.duration_days]}</p>
      </header>
      ${progress(plan)}
      <div class="plan-card-actions">
        <button class="button button-secondary" data-action="edit-plan" data-plan-id="${plan.id}" ${disabled}>Редактировать</button>
        <button class="button button-secondary" data-action="plan-shopping" data-plan-id="${plan.id}" ${disabled}>Список покупок</button>
        <button class="text-button" data-action="duplicate-plan" data-plan-id="${plan.id}" ${disabled}>Дублировать</button>
        <button class="text-button plan-delete" data-action="delete-plan" data-plan-id="${plan.id}" ${disabled}>Удалить</button>
      </div>
    </article>`).join('')}</div>` : renderStatus({
      title: 'Рационов пока нет', text: 'Составьте меню на один, три или семь дней.',
      action: 'new-plan', actionLabel: 'Создать первый рацион',
    })}`;
}

export function draftStatus(state) {
  return state.busy === 'save-plan' ? 'Сохраняем…'
    : state.planDraft.dirty ? 'Есть несохранённые изменения'
      : state.planDraft.plan.id ? 'Сохранено' : 'Новый черновик';
}

function planEditor(state) {
  const {plan, duplicate, omitted, dirty} = state.planDraft;
  const disabled = state.busy ? 'disabled' : '';
  const dates = buildPlanDays(plan);
  return `<header class="page-heading editor-heading">
      <button class="text-button" data-action="plan-list">← Мои рационы</button>
      <h1 tabindex="-1" id="plan-editor-title">${plan.id ? 'Редактировать рацион' : duplicate ? 'Копия рациона' : 'Новый рацион'}</h1>
    </header>
    <div class="plan-workspace">
      <div class="plan-settings">
        <form data-form="plan-editor" class="plan-editor-form">
          <fieldset class="plan-configuration" ${disabled}>
            <label>Название (необязательно)<input name="title" data-input="plan-title" maxlength="120"
              value="${escapeAttr(plan.title)}" placeholder="${escapeAttr(planTitle({...plan, title: ''}))}" /></label>
            <label>Дата начала<input name="start_date" data-change="plan-date" type="date"
              min="0001-01-01" max="9999-12-31" value="${escapeAttr(plan.start_date)}" required /></label>
            <div><p class="muted">${escapeHtml(planRange(plan) || 'Выберите корректную дату начала.')}</p>
              ${duplicate ? '<p class="muted">Выберите дату начала для копии.</p>' : ''}
            </div>
            <fieldset><legend>Длительность</legend><div class="choice-row">
              ${DURATIONS.map((days) => `<label><input type="radio" name="duration_days" data-change="plan-duration" value="${days}" ${plan.duration_days === days ? 'checked' : ''} />${DURATION_LABELS[days]}</label>`).join('')}
            </div></fieldset>
            <fieldset><legend>Приёмы пищи</legend><div class="choice-row meals-choice">
              ${MEALS.map(({id, label}) => `<label><input type="checkbox" name="enabled_meals" data-change="plan-meal" value="${id}" ${plan.enabled_meals.includes(id) ? 'checked' : ''} />${label}</label>`).join('')}
            </div></fieldset>
          </fieldset>
          ${omitted ? `<p class="inline-notice">Пропущено блюд · ${omitted}. Для копии доступны опубликованные рецепты из избранного, подходящие для этого приёма пищи.</p>` : ''}
          <p class="draft-status" data-draft-status tabindex="-1" role="status">${draftStatus(state)}</p>
          <div class="plan-editor-actions">
            <button class="button button-primary" type="submit" ${disabled}>Сохранить рацион</button>
            <button class="text-button" type="button" data-action="discard-draft" ${disabled}
              ${plan.id && !dirty ? 'hidden' : ''}>Отменить изменения</button>
            ${plan.id ? `<button class="button button-secondary" type="button" data-action="plan-shopping" data-plan-id="${plan.id}" ${disabled}>Список покупок</button>` : ''}
          </div>
        </form>
      </div>
      <section class="active-plan" aria-labelledby="plan-menu-title">
        <header class="active-plan-header">
          <h2 id="plan-menu-title">Меню</h2>
          ${progress(plan)}
        </header>
        ${dates.map((day) => `<section class="plan-day">
          <header class="plan-day-title"><h3 id="plan-day-${day.dayIndex}">${escapeHtml(DAY_FORMAT.format(day.date))}</h3></header>
          <div class="slots-grid">${day.meals.map((meal) => slotCard(state, day.dayIndex, meal)).join('')}</div>
        </section>`).join('')}
      </section>
    </div>`;
}

export function renderPlansView(state) {
  if (!state.session.authenticated) {
    return renderStatus({title: 'Рационы доступны после входа', text: 'Для рациона можно выбрать блюда из избранного.', action: 'show-auth', actionLabel: 'Войти'});
  }
  if (state.planMode === 'list') {
    if (state.plansStatus === 'loading' || state.plansStatus === 'idle') {
      return renderStatus({kind: 'loading', title: 'Загружаем рационы'});
    }
    return state.plansStatus === 'error' ? renderPlansError(state) : savedPlans(state);
  }
  if (state.activePlanStatus === 'loading') return renderStatus({kind: 'loading', title: 'Загружаем рацион'});
  if (state.activePlanStatus === 'error') {
    return `<button class="text-button" data-action="plan-list">← Мои рационы</button>
      ${renderStatus({kind: 'error', title: 'Рацион не загрузился', action: 'retry-active-plan'})}`;
  }
  return state.planDraft ? planEditor(state) : '';
}

export function renderShoppingDecision() {
  return `<div class="dialog-content plan-confirmation">
    <h2 id="dialog-title">Есть несохранённые изменения</h2>
    <p>Перед переходом к покупкам сохраните рацион или отмените изменения.</p>
    <div class="plan-card-actions">
      <button class="button button-primary" data-action="save-and-shop">Сохранить и открыть покупки</button>
      <button class="button button-secondary" data-action="discard-and-shop">Отменить изменения</button>
      <button class="text-button" data-action="close-dialog" autofocus>Остаться</button>
    </div>
  </div>`;
}
