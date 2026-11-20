import {MEAL_LABELS} from '../constants.js';

const TARGET = '[data-transfer-target]';
const HANDLE = '[data-transfer-source]';
const edge = (position, start, end) => {
  const margin = Math.min(56, (end - start) / 4);
  if (position < start + margin) return -16 * Math.min(1, (start + margin - position) / margin);
  if (position > end - margin) return 16 * Math.min(1, (position - end + margin) / margin);
  return 0;
};

export function slotAddress({dataset}) {
  return {day_index: Number(dataset.dayIndex), meal_type: dataset.mealType};
}

function sourceAddress(handle) {
  const recipe_id = Number(handle.dataset.recipeId);
  return handle.dataset.mealType
    ? {type: 'slot', recipe_id, ...slotAddress(handle)} : {type: 'favorite', recipe_id};
}

export class PlanTransfer {
  constructor(root, browser, {getSource, inspect, drop}) {
    Object.assign(this, {root, browser, getSource, inspect, drop});
    root.addEventListener('pointerdown', (event) => this.start(event));
    root.addEventListener('pointermove', (event) => this.move(event));
    root.addEventListener('pointerup', (event) => this.end(event));
    for (const type of ['pointercancel', 'lostpointercapture']) {
      root.addEventListener(type, (event) => {
        if (event.pointerId === this.pointer?.id) this.cancel(true);
      });
    }
    root.addEventListener('click', (event) => {
      if (event.detail && this.suppressedHandle && event.target.closest(HANDLE) === this.suppressedHandle) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    browser?.addEventListener('pointerdown', (event) => {
      if (!this.pointer) return;
      if (event.pointerType === 'touch' && event.pointerId !== this.pointer.id) this.cancel(true);
    }, true);
    browser?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && (this.selection || this.pointer)) {
        event.preventDefault();
        this.cancel(true);
      }
    });
    browser?.addEventListener('blur', () => {
      if (this.pointer) this.cancel(true);
    });
  }

  announce(text, dragging = false) {
    const status = this.root.querySelector?.(dragging ? '[data-transfer-drag-live]' : '[data-transfer-live]');
    if (status && status.textContent !== text) status.textContent = text;
  }

  paint(context, mode) {
    const original = context?.handle;
    for (const handle of this.root.querySelectorAll?.(HANDLE) ?? []) {
      handle.setAttribute('aria-pressed', String(handle === original));
    }
    for (const target of this.root.querySelectorAll?.(TARGET) ?? []) {
      const button = target.querySelector('[data-transfer-place]');
      button.hidden = mode !== 'choose';
      if (context) {
        const {result, reason} = this.inspect(context, slotAddress(target));
        target.dataset.transferState = result === 'blocked' ? 'blocked' : result === 'noop' ? 'same' : 'ready';
        button.setAttribute('aria-label', `Выбрать слот: ${MEAL_LABELS[target.dataset.mealType]}. ${reason || 'Допустимый слот.'}`);
      } else {
        delete target.dataset.transferState;
      }
    }
    const cancel = this.root.querySelector?.('[data-action="cancel-transfer"]');
    if (cancel) cancel.hidden = mode !== 'choose';
  }

  choose(handle) {
    const wasSelected = this.selection?.handle === handle;
    this.cancel(wasSelected);
    if (wasSelected) return;
    const context = this.getSource(sourceAddress(handle), handle);
    if (!context) return;
    this.selection = context;
    this.paint(context, 'choose');
    this.announce(`Выбрано блюдо «${context.title}». Выберите слот или нажмите Escape.`);
    const first = this.root.querySelector?.('[data-transfer-state="ready"] [data-transfer-place]');
    first?.focus();
  }

  place(target) {
    if (!this.selection) return;
    const outcome = this.drop(this.selection, slotAddress(target));
    if (outcome.result !== 'blocked' && this.selection) this.cancel(false);
    if (outcome.result === 'noop') this.announce('Слот остался без изменений.');
    if (outcome.reason) this.announce(outcome.reason);
    if (outcome.result === 'noop') target.querySelector('[data-action="pick-slot"]')?.focus();
  }

  start(event) {
    const handle = event.target.closest(HANDLE);
    if (!handle || handle.disabled || !event.isPrimary || event.button !== 0 || this.pointer) return;
    const context = this.getSource(sourceAddress(handle), handle);
    if (!context) return;
    this.suppressedHandle = null;
    this.pointer = {
      id: event.pointerId, context, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY,
    };
    handle.setPointerCapture(event.pointerId);
  }

  move(event) {
    const pointer = this.pointer;
    if (event.pointerId !== pointer?.id) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointer.ghost || Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) < 8) return;
    this.selection = null;
    const document = this.browser.document;
    pointer.ghost = document.createElement('div');
    pointer.ghost.className = 'plan-drag-preview';
    pointer.ghost.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.textContent = pointer.context.title;
    pointer.hint = document.createElement('span');
    pointer.hint.className = 'plan-drag-hint';
    pointer.ghost.append(title, pointer.hint);
    document.body.append(pointer.ghost);
    this.paint(pointer.context, 'drag');
    this.announce(`Выбрано блюдо «${pointer.context.title}».`, true);
    this.frame();
  }

  hit(pointer) {
    const element = this.browser.document.elementFromPoint(pointer.x, pointer.y);
    const target = element?.closest(TARGET);
    return target && this.root.contains(target) ? target : null;
  }

  frame() {
    const pointer = this.pointer;
    if (!pointer?.ghost) return;
    const {x, y, ghost} = pointer;
    const {innerWidth, innerHeight, document} = this.browser;
    ghost.style.transform = `translate(${Math.max(0, Math.min(x + 14, innerWidth - ghost.offsetWidth - 6))}px, ${Math.max(0, Math.min(y + 14, innerHeight - ghost.offsetHeight - 6))}px)`;
    const list = document.elementFromPoint(x, y)?.closest('[data-library-results]');
    let listScrolled = false;
    if (list) {
      const {left, right, top, bottom} = list.getBoundingClientRect();
      const {scrollLeft, scrollTop} = list;
      list.scrollBy(edge(x, left, right), edge(y, top, bottom));
      listScrolled = list.scrollLeft !== scrollLeft || list.scrollTop !== scrollTop;
    }
    if (!listScrolled) {
      const toolbarBottom = this.root.querySelector('[data-editor-toolbar]')?.getBoundingClientRect().bottom ?? 0;
      const top = toolbarBottom < innerHeight / 2 ? Math.max(0, toolbarBottom) : 0;
      this.browser.scrollBy(0, edge(y, top, innerHeight));
    }
    const target = this.hit(pointer);
    if (target !== pointer.hover) {
      pointer.hover?.removeAttribute('data-transfer-hover');
      pointer.hover = target;
      if (target) {
        target.setAttribute('data-transfer-hover', '');
        const {result, reason} = this.inspect(pointer.context, slotAddress(target));
        const hint = reason || (result === 'noop' ? 'Этот слот останется без изменений.'
          : `Допустимый слот: ${MEAL_LABELS[target.dataset.mealType]}.`);
        pointer.hint.textContent = hint;
        this.announce(hint, true);
      } else {
        pointer.hint.textContent = '';
      }
    }
    pointer.frame = this.browser.requestAnimationFrame(() => this.frame());
  }

  end(event) {
    const pointer = this.pointer;
    if (event.pointerId !== pointer?.id) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const target = pointer.ghost && this.hit(pointer);
    this.stopPointer();
    if (!pointer.ghost) return;
    this.paint(null);
    const outcome = this.drop(pointer.context, target ? slotAddress(target) : null);
    if (outcome.reason) this.announce(outcome.reason);
    if (outcome.result === 'noop') this.announce('Слот остался без изменений.');
  }

  stopPointer() {
    const pointer = this.pointer;
    if (!pointer) return;
    this.pointer = null;
    const {handle} = pointer.context;
    if (pointer.ghost) {
      this.suppressedHandle = handle;
      this.browser.cancelAnimationFrame(pointer.frame);
      pointer.ghost.remove();
      this.announce('', true);
      pointer.hover?.removeAttribute('data-transfer-hover');
    }
    if (handle.hasPointerCapture(pointer.id)) handle.releasePointerCapture(pointer.id);
  }

  cancel(notify = false) {
    const context = this.selection ?? this.pointer?.context;
    this.selection = null;
    this.stopPointer();
    if (!context) return;
    this.paint(null);
    if (notify) {
      this.announce('Перенос отменён.');
      context.handle.focus({preventScroll: true});
    } else {
      this.announce('');
    }
  }
}
