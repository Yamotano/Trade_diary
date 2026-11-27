import { store } from '../store.js';
import { stats, groupBy, rHistogram, monthlyPnl, dailyPnl } from '../../analytics.js';
import {
  money, signedMoney, num, pct, rmult, ratio, cls, toDate, escapeHtml, plural, signedPct, fmtDuration,
} from '../format.js';
import { icon, emptyState } from '../components.js';
import { histogram, columnChart, donut } from '../charts.js';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function durationBuckets(closed) {
  const defs = [
    { label: '< 15 мин', test: (m) => m < 15 },
    { label: '15–60 мин', test: (m) => m >= 15 && m < 60 },
    { label: '1–3 часа', test: (m) => m >= 60 && m < 180 },
    { label: '3–6 часов', test: (m) => m >= 180 && m < 360 },
    { label: '> 6 часов', test: (m) => m >= 360 },
  ];
  return defs.map((d) => {
    const arr = closed.filter((t) => t.durMin !== null && d.test(t.durMin));
    const s = stats(arr);
    return { label: d.label, count: arr.length, net: s.totalNet, winRate: s.winRate, avgR: s.avgR };
  }).filter((x) => x.count);
}

export function render(root) {
  const range = store.range();
  const trades = store.periodTrades(range);
  const closed = trades.filter((t) => t.closed);
  const s = stats(closed);
  const c = store.currency;

  if (!closed.length) {
    root.innerHTML = `<div class="card">${emptyState({
      iconName: 'analytics',
      title: 'Недостаточно данных за период',
      text: 'Выберите период пошире в шапке страницы или добавьте закрытые сделки — здесь появятся распределения, сетапы, ошибки и месячная история.',
      action: '<a class="btn" href="#/trades">Перейти к сделкам</a>',
    })}</div>`;
    return;
  }

  const setups = groupBy(closed, (t) => t.setup).sort((a, b) => b.net - a.net);
  const symbols = groupBy(closed, (t) => t.symbol).sort((a, b) => b.net - a.net);
  const emotions = groupBy(closed, (t) => t.emotion).sort((a, b) => b.net - a.net);
  const mistakes = groupBy(closed, (t) => t.mistakes).sort((a, b) => a.net - b.net);
  const durs = durationBuckets(closed);

  const wd = WEEKDAYS.map((label) => ({ label, value: 0, count: 0 }));
  for (const t of closed) {
    const d = toDate(t.entry_time);
    if (!d) continue;
    const idx = (d.getDay() + 6) % 7;
    wd[idx].value += t.net;
    wd[idx].count++;
  }

  const hourMap = new Map();
  for (const t of closed) {
    const d = toDate(t.entry_time);
    if (!d) continue;
    const h = d.getHours();
    const rec = hourMap.get(h) || { label: `${String(h).padStart(2, '0')}:00`, value: 0, count: 0, hour: h };
    rec.value += t.net; rec.count++;
    hourMap.set(h, rec);
  }
  const hours = [...hourMap.values()].sort((a, b) => a.hour - b.hour);

  const longs = stats(closed.filter((t) => t.side === 'long'));
  const shorts = stats(closed.filter((t) => t.side === 'short'));
  const totalSide = longs.count + shorts.count || 1;
  const longShare = (longs.count / totalSide) * 100;

  const monthsMap = monthlyPnl(store.accountTrades);
  const months = [...monthsMap.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
  const maxMonth = Math.max(1, ...months.map((m) => Math.abs(m.net)));

  const winLossTotal = s.wins + s.losses + s.breakeven || 1;

  const tableCard = (title, sub, head, rows, emptyText) => `
    <div class="card span-7">
      <div class="card-head"><div><h3 class="card-title">${title}</h3><p class="card-sub">${sub}</p></div></div>
      <div class="card-body flush">
        ${rows.length ? `<div class="table-wrap"><table class="tbl mini-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="chart-empty">${emptyText}</div>`}
      </div>
    </div>`;

  root.innerHTML = `<div class="grid">
    <div class="card span-7">
      <div class="card-head">
        <div><h3 class="card-title">Распределение R</h3><p class="card-sub">Результат в единицах риска · ${closed.filter((t) => t.r !== null).length} сделок со стопом</p></div>
        <div class="card-actions"><span class="badge ${s.avgR >= 0 ? 'badge-long' : 'badge-short'}">средний ${s.avgR === null ? '—' : rmult(s.avgR)}</span></div>
      </div>
      <div class="card-body">
        <div id="rHist"></div>
        <div class="inline-stats" style="margin-top:10px">
          <div class="inline-stat"><div class="k">Total R</div><div class="v">${s.totalR === null ? '—' : rmult(s.totalR, 1)}</div></div>
          <div class="inline-stat"><div class="k">Средний R</div><div class="v ${s.avgR === null ? '' : cls(s.avgR)}">${s.avgR === null ? '—' : rmult(s.avgR)}</div></div>
          <div class="inline-stat"><div class="k">Матожидание</div><div class="v ${cls(s.expectancy)}">${signedMoney(s.expectancy, c)}</div></div>
          <div class="inline-stat"><div class="k">Сделок</div><div class="v">${s.count}</div></div>
        </div>
      </div>
    </div>

    <div class="card span-5">
      <div class="card-head"><div><h3 class="card-title">Винрейт и качество</h3><p class="card-sub">Соотношение прибыльных и убыточных</p></div></div>
      <div class="card-body">
        <div class="donut-wrap">
          <div id="winDonut"></div>
          <div class="donut-legend">
            <div class="row"><span class="sq" style="background:var(--green)"></span>Прибыльные <b class="pos">${s.wins}</b></div>
            <div class="row"><span class="sq" style="background:var(--red)"></span>Убыточные <b class="neg">${s.losses}</b></div>
            ${s.breakeven ? `<div class="row"><span class="sq" style="background:var(--line-strong)"></span>Без результата <b class="muted">${s.breakeven}</b></div>` : ''}
          </div>
        </div>
        <div class="sum-list" style="margin-top:12px">
          <div class="sum-row"><span class="sum-key">Средняя прибыль</span><span class="sum-val pos">${money(s.avgWin, c)}</span></div>
          <div class="sum-row"><span class="sum-key">Средний убыток</span><span class="sum-val neg">−${money(s.avgLoss, c)}</span></div>
          <div class="sum-row"><span class="sum-key">Payoff (ср. приб. / ср. убыток)</span><span class="sum-val">${s.avgLoss ? ratio(s.payoff) : '—'}</span></div>
          <div class="sum-row"><span class="sum-key">Profit factor</span><span class="sum-val">${s.profitFactor === Infinity ? '∞' : ratio(s.profitFactor)}</span></div>
          <div class="sum-row"><span class="sum-key">Макс. серии</span><span class="sum-val">${s.maxWinStreak}W / ${s.maxLossStreak}L</span></div>
        </div>
      </div>
    </div>

    <div class="card span-6">
      <div class="card-head"><div><h3 class="card-title">Результат по дням недели</h3><p class="card-sub">P&amp;L закрытых сделок · местное время</p></div></div>
      <div class="card-body"><div id="weekdayChart"></div></div>
    </div>

    <div class="card span-6">
      <div class="card-head"><div><h3 class="card-title">По часу входа</h3><p class="card-sub">Когда сделки приносят деньги</p></div></div>
      <div class="card-body"><div id="hourChart"></div></div>
    </div>

    ${tableCard('Сетапы', 'Прибыльность торговых сценариев', '<th>Сетап</th><th class="num">Сделок</th><th class="num">Винрейт</th><th class="num">Ср. R</th><th class="num">P&amp;L</th>',
      setups.map((x) => `<tr><td class="truncate" style="max-width:180px">${escapeHtml(x.key)}</td><td class="num">${x.count}</td><td class="num">${pct(x.winRate)}</td><td class="num ${x.avgR === null ? '' : cls(x.avgR)}">${x.avgR === null ? '—' : rmult(x.avgR)}</td><td class="num ${cls(x.net)}">${signedMoney(x.net, c)}</td></tr>`).join(''),
      'Добавьте сетап в сделках — здесь появится сравнение.')}

    <div class="card span-5">
      <div class="card-head"><div><h3 class="card-title">Лонг и шорт</h3><p class="card-sub">Где вы зарабатываете</p></div></div>
      <div class="card-body">
        <div class="hbar" style="margin:4px 0 12px">
          <i class="long" style="width:${longShare.toFixed(1)}%"></i><i class="short" style="width:${(100 - longShare).toFixed(1)}%"></i>
        </div>
        ${[['Лонг', longs, 'long'], ['Шорт', shorts, 'short']].map(([label, st, key]) => `
          <div style="padding:9px 0;border-bottom:1px dashed var(--line)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <span class="badge ${key === 'long' ? 'badge-long' : 'badge-short'}">${label}</span>
              <b class="${cls(st.totalNet)}">${signedMoney(st.totalNet, c)}</b>
            </div>
            <div class="small muted" style="display:flex;justify-content:space-between">
              <span>${st.count} ${plural(st.count, 'сделка', 'сделки', 'сделок')} · винрейт ${pct(st.winRate)}</span>
              <span>ср. R ${st.avgR === null ? '—' : rmult(st.avgR)}</span>
            </div>
          </div>`).join('')}
        <p class="small muted" style="margin:10px 0 0">Доля сделок: ${Math.round(longShare)}% лонг / ${Math.round(100 - longShare)}% шорт</p>
      </div>
    </div>

    ${tableCard('Инструменты', 'P&amp;L и качество по тикерам', '<th>Тикер</th><th class="num">Сделок</th><th class="num">Винрейт</th><th class="num">Ср. R</th><th class="num">P&amp;L</th>',
      symbols.map((x) => `<tr><td><span class="sym">${escapeHtml(x.key)}</span></td><td class="num">${x.count}</td><td class="num">${pct(x.winRate)}</td><td class="num ${x.avgR === null ? '' : cls(x.avgR)}">${x.avgR === null ? '—' : rmult(x.avgR)}</td><td class="num ${cls(x.net)}">${signedMoney(x.net, c)}</td></tr>`).join(''),
      'Нет данных по инструментам.')}

    <div class="card span-5">
      <div class="card-head"><div><h3 class="card-title">Эмоции</h3><p class="card-sub">Как состояние влияет на результат</p></div></div>
      <div class="card-body flush">
        ${emotions.length ? `<div class="table-wrap"><table class="tbl mini-table"><thead><tr><th>Состояние</th><th class="num">Сделок</th><th class="num">Винрейт</th><th class="num">P&amp;L</th></tr></thead><tbody>
          ${emotions.map((x) => `<tr><td>${escapeHtml(x.key)}</td><td class="num">${x.count}</td><td class="num">${pct(x.winRate)}</td><td class="num ${cls(x.net)}">${signedMoney(x.net, c)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="chart-empty">Отмечайте состояние в сделках.</div>'}
      </div>
    </div>

    <div class="card span-6">
      <div class="card-head"><div><h3 class="card-title">Ошибки</h3><p class="card-sub">Сколько стоит каждая ошибка</p></div></div>
      <div class="card-body flush">
        ${mistakes.length ? `<div class="table-wrap"><table class="tbl mini-table"><thead><tr><th>Ошибка</th><th class="num">Сделок</th><th class="num">Ср. P&amp;L</th><th class="num">Итого</th></tr></thead><tbody>
          ${mistakes.map((x) => `<tr><td class="truncate" style="max-width:170px">${escapeHtml(x.key)}</td><td class="num">${x.count}</td><td class="num ${cls(x.totalNet / x.count)}">${signedMoney(x.totalNet / x.count, c)}</td><td class="num ${cls(x.net)}">${signedMoney(x.net, c)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="chart-empty">Ошибки не отмечены — отличная дисциплина.</div>'}
      </div>
    </div>

    <div class="card span-6">
      <div class="card-head"><div><h3 class="card-title">Длительность сделок</h3><p class="card-sub">Скальпинг против удержания</p></div></div>
      <div class="card-body flush">
        <div class="table-wrap"><table class="tbl mini-table"><thead><tr><th>Время в позиции</th><th class="num">Сделок</th><th class="num">Винрейт</th><th class="num">P&amp;L</th></tr></thead><tbody>
          ${durs.map((x) => `<tr><td>${x.label}</td><td class="num">${x.count}</td><td class="num">${pct(x.winRate)}</td><td class="num ${cls(x.net)}">${signedMoney(x.net, c)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="small muted" style="padding:9px 12px">Средняя длительность: ${closed.some((t) => t.durMin !== null) ? fmtDuration(stats(closed).avgDurMin) : '—'}</div>
      </div>
    </div>

    <div class="card span-12">
      <div class="card-head"><div><h3 class="card-title">История по месяцам</h3><p class="card-sub">Все сделки счёта, последние 12 месяцев</p></div></div>
      <div class="card-body flush">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Месяц</th><th class="num">Сделок</th><th class="num">Винрейт</th><th class="num">P&amp;L</th><th style="width:150px">Результат</th></tr></thead>
          <tbody>${months.map((m) => {
            const [y, mo] = m.month.split('-');
            const label = `${MONTHS_SHORT[Number(mo) - 1]} ${y}`;
            return `<tr><td class="nowrap"><b>${label}</b></td><td class="num">${m.count}</td><td class="num">${pct(m.wins / m.count)}</td><td class="num ${cls(m.net)}">${signedMoney(m.net, c)}</td>
              <td><div class="hbar" style="height:6px"><i style="width:${Math.max(3, (Math.abs(m.net) / maxMonth) * 100).toFixed(1)}%;background:${m.net >= 0 ? 'var(--green)' : 'var(--red)'}"></i></div></td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;

  histogram(root.querySelector('#rHist'), rHistogram(closed), { currency: c });
  columnChart(root.querySelector('#weekdayChart'), wd, { currency: c, height: 190 });
  columnChart(root.querySelector('#hourChart'), hours, { currency: c, height: 190 });
  donut(root.querySelector('#winDonut'), [
    { value: s.wins, color: 'var(--green)' },
    { value: s.losses, color: 'var(--red)' },
    { value: s.breakeven, color: 'var(--line-strong)' },
  ], { centerTop: pct(s.winRate, 0), centerBottom: 'винрейт', size: 116 });
}
