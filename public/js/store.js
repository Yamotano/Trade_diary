import { api } from './api.js';
import { enrich, periodRange } from '../analytics.js';

const LS_ACC = 'fd.accountId';
const LS_PERIOD = 'fd.period';

export const PERIODS = [
  { key: '7d', label: '7д' },
  { key: '30d', label: '30д' },
  { key: '90d', label: '90д' },
  { key: 'ytd', label: 'Год' },
  { key: 'all', label: 'Всё' },
];

export const PERIOD_LABELS = {
  today: 'сегодня',
  '7d': 'за 7 дней',
  '30d': 'за 30 дней',
  '90d': 'за 90 дней',
  ytd: 'с начала года',
  all: 'за всё время',
};

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch { /* приватный режим */ } }

export const store = {
  accounts: [],
  cashflows: [],
  instruments: [],
  trades: [],
  journal: [],
  accountId: null,
  period: lsGet(LS_PERIOD) || '90d',
  loaded: false,
  error: null,

  async load() {
    const data = await api.load();
    this.accounts = data.accounts;
    this.cashflows = data.cashflows;
    this.instruments = data.instruments;
    this.trades = data.trades.map(enrich);
    this.journal = data.journal;
    const saved = Number(lsGet(LS_ACC));
    if (!this.accounts.some((a) => a.id === this.accountId)) {
      this.accountId = this.accounts.some((a) => a.id === saved) ? saved : (this.accounts[0]?.id ?? null);
    }
    if (this.accountId) lsSet(LS_ACC, String(this.accountId));
    this.loaded = true;
    this.error = null;
    return this;
  },

  get account() { return this.accounts.find((a) => a.id === this.accountId) || null; },
  get currency() { return this.account?.currency || 'USD'; },
  get initial() { return Number(this.account?.initial_balance) || 0; },
  get accountTrades() { return this.trades.filter((t) => t.account_id === this.accountId); },
  get accountCashflows() { return this.cashflows.filter((c) => c.account_id === this.accountId); },
  get balance() {
    const net = this.accountTrades.reduce((sum, t) => sum + (t.closed ? t.net : 0), 0);
    const cash = this.accountCashflows.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    return this.initial + cash + net;
  },
  get journalMap() { return Object.fromEntries(this.journal.map((j) => [j.date, j])); },

  setAccount(id) {
    this.accountId = Number(id);
    lsSet(LS_ACC, String(id));
  },
  setPeriod(period) {
    this.period = period;
    lsSet(LS_PERIOD, period);
  },
  range() { return this.period === 'all' ? null : periodRange(this.period, new Date()); },

  /** Сделки за выбранный период (по дню закрытия/входа). */
  periodTrades(range = this.range()) {
    if (!range) return this.accountTrades;
    const [from, to] = range;
    return this.accountTrades.filter((t) => (!from || t.day >= from) && (!to || t.day <= to));
  },

  /** Инструмент по тикеру. */
  instrument(symbol) { return this.instruments.find((i) => i.symbol === symbol) || null; },

  /** Популярные сетапы/эмоции для подсказок в форме. */
  suggestions() {
    const setups = new Set();
    const emotions = new Set();
    const mistakes = new Set();
    for (const t of this.trades) {
      if (t.setup) setups.add(t.setup);
      if (t.emotion) emotions.add(t.emotion);
      if (t.mistakes) mistakes.add(t.mistakes);
    }
    return { setups: [...setups], emotions: [...emotions], mistakes: [...mistakes] };
  },
};
