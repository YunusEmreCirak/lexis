// Small DOM + text helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);

// h('div', {class: 'x', onclick: fn}, child, ...) — children may be strings, nodes, arrays, null.
// Strings are always inserted as text; pass {html: '...'} only for markup we built ourselves.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') continue; // set after children (select/textarea need their content first)
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  if (attrs && attrs.value != null) el.value = attrs.value;
  return el;
}
// Replace root's content; skips null/false like h() does (replaceChildren would print "null").
export function mount(root, ...children) {
  root.replaceChildren();
  append(root, children);
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function uid(prefix = 'n') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- dates ----------
const DAY = 86400000;
export { DAY };

// A "study day" starts at dayStart o'clock (default 04:00), like Anki.
export function dayKey(ts, dayStart = 4) {
  const d = new Date(ts - dayStart * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function nextDayStart(ts, dayStart = 4) {
  const d = new Date(ts - dayStart * 3600000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + DAY + dayStart * 3600000;
}
export function fmtIvl(ms) {
  const m = ms / 60000;
  if (m < 1) return '<1dk';
  if (m < 60) return `${Math.round(m)}dk`;
  const hr = m / 60;
  if (hr < 24) return `${Math.round(hr)}sa`;
  const d = hr / 24;
  if (d < 30) return `${Math.round(d)}g`;
  if (d < 365) return `${(d / 30).toFixed(d < 60 ? 1 : 0)}ay`;
  return `${(d / 365).toFixed(1)}y`;
}
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

// ---------- answer checking ----------
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 'ok' | 'close' | 'bad'
export function grade(input, expected, alts = []) {
  const a = norm(input);
  if (!a) return 'bad';
  const targets = [expected, ...alts].map(norm).filter(Boolean);
  if (targets.includes(a)) return 'ok';
  const e = norm(expected);
  const tol = e.length <= 4 ? 0 : e.length <= 8 ? 1 : 2;
  if (levenshtein(a, e) <= tol) return 'close';
  return 'bad';
}

// LCS diff → HTML with <del> (missing/wrong in user's answer) and <ins> (what was expected).
export function diffHTML(input, expected, byWord = false) {
  const A = byWord ? String(input).trim().split(/\s+/) : [...String(input).trim()];
  const B = byWord ? String(expected).trim().split(/\s+/) : [...String(expected).trim()];
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  const eq = (x, y) => (byWord ? norm(x) === norm(y) : x.toLowerCase() === y.toLowerCase());
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = eq(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, out = '';
  const sep = byWord ? ' ' : '';
  while (i < n && j < m) {
    if (eq(A[i], B[j])) { out += esc(B[j]) + sep; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out += `<del>${esc(A[i])}</del>${sep}`; i++; }
    else { out += `<ins>${esc(B[j])}</ins>${sep}`; j++; }
  }
  while (i < n) out += `<del>${esc(A[i++])}</del>${sep}`;
  while (j < m) out += `<ins>${esc(B[j++])}</ins>${sep}`;
  return out.trim();
}

// ---------- cloze / highlighting ----------
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Governments must {{mitigate}} the effects" → {before, answer, after}
export function parseCloze(s) {
  const m = /^(.*?)\{\{(.+?)\}\}(.*)$/s.exec(s || '');
  return m ? { before: m[1], answer: m[2], after: m[3] } : null;
}

// Find the term (or an inflected form of a single word) inside a sentence.
export function findTerm(sentence, term) {
  if (!sentence || !term) return null;
  const t = term.trim();
  let m = new RegExp(`\\b${reEsc(t)}\\b`, 'i').exec(sentence);
  if (!m && !/\s/.test(t) && t.length > 4) {
    const stem = t.replace(/(e|y|s)$/i, '');
    m = new RegExp(`\\b${reEsc(stem)}[a-z]{0,4}\\b`, 'i').exec(sentence);
  }
  if (!m) return null;
  return { before: sentence.slice(0, m.index), answer: m[0], after: sentence.slice(m.index + m[0].length) };
}

// Escaped sentence with the term marked. Handles {{cloze}} markers too.
export function markTerm(sentence, term) {
  const c = parseCloze(sentence) || findTerm(sentence, term);
  if (!c) return esc(String(sentence).replace(/\{\{|\}\}/g, ''));
  return `${esc(c.before)}<mark>${esc(c.answer)}</mark>${esc(c.after)}`;
}
export function stripCloze(s) { return String(s ?? '').replace(/\{\{|\}\}/g, ''); }

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px' } });
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}
export async function readClipboard() {
  try { return await navigator.clipboard.readText(); } catch { return null; }
}
