import { store, PERIODS, PERIOD_LABELS } from './store.js';
import { icon, toast } from './components.js';
import { plural } from './format.js';
import { cloud } from './cloud.js';
import { renderAuth, renderSetup } from './auth.js';
import { openTradeForm } from './trade-form.js';
import * as dashboard from './pages/dashboard.js';
import * as trades from './pages/trades.js';
import * as analytics from './pages/analytics.js';
import * as journal from './pages/journal.js';
import * as instruments from './pages/instruments.js';
import * as settings from './pages/settings.js';

const NAV = [
  ['dashboard', 'Дашборд', 'dashboard'],
  ['trades', 'Сделки', 'trades'],
  ['analytics', 'Аналитика', 'analytics'],
  ['journal', 'Дневник', 'journal'],
  ['instruments', 'Инструменты', 'layers'],
  ['settings', 'Настройки', 'settings'],
];

const ROUTES = {
  dashboard: { title: 'Дашборд', page: dashboard, sub: () => `${subAccount()} · ${periodLabel()}` },
  trades: { title: 'Сделки', page: trades, sub: () => `Журнал сделок${subAccount() ? ` · ${subAccount()}` : ''}` },
  analytics: { title: 'Аналитика', page: analytics, sub: () => `Статистика и поведение · ${periodLabel()}` },
  journal: { title: 'Дневник', page: journal, sub: () => 'План, разбор дня и психология' },
  instruments: { title: 'Инструменты', page: instruments, sub: () => 'Спецификации контрактов и комиссии' },
  settings: { title: 'Настройки', page: settings, sub: () => 'Счёт, резервные копии и оформление' },
};

const el = {
  view: document.getElementById('view'),
  title: document.getElementById('pageTitle'),
  sub: document.getElementById('pageSub'),
  actions: document.getElementById('topActions'),
  nav: document.getElementById('nav'),
  mobileNav: document.getElementById('mobileNav'),
  accountSwitch: document.getElementById('accountSwitch'),
  sideFoot: document.getElementById('sideFoot'),
};

function subAccount() {
  const a = store.account;
  if (!a) return 'Нет счёта';
  const n = store.accountTrades.length;
  return `${a.name} · ${n} ${plural(n, 'сделка', 'сделки', 'сделок')}`;
}

function periodLabel() {
  return PERIOD_LABELS[store.period] || '';
}

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const key = raw.split('/')[0];
  return ROUTES[key] ? key : 'dashboard';
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).slice(0, 2);
  const text = parts.map((p) => p[0] || '').join('').toUpperCase();
  return text || '—';
}

function renderNav() {
  const route = currentRoute();
  const link = ([key, label, iconName], mobile = false) => `<a class="${mobile ? 'mobile-nav-link' : 'nav-link'} ${route === key ? 'active' : ''}" href="#/${key}" aria-current="${route === key ? 'page' : 'false'}">
    ${icon(iconName)}<span>${label}</span></a>`;
  el.nav.innerHTML = NAV.map((n) => link(n)).join('');
  el.mobileNav.innerHTML = NAV.map((n) => link(n, true)).join('');
}

