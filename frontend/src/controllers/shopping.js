import {saveBlob} from '../utils/download.js';
import {invalidateShopping} from '../utils/plans.js';

export class ShoppingController {
  constructor(app) {
    this.app = app;
    this.root = app.root;
    this.state = app.state;
  }

  invalidateShopping() {
    this.app.beginRequest('shopping');
    invalidateShopping(this.state);
  }

  async loadShoppingView() {
    const view = 'shopping';
    const request = this.app.beginRequest('shopping-view');
    if (!this.state.plans || this.state.plansStatus !== 'ready') await this.app.plans.loadPlans(false);
    if (!this.app.isCurrentRequest('shopping-view', request) || this.state.view !== view) return;
    this.state.shoppingPlanId ??= this.state.activePlanId ?? this.state.plans?.[0]?.id ?? null;
    if (this.state.plans?.length) await this.loadShopping();
    this.app.render();
  }

  async loadShopping(shouldRender = true) {
    if (!this.state.session.authenticated || !this.state.shoppingPlanId) return;
    const planId = Number(this.state.shoppingPlanId);
    const request = this.app.beginRequest('shopping');
    const current = () => this.app.isCurrentRequest('shopping', request)
      && Number(this.state.shoppingPlanId) === planId;
    this.state.shopping = null;
    this.state.shoppingStatus = 'loading';
    if (shouldRender) this.app.render();
    try {
      const shopping = await this.app.api.getShoppingList(planId);
      if (!current()) return;
      this.state.shopping = shopping;
      this.state.shoppingStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.shoppingStatus = 'error';
      await this.app.handleError(error, current);
    }
    if (shouldRender && current()) this.app.render();
  }

  openPlanShopping(planId) {
    if (!this.state.session.authenticated || !planId) return;
    return this.app.navigation.navigate('shopping', {shoppingPlanId: planId});
  }

  editableShoppingPlanId() {
    return this.state.session.authenticated && this.state.shoppingStatus === 'ready'
      && this.state.shopping?.plan_id === Number(this.state.shoppingPlanId)
      ? this.state.shopping.plan_id : null;
  }

  async setPurchased(planId, ingredientId, purchased) {
    if (this.state.busy || planId !== this.editableShoppingPlanId()) return;
    const item = this.state.shopping.items.find((entry) => entry.ingredient_id === ingredientId);
    if (!item) return;
    await this.changePurchases(planId, async () => {
      await this.app.api.setPurchased(planId, ingredientId, {purchased, quantity_version: item.quantity_version});
    }, `#purchase-${ingredientId}`);
  }

  async clearPurchases(planId) {
    if (this.state.busy || planId !== this.editableShoppingPlanId()
      || !this.state.shopping.items.some((item) => item.purchased)) return;
    if (!await this.app.navigation.askConfirmation('Снять все отметки о покупках в выбранном рационе?', 'Снять отметки')
      || this.state.view !== 'shopping' || planId !== this.editableShoppingPlanId()) return;
    await this.changePurchases(planId, () => this.app.api.clearPurchases(planId), '[data-action="refresh-shopping"]');
  }

  async changePurchases(planId, write, focusSelector) {
    const context = this.app.account.sessionContext();
    const current = () => this.app.account.isCurrentSession(context) && Number(this.state.shoppingPlanId) === planId;
    await this.app.runMutation('purchases', async () => {
      let stale = false;
      try {
        await write();
      } catch (error) {
        if (![404, 409].includes(error.status)) {
          if (current()) throw error;
          return;
        }
        stale = true;
      }
      if (!current()) return;
      await this.loadShopping(false);
      if (stale && current() && this.state.shoppingStatus === 'ready') {
        this.app.toast('Список покупок изменился. Проверьте количество и повторите отметку.');
      }
    });
    if (current() && this.state.view === 'shopping') this.root.querySelector?.(focusSelector)?.focus();
  }

  async exportShopping(fileType) {
    const planId = this.editableShoppingPlanId();
    if (!planId) return;
    const context = this.app.account.sessionContext();
    await this.app.runMutation(`export-${fileType}`, async () => {
      const file = await this.app.api.downloadShoppingList(planId, fileType);
      if (!this.app.account.isCurrentSession(context) || Number(this.state.shoppingPlanId) !== planId) return;
      saveBlob(file);
      this.app.toast(`Файл ${fileType.toUpperCase()} готов`);
    });
  }
}
