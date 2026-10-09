// The review session. Variants per item kind:
//   recog: 'see'    — word shown → recall meaning → self-grade
//          'listen' — word only heard → type what you hear → meaning revealed
//   prod:  'def'    — Turkish meaning + English definition → type the English
//          'cloze'  — sentence with a gap → type the missing word
//          'colloc' — collocation with the term blanked → type it
//   fix:   'fix'    — your own wrong sentence → write the corrected sentence

import { S } from '../store.js';
import { makeSession, nextItem, remaining, preview, answer, undo, markKnown, Rating, OWN, extraNewToday, topUpFromPool, newCandidates } from '../srs.js';
import { h, mount, esc, grade, diffHTML, parseCloze, findTerm, markTerm, stripCloze, fmtIvl, pick, norm, levenshtein, toast } from '../util.js';
import { playTerm, speak, ttsAvailable } from '../tts.js';
import { ERROR_CATS } from '../data/constants.js';

let sess, st, root, keyHandler;

export function render(el) {
  root = el;
  document.body.classList.add('studying');
  sess = makeSession();
  sess.stats = { n: 0, ok: 0 };
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = onKey;
  document.addEventListener('keydown', keyHandler);
  show();
}
export function leave() {
  document.body.classList.remove('studying');
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
}

function chooseVariant(item, note) {
  if (item.kind === 'fix') return { v: 'fix', expected: note.correct };
  if (item.kind === 'recog') {
    const canListen = ttsAvailable() && item.introduced && item.c.reps > 0 && Math.random() < S.settings.listenShare;
    return { v: canListen ? 'listen' : 'see', expected: note.term };
  }
  // production: gather possible gap-fill prompts
  const clozes = [];
  for (const s of note.cloze || []) { const c = parseCloze(s); if (c) clozes.push({ ...c, src: s }); }
  for (const s of [note.context, ...(note.examples || [])]) {
    if (!s) continue;
    const c = findTerm(s, note.term);
    if (c && !clozes.some(x => stripCloze(x.src) === s)) clozes.push({ ...c, src: s });
  }
  const collocs = [];
  for (const s of note.collocations || []) {
    const c = findTerm(s, note.term);
    if (c && norm(s) !== norm(note.term)) collocs.push(c);
  }
  const r = Math.random();
  if (clozes.length && r < 0.5) { const c = pick(clozes); return { v: 'cloze', expected: c.answer, gap: c }; }
  if (collocs.length && r < 0.75) { const c = pick(collocs); return { v: 'colloc', expected: c.answer, gap: c }; }
  return { v: 'def', expected: note.term };
}

function show() {
  const item = nextItem(sess);
  if (!item) return renderDone();
  const note = S.notes.get(item.noteId);
  if (!note) { sess.main = sess.main.filter(i => i !== item); sess.learning = sess.learning.filter(i => i !== item); return show(); }
  st = { item, note, ...chooseVariant(item, note), shownAt: Date.now(), revealed: false, verdict: null, input: '', hint: 0 };
  if (S.settings.autoplay && (st.v === 'see' || st.v === 'listen')) playTerm(note);
  draw();
}

function topBar() {
  const r = remaining(sess);
  const total = sess.done + r.n + r.l + r.r;
  const pct = total ? Math.round((sess.done / total) * 100) : 0;
  return h('div', { class: 'study-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Kapat', onclick: () => (location.hash = '#/today') }, '✕'),
    h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })),
    h('div', { class: 'counts' }, h('span', { class: 'n' }, r.n), h('span', { class: 'l' }, r.l), h('span', { class: 'r' }, r.r)),
    sess.history.length ? h('button', { class: 'icon-btn', 'aria-label': 'Geri al', onclick: doUndo }, '↶') : null,
  );
}

function draw() {
  const { note, item, v } = st;
  const isNewPool = !item.introduced && !OWN.has(note.origin);
  const modeName = { see: 'Tanıma', listen: 'Dinle & yaz', def: 'Üretim', cloze: 'Boşluk doldur', colloc: 'Collocation', fix: 'Hata defteri' }[v];
  const flash = h('div', { class: 'flash' },
    h('div', { class: 'mode' },
      h('span', null, modeName, !item.introduced ? h('span', { class: 'badge new', style: { marginLeft: '8px' } }, 'YENİ') : null),
      note.topic ? h('span', { class: 'badge' }, note.topic) : null),
    front(),
    st.revealed ? backView() : null,
  );
  const actions = st.revealed ? gradeBar() : frontActions(isNewPool);
  mount(root, topBar(), flash, actions);
  const inp = root.querySelector('.answer-in input, .answer-in textarea');
  if (inp && !st.revealed) setTimeout(() => inp.focus({ preventScroll: true }), 30);
}

