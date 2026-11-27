// Лёгкие SVG-графики без внешних библиотек.
import { money, num, fmtDateShort, fmtDateTime, fmtTime, escapeHtml } from './format.js';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

export function sparkline(values, { width = 78, height = 34, color = 'var(--green)' } = {}) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => (i / (values.length - 1)) * width;
  const y = (v) => height - 3 - ((v - min) / span) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" preserveAspectRatio="none">
    <path d="${area}" fill="${color}" opacity=".10"></path>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>
  </svg>`;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const err = raw / pow;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  return mult * pow;
}

export function equityChart(el, points, { currency = 'USD', height = 292 } = {}) {
  el.innerHTML = '';
  const clean = (points || []).filter((p) => p && p.balance !== null && !Number.isNaN(Number(p.balance)));
  if (!clean.length) {
    el.innerHTML = '<div class="chart-empty">Нет закрытых сделок за выбранный период</div>';
    return;
  }
  const W = Math.max(300, Math.floor(el.clientWidth || 640));
  const H = height;
  const pad = { l: 56, r: 14, t: 14, b: 26 };
  const plotW = Math.max(20, W - pad.l - pad.r);
  const plotH = H - pad.t - pad.b;
  const values = clean.map((p) => Number(p.balance));
  let min = Math.min(...values), max = Math.max(...values);
  if (max - min < 1e-9) {
    const d = Math.max(80, Math.abs(max) * 0.03);
    min -= d; max += d;
  }
  const span = max - min;
  min -= span * 0.09; max += span * 0.06;

  const X = (i) => (clean.length === 1 ? pad.l + plotW / 2 : pad.l + (i / (clean.length - 1)) * plotW);
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * plotH;
  const zeroY = Math.max(pad.t, Math.min(pad.t + plotH, Y(clean[0].balance)));

  const ticks = [];
  const step = niceStep((max - min) / 4);
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);

  const green = 'var(--green)';
  const gradId = nextId('eq');
  let path = '';
  clean.forEach((p, i) => { path += `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.balance).toFixed(1)} `; });
  const area = `${path} L${X(clean.length - 1).toFixed(1)},${pad.t + plotH} L${pad.l},${pad.t + plotH} Z`;

  const xCount = Math.max(2, Math.min(6, Math.floor(plotW / 95)));
  const xTicks = [];
  const lastLabel = new Set();
  for (let i = 0; i < xCount; i++) {
    const idx = Math.round((i / (xCount - 1)) * (clean.length - 1));
    const label = fmtDateShort(clean[idx].time);
    if (lastLabel.has(label)) continue;
    lastLabel.add(label);
    xTicks.push({ x: X(idx), label });
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Кривая капитала">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${green}" stop-opacity=".22"></stop>
        <stop offset="100%" stop-color="${green}" stop-opacity="0"></stop>
      </linearGradient>
    </defs>
    ${ticks.map((v) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"></line>
      <text class="axis-text" x="${pad.l - 8}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${escapeHtml(money(v, currency, { compact: true }))}</text>`).join('')}
    <line class="zero-line" x1="${pad.l}" x2="${W - pad.r}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke-dasharray="3 4" opacity=".8"></line>
    <path d="${area}" fill="url(#${gradId})"></path>
    <path d="${path}" fill="none" stroke="${green}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
    ${xTicks.map((t) => `<text class="axis-text" x="${t.x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${escapeHtml(t.label)}</text>`).join('')}
    <line class="hover-line" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + plotH}" stroke="var(--line-strong)" stroke-width="1" opacity="0" pointer-events="none"></line>
    <circle class="hover-dot" cx="0" cy="0" r="4" fill="${green}" stroke="var(--surface)" stroke-width="2" opacity="0" pointer-events="none"></circle>
    <rect class="hover-rect" x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair"></rect>
  </svg>`;

  el.innerHTML = svg;
  const svgEl = el.querySelector('svg');
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  el.appendChild(tip);
  const hoverLine = svgEl.querySelector('.hover-line');
  const hoverDot = svgEl.querySelector('.hover-dot');
  const rect = svgEl.querySelector('.hover-rect');

  function hide() {
    tip.classList.remove('show');
    hoverLine.setAttribute('opacity', '0');
    hoverDot.setAttribute('opacity', '0');
  }

  function move(ev) {
    const box = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    let idx = 0;
    if (clean.length > 1) idx = Math.round(((px - pad.l) / plotW) * (clean.length - 1));
    idx = Math.max(0, Math.min(clean.length - 1, idx));
    const p = clean[idx];
    if (!p) return;
    const cx = X(idx), cy = Y(p.balance);
    hoverLine.setAttribute('x1', cx); hoverLine.setAttribute('x2', cx);
    hoverLine.setAttribute('opacity', '1');
    hoverDot.setAttribute('cx', cx); hoverDot.setAttribute('cy', cy);
    hoverDot.setAttribute('opacity', '1');

    const when = String(p.time || '').includes('T') && !String(p.time).endsWith('T00:00')
      ? fmtDateTime(p.time)
      : fmtDateShort(p.time);
    const pnl = Number(p.pnl) || 0;
    const ddPct = Number(p.ddPct) || 0;
    const extra = p.kind === 'cash'
      ? `<div class="t-muted">${Number(p.amount) >= 0 ? 'Пополнение' : 'Вывод'}: <b>${escapeHtml(money(p.amount, currency))}</b></div>`
      : p.trade ? `<div class="t-muted">${escapeHtml(p.trade.symbol)} · ${p.trade.side === 'long' ? 'лонг' : 'шорт'} · <b class="${p.trade.net >= 0 ? 'pos' : 'neg'}">${escapeHtml(money(p.trade.net, currency))}</b></div>` : '';
    tip.innerHTML = `<div class="t-muted">${escapeHtml(when)}</div>
      <div><b>${escapeHtml(money(p.balance, currency))}</b></div>
      <div class="t-muted">Период: <span class="${pnl >= 0 ? 'pos' : 'neg'}">${pnl >= 0 ? '+' : '−'}${escapeHtml(money(Math.abs(pnl), currency))}</span></div>
      ${ddPct > 0.0001 ? `<div class="t-muted">Просадка: ${(ddPct * 100).toFixed(1).replace('.', ',')}%</div>` : ''}
      ${extra}`;

    const leftPx = (cx / W) * box.width;
    const topPx = (cy / H) * box.height;
    const elBox = el.getBoundingClientRect();
    const originX = box.left - elBox.left;
    const originY = box.top - elBox.top;
    const tipW = 158;
    const left = Math.max(4, Math.min(elBox.width - tipW - 4, originX + leftPx + 12));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(4, originY + topPx - 46)}px`;
    tip.classList.add('show');
  }

  rect.addEventListener('mousemove', move);
  rect.addEventListener('mouseleave', hide);
}

