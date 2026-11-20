import {escapeAttr, escapeHtml} from '../utils/dom.js';

function loginForm(state) {
  const email = state.registeredEmail;
  return `<form class="auth-form" data-form="login">
    <label>Электронная почта<input name="email" type="email" autocomplete="email" required value="${escapeAttr(email)}" /></label>
    <label>Пароль<input name="password" type="password" autocomplete="current-password" required /></label>
    <button class="button button-primary" type="submit" ${state.busy === 'auth' ? 'disabled' : ''}>Войти</button>
  </form>`;
}

function registerForm(state) {
  return `<form class="auth-form" data-form="register">
    <label>Имя<input name="first_name" type="text" autocomplete="given-name" maxlength="150" required /></label>
    <label>Электронная почта<input name="email" type="email" autocomplete="email" required /></label>
    <label>Пароль<input name="password" type="password" autocomplete="new-password" minlength="10" required aria-describedby="password-help" /></label>
    <p id="password-help" class="form-help">Минимум 10 символов. Используйте латинские буквы, цифры и _. Нужны заглавная и строчная буквы, цифра и _.</p>
    <p class="form-help">После регистрации войдите с вашей почтой и паролем.</p>
    <button class="button button-primary" type="submit" ${state.busy === 'auth' ? 'disabled' : ''}>Создать аккаунт</button>
  </form>`;
}

export function renderAuthView(state) {
  if (state.session.authenticated) {
    const saving = Boolean(state.busy);
    const profile = state.account;
    return `<section class="account-card">
      <header class="page-heading"><h1>Аккаунт</h1></header>
      <div class="account-details">
        <p>Электронная почта: <strong>${escapeHtml(state.session.email)}</strong></p>
        ${state.accountStatus === 'error' ? `<div role="alert">
          Не удалось загрузить профиль.
          <button class="button button-secondary" data-action="retry-account">Повторить</button>
        </div>` : ''}
        ${state.accountStatus === 'loading' || state.accountStatus === 'idle'
    ? '<p role="status">Загружаем профиль…</p>' : ''}
        ${profile && state.accountStatus === 'ready' ? `
          <form class="auth-form account-form" data-form="account-names">
            <h2>Личные данные</h2>
            <label>Имя<input name="first_name" type="text" maxlength="150" autocomplete="given-name"
              value="${escapeAttr(profile.first_name)}" required /></label>
            <label>Фамилия<input name="last_name" type="text" maxlength="150" autocomplete="family-name"
              value="${escapeAttr(profile.last_name)}" /></label>
            <button class="button button-primary" type="submit" ${saving ? 'disabled' : ''}>Сохранить данные</button>
          </form>
          <form class="auth-form account-form" data-form="account-email">
            <h2>Сменить электронную почту</h2>
            <label>Новый email<input name="email" type="email" autocomplete="email"
              value="${escapeAttr(profile.email)}" required /></label>
            <label>Текущий пароль<input name="current_password" type="password"
              autocomplete="current-password" required /></label>
            <p class="form-help">После изменения используйте новый email для входа.
              Подтверждение нового адреса пока не настроено.</p>
            <button class="button button-secondary" type="submit" ${saving ? 'disabled' : ''}>Изменить email</button>
          </form>` : ''}
        <button class="button button-secondary" data-action="logout" ${saving ? 'disabled' : ''}>Выйти</button>
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
    </section>
    <img class="auth-photo" src="/assets/editorial/kitchen.webp" alt="" />
  </div>`;
}