function front() {
  const { note, v } = st;
  const audioBtn = h('button', { class: 'icon-btn', 'aria-label': 'Dinle', onclick: () => playTerm(note) }, '🔊');
  if (v === 'see') {
    return h('div', null,
      h('div', { class: `term${note.term.length > 18 ? ' long' : ''}` }, note.term),
      h('div', { class: 'ipa' }, [note.ipa, note.pos].filter(Boolean).join(' · ')),
      h('div', { class: 'center', style: { marginTop: '12px' } }, audioBtn),
      !st.revealed ? h('p', { class: 'muted small center', style: { marginTop: '20px' } }, 'Anlamını hatırlamaya çalış, sonra göster.') : null,
    );
  }
  if (v === 'listen') {
    return h('div', null,
      h('div', { class: 'center', style: { margin: '26px 0 10px' } },
        h('button', { class: 'btn primary', style: { borderRadius: '50%', width: '84px', height: '84px', fontSize: '30px' }, onclick: () => playTerm(note) }, '🔊')),
      h('p', { class: 'muted small center' }, 'Duyduğun kelimeyi yaz. Sonra anlamını hatırladın mı, kendin değerlendir.'),
      st.revealed ? h('div', { class: `term${note.term.length > 18 ? ' long' : ''}` }, note.term) : answerInput('Duyduğunu yaz…'),
      st.verdict ? verdictBox() : null,
    );
  }
  if (v === 'def') {
    return h('div', null,
      h('div', { class: 'prompt', style: { fontSize: '22px', fontWeight: '700' } }, note.tr || '—'),
      note.defEn ? h('div', { class: 'prompt serif', style: { marginTop: 0 } }, note.defEn) : null,
      h('div', { class: 'muted small' }, [note.pos, note.type === 'phrase' ? 'kalıp' : null, `${countWords(note.term)} kelime`].filter(Boolean).join(' · ')),
      hintLine(),
      st.revealed ? null : answerInput('İngilizcesini yaz…'),
      st.verdict ? verdictBox() : null,
    );
  }
  if (v === 'cloze' || v === 'colloc') {
    const g = st.gap;
    const gapHTML = st.revealed
      ? `${esc(g.before)}<mark>${esc(g.answer)}</mark>${esc(g.after)}`
      : `${esc(g.before)}<span class="gap">${'_'.repeat(Math.max(4, g.answer.length))}</span>${esc(g.after)}`;
    return h('div', null,
      h('div', { class: `prompt${v === 'cloze' ? ' serif' : ''}`, html: gapHTML, style: v === 'colloc' ? { fontSize: '22px', fontWeight: '600' } : null }),
      h('div', { class: 'muted small' }, v === 'colloc' ? 'Kalıbı tamamla' : 'Boşluğa uygun kelime/kalıp', note.tr && st.hint > 0 ? ` · ${note.tr}` : ''),
      hintLine(),
      st.revealed ? null : answerInput('Eksik kısmı yaz…'),
      st.verdict ? verdictBox() : null,
    );
  }
  // fix
  return h('div', null,
    h('div', { class: 'muted small' }, ERROR_CATS[note.category] || 'Gramer/kullanım hatası'),
    h('div', { class: 'prompt serif' }, '✗ ', note.wrong),
    st.revealed ? null : answerInput('Doğru hâlini yaz…', true),
    st.verdict ? verdictBox(true) : null,
  );
}

const countWords = s => s.trim().split(/\s+/).length;

function hintLine() {
  if (st.revealed) return null;
  const e = st.expected || '';
  const masked = [...e].map((ch, i) => (/\s/.test(ch) ? '  ' : i < st.hint ? ch : '_')).join(' ');
  return h('div', { class: 'row', style: { marginTop: '8px' } },
    st.hint ? h('code', { style: { letterSpacing: '1px' } }, masked) : null,
    h('button', { class: 'btn ghost sm', onclick: () => { st.hint = Math.min(e.length, st.hint + 1); draw(); } }, st.hint ? 'Bir harf daha' : 'İpucu'),
  );
}

