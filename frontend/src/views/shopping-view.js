import {escapeHtml, renderStatus} from '../utils/dom.js';
import {formatDate, formatQuantity, formatUnit} from '../utils/format.js';
import {renderPlansError} from '../components/plans-error.js';

function planSelect(state) {
  return `<label class="select-label">Рацион
    <select data-change="shopping-plan" ${state.busy ? 'disabled' : ''}>
      ${state.plans.map((plan) => `<option value="${plan.id}" ${Number(state.shoppingPlanId) === plan.id ? 'selected' : ''}>${escapeHtml(formatDate(plan.start_date))}, ${plan.duration_days} дн. (№ ${plan.id})</option>`).join('')}
    </select>
  </label>`;
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
  return `${header}
    <div class="shopping-layout">
      <section class="shopping-card" aria-labelledby="shopping-title">
        <header class="shopping-card-header">
          <h2 id="shopping-title">Продукты</h2>
          <button class="button button-secondary button-small" data-action="refresh-shopping" ${state.busy === 'shopping' ? 'disabled' : ''}>Обновить</button>
        </header>
        ${items.length ? `<ul class="shopping-items">${items.map((item) => `<li><span>${escapeHtml(item.name)}</span><b>${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(formatUnit(item.unit))}</b></li>`).join('')}</ul>` : '<div class="compact-empty"><b>Список покупок пуст</b><span>Добавьте блюда в выбранный рацион.</span></div>'}
      </section>
      <aside class="export-card" aria-labelledby="export-title">
        <h2 id="export-title">Скачать список</h2>
        <div class="export-actions">
          <button class="button button-secondary" data-action="export-shopping" data-file-type="csv" aria-label="Скачать список в CSV">CSV</button>
          <button class="button button-secondary" data-action="export-shopping" data-file-type="txt" aria-label="Скачать список в TXT">TXT</button>
        </div>
      </aside>
    </div>`;
}
