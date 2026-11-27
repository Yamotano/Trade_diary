// Расчёты по фьючерсным сделкам. Чистые функции, используются и в браузере, и в тестах.

export const dirOf = (side) => (side === 'short' ? -1 : 1);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Добавляет вычисляемые поля к сделке. P&L = направление × (выход − вход) × контракты × стоимость пункта − комиссии + фандинг. */
export function enrich(t) {
  const entry = num(t.entry_price), exit = num(t.exit_price), qty = num(t.qty) || 0;
  const pv = num(t.point_value) || 1, tick = num(t.tick_size), stop = num(t.stop_price), target = num(t.target_price);
  const fees = num(t.fees) || 0, funding = num(t.funding) || 0;
  const dir = dirOf(t.side);
  const closed = exit !== null && !Number.isNaN(exit);
  const risk = stop !== null && entry !== null ? Math.abs(entry - stop) * qty * pv : null;
  let gross = null, net = null, r = null, ticks = null, points = null;
  if (closed) {
    points = dir * (exit - entry);
    gross = points * qty * pv;
    net = gross - fees + funding;
    r = risk > 0 ? net / risk : null;
    ticks = tick ? points / tick : null;
  }
  const rr = risk > 0 && target !== null ? (Math.abs(target - entry) * qty * pv) / risk : null; // плановый R:R
  const when = (closed ? t.exit_time : null) || t.entry_time || '';
  const day = when.slice(0, 10);
  let durMin = null;
  if (closed && t.exit_time && t.entry_time) {
    const d = (new Date(t.exit_time) - new Date(t.entry_time)) / 60000;
    durMin = Number.isFinite(d) && d >= 0 ? d : null;
  }
  return { ...t, closed, gross, net, risk, r, rr, ticks, points, day, durMin, dir };
}

export const sortByClose = (a, b) => (a.exit_time || a.entry_time || '').localeCompare(b.exit_time || b.entry_time || '') || a.id - b.id;

/** Базовая статистика по закрытым сделкам (принимает enriched). */
export function stats(trades) {
  const closed = trades.filter((t) => t.closed).sort(sortByClose);
  const n = closed.length;
  const wins = closed.filter((t) => t.net > 0), losses = closed.filter((t) => t.net < 0);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const grossProfit = sum(wins, (t) => t.net), grossLoss = -sum(losses, (t) => t.net);
  const totalNet = sum(closed, (t) => t.net);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const withR = closed.filter((t) => t.r !== null);
  // стрики
  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (const t of closed) {
    if (t.net > 0) { curW++; curL = 0; } else if (t.net < 0) { curL++; curW = 0; } else { curW = 0; curL = 0; }
    maxW = Math.max(maxW, curW); maxL = Math.max(maxL, curL);
  }
  const durs = closed.filter((t) => t.durMin !== null);
  return {
    count: n, openCount: trades.length - n,
    curWinStreak: curW, curLossStreak: curL,
    wins: wins.length, losses: losses.length, breakeven: n - wins.length - losses.length,
    winRate: n ? wins.length / n : 0,
    totalNet, net: totalNet, totalGross: sum(closed, (t) => t.gross), fees: sum(closed, (t) => num(t.fees) || 0), funding: sum(closed, (t) => num(t.funding) || 0),
    grossProfit, grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin, avgLoss, payoff: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    expectancy: n ? totalNet / n : 0,
    avgR: withR.length ? sum(withR, (t) => t.r) / withR.length : null,
    totalR: withR.length ? sum(withR, (t) => t.r) : null,
    best: n ? Math.max(...closed.map((t) => t.net)) : 0,
    worst: n ? Math.min(...closed.map((t) => t.net)) : 0,
    maxWinStreak: maxW, maxLossStreak: maxL,
    avgDurMin: durs.length ? sum(durs, (t) => t.durMin) / durs.length : null,
    contracts: sum(closed, (t) => num(t.qty) || 0),
    ticks: sum(closed.filter((t) => t.ticks !== null), (t) => t.ticks),
  };
}

