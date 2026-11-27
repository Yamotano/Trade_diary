import { store } from '../store.js';
import { stats } from '../../analytics.js';
import {
  money, signedMoney, num, numTrim, price, pct, rmult, cls, fmtDateShort, fmtTime, fmtDuration,
  escapeHtml, escapeAttr, plural, isoDay, fmtDateFull,
} from '../format.js';
import { icon, emptyState, sideBadge, starsMini, pagination, toast, openModal, downloadFile, readFileText } from '../components.js';
import { openTradeForm } from '../trade-form.js';
import { api } from '../api.js';
import { tradesToCsv, csvTemplate, parseTradesCsv } from '../csv.js';

const PAGE_SIZE = 40;
const state = {
  q: '', symbol: '', side: '', result: '', from: '', to: '',
  sort: 'date', dir: 'desc', page: 1,
};

function filteredTrades() {
  const q = state.q.trim().toLowerCase();
  return store.accountTrades.filter((t) => {
    if (state.symbol && t.symbol !== state.symbol) return false;
    if (state.side && t.side !== state.side) return false;
    if (state.result === 'open' && t.closed) return false;
    if (state.result === 'win' && !(t.closed && t.net > 0)) return false;
    if (state.result === 'loss' && !(t.closed && t.net < 0)) return false;
    if (state.result === 'be' && !(t.closed && t.net === 0)) return false;
    if (state.from && t.day < state.from) return false;
    if (state.to && t.day > state.to) return false;
    if (q) {
      const hay = [t.symbol, t.setup, t.tags, t.mistakes, t.notes, t.emotion, t.rating ? `${t.rating}` : ''].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sorted(list) {
  const dir = state.dir === 'asc' ? 1 : -1;
  const value = (t) => {
    switch (state.sort) {
      case 'symbol': return t.symbol;
      case 'qty': return Number(t.qty) || 0;
      case 'r': return t.r === null ? -Infinity : t.r;
      case 'net': return t.net === null ? -Infinity : t.net;
      case 'duration': return t.durMin === null ? -Infinity : t.durMin;
      default: return (t.exit_time || t.entry_time || '');
    }
  };
  return [...list].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (typeof va === 'string') return va.localeCompare(vb) * dir || b.id - a.id;
    return (va - vb) * dir || b.id - a.id;
  });
}

function hasFilters() {
  return !!(state.q || state.symbol || state.side || state.result || state.from || state.to);
}

function updateChips(root) {
  root.querySelectorAll('[data-side-chip]').forEach((chip) => {
    chip.classList.toggle('active', (chip.dataset.sideChip || '') === state.side);
  });
}

function rowsHtml(list, currency) {
  if (!list.length) {
    return `<tr><td colspan="10">${emptyState({
      iconName: 'search',
      title: 'Ничего не найдено',
      text: 'Измените фильтры или сбросьте их, чтобы увидеть все сделки.',
      action: hasFilters() ? '<button class="btn btn-sm" data-reset-inline>Сбросить фильтры</button>' : '',
    })}</td></tr>`;
  }
  return list.map((t) => `<tr class="clickable" data-trade-id="${t.id}">
    <td class="date-cell"><span>${fmtDateShort(t.entry_time)}</span><span class="sub">${fmtTime(t.entry_time)}${t.exit_time ? ` → ${fmtTime(t.exit_time)}` : ' → —'}</span></td>
    <td><span class="sym">${escapeHtml(t.symbol)}</span><div class="sub truncate" style="max-width:150px">${escapeHtml(t.setup || '—')}</div></td>
    <td>${sideBadge(t.side)}</td>
    <td class="num">${numTrim(t.qty)}</td>
    <td class="num">${price(t.entry_price, t.tick_size)}<div class="sub">${t.exit_price !== null ? `→ ${price(t.exit_price, t.tick_size)}` : '—'}</div></td>
    <td class="num">${t.stop_price !== null ? price(t.stop_price, t.tick_size) : '—'}</td>
    <td class="num ${t.r === null ? '' : cls(t.r)}">${t.r === null ? '—' : rmult(t.r)}</td>
    <td class="num ${t.closed ? cls(t.net) : 'muted'}">${t.closed ? signedMoney(t.net, currency) : 'открыта'}</td>
    <td class="muted nowrap">${t.closed ? fmtDuration(t.durMin) : '—'}</td>
    <td>${starsMini(t.rating)}</td>
  </tr>`).join('');
}

function mountTable(root) {
  const list = sorted(filteredTrades());
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = list.slice(start, start + PAGE_SIZE);
  const body = root.querySelector('#tradeRows');
  if (!body) return;
  body.innerHTML = rowsHtml(pageRows, store.currency);

  const closed = list.filter((t) => t.closed);
  const s = stats(closed);
  const foot = root.querySelector('#tradeFoot');
  foot.innerHTML = `<span>
      ${list.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, list.length)} из ${list.length}` : '0'} · итого
      <b class="${cls(s.totalNet)}">${signedMoney(s.totalNet, store.currency)}</b>
      ${closed.length ? ` · винрейт ${pct(s.winRate)}` : ''}
      ${state.symbol ? ` · ${escapeHtml(state.symbol)}` : ''}
    </span>
    <div class="pagination">${pagination(state.page, pages)}</div>`;

  body.querySelectorAll('[data-trade-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const t = store.trades.find((x) => x.id === Number(tr.dataset.tradeId));
      if (t) openTradeForm(t);
    });
  });
  const inlineReset = body.querySelector('[data-reset-inline]');
  if (inlineReset) inlineReset.addEventListener('click', () => { resetFilters(); render(root); });
  foot.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.page);
      if (p > 0 && !btn.disabled) { state.page = p; mountTable(root); }
    });
  });
}

function resetFilters() {
  Object.assign(state, { q: '', symbol: '', side: '', result: '', from: '', to: '', page: 1 });
}

function openImport(root) {
  let parsed = null;
  const body = `<div class="file-drop" id="impDrop">
      ${icon('upload', 'icon')}
      <div style="margin-top:7px;font-weight:600;color:var(--text)">Перетащите CSV-файл или выберите на диске</div>
      <div class="small muted" style="margin-top:3px">Разделитель «;» или «,» · заголовки на русском или английском · до 10 МБ</div>
      <button type="button" class="btn btn-sm" style="margin-top:10px" data-pick>Выбрать файл</button>
      <input type="file" accept=".csv,text/csv,text/plain" class="hidden" id="impFile">
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">
      <button type="button" class="btn-link" data-template>${icon('download')} Скачать шаблон CSV</button>
      <span class="small muted">Без времени: вход 16:30, выход +1 час</span>
    </div>
    <div id="impPreview" style="margin-top:12px"></div>`;

  const m = openModal({
    title: 'Импорт сделок',
    sub: 'Сделки добавятся на текущий счёт. Проверьте тикеры и цены перед загрузкой.',
    body,
    size: 'wide',
    footer: `<button type="button" class="btn" data-cancel>Отмена</button>
      <div class="right"><button type="button" class="btn btn-primary" data-run disabled>Импортировать</button></div>`,
  });
  const drop = m.overlay.querySelector('#impDrop');
  const fileInput = m.overlay.querySelector('#impFile');
  const preview = m.overlay.querySelector('#impPreview');
  const runBtn = m.overlay.querySelector('[data-run]');

  async function handleFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('Файл больше 10 МБ', 'error'); return; }
    try {
      const text = await readFileText(file);
      parsed = parseTradesCsv(text, store.instruments);
      const valid = parsed.rows.length;
      const errors = parsed.errors;
      const sample = parsed.rows.slice(0, 6);
      preview.innerHTML = `<div class="inline-stats" style="margin-bottom:9px">
          <div class="inline-stat"><div class="k">К импорту</div><div class="v pos">${valid}</div></div>
          <div class="inline-stat"><div class="k">Ошибок</div><div class="v ${errors.length ? 'neg' : ''}">${errors.length}</div></div>
          <div class="inline-stat"><div class="k">Файл</div><div class="v" style="font-size:12px">${escapeHtml(file.name)}</div></div>
        </div>
        ${errors.length ? `<div class="errors" style="margin-bottom:9px"><b>Проблемные строки:</b><ul>${errors.slice(0, 8).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>${errors.length > 8 ? `<div class="small">и ещё ${errors.length - 8}…</div>` : ''}</div>` : ''}
        ${sample.length ? `<div class="import-preview"><table class="tbl mini-table"><thead><tr><th>Дата</th><th>Тикер</th><th>Сторона</th><th class="num">Кол-во</th><th class="num">Вход</th><th class="num">Выход</th></tr></thead><tbody>
          ${sample.map((r) => `<tr><td>${fmtDateShort(r.entry_time)} ${fmtTime(r.entry_time)}</td><td>${escapeHtml(r.symbol)}</td><td>${r.side === 'long' ? 'Лонг' : 'Шорт'}</td><td class="num">${numTrim(r.qty)}</td><td class="num">${price(r.entry_price, r.tick_size)}</td><td class="num">${r.exit_price !== null ? price(r.exit_price, r.tick_size) : '—'}</td></tr>`).join('')}
        </tbody></table></div>` : ''}`;
      runBtn.disabled = valid === 0;
      runBtn.textContent = valid ? `Импортировать ${valid}` : 'Импортировать';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  m.overlay.querySelector('[data-pick]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    handleFile(e.dataTransfer?.files?.[0]);
  });
  m.overlay.querySelector('[data-template]').addEventListener('click', () => downloadFile('futures-trades-template.csv', csvTemplate(), 'text/csv;charset=utf-8'));

  runBtn.addEventListener('click', async () => {
    if (!parsed || !parsed.rows.length) return;
    runBtn.disabled = true;
    try {
      const rows = parsed.rows.map((r) => ({ ...r, account_id: store.account.id }));
      let imported = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const res = await api.bulkTrades(rows.slice(i, i + 200));
        imported += res.imported;
      }
      m.close();
      toast(`Импортировано ${imported} ${plural(imported, 'сделка', 'сделки', 'сделок')}`);
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) {
      toast(err.message, 'error');
      runBtn.disabled = false;
    }
  });
  m.overlay.querySelector('[data-cancel]').addEventListener('click', m.close);
}

function toolbarHtml(symbols) {
  return `<div class="toolbar">
    <div class="search-field grow">
      ${icon('search')}
      <input class="input" id="tradeSearch" value="${escapeAttr(state.q)}" placeholder="Поиск по сделкам…">
    </div>
    <select class="input" id="tradeSymbol" style="width:126px" aria-label="Инструмент">
      <option value="">Все тикеры</option>
      ${symbols.map((s) => `<option value="${escapeAttr(s)}" ${state.symbol === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
    </select>
    <select class="input" id="tradeResult" style="width:132px" aria-label="Результат">
      <option value="">Все результаты</option>
      <option value="win" ${state.result === 'win' ? 'selected' : ''}>Прибыльные</option>
      <option value="loss" ${state.result === 'loss' ? 'selected' : ''}>Убыточные</option>
      <option value="be" ${state.result === 'be' ? 'selected' : ''}>Без результата</option>
      <option value="open" ${state.result === 'open' ? 'selected' : ''}>Открытые</option>
    </select>
    <div class="chips" data-side-chips>
      <button class="chip ${!state.side ? 'active' : ''}" data-side-chip="">Все</button>
      <button class="chip ${state.side === 'long' ? 'active' : ''}" data-side-chip="long">Лонг</button>
      <button class="chip ${state.side === 'short' ? 'active' : ''}" data-side-chip="short">Шорт</button>
    </div>
    <input class="input" id="tradeFrom" type="date" value="${escapeAttr(state.from)}" style="width:138px" aria-label="С даты">
    <span class="muted small">—</span>
    <input class="input" id="tradeTo" type="date" value="${escapeAttr(state.to)}" style="width:138px" aria-label="По дату">
    <div style="flex:1"></div>
    <button class="btn btn-sm" data-export>${icon('download')} CSV</button>
    <button class="btn btn-sm" data-import>${icon('upload')} Импорт</button>
    ${hasFilters() ? `<button class="btn btn-sm btn-icon" data-reset title="Сбросить фильтры">${icon('close')}</button>` : ''}
  </div>`;
}

function bind(root) {
  const search = root.querySelector('#tradeSearch');
  search.addEventListener('input', () => { state.q = search.value; state.page = 1; mountTable(root); });
  root.querySelector('#tradeSymbol').addEventListener('change', (e) => { state.symbol = e.target.value; state.page = 1; mountTable(root); });
  root.querySelector('#tradeResult').addEventListener('change', (e) => { state.result = e.target.value; state.page = 1; mountTable(root); });
  root.querySelector('#tradeFrom').addEventListener('change', (e) => { state.from = e.target.value; state.page = 1; mountTable(root); });
  root.querySelector('#tradeTo').addEventListener('change', (e) => { state.to = e.target.value; state.page = 1; mountTable(root); });
  root.querySelectorAll('[data-side-chip]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.side = chip.dataset.sideChip;
      state.page = 1;
      updateChips(root);
      mountTable(root);
    });
  });
  root.querySelectorAll('[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = key; state.dir = key === 'symbol' ? 'asc' : 'desc'; }
      render(root);
    });
  });
  root.querySelector('[data-export]').addEventListener('click', () => {
    const list = sorted(filteredTrades());
    if (!list.length) { toast('Нет сделок для экспорта', 'error'); return; }
    downloadFile(`futures-trades-${isoDay()}.csv`, tradesToCsv(list), 'text/csv;charset=utf-8');
  });
  root.querySelector('[data-import]').addEventListener('click', () => openImport(root));
  root.querySelector('[data-reset]')?.addEventListener('click', () => {
    resetFilters();
    render(root);
  });
}

