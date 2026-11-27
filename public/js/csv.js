// Импорт/экспорт сделок CSV: гибкие заголовки, запятая/точка с запятой.
const ALIASES = {
  date: ['date', 'дата', 'entry_time', 'время входа', 'дата входа', 'время', 'entrytime', 'открытие'],
  exit_time: ['exit_time', 'время выхода', 'дата выхода', 'exittime', 'закрытие'],
  symbol: ['symbol', 'тикер', 'инструмент', 'instrument', 'contract', 'контракт', 'ticker'],
  side: ['side', 'направление', 'сторона', 'тип', 'direction', 'long/short'],
  qty: ['qty', 'quantity', 'количество', 'кол-во', 'колво', 'контракты', 'contracts', 'объем', 'объём', 'size'],
  entry: ['entry', 'entry_price', 'вход', 'цена входа', 'цена', 'price', 'open'],
  exit: ['exit', 'exit_price', 'выход', 'цена выхода', 'close'],
  stop: ['stop', 'stop_price', 'стоп', 'стоп-лосс', 'стоп лосс', 'sl'],
  target: ['target', 'target_price', 'take', 'tp', 'тейк', 'тейк-профит', 'цель'],
  fees: ['fees', 'fee', 'комиссия', 'комиссия всего', 'commission'],
  funding: ['funding', 'swap', 'фандинг', 'своп'],
  setup: ['setup', 'сетап', 'стратегия', 'strategy'],
  tags: ['tags', 'теги', 'тег'],
  notes: ['notes', 'note', 'заметка', 'заметки', 'комментарий', 'примечание'],
  emotion: ['emotion', 'эмоция', 'состояние', 'mood'],
  mistakes: ['mistakes', 'ошибки', 'ошибка'],
  rating: ['rating', 'оценка'],
};

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ');
}

function buildHeaderMap(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(n) && map[field] === undefined) map[field] = i;
    }
  });
  return map;
}

export function parseCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = clean.split('\n')[0] || '';
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delim = semicolons >= commas ? ';' : ',';
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[%\s\u00A0$€₽]/g, '').replace(/,/g, '.');
  s = s.replace(/[^0-9.+-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const pad = (n) => String(n).padStart(2, '0');

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${pad(m[4])}:${m[5]}` : null };
  m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) return { day: `${m[3]}-${m[2]}-${m[1]}`, time: m[4] ? `${pad(m[4])}:${m[5]}` : null };
  return null;
}

function addMinutes(day, time, minutes) {
  const d = new Date(`${day}T${time || '10:30'}`);
  if (Number.isNaN(d.getTime())) return { day, time: time || '10:30' };
  d.setMinutes(d.getMinutes() + minutes);
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function parseTradesCsv(text, instruments) {
  const rows = parseCsv(text);
  const errors = [];
  if (rows.length < 2) return { rows: [], errors: ['В файле нет строк со сделками'] };
  const map = buildHeaderMap(rows[0]);
  for (const required of ['date', 'symbol', 'entry']) {
    if (map[required] === undefined) {
      return { rows: [], errors: [`Не найден обязательный столбец «${required === 'date' ? 'date / дата' : required === 'symbol' ? 'symbol / тикер' : 'entry / цена входа'}»`] };
    }
  }
  const bySymbol = new Map(instruments.map((i) => [i.symbol.toUpperCase(), i]));
  const get = (row, field) => (map[field] === undefined ? '' : String(row[map[field]] ?? '').trim());
  const out = [];

  rows.slice(1).forEach((row, idx) => {
    const line = idx + 2;
    if (!row.some((c) => String(c).trim())) return;
    const symbol = get(row, 'symbol').toUpperCase();
    const inst = bySymbol.get(symbol);
    const date = parseDate(get(row, 'date'));
    const entry = parseNumber(get(row, 'entry'));
    const qty = parseNumber(get(row, 'qty')) ?? 1;
    const exit = parseNumber(get(row, 'exit'));
    const sideRaw = get(row, 'side').toLowerCase();
    const side = /шорт|short|sell|продаж|^s$/.test(sideRaw) ? 'short' : 'long';

    if (!symbol) return errors.push(`Строка ${line}: не указан тикер`);
    if (!inst) return errors.push(`Строка ${line}: тикер ${symbol} не найден в списке инструментов`);
    if (!date) return errors.push(`Строка ${line}: не удалось разобрать дату «${get(row, 'date')}»`);
    if (!(entry > 0)) return errors.push(`Строка ${line}: некорректная цена входа`);
    if (!(qty > 0)) return errors.push(`Строка ${line}: некорректное количество`);

    const entryTime = `${date.day}T${date.time || '10:30'}`;
    let exitTime = null;
    if (exit !== null) {
      const exitDate = parseDate(get(row, 'exit_time'));
      const base = exitDate || addMinutes(date.day, date.time, 60);
      exitTime = `${base.day}T${base.time || '11:30'}`;
      if (exitTime < entryTime) exitTime = entryTime;
    }

    const ratingRaw = parseNumber(get(row, 'rating'));
    out.push({
      symbol,
      side,
      qty,
      entry_price: entry,
      exit_price: exit,
      entry_time: entryTime,
      exit_time: exitTime,
      fees: parseNumber(get(row, 'fees')) ?? +(qty * 2 * (inst.fee || 0)).toFixed(2),
      funding: parseNumber(get(row, 'funding')) ?? 0,
      point_value: inst.point_value,
      tick_size: inst.tick_size,
      stop_price: parseNumber(get(row, 'stop')),
      target_price: parseNumber(get(row, 'target')),
      setup: get(row, 'setup'),
      tags: get(row, 'tags'),
      mistakes: get(row, 'mistakes'),
      emotion: get(row, 'emotion'),
      rating: ratingRaw ? Math.max(1, Math.min(5, Math.round(ratingRaw))) : null,
      notes: get(row, 'notes'),
      screenshot: '',
    });
  });
  return { rows: out, errors };
}

const esc = (v) => {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function tradesToCsv(trades) {
  const header = ['date', 'exit_time', 'symbol', 'side', 'qty', 'entry', 'exit', 'stop', 'target', 'fees', 'funding', 'setup', 'tags', 'emotion', 'mistakes', 'rating', 'notes'];
  const lines = trades.map((t) => [
    t.entry_time, t.exit_time || '', t.symbol, t.side, t.qty, t.entry_price, t.exit_price ?? '',
    t.stop_price ?? '', t.target_price ?? '', t.fees ?? 0, t.funding ?? 0, t.setup || '', t.tags || '',
    t.emotion || '', t.mistakes || '', t.rating ?? '', t.notes || '',
  ].map(esc).join(';'));
  return `\uFEFF${header.join(';')}\n${lines.join('\n')}\n`;
}

export function csvTemplate() {
  const example = [
    ['2026-11-24 10:35', '2026-11-24 11:10', 'Si', 'long', 1, '82525', '82600', '82300', '82800', '7.62', '', 'Откат к VWAP', 'A+', 'Спокойствие', '', 5, 'План: вход после ретеста'],
    ['2026-11-25 11:02', '', 'RTS', 'short', 1, '88370', '', '88900', '87300', '19.16', '', 'Ложный пробой', '', 'Уверенность', '', 4, 'Открытая позиция'],
  ];
  const header = ['date', 'exit_time', 'symbol', 'side', 'qty', 'entry', 'exit', 'stop', 'target', 'fees', 'funding', 'setup', 'tags', 'emotion', 'mistakes', 'rating', 'notes'];
  return `\uFEFF${[header, ...example].map((r) => r.map(esc).join(';')).join('\n')}\n`;
}
