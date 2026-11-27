import { store } from '../store.js';
import { api } from '../api.js';
import { cloud } from '../cloud.js';
import {
  money, signedMoney, num, fmtDateShort, isoDay, escapeHtml, escapeAttr, plural, cls,
} from '../format.js';
import { icon, toast, openModal, confirmDialog, downloadFile, readFileText, emptyState } from '../components.js';

function openAccountModal() {
  const formId = `af${Date.now()}`;
  const body = `<form id="${formId}" class="form-grid" novalidate>
    <div class="field full"><label for="${formId}-name">Название счёта <span class="req">*</span></label><input class="input" id="${formId}-name" name="name" placeholder="Например, Проп-счёт 50K" maxlength="60"></div>
    <div class="field"><label for="${formId}-broker">Брокер / платформа</label><input class="input" id="${formId}-broker" name="broker" placeholder="AMP, Rithmic, Tradovate"></div>
    <div class="field"><label for="${formId}-currency">Валюта</label>
      <select class="input" id="${formId}-currency" name="currency"><option value="RUB">RUB (₽)</option></select>
    </div>
    <div class="field full"><label for="${formId}-balance">Стартовый баланс</label><input class="input" id="${formId}-balance" name="initial_balance" type="number" step="0.01" value="200000"></div>
    <div class="errors hidden" data-errors></div>
  </form>`;
  const m = openModal({
    title: 'Новый счёт',
    sub: 'Счёт — отдельный журнал и статистика. Переключаться можно в сайдбаре.',
    body,
    footer: `<button type="button" class="btn" data-cancel>Отмена</button>
      <div class="right"><button type="submit" class="btn btn-primary" form="${formId}">Создать счёт</button></div>`,
  });
  const form = m.overlay.querySelector(`#${formId}`);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.querySelector('[name=name]').value.trim();
    if (!name) {
      const err = form.querySelector('[data-errors]');
      err.innerHTML = '<ul><li>Укажите название счёта</li></ul>';
      err.classList.remove('hidden');
      return;
    }
    try {
      const res = await api.create('accounts', {
        name,
        broker: form.querySelector('[name=broker]').value.trim(),
        currency: form.querySelector('[name=currency]').value,
        initial_balance: Number(form.querySelector('[name=initial_balance]').value) || 0,
      });
      store.setAccount(res.id);
      m.close();
      toast('Счёт создан');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) { toast(err.message, 'error'); }
  });
  m.overlay.querySelector('[data-cancel]').addEventListener('click', m.close);
}

async function removeAccount(account) {
  if (store.accounts.length <= 1) { toast('Нельзя удалить единственный счёт', 'error'); return; }
  const count = store.trades.filter((t) => t.account_id === account.id).length;
  const ok = await confirmDialog({
    title: `Удалить счёт «${account.name}»?`,
    text: `Вместе со счётом удалятся ${count} ${plural(count, 'сделка', 'сделки', 'сделок')}, пополнения и записи дневника этого счёта. Действие необратимо.`,
    confirmText: 'Удалить счёт',
  });
  if (!ok) return;
  try {
    await api.remove('accounts', account.id);
    toast('Счёт удалён');
    window.dispatchEvent(new Event('data:changed'));
  } catch (err) { toast(err.message, 'error'); }
}

