import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemo } from '../public/js/cloud.js';

const instruments = [
  { symbol: 'Si', point_value: 1, tick_size: 1, fee: 3.81 },
  { symbol: 'RTS', point_value: 1.64253, tick_size: 10, fee: 9.58 },
  { symbol: 'MIX', point_value: 1, tick_size: 25, fee: 15.25 },
  { symbol: 'BR', point_value: 821.265, tick_size: 0.01, fee: 10.45 },
  { symbol: 'GOLD', point_value: 82.1265, tick_size: 0.1, fee: 38.99 },
  { symbol: 'SBRF', point_value: 1, tick_size: 1, fee: 5.7 },
];
const now = new Date('2026-11-27T12:00:00');

function pnl(t) {
  const dir = t.side === 'short' ? -1 : 1;
  return dir * (t.exit_price - t.entry_price) * t.qty * t.point_value - t.fees;
}

test('cloud demo MOEX: достаточно сделок и положительный результат', () => {
  const { trades, journal } = buildDemo(1, instruments, now);
  const closed = trades.filter((t) => t.exit_price !== null);
  assert.ok(closed.length > 120);
  assert.equal(trades.length - closed.length, 2);
  assert.ok(journal.length > 15);

  const net = closed.reduce((sum, t) => sum + pnl(t), 0);
  assert.ok(net > 10000, `net=${net}`);
  const wins = closed.filter((t) => pnl(t) > 0).length;
  assert.ok(wins / closed.length > 0.5);
  assert.ok(trades.every((t) => t.account_id === 1 && t.point_value > 0 && t.qty > 0));
  assert.ok(trades.every((t) => ['Si', 'RTS', 'MIX', 'BR', 'GOLD', 'SBRF'].includes(t.symbol)));
});

test('cloud demo MOEX: последние 90 дней тоже в плюсе', () => {
  const { trades } = buildDemo(1, instruments, now);
  const from = new Date(now.getTime() - 90 * 864e5).toISOString().slice(0, 10);
  const net90 = trades
    .filter((t) => t.exit_price !== null && String(t.exit_time).slice(0, 10) >= from)
    .reduce((sum, t) => sum + pnl(t), 0);
  assert.ok(net90 > 3000, `net90=${net90}`);
});
