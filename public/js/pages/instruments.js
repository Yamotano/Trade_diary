import { store } from '../store.js';
import { api } from '../api.js';
import { DEFAULT_INSTRUMENTS } from '../cloud.js';
import {
  money, num, numTrim, escapeHtml, escapeAttr, plural,
} from '../format.js';
import { icon, toast, openModal, confirmDialog, emptyState } from '../components.js';

const PRESETS = DEFAULT_INSTRUMENTS.map((i) => [i.symbol, i.name, i.exchange, i.type, i.point_value, i.tick_size, i.margin, i.fee]);

function usageCount(symbol) {
  return store.trades.filter((t) => t.symbol === symbol).length;
}

function openInstrumentForm(inst = null) {
  const isEdit = !!inst;
  const formId = `if${Date.now()}`;
  const body = `<form id="${formId}" class="form-grid" novalidate>
    <div class="field full">
      <label for="${formId}-preset">Заполнить из шаблона</label>
      <select class="input" id="${formId}-preset">
        <option value="">— выбрать инструмент —</option>
        ${PRESETS.map((p, i) => `<option value="${i}">${p[0]} — ${escapeHtml(p[1])} (${p[2]})</option>`).join('')}
      </select>
      <div class="field-hint">Можно изменить любые значения после подстановки.</div>
    </div>
    <div class="field"><label for="${formId}-symbol">Тикер <span class="req">*</span></label><input class="input" id="${formId}-symbol" name="symbol" value="${escapeAttr(inst?.symbol || '')}" placeholder="Si" maxlength="16"></div>
    <div class="field"><label for="${formId}-name">Название</label><input class="input" id="${formId}-name" name="name" value="${escapeAttr(inst?.name || '')}" placeholder="Фьючерс на доллар США"></div>
    <div class="field"><label>Биржа</label><input class="input" value="MOEX" readonly></div>
    <div class="field"><label>Тип</label><input class="input" value="Фьючерс" readonly></div>
    <div class="field"><label for="${formId}-pv">Стоимость пункта <span class="req">*</span></label><input class="input" id="${formId}-pv" name="point_value" type="number" step="any" min="0.000001" value="${inst?.point_value ?? ''}" placeholder="5"></div>
    <div class="field"><label for="${formId}-tick">Шаг цены (тик)</label><input class="input" id="${formId}-tick" name="tick_size" type="number" step="any" min="0" value="${inst?.tick_size ?? ''}" placeholder="0.25"></div>
    <div class="field"><label for="${formId}-margin">Гарантийное обеспечение</label><input class="input" id="${formId}-margin" name="margin" type="number" step="any" min="0" value="${inst?.margin ?? ''}" placeholder="1500"></div>
    <div class="field"><label for="${formId}-fee">Комиссия за контракт, в одну сторону</label><input class="input" id="${formId}-fee" name="fee" type="number" step="0.01" min="0" value="${inst?.fee ?? 0}" placeholder="0.8"></div>
    <div class="errors hidden" data-errors></div>
  </form>`;

  const m = openModal({
    title: isEdit ? `Инструмент ${inst.symbol}` : 'Новый инструмент',
    sub: 'Спецификация используется при расчёте P&L и в новых сделках. В старых сделках сохраняется снимок.',
    body,
    footer: `<button type="button" class="btn" data-cancel>Отмена</button>
      <div class="right"><button type="submit" class="btn btn-primary" form="${formId}">${isEdit ? 'Сохранить' : 'Добавить'}</button></div>`,
  });
  const form = m.overlay.querySelector(`#${formId}`);
  const errorsEl = form.querySelector('[data-errors]');

  m.overlay.querySelector(`#${formId}-preset`).addEventListener('change', (e) => {
    const p = PRESETS[Number(e.target.value)];
    if (!p) return;
    form.querySelector('[name=symbol]').value = p[0];
    form.querySelector('[name=name]').value = p[1];
    form.querySelector('[name=point_value]').value = p[4];
    form.querySelector('[name=tick_size]').value = p[5];
    form.querySelector('[name=margin]').value = p[6] ?? '';
    form.querySelector('[name=fee]').value = p[7] ?? 0;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const get = (n) => form.querySelector(`[name=${n}]`).value.trim();
    const numOrNull = (n) => (get(n) === '' ? null : Number(get(n)));
    const errors = [];
    const symbol = get('symbol').toUpperCase();
    if (!/^[A-Z0-9._-]{1,16}$/.test(symbol)) errors.push('Тикер: латиница, цифры, точка, дефис — до 16 символов');
    const pv = numOrNull('point_value');
    if (!(pv > 0)) errors.push('Стоимость пункта должна быть больше нуля');
    const tick = numOrNull('tick_size');
    if (tick !== null && !(tick > 0)) errors.push('Шаг цены должен быть больше нуля');
    if (errors.length) {
      errorsEl.innerHTML = `<ul>${errors.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
      errorsEl.classList.remove('hidden');
      return;
    }
    const payload = {
      symbol,
      name: get('name'),
      exchange: 'MOEX',
      type: 'future',
      point_value: pv,
      tick_size: tick,
      margin: numOrNull('margin'),
      fee: numOrNull('fee') ?? 0,
    };
    try {
      if (isEdit) await api.update('instruments', inst.id, payload);
      else await api.create('instruments', payload);
      m.close();
      toast(isEdit ? 'Инструмент обновлён' : 'Инструмент добавлен');
      window.dispatchEvent(new Event('data:changed'));
    } catch (err) {
      errorsEl.innerHTML = `<ul><li>${escapeHtml(err.message)}</li></ul>`;
      errorsEl.classList.remove('hidden');
    }
  });
  m.overlay.querySelector('[data-cancel]').addEventListener('click', m.close);
}

async function removeInstrument(inst) {
  const used = usageCount(inst.symbol);
  const ok = await confirmDialog({
    title: `Удалить ${inst.symbol}?`,
    text: used
      ? `Инструмент используется в ${used} ${plural(used, 'сделке', 'сделках', 'сделках')}. Сделки останутся, потому что спецификация сохранена в каждой из них.`
      : 'Инструмент будет удалён из справочника.',
    confirmText: 'Удалить',
  });
  if (!ok) return;
  try {
    await api.remove('instruments', inst.id);
    toast('Инструмент удалён');
    window.dispatchEvent(new Event('data:changed'));
  } catch (err) { toast(err.message, 'error'); }
}

export function render(root) {
  const instruments = [...store.instruments].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const c = 'RUB';
  root.innerHTML = `<div class="card">
    <div class="card-head">
      <div><h3 class="card-title">Справочник инструментов</h3><p class="card-sub">${instruments.length} ${plural(instruments.length, 'инструмент', 'инструмента', 'инструментов')} · стоимость пункта и комиссии</p></div>
      <div class="card-actions"><button class="btn btn-primary btn-sm" data-add>${icon('plus')} Добавить</button></div>
    </div>
    <div class="card-body flush">
      ${instruments.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Тикер</th><th>Название</th><th>Биржа</th><th>Тип</th><th class="num">Пункт</th><th class="num">Тик</th><th class="num">ГО</th><th class="num">Комиссия</th><th class="num">Сделок</th><th></th></tr></thead>
        <tbody>${instruments.map((i) => `<tr>
          <td><span class="sym">${escapeHtml(i.symbol)}</span></td>
          <td class="muted">${escapeHtml(i.name || '—')}</td>
          <td class="muted">${escapeHtml(i.exchange || '—')}</td>
          <td><span class="tag">${i.type === 'perp' ? 'перпетуал' : i.type === 'stock' ? 'акция' : 'фьючерс'}</span></td>
          <td class="num">${money(i.point_value, c, { decimals: Number.isInteger(Number(i.point_value)) ? 0 : 2 })}</td>
          <td class="num">${numTrim(i.tick_size)}</td>
          <td class="num">${i.margin ? money(i.margin, c) : '—'}</td>
          <td class="num">${money(i.fee || 0, c, { decimals: 2 })}</td>
          <td class="num muted">${usageCount(i.symbol)}</td>
          <td class="num nowrap">
            <button class="btn btn-icon btn-sm" data-edit="${i.id}" title="Редактировать">${icon('edit')}</button>
            <button class="btn btn-icon btn-sm" data-del="${i.id}" title="Удалить">${icon('trash')}</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>` : emptyState({ iconName: 'layers', title: 'Справочник пуст', text: 'Добавьте фьючерс или перпетуал, чтобы вносить сделки.', action: '<button class="btn btn-primary" data-add>Добавить инструмент</button>' })}
    </div>
  </div>
  <p class="small muted" style="margin:10px 2px 0">Спецификации MOEX на 27.11.2026: шаг цены, стоимость шага и ГО с ISS MOEX. В колонке «Комиссия» — биржевой сбор за контракт в одну сторону; брокерскую комиссию добавьте вручную. При вводе сделки комиссия умножается на количество и на два (вход и выход).</p>`;

  root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openInstrumentForm()));
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const inst = store.instruments.find((x) => x.id === Number(b.dataset.edit));
    if (inst) openInstrumentForm(inst);
  }));
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const inst = store.instruments.find((x) => x.id === Number(b.dataset.del));
    if (inst) removeInstrument(inst);
  }));
}
