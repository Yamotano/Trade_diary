// Экран входа/регистрации для облачного режима и подсказка по настройке.
import { cloud } from './cloud.js';
import { icon } from './components.js';
import { escapeHtml } from './format.js';

function brand() {
  return `<div class="auth-brand">
    <span class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32"><path d="M7 22V13m6 9V8m6 14v-7m6 7V6" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>
    </span>
    <span class="brand-text">Фьючерс<em>дневник</em></span>
  </div>`;
}

export function renderAuth(root, { onSuccess } = {}) {
  document.body.classList.add('auth-mode');
  let mode = 'login';
  let busy = false;

  root.innerHTML = `<div class="auth-screen">
    <div class="auth-card">
      ${brand()}
      <h1 class="auth-title" id="authTitle">Вход в дневник</h1>
      <p class="auth-sub" id="authSub">Сделки, статистика и записи синхронизируются между устройствами.</p>

      <div class="auth-tabs" role="tablist">
        <button type="button" class="${mode === 'login' ? 'active' : ''}" data-auth-tab="login">Вход</button>
        <button type="button" class="${mode === 'signup' ? 'active' : ''}" data-auth-tab="signup">Регистрация</button>
      </div>

      <div class="auth-error hidden" id="authProvider">
        <b>Email-вход отключён в Supabase.</b><br>
        Откройте Authentication → Providers → Email и включите провайдер. Для быстрого старта там же можно отключить Confirm email. После этого обновите страницу.
      </div>

      <form class="auth-form" id="authForm" novalidate>
        <div class="field">
          <label for="authEmail">Email</label>
          <input class="input" id="authEmail" type="email" autocomplete="email" placeholder="you@example.com" required>
        </div>
        <div class="field">
          <label for="authPassword">Пароль</label>
          <input class="input" id="authPassword" type="password" autocomplete="current-password" placeholder="Минимум 6 символов" required>
        </div>
        <div class="field hidden" id="confirmField">
          <label for="authConfirm">Повторите пароль</label>
          <input class="input" id="authConfirm" type="password" autocomplete="new-password" placeholder="Ещё раз">
        </div>
        <div class="auth-error hidden" id="authError" role="alert"></div>
        <div class="auth-success hidden" id="authSuccess"></div>
        <button class="btn btn-primary auth-submit" type="submit" id="authSubmit">Войти</button>
      </form>

      <p class="auth-note">Данные хранятся в вашем проекте Supabase. Пароль обрабатывает Supabase Auth, сервис не видит его в открытом виде.</p>
      <p class="auth-note auth-hint">Нет аккаунта? Переключитесь на «Регистрация» — это бесплатно.</p>
      ${['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
        ? '<p class="auth-note"><a class="auth-local-link" href="?local=1#/dashboard">Открыть локальную версию на SQLite →</a></p>'
        : ''}
    </div>
    <p class="auth-copyright">Фьючерс Дневник · локальные данные или облако Supabase</p>
  </div>`;

  const title = root.querySelector('#authTitle');
  const sub = root.querySelector('#authSub');
  const form = root.querySelector('#authForm');
  const email = root.querySelector('#authEmail');
  const password = root.querySelector('#authPassword');
  const confirmField = root.querySelector('#confirmField');
  const confirm = root.querySelector('#authConfirm');
  const errorEl = root.querySelector('#authError');
  const successEl = root.querySelector('#authSuccess');
  const submit = root.querySelector('#authSubmit');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    successEl.classList.add('hidden');
  }
  function clearMessages() {
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');
  }

  if (cloud.emailEnabled === false) {
    root.querySelector('#authProvider').classList.remove('hidden');
    submit.disabled = true;
  }
  if (cloud.authError) showError(cloud.authError);

  function setMode(next) {
    mode = next;
    clearMessages();
    root.querySelectorAll('[data-auth-tab]').forEach((b) => b.classList.toggle('active', b.dataset.authTab === mode));
    title.textContent = mode === 'login' ? 'Вход в дневник' : 'Создать дневник';
    sub.textContent = mode === 'login'
      ? 'Сделки, статистика и записи синхронизируются между устройствами.'
      : 'Бесплатный аккаунт: свои сделки, счета и дневник в облаке.';
    confirmField.classList.toggle('hidden', mode !== 'signup');
    confirm.required = mode === 'signup';
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    submit.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
  }

  root.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.authTab));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearMessages();
    const mail = email.value.trim();
    const pass = password.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { showError('Введите корректный email'); return; }
    if (pass.length < 6) { showError('Пароль должен быть не короче 6 символов'); return; }
    if (mode === 'signup' && pass !== confirm.value) { showError('Пароли не совпадают'); return; }

    busy = true;
    submit.disabled = true;
    submit.textContent = mode === 'login' ? 'Входим…' : 'Создаём…';
    try {
      if (mode === 'login') {
        await cloud.signIn(mail, pass);
        document.body.classList.remove('auth-mode');
        onSuccess?.();
      } else {
        const result = await cloud.signUp(mail, pass);
        if (result.needsConfirmation) {
          setMode('login');
          successEl.innerHTML = `Аккаунт создан. Подтвердите email по ссылке из письма, затем вернитесь и войдите.<br><span class="muted">Если письмо не пришло, проверьте «Спам» или отключите подтверждение email в Supabase → Authentication → Email.</span>`;
          successEl.classList.remove('hidden');
        } else {
          document.body.classList.remove('auth-mode');
          onSuccess?.();
        }
      }
    } catch (err) {
      showError(err.message || 'Не удалось войти. Попробуйте ещё раз.');
      submit.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
    } finally {
      busy = false;
      submit.disabled = false;
      if (submit.textContent === 'Входим…' || submit.textContent === 'Создаём…') {
        submit.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
      }
    }
  });

  email.focus({ preventScroll: true });
}

export function renderSetup(root) {
  document.body.classList.add('auth-mode');
  root.innerHTML = `<div class="auth-screen">
    <div class="auth-card setup-card">
      ${brand()}
      <h1 class="auth-title">Подключите Supabase</h1>
      <p class="auth-sub">Статическая версия на GitHub Pages хранит данные в вашем бесплатном проекте Supabase. Это займёт около пяти минут.</p>
      <ol class="setup-steps">
        <li>Создайте проект на <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a> (Free).</li>
        <li>В <b>SQL Editor</b> выполните файл <code>supabase/schema.sql</code> из репозитория.</li>
        <li>В <b>Authentication → Providers → Email</b> включите провайдер <b>Email</b> и при необходимости отключите подтверждение email для быстрого старта.</li>
        <li>В <b>Project Settings → API</b> скопируйте <b>Project URL</b> и <b>anon public key</b> в файл <code>public/js/config.js</code>.</li>
        <li>Запушьте репозиторий на GitHub — workflow <code>Deploy to GitHub Pages</code> опубликует папку <code>public</code>.</li>
      </ol>
      <div class="setup-note">Anon-ключ не секретный: доступ к данным ограничивают RLS-политики. Никогда не вставляйте во фронтенд <code>service_role</code> ключ.</div>
      <p class="auth-note">Подробная инструкция — в <code>README.md</code> проекта. Локальная версия с Node.js и SQLite продолжает работать без Supabase.</p>
    </div>
    <p class="auth-copyright">Фьючерс Дневник · облачная версия</p>
  </div>`;
  root.querySelector('.setup-card')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) e.stopPropagation();
  });
}