function renderAccountSwitch() {
  const account = store.account;
  if (!account) {
    el.accountSwitch.innerHTML = `<a class="acc-btn" href="#/settings"><span class="acc-avatar">—</span><span class="acc-meta"><span class="acc-name">Нет счёта</span><span class="acc-broker">Создать в настройках</span></span>${icon('plus', 'icon acc-chev')}</a>`;
    return;
  }
  el.accountSwitch.innerHTML = `
    <button class="acc-btn" data-acc-toggle aria-haspopup="menu" aria-expanded="false">
      <span class="acc-avatar">${initials(account.name)}</span>
      <span class="acc-meta"><span class="acc-name">${escapeText(account.name)}</span><span class="acc-broker">${escapeText(account.broker || account.currency)}</span></span>
      ${icon('chevron-down', 'icon acc-chev')}
    </button>
    <div class="acc-menu hidden" data-acc-menu role="menu">
      ${store.accounts.map((a) => `<button class="acc-item ${a.id === account.id ? 'active' : ''}" data-account="${a.id}" role="menuitem">
        <span class="acc-avatar" style="width:24px;height:24px;border-radius:7px;font-size:10px">${initials(a.name)}</span>
        <span class="acc-meta"><span class="acc-name">${escapeText(a.name)}</span><span class="acc-broker">${escapeText(a.currency)} · ${formatMoneyShort(a)}</span></span>
      </button>`).join('')}
      <a class="acc-add" href="#/settings">${icon('plus')} Добавить счёт</a>
    </div>`;
  const btn = el.accountSwitch.querySelector('[data-acc-toggle]');
  const menu = el.accountSwitch.querySelector('[data-acc-menu]');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', String(!open));
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.querySelectorAll('[data-account]').forEach((item) => {
    item.addEventListener('click', () => {
      const id = Number(item.dataset.account);
      if (id === store.accountId) { menu.classList.add('hidden'); return; }
      store.setAccount(id);
      renderChrome();
      renderRoute();
      toast('Счёт переключён');
    });
  });
}

function formatMoneyShort(account) {
  const net = store.trades.filter((t) => t.account_id === account.id && t.closed).reduce((s, t) => s + t.net, 0);
  const cash = store.cashflows.filter((cc) => cc.account_id === account.id).reduce((s, cc) => s + Number(cc.amount), 0);
  const balance = (Number(account.initial_balance) || 0) + cash + net;
  const sym = { USD: '$', EUR: '€', RUB: '₽' }[account.currency] || '';
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(balance);
  return account.currency === 'RUB' ? `${formatted} ₽` : `${sym}${formatted}`;
}

function escapeText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSideFoot() {
  if (cloud.enabled) {
    const email = cloud.email || 'аккаунт Supabase';
    el.sideFoot.innerHTML = `<div class="demo-card">
      <div class="row"><span class="dot"></span> Облако Supabase</div>
      <p>${escapeText(email)}<br><a href="#/settings">Аккаунт и данные →</a></p>
    </div>`;
    return;
  }
  const total = store.trades.length;
  el.sideFoot.innerHTML = `<div class="demo-card">
    <div class="row"><span class="dot"></span> Локальный сервис</div>
    <p>${total} ${plural(total, 'сделка', 'сделки', 'сделок')} в базе SQLite. <a href="#/settings">Данные →</a></p>
  </div>`;
}

function themeIcon() {
  return document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon';
}

function actionsHtml(route) {
  const period = ['dashboard', 'analytics'].includes(route)
    ? `<div class="seg" id="periodSeg" role="group" aria-label="Период">${PERIODS.map((p) => `<button data-period="${p.key}" class="${store.period === p.key ? 'active' : ''}">${p.label}</button>`).join('')}</div>`
    : '';
  return `${period}
    <button class="btn btn-icon" data-theme-toggle title="Сменить тему" aria-label="Сменить тему">${icon(themeIcon())}</button>
    <button class="btn btn-primary" data-new-trade>${icon('plus')} Новая сделка</button>`;
}

function bindActions() {
  el.actions.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.setPeriod(btn.dataset.period);
      renderRoute();
    });
  });
  el.actions.querySelector('[data-theme-toggle]')?.addEventListener('click', toggleTheme);
  el.actions.querySelector('[data-new-trade]')?.addEventListener('click', () => openTradeForm());
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('fd.theme', next); } catch { /* ignore */ }
  const btn = el.actions.querySelector('[data-theme-toggle]');
  if (btn) btn.innerHTML = icon(themeIcon());
  window.dispatchEvent(new Event('theme:changed'));
}

function renderChrome() {
  renderNav();
  renderAccountSwitch();
  renderSideFoot();
}