function answerInput(ph, multi = false) {
  const attrs = {
    placeholder: ph, autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: false, enterkeyhint: 'done',
    value: st.input,
    oninput: e => { st.input = e.target.value; },
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); check(); } },
  };
  return h('div', { class: 'answer-in', style: { marginTop: '16px' } }, multi ? h('textarea', { ...attrs, rows: 3 }) : h('input', { type: 'text', ...attrs }));
}

function check(giveUp = false) {
  const { v, note } = st;
  if (giveUp) st.verdict = 'bad';
  else if (v === 'fix') {
    const a = norm(st.input), b = norm(note.correct);
    st.verdict = a === b ? 'ok' : levenshtein(a, b) <= Math.max(2, Math.round(b.length * 0.08)) ? 'close' : 'bad';
  } else {
    st.verdict = grade(st.input, st.expected, v === 'def' ? [note.term] : []);
  }
  if (st.hint && st.verdict === 'ok') st.verdict = 'close';
  st.revealed = true;
  if (S.settings.autoplay && v !== 'listen' && v !== 'see') playTerm(note);
  draw();
}

function verdictBox(byWord = false) {
  const v = st.verdict;
  const showDiff = st.input && (v === 'close' || (v === 'bad' && byWord));
  return h('div', { class: `verdict ${v === 'ok' ? 'ok' : v === 'close' ? 'close' : 'bad'}` },
    h('div', null, v === 'ok' ? 'Doğru ✓' : v === 'close' ? 'Neredeyse — küçük bir fark var' : st.input ? 'Yanlış' : 'Doğrusu:'),
    showDiff ? h('div', { class: 'diff', style: { fontWeight: 400, marginTop: '4px' }, html: diffHTML(st.input, st.expected, byWord) }) : null,
    v === 'bad' && !byWord ? h('div', { style: { marginTop: '4px' } },
      st.input ? h('div', { style: { fontWeight: 400 } }, 'Senin cevabın: ', h('del', null, st.input)) : null,
      h('div', null, st.input ? 'Doğrusu: ' : '', h('b', null, st.expected))) : null,
    v === 'bad' && byWord && !st.input ? h('div', { style: { fontWeight: 700 } }, st.expected) : null,
  );
}