/**
 * Кривая капитала. Баланс = начальный + внесения/выводы + накопленный P&L.
 * Просадка считается по капиталу сделок (без учёта пополнений/выводов).
 */
export function equitySeries(trades, cashflows, initial = 0, fromDay = null) {
  const events = [];
  for (const t of trades) if (t.closed) events.push({ time: t.exit_time || t.entry_time, kind: 't', pnl: t.net, trade: t });
  for (const c of cashflows) events.push({ time: `${c.date.slice(0, 10)}T00:00`, kind: 'c', amount: Number(c.amount) });
  events.sort((a, b) => a.time.localeCompare(b.time) || (a.kind === 'c' ? -1 : 1));
  let cash = 0, pnl = 0, peak = initial, maxDD = 0, maxDDPct = 0;
  const points = [{ time: fromDay ? `${fromDay}T00:00` : (events[0]?.time ?? ''), balance: initial, pnl: 0, dd: 0, ddPct: 0, start: true }];
  for (const e of events) {
    if (e.kind === 'c') cash += e.amount; else pnl += e.pnl;
    const eq = initial + pnl;
    if (eq > peak) peak = eq;
    const dd = peak - eq, ddPct = peak > 0 ? dd / peak : 0;
    maxDD = Math.max(maxDD, dd); maxDDPct = Math.max(maxDDPct, ddPct);
    points.push({ time: e.time, balance: initial + cash + pnl, pnl, dd, ddPct, kind: e.kind, amount: e.amount });
  }
  return { points, maxDD, maxDDPct, balance: initial + cash + pnl, cash, pnl };
}

/** Группировка: возвращает [{key, count, net, winRate, ...}] */
export function groupBy(trades, keyFn) {
  const m = new Map();
  for (const t of trades) {
    if (!t.closed) continue;
    const keys = [].concat(keyFn(t));
    for (const k of keys) { if (k === null || k === undefined || k === '') continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  }
  return [...m.entries()].map(([key, arr]) => ({ key, ...stats(arr) }));
}

export function dailyPnl(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!t.closed) continue;
    const d = m.get(t.day) || { day: t.day, net: 0, count: 0, wins: 0 };
    d.net += t.net; d.count++; if (t.net > 0) d.wins++;
    m.set(t.day, d);
  }
  return m;
}

export function monthlyPnl(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!t.closed) continue;
    const k = t.day.slice(0, 7);
    const d = m.get(k) || { month: k, net: 0, count: 0, wins: 0 };
    d.net += t.net; d.count++; if (t.net > 0) d.wins++;
    m.set(k, d);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Гистограмма R-мультипликаторов с шагом 0.5R. Границы по умолчанию подстраиваются под данные. */
export function rHistogram(trades, step = 0.5, lo = null, hi = null) {
  const rs = trades.filter((t) => t.closed && t.r !== null).map((t) => t.r);
  if (!rs.length) return [];
  if (lo === null) lo = Math.max(-8, Math.floor(Math.min(...rs)));
  if (hi === null) hi = Math.max(lo + step * 4, Math.ceil(Math.max(...rs)));
  const bins = [];
  for (let x = lo; x < hi - 1e-9; x += step) bins.push({ from: x, to: x + step, count: 0 });
  for (const t of trades) {
    if (!t.closed || t.r === null || t.r < lo || t.r > hi) continue;
    let i = Math.floor((t.r - lo) / step);
    i = Math.max(0, Math.min(bins.length - 1, i));
    bins[i].count++;
  }
  return bins;
}

