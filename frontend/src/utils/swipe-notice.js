export const UNDO_WINDOW_MS = 5000;

export function renderSwipeNotice(swipe, busy) {
  if (!swipe) return '';
  return `<div class="swipe-notice-active" data-swipe-notice>
    <p role="status">${swipe.message}</p>
    <span class="swipe-clock" aria-hidden="true"><span data-swipe-seconds></span></span>
    <span id="swipe-time-left" class="visually-hidden" data-swipe-description></span>
    <button class="button button-small button-secondary" data-action="undo-swipe"
      aria-describedby="swipe-time-left" ${busy ? 'disabled' : ''}>Отменить</button>
  </div>`;
}
