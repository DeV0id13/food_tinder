import {renderStatus} from '../utils/dom.js';

export function plansUnavailable(state) {
  return state.plansStatus === 'error' && state.plansError?.status === 404;
}

export function renderPlansError(state, shopping = false) {
  if (plansUnavailable(state)) {
    return renderStatus({
      title: shopping ? 'Список покупок пока недоступен' : 'Рационы пока недоступны',
      text: shopping
        ? 'Для списка покупок нужен сохранённый рацион. Пока вы можете выбирать блюда и сохранять их в избранное.'
        : 'Вы можете продолжить выбирать блюда и сохранять их в избранное.',
      action: 'open-recipes',
      actionLabel: 'Перейти к рецептам',
    });
  }
  return renderStatus({kind: 'error', title: 'Не удалось загрузить рационы', action: 'retry-plans'});
}
