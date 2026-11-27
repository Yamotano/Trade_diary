// Дневник трейдера фьючерсами MOEX. Без внешних зависимостей: Node 24+ (node:sqlite).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildDemo, DEFAULT_INSTRUMENTS } from './public/js/cloud.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'journal.db');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS accounts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  broker TEXT DEFAULT '',
  currency TEXT DEFAULT 'RUB',
  initial_balance REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cashflows(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS instruments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT '',
  exchange TEXT DEFAULT '',
  type TEXT DEFAULT 'future',
  point_value REAL NOT NULL DEFAULT 1,
  tick_size REAL DEFAULT 0.01,
  margin REAL,
  fee REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trades(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'long',
  qty REAL NOT NULL DEFAULT 1,
  entry_price REAL NOT NULL,
  exit_price REAL,
  entry_time TEXT NOT NULL,
  exit_time TEXT,
  fees REAL DEFAULT 0,
  funding REAL DEFAULT 0,
  point_value REAL NOT NULL DEFAULT 1,
  tick_size REAL,
  stop_price REAL,
  target_price REAL,
  setup TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  mistakes TEXT DEFAULT '',
  emotion TEXT DEFAULT '',
  rating INTEGER,
  notes TEXT DEFAULT '',
  screenshot TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_trades_acc ON trades(account_id, exit_time);
CREATE TABLE IF NOT EXISTS journal(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  mood INTEGER,
  plan TEXT DEFAULT '',
  review TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);
`);

// ---- описание таблиц: s - строка, n - число (nullable), i - целое
const TABLES = {
  accounts: { cols: { name: 's', broker: 's', currency: 's', initial_balance: 'n' }, required: ['name'] },
  cashflows: { cols: { account_id: 'i', date: 's', amount: 'n', note: 's' }, required: ['account_id', 'date', 'amount'] },
  instruments: {
    cols: { symbol: 's', name: 's', exchange: 's', type: 's', point_value: 'n', tick_size: 'n', margin: 'n', fee: 'n' },
    required: ['symbol', 'point_value'],
  },
  trades: {
    cols: {
      account_id: 'i', symbol: 's', side: 's', qty: 'n', entry_price: 'n', exit_price: 'n', entry_time: 's', exit_time: 's',
      fees: 'n', funding: 'n', point_value: 'n', tick_size: 'n', stop_price: 'n', target_price: 'n', setup: 's', tags: 's',
      mistakes: 's', emotion: 's', rating: 'i', notes: 's', screenshot: 's',
    },
    required: ['account_id', 'symbol', 'side', 'qty', 'entry_price', 'entry_time', 'point_value'],
  },
  journal: { cols: { date: 's', mood: 'i', plan: 's', review: 's', notes: 's' }, required: ['date'] },
};

function coerce(v, type) {
  if (type === 's') return v == null ? '' : String(v).trim();
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return type === 'i' ? Math.trunc(n) : n;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function clean(table, body, partial = false) {
  const def = TABLES[table];
  const out = {};
  for (const [col, type] of Object.entries(def.cols)) {
    if (!(col in body)) { if (!partial) out[col] = type === 's' ? '' : null; continue; }
    out[col] = coerce(body[col], type);
  }
  if (!partial) {
    for (const r of def.required) {
      if (out[r] === null || out[r] === '' || out[r] === undefined) throw new HttpError(400, `Поле "${r}" обязательно`);
    }
  }
  if (table === 'trades') {
    if (out.side && !['long', 'short'].includes(out.side)) throw new HttpError(400, 'side должен быть long или short');
    if (out.qty !== undefined && out.qty !== null && !(out.qty > 0)) throw new HttpError(400, 'Количество должно быть > 0');
    if (out.entry_price !== undefined && out.entry_price !== null && !(out.entry_price > 0)) throw new HttpError(400, 'Цена входа должна быть > 0');
    if (out.exit_price !== undefined && out.exit_price !== null && !(out.exit_price > 0)) throw new HttpError(400, 'Цена выхода должна быть > 0');
    if (out.point_value !== undefined && out.point_value !== null && !(out.point_value > 0)) throw new HttpError(400, 'Стоимость пункта должна быть > 0');
    if (out.qty !== undefined && out.qty !== null && out.qty > 100000) throw new HttpError(400, 'Слишком большое количество');
    const timeRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
    if (out.entry_time && !timeRe.test(out.entry_time)) throw new HttpError(400, 'Некорректная дата входа');
    if (out.exit_time && !timeRe.test(out.exit_time)) throw new HttpError(400, 'Некорректная дата выхода');
    if (out.exit_price === null && 'exit_price' in out) out.exit_time = null;
    if (out.exit_price !== null && out.exit_price !== undefined && !out.exit_time) {
      if (out.entry_time) out.exit_time = out.entry_time;
      else throw new HttpError(400, 'Укажите время выхода');
    }
    if (out.entry_time && out.exit_time && out.exit_time < out.entry_time) throw new HttpError(400, 'Выход раньше входа');
    if (out.symbol) out.symbol = out.symbol.toUpperCase();
    if (out.symbol && !/^[A-Z0-9._-]{1,24}$/.test(out.symbol)) throw new HttpError(400, 'Некорректный тикер');
  }
  if (table === 'instruments' && out.symbol) out.symbol = out.symbol.toUpperCase();
  if (table === 'accounts' && out.currency !== undefined) {
    if (!out.currency) out.currency = 'RUB';
    out.currency = String(out.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(out.currency)) throw new HttpError(400, 'Валюта должна быть кодом из трёх латинских букв');
  }
  if (table === 'journal' && out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new HttpError(400, 'Дата должна быть в формате YYYY-MM-DD');
  return out;
}

function insert(table, row) {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`;
  return Number(db.prepare(sql).run(...cols.map((c) => row[c])).lastInsertRowid);
}
function update(table, id, row) {
  if (table === 'trades' && 'exit_price' in row && row.exit_price !== null && !('exit_time' in row)) {
    const cur = db.prepare('SELECT entry_time FROM trades WHERE id=?').get(id);
    if (cur) row.exit_time = cur.entry_time;
  }
  const cols = Object.keys(row);
  if (!cols.length) return;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`;
  const r = db.prepare(sql).run(...cols.map((c) => row[c]), id);
  if (!r.changes) throw new HttpError(404, 'Не найдено');
}
const getAll = (table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
const wrap = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

function dbError(e) {
  if (/FOREIGN KEY/i.test(e.message)) return new HttpError(400, 'Счёт не найден');
  if (/UNIQUE/i.test(e.message)) return new HttpError(409, 'Такая запись уже существует');
  return e;
}

// ---- стартовые данные: фьючерсы MOEX (общий каталог с облачным режимом)
function seedInstruments() {
  const n = db.prepare('SELECT COUNT(*) c FROM instruments').get().c;
  if (n) return;
  wrap(() => {
    for (const instrument of DEFAULT_INSTRUMENTS) insert('instruments', instrument);
  });
}
seedInstruments();

// ---- демо-данные MOEX
const pad = (n) => String(n).padStart(2, '0');
const fmtD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function seedDemo() {
  const instruments = getAll('instruments');
  return wrap(() => {
    const accId = insert('accounts', {
      name: 'Demo MOEX', broker: 'Брокер MOEX', currency: 'RUB', initial_balance: 200000,
    });
    const start = new Date();
    start.setDate(start.getDate() - 150);
    insert('cashflows', { account_id: accId, date: fmtD(start), amount: 50000, note: 'Пополнение счёта' });
    const mid = new Date(start.getTime() + 70 * 864e5);
    insert('cashflows', { account_id: accId, date: fmtD(mid), amount: -20000, note: 'Вывод прибыли' });

    const { trades, journal } = buildDemo(accId, instruments, new Date(), 465);
    for (const t of trades) insert('trades', t);
    for (const j of journal) insert('journal', j);
    return { accountId: accId, trades: trades.length };
  });
}

function resetDemoData() {
  wrap(() => {
    db.exec('DELETE FROM trades; DELETE FROM journal; DELETE FROM cashflows; DELETE FROM accounts; DELETE FROM instruments;');
  });
  seedInstruments();
  return seedDemo();
}

const autoSeed = process.env.SEED_DEMO !== '0' && !db.prepare('SELECT COUNT(*) c FROM accounts').get().c;
if (autoSeed) {
  const demo = seedDemo();
  console.log(`Демо-данные: ${demo.trades} сделок`);
}

// ---- маршруты
const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 10e6) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // без "api"
  const method = req.method;
  const [name, idRaw] = parts;

  if (name === 'health' && method === 'GET') return json(res, 200, { ok: true, db: path.basename(DB_FILE) });

  if (name === 'data' && method === 'GET') {
    return json(res, 200, Object.fromEntries(['accounts', 'cashflows', 'instruments', 'trades', 'journal'].map((t) => [t, getAll(t)])));
  }
  if (name === 'data' && method === 'DELETE') {
    return json(res, 200, wrap(() => {
      db.exec('DELETE FROM trades; DELETE FROM journal; DELETE FROM cashflows;');
      return { ok: true };
    }));
  }
  if (name === 'demo' && method === 'POST') return json(res, 200, resetDemoData());

  if (name === 'restore' && method === 'POST') {
    const body = await readBody(req);
    const tables = ['accounts', 'instruments', 'cashflows', 'trades', 'journal'];
    const rows = {};
    for (const t of tables) {
      if (!Array.isArray(body[t])) throw new HttpError(400, `Ожидается массив ${t}`);
      rows[t] = body[t].map((r) => {
        const row = clean(t, r);
        const id = Number(r.id);
        if (Number.isInteger(id) && id > 0) row.id = id; // сохраняем ссылки между таблицами
        return row;
      });
    }
    return json(res, 200, wrap(() => {
      db.exec('DELETE FROM trades; DELETE FROM journal; DELETE FROM cashflows; DELETE FROM accounts; DELETE FROM instruments;');
      for (const t of tables) for (const r of rows[t]) insert(t, r);
      return Object.fromEntries(tables.map((t) => [t, rows[t].length]));
    }));
  }
  if (name === 'trades' && idRaw === 'bulk' && method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.trades)) throw new HttpError(400, 'Ожидается массив trades');
    const rows = body.trades.map((t) => clean('trades', t));
    const ids = wrap(() => rows.map((t) => insert('trades', t)));
    return json(res, 200, { imported: ids.length });
  }
  if (name === 'journal' && method === 'PUT') {
    const body = await readBody(req);
    const row = clean('journal', body);
    const ex = db.prepare('SELECT id FROM journal WHERE date=?').get(row.date);
    if (ex) update('journal', ex.id, row); else insert('journal', row);
    return json(res, 200, { ok: true });
  }
  if (!TABLES[name]) throw new HttpError(404, 'Неизвестный ресурс');
  const id = idRaw ? Number(idRaw) : null;
  if (idRaw && !Number.isInteger(id)) throw new HttpError(400, 'Некорректный id');

  if (method === 'POST' && !id) {
    const body = await readBody(req);
    try { return json(res, 201, { id: insert(name, clean(name, body)) }); }
    catch (e) { throw dbError(e); }
  }
  if (method === 'PUT' && id) {
    const body = await readBody(req);
    try {
      if (name === 'trades' && body.exit_price !== undefined && body.exit_price !== null && !body.exit_time) {
        const cur = db.prepare('SELECT entry_time FROM trades WHERE id=?').get(id);
        if (cur) body.exit_time = body.entry_time || cur.entry_time;
      }
      update(name, id, clean(name, body, true));
      return json(res, 200, { ok: true });
    }
    catch (e) { throw dbError(e); }
  }
  if (method === 'DELETE' && id) {
    const r = db.prepare(`DELETE FROM ${name} WHERE id=?`).run(id);
    if (!r.changes) throw new HttpError(404, 'Не найдено');
    return json(res, 200, { ok: true });
  }
  throw new HttpError(405, 'Метод не поддерживается');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (path.extname(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
      // SPA fallback для клиентских маршрутов
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(b2);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    json(res, status, { error: e.message });
  }
});

server.listen(PORT, HOST, () => console.log(`Дневник трейдера: http://${HOST}:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { db.close(); } catch {} server.close(() => process.exit(0)); });
}
