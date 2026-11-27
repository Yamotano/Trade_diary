import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrich, stats, groupBy, dailyPnl, monthlyPnl, rHistogram, equityCurve,
  periodRange, positionSize, sortByClose,
} from '../public/analytics.js';
import { parseTradesCsv, tradesToCsv, parseCsv } from '../public/js/csv.js';

const base = {
  id: 1, account_id: 1, symbol: 'MES', side: 'long', qty: 1,
  entry_price: 100, exit_price: 110, entry_time: '2026-01-05T10:00', exit_time: '2026-01-05T11:00',
  fees: 2, funding: 0, point_value: 5, tick_size: 0.25, stop_price: 98, target_price: 104,
  setup: 'Пробой', tags: '', mistakes: '', emotion: '', rating: 5, notes: '',
};

test('enrich: long P&L, R, ticks, duration', () => {
  const t = enrich({ ...base });
  assert.equal(t.closed, true);
  assert.equal(t.gross, 50);
  assert.equal(t.net, 48);
  assert.equal(t.risk, 10);
  assert.equal(t.r, 4.8);
  assert.equal(t.ticks, 40);
  assert.equal(t.points, 10);
  assert.equal(t.durMin, 60);
  assert.equal(t.day, '2026-01-05');
  assert.equal(t.rr, 2);
});

test('enrich: short trade and funding', () => {
  const t = enrich({ ...base, side: 'short', entry_price: 110, exit_price: 100, qty: 2, fees: 3, funding: 1.5, stop_price: 112 });
  assert.equal(t.gross, 100);
  assert.equal(t.net, 98.5);
  assert.equal(t.risk, 20);
  assert.equal(t.r, 4.925);
});

test('enrich: open trade has no result', () => {
  const t = enrich({ ...base, exit_price: null, exit_time: null });
  assert.equal(t.closed, false);
  assert.equal(t.net, null);
  assert.equal(t.r, null);
  assert.equal(t.ticks, null);
  assert.equal(t.day, '2026-01-05');
});

test('stats: winrate, profit factor, expectancy, streaks', () => {
  const trades = [
    enrich({ ...base, id: 1, net: undefined, exit_price: 110, fees: 2 }), // +48
    enrich({ ...base, id: 2, entry_time: '2026-01-06T10:00', exit_time: '2026-01-06T11:00', exit_price: 96, fees: 2, stop_price: 98 }), // -22
    enrich({ ...base, id: 3, entry_time: '2026-01-07T10:00', exit_time: '2026-01-07T11:00', exit_price: 120, fees: 2, stop_price: 98 }), // +98
    enrich({ ...base, id: 4, entry_time: '2026-01-08T10:00', exit_time: '2026-01-08T11:00', exit_price: 121, fees: 2, stop_price: 98 }), // +103
    enrich({ ...base, id: 5, exit_price: null, exit_time: null }), // open
  ];
  const s = stats(trades);
  assert.equal(s.count, 4);
  assert.equal(s.openCount, 1);
  assert.equal(s.wins, 3);
  assert.equal(s.losses, 1);
  assert.equal(s.winRate, 0.75);
  assert.equal(s.totalNet, 48 - 22 + 98 + 103);
  assert.equal(s.net, s.totalNet);
  assert.equal(s.grossProfit, 249);
  assert.equal(s.grossLoss, 22);
  assert.equal(s.profitFactor, 249 / 22);
  assert.equal(s.expectancy, s.totalNet / 4);
  assert.equal(s.maxWinStreak, 2);
  assert.equal(s.maxLossStreak, 1);
  assert.equal(s.curWinStreak, 2);
  assert.equal(s.count, 4);
  assert.ok(Math.abs(s.avgR - ((4.8 - 2.2 + 9.8 + 10.3) / 4)) < 1e-9);
});

test('stats: no trades', () => {
  const s = stats([]);
  assert.equal(s.count, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.profitFactor, 0);
  assert.equal(s.avgR, null);
  assert.equal(s.best, 0);
});

test('groupBy aggregates and skips empty keys', () => {
  const trades = [
    enrich({ ...base, id: 1, symbol: 'MES' }),
    enrich({ ...base, id: 2, symbol: 'MES', exit_price: 90 }),
    enrich({ ...base, id: 3, symbol: 'NQ', point_value: 20 }),
    enrich({ ...base, id: 4, symbol: 'NQ', setup: '', exit_price: null, exit_time: null }),
  ];
  const bySymbol = groupBy(trades, (t) => t.symbol);
  const mes = bySymbol.find((x) => x.key === 'MES');
  assert.equal(mes.count, 2);
  assert.equal(mes.net, 48 - 52);
  const bySetup = groupBy(trades, (t) => t.setup);
  assert.equal(bySetup.length, 1);
  assert.equal(bySetup[0].key, 'Пробой');
});

test('dailyPnl and monthlyPnl', () => {
  const trades = [
    enrich({ ...base, id: 1 }),
    enrich({ ...base, id: 2, exit_time: '2026-01-05T15:00' }),
    enrich({ ...base, id: 3, exit_time: '2026-02-10T12:00', exit_price: 95 }),
    enrich({ ...base, id: 4, exit_price: null, exit_time: null }),
  ];
  const days = dailyPnl(trades);
  assert.equal(days.get('2026-01-05').count, 2);
  assert.equal(days.get('2026-01-05').wins, 2);
  assert.equal(days.size, 2);
  const months = monthlyPnl(trades);
  assert.equal(months.length, 2);
  assert.equal(months[0].month, '2026-01');
  assert.equal(months[0].count, 2);
});