/** Калькулятор размера позиции: контрактов = риск / (дистанция стопа × стоимость пункта). */
export function positionSize({ balance, riskPct, entry, stop, pointValue, margin = null }) {
  const riskMoney = (balance * riskPct) / 100;
  const dist = Math.abs(entry - stop);
  if (!(dist > 0) || !(pointValue > 0)) return { riskMoney, contracts: 0, riskPerContract: 0, actualRisk: 0, marginNeeded: null };
  const riskPerContract = dist * pointValue;
  const contracts = Math.floor(riskMoney / riskPerContract);
  return { riskMoney, contracts, riskPerContract, actualRisk: contracts * riskPerContract, marginNeeded: margin ? contracts * margin : null };
}

/** Фильтр периода → [from, to] в формате YYYY-MM-DD (включительно) либо null для «всё время». */
export function periodRange(period, today = new Date(), custom = {}) {
  const p2 = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const back = (days) => { const d = new Date(today); d.setDate(d.getDate() - days + 1); return d; };
  switch (period) {
    case 'today': return [fmt(today), fmt(today)];
    case '7d': return [fmt(back(7)), fmt(today)];
    case '30d': return [fmt(back(30)), fmt(today)];
    case '90d': return [fmt(back(90)), fmt(today)];
    case 'month': return [fmt(new Date(today.getFullYear(), today.getMonth(), 1)), fmt(today)];
    case 'ytd': return [`${today.getFullYear()}-01-01`, fmt(today)];
    case 'custom': return [custom.from || null, custom.to || null];
    default: return null;
  }
}

/**
 * Кривая капитала с учётом пополнений/выводов.
 * Возвращает точки за запрошенный период (fromDay/toDay — YYYY-MM-DD).
 * balance — абсолютный баланс счёта, pnl — накопленный P&L внутри периода.
 */
export function equityCurve(trades, cashflows = [], initial = 0, fromDay = null, toDay = null) {
  const events = [];
  for (const t of trades) {
    if (!t.closed) continue;
    events.push({ time: t.exit_time || t.entry_time, kind: 'trade', pnl: t.net, trade: t });
  }
  for (const c of cashflows || []) {
    const date = String(c.date).slice(0, 10);
    events.push({ time: `${date}T00:00`, kind: 'cash', pnl: 0, amount: Number(c.amount) || 0 });
  }
  events.sort((a, b) => a.time.localeCompare(b.time) || (a.kind === 'cash' ? -1 : 1));

  let balance = initial, pnl = 0;
  const all = [{ time: null, balance, pnl, kind: 'start' }];
  for (const e of events) {
    if (e.kind === 'cash') balance += e.amount; else { balance += e.pnl; pnl += e.pnl; }
    all.push({ time: e.time, balance, pnl, kind: e.kind, amount: e.amount, trade: e.trade });
  }

  let startIdx = 0;
  if (fromDay) {
    while (startIdx + 1 < all.length && String(all[startIdx + 1].time || '').slice(0, 10) < fromDay) startIdx++;
  }
  const base = all[startIdx];
  const startDate = fromDay || String(all[startIdx + 1]?.time || base.time || '').slice(0, 10);
  const points = [{
    time: startDate ? `${startDate}T00:00` : '',
    balance: base.balance, pnl: 0, dd: 0, ddPct: 0, kind: 'base',
  }];
  let peak = base.balance, maxDD = 0, maxDDPct = 0;
  for (let i = startIdx + 1; i < all.length; i++) {
    const p = all[i];
    if (toDay && String(p.time || '').slice(0, 10) > toDay) break;
    if (p.balance > peak) peak = p.balance;
    const dd = Math.max(0, peak - p.balance);
    const ddPct = peak > 0 ? dd / peak : 0;
    maxDD = Math.max(maxDD, dd); maxDDPct = Math.max(maxDDPct, ddPct);
    points.push({
      time: p.time, balance: p.balance, pnl: p.pnl - base.pnl, dd, ddPct,
      kind: p.kind, amount: p.amount, trade: p.trade,
    });
  }
  const last = points[points.length - 1];
  return {
    points, startBalance: base.balance, endBalance: last.balance,
    net: last.pnl, maxDD, maxDDPct,
  };
}
