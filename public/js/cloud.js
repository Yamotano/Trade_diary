// Клиент Supabase для статической версии: Auth (REST) + PostgREST.
// Никакого SDK и сборки — только fetch. RLS ограничивает данные пользователем.
const LS_SESSION = 'fd.cloud.session';

export const DEFAULT_INSTRUMENTS = [
  { symbol: 'Si', name: 'Фьючерс на доллар США', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 1, margin: 12631.31, fee: 3.81 },
  { symbol: 'RTS', name: 'Фьючерс на индекс РТС', exchange: 'MOEX', type: 'future', point_value: 1.64253, tick_size: 10, margin: 22321.14, fee: 9.58 },
  { symbol: 'MIX', name: 'Фьючерс на индекс МосБиржи', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 25, margin: 24509.41, fee: 15.25 },
  { symbol: 'MXI', name: 'Мини-фьючерс на индекс МосБиржи', exchange: 'MOEX', type: 'future', point_value: 10, tick_size: 0.05, margin: 2450.63, fee: 1.53 },
  { symbol: 'BR', name: 'Фьючерс на нефть Brent', exchange: 'MOEX', type: 'future', point_value: 821.265, tick_size: 0.01, margin: 16511.12, fee: 10.45 },
  { symbol: 'NG', name: 'Фьючерс на природный газ', exchange: 'MOEX', type: 'future', point_value: 8212.65, tick_size: 0.001, margin: 8773.76, fee: 3.95 },
  { symbol: 'GOLD', name: 'Фьючерс на золото', exchange: 'MOEX', type: 'future', point_value: 82.1265, tick_size: 0.1, margin: 21627.27, fee: 38.99 },
  { symbol: 'SILV', name: 'Фьючерс на серебро', exchange: 'MOEX', type: 'future', point_value: 821.265, tick_size: 0.01, margin: 5705.69, fee: 4.55 },
  { symbol: 'PLT', name: 'Фьючерс на платину', exchange: 'MOEX', type: 'future', point_value: 82.1265, tick_size: 0.1, margin: 13973.76, fee: 14.09 },
  { symbol: 'CNY', name: 'Фьючерс на юань', exchange: 'MOEX', type: 'future', point_value: 1000, tick_size: 0.001, margin: 1056.35, fee: 0.57 },
  { symbol: 'Eu', name: 'Фьючерс на евро', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 1, margin: 13813.34, fee: 4.18 },
  { symbol: 'GAZR', name: 'Фьючерс на акции Газпрома', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 1, margin: 1788.86, fee: 2.02 },
  { symbol: 'SBRF', name: 'Фьючерс на акции Сбербанка', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 1, margin: 5049.09, fee: 5.7 },
  { symbol: 'LKOH', name: 'Фьючерс на акции Лукойла', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 1, margin: 10362.44, fee: 10.77 },
  { symbol: 'ROSN', name: 'Фьючерс на акции Роснефти', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 1, margin: 6819.84, fee: 6.58 },
  { symbol: 'VTBR', name: 'Фьючерс на акции ВТБ', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 1, margin: 1014.67, fee: 1.15 },
  { symbol: 'MMI', name: 'Фьючерс на индекс MMI', exchange: 'MOEX', type: 'future', point_value: 1, tick_size: 1, margin: 534.52, fee: 0.28 },
];

