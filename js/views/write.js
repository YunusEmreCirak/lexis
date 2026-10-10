// Generation practice: write with recently learned words → Claude feedback → mistakes become error cards.
import { S, saveMeta, saveWriting, allWritings } from '../store.js';
import { addNote, State } from '../srs.js';
import { buildWritingPrompt, extractJSON, parseFeedback } from '../prompts.js';
import { TASK2, ERROR_CATS } from '../data/constants.js';
import { h, mount, toast, copyText, readClipboard, uid, shuffle, pick, findTerm, fmtDate, norm } from '../util.js';

let draft = null;   // { id, question, words, text, feedback, createdAt }
let viewing = null; // a saved writing opened from the history

function chooseWords(n = 10) {
  // words already in review (learned at least once), favouring ones not yet used in writing
  const used = new Set(S.meta.usedInWriting || []);
  const cands = [];
  for (const it of S.items.values()) {
    if (!it.introduced || it.c.state !== State.Review) continue;
    const note = S.notes.get(it.noteId);
    if (!note || note.suspended || note.type === 'error') continue;
    cands.push(note);
  }
  const uniq = [...new Map(cands.map(n => [n.id, n])).values()];
  const fresh = shuffle(uniq.filter(n => !used.has(n.id)));
  const old = shuffle(uniq.filter(n => used.has(n.id)));
  return [...fresh, ...old].slice(0, n).map(n => ({ id: n.id, term: n.term, tr: n.tr, topic: n.topic }));
}

function chooseQuestion(words) {
  const topics = words.map(w => w.topic).filter(Boolean);
  const matching = TASK2.filter(t => topics.includes(t.topic));
  return (matching.length ? pick(matching) : pick(TASK2)).q;
}

export function leave() { viewing = null; }

