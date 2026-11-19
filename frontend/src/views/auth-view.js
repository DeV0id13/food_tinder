import {demoCredentials} from '../api/demo-api.js';
import {escapeAttr, escapeHtml} from '../utils/dom.js';

function loginForm(state) {
  const email = state.registeredEmail || (state.mode === 'demo' ? demoCredentials.email : '');
  return `<form class="auth-form" data-form="login">
    <label>Электронная почта<input name="email" type="email" autocomplete="email" required value="${escapeAttr(email)}" /></label>
    <label>Пароль<input name="password" type="password" autocomplete="current-password" required value="${state.mode === 'demo' ? escapeAttr(demoCredentials.password) : ''}" /></label>
    <button class="button button-primary" type="submit" ${state.busy === 'auth' ? 'disabled' : ''}>Войти</button>
  </form>`;
}

function registerForm(state) {
  return `<form class="auth-form" data-form="register">
    <label>Электронная почта<input name="email" type="email" autocomplete="email" required /></label>
    <label>Пароль<input name="password" type="password" autocomplete="new-password" minlength="10" required aria-describedby="password-help" /></label>
    <p id="password-help" class="form-help">Минимум 10 символов. Используйте латинские буквы, цифры и _. Нужны заглавная и строчная буквы, цифра и _.</p>
    <p class="form-help">После регистрации войдите с вашей почтой и паролем.</p>
    <button class="button button-primary" type="submit" ${state.busy === 'auth' ? 'disabled' : ''}>Создать аккаунт</button>
  </form>`;
}

export function renderAuthView(state) {
  if (state.session.authenticated) {
    return `<section class="account-card">
      <header class="page-heading"><h1>Аккаунт</h1></header>
      <div class="account-details">
        <p>${escapeHtml(state.session.email)}</p>
        <button class="button button-secondary" data-action="logout" ${state.busy === 'auth' ? 'disabled' : ''}>Выйти</button>
      </div>
    </section>`;
  }
  const registering = state.authTab === 'register';
  return `<div class="auth-layout">
    <section class="auth-card">
      <h1>${registering ? 'Регистрация' : 'Вход'}</h1>
      <div class="tabs" role="group" aria-label="Вход или регистрация">
        <button data-action="auth-tab" data-tab="login" aria-pressed="${!registering}">Вход</button>
        <button data-action="auth-tab" data-tab="register" aria-pressed="${registering}">Регистрация</button>
      </div>
      ${state.authNotice ? `<div class="inline-notice" role="status">${escapeHtml(state.authNotice)}</div>` : ''}
      ${registering ? registerForm(state) : loginForm(state)}
      ${state.mode === 'demo' ? `<p class="demo-credentials">Демо-вход: <b>${demoCredentials.email}</b> / <b>${demoCredentials.password}</b></p>` : ''}
    </section>
    <img class="auth-photo" src="/assets/editorial/kitchen.webp" alt="" />
  </div>`;
}