export function drawdownChart(el, points, { height = 56 } = {}) {
  el.innerHTML = '';
  const clean = (points || []).filter((p) => p && Number.isFinite(Number(p.ddPct)));
  if (!clean.length) return;
  const W = Math.max(300, Math.floor(el.clientWidth || 640));
  const H = height;
  const maxDd = Math.max(0.0001, ...clean.map((p) => Number(p.ddPct) || 0));
  const pad = { l: 56, r: 14, t: 6, b: 4 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const X = (i) => pad.l + (i / Math.max(1, clean.length - 1)) * plotW;
  const Y = (v) => pad.t + (v / maxDd) * plotH;
  let path = '';
  clean.forEach((p, i) => { path += `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(Number(p.ddPct) || 0).toFixed(1)} `; });
  const area = `${path} L${X(clean.length - 1).toFixed(1)},${pad.t} L${pad.l},${pad.t} Z`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="Просадка">
    <path d="${area}" fill="var(--red)" opacity=".13"></path>
    <path d="${path}" fill="none" stroke="var(--red)" stroke-width="1.3" opacity=".8"></path>
    <text class="axis-text" x="${pad.l - 8}" y="${pad.t + 8}" text-anchor="end" fill="var(--red)">−${(maxDd * 100).toFixed(1).replace('.', ',')}%</text>
    <text class="axis-text" x="${pad.l - 8}" y="${H - 3}" text-anchor="end">0%</text>
  </svg>`;
}

export function columnChart(el, items, { height = 168, currency = 'USD', formatter = null, showValues = true } = {}) {
  el.innerHTML = '';
  if (!items || !items.length) {
    el.innerHTML = '<div class="chart-empty">Нет данных</div>';
    return;
  }
  const W = Math.max(280, Math.floor(el.clientWidth || 560));
  const H = height;
  const pad = { l: 8, r: 8, t: 18, b: 24 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const vals = items.map((i) => Number(i.value) || 0);
  const maxV = Math.max(0, ...vals), minV = Math.min(0, ...vals);
  const span = maxV - minV || 1;
  const Y = (v) => pad.t + (1 - (v - minV) / span) * plotH;
  const zeroY = Y(0);
  const slot = plotW / items.length;
  const barW = Math.min(34, slot * 0.56);
  const fmt = formatter || ((v) => money(v, currency, { compact: true }));

  const bars = items.map((item, i) => {
    const v = Number(item.value) || 0;
    const cx = pad.l + slot * (i + 0.5);
    const y = Math.min(Y(v), zeroY);
    const h = Math.max(2, Math.abs(Y(v) - zeroY));
    const color = v >= 0 ? 'var(--green)' : 'var(--red)';
    const label = showValues && items.length <= 9 ? `<text class="axis-text" x="${cx}" y="${(y - 5).toFixed(1)}" text-anchor="middle" fill="${color}">${escapeHtml(fmt(v))}</text>` : '';
    return `<g><title>${escapeHtml(item.label)}: ${escapeHtml(fmt(v))}</title>
      <rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="3" fill="${color}" opacity="${v === 0 ? 0.25 : 0.85}"></rect>
      ${label}
      <text class="axis-text" x="${cx}" y="${H - 6}" text-anchor="middle">${escapeHtml(item.label)}</text></g>`;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
    <line class="zero-line" x1="${pad.l}" x2="${W - pad.r}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"></line>
    ${bars}
  </svg>`;
}

export function histogram(el, bins, { height = 170, currency = 'USD' } = {}) {
  el.innerHTML = '';
  if (!bins || !bins.length) {
    el.innerHTML = '<div class="chart-empty">Нет R-мультипликаторов</div>';
    return;
  }
  const W = Math.max(280, Math.floor(el.clientWidth || 520));
  const H = height;
  const pad = { l: 8, r: 8, t: 20, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const slot = plotW / bins.length;
  const barW = Math.min(30, slot * 0.62);
  const bars = bins.map((b, i) => {
    const cx = pad.l + slot * (i + 0.5);
    const h = (b.count / maxC) * plotH;
    const color = b.from < 0 ? 'var(--red)' : 'var(--green)';
    const mid = (b.from + b.to) / 2;
    const labelVal = Math.abs(b.from % 1) < 1e-9 ? b.from : mid;
    const labelText = (Number.isInteger(labelVal) ? String(labelVal) : labelVal.toFixed(1).replace('.', ',')).replace('-', '−');
    const label = i % 2 === 0 ? `<text class="axis-text" x="${cx}" y="${H - 7}" text-anchor="middle">${labelText}</text>` : '';
    return `<g><title>${escapeHtml(`${b.from.toFixed(1)} … ${b.to.toFixed(1)}R — ${b.count} ${b.count === 1 ? 'сделка' : 'сделок'}`)}</title>
      <rect x="${(cx - barW / 2).toFixed(1)}" y="${(pad.t + plotH - h).toFixed(1)}" width="${barW}" height="${Math.max(b.count ? 2 : 0, h).toFixed(1)}" rx="3" fill="${color}" opacity="${b.count ? 0.85 : 0.18}"></rect>
      ${b.count ? `<text class="axis-text" x="${cx}" y="${(pad.t + plotH - h - 5).toFixed(1)}" text-anchor="middle">${b.count}</text>` : ''}
      ${label}</g>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
    <line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + plotH}" y2="${pad.t + plotH}"></line>
    ${bars}
  </svg>`;
}

export function donut(el, segments, { size = 118, thickness = 13, centerTop = '', centerBottom = '' } = {}) {
  el.innerHTML = '';
  const total = segments.reduce((s, x) => s + (Number(x.value) || 0), 0);
  if (!total) {
    el.innerHTML = '<div class="chart-empty">Нет данных</div>';
    return;
  }
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const circles = segments.map((s) => {
    const frac = (Number(s.value) || 0) / total;
    const dash = `${(frac * c).toFixed(2)} ${(c - frac * c).toFixed(2)}`;
    const circle = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset * c).toFixed(2)}"></circle>`;
    offset += frac;
    return circle;
  }).join('');
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">
    <g transform="rotate(-90 ${size / 2} ${size / 2})">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${thickness}"></circle>
      ${circles}
    </g>
    <text x="${size / 2}" y="${size / 2 - 2}" text-anchor="middle" font-size="17" font-weight="700" fill="var(--text)">${escapeHtml(centerTop)}</text>
    <text x="${size / 2}" y="${size / 2 + 14}" text-anchor="middle" font-size="9.5" fill="var(--muted)">${escapeHtml(centerBottom)}</text>
  </svg>`;
}
