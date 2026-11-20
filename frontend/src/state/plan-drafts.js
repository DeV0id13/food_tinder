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
      const draft = JSON.parse(this.browser?.sessionStorage?.getItem(key) || 'null');
      const plan = draft?.plan;
      if (!plan || (plan.id ?? null) !== (planId ?? null) || typeof plan.start_date !== 'string'
        || !Array.isArray(plan.slots) || !Array.isArray(plan.enabled_meals)) return null;
      return draft;
    } catch {
      return null;
    }
  }

  put(userId, planId, draft) {
    const key = this.key(userId, planId);
    this.memory.set(key, draft);
    try {
      const storage = this.browser?.sessionStorage;
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(draft));
      return true;
    } catch {
      return false;
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
