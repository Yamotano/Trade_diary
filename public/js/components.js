import { escapeHtml, escapeAttr } from './format.js';

export function icon(name, cls = 'icon') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function toast(message, type = 'success') {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${escapeHtml(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, 3400);
}

// ---- модальные окна ----
let openModals = 0;
let prevOverflow = '';

export function openModal({ title, sub = '', body = '', footer = '', size = '', onMount, onClose } = {}) {
  const root = document.getElementById('modalRoot');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${escapeAttr(String(title).replace(/<[^>]+>/g, ''))}">
    <div class="modal-head">
      <div><h2 class="modal-title">${title}</h2>${sub ? `<p class="modal-sub">${sub}</p>` : ''}</div>
      <button type="button" class="btn btn-icon btn-sm" data-close aria-label="Закрыть">${icon('close')}</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  root.appendChild(overlay);
  if (!openModals) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openModals++;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    openModals = Math.max(0, openModals - 1);
    if (!openModals) document.body.style.overflow = prevOverflow;
    if (onClose) onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const modal = overlay.querySelector('.modal');
  const bodyEl = overlay.querySelector('.modal-body');
  if (onMount) onMount({ overlay, modal, bodyEl, close });
  setTimeout(() => {
    const first = overlay.querySelector('input:not([type=hidden]), select, textarea');
    if (first) first.focus({ preventScroll: true });
  }, 40);
  return { overlay, modal, bodyEl, close };
}

export function confirmDialog({
  title = 'Подтвердите действие', text = '', confirmText = 'Удалить', cancelText = 'Отмена', danger = true,
} = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      body: `<p style="margin:0;font-size:13px;color:var(--text-2);line-height:1.55">${text}</p>`,
      size: 'slim',
      footer: `<button type="button" class="btn" data-cancel>${escapeHtml(cancelText)}</button>
        <div class="right"><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${escapeHtml(confirmText)}</button></div>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.overlay.querySelector('[data-cancel]').addEventListener('click', () => { done = true; m.close(); resolve(false); });
    m.overlay.querySelector('[data-ok]').addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}

export function emptyState({ iconName = 'trades', title = 'Пока пусто', text = '', action = '' } = {}) {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName)}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    ${text ? `<div class="empty-text">${escapeHtml(text)}</div>` : ''}
    ${action}
  </div>`;
}

export const sideBadge = (side) => `<span class="badge ${side === 'long' ? 'badge-long' : 'badge-short'}">${side === 'long' ? 'Лонг' : 'Шорт'}</span>`;

export function starsMini(rating) {
  const n = Math.max(0, Math.min(5, Number(rating) || 0));
  if (!n) return '';
  return `<span class="stars-mini" title="Оценка ${n} из 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

export function pagination(page, pages) {
  if (pages <= 1) return '';
  const nums = [];
  const push = (n) => { if (!nums.includes(n)) nums.push(n); };
  push(1);
  for (let i = page - 1; i <= page + 1; i++) if (i > 1 && i < pages) push(i);
  push(pages);
  nums.sort((a, b) => a - b);
  let out = `<button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Назад">${icon('chevron-left', 'icon')}</button>`;
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) out += '<span class="muted" style="padding:0 2px">…</span>';
    out += `<button class="page-btn ${n === page ? 'active' : ''}" data-page="${n}">${n}</button>`;
    prev = n;
  }
  out += `<button class="page-btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Вперёд">${icon('chevron-right', 'icon')}</button>`;
  return out;
}

export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result;
      let text = new TextDecoder('utf-8').decode(buffer);
      if (text.includes('\uFFFD')) {
        try { text = new TextDecoder('windows-1251').decode(buffer); } catch { /* оставить utf-8 */ }
      }
      resolve(String(text || '').replace(/^\uFEFF/, ''));
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsArrayBuffer(file);
  });
}

export function filePicker(accept, onFile) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      onFile(file);
      resolve(file);
    });
    input.click();
  });
}

export function bindPagination(root, onPage) {
  root.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (page > 0 && !btn.disabled) onPage(page);
    });
  });
}
