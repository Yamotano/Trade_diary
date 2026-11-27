import { store, PERIOD_LABELS } from '../store.js';
import { stats, dailyPnl, groupBy, equityCurve, rHistogram } from '../../analytics.js';
import {
  money, signedMoney, num, numTrim, price, pct, rmult, ratio, cls, fmtDateShort, fmtDateFull, fmtTime, fmtDuration,
  isoDay, escapeHtml, escapeAttr, plural, signedPct,
} from '../format.js';
import { icon, emptyState, sideBadge, starsMini, toast, openModal } from '../components.js';
import { equityChart, drawdownChart, sparkline, columnChart } from '../charts.js';
import { openTradeForm } from '../trade-form.js';
import { api } from '../api.js';

const view = { cal: null };

function calState() {
  if (!view.cal) {
    const d = new Date();
    view.cal = { year: d.getFullYear(), month: d.getMonth() };
  }
  return view.cal;
}

function monthLabel(year, month) {
  const names = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  return `${names[month]} ${year}`;
}

function calendarHtml(days, year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const today = isoDay(new Date());
  let maxAbs = 0;
  let net = 0, count = 0;
  let best = null, worst = null;
  for (let d = 1; d <= total; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = days.get(key);
    if (rec) {
      maxAbs = Math.max(maxAbs, Math.abs(rec.net));
      net += rec.net; count += rec.count;
      if (!best || rec.net > best.net) best = { ...rec, day: key };
      if (!worst || rec.net < worst.net) worst = { ...rec, day: key };
    }
  }
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= total; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = days.get(key);
    const isToday = key === today;
    if (!rec) {
      cells.push(`<div class="cal-cell ${isToday ? 'today' : ''}"><span class="cal-day">${d}</span></div>`);
      continue;
    }
    const level = Math.max(1, Math.min(4, Math.ceil((Math.abs(rec.net) / (maxAbs || 1)) * 4)));
    const sign = rec.net >= 0 ? 'pos' : 'neg';
    cells.push(`<div class="cal-cell has ${sign}-${level} ${isToday ? 'today' : ''}" data-day="${key}" role="button" tabindex="0"
      title="${escapeAttr(`${fmtDateFull(key)}: ${signedMoney(rec.net, store.currency)} · ${rec.count} ${plural(rec.count, 'сделка', 'сделки', 'сделок')}`)}">
      <span class="cal-day">${d}</span>
      <span class="cal-val">${escapeHtml(signedMoney(rec.net, store.currency, { compact: true }))}</span>
    </div>`);
  }
  const dow = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  return `<div class="cal-head">
      <div>
        <div class="cal-title">${monthLabel(year, month)}</div>
        <div class="small muted">${count ? `${count} ${plural(count, 'сделка', 'сделки', 'сделок')}` : 'нет сделок'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="cal-total">Итого<b class="${cls(net)}">${signedMoney(net, store.currency)}</b></div>
        <div class="cal-nav">
          <button class="btn btn-icon btn-sm" data-cal-prev aria-label="Предыдущий месяц">${icon('chevron-left')}</button>
          <button class="btn btn-icon btn-sm" data-cal-next aria-label="Следующий месяц">${icon('chevron-right')}</button>
        </div>
      </div>
    </div>
    <div class="cal">${dow}${cells.join('')}</div>
    ${best ? `<div class="table-footer" style="margin-top:auto;border-top:1px solid var(--line)">
      <span>Лучший день <b class="pos">${fmtDateShort(best.day)} · ${signedMoney(best.net, store.currency)}</b></span>
      <span>Худший <b class="neg">${fmtDateShort(worst.day)} · ${signedMoney(worst.net, store.currency)}</b></span>
    </div>` : ''}`;
}

