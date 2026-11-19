const DEFAULT_MESSAGES = {
  validation: 'Проверьте заполненные поля.',
  auth: 'Сессия отсутствует или устарела. Войдите снова.',
  not_found: 'Запрошенные данные не найдены.',
  server: 'Сервер временно недоступен.',
  network: 'Не удалось связаться с сервером. Проверьте соединение.',
  http: 'Запрос завершился с ошибкой.',
};

export class ApiError extends Error {
  constructor({type = 'http', status = 0, details = null, message} = {}) {
    super(message || DEFAULT_MESSAGES[type] || DEFAULT_MESSAGES.http);
    this.name = 'ApiError';
    this.type = type;
    this.status = status;
    this.details = details;
  }
}

export function errorTypeForStatus(status) {
  if (status === 400) return 'validation';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'http';
}

export function validationMessages(details, prefix = '') {
  if (details == null) return [];
  if (typeof details === 'string') return [prefix ? `${prefix}: ${details}` : details];
  if (Array.isArray(details)) {
    return details.flatMap((value) => validationMessages(value, prefix));
  }
  if (typeof details === 'object') {
    return Object.entries(details).flatMap(([field, value]) => {
      const label = field === 'non_field_errors' || field === 'detail' ? '' : field;
      return validationMessages(value, label);
    });
  }
  return [String(details)];
}

export function apiErrorMessage(error) {
  if (!(error instanceof ApiError)) return 'Произошла непредвиденная ошибка.';
  const details = validationMessages(error.details);
  if (error.type === 'validation' && details.length) return details.join(' ');
  if (error.type === 'auth' && details.length && error.status === 403) {
    return `${error.message} ${details.join(' ')}`;
  }
  return error.message;
}
