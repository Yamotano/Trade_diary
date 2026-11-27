// Минимальный мок Supabase Auth + PostgREST для локальной проверки облачного режима.
// Не для продакшена: без RLS, пароли в памяти, токены простые.
import http from 'node:http';
import crypto from 'node:crypto';

const tables = { accounts: [], cashflows: [], instruments: [], trades: [], journal: [] };
const counters = {};
const users = new Map(); // email -> { id, password }
const tokens = new Map(); // token -> userId
const refreshTokens = new Map(); // refresh -> userId

const json = (res, status, data) => {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,prefer',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : null); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

function authUser(req) {
  const raw = String(req.headers.authorization || '');
  const token = raw.replace(/^Bearer\s+/i, '');
  return tokens.get(token) || null;
}

function newSession(user) {
  const access = crypto.randomBytes(16).toString('hex');
  const refresh = crypto.randomBytes(16).toString('hex');
  tokens.set(access, user.id);
  refreshTokens.set(refresh, user.id);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, refresh_token: refresh, user };
}

function filterRows(table, uid, params) {
  let rows = tables[table].filter((r) => r.user_id === uid);
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    if (typeof value === 'string' && value.startsWith('eq.')) {
      const target = value.slice(3);
      rows = rows.filter((r) => String(r[key]) === target);
    }
  }
  return rows;
}

function sortRows(rows, order) {
  if (!order) return rows;
  const [field, dir = 'asc'] = order.split('.');
  return [...rows].sort((a, b) => {
    const va = a[field], vb = b[field];
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (va > vb ? 1 : -1) * (dir === 'desc' ? -1 : 1);
  });
}

function nextId(table) {
  counters[table] = (counters[table] || 0) + 1;
  return counters[table];
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
      const body = await readBody(req);
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      if (!email || password.length < 6) return json(res, 400, { code: 'weak_password', msg: 'Пароль слишком короткий' });
      if (users.has(email)) return json(res, 400, { code: 'user_already_exists', msg: 'Пользователь уже существует' });
      const user = { id: crypto.randomUUID(), email };
      users.set(email, { ...user, password });
      return json(res, 200, newSession(user));
    }

    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const body = await readBody(req);
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const email = String(body?.email || '').trim().toLowerCase();
        const record = users.get(email);
        if (!record || record.password !== String(body?.password || '')) {
          return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        }
        return json(res, 200, newSession({ id: record.id, email }));
      }
      if (grant === 'refresh_token') {
        const uid = refreshTokens.get(String(body?.refresh_token || ''));
        if (!uid) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        const record = [...users.values()].find((u) => u.id === uid);
        return json(res, 200, newSession({ id: record.id, email: record.email }));
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }

    if (url.pathname === '/auth/v1/logout') {
      const uid = authUser(req);
      if (uid) {
        for (const [t, u] of tokens) if (u === uid) tokens.delete(t);
      }
      return json(res, 204);
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/')[3];
      if (!tables[table]) return json(res, 404, { message: 'unknown table' });
      const uid = authUser(req);
      if (!uid) return json(res, 401, { message: 'JWT missing' });
      const prefer = String(req.headers.prefer || '');

      if (req.method === 'GET') {
        let rows = filterRows(table, uid, url.searchParams);
        rows = sortRows(rows, url.searchParams.get('order'));
        const limit = Number(url.searchParams.get('limit')) || 1000;
        const offset = Number(url.searchParams.get('offset')) || 0;
        return json(res, 200, rows.slice(offset, offset + limit));
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        const input = Array.isArray(body) ? body : [body];
        const conflict = url.searchParams.get('on_conflict')?.split(',') || [];
        const upsert = prefer.includes('merge-duplicates');
        const out = [];
        for (const row of input) {
          const clean = { ...row };
          delete clean.id;
          // Supabase подставляет auth.uid() по умолчанию до проверки ON CONFLICT.
          if (!clean.user_id) clean.user_id = uid;
          let existing = null;
          if (upsert && conflict.length) {
            existing = tables[table].find((r) => r.user_id === uid && conflict.every((c) => String(r[c]) === String(clean[c])));
          }
          if (existing) {
            Object.assign(existing, clean);
            out.push(existing);
          } else {
            const created = { id: nextId(table), ...clean };
            tables[table].push(created);
            out.push(created);
          }
        }
        if (table === 'trades' || table === 'cashflows') {
          // каскадов не требуется для теста
        }
        return json(res, 201, prefer.includes('return=representation') ? out : undefined);
      }

      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const rows = filterRows(table, uid, url.searchParams);
        for (const row of rows) Object.assign(row, body);
        return json(res, 200, prefer.includes('return=representation') ? rows : undefined);
      }

      if (req.method === 'DELETE') {
        const rows = filterRows(table, uid, url.searchParams);
        const ids = new Set(rows.map((r) => r.id));
        tables[table] = tables[table].filter((r) => !ids.has(r.id));
        if (table === 'accounts') {
          tables.trades = tables.trades.filter((t) => !ids.has(t.account_id));
          tables.cashflows = tables.cashflows.filter((c) => !ids.has(c.account_id));
        }
        return json(res, 204);
      }
    }

    return json(res, 404, { message: 'not found' });
  } catch (err) {
    return json(res, 500, { message: err.message });
  }
});

const port = Number(process.env.MOCK_PORT) || 3010;
server.listen(port, '127.0.0.1', () => console.log(`mock supabase: http://127.0.0.1:${port}`));
