import {escapeHtml, renderStatus} from '../utils/dom.js';
import {formatDate} from '../utils/format.js';

function planSelect(state) {
  return `<label class="select-label">Рацион
    <select data-change="shopping-plan">
      ${state.plans.map((plan) => `<option value="${plan.id}" ${Number(state.shoppingPlanId) === plan.id ? 'selected' : ''}>#${plan.id} · ${escapeHtml(formatDate(plan.start_date))} · ${plan.duration_days} дн.</option>`).join('')}
    </select>
  </label>`;
}

export function renderShoppingView(state) {
  if (!state.session.authenticated) {
    return renderStatus({title: 'Список покупок доступен после входа', text: 'Он рассчитывается backend по выбранному рациону.', action: 'show-auth', actionLabel: 'Войти'});
  }
  if (state.plansStatus === 'loading' || state.plansStatus === 'idle') {
    return renderStatus({kind: 'loading', title: 'Загружаем рационы'});
  }
  if (!state.plans?.length) {
    return renderStatus({title: 'Сначала создайте рацион', text: 'Без рациона backend не сможет рассчитать покупки.', action: 'open-plans', actionLabel: 'Создать рацион'});
  }
  const header = `<div class="page-heading"><div><p class="eyebrow">ПОКУПКИ</p><h1>Список покупок</h1><p class="page-subtitle">Количество и единицы приходят с backend без пересчёта в браузере.</p></div>${planSelect(state)}</div>`;
  if (state.shoppingStatus === 'loading' || state.shoppingStatus === 'idle') {
    return `${header}${renderStatus({kind: 'loading', title: 'Рассчитываем покупки'})}`;
  }
  if (state.shoppingStatus === 'error') {
    return `${header}${renderStatus({kind: 'error', title: 'Список не загрузился', action: 'retry-shopping'})}`;
  }
  const items = state.shopping?.items || [];
  return `${header}<div class="shopping-layout">
    <section class="shopping-card">
      <div class="shopping-card-header"><div><h2>Нужно купить</h2><span>${items.length} позиций</span></div><button class="button button-secondary button-small" data-action="refresh-shopping" ${state.busy === 'shopping' ? 'disabled' : ''}>Обновить</button></div>
      ${items.length ? `<ul class="shopping-items">${items.map((item) => `<li><span>${escapeHtml(item.name)}</span><b>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</b></li>`).join('')}</ul>` : '<div class="compact-empty"><b>Список покупок пуст</b><span>Добавьте рецепты в слоты выбранного рациона.</span></div>'}
    </section>
    <aside class="export-card"><p class="eyebrow">ЭКСПОРТ</p><h2>Скачать файл</h2><p>CSV и TXT формирует backend. Браузер использует Blob и имя из Content-Disposition.</p><button class="button button-primary" data-action="export-shopping" data-file-type="csv">Скачать CSV</button><button class="button button-secondary" data-action="export-shopping" data-file-type="txt">Скачать TXT</button></aside>
  </div>`;
}
