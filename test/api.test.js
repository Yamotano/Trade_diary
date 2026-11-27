import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 3200 + Math.floor(Math.random() * 600);
const dbDir = path.join(os.tmpdir(), `fd-api-test-${Date.now()}`);
const dbFile = path.join(dbDir, 'journal.db');
let server;

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('Сервер не запустился');
}

async function api(method, url, body) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* html */ }
  return { status: res.status, data, text };
}

before(async () => {
  fs.mkdirSync(dbDir, { recursive: true });
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: dbFile, SEED_DEMO: '0' },
    stdio: 'ignore',
  });
  await waitForServer();
});

after(async () => {
  if (server) server.kill();
  await new Promise((r) => setTimeout(r, 200));
  try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('health и пустая база: инструменты засеяны, счетов нет', async () => {
  const health = await api('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  const data = await api('GET', '/api/data');
  assert.equal(data.status, 200);
  assert.equal(data.data.accounts.length, 0);
  assert.equal(data.data.trades.length, 0);
  assert.ok(data.data.instruments.length >= 15);
  assert.ok(data.data.instruments.every((i) => i.exchange === 'MOEX'));
});

test('создание счёта, сделки и расчёт полей на клиенте согласованы', async () => {
  const acc = await api('POST', '/api/accounts', { name: 'Test', broker: 'Broker', currency: 'USD', initial_balance: 10000 });
  assert.equal(acc.status, 201);
  assert.ok(acc.data.id > 0);

  const trade = await api('POST', '/api/trades', {
    account_id: acc.data.id, symbol: 'mes', side: 'long', qty: 2, entry_price: 6780.25, exit_price: 6790.5,
    entry_time: '2026-11-27T16:30', fees: 3.2, point_value: 5, tick_size: 0.25, stop_price: 6775, target_price: 6800,
  });
  assert.equal(trade.status, 201);

  const data = await api('GET', '/api/data');
  const saved = data.data.trades[0];
  assert.equal(saved.symbol, 'MES');
  assert.equal(saved.exit_time, '2026-11-27T16:30');
  assert.equal(saved.account_id, acc.data.id);
  assert.equal(data.data.accounts[0].name, 'Test');
});

test('валидация сделок', async () => {
  const acc = (await api('GET', '/api/data')).data.accounts[0];
  const badQty = await api('POST', '/api/trades', {
    account_id: acc.id, symbol: 'MES', side: 'long', qty: 0, entry_price: 100, entry_time: '2026-11-27T10:00', point_value: 5,
  });
  assert.equal(badQty.status, 400);
  assert.match(badQty.data.error, /Количество/);

  const badSide = await api('POST', '/api/trades', {
    account_id: acc.id, symbol: 'MES', side: 'buy', qty: 1, entry_price: 100, entry_time: '2026-11-27T10:00', point_value: 5,
  });
  assert.equal(badSide.status, 400);

  const badTime = await api('POST', '/api/trades', {
    account_id: acc.id, symbol: 'MES', side: 'long', qty: 1, entry_price: 100, entry_time: '27.11.2026', point_value: 5,
  });
  assert.equal(badTime.status, 400);

  const badExit = await api('POST', '/api/trades', {
    account_id: acc.id, symbol: 'MES', side: 'long', qty: 1, entry_price: 100, exit_price: 90,
    entry_time: '2026-11-27T10:00', exit_time: '2026-11-27T09:00', point_value: 5,
  });
  assert.equal(badExit.status, 400);

  const badAccount = await api('POST', '/api/trades', {
    account_id: 99999, symbol: 'MES', side: 'long', qty: 1, entry_price: 100, entry_time: '2026-11-27T10:00', point_value: 5,
  });
  assert.equal(badAccount.status, 400);
});

test('частичное обновление: закрытие сделки без времени выхода', async () => {
  const data = (await api('GET', '/api/data')).data;
  const open = await api('POST', '/api/trades', {
    account_id: data.accounts[0].id, symbol: 'MNQ', side: 'short', qty: 1, entry_price: 25100,
    entry_time: '2026-11-27T17:00', point_value: 2, tick_size: 0.25, stop_price: 25150,
  });
  assert.equal(open.status, 201);
  const upd = await api('PUT', `/api/trades/${open.data.id}`, { exit_price: 25050, fees: 1.6 });
  assert.equal(upd.status, 200);
  const saved = (await api('GET', '/api/data')).data.trades.find((t) => t.id === open.data.id);
  assert.equal(saved.exit_price, 25050);
  assert.equal(saved.exit_time, '2026-11-27T17:00');

  const del = await api('DELETE', `/api/trades/${open.data.id}`);
  assert.equal(del.status, 200);
  const missing = await api('DELETE', `/api/trades/${open.data.id}`);
  assert.equal(missing.status, 404);
});

test('дневник: upsert по дате', async () => {
  const first = await api('PUT', '/api/journal', { date: '2026-11-27', mood: 4, plan: 'План', review: '', notes: '' });
  assert.equal(first.status, 200);
  const second = await api('PUT', '/api/journal', { date: '2026-11-27', mood: 5, plan: 'Новый план', review: 'Разбор', notes: '' });
  assert.equal(second.status, 200);
  const list = (await api('GET', '/api/data')).data.journal;
  assert.equal(list.length, 1);
  assert.equal(list[0].mood, 5);
  assert.equal(list[0].plan, 'Новый план');

  const bad = await api('PUT', '/api/journal', { date: '27.11.2026' });
  assert.equal(bad.status, 400);
});

test('bulk-импорт и восстановление из копии', async () => {
  const data = (await api('GET', '/api/data')).data;
  const acc = data.accounts[0];
  const bulk = await api('POST', '/api/trades/bulk', {
    trades: [
      { account_id: acc.id, symbol: 'MES', side: 'long', qty: 1, entry_price: 100, exit_price: 105, entry_time: '2026-11-20T10:00', point_value: 5, fees: 1 },
      { account_id: acc.id, symbol: 'MGC', side: 'short', qty: 2, entry_price: 2600, exit_price: 2590, entry_time: '2026-11-21T10:00', point_value: 10, fees: 1.8 },
    ],
  });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.data.imported, 2);

  const snapshot = (await api('GET', '/api/data')).data;
  assert.ok(snapshot.trades.length >= 3);

  const restore = await api('POST', '/api/restore', snapshot);
  assert.equal(restore.status, 200);
  const after = (await api('GET', '/api/data')).data;
  assert.equal(after.accounts.length, snapshot.accounts.length);
  assert.equal(after.trades.length, snapshot.trades.length);
  assert.equal(after.journal.length, snapshot.journal.length);

  const broken = await api('POST', '/api/restore', { accounts: [], instruments: [] });
  assert.equal(broken.status, 400);
});

test('очистка журнала сохраняет счёт и инструменты', async () => {
  const clear = await api('DELETE', '/api/data');
  assert.equal(clear.status, 200);
  const data = (await api('GET', '/api/data')).data;
  assert.equal(data.trades.length, 0);
  assert.equal(data.journal.length, 0);
  assert.equal(data.accounts.length, 1);
  assert.ok(data.instruments.length >= 15);
});

test('демо-данные создают счёт и сделки', async () => {
  const demo = await api('POST', '/api/demo');
  assert.equal(demo.status, 200);
  assert.ok(demo.data.trades > 100);
  const data = (await api('GET', '/api/data')).data;
  assert.equal(data.accounts.length, 1);
  assert.ok(data.trades.length > 100);
  assert.ok(data.trades.some((t) => t.exit_price === null));
});

test('статика и защита от обхода каталога', async () => {
  const html = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(html.status, 200);
  const text = await html.text();
  assert.match(text, /Фьючерс Дневник/);

  const js = await fetch(`http://127.0.0.1:${port}/js/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);

  const missing = await fetch(`http://127.0.0.1:${port}/js/nope.js`);
  assert.equal(missing.status, 404);

  const spa = await fetch(`http://127.0.0.1:${port}/trades`);
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /<div class="app">/);

  const traversal = await fetch(`http://127.0.0.1:${port}/..%2f..%2fserver.js`);
  assert.ok([403, 404].includes(traversal.status));
});

test('неизвестный ресурс API → 404', async () => {
  const res = await api('GET', '/api/nothing');
  assert.equal(res.status, 404);
});
