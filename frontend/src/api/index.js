import {DemoApi} from './demo-api.js';
import {RealApi} from './real-api.js';

export function resolveApiMode(search = globalThis.location?.search || '') {
  const params = new URLSearchParams(search);
  return params.get('demo') === '1' || params.get('mode') === 'demo' ? 'demo' : 'real';
}

export function createApi(mode = resolveApiMode(), options = {}) {
  if (mode === 'demo') return new DemoApi();
  return new RealApi(options.client);
}

export {DemoApi, RealApi};