test('rHistogram adapts range and counts all trades', () => {
  const mk = (r, id) => ({ ...enrich({ ...base, id }), r });
  const trades = [mk(-1.2, 1), mk(0.3, 2), mk(1.6, 3), mk(2.4, 4)];
  const bins = rHistogram(trades);
  assert.ok(bins.length >= 8);
  assert.equal(bins.reduce((s, b) => s + b.count, 0), 4);
  assert.equal(bins[0].from, -2);
  assert.equal(bins[bins.length - 1].to, 3);
  assert.deepEqual(rHistogram([]), []);
});

test('equityCurve: deposits, P&L and drawdown', () => {
  const trades = [
    enrich({ ...base, id: 1, entry_time: '2026-01-06T10:00', exit_time: '2026-01-06T11:00', exit_price: 110 }),
    enrich({ ...base, id: 2, entry_time: '2026-01-07T10:00', exit_time: '2026-01-07T11:00', exit_price: 80 }),
  ];
  const cash = [{ id: 1, account_id: 1, date: '2026-01-05', amount: 500, note: 'Пополнение' }];
  const eq = equityCurve(trades, cash, 1000);
  assert.equal(eq.startBalance, 1000);
  assert.equal(eq.points[0].time.slice(0, 10), '2026-01-05');
  assert.equal(eq.endBalance, 1000 + 500 + 48 - 102);
  assert.equal(eq.net, 48 - 102);
  assert.equal(eq.maxDD, 102);
  assert.ok(eq.maxDDPct > 0.06 && eq.maxDDPct < 0.07);
  const sliced = equityCurve(trades, cash, 1000, '2026-01-06');
  assert.equal(sliced.startBalance, 1500);
  assert.equal(sliced.net, 48 - 102);
  const afterAll = equityCurve(trades, cash, 1000, '2026-02-01');
  assert.equal(afterAll.net, 0);
  assert.equal(afterAll.points.length, 1);
});

test('periodRange', () => {
  const today = new Date(2026, 10, 27);
  assert.deepEqual(periodRange('7d', today), ['2026-11-21', '2026-11-27']);
  assert.deepEqual(periodRange('30d', today), ['2026-10-29', '2026-11-27']);
  assert.deepEqual(periodRange('90d', today), ['2026-08-30', '2026-11-27']);
  assert.deepEqual(periodRange('ytd', today), ['2026-01-01', '2026-11-27']);
  assert.deepEqual(periodRange('month', today), ['2026-11-01', '2026-11-27']);
  assert.equal(periodRange('all', today), null);
});

test('positionSize', () => {
  const r = positionSize({ balance: 10000, riskPct: 1, entry: 100, stop: 98, pointValue: 5 });
  assert.equal(r.riskMoney, 100);
  assert.equal(r.riskPerContract, 10);
  assert.equal(r.contracts, 10);
  assert.equal(r.actualRisk, 100);
  assert.equal(positionSize({ balance: 10000, riskPct: 1, entry: 100, stop: 110, pointValue: 5 }).contracts, 2);
  assert.equal(positionSize({ balance: 1000, riskPct: 1, entry: 100, stop: 100, pointValue: 5 }).contracts, 0);
});

test('sortByClose orders by exit time', () => {
  const a = enrich({ ...base, id: 1, exit_time: '2026-01-06T10:00' });
  const b = enrich({ ...base, id: 2, exit_time: '2026-01-05T10:00' });
  assert.deepEqual([a, b].sort(sortByClose).map((t) => t.id), [2, 1]);
});

test('CSV: russian headers, comma decimals, side aliases', () => {
  const csv = 'дата;тикер;направление;количество;вход;выход;стоп;комиссия;сетап\r\n'
    + '27.11.2026 16:30;MES;лонг;2;6 780,25;6 790,5;6 775;1,6;Пробой\r\n'
    + '2026-11-28 17:00;MNQ;шорт;1;25100;25000;;0,8;Откат';
  const instruments = [
    { symbol: 'MES', point_value: 5, tick_size: 0.25, fee: 0.8 },
    { symbol: 'MNQ', point_value: 2, tick_size: 0.25, fee: 0.8 },
  ];
  const { rows, errors } = parseTradesCsv(csv, instruments);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].entry_time, '2026-11-27T16:30');
  assert.equal(rows[0].entry_price, 6780.25);
  assert.equal(rows[0].exit_price, 6790.5);
  assert.equal(rows[0].side, 'long');
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[0].point_value, 5);
  assert.equal(rows[0].exit_time, '2026-11-27T17:30');
  assert.equal(rows[0].setup, 'Пробой');
  assert.equal(rows[1].side, 'short');
  assert.equal(rows[1].tick_size, 0.25);
});

test('CSV: unknown ticker produces error, export round-trips', () => {
  const bad = parseTradesCsv('date,symbol,entry\n2026-11-27,XXXX,100', []);
  assert.equal(bad.rows.length, 0);
  assert.match(bad.errors[0], /не найден/);

  const instruments = [{ symbol: 'MES', point_value: 5, tick_size: 0.25, fee: 0.8 }];
  const rows = parseTradesCsv('date;symbol;entry;exit;side;qty\n2026-11-27 16:30;MES;6780,25;6790,5;long;2', instruments).rows;
  const csv = tradesToCsv(rows);
  assert.ok(csv.startsWith('\uFEFFdate;'));
  const back = parseTradesCsv(csv, instruments);
  assert.equal(back.rows.length, 1);
  assert.equal(back.rows[0].entry_price, 6780.25);
  assert.equal(back.rows[0].exit_price, 6790.5);
  assert.equal(back.rows[0].entry_time, '2026-11-27T16:30');
});

test('parseCsv handles quoted separators', () => {
  const rows = parseCsv('a;b\n"x;y";"line ""q"""');
  assert.deepEqual(rows, [['a', 'b'], ['x;y', 'line "q"']]);
});
