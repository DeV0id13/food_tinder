const PREFIX = 'foodtinder:plan-draft:';

export class PlanDrafts {
  constructor(browser) {
    this.browser = browser;
    this.memory = new Map();
  }

  key(userId, planId) {
    return `${PREFIX}${userId}:${planId ?? 'new'}`;
  }

  get(userId, planId) {
    const key = this.key(userId, planId);
    if (this.memory.has(key)) return this.memory.get(key);
    try {
      return JSON.parse(this.browser?.sessionStorage?.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  put(userId, planId, draft) {
    const key = this.key(userId, planId);
    this.memory.set(key, draft);
    try {
      this.browser?.sessionStorage?.setItem(key, JSON.stringify(draft));
    } catch {
      // The current page can still keep the draft if tab storage is unavailable.
    }
  }

  remove(userId, planId) {
    const key = this.key(userId, planId);
    this.memory.delete(key);
    try {
      this.browser?.sessionStorage?.removeItem(key);
    } catch {
      // The editor works without tab storage.
    }
  }

  keepOnly(userId) {
    const keep = userId == null ? null : `${PREFIX}${userId}:`;
    const remove = (key) => key?.startsWith(PREFIX) && (!keep || !key.startsWith(keep));
    for (const key of this.memory.keys()) {
      if (remove(key)) this.memory.delete(key);
    }
    try {
      const storage = this.browser?.sessionStorage;
      for (let index = (storage?.length ?? 0) - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (remove(key)) storage.removeItem(key);
      }
    } catch {
      // Storage may be disabled by the browser or unavailable in private mode.
    }
  }
}