function renderRoute() {
  const route = currentRoute();
  const meta = ROUTES[route];
  document.title = `${meta.title} — Фьючерс Дневник`;
  el.title.textContent = meta.title;
  el.sub.textContent = meta.sub();
  el.actions.innerHTML = actionsHtml(route);
  bindActions();
  el.view.innerHTML = '';
  try {
    meta.page.render(el.view);
  } catch (err) {
    console.error(err);
    el.view.innerHTML = `<div class="card"><div class="empty">
      <div class="empty-icon">${icon('alert')}</div>
      <div class="empty-title">Не удалось отрисовать страницу</div>
      <div class="empty-text">${escapeText(err.message)}</div>
      <button class="btn" data-retry>Повторить</button>
    </div></div>`;
    el.view.querySelector('[data-retry]')?.addEventListener('click', renderRoute);
  }
}

function applyInitialTheme() {
  let saved = null;
  try { saved = localStorage.getItem('fd.theme'); } catch { /* ignore */ }
  document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
}

function fatal(message) {
  el.view.innerHTML = `<div class="card" style="margin-top:20px"><div class="empty">
    <div class="empty-icon">${icon('alert')}</div>
    <div class="empty-title">Не удалось загрузить данные</div>
    <div class="empty-text">${escapeText(message)}</div>
    <button class="btn btn-primary" data-retry>Повторить</button>
  </div></div>`;
  el.view.querySelector('[data-retry]')?.addEventListener('click', boot);
}

function isLocalHost() {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
}

function isAuthError(err) {
  return err && (err.status === 401 || /сессия|требуется вход|jwt|token|войдите/i.test(String(err.message || '')));
}

function showAuth() {
  document.body.classList.add('auth-mode');
  document.title = 'Вход — Фьючерс Дневник';
  el.actions.innerHTML = '';
  document.getElementById('modalRoot').innerHTML = '';
  document.body.style.overflow = '';
  el.view.innerHTML = '';
  renderAuth(el.view, {
    onSuccess: () => {
      document.body.classList.remove('auth-mode');
      bootApp();
    },
  });
}

function showSetup() {
  document.body.classList.add('auth-mode');
  document.title = 'Подключение — Фьючерс Дневник';
  el.actions.innerHTML = '';
  el.view.innerHTML = '';
  renderSetup(el.view);
}

async function bootApp() {
  el.view.innerHTML = '<div class="loading"><span class="spinner"></span> Загружаем журнал…</div>';
  try {
    await store.load();
  } catch (err) {
    if (cloud.enabled && isAuthError(err)) {
      cloud.clearSession();
      showAuth();
      return;
    }
    fatal(err.message);
    return;
  }
  renderChrome();
  renderRoute();
}

async function boot() {
  applyInitialTheme();
  try {
    await cloud.init();
  } catch (err) {
    console.error(err);
  }
  if (cloud.enabled) {
    if (!cloud.session) { showAuth(); return; }
    document.body.classList.remove('auth-mode');
    await bootApp();
    return;
  }
  if (!isLocalHost()) { showSetup(); return; }
  await bootApp();
}

document.addEventListener('click', () => {
  document.querySelectorAll('[data-acc-menu]').forEach((menu) => menu.classList.add('hidden'));
  document.querySelectorAll('[data-acc-toggle]').forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
});

window.addEventListener('hashchange', () => {
  if (document.body.classList.contains('auth-mode')) return;
  renderChrome();
  renderRoute();
  window.scrollTo(0, 0);
});

window.addEventListener('data:changed', async () => {
  if (document.body.classList.contains('auth-mode')) return;
  try {
    await store.load();
    renderChrome();
    renderRoute();
  } catch (err) {
    if (cloud.enabled && isAuthError(err)) { cloud.clearSession(); showAuth(); return; }
    toast(err.message, 'error');
  }
});

window.addEventListener('theme:changed', () => {
  const btn = el.actions.querySelector('[data-theme-toggle]');
  if (btn) btn.innerHTML = icon(themeIcon());
  if (currentRoute() === 'settings') renderRoute();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const route = currentRoute();
    if (!document.querySelector('.modal-overlay') && (route === 'dashboard' || route === 'analytics')) renderRoute();
  }, 220);
});

applyInitialTheme();
boot();
