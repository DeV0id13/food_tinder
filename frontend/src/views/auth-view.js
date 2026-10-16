import {demoCredentials} from '../api/demo-api.js';
import {escapeAttr, escapeHtml} from '../utils/dom.js';

function loginForm(state) {
  const email = state.registeredEmail || (state.mode === 'demo' ? demoCredentials.email : '');
  return `<form class="auth-form" data-form="login">
    <label>Email<input name="email" type="email" autocomplete="email" required value="${escapeAttr(email)}" /></label>
    <label>Пароль<input name="password" type="password" autocomplete="current-password" required value="${state.mode === 'demo' ? escapeAttr(demoCredentials.password) : ''}" /></label>
    <button class="button button-primary" type="submit" ${state.busy === 'auth' ? 'disabled' : ''}>Войти</button>
  </form>`;
}

function registerForm(state) {
  return `<form class="auth-form" data-form="register">
    <label>Email<input name="email" type="email" autocomplete="email" required /></label>
    <label>Пароль<input name="password" type="password" autocomplete="new-password" minlength="10" required aria-describedby="password-help" /></label>
    <p id="password-help" class="form-help">Минимум 10 символов; backend применит все правила пароля.</p>
    <button class="button button-primary" type="submit" ${state.busy === 'auth' ? 'disabled' : ''}>Создать аккаунт</button>
  </form>`;
}

export function renderAuthView(state) {
  if (state.session.authenticated) {
    return `<section class="account-card">
      <div class="account-avatar">${escapeHtml(state.session.email?.slice(0, 1).toUpperCase())}</div>
      <div><p class="eyebrow">АККАУНТ</p><h1>${escapeHtml(state.session.email)}</h1><p class="page-subtitle">Сессия хранится в защищённой Django cookie. Токены в localStorage не используются.</p></div>
      <button class="button button-secondary" data-action="logout" ${state.busy === 'auth' ? 'disabled' : ''}>Выйти</button>
    </section>`;
  }
  return `<div class="auth-layout">
    <section class="auth-intro"><p class="eyebrow">АККАУНТ</p><h1>Сохраняйте выбор на backend</h1><p>Регистрация создаёт аккаунт, но не выполняет автоматический вход. После неё явно войдите с теми же данными.</p>
      <ul><li>Session cookie вместо токенов в браузерном хранилище</li><li>CSRF для регистрации, входа, выхода и всех изменений</li><li>Данные восстанавливаются с backend после reload</li></ul>
    </section>
    <section class="auth-card">
      <div class="tabs" role="tablist">
        <button class="${state.authTab === 'login' ? 'active' : ''}" data-action="auth-tab" data-tab="login" role="tab">Вход</button>
        <button class="${state.authTab === 'register' ? 'active' : ''}" data-action="auth-tab" data-tab="register" role="tab">Регистрация</button>
      </div>
      ${state.authNotice ? `<div class="inline-notice" role="status">${escapeHtml(state.authNotice)}</div>` : ''}
      ${state.authTab === 'register' ? registerForm(state) : loginForm(state)}
      ${state.mode === 'demo' ? `<p class="demo-credentials">Демо-вход: <b>${demoCredentials.email}</b> / <b>${demoCredentials.password}</b></p>` : ''}
    </section>
  </div>`;
}
