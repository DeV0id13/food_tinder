export const MEALS = [
  {id: 'breakfast', label: 'Завтрак'},
  {id: 'lunch', label: 'Обед'},
  {id: 'snack', label: 'Перекус'},
  {id: 'dinner', label: 'Ужин'},
];

export const MEAL_LABELS = Object.fromEntries(MEALS.map(({id, label}) => [id, label]));
export const DURATIONS = [1, 3, 7];
export const COOKING_TIMES = [15, 30, 60];
export const API_BASE = '/api/v1/';

export const FAVORITE_SORTS = {
  added: 'По дате добавления',
  title: 'По названию',
  time: 'По времени приготовления',
};