function dayModal(day) {
  const trades = store.accountTrades.filter((t) => t.day === day);
  const s = stats(trades);
  const journal = store.journalMap[day];
  const rows = trades
    .sort((a, b) => (a.entry_time || '').localeCompare(b.entry_time || ''))
    .map((t) => `<tr>
      <td>${fmtTime(t.entry_time)}${t.exit_time ? ` – ${fmtTime(t.exit_time)}` : ''}</td>
      <td><span class="sym">${escapeHtml(t.symbol)}</span></td>
      <td>${sideBadge(t.side)}</td>
      <td class="num">${numTrim(t.qty)}</td>
      <td class="num">${price(t.entry_price, t.tick_size)}${t.exit_price !== null ? ` → ${price(t.exit_price, t.tick_size)}` : ''}</td>
      <td class="num">${t.r !== null ? rmult(t.r) : '—'}</td>
      <td class="num ${t.closed ? cls(t.net) : 'muted'}">${t.closed ? signedMoney(t.net, store.currency, { decimals: 0 }) : 'открыта'}</td>
    </tr>`).join('');
  const body = `<div class="day-modal-grid">
      <div class="day-stat"><div class="k">Результат</div><div class="v ${cls(s.totalNet)}">${signedMoney(s.totalNet, store.currency)}</div></div>
      <div class="day-stat"><div class="k">Сделок</div><div class="v">${s.count}</div></div>
      <div class="day-stat"><div class="k">Винрейт</div><div class="v">${s.count ? pct(s.winRate) : '—'}</div></div>
      <div class="day-stat"><div class="k">Средний R</div><div class="v">${s.avgR === null ? '—' : rmult(s.avgR)}</div></div>
    </div>
    ${rows ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Время</th><th>Тикер</th><th>Сторона</th><th class="num">Кол-во</th><th class="num">Вход → выход</th><th class="num">R</th><th class="num">P&amp;L</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${journal?.plan ? `<div style="margin-top:12px"><div class="small muted" style="margin-bottom:4px">План дня</div><div class="note-box">${escapeHtml(journal.plan)}</div></div>` : ''}
    ${journal?.review ? `<div style="margin-top:8px"><div class="small muted" style="margin-bottom:4px">Разбор</div><div class="note-box">${escapeHtml(journal.review)}</div></div>` : ''}`;
  const m = openModal({
    title: fmtDateFull(day),
    sub: `${escapeHtml(store.account?.name || '')} · ${trades.length} ${plural(trades.length, 'сделка', 'сделки', 'сделок')}`,
    body,
    size: 'wide',
    footer: `<button type="button" class="btn" data-day-add>${icon('plus')} Сделка</button>
      <div class="right">
        <button type="button" class="btn" data-day-journal>${icon('journal')} Дневник дня</button>
        <button type="button" class="btn btn-primary" data-day-close>Закрыть</button>
      </div>`,
  });
  const closeOnChange = () => m.close();
  window.addEventListener('data:changed', closeOnChange, { once: true });
  m.overlay.querySelector('[data-day-close]').addEventListener('click', m.close);
  m.overlay.querySelector('[data-day-journal]').addEventListener('click', () => { m.close(); location.hash = `#/journal/${day}`; });
  m.overlay.querySelector('[data-day-add]').addEventListener('click', () => { m.close(); openTradeForm(null, { date: day }); });
}

function noTradesState(root) {
  root.innerHTML = `<div class="card" style="margin-top:4px">
    ${emptyState({
      iconName: 'analytics',
      title: 'Дневник пока пуст',
      text: 'Добавьте первую сделку — сервис посчитает P&L, R-мультипликатор, кривую капитала и соберёт статистику по сетапам и ошибкам.',
      action: `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-primary" data-new>${icon('plus')} Добавить сделку</button>
        <button class="btn" data-demo>${icon('upload')} Загрузить демо-данные</button>
      </div>`,
    })}
  </div>`;
  root.querySelector('[data-new]').addEventListener('click', () => openTradeForm());
  root.querySelector('[data-demo]').addEventListener('click', async () => {
    try {
      await api.demo();
      toast('Демо-данные загружены');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) { toast(err.message, 'error'); }
  });
}

