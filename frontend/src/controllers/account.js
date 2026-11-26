import {clearPrivateState} from '../state/state.js';
import {isPrivateView, readRoute} from '../utils/routes.js';

export class AccountController {
  constructor(app) {
    this.app = app;
    this.browser = app.browser;
    this.dialog = app.dialog;
    this.state = app.state;
    this.sessionGeneration = 0;
  }

  sessionContext() {
    return {
      generation: this.sessionGeneration,
      userId: this.state.session.id,
      authenticated: this.state.session.authenticated,
    };
  }

  isCurrentSession(context) {
    return context.generation === this.sessionGeneration
      && context.userId === this.state.session.id
      && context.authenticated === this.state.session.authenticated;
  }

  setSession(session, reset = false) {
    const previous = this.state.session;
    if (reset || session.id !== this.state.session.id
      || session.authenticated !== this.state.session.authenticated) {
      this.sessionGeneration += 1;
      this.app.plans.transfer.cancel();
      this.app.plans.clearTransferUndo();
      this.app.navigation.historyReplay = null;
      if (this.app.navigation.historyReturn) this.app.navigation.historyReturn.destination = null;
      this.app.navigation.navigationDecision = null;
      if (this.dialog.open) this.app.navigation.dismissDialog();
      this.app.plans.slotPicker = null;
      if (this.state.busy !== 'auth') {
        this.app.mutation = null;
        this.state.busy = null;
      }
      this.app.recipes.clearSwipeNotice();
      this.app.recipes.invalidateCatalog();
      clearPrivateState(this.state);
      this.state.feed = null;
      this.state.feedStatus = 'idle';
      this.state.guestHidden = new Set();
    }
    if (session.authenticated || reset) this.app.plans.planDrafts.keepOnly(session.authenticated ? session.id : null);
    this.state.session = session;
    this.state.sessionKnown = true;
    this.app.navigation.watchUnsavedChanges();
    if (previous.authenticated && previous.id !== session.id && this.state.view === 'recipes') {
      this.app.navigation.writeRoute(true);
    }
  }

  async loadAccount(shouldRender = true) {
    if (!this.state.session.authenticated) return;
    const request = this.app.beginRequest('account');
    const current = () => this.app.isCurrentRequest('account', request);
    this.state.accountStatus = 'loading';
    if (shouldRender) this.app.render();
    try {
      const account = await this.app.api.getAccount();
      if (!current()) return;
      this.state.account = account;
      this.state.accountStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.accountStatus = 'error';
      await this.app.handleError(error, current);
    }
    if (shouldRender && current()) this.app.render();
  }

  async updateAccountNames(payload) {
    if (!this.state.session.authenticated || this.state.busy) return;
    const context = this.sessionContext();
    await this.app.runMutation('account', async () => {
      const account = await this.app.api.updateAccount(payload);
      if (!this.isCurrentSession(context)) return;
      this.app.beginRequest('account');
      this.state.account = account;
      this.state.accountStatus = 'ready';
      this.app.toast('Личные данные сохранены');
    });
  }

  async updateAccountEmail(payload) {
    if (!this.state.session.authenticated || this.state.busy) return;
    if (payload.email.toLowerCase() === this.state.session.email.toLowerCase()) {
      this.app.toast('Новый email совпадает с текущим');
      return;
    }
    const context = this.sessionContext();
    await this.app.runMutation('account', async () => {
      const account = await this.app.api.changeEmail(payload);
      if (!this.isCurrentSession(context)) return;
      this.app.beginRequest('account');
      this.state.account = account;
      this.state.accountStatus = 'ready';
      this.state.session = {...this.state.session, email: account.email};
      this.app.toast('Email изменён');
    });
  }

  showAuth(message) {
    this.state.authTab = 'login';
    this.state.authNotice = message || 'Войдите, чтобы сохранить это действие.';
    const {view, activePlanId, shoppingPlanId} = this.state;
    const requestedRoute = this.browser ? readRoute(this.browser.location) : null;
    const routePlanId = requestedRoute?.view === view ? requestedRoute.planId : null;
    return this.app.navigation.navigate('auth', {
      next: isPrivateView(view) ? view : null,
      nextPlanId: view === 'plans' ? activePlanId ?? routePlanId : view === 'shopping' ? shoppingPlanId ?? routePlanId : null,
    });
  }

  async login(payload) {
    await this.app.runMutation('auth', async () => {
      const next = this.app.navigation.authReturnView || 'feed';
      const planId = this.app.navigation.authReturnPlanId;
      this.setSession(await this.app.api.login(payload), true);
      this.state.authNotice = null;
      if (this.state.view === 'auth') {
        await this.app.navigation.navigate(next, {
          replace: true,
          ...(planId && next === 'plans' ? {planMode: 'edit', planId} : {}),
          ...(planId && next === 'shopping' ? {shoppingPlanId: planId} : {}),
        });
      } else await this.app.loadView(this.state.view);
      this.app.toast('Вход выполнен');
    });
  }

  async register(payload) {
    await this.app.runMutation('auth', async () => {
      const account = await this.app.api.register(payload);
      this.state.registeredEmail = account.email;
      this.state.authTab = 'login';
      this.state.authNotice = 'Аккаунт создан. Теперь можно войти.';
      this.app.toast('Регистрация завершена');
    });
  }

  async logout() {
    await this.app.runMutation('auth', async () => {
      await this.app.api.logout();
      this.setSession({authenticated: false, id: null, email: null}, true);
      this.state.view = 'feed';
      this.app.navigation.authReturnView = null;
      this.app.navigation.writeRoute(true);
      this.app.render();
      // The POST confirmed logout. A failed CSRF/session refresh cannot undo it.
      this.app.toast('Вы вышли из аккаунта');
      try {
        await this.app.api.getSession();
      } catch (error) {
        await this.app.handleError(error);
      }
      await this.app.recipes.loadFeed(false);
    });
  }
}
