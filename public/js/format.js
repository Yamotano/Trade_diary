// Форматирование чисел, денег и дат для интерфейса.
const CURRENCY_SYMBOL = { USD: '$', EUR: '€', RUB: '₽', GBP: '£', KZT: '₸' };

const nfCache = new Map();
function nf(decimals = 0) {
  const key = String(decimals);
  if (!nfCache.has(key)) nfCache.set(key, new Intl.NumberFormat('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  return nfCache.get(key);
}

export const currencySymbol = (currency = 'USD') => CURRENCY_SYMBOL[currency] || currency;

export function num(v, decimals = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return nf(decimals).format(Number(v));
}

/** Число без лишних нулей и с запятой: 0.250000 → 0,25 */
export function numTrim(v) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
  return String(Number(v)).replace('.', ',');
}

/** Деньги: $1 234; для рублей — 1 234 ₽; компактно для осей: $1,2 тыс. */
export function money(v, currency = 'USD', { decimals = 0, compact = false } = {}) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const value = Number(v);
  const sym = currencySymbol(currency);
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (compact) {
    if (abs >= 1e6) {
      const text = `${nf(1).format(abs / 1e6)} млн`;
      return currency === 'RUB' ? `${sign}${text} ₽` : `${sign}${sym}${text}`;
    }
    if (abs >= 1e4) {
      const text = `${nf(1).format(abs / 1e3)} тыс.`;
      return currency === 'RUB' ? `${sign}${text} ₽` : `${sign}${sym}${text}`;
    }
    return currency === 'RUB' ? `${sign}${nf(0).format(abs)} ₽` : `${sign}${sym}${nf(0).format(abs)}`;
  }
  const text = nf(decimals).format(abs);
  return currency === 'RUB' ? `${sign}${text} ₽` : `${sign}${sym}${text}`;
}

/** Деньги со знаком: +$1 234 / −$320 */
export function signedMoney(v, currency = 'USD', opts = {}) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const value = Number(v);
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${money(Math.abs(value), currency, opts)}`;
}

/** Цена без валюты, с нужным числом знаков. */
export function price(v, tickSize = null) {
  if (v === null || v === undefined || v === '') return '—';
  const value = Number(v);
  if (!Number.isFinite(value)) return '—';
  let decimals = 2;
  if (tickSize && Number(tickSize) > 0) {
    const s = String(tickSize);
    decimals = s.includes('.') ? s.split('.')[1].replace(/0+$/, '').length : 0;
    decimals = Math.min(6, Math.max(0, decimals));
  }
  return num(value, decimals);
}

/** Доля 0..1 → проценты. */
export function pct(v, decimals = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return `${nf(decimals).format(Number(v) * 100)}%`;
}

export function rmult(v, decimals = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const value = Number(v);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${nf(decimals).format(Math.abs(value))}R`;
}

export function ratio(v, decimals = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  if (!Number.isFinite(Number(v))) return '∞';
  return nf(decimals).format(Number(v));
}

export function cls(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v)) || Number(v) === 0) return 'zero';
  return Number(v) > 0 ? 'pos' : 'neg';
}

export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

// ---- даты (строки храним как локальные YYYY-MM-DDTHH:mm) ----
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function fmtDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export function fmtDateShort(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function fmtDateFull(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtMonth(year, monthIndex) {
  return `${MONTHS_NOM[monthIndex]} ${year}`;
}

export function fmtTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${fmtDateShort(d)}, ${fmtTime(d)}`;
}

export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return '—';
  const m = Math.max(0, Math.round(Number(minutes)));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h} ч ${rest} мин` : `${h} ч`;
}

export function weekdayShort(value) {
  const d = toDate(value);
  if (!d) return '';
  return WEEKDAYS_SHORT[(d.getDay() + 6) % 7];
}

export function isoDay(value) {
  const d = toDate(value) || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isoLocal(date = new Date()) {
  const d = date instanceof Date ? date : toDate(date) || new Date();
  return `${isoDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function signedPct(v, decimals = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const value = Number(v);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${nf(decimals).format(Math.abs(value))}%`;
}