function readConfig() {
  const base = typeof window !== 'undefined' ? (window.FD_CONFIG || {}) : {};
  if (typeof localStorage === 'undefined') return base;
  try {
    const raw = localStorage.getItem('fd.cloud.override');
    if (raw) {
      const override = JSON.parse(raw);
      if (override.supabaseUrl && override.supabaseAnonKey) return { ...base, ...override };
    }
  } catch { /* ignore */ }
  return base;
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function loadSession() {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function base64Url(value) {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    return part ? base64Url(part) : null;
  } catch { return null; }
}

const config = readConfig();
const supabaseUrl = normalizeUrl(config.supabaseUrl);
const supabaseKey = String(config.supabaseAnonKey || '').trim();
const forceLocal = typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');

export const cloud = {
  config,
  enabled: !forceLocal && Boolean(supabaseUrl && supabaseKey && /^https?:\/\//.test(supabaseUrl)),
  session: null,
  authError: '',
  authSettings: null,
  emailEnabled: null,
  refreshPromise: null,

  async init() {
    if (!this.enabled) return null;
    this.session = loadSession();
    this.captureAuthHash();
    try { this.authError = sessionStorage.getItem('fd.auth.error') || ''; } catch { /* ignore */ }
    try { sessionStorage.removeItem('fd.auth.error'); } catch { /* ignore */ }
    await this.loadAuthSettings();
    if (this.session && (!this.session.expires_at || this.session.expires_at < Date.now() + 60000)) {
      try { await this.refresh(); } catch { this.session = null; this.clearSession(); }
    }
    return this.session;
  },

  async loadAuthSettings() {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey } });
      if (!res.ok) return;
      const data = await res.json();
      this.authSettings = data;
      this.emailEnabled = data?.external?.email !== false;
    } catch { /* настройки недоступны — не блокируем вход */ }
  },

  captureAuthHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw.includes('access_token=') && !raw.includes('error=') && !raw.includes('error_description=')) return;
    const params = new URLSearchParams(raw);
    const access = params.get('access_token');
    const error = params.get('error_description') || params.get('error');
    if (access) {
      this.setSession({
        access_token: access,
        refresh_token: params.get('refresh_token') || '',
        expires_in: Number(params.get('expires_in')) || 3600,
      });
      history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`);
    } else if (error) {
      try { sessionStorage.setItem('fd.auth.error', error); } catch { /* ignore */ }
      history.replaceState(null, '', `${location.pathname}${location.search}#/auth`);
    }
  },

  setSession(data) {
    const expiresIn = Number(data.expires_in) || 3600;
    const user = data.user || this.session?.user || decodeJwt(data.access_token) || null;
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || this.session?.refresh_token || '',
      expires_at: data.expires_at ? Number(data.expires_at) * 1000 : Date.now() + expiresIn * 1000,
      user: user ? { id: user.id || user.sub, email: user.email || this.session?.user?.email || '' } : null,
    };
    try { localStorage.setItem(LS_SESSION, JSON.stringify(this.session)); } catch { /* ignore */ }
  },

  clearSession() {
    this.session = null;
    try { localStorage.removeItem(LS_SESSION); } catch { /* ignore */ }
  },

  get email() { return this.session?.user?.email || ''; },
  get userId() { return this.session?.user?.id || ''; },

  async authRequest(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: supabaseKey,
        'Content-Type': 'application/json',
        ...(this.session?.access_token ? { Authorization: `Bearer ${this.session.access_token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async signIn(email, password) {
    const data = await this.authRequest('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password },
    });
    if (!data?.access_token) throw new Error('Supabase не вернул сессию. Проверьте настройки Auth.');
    this.setSession(data);
    return data.user || this.session.user;
  },

  async signUp(email, password) {
    const data = await this.authRequest('/auth/v1/signup', { method: 'POST', body: { email, password } });
    if (data?.access_token) {
      this.setSession(data);
      return { needsConfirmation: false, user: data.user || this.session?.user };
    }
    return { needsConfirmation: true, user: data?.user || null };
  },

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.session?.refresh_token) throw new Error('Сессия истекла');
    this.refreshPromise = (async () => {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.session.refresh_token }),
      });
      const data = await parseResponse(res);
      if (!data?.access_token) throw new Error('Не удалось обновить сессию');
      this.setSession({ ...data, user: data.user || this.session.user });
      return data;
    })();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  },

  async signOut() {
    try {
      if (this.session?.access_token) {
        await fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
          method: 'POST',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${this.session.access_token}` },
        });
      }
    } catch { /* локально всё равно выходим */ }
    this.clearSession();
  },

  async ensureToken() {
    if (!this.session?.access_token) throw new Error('Требуется вход');
    if (!this.session.expires_at || this.session.expires_at < Date.now() + 60000) {
      await this.refresh();
    }
  },

  async request(path, { method = 'GET', body, prefer, retry = true } = {}) {
    await this.ensureToken();
    const res = await fetch(`${supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${this.session.access_token}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && retry) {
      await this.refresh().catch(() => { this.clearSession(); throw new Error('Сессия истекла, войдите снова'); });
      return this.request(path, { method, body, prefer, retry: false });
    }
    return parseResponse(res);
  },

  async selectAll(table, order = 'id.asc') {
    const limit = 1000;
    let offset = 0;
    const out = [];
    while (true) {
      const rows = await this.request(`/rest/v1/${table}?select=*&order=${order}&limit=${limit}&offset=${offset}`);
      if (!Array.isArray(rows) || !rows.length) break;
      out.push(...rows);
      offset += rows.length;
      if (out.length > 50000) break;
    }
    return out;
  },

  async insert(table, row) {
    const rows = await this.request(`/rest/v1/${table}`, {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async insertMany(table, rows) {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await this.request(`/rest/v1/${table}`, {
        method: 'POST',
        body: chunk,
        prefer: 'return=minimal',
      });
      inserted += chunk.length;
    }
    return inserted;
  },

  async update(table, id, row) {
    const rows = await this.request(`/rest/v1/${table}?id=eq.${Number(id)}`, {
      method: 'PATCH',
      body: row,
      prefer: 'return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async remove(table, id) {
    await this.request(`/rest/v1/${table}?id=eq.${Number(id)}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  },

  async saveJournal(row) {
    const rows = await this.request('/rest/v1/journal?on_conflict=user_id,date', {
      method: 'POST',
      body: row,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async deleteAll(table) {
    const uid = encodeURIComponent(this.userId);
    await this.request(`/rest/v1/${table}?user_id=eq.${uid}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  },

  async load() {
    let [accounts, cashflows, instruments, trades, journal] = await Promise.all([
      this.selectAll('accounts'),
      this.selectAll('cashflows', 'id.asc'),
      this.selectAll('instruments', 'symbol.asc'),
      this.selectAll('trades'),
      this.selectAll('journal', 'date.asc'),
    ]);

    if (!accounts.length) {
      const account = await this.insert('accounts', {
        name: 'Мой счёт', broker: '', currency: 'RUB', initial_balance: 0,
      });
      accounts = [account];
    }
    if (!instruments.length) {
      await this.insertMany('instruments', DEFAULT_INSTRUMENTS);
      instruments = await this.selectAll('instruments', 'symbol.asc');
    }
    return { accounts, cashflows, instruments, trades, journal };
  },

  async bulkTrades(rows) {
    const uid = this.userId;
    const payload = rows.map((r) => ({ ...r, user_id: uid }));
    const inserted = await this.insertMany('trades', payload);
    return { imported: inserted };
  },

  async clear() {
    await this.deleteAll('trades');
    await this.deleteAll('journal');
    await this.deleteAll('cashflows');
    return { ok: true };
  },

  async demo() {
    let instruments = await this.selectAll('instruments', 'symbol.asc');
    if (!instruments.length) {
      await this.insertMany('instruments', DEFAULT_INSTRUMENTS);
      instruments = await this.selectAll('instruments', 'symbol.asc');
    }
    await this.deleteAll('trades');
    await this.deleteAll('journal');
    await this.deleteAll('cashflows');
    await this.deleteAll('accounts');

    const account = await this.insert('accounts', {
      name: 'Demo MOEX', broker: 'Брокер MOEX', currency: 'RUB', initial_balance: 200000,
    });
    const start = new Date();
    start.setDate(start.getDate() - 150);
    await this.insert('cashflows', {
      account_id: account.id, date: isoDay(start), amount: 50000, note: 'Пополнение счёта',
    });
    const mid = new Date(start.getTime() + 70 * 864e5);
    await this.insert('cashflows', {
      account_id: account.id, date: isoDay(mid), amount: -20000, note: 'Вывод прибыли',
    });

    const { trades, journal } = buildDemo(account.id, instruments, new Date());
    await this.insertMany('trades', trades);
    if (journal.length) await this.insertMany('journal', journal);
    return { accountId: account.id, trades: trades.length };
  },
};

cloud.api = {
  load: () => cloud.load(),
  create: (table, row) => cloud.insert(table, row),
  update: (table, id, row) => cloud.update(table, id, row),
  remove: (table, id) => cloud.remove(table, id),
  saveJournal: (row) => cloud.saveJournal(row),
  bulkTrades: (rows) => cloud.bulkTrades(rows),
  demo: () => cloud.demo(),
  clear: () => cloud.clear(),
  restore: () => Promise.reject(new Error('В облачной версии импорт JSON отключён — используйте CSV или локальную версию')),
};

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error_description || data.msg || data.error || data.details))
      || `Ошибка Supabase (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = data?.code || data?.error_code;
    throw err;
  }
  return data;
}

function pad(n) { return String(n).padStart(2, '0'); }
function isoDay(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function isoLocal(d) { return `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function roundTo(v, step) {
  if (!(step > 0)) return Math.round(v * 100) / 100;
  const x = Math.round(v / step) * step;
  return Number(x.toPrecision(12));
}

// Демо-журнал для облачного режима: те же принципы, что и в server.js.
export function buildDemo(accountId, instruments, now, seed = 465) {
  const rnd = mulberry32(seed);
  const picks = ['Si', 'RTS', 'MIX', 'BR', 'GOLD', 'SBRF']
    .map((s) => instruments.find((i) => i.symbol === s))
    .filter(Boolean);
  const list = picks.length ? picks : instruments.slice(0, 4);
  const specs = {
    Si: { base: 82525, stop: [300, 800], qty: [1, 3] },
    RTS: { base: 88370, stop: [500, 1500], qty: [1, 1] },
    MIX: { base: 231125, stop: [500, 1500], qty: [1, 1] },
    BR: { base: 96.43, stop: [0.3, 1], qty: [1, 2] },
    GOLD: { base: 3596.8, stop: [5, 15], qty: [1, 1] },
    SBRF: { base: 28806, stop: [50, 150], qty: [2, 5] },
  };
  const setups = ['Пробой уровня', 'Откат к VWAP', 'Тренд по EMA', 'Ложный пробой', 'Разворот на открытии', 'Сжатие волатильности'];
  const emotions = ['Спокойствие', 'Уверенность', 'Азарт', 'Страх', 'FOMO', 'Усталость', 'Нейтрально'];
  const mistakes = ['', '', '', '', 'Ранний вход', 'Сдвинул стоп', 'Овертрейдинг', 'Не по плану', 'Поздний вход', 'Увеличил размер'];
  const trades = [];
  const journal = [];

  for (let d = 150; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 864e5);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    if (rnd() < 0.1) continue;
    const count = 1 + Math.floor(rnd() * 2) + (rnd() < 0.08 ? 2 : 0);
    let netDay = 0;
    for (let k = 0; k < count; k++) {
      const inst = list[Math.floor(rnd() * list.length)];
      if (!inst) continue;
      const spec = specs[inst.symbol] || { base: 100, stop: [1, 3], qty: [1, 1] };
      const side = rnd() < 0.54 ? 'long' : 'short';
      const dir = side === 'long' ? 1 : -1;
      const qtyMin = spec.qty?.[0] ?? 1;
      const qtyMax = spec.qty?.[1] ?? 1;
      const qty = qtyMin + Math.floor(rnd() * (qtyMax - qtyMin + 1));
      const entry = roundTo(spec.base * (1 + (rnd() - 0.5) * 0.03), inst.tick_size);
      const stopDist = roundTo(spec.stop[0] + rnd() * (spec.stop[1] - spec.stop[0]), inst.tick_size);
      const win = rnd() < 0.53;
      const rMult = win ? 0.4 + rnd() * 1.8 : -(0.6 + rnd() * 0.5);
      const move = roundTo(stopDist * rMult, inst.tick_size);
      if (!move) continue;
      const evening = rnd() < 0.35;
      const et = new Date(day);
      et.setHours(evening ? 19 + Math.floor(rnd() * 3) : 10 + Math.floor(rnd() * 7), Math.floor(rnd() * 60), 0, 0);
      const xt = new Date(et.getTime() + (5 + Math.floor(rnd() * 175)) * 60000);
      if (isoDay(xt) !== isoDay(et)) {
        xt.setFullYear(et.getFullYear(), et.getMonth(), et.getDate());
        xt.setHours(23, 40, 0, 0);
      } else if (xt.getHours() === 23 && xt.getMinutes() > 40) {
        xt.setHours(23, 40, 0, 0);
      }
      const fees = +(qty * 2 * (inst.fee || 0)).toFixed(2);
      trades.push({
        account_id: accountId, symbol: inst.symbol, side, qty,
        entry_price: entry, exit_price: roundTo(entry + dir * move, inst.tick_size),
        entry_time: isoLocal(et), exit_time: isoLocal(xt), fees, funding: 0,
        point_value: inst.point_value, tick_size: inst.tick_size,
        stop_price: roundTo(entry - dir * stopDist, inst.tick_size),
        target_price: roundTo(entry + dir * stopDist * 2, inst.tick_size),
        setup: setups[Math.floor(rnd() * setups.length)],
        tags: rnd() < 0.25 ? 'A+' : '',
        mistakes: win ? '' : mistakes[Math.floor(rnd() * mistakes.length)],
        emotion: emotions[Math.floor(rnd() * emotions.length)],
        rating: Math.max(1, Math.min(5, 3 + (win ? 1 : -1) + Math.floor(rnd() * 2) - (rnd() < 0.2 ? 1 : 0))),
        notes: '', screenshot: '',
      });
      netDay += dir * (roundTo(entry + dir * move, inst.tick_size) - entry) * qty * inst.point_value - fees;
    }
    if (rnd() < 0.35 && journal.length < 40) {
      journal.push({
        date: isoDay(day), mood: 2 + Math.floor(rnd() * 4),
        plan: rnd() < 0.5 ? 'Только A-сетапы, риск не более 1% на сделку. Не торговать первые 15 минут.' : 'День без спешки: дождаться ретеста, максимум 3 сделки.',
        review: netDay > 3000 ? 'Хороший день: дисциплина и размер соблюдены.' : netDay < -3000 ? 'Переторговал после убытка — стоп после двух минусов.' : 'Спокойный день, сделки по плану.',
        notes: '',
      });
    }
  }

  // Две открытые позиции
  for (let i = 0; i < Math.min(2, list.length); i++) {
    const inst = list[i];
    const spec = specs[inst.symbol] || { base: 100, stop: [1, 3] };
    const entry = roundTo(spec.base * (1 + (i === 0 ? 0.004 : -0.003)), inst.tick_size);
    const stopDist = roundTo((spec.stop[0] + spec.stop[1]) / 2, inst.tick_size);
    const dir = i === 0 ? 1 : -1;
    trades.push({
      account_id: accountId, symbol: inst.symbol, side: dir === 1 ? 'long' : 'short', qty: 1,
      entry_price: entry, exit_price: null,
      entry_time: isoLocal(new Date(now.getTime() - (i + 1) * 3600e3)), exit_time: null,
      fees: +(2 * (inst.fee || 0)).toFixed(2), funding: 0, point_value: inst.point_value, tick_size: inst.tick_size,
      stop_price: roundTo(entry - dir * stopDist, inst.tick_size),
      target_price: roundTo(entry + dir * stopDist * 2, inst.tick_size),
      setup: 'Пробой уровня', tags: '', mistakes: '', emotion: 'Спокойствие', rating: 4,
      notes: 'Позиция открыта, план: трейлинг по EMA.', screenshot: '',
    });
  }
  const today = isoDay(now);
  if (!journal.some((j) => j.date === today)) {
    journal.push({
      date: today, mood: 3,
      plan: 'Торговать только Si/RTS, риск 0,5% на сделку.',
      review: '', notes: 'Фокус недели: не увеличивать размер после плюсов.',
    });
  }
  return { trades, journal };
}
