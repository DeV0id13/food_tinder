export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

export function renderStatus({kind = 'empty', title, text, action, actionLabel} = {}) {
  const button = action
    ? `<button class="button ${kind === 'error' ? 'button-primary' : 'button-secondary'}" data-action="${escapeAttr(action)}">${escapeHtml(actionLabel || 'Повторить')}</button>`
    : '';
  return `<section class="status-card status-${escapeAttr(kind)}" role="${kind === 'error' ? 'alert' : 'status'}">
    <div class="status-icon" aria-hidden="true">${kind === 'loading' ? '<span class="spinner"></span>' : kind === 'error' ? '!' : '○'}</div>
    <h2>${escapeHtml(title)}</h2>
    ${text ? `<p>${escapeHtml(text)}</p>` : ''}
    ${button}
  </section>`;
}