async function exportBackup() {
  try {
    const data = await api.load();
    downloadFile(`futures-journal-backup-${isoDay()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Резервная копия скачана');
  } catch (err) { toast(err.message, 'error'); }
}

async function importBackup(file) {
  try {
    const text = await readFileText(file);
    const data = JSON.parse(text);
    const tables = ['accounts', 'instruments', 'trades', 'journal', 'cashflows'];
    for (const t of tables) if (!Array.isArray(data[t])) throw new Error(`В файле нет массива ${t}`);
    const ok = await confirmDialog({
      title: 'Восстановить из копии?',
      text: `Текущие данные будут заменены: ${data.accounts.length} ${plural(data.accounts.length, 'счёт', 'счёта', 'счетов')}, ${data.trades.length} ${plural(data.trades.length, 'сделка', 'сделки', 'сделок')}, ${data.journal.length} записей дневника.`,
      confirmText: 'Восстановить',
      danger: true,
    });
    if (!ok) return;
    await api.restore(data);
    toast('Данные восстановлены');
    window.dispatchEvent(new Event('data:changed'));
  } catch (err) {
    toast(err.message === 'Unexpected token' ? 'Файл не похож на JSON-копию' : err.message, 'error');
  }
}

export function render(root) {
  const account = store.account;
  if (!account) {
    root.innerHTML = `<div class="card">${emptyState({
      iconName: 'wallet', title: 'Нет счёта', text: 'Создайте счёт — это отдельный журнал сделок.',
      action: '<button class="btn btn-primary" data-create-account>Создать счёт</button>',
    })}</div>`;
    root.querySelector('[data-create-account]').addEventListener('click', openAccountModal);
    return;
  }
  const c = account.currency;
  const flows = [...store.accountCashflows].sort((a, b) => b.date.localeCompare(a.date));
  const tradeCount = store.trades.filter((t) => t.account_id === account.id).length;
  const theme = document.documentElement.dataset.theme || 'light';
  const totalCash = flows.reduce((s, f) => s + Number(f.amount), 0);

  root.innerHTML = `<div class="settings-grid">
    ${cloud.enabled ? `<div class="card" style="grid-column:1/-1">
      <div class="card-head">
        <div><h3 class="card-title">Аккаунт</h3><p class="card-sub">${escapeHtml(cloud.email || 'вы вошли в Supabase')}</p></div>
        <div class="card-actions"><button class="btn btn-sm" data-logout>${icon('logout')} Выйти</button></div>
      </div>
      <div class="card-body">
        <div class="kv"><span class="k">Хранилище</span><span class="v">Supabase · PostgreSQL + RLS</span></div>
        <div class="kv"><span class="k">Доступ</span><span class="v">только ваши строки, на всех устройствах</span></div>
        <p class="small muted" style="margin:10px 0 0">Данные синхронизируются между устройствами после входа. Anon-ключ публичный, доступ ограничен политиками RLS на стороне базы.</p>
      </div>
    </div>` : ''}
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">Счёт</h3><p class="card-sub">Название, брокер, стартовый баланс</p></div></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field full"><label for="accName">Название</label><input class="input" id="accName" value="${escapeAttr(account.name)}" maxlength="60"></div>
          <div class="field"><label for="accBroker">Брокер / платформа</label><input class="input" id="accBroker" value="${escapeAttr(account.broker || '')}" placeholder="AMP, Rithmic"></div>
          <div class="field"><label for="accCurrency">Валюта</label>
            <select class="input" id="accCurrency">
              ${[...new Set(['RUB', account.currency])].map((cur) => `<option value="${cur}" ${account.currency === cur ? 'selected' : ''}>${cur}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label for="accBalance">Стартовый баланс</label><input class="input" id="accBalance" type="number" step="0.01" value="${Number(account.initial_balance) || 0}"></div>
          <div class="field"><label>Текущий баланс</label><div class="input" style="display:flex;align-items:center;background:var(--surface-2);font-weight:600">${money(store.balance, c)}</div></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-primary" data-save-account>Сохранить</button></div>
        <p class="small muted" style="margin:10px 0 0">Валюта влияет на отображение, но не пересчитывает исторические сделки. Итоговый баланс = стартовый + пополнения/выводы + P&amp;L.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3 class="card-title">Все счета</h3><p class="card-sub">${store.accounts.length} ${plural(store.accounts.length, 'счёт', 'счёта', 'счетов')}</p></div>
        <div class="card-actions"><button class="btn btn-sm" data-create-account>${icon('plus')} Счёт</button></div></div>
      <div class="card-body flush">
        <div class="table-wrap"><table class="tbl mini-table"><thead><tr><th>Счёт</th><th class="num">Баланс</th><th class="num">Сделок</th><th></th></tr></thead><tbody>
          ${store.accounts.map((a) => `<tr class="clickable" data-acc="${a.id}">
            <td><b>${escapeHtml(a.name)}</b>${a.id === account.id ? ' <span class="badge badge-long">текущий</span>' : ''}<div class="sub">${escapeHtml(a.broker || '')} · ${escapeHtml(a.currency)}</div></td>
            <td class="num">${money(accountBalance(a), a.currency)}</td>
            <td class="num muted">${store.trades.filter((t) => t.account_id === a.id).length}</td>
            <td class="num">${a.id === account.id ? '' : `<button class="btn btn-icon btn-sm" data-del-acc="${a.id}" title="Удалить">${icon('trash')}</button>`}</td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3 class="card-title">Пополнения и выводы</h3><p class="card-sub">Влияют на баланс, но не на торговый P&amp;L</p></div>
        <div class="card-actions"><span class="small muted">Итого: <b class="${cls(totalCash)}">${signedMoney(totalCash, c)}</b></span></div></div>
      <div class="card-body">
        <div class="cashflow-form">
          <div class="field"><label for="cfDate">Дата</label><input class="input" id="cfDate" type="date" value="${isoDay(new Date())}"></div>
          <div class="field"><label for="cfAmount">Сумма</label><input class="input" id="cfAmount" type="number" step="0.01" placeholder="+5000 / −2000"></div>
          <div class="field"><label for="cfNote">Комментарий</label><input class="input" id="cfNote" placeholder="Пополнение, вывод прибыли"></div>
          <button class="btn btn-primary" data-add-flow>${icon('plus')} Добавить</button>
        </div>
        <div class="table-wrap" style="margin-top:12px">
          ${flows.length ? `<table class="tbl mini-table"><thead><tr><th>Дата</th><th>Комментарий</th><th class="num">Сумма</th><th></th></tr></thead><tbody>
            ${flows.map((f) => `<tr><td class="nowrap">${fmtDateShort(f.date)}</td><td class="muted">${escapeHtml(f.note || '—')}</td><td class="num ${cls(f.amount)}">${signedMoney(f.amount, c)}</td>
              <td class="num"><button class="btn btn-icon btn-sm" data-del-flow="${f.id}" title="Удалить">${icon('close')}</button></td></tr>`).join('')}
          </tbody></table>` : '<p class="small muted" style="margin:0">Пока нет пополнений и выводов.</p>'}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3 class="card-title">Данные и резервные копии</h3><p class="card-sub">${cloud.enabled ? 'Данные в Supabase, доступны с любого устройства' : 'Всё хранится в SQLite на вашем компьютере'}</p></div></div>
      <div class="card-body">
        <div class="data-actions">
          <button class="btn" data-export>${icon('download')} Экспорт JSON</button>
          ${cloud.enabled ? '' : `<button class="btn" data-import>${icon('upload')} Импорт JSON</button>`}
          <button class="btn btn-sm" data-demo>Демо-данные</button>
        </div>
        ${cloud.enabled ? '<input type="file" class="hidden" id="backupFile">' : '<input type="file" accept=".json,application/json" id="backupFile" class="hidden">'}
        ${cloud.enabled ? '<p class="small muted" style="margin:9px 0 0">В облачной версии полное восстановление JSON не поддерживается (чтобы не смешивать данные пользователей). Используйте CSV-импорт сделок или резервную копию локальной версии.</p>' : ''}
        <hr class="divider">
        <div class="kv"><span class="k">Сделок на счёте</span><span class="v">${tradeCount}</span></div>
        <div class="kv"><span class="k">Инструментов</span><span class="v">${store.instruments.length}</span></div>
        <div class="kv"><span class="k">Записей дневника</span><span class="v">${store.journal.length}</span></div>
        <div class="kv"><span class="k">Пополнений / выводов</span><span class="v">${flows.length}</span></div>
        <hr class="divider">
        <p class="small muted" style="margin:0 0 8px">Очистка удалит сделки, пополнения и дневник текущего счёта. Инструменты и сам счёт останутся.</p>
        <button class="btn btn-danger btn-sm" data-clear>${icon('trash')} Очистить журнал</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3 class="card-title">Оформление</h3><p class="card-sub">Тема интерфейса</p></div></div>
      <div class="card-body">
        <div class="chips">
          <button class="chip ${theme === 'light' ? 'active' : ''}" data-theme-set="light">${icon('sun')} Светлая</button>
          <button class="chip ${theme === 'dark' ? 'active' : ''}" data-theme-set="dark">${icon('moon')} Тёмная</button>
        </div>
        <hr class="divider">
        <p class="small muted" style="margin:0">${cloud.enabled
          ? 'Статическая версия: интерфейс и графики встроены, данные хранятся в вашем Supabase. Внешних CDN нет.'
          : 'Сервис работает офлайн: графики, шрифты и иконки встроены, внешних CDN нет. Данные не отправляются в интернет.'}</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3 class="card-title">О сервисе</h3><p class="card-sub">Фьючерс Дневник 1.0</p></div></div>
      <div class="card-body">
        <p class="small muted" style="margin-top:0">Как считается результат:</p>
        <ul class="about-list">
          <li>P&amp;L = направление × (выход − вход) × контракты × стоимость пункта − комиссии + фандинг</li>
          <li>R = P&amp;L / риск, где риск = |вход − стоп| × контракты × стоимость пункта</li>
          <li>Баланс = стартовый баланс + пополнения − выводы + P&amp;L закрытых сделок</li>
          <li>Просадка — от пика капитала внутри выбранного периода</li>
        </ul>
        <p class="small muted">Ctrl + Enter сохраняет сделку или запись дневника, Esc закрывает окно.</p>
      </div>
    </div>
  </div>`;

  root.querySelector('[data-save-account]').addEventListener('click', async () => {
    const btn = root.querySelector('[data-save-account]');
    btn.disabled = true;
    try {
      await api.update('accounts', account.id, {
        name: root.querySelector('#accName').value.trim() || account.name,
        broker: root.querySelector('#accBroker').value.trim(),
        currency: root.querySelector('#accCurrency').value,
        initial_balance: Number(root.querySelector('#accBalance').value) || 0,
      });
      toast('Счёт сохранён');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });

  root.querySelectorAll('[data-acc]').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-acc]')) return;
      const id = Number(tr.dataset.acc);
      if (id === account.id) return;
      store.setAccount(id);
      toast('Счёт переключён');
      window.dispatchEvent(new Event('data:changed'));
    });
  });
  root.querySelectorAll('[data-del-acc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const acc = store.accounts.find((a) => a.id === Number(btn.dataset.delAcc));
      if (acc) removeAccount(acc);
    });
  });
  root.querySelectorAll('[data-create-account]').forEach((b) => b.addEventListener('click', openAccountModal));

  root.querySelector('[data-add-flow]').addEventListener('click', async () => {
    const amount = Number(root.querySelector('#cfAmount').value);
    if (!amount) { toast('Укажите сумму пополнения или вывода', 'error'); return; }
    try {
      await api.create('cashflows', {
        account_id: account.id,
        date: root.querySelector('#cfDate').value || isoDay(new Date()),
        amount,
        note: root.querySelector('#cfNote').value.trim(),
      });
      toast('Операция добавлена');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) { toast(err.message, 'error'); }
  });
  root.querySelectorAll('[data-del-flow]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Удалить операцию?', text: 'Баланс и кривая капитала пересчитаются.', confirmText: 'Удалить' });
      if (!ok) return;
      try {
        await api.remove('cashflows', Number(btn.dataset.delFlow));
        toast('Операция удалена');
        window.dispatchEvent(new Event('data:changed'));
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  root.querySelector('[data-export]').addEventListener('click', exportBackup);
  const fileInput = root.querySelector('#backupFile');
  root.querySelector('[data-import]')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file && !cloud.enabled) importBackup(file);
    fileInput.value = '';
  });

  root.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await cloud.signOut();
    location.hash = '#/dashboard';
    location.reload();
  });

  root.querySelector('[data-demo]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Загрузить демо-данные?',
      text: 'Текущие счета, сделки, дневник и пополнения будут заменены демонстрационным журналом на 5 месяцев.',
      confirmText: 'Заменить демо',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.demo();
      toast('Демо-данные загружены');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) { toast(err.message, 'error'); }
  });

  root.querySelector('[data-clear]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Очистить журнал?',
      text: 'Будут удалены все сделки, пополнения и записи дневника текущего счёта. Инструменты и счёт сохранятся. Сделайте резервную копию заранее.',
      confirmText: 'Очистить',
    });
    if (!ok) return;
    try {
      await api.clear();
      toast('Журнал очищен');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) { toast(err.message, 'error'); }
  });

  root.querySelectorAll('[data-theme-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.documentElement.dataset.theme = btn.dataset.themeSet;
      try { localStorage.setItem('fd.theme', btn.dataset.themeSet); } catch { /* ignore */ }
      window.dispatchEvent(new Event('theme:changed'));
    });
  });
}

function accountBalance(a) {
  const net = store.trades.filter((t) => t.account_id === a.id && t.closed).reduce((s, t) => s + t.net, 0);
  const cash = store.cashflows.filter((c) => c.account_id === a.id).reduce((s, c) => s + Number(c.amount), 0);
  return (Number(a.initial_balance) || 0) + cash + net;
}