export function render(root) {
  if (!store.account) {
    root.innerHTML = emptyState({
      iconName: 'wallet',
      title: 'Нет торгового счёта',
      text: 'Создайте счёт, чтобы вести журнал сделок и видеть статистику.',
      action: `<a class="btn btn-primary" href="#/settings">${icon('settings')} Перейти в настройки</a>`,
    });
    return;
  }
  const all = store.accountTrades;
  if (!all.length) { noTradesState(root); return; }

  const range = store.range();
  const trades = store.periodTrades(range);
  const s = stats(trades);
  const eq = equityCurve(all, store.accountCashflows, store.initial, range ? range[0] : null, range ? range[1] : null);
  const days = dailyPnl(all);
  const dayValues = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  let acc = 0;
  const sparkValues = dayValues.map((d) => (acc += d.net));
  const bySymbol = groupBy(trades, (t) => t.symbol).sort((a, b) => b.net - a.net);
  const maxBar = Math.max(1, ...bySymbol.map((x) => Math.abs(x.net)));
  const openTrades = all.filter((t) => !t.closed);
  const recent = [...all].sort((a, b) => (b.exit_time || b.entry_time || '').localeCompare(a.exit_time || a.entry_time || '')).slice(0, 8);
  const c = store.currency;

  const spark = sparkValues.length > 1 ? sparkline(sparkValues, { color: s.totalNet >= 0 ? 'var(--green)' : 'var(--red)' }) : '';
  const pf = s.profitFactor === Infinity ? '∞' : s.count ? ratio(s.profitFactor) : '—';

  const month = calState();
  const calendar = calendarHtml(days, month.year, month.month);

  const summaryRows = [
    ['Закрытых сделок', `${s.count} <span class="muted">из ${all.length}</span>`],
    ['Прибыльных / убыточных', `<span class="pos">${s.wins}</span> / <span class="neg">${s.losses}</span>`],
    ['Валовая прибыль', money(s.grossProfit, c)],
    ['Валовый убыток', `−${money(s.grossLoss, c)}`],
    ['Комиссии', s.fees ? `−${money(s.fees, c, { decimals: 2 })}` : money(0, c)],
    ['Средняя сделка', signedMoney(s.expectancy, c, { decimals: 0 })],
    ['Средний R', s.avgR === null ? '—' : rmult(s.avgR)],
    ['Лучшая / худшая', `<span class="pos">${signedMoney(s.best, c)}</span> <span class="muted">/</span> <span class="neg">${signedMoney(s.worst, c)}</span>`],
    ['Макс. серия', `${s.maxWinStreak}W / ${s.maxLossStreak}L`],
  ];

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi accent">
        <div class="kpi-label">${icon('target')} Чистая прибыль</div>
        <div class="kpi-value ${cls(s.totalNet)}">${signedMoney(s.totalNet, c, { decimals: 0 })}</div>
        <div class="kpi-sub">${PERIOD_LABELS[store.period] || ''} · ${s.count} ${plural(s.count, 'сделка', 'сделки', 'сделок')}</div>
        ${spark}
      </div>
      <div class="kpi">
        <div class="kpi-label">Profit factor</div>
        <div class="kpi-value">${pf}</div>
        <div class="kpi-sub">${money(s.grossProfit, c, { compact: true })} / ${money(s.grossLoss, c, { compact: true })}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Винрейт</div>
        <div class="kpi-value">${s.count ? pct(s.winRate) : '—'}</div>
        <div class="kpi-sub">${s.wins} из ${s.count} закрытых</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Средний R</div>
        <div class="kpi-value ${s.avgR === null ? '' : cls(s.avgR)}">${s.avgR === null ? '—' : rmult(s.avgR)}</div>
        <div class="kpi-sub">${s.totalR === null ? 'нет сделок со стопом' : `итого ${rmult(s.totalR, 1)}`}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Макс. просадка</div>
        <div class="kpi-value neg">${eq.maxDD ? `−${money(eq.maxDD, c)}` : money(0, c)}</div>
        <div class="kpi-sub">${eq.maxDD ? `${pct(eq.maxDDPct)} от пика` : 'без просадки'}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Сделок</div>
        <div class="kpi-value">${s.count}</div>
        <div class="kpi-sub">${numTrim(s.contracts)} контр. · ${openTrades.length} откр.</div>
      </div>
    </div>

    <div class="grid">
      <div class="card span-8">
        <div class="eq-head">
          <div>
            <div class="eq-label">Баланс счёта</div>
            <div class="eq-balance">
              <strong>${money(store.balance, c)}</strong>
              <span class="delta ${cls(s.totalNet)}">${signedMoney(s.totalNet, c)}</span>
              <span class="small muted">${PERIOD_LABELS[store.period] || ''}${eq.startBalance ? ` · ${signedPct(eq.startBalance ? (s.totalNet / eq.startBalance) * 100 : 0)}` : ''}</span>
            </div>
          </div>
          <div class="legend">
            <span><i class="g"></i> капитал</span>
            <span><i class="r"></i> просадка</span>
          </div>
        </div>
        <div class="chart-wrap" id="equityChart"></div>
        <div class="dd-line" id="ddChart"></div>
      </div>

      <div class="card span-4">
        <div class="card-head">
          <div><h3 class="card-title">Итоги периода</h3><p class="card-sub">${PERIOD_LABELS[store.period] || ''}</p></div>
        </div>
        <div class="card-body tight">
          <div class="sum-list">
            ${summaryRows.map(([k, v]) => `<div class="sum-row"><span class="sum-key">${k}</span><span class="sum-val">${v}</span></div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card span-7" id="calendarCard">
        ${calendar}
      </div>

      <div class="card span-5" style="display:flex;flex-direction:column">
        <div class="card-head">
          <div><h3 class="card-title">По инструментам</h3><p class="card-sub">${bySymbol.length} ${plural(bySymbol.length, 'тикер', 'тикера', 'тикеров')} за период</p></div>
          <div class="card-actions"><a class="btn-link" href="#/analytics">Аналитика ${icon('arrow-right')}</a></div>
        </div>
        <div class="card-body">
          ${bySymbol.length ? `<div class="bars">${bySymbol.slice(0, 7).map((x) => `
            <div class="bar-row">
              <div class="bar-label">${escapeHtml(x.key)}</div>
              <div class="bar-track" title="${escapeAttr(`${x.key}: ${signedMoney(x.net, c)}`)}"><div class="bar-fill ${x.net < 0 ? 'neg' : ''}" style="width:${Math.max(2, (Math.abs(x.net) / maxBar) * 100).toFixed(1)}%"></div></div>
              <div class="bar-val ${cls(x.net)}">${signedMoney(x.net, c, { compact: true })}</div>
            </div>
            <div class="bar-meta" style="margin:-7px 0 0 67px">${x.count} ${plural(x.count, 'сделка', 'сделки', 'сделок')} · ${pct(x.winRate)}</div>`).join('')}</div>`
            : '<div class="chart-empty">Нет закрытых сделок за период</div>'}
        </div>
        ${bySymbol.length ? `<div class="table-footer" style="margin-top:auto;border-top:1px solid var(--line)">
          <span>Итого по тикерам <b class="${cls(s.totalNet)}">${signedMoney(s.totalNet, c)}</b></span>
          <span class="muted">Лучший: ${escapeHtml(bySymbol[0].key)} <b class="pos">${signedMoney(bySymbol[0].net, c, { compact: true })}</b></span>
        </div>` : ''}
      </div>

      ${openTrades.length ? `<div class="card span-12">
        <div class="card-head">
          <div><h3 class="card-title">Открытые позиции <span class="badge badge-outline">${openTrades.length}</span></h3><p class="card-sub">Текущий риск и план по незакрытым сделкам</p></div>
        </div>
        <div class="card-body flush">
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>Тикер</th><th>Сторона</th><th class="num">Кол-во</th><th class="num">Вход</th><th class="num">Стоп</th><th class="num">Тейк</th><th>Открыта</th><th class="num">Риск</th><th>Сетап</th><th></th></tr></thead>
            <tbody>${openTrades.map((t) => `<tr class="clickable" data-trade-id="${t.id}">
              <td><span class="sym">${escapeHtml(t.symbol)}</span></td>
              <td>${sideBadge(t.side)}</td>
              <td class="num">${numTrim(t.qty)}</td>
              <td class="num">${price(t.entry_price, t.tick_size)}</td>
              <td class="num">${t.stop_price !== null ? price(t.stop_price, t.tick_size) : '—'}</td>
              <td class="num">${t.target_price !== null ? price(t.target_price, t.tick_size) : '—'}</td>
              <td class="muted">${t.entry_time ? fmtDuration((Date.now() - new Date(t.entry_time).getTime()) / 60000) : '—'}</td>
              <td class="num neg">${t.risk ? money(t.risk, c) : '—'}</td>
              <td class="muted">${escapeHtml(t.setup || '—')}</td>
              <td class="num">${icon('edit')}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>` : ''}

      <div class="card span-12">
        <div class="card-head">
          <div><h3 class="card-title">Последние сделки</h3><p class="card-sub">Нажмите на строку, чтобы открыть и отредактировать</p></div>
          <div class="card-actions"><a class="btn-link" href="#/trades">Все сделки ${icon('arrow-right')}</a></div>
        </div>
        <div class="card-body flush">
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>Дата</th><th>Тикер</th><th>Сторона</th><th class="num">Кол-во</th><th class="num">Вход → выход</th><th class="num">R</th><th class="num">P&amp;L</th><th>Сетап</th><th>Оценка</th></tr></thead>
            <tbody>${recent.map((t) => `<tr class="clickable" data-trade-id="${t.id}">
              <td class="date-cell"><span>${fmtDateShort(t.exit_time || t.entry_time)}</span><span class="sub">${fmtTime(t.exit_time || t.entry_time)}</span></td>
              <td><span class="sym">${escapeHtml(t.symbol)}</span></td>
              <td>${sideBadge(t.side)}</td>
              <td class="num">${numTrim(t.qty)}</td>
              <td class="num">${price(t.entry_price, t.tick_size)}${t.exit_price !== null ? ` → ${price(t.exit_price, t.tick_size)}` : ''}</td>
              <td class="num">${t.r !== null ? rmult(t.r) : '—'}</td>
              <td class="num ${t.closed ? cls(t.net) : 'muted'}">${t.closed ? signedMoney(t.net, c) : 'открыта'}</td>
              <td class="muted truncate" style="max-width:160px">${escapeHtml(t.setup || '—')}</td>
              <td>${starsMini(t.rating)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;

  equityChart(root.querySelector('#equityChart'), eq.points, { currency: c, height: 268 });
  drawdownChart(root.querySelector('#ddChart'), eq.points, { height: 54 });

  root.querySelectorAll('[data-trade-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const t = store.trades.find((x) => x.id === Number(row.dataset.tradeId));
      if (t) openTradeForm(t);
    });
  });

  root.querySelectorAll('[data-day]').forEach((cell) => {
    cell.addEventListener('click', () => dayModal(cell.dataset.day));
    cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dayModal(cell.dataset.day); } });
  });

  root.querySelector('[data-cal-prev]')?.addEventListener('click', () => {
    const st = calState();
    st.month--;
    if (st.month < 0) { st.month = 11; st.year--; }
    render(root);
  });
  root.querySelector('[data-cal-next]')?.addEventListener('click', () => {
    const st = calState();
    st.month++;
    if (st.month > 11) { st.month = 0; st.year++; }
    render(root);
  });
}