export async function render(root) {
  if (viewing) return renderSaved(root, viewing);
  if (!draft) {
    const words = chooseWords();
    draft = { id: uid('w'), question: chooseQuestion(words), words, text: S.meta.writingDraft || '', feedback: null, createdAt: Date.now() };
  }
  const d = draft;
  const ta = h('textarea', { rows: 9, value: d.text, placeholder: 'Bir paragraf yaz (80–150 kelime). Hedef kelimelerden en az 6’sını kullanmaya çalış.', autocapitalize: 'sentences' });
  const wc = h('span', { class: 'small muted' });
  const chips = h('div', { class: 'chips' });
  const refresh = () => {
    d.text = ta.value;
    const words = d.text.trim() ? d.text.trim().split(/\s+/).length : 0;
    const used = d.words.filter(w => findTerm(d.text, w.term)).length;
    wc.textContent = `${words} kelime · ${used}/${d.words.length} hedef kullanıldı`;
    chips.replaceChildren(...d.words.map(w => h('span', { class: `chip${findTerm(d.text, w.term) ? ' ok' : ''}`, title: w.tr || '' }, w.term)));
  };
  let saveT;
  ta.addEventListener('input', () => { refresh(); clearTimeout(saveT); saveT = setTimeout(() => { S.meta.writingDraft = ta.value; saveMeta(); }, 600); });
  refresh();

  const history = await allWritings();

  mount(root,
    h('h1', null, 'Yazma görevi'),
    h('p', { class: 'muted small' }, 'Kelimeyi kendi cümlende üretmek kalıcılığı artırır. Claude IELTS kriterlerine göre değerlendirir; hataların hata defterine eklenebilir.'),
    !d.words.length ? h('div', { class: 'card warn' }, 'Henüz tekrar aşamasına geçmiş kelimen yok. Birkaç gün çalıştıktan sonra burada hedef kelimeler belirecek. Yine de serbest yazıp kontrol ettirebilirsin.') : null,
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('b', null, 'Soru (Task 2 tarzı)'), h('button', { class: 'btn ghost sm', onclick: () => { d.question = pick(TASK2).q; render(root); } }, 'Değiştir')),
      h('p', { class: 'serif', style: { margin: '6px 0 0' } }, d.question),
    ),
    h('div', { class: 'row between' }, h('b', null, 'Hedef kelimeler'), h('button', { class: 'btn ghost sm', onclick: () => { d.words = chooseWords(); refresh(); render(root); } }, 'Yenile')),
    chips,
    h('div', { style: { marginTop: '12px' } }, ta),
    h('div', { style: { margin: '6px 2px' } }, wc),
    h('div', { class: 'grid2', style: { marginTop: '8px' } },
      h('button', { class: 'btn primary', onclick: async () => {
        if (d.text.trim().split(/\s+/).length < 15) { toast('Biraz daha yaz (en az 15 kelime)'); return; }
        const ok = await copyText(buildWritingPrompt({ question: d.question, words: d.words.map(w => w.term), text: d.text }));
        toast(ok ? 'Komut kopyalandı → Claude’a yapıştır' : 'Kopyalanamadı');
      } }, '1 · Komutu kopyala'),
      h('a', { class: 'btn', href: 'https://claude.ai/new', target: '_blank', rel: 'noopener' }, 'Claude’u aç ↗')),
    h('button', { class: 'btn block', style: { marginTop: '8px' }, onclick: async () => {
      const t = await readClipboard();
      if (!t) { toast('Pano okunamadı — aşağıdaki kutuya elle yapıştır'); return; }
      applyFeedback(root, d, t);
    } }, '2 · Claude’un cevabını panodan uygula'),
    (() => {
      const box = h('textarea', { rows: 3, placeholder: 'ya da cevabı buraya yapıştır', spellcheck: false, autocapitalize: 'off' });
      return h('details', { style: { marginTop: '6px' } }, h('summary', { class: 'small' }, 'Elle yapıştır'), box,
        h('button', { class: 'btn block sm', style: { marginTop: '6px' }, onclick: () => applyFeedback(root, d, box.value) }, 'Uygula'));
    })(),
    d.feedback ? feedbackView(root, d) : null,
    d.feedback ? h('button', { class: 'btn block', style: { marginTop: '10px' }, onclick: () => { draft = null; render(root); } }, 'Yeni görev') : null,
    history.length ? h('div', null, h('h2', null, 'Geçmiş'), h('div', { class: 'list' }, history.slice(0, 30).map(w =>
      h('a', { class: 'li', href: '#/write', onclick: e => { e.preventDefault(); viewing = w; render(root); } },
        h('div', { class: 'grow' }, h('div', { class: 't' }, w.question.slice(0, 60) + '…'), h('div', { class: 's' }, `${fmtDate(w.createdAt)} · ${pendingErrors(w.feedback).length ? `${pendingErrors(w.feedback).length} hata deftere eklenmedi` : 'geri bildirim'}`)),
        w.feedback?.band?.overall ? h('span', { class: 'badge mature' }, `Band ${w.feedback.band.overall}`) : null)))) : null,
  );
}

// A past writing with its feedback; errors can be (re)added to the error log from here.
function renderSaved(root, w) {
  mount(root,
    h('button', { class: 'btn ghost', style: { paddingLeft: 0 }, onclick: () => { viewing = null; render(root); } }, '‹ Yazma görevi'),
    h('h1', null, fmtDate(w.createdAt)),
    h('div', { class: 'card' }, h('b', null, 'Soru'), h('p', { class: 'serif', style: { margin: '6px 0 0' } }, w.question)),
    h('div', { class: 'card soft' }, h('b', null, 'Senin metnin'), h('p', { class: 'serif', style: { marginBottom: 0, whiteSpace: 'pre-wrap' } }, w.text)),
    w.feedback ? feedbackView(root, w) : h('div', { class: 'empty' }, 'Bu yazı için geri bildirim yok.'),
  );
}

async function applyFeedback(root, d, text) {
  try { d.feedback = parseFeedback(extractJSON(text)); await finish(d); render(root); }
  catch (e) { toast(e.message, 5000); }
}