export function render(root) {
  if (!store.account) {
    root.innerHTML = emptyState({ iconName: 'wallet', title: 'Нет торгового счёта', text: 'Создайте счёт в настройках.', action: '<a class="btn btn-primary" href="#/settings">Настройки</a>' });
    return;
  }
  const all = store.accountTrades;
  if (!all.length) {
    root.innerHTML = `<div class="card">${emptyState({
      iconName: 'trades',
      title: 'Сделок пока нет',
      text: 'Добавьте первую сделку вручную или импортируйте журнал из CSV — брокерский отчёт, Excel или таблицу.',
      action: `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-primary" data-add>${icon('plus')} Добавить сделку</button>
        <button class="btn" data-import-empty>${icon('upload')} Импорт CSV</button>
      </div>`,
    })}</div>`;
    root.querySelector('[data-add]').addEventListener('click', () => openTradeForm());
    root.querySelector('[data-import-empty]').addEventListener('click', () => openImport(root));
    return;
  }

  const symbols = [...new Set(all.map((t) => t.symbol))].sort();
  const sortInd = (key) => (state.sort === key ? `<span class="sort-ind">${state.dir === 'asc' ? '↑' : '↓'}</span>` : '');

  root.innerHTML = `<div class="card">
    ${toolbarHtml(symbols)}
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>
          <th class="sortable" data-sort="date">Дата${sortInd('date')}</th>
          <th class="sortable" data-sort="symbol">Инструмент${sortInd('symbol')}</th>
          <th>Сторона</th>
          <th class="num sortable" data-sort="qty">Кол-во${sortInd('qty')}</th>
          <th class="num">Вход / выход</th>
          <th class="num">Стоп</th>
          <th class="num sortable" data-sort="r">R${sortInd('r')}</th>
          <th class="num sortable" data-sort="net">P&amp;L${sortInd('net')}</th>
          <th class="sortable" data-sort="duration">Длит.${sortInd('duration')}</th>
          <th>Оценка</th>
        </tr></thead>
        <tbody id="tradeRows"></tbody>
      </table>
    </div>
    <div class="table-footer" id="tradeFoot"></div>
  </div>
  <p class="small muted" style="margin:10px 2px 0">Клик по строке открывает сделку для редактирования. P&amp;L считается с учётом комиссий и фандинга.</p>`;

  mountTable(root);
  bind(root);
}
