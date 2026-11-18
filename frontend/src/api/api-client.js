import {API_BASE} from '../constants.js';
import {ApiError, errorTypeForStatus} from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCookie(name, cookieString = globalThis.document?.cookie || '') {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = cookieString.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(prefix.length));
  } catch {
    return item.slice(prefix.length);
  }
}

export function buildApiUrl(path, query) {
  let apiPath = String(path || '');
  if (/^https?:\/\//i.test(apiPath)) {
    const parsed = new URL(apiPath);
    apiPath = `${parsed.pathname}${parsed.search}`;
  }
  if (!apiPath.startsWith('/')) apiPath = `${API_BASE}${apiPath.replace(/^\/+/, '')}`;
  if (!apiPath.startsWith(API_BASE)) throw new TypeError(`API path must start with ${API_BASE}`);

  const url = new URL(apiPath, 'http://foodtinder.local');
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export function filenameFromDisposition(value, fallback = 'download') {
  if (!value) return fallback;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = value.match(/filename="([^"]+)"/i)?.[1] || value.match(/filename=([^;]+)/i)?.[1];
  let filename = encoded || plain || fallback;
  try {
    filename = decodeURIComponent(filename.trim());
  } catch {
    filename = filename.trim();
  }
  return filename.replace(/[\\/:*?"<>|]/g, '-');
}

async function responseBody(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  return text || null;
}

export class ApiClient {
  constructor({fetchImpl = (...args) => globalThis.fetch(...args), cookieReader = () => globalThis.document?.cookie || ''} = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    this.fetchImpl = fetchImpl;
    this.cookieReader = cookieReader;
    this.csrfRequest = null;
  }

  async refreshCsrf() {
    if (!this.csrfRequest) {
      this.csrfRequest = this.request('auth/session/', {skipCsrf: true}).finally(() => {
        this.csrfRequest = null;
      });
    }
    return this.csrfRequest;
  }

  async request(path, {method = 'GET', query, body, headers = {}, responseType = 'json', skipCsrf = false} = {}) {
    const normalizedMethod = method.toUpperCase();
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Accept', responseType === 'blob' ? '*/*' : 'application/json');

    if (!SAFE_METHODS.has(normalizedMethod) && !skipCsrf) {
      let csrfToken = readCookie('csrftoken', this.cookieReader());
      if (!csrfToken) {
        await this.refreshCsrf();
        csrfToken = readCookie('csrftoken', this.cookieReader());
      }
      if (!csrfToken) {
        throw new ApiError({type: 'auth', status: 403, message: 'Не удалось получить CSRF-токен.'});
      }
      requestHeaders.set('X-CSRFToken', csrfToken);
    }

    let payload;
    if (body !== undefined) {
      requestHeaders.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetchImpl(buildApiUrl(path, query), {
        method: normalizedMethod,
        credentials: 'include',
        headers: requestHeaders,
        body: payload,
      });
    } catch (cause) {
      throw new ApiError({type: 'network', details: cause});
    }

    if (!response.ok) {
      const details = await responseBody(response);
      throw new ApiError({
        type: errorTypeForStatus(response.status),
        status: response.status,
        details,
      });
    }

    if (responseType === 'blob') {
      return {
        blob: await response.blob(),
        filename: filenameFromDisposition(response.headers.get('content-disposition')),
      };
    }
    return responseBody(response);
  }
}
