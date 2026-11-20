import {escapeHtml} from '../utils/dom.js';

export function renderConfirmation(message, actionLabel) {
  return `<div class="dialog-content plan-confirmation">
    <h2 id="dialog-title">${escapeHtml(actionLabel)}</h2>
    <p>${escapeHtml(message)}</p>
    <div class="plan-card-actions">
      <button class="button button-primary" data-action="accept-confirmation">${escapeHtml(actionLabel)}</button>
      <button class="button button-secondary" data-action="close-dialog" autofocus>Отмена</button>
    </div>
  </div>`;
}
