import {escapeAttr, escapeHtml, renderStatus} from '../utils/dom.js';
import {formatIngredientQuantity, formatUnit} from '../utils/format.js';
import {renderPlansError} from '../components/plans-error.js';
import {planTitle} from '../utils/plans.js';
import {groupShoppingItems} from '../utils/shopping.js';

function planSelect(state) {
  return `<label class="select-label">Рацион
    <select data-change="shopping-plan" ${state.busy ? 'disabled' : ''}>
      ${state.plans.map((plan) => `<option value="${plan.id}" ${Number(state.shoppingPlanId) === plan.id ? 'selected' : ''}>${escapeHtml(planTitle(plan))}</option>`).join('')}
    </select>
  </label>`;
}

function checklist(state, items) {
  const disabled = state.busy ? 'disabled' : '';
  return groupShoppingItems(items).map(([label, group]) => `<section class="shopping-group">
    <h3>${label}</h3>
    <ul class="shopping-items">${group.map((item) => `<li class="${item.purchased ? 'is-purchased' : ''}">
      <label class="shopping-item">
        <input id="purchase-${item.ingredient_id}" type="checkbox" data-change="purchase"
          data-plan-id="${state.shopping.plan_id}" data-ingredient-id="${item.ingredient_id}"
          aria-label="Куплено: ${escapeAttr(item.name)}" ${item.purchased ? 'checked' : ''} ${disabled} />
        <span>${escapeHtml(item.name)}</span>
        <b>${escapeHtml(formatIngredientQuantity(item.quantity))} ${escapeHtml(formatUnit(item.unit))}</b>
      </label>
    </li>`).join('')}</ul>
  </section>`).join('');
}

export function renderShoppingView(state) {
  if (!state.session.authenticated) {
    return renderStatus({title: 'Покупки доступны после входа', text: 'Список составляется из ингредиентов выбранного рациона.', action: 'show-auth', actionLabel: 'Войти'});
  }
  if (state.plansStatus === 'loading' || state.plansStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем рационы'});
  }
  if (state.plansStatus === 'error') {
    return renderPlansError(state, true);
  }
  if (!state.plans?.length) {
    return renderStatus({title: 'Сначала создайте рацион', text: 'Добавьте блюда, чтобы собрать список покупок.', action: 'open-plans', actionLabel: 'Создать рацион'});
  }
  const header = `<div class="page-heading"><h1>Список покупок</h1>${planSelect(state)}</div>`;
  if (state.shoppingStatus === 'loading' || state.shoppingStatus === 'idle') {
    return `${header}${renderStatus({kind: 'loading', title: 'Рассчитываем покупки'})}`;
  }
  if (state.shoppingStatus === 'error') {
    return `${header}${renderStatus({kind: 'error', title: 'Список не загрузился', action: 'retry-shopping'})}`;
  }
  const items = state.shopping?.items || [];
  const purchased = items.filter((item) => item.purchased).length;
  const disabled = state.busy ? 'disabled' : '';
  return `${header}
    <div class="shopping-layout">
      <section class="shopping-card" aria-labelledby="shopping-title">
        <header class="shopping-card-header">
          <div><h2 id="shopping-title">Продукты</h2>
            ${items.length ? `<p class="shopping-progress" role="status">Куплено ${purchased} из ${items.length}</p>` : ''}
          </div>
          <button class="button button-secondary button-small" data-action="refresh-shopping" ${disabled}>Обновить</button>
        </header>
        ${items.length ? checklist(state, items) : `<div class="compact-empty"><b>Список покупок пуст</b>
          <span>Добавьте блюда в выбранный рацион.</span><button class="text-button" data-action="edit-plan" data-plan-id="${state.shoppingPlanId}">Открыть рацион</button>
        </div>`}
        ${purchased ? `<button class="button button-small button-ghost" data-action="clear-purchases"
          data-plan-id="${state.shopping.plan_id}" ${disabled}>Снять все отметки</button>` : ''}
      </section>
      <aside class="export-card" aria-labelledby="export-title">
        <h2 id="export-title">Скачать список</h2>
        <div class="export-actions">
          <button class="button button-secondary" data-action="export-shopping" data-file-type="csv" aria-label="Скачать список в CSV" ${disabled}>CSV</button>
          <button class="button button-secondary" data-action="export-shopping" data-file-type="txt" aria-label="Скачать список в TXT" ${disabled}>TXT</button>
        </div>
      </aside>
    </div>`;
}
