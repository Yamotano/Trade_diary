import { store } from '../store.js';
import { stats } from '../../analytics.js';
import {
  signedMoney, num, numTrim, price, pct, rmult, cls, fmtDateFull, fmtDateShort, fmtTime, isoDay, escapeHtml, escapeAttr, plural, fmtDuration,
} from '../format.js';
import { icon, emptyState, sideBadge, toast } from '../components.js';
import { api } from '../api.js';
import { openTradeForm } from '../trade-form.js';

const MOODS = [
  { value: 1, emoji: '😞', label: 'Тяжело' },
  { value: 2, emoji: '😕', label: 'Спад' },
  { value: 3, emoji: '😐', label: 'Нейтрально' },
  { value: 4, emoji: '🙂', label: 'Хорошо' },
  { value: 5, emoji: '😄', label: 'Отлично' },
];

function currentDate() {
  const m = location.hash.match(/^#\/journal\/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : isoDay(new Date());
}

function shiftDate(day, delta) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return isoDay(d);
}

export function render(root) {
  if (!store.account) {
    root.innerHTML = emptyState({ iconName: 'wallet', title: 'Нет торгового счёта', text: 'Создайте счёт в настройках.', action: '<a class="btn btn-primary" href="#/settings">Настройки</a>' });
    return;
  }
  const day = currentDate();
  const entry = store.journalMap[day] || { date: day, mood: null, plan: '', review: '', notes: '' };
  const mood = Number(entry.mood) || 0;
  const dayTrades = store.accountTrades.filter((t) => t.day === day);
  const dayStats = stats(dayTrades);
  const c = store.currency;
  const today = isoDay(new Date());

  const timeline = [...store.journal]
    .filter((j) => j.plan || j.review || j.notes || j.mood)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 16);

  const dayNet = dayTrades.filter((t) => t.closed).reduce((sum, t) => sum + t.net, 0);

  root.innerHTML = `<div class="journal-layout">
    <div class="stack">
    <div class="card journal-editor">
      <div class="card-head">
        <div>
          <h3 class="card-title">${fmtDateFull(day)}</h3>
          <p class="card-sub">${day === today ? 'Сегодня' : ''} ${dayTrades.length ? `· ${dayTrades.length} ${plural(dayTrades.length, 'сделка', 'сделки', 'сделок')} · ${signedMoney(dayNet, c)}` : '· сделок нет'}</p>
        </div>
        <div class="card-actions">
          <button class="btn btn-icon btn-sm" data-prev aria-label="Предыдущий день">${icon('chevron-left')}</button>
          <button class="btn btn-icon btn-sm" data-next aria-label="Следующий день">${icon('chevron-right')}</button>
          <a class="btn btn-sm" href="#/journal">Сегодня</a>
        </div>
      </div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field full">
            <label>Состояние и настроение</label>
            <div class="mood-row" id="moodRow">
              ${MOODS.map((m) => `<button type="button" class="mood-btn ${mood === m.value ? 'active' : ''}" data-mood="${m.value}">
                <span class="mood-emoji">${m.emoji}</span>${m.label}</button>`).join('')}
            </div>
          </div>
          <div class="field full">
            <label for="jPlan">План на день</label>
            <textarea class="input" id="jPlan" rows="3" placeholder="Какие сетапы торгуем, риск на сделку, что важно не делать">${escapeHtml(entry.plan || '')}</textarea>
          </div>
          <div class="field full">
            <label for="jReview">Разбор дня</label>
            <textarea class="input" id="jReview" rows="4" placeholder="Что сработало, где нарушил план, что забрать в следующий день">${escapeHtml(entry.review || '')}</textarea>
          </div>
          <div class="field full">
            <label for="jNotes">Заметки о рынке</label>
            <textarea class="input" id="jNotes" rows="2" placeholder="Новости, уровни, волатильность, наблюдения">${escapeHtml(entry.notes || '')}</textarea>
          </div>
        </div>
      </div>
      <div class="table-footer" style="justify-content:space-between">
        <span class="small muted">Запись хранится локально в базе сервиса</span>
        <button class="btn btn-primary" data-save>${icon('check')} Сохранить запись</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3 class="card-title">Сделки дня</h3><p class="card-sub">${dayTrades.length ? `${dayTrades.length} ${plural(dayTrades.length, 'сделка', 'сделки', 'сделок')} · вход, выход и результат` : 'В этот день сделок не было'}</p></div>
        <button class="btn btn-sm" data-add-trade>${icon('plus')} Сделка</button>
      </div>
      <div class="card-body flush">
        ${dayTrades.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>Время</th><th>Тикер</th><th>Сторона</th><th class="num">Кол-во</th><th class="num">Вход → выход</th><th class="num">R</th><th class="num">P&amp;L</th></tr></thead>
          <tbody>${[...dayTrades].sort((a, b) => (a.entry_time || '').localeCompare(b.entry_time || '')).map((t) => `<tr class="clickable" data-trade="${t.id}">
            <td class="nowrap">${fmtTime(t.entry_time)}${t.exit_time ? ` – ${fmtTime(t.exit_time)}` : ''}</td>
            <td><b>${escapeHtml(t.symbol)}</b><div class="sub">${escapeHtml(t.setup || '—')}</div></td>
            <td>${sideBadge(t.side)}</td>
            <td class="num">${numTrim(t.qty)}</td>
            <td class="num">${price(t.entry_price, t.tick_size)}${t.exit_price !== null ? ` → ${price(t.exit_price, t.tick_size)}` : ' → —'}</td>
            <td class="num ${t.r === null ? '' : cls(t.r)}">${t.r === null ? '—' : rmult(t.r)}</td>
            <td class="num ${t.closed ? cls(t.net) : 'muted'}">${t.closed ? signedMoney(t.net, c) : 'открыта'}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="chart-empty">Добавьте сделку, чтобы увидеть её в дневнике дня.</div>'}
      </div>
    </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="card-head">
          <div><h3 class="card-title">Итоги дня</h3><p class="card-sub">${fmtDateShort(day)}</p></div>
        </div>
        <div class="card-body">
          <div class="day-modal-grid" style="grid-template-columns:1fr 1fr">
            <div class="day-stat"><div class="k">P&amp;L</div><div class="v ${cls(dayNet)}">${signedMoney(dayNet, c)}</div></div>
            <div class="day-stat"><div class="k">Сделок</div><div class="v">${dayTrades.length}</div></div>
            <div class="day-stat"><div class="k">Винрейт</div><div class="v">${dayStats.count ? pct(dayStats.winRate) : '—'}</div></div>
            <div class="day-stat"><div class="k">Средний R</div><div class="v">${dayStats.avgR === null ? '—' : rmult(dayStats.avgR)}</div></div>
          </div>
          <p class="small muted" style="margin:10px 0 0">${dayTrades.some((t) => !t.closed) ? `Открытых позиций: ${dayTrades.filter((t) => !t.closed).length}. ` : ''}Сделки можно открыть в таблице слева.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3 class="card-title">Последние записи</h3><p class="card-sub">Дневник трейдера</p></div></div>
        <div class="card-body" style="padding-top:6px">
          ${timeline.length ? `<div class="timeline">${timeline.map((j) => {
            const net = store.accountTrades.filter((t) => t.day === j.date && t.closed).reduce((sum, t) => sum + t.net, 0);
            const em = MOODS.find((m) => m.value === Number(j.mood));
            return `<div class="tl-item" data-jump="${j.date}">
              <div class="tl-date">${fmtDateShort(j.date)}<span>${j.date.slice(0, 4)}</span></div>
              <div class="tl-body">
                <div class="tl-text">${escapeHtml(j.plan || j.review || j.notes || 'Запись без текста')}</div>
                <div class="tl-meta">${em ? `<span>${em.emoji}</span>` : ''}<span class="${net >= 0 ? 'pos' : 'neg'}">${signedMoney(net, c, { compact: true })}</span></div>
              </div>
            </div>`;
          }).join('')}</div>` : '<p class="small muted">Пока нет записей. Начните с плана на сегодня.</p>'}
        </div>
      </div>
    </div>
  </div>`;

  let selectedMood = mood;
  root.querySelectorAll('[data-mood]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = Number(btn.dataset.mood);
      selectedMood = selectedMood === value ? 0 : value;
      root.querySelectorAll('[data-mood]').forEach((b) => b.classList.toggle('active', Number(b.dataset.mood) === selectedMood));
    });
  });

  root.querySelector('[data-prev]').addEventListener('click', () => { location.hash = `#/journal/${shiftDate(day, -1)}`; });
  root.querySelector('[data-next]').addEventListener('click', () => { location.hash = `#/journal/${shiftDate(day, 1)}`; });
  root.querySelector('[data-add-trade]').addEventListener('click', () => openTradeForm(null, { date: day }));
  root.querySelectorAll('[data-trade]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const t = store.trades.find((x) => x.id === Number(tr.dataset.trade));
      if (t) openTradeForm(t);
    });
  });
  root.querySelectorAll('[data-jump]').forEach((item) => {
    item.addEventListener('click', () => { location.hash = `#/journal/${item.dataset.jump}`; });
  });

  async function save() {
    const btn = root.querySelector('[data-save]');
    btn.disabled = true;
    try {
      await api.saveJournal({
        date: day,
        mood: selectedMood || null,
        plan: root.querySelector('#jPlan').value,
        review: root.querySelector('#jReview').value,
        notes: root.querySelector('#jNotes').value,
      });
      toast('Запись сохранена');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }
  root.querySelector('[data-save]').addEventListener('click', save);
  root.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  });
}