function backView() {
  const n = st.note;
  if (n.type === 'error') {
    return h('div', { class: 'back' },
      h('div', { class: 'lbl' }, 'Doğrusu'),
      h('div', { class: 'serif', style: { fontSize: '19px' } }, '✓ ', n.correct),
      n.explanation ? [h('div', { class: 'lbl' }, 'Kural'), h('div', null, n.explanation)] : null,
      (n.examples || []).length ? [h('div', { class: 'lbl' }, 'Örnekler'), h('ul', null, n.examples.map(e => h('li', null, e)))] : null,
      editLink(),
    );
  }
  const sentences = [...(n.examples || [])];
  return h('div', { class: 'back' },
    h('div', { class: 'row between' },
      h('div', { class: 'grow' },
        st.v !== 'see' && st.v !== 'listen' ? h('div', { class: 'serif', style: { fontSize: '24px', fontWeight: 600 } }, n.term) : null,
        h('div', { class: 'tr' }, n.tr || h('span', { class: 'muted', style: { fontWeight: 400, fontSize: '15px' } }, 'Türkçe anlam yok — zenginleştir')),
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Dinle', onclick: () => playTerm(n) }, '🔊')),
    n.defEn ? h('div', { class: 'def muted' }, n.defEn) : null,
    h('div', { class: 'small muted' }, [n.ipa, n.pos, n.cefr, n.family].filter(Boolean).join(' · ')),
    sentences.length ? [h('div', { class: 'lbl' }, 'Örnekler'), h('ul', null, sentences.map(s =>
      h('li', { onclick: () => speak(s) }, h('span', { html: markTerm(s, n.term) }), ' ', h('span', { class: 'muted small' }, '🔈'))))] : null,
    (n.collocations || []).length ? [h('div', { class: 'lbl', lang: 'en' }, 'Collocations'), h('div', { class: 'chips' }, n.collocations.map(c => h('span', { class: 'chip' }, c)))] : null,
    (n.synonyms || []).length ? [h('div', { class: 'lbl' }, 'Eş anlamlılar'), h('div', null, n.synonyms.join(', '), n.antonyms?.length ? h('span', { class: 'muted' }, `  ≠ ${n.antonyms.join(', ')}`) : null)] : null,
    n.mnemonic ? [h('div', { class: 'lbl' }, 'Hafıza ipucu'), h('div', null, '💡 ', n.mnemonic)] : null,
    n.note ? [h('div', { class: 'lbl' }, 'Kullanım notu'), h('div', null, n.note)] : null,
    n.context ? [h('div', { class: 'lbl' }, 'Karşılaştığın yer'), h('div', { class: 'serif', html: markTerm(n.context, n.term) }), n.source ? h('div', { class: 'small muted' }, n.source) : null] : (n.source ? h('div', { class: 'small muted', style: { marginTop: '10px' } }, n.source) : null),
    editLink(),
  );
}

const editLink = () => h('div', { style: { marginTop: '12px' } }, h('a', { href: `#/note/${st.note.id}`, class: 'small' }, 'Kartı düzenle'));

function frontActions(isNewPool) {
  const typed = st.v !== 'see';
  return h('div', { style: { marginTop: '14px' } },
    typed
      ? h('div', { class: 'grid2' },
          h('button', { class: 'btn', onclick: () => check(true) }, 'Bilmiyorum'),
          h('button', { class: 'btn primary', onclick: () => check() }, 'Kontrol et'))
      : h('button', { class: 'btn primary block', style: { minHeight: '54px' }, onclick: () => { st.revealed = true; draw(); } }, 'Göster'),
    isNewPool ? h('button', { class: 'btn ghost block', style: { marginTop: '6px' }, onclick: known }, 'Bunu zaten biliyorum — gösterme') : null,
  );
}

function gradeBar() {
  const p = preview(st.item);
  const sug = st.verdict === 'ok' ? Rating.Good : st.verdict === 'close' ? Rating.Hard : st.verdict === 'bad' ? Rating.Again : null;
  const names = { 1: 'Tekrar', 2: 'Zor', 3: 'İyi', 4: 'Kolay' };
  return h('div', { class: 'grades' }, [1, 2, 3, 4].map(g =>
    h('button', { class: `g${g}${sug === g ? ' sug' : ''}`, onclick: () => rate(g) }, names[g], h('small', null, fmtIvl(p[g])))));
}

let busy = false;
async function rate(g) {
  if (busy) return;
  busy = true;
  try {
    sess.stats.n++; if (g > 1) sess.stats.ok++;
    await answer(sess, st.item, g, { variant: st.v, ms: Date.now() - st.shownAt });
    show();
  } finally { busy = false; }
}

async function doUndo() {
  const it = await undo(sess);
  if (!it) return;
  sess.stats.n = Math.max(0, sess.stats.n - 1);
  const note = S.notes.get(it.noteId);
  st = { item: it, note, ...chooseVariant(it, note), shownAt: Date.now(), revealed: false, verdict: null, input: '', hint: 0 };
  draw();
}

async function known() {
  await markKnown(sess, st.item);
  toast(`“${st.note.term}” bilinenlere taşındı`);
  show();
}

function onKey(e) {
  if (!st || e.target?.matches?.('input, textarea, select')) return;
  if (!st.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (st.v === 'see') { st.revealed = true; draw(); } else check(); }
  else if (st.revealed && ['1', '2', '3', '4'].includes(e.key)) rate(+e.key);
  else if (st.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); rate(st.verdict === 'bad' ? 1 : st.verdict === 'close' ? 2 : 3); }
}

function renderDone() {
  st = null;
  const acc = sess.stats.n ? Math.round((sess.stats.ok / sess.stats.n) * 100) : null;
  const morePossible = newCandidates().length > 0 || S.pool.size > 0;
  mount(root, 
    h('div', { class: 'done' },
      h('div', { class: 'big' }, sess.stats.n ? '🎉' : '✅'),
      h('h1', null, sess.stats.n ? 'Bugünlük tamam!' : 'Şu an çalışılacak kart yok'),
      sess.stats.n ? h('p', { class: 'muted' }, `${sess.stats.n} kart · %${acc} hatırlama`) : h('p', { class: 'muted' }, 'Yeni kelime ekleyebilir ya da havuzdan ekstra kart açabilirsin.'),
    ),
    h('div', { class: 'stack' },
      morePossible ? h('button', { class: 'btn block', onclick: async () => { await extraNewToday(5); await topUpFromPool(); render(root); } }, '+5 yeni kart aç') : null,
      h('a', { class: 'btn primary block', href: '#/write' }, 'Öğrendiklerinle yazma görevi'),
      h('a', { class: 'btn ghost block', href: '#/today' }, 'Ana sayfa'),
    ),
  );
}
