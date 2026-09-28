/*
  utils.js — small shared helpers used across every module.
  No dependencies. Keep this file boring and reliable.
*/

/**
 * Format a number as South African Rand. Abbreviates large numbers (R1.2M).
 * Negatives render as −R1 200 rather than R-1 200 — the sign belongs in front
 * of the amount, not wedged between the currency symbol and the digits.
 */
export function formatCurrency(value, { abbreviate = false } = {}) {
  const raw = Number(value) || 0;
  if (raw < 0) return '−' + formatCurrency(Math.abs(raw), { abbreviate });
  const n = raw;
  if (abbreviate && Math.abs(n) >= 1000000) {
    return 'R' + (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  }
  if (abbreviate && Math.abs(n) >= 100000) {
    return 'R' + Math.round(n / 1000) + 'K';
  }
  // Low-value unit prices (bricks at R3.80, etc.) need their cents — rounding
  // them to whole rands hides real price movement on high-volume materials.
  if (Math.abs(n) < 100 && !Number.isInteger(n)) {
    return 'R' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const rounded = Math.round(n);
  return 'R' + rounded.toLocaleString('en-ZA');
}

/** Format a number with thousands separators, no currency symbol. */
export function formatNumber(value, decimals = 0) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-ZA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatDate(dateLike, opts = {}) {
  const d = (dateLike instanceof Date) ? dateLike : new Date(dateLike);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', ...opts });
}

export function formatDateTime(dateLike) {
  const d = (dateLike instanceof Date) ? dateLike : new Date(dateLike);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(dateLike) {
  const d = (dateLike instanceof Date) ? dateLike : new Date(dateLike);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
  return Math.floor(secs / 86400) + 'd ago';
}

let uidCounter = 0;
/** Generate a reasonably unique id for demo records (not for production auth). */
export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

/** Show a small toast confirmation message. type: 'success' | 'error' | 'warn' | '' */
export function toast(message, type = '', duration = 3000) {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  const icon = { success: '✓', error: '✕', warn: '!' }[type];
  if (icon) {
    const ico = document.createElement('span');
    ico.setAttribute('aria-hidden', 'true');
    ico.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,.22);font-size:12px;font-weight:800;flex-shrink:0;';
    ico.textContent = icon;
    el.appendChild(ico);
  }
  el.appendChild(document.createTextNode(message));
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/** Open the generic bottom-sheet modal with the given inner HTML. Returns the modal card element. */
export function openModal(innerHtml) {
  const host = document.getElementById('modalHost');
  const card = document.getElementById('modalCard');
  card.innerHTML = innerHtml;
  card.scrollTop = 0;
  host.classList.remove('hidden');
  // The bottom nav slides away while a sheet is open so it can never sit on
  // top of the sheet's last field or button.
  document.body.classList.add('modal-open');
  document.getElementById('modalBackdrop').onclick = closeModal;
  document.addEventListener('keydown', escToClose);
  return card;
}

function escToClose(e) { if (e.key === 'Escape') closeModal(); }

export function closeModal() {
  const host = document.getElementById('modalHost');
  host.classList.add('hidden');
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', escToClose);
  document.getElementById('modalCard').innerHTML = '';
}

/** Simple confirmation dialog replacing native confirm() with the app's own styling. */
export function confirmAction(message, { okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const card = openModal(`
      <h3>${escapeHtml(message)}</h3>
      <div class="btn-block-row mt-4">
        <button class="btn btn-ghost" id="cancelBtn">${escapeHtml(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="okBtn">${escapeHtml(okLabel)}</button>
      </div>
    `);
    card.querySelector('#okBtn').onclick = () => { closeModal(); resolve(true); };
    card.querySelector('#cancelBtn').onclick = () => { closeModal(); resolve(false); };
  });
}

export function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/** Percentage variance of `value` above `base`, e.g. base=95, value=112 -> 17.9 */
export function pctAbove(value, base) {
  if (!base) return 0;
  return round2(((value - base) / base) * 100);
}