async function finish(d) {
  const used = new Set(S.meta.usedInWriting || []);
  d.words.forEach(w => used.add(w.id));
  S.meta.usedInWriting = [...used].slice(-2000);
  S.meta.lastWriting = Date.now();
  S.meta.writingDraft = '';
  await saveMeta();
  await saveWriting({ id: d.id, question: d.question, words: d.words, text: d.text, feedback: d.feedback, createdAt: d.createdAt });
}

// An error counts as already in the error log when a card with the same wrong text exists.
function inErrorLog(e) {
  const w = norm(e.wrong);
  for (const n of S.notes.values()) if (n.type === 'error' && norm(n.wrong) === w) return true;
  return false;
}
const pendingErrors = f => (f?.errors || []).filter(e => !inErrorLog(e));

function feedbackView(root, d) {
  const f = d.feedback;
  const b = f.band || {};
  const sel = new Set(f.errors.map((e, i) => (inErrorLog(e) ? -1 : i)).filter(i => i >= 0));
  const pending = sel.size;
  return h('div', null,
    h('h2', null, 'Geri bildirim'),
    h('div', { class: 'card hero' },
      h('div', { class: 'grid4', style: { textAlign: 'center' } },
        ...[['overall', 'Genel'], ['LR', 'Lexical'], ['GRA', 'Gramer'], ['CC', 'Tutarlılık']].map(([k, l]) =>
          h('div', null, h('div', { class: 'kpi' }, b[k] || '–'), h('div', { class: 'kpi-label' }, l)))),
      f.summary ? h('p', { style: { margin: '12px 0 0' } }, f.summary) : null),
    f.words.length ? h('div', { class: 'card' }, h('b', null, 'Hedef kelimeler'),
      h('ul', { style: { paddingLeft: '18px', marginBottom: 0 } }, f.words.map(w => h('li', null, h('b', null, w.term), ' ', w.used ? (w.correct ? '✓' : '⚠︎') : '—', ' ', h('span', { class: 'muted' }, w.comment || ''))))) : null,
    f.errors.length ? h('div', { class: 'card' },
      h('b', null, `Hatalar (${f.errors.length})`),
      ...f.errors.map((e, i) => {
        const added = !sel.has(i);
        return h('label', { class: 'row', style: { alignItems: 'flex-start', marginTop: '10px' } },
          h('input', { type: 'checkbox', checked: !added, disabled: added, style: { marginTop: '4px', width: '20px', height: '20px', accentColor: 'var(--primary)' }, onchange: ev => (ev.target.checked ? sel.add(i) : sel.delete(i)) }),
          h('div', { class: 'grow' },
            h('div', null, h('del', { style: { color: 'var(--again)' } }, e.wrong), ' → ', h('b', { style: { color: 'var(--good)' } }, e.correct)),
            h('div', { class: 'small muted' }, `${added ? '✓ defterde · ' : ''}${ERROR_CATS[e.category] || ''}${e.explanation ? ' · ' + e.explanation : ''}`)));
      }),
      !pending ? h('div', { class: 'verdict ok' }, 'Hepsi hata defterinde ✓')
        : h('button', { class: 'btn primary block', style: { marginTop: '12px' }, onclick: async () => {
          let n = 0;
          for (const i of sel) {
            const e = f.errors[i];
            if (inErrorLog(e)) continue;
            await addNote({ type: 'error', term: e.correct, wrong: e.wrong, correct: e.correct, explanation: e.explanation || '', category: ERROR_CATS[e.category] ? e.category : 'other', enriched: true, dictFetched: true, userCorrect: true, source: 'Yazma görevi' }, 'writing');
            n++;
          }
          toast(`${n} hata kartı eklendi`);
          render(root);
        } }, `Seçilenleri hata defterine ekle (${pending})`)) : null,
    f.improved ? h('div', { class: 'card soft' }, h('b', null, 'Band 7.5 versiyonu'), h('p', { class: 'serif', style: { marginBottom: 0 } }, f.improved)) : null,
  );
}
