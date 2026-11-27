// Форма сделки: добавление/редактирование, живой расчёт P&L и R.
import { store } from './store.js';
import { api } from './api.js';
import { openModal, confirmDialog, toast, icon } from './components.js';
import { money, num, price, rmult, isoLocal, escapeAttr, escapeHtml, cls } from './format.js';

const DEFAULT_SETUPS = ['Пробой уровня', 'Откат к VWAP', 'Тренд по EMA', 'Ложный пробой', 'Разворот на открытии', 'Сжатие волатильности'];
const DEFAULT_EMOTIONS = ['Спокойствие', 'Уверенность', 'Азарт', 'Страх', 'FOMO', 'Усталость', 'Нейтрально'];
const DEFAULT_MISTAKES = ['Ранний вход', 'Поздний вход', 'Сдвинул стоп', 'Овертрейдинг', 'Не по плану', 'Увеличил размер'];

export function openTradeForm(trade = null, { date = null } = {}) {
  const isEdit = !!trade;
  const account = store.account;
  if (!account) { toast('Сначала создайте счёт в настройках', 'error'); return; }
  if (!store.instruments.length) { toast('Добавьте хотя бы один инструмент', 'error'); return; }

  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(Math.floor(now.getMinutes() / 5) * 5);
  const defaultEntry = date ? `${date}T16:30` : isoLocal(now);
  const formId = `tf${Date.now()}`;
  const suggestions = store.suggestions();
  const setups = [...new Set([...DEFAULT_SETUPS, ...suggestions.setups])];
  const emotions = [...new Set([...DEFAULT_EMOTIONS, ...suggestions.emotions])];
  const mistakes = [...new Set([...DEFAULT_MISTAKES, ...suggestions.mistakes])];

  const groups = new Map();
  for (const i of [...store.instruments].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    const key = i.exchange || 'Другое';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const defaultSymbol = trade?.symbol || (store.instruments.some((i) => i.symbol === 'Si') ? 'Si' : store.instruments[0]?.symbol);
  const options = [...groups.entries()].map(([exchange, list]) => `<optgroup label="${escapeAttr(exchange)}">${list.map((i) => {
    const selected = defaultSymbol === i.symbol;
    return `<option value="${escapeAttr(i.symbol)}" ${selected ? 'selected' : ''}>${escapeHtml(i.symbol)}${i.name ? ` — ${escapeHtml(i.name)}` : ''}</option>`;
  }).join('')}</optgroup>`).join('');

  const side = trade?.side || 'long';
  const rating = Number(trade?.rating) || 0;

  const body = `<form id="${formId}" class="form-grid" novalidate autocomplete="off">
    <div class="form-section">Сделка</div>
    <div class="field">
      <label for="${formId}-symbol">Инструмент <span class="req">*</span></label>
      <select class="input" id="${formId}-symbol" name="symbol">${options}</select>
      <div class="field-hint" id="${formId}-spec"></div>
    </div>
    <div class="field">
      <label>Направление</label>
      <div class="side-toggle" data-side-toggle>
        <button type="button" data-side="long" class="${side === 'long' ? 'active' : ''}">Лонг</button>
        <button type="button" data-side="short" class="${side === 'short' ? 'active' : ''}">Шорт</button>
      </div>
      <input type="hidden" name="side" value="${side}">
    </div>
    <div class="field">
      <label for="${formId}-qty">Количество, контрактов <span class="req">*</span></label>
      <input class="input" id="${formId}-qty" name="qty" type="number" min="0.0001" step="any" value="${trade?.qty ?? 1}" inputmode="decimal">
    </div>
    <div class="field">
      <label for="${formId}-setup">Сетап</label>
      <input class="input" id="${formId}-setup" name="setup" list="${formId}-setups" value="${escapeAttr(trade?.setup || '')}" placeholder="Пробой уровня">
      <datalist id="${formId}-setups">${setups.map((s) => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
    </div>

    <div class="field">
      <label for="${formId}-entry">Цена входа <span class="req">*</span></label>
      <input class="input" id="${formId}-entry" name="entry_price" type="number" step="any" value="${trade?.entry_price ?? ''}" inputmode="decimal" placeholder="0,00">
    </div>
    <div class="field">
      <label for="${formId}-exit">Цена выхода <span class="muted" style="font-weight:500">— пусто, если открыта</span></label>
      <input class="input" id="${formId}-exit" name="exit_price" type="number" step="any" value="${trade?.exit_price ?? ''}" inputmode="decimal" placeholder="0,00">
    </div>
    <div class="field">
      <label for="${formId}-stop">Стоп-лосс</label>
      <input class="input" id="${formId}-stop" name="stop_price" type="number" step="any" value="${trade?.stop_price ?? ''}" inputmode="decimal" placeholder="для расчёта R">
    </div>
    <div class="field">
      <label for="${formId}-target">Тейк-профит</label>
      <input class="input" id="${formId}-target" name="target_price" type="number" step="any" value="${trade?.target_price ?? ''}" inputmode="decimal" placeholder="плановая цель">
    </div>

    <div class="field">
      <label for="${formId}-entry-time">Время входа <span class="req">*</span></label>
      <input class="input" id="${formId}-entry-time" name="entry_time" type="datetime-local" value="${trade?.entry_time?.slice(0, 16) || defaultEntry}">
    </div>
    <div class="field">
      <label for="${formId}-exit-time">Время выхода</label>
      <input class="input" id="${formId}-exit-time" name="exit_time" type="datetime-local" value="${trade?.exit_time?.slice(0, 16) || ''}">
    </div>

    <div class="form-section">Исполнение</div>
    <div class="field">
      <label for="${formId}-fees">Комиссия, всего</label>
      <div class="input-group">
        <input class="input" id="${formId}-fees" name="fees" type="number" step="0.01" min="0" value="${trade?.fees ?? 0}" inputmode="decimal">
        <span class="suffix">₽</span>
      </div>
      <div class="field-hint">За вход и выход; подставляется по тарифу инструмента.</div>
    </div>
    <div class="field">
      <label for="${formId}-funding">Фандинг / своп</label>
      <input class="input" id="${formId}-funding" name="funding" type="number" step="0.01" value="${trade?.funding ?? 0}" inputmode="decimal">
    </div>

    <div class="form-section">Психология</div>
    <div class="field">
      <label for="${formId}-emotion">Состояние</label>
      <select class="input" id="${formId}-emotion" name="emotion">
        <option value="">—</option>
        ${emotions.map((e) => `<option value="${escapeAttr(e)}" ${trade?.emotion === e ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Оценка сделки</label>
      <div class="stars" data-stars role="radiogroup" aria-label="Оценка сделки">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${n <= rating ? 'on' : ''}" data-star="${n}" aria-label="${n} из 5">★</button>`).join('')}
      </div>
      <input type="hidden" name="rating" value="${rating || ''}">
    </div>
    <div class="field full">
      <label for="${formId}-tags">Теги</label>
      <input class="input" id="${formId}-tags" name="tags" value="${escapeAttr(trade?.tags || '')}" placeholder="A+, новости, утро">
    </div>
    <div class="field full">
      <label for="${formId}-mistakes">Ошибки</label>
      <input class="input" id="${formId}-mistakes" name="mistakes" list="${formId}-mistakes-list" value="${escapeAttr(trade?.mistakes || '')}" placeholder="Что следовало сделать иначе">
      <datalist id="${formId}-mistakes-list">${mistakes.map((m) => `<option value="${escapeAttr(m)}"></option>`).join('')}</datalist>
    </div>
    <div class="field full">
      <label for="${formId}-notes">Заметка по сделке</label>
      <textarea class="input" id="${formId}-notes" name="notes" rows="2" placeholder="Почему вошёл, как управлял позицией, что получилось">${escapeHtml(trade?.notes || '')}</textarea>
    </div>
    <div class="field full">
      <label for="${formId}-screenshot">Ссылка на скриншот</label>
      <input class="input" id="${formId}-screenshot" name="screenshot" value="${escapeAttr(trade?.screenshot || '')}" placeholder="https://… (необязательно)">
    </div>

    <div class="preview-box" id="${formId}-preview">
      <div class="preview-item"><div class="k">P&amp;L</div><div class="v" data-pv="pnl">—</div></div>
      <div class="preview-item"><div class="k">R</div><div class="v" data-pv="r">—</div></div>
      <div class="preview-item"><div class="k">Риск</div><div class="v" data-pv="risk">—</div></div>
      <div class="preview-item"><div class="k">Пункты / тики</div><div class="v" data-pv="ticks">—</div></div>
    </div>
    <div class="errors hidden" id="${formId}-errors"></div>
  </form>`;

  const modal = openModal({
    title: isEdit ? `Сделка #${trade.id} · ${trade.symbol}` : 'Новая сделка',
    sub: `Счёт: ${escapeHtml(account.name)} · ${store.currency}. Результат считается автоматически.`,
    body,
    size: 'wide',
    footer: `${isEdit ? `<button type="button" class="btn btn-sm btn-danger" data-del>${icon('trash')} Удалить</button>` : '<span class="small muted">Ctrl + Enter — сохранить</span>'}
      <div class="right">
        <button type="button" class="btn" data-cancel>Отмена</button>
        <button type="submit" class="btn btn-primary" form="${formId}">${isEdit ? 'Сохранить' : 'Добавить сделку'}</button>
      </div>`,
  });

  const form = modal.overlay.querySelector(`#${formId}`);
  const errorsEl = form.querySelector(`#${formId}-errors`);
  const symbolEl = form.querySelector('[name=symbol]');
  const qtyEl = form.querySelector('[name=qty]');
  const feesEl = form.querySelector('[name=fees]');
  const sideEl = form.querySelector('[name=side]');
  const previewEl = form.querySelector(`#${formId}-preview`);
  let feesTouched = isEdit;

  function instrument() {
    return store.instruments.find((i) => i.symbol === symbolEl.value) || null;
  }

  function specHint() {
    const inst = instrument();
    const hint = form.querySelector(`#${formId}-spec`);
    if (!inst) { hint.textContent = 'Инструмент не найден'; return; }
    const tickText = String(Number(inst.tick_size) || 0).replace('.', ',');
    hint.textContent = `${money(inst.point_value, 'RUB')} / пункт · шаг ${tickText} · комиссия ${money(inst.fee || 0, 'RUB', { decimals: 2 })}`;
    for (const el of [form.querySelector('[name=entry_price]'), form.querySelector('[name=exit_price]'), form.querySelector('[name=stop_price]'), form.querySelector('[name=target_price]')]) {
      el.step = inst.tick_size || 'any';
    }
  }

  function applyFeeDefault() {
    if (feesTouched) return;
    const inst = instrument();
    if (!inst) return;
    const qty = Number(qtyEl.value) || 0;
    feesEl.value = (qty * 2 * (Number(inst.fee) || 0)).toFixed(2);
  }

  function read() {
    const val = (name) => {
      const raw = form.querySelector(`[name=${name}]`).value;
      if (raw === '' || raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    return {
      symbol: symbolEl.value,
      side: sideEl.value,
      qty: val('qty'),
      entry: val('entry_price'),
      exit: val('exit_price'),
      stop: val('stop_price'),
      target: val('target_price'),
      fees: val('fees') || 0,
      funding: val('funding') || 0,
      entryTime: form.querySelector('[name=entry_time]').value,
      exitTime: form.querySelector('[name=exit_time]').value,
      rating: val('rating'),
    };
  }

  function updatePreview() {
    const d = read();
    const inst = instrument();
    const pv = Number(inst?.point_value) || Number(trade?.point_value) || 1;
    const tick = Number(inst?.tick_size) || Number(trade?.tick_size) || 0;
    const dir = d.side === 'short' ? -1 : 1;
    const qty = d.qty || 0;
    const pnl = previewEl.querySelector('[data-pv=pnl]');
    const rEl = previewEl.querySelector('[data-pv=r]');
    const riskEl = previewEl.querySelector('[data-pv=risk]');
    const ticksEl = previewEl.querySelector('[data-pv=ticks]');

    let risk = null;
    if (d.entry !== null && d.stop !== null && qty > 0) risk = Math.abs(d.entry - d.stop) * qty * pv;
    riskEl.textContent = risk === null ? '—' : money(risk, store.currency);
    riskEl.className = `v ${risk === null ? '' : ''}`;

    if (d.entry !== null && d.exit !== null && qty > 0) {
      const gross = dir * (d.exit - d.entry) * qty * pv;
      const net = gross - (d.fees || 0) + (d.funding || 0);
      pnl.textContent = `${net > 0 ? '+' : net < 0 ? '−' : ''}${money(Math.abs(net), store.currency, { decimals: 2 })}`;
      pnl.className = `v ${cls(net)}`;
      if (risk && risk > 0) {
        const r = net / risk;
        rEl.textContent = rmult(r);
        rEl.className = `v ${cls(r)}`;
      } else {
        rEl.textContent = '—'; rEl.className = 'v';
      }
      if (tick > 0) {
        const pts = dir * (d.exit - d.entry);
        const ticks = pts / tick;
        ticksEl.textContent = `${num(pts, 2)} / ${num(ticks, 0)}`;
      } else {
        ticksEl.textContent = num(dir * (d.exit - d.entry), 2);
      }
    } else {
      pnl.textContent = d.entry !== null ? 'Открыта' : '—';
      pnl.className = 'v muted';
      rEl.textContent = '—'; rEl.className = 'v';
      ticksEl.textContent = '—';
    }
  }

  function setError(list) {
    if (!list.length) { errorsEl.classList.add('hidden'); errorsEl.innerHTML = ''; return; }
    errorsEl.innerHTML = `<ul>${list.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
    errorsEl.classList.remove('hidden');
    errorsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function validate(d) {
    const errors = [];
    if (!d.symbol) errors.push('Выберите инструмент');
    if (!(d.qty > 0)) errors.push('Количество должно быть больше нуля');
    if (!(d.entry > 0)) errors.push('Укажите цену входа');
    if (!d.entryTime) errors.push('Укажите время входа');
    if (d.exit !== null && !(d.exit > 0)) errors.push('Цена выхода должна быть больше нуля');
    if (d.exit !== null && !d.exitTime) d.exitTime = d.entryTime;
    if (d.exitTime && (!d.entryTime || d.exitTime < d.entryTime)) errors.push('Время выхода не может быть раньше входа');
    if (d.stop !== null && d.stop > 0 && d.entry !== null) {
      const wrongSide = d.side === 'long' ? d.stop >= d.entry : d.stop <= d.entry;
      if (wrongSide) errors.push(d.side === 'long' ? 'Стоп для лонга должен быть ниже входа' : 'Стоп для шорта должен быть выше входа');
    }
    return errors;
  }

  function payload(d) {
    const inst = instrument();
    return {
      account_id: trade?.account_id || account.id,
      symbol: d.symbol,
      side: d.side,
      qty: d.qty,
      entry_price: d.entry,
      exit_price: d.exit,
      entry_time: d.entryTime,
      exit_time: d.exit !== null ? (d.exitTime || d.entryTime) : null,
      fees: d.fees,
      funding: d.funding,
      point_value: Number(inst?.point_value) || Number(trade?.point_value) || 1,
      tick_size: Number(inst?.tick_size) || Number(trade?.tick_size) || null,
      stop_price: d.stop,
      target_price: d.target,
      setup: form.querySelector('[name=setup]').value.trim(),
      tags: form.querySelector('[name=tags]').value.trim(),
      mistakes: form.querySelector('[name=mistakes]').value.trim(),
      emotion: form.querySelector('[name=emotion]').value,
      rating: d.rating ? Math.round(d.rating) : null,
      notes: form.querySelector('[name=notes]').value.trim(),
      screenshot: form.querySelector('[name=screenshot]').value.trim(),
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = read();
    const errors = validate(d);
    setError(errors);
    if (errors.length) return;
    const submitBtn = modal.overlay.querySelector(`[form="${formId}"]`);
    submitBtn.disabled = true;
    try {
      const data = payload(d);
      if (isEdit) await api.update('trades', trade.id, data);
      else await api.create('trades', data);
      modal.close();
      toast(isEdit ? 'Сделка обновлена' : 'Сделка добавлена', 'success');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) {
      setError([err.message]);
      toast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  form.querySelectorAll('[data-side]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sideEl.value = btn.dataset.side;
      form.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('active', b === btn));
      updatePreview();
    });
  });

  form.querySelectorAll('[data-star]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = Number(btn.dataset.star);
      const hidden = form.querySelector('[name=rating]');
      const next = Number(hidden.value) === value ? 0 : value;
      hidden.value = next || '';
      form.querySelectorAll('[data-star]').forEach((b) => b.classList.toggle('on', Number(b.dataset.star) <= next));
    });
  });

  symbolEl.addEventListener('change', () => { specHint(); applyFeeDefault(); updatePreview(); });
  qtyEl.addEventListener('input', () => { applyFeeDefault(); updatePreview(); });
  feesEl.addEventListener('input', () => { feesTouched = true; updatePreview(); });
  form.querySelectorAll('input, select, textarea').forEach((el) => {
    el.addEventListener('input', updatePreview);
  });

  form.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  modal.overlay.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
  const delBtn = modal.overlay.querySelector('[data-del]');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Удалить сделку?',
        text: `Сделка ${trade.symbol} от ${trade.entry_time.slice(0, 10)} будет удалена без возможности восстановления.`,
        confirmText: 'Удалить сделку',
      });
      if (!ok) return;
      try {
        await api.remove('trades', trade.id);
        modal.close();
        toast('Сделка удалена', 'success');
        window.dispatchEvent(new Event('data:changed'));
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  specHint();
  updatePreview();
}
