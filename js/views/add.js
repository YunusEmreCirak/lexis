import { S, termExists, saveMeta } from '../store.js';
import { addNote } from '../srs.js';
import { enrichFromDictionary } from '../dict.js';
import { TOPICS, ERROR_CATS } from '../data/constants.js';
import { h, mount, toast, readClipboard } from '../util.js';

let mode = 'word'; // word | phrase | error | bulk

export function render(root) {
  const seg = h('div', { class: 'seg' },
    [['word', 'Kelime'], ['phrase', 'Kalıp'], ['error', 'Hata'], ['bulk', 'Toplu']].map(([k, l]) =>
      h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; render(root); } }, l)));
  const body = mode === 'error' ? errorForm(root) : mode === 'bulk' ? bulkForm(root) : wordForm(root);
  mount(root, 
    h('h1', null, 'Ekle'),
    h('p', { class: 'muted small', style: { margin: '0 0 12px' } }, {
      word: 'Bilmediğin kelimeyi, karşılaştığın cümleyle birlikte kaydet. Bağlam, hatırlamayı ciddi şekilde artırır.',
      phrase: 'Collocation, phrasal verb, deyim ya da Writing/Speaking kalıbı. Bütün hâlinde öğrenilir.',
      error: 'Yazarken ya da konuşurken yaptığın hata. Yanlış ve doğru hâliyle kaydedilir, “düzelt” kartı olur.',
      bulk: 'Her satıra bir kelime/kalıp. İstersen “ | ” ile cümlesini ekle: mitigate | We must mitigate the risks.',
    }[mode]),
    seg,
    body,
  );
}

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, hint) : null);
const sourceList = () => h('datalist', { id: 'sources' }, [...new Set([...S.notes.values()].map(n => n.source).filter(Boolean))].slice(-30).map(s => h('option', { value: s })));
const topicSelect = val => h('select', null, h('option', { value: '' }, '— Konu (isteğe bağlı) —'), TOPICS.map(t => h('option', { value: t, selected: t === val }, t)));

function wordForm(root) {
  const isPhrase = mode === 'phrase';
  const term = h('input', { type: 'text', placeholder: isPhrase ? 'ör. to a certain extent' : 'ör. mitigate', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: false });
  const pasteBtn = h('button', { class: 'btn sm', type: 'button', onclick: async () => { const t = await readClipboard(); if (t) { term.value = t.trim().split('\n')[0].slice(0, 120); term.dispatchEvent(new Event('input')); } else toast('Pano okunamadı — uzun bas → Yapıştır'); } }, 'Yapıştır');
  const dup = h('div', { class: 'small', style: { color: 'var(--again)', marginTop: '4px' } });
  term.addEventListener('input', () => { const e = termExists(term.value); dup.textContent = e ? `“${e.term}” zaten listende.` : ''; });
  const context = h('textarea', { rows: 2, placeholder: 'Karşılaştığın cümle (önerilir)' });
  const source = h('input', { type: 'text', list: 'sources', placeholder: 'ör. Cambridge 19 · Reading T2', value: S.meta.lastSource || '' });
  const topic = topicSelect(S.meta.lastTopic || '');
  const tr = h('input', { type: 'text', placeholder: 'Biliyorsan Türkçe anlamı (boş bırakılabilir)' });
  const mnemonic = h('input', { type: 'text', placeholder: 'Kendi hafıza ipucun (isteğe bağlı)' });

  const save = async (again) => {
    const t = term.value.trim();
    if (!t) { toast('Kelime/kalıp boş olamaz'); term.focus(); return; }
    if (termExists(t)) { toast('Bu zaten listende'); return; }
    const n = await addNote({
      type: isPhrase || /\s/.test(t) ? 'phrase' : 'word', term: t,
      context: context.value.trim(), source: source.value.trim(), topic: topic.value,
      tr: tr.value.trim(), userTr: !!tr.value.trim(), mnemonic: mnemonic.value.trim(),
    }, 'mine');
    S.meta.lastSource = source.value.trim(); S.meta.lastTopic = topic.value; await saveMeta();
    toast(`“${t}” eklendi`);
    enrichFromDictionary(n);
    if (again) { render(root); setTimeout(() => root.querySelector('input')?.focus(), 50); }
    else location.hash = '#/today';
  };

  return h('div', null,
    field(isPhrase ? 'Kalıp' : 'Kelime', h('div', null, h('div', { class: 'row' }, h('div', { class: 'grow' }, term), pasteBtn), dup)),
    field('Bağlam cümlesi', context, 'Boşluk doldurma kartları bu cümleden de üretilir.'),
    h('div', { class: 'grid2' }, field('Kaynak', h('div', null, source, sourceList())), field('Konu', topic)),
    h('details', null, h('summary', { class: 'small' }, 'Daha fazla alan'), field('Türkçe anlam', tr), field('Hafıza ipucu', mnemonic)),
    h('div', { class: 'grid2', style: { marginTop: '16px' } },
      h('button', { class: 'btn', onclick: () => save(true) }, 'Kaydet + yeni'),
      h('button', { class: 'btn primary', onclick: () => save(false) }, 'Kaydet')),
  );
}

function errorForm(root) {
  const wrong = h('textarea', { rows: 2, placeholder: 'ör. The informations was very useful.', autocapitalize: 'sentences', spellcheck: false });
  const correct = h('textarea', { rows: 2, placeholder: 'ör. The information was very useful. (bilmiyorsan boş bırak, Claude düzeltir)' });
  const explanation = h('input', { type: 'text', placeholder: 'ör. information sayılamaz, çoğul olmaz' });
  const cat = h('select', null, h('option', { value: '' }, '— Kategori —'), Object.entries(ERROR_CATS).map(([k, v]) => h('option', { value: k }, v)));
  const save = async () => {
    const w = wrong.value.trim();
    if (!w) { toast('Hatalı cümle boş olamaz'); return; }
    await addNote({
      type: 'error', term: correct.value.trim() || w, wrong: w, correct: correct.value.trim(), userCorrect: !!correct.value.trim(),
      explanation: explanation.value.trim(), category: cat.value,
      enriched: !!(correct.value.trim() && explanation.value.trim() && cat.value), dictFetched: true,
    }, 'mine');
    toast('Hata defterine eklendi');
    render(root);
  };
  return h('div', null,
    field('Hatalı hâli', wrong),
    field('Doğru hâli', correct),
    field('Kural / açıklama', explanation),
    field('Kategori', cat),
    h('button', { class: 'btn primary block', style: { marginTop: '12px' }, onclick: save }, 'Hata defterine ekle'),
    h('p', { class: 'small muted' }, 'Doğru hâli, açıklama ya da kategori eksikse “Claude ile zenginleştir” bunları tamamlar.'),
  );
}

function bulkForm(root) {
  const ta = h('textarea', { rows: 10, placeholder: 'mitigate | Governments must mitigate the risks.\nto a certain extent\nubiquitous', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const source = h('input', { type: 'text', list: 'sources', placeholder: 'Kaynak (hepsine uygulanır)', value: S.meta.lastSource || '' });
  const save = async () => {
    const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
    let added = 0, dup = 0;
    const created = [];
    for (const line of lines) {
      const [t, ctx] = line.split('|').map(s => s.trim());
      if (!t) continue;
      if (termExists(t)) { dup++; continue; }
      created.push(await addNote({ type: /\s/.test(t) ? 'phrase' : 'word', term: t, context: ctx || '', source: source.value.trim() }, 'mine'));
      added++;
    }
    toast(`${added} eklendi${dup ? `, ${dup} zaten vardı` : ''}`);
    (async () => { for (const n of created) await enrichFromDictionary(n); })();
    location.hash = '#/today';
  };
  return h('div', null,
    field('Liste', ta),
    field('Kaynak', h('div', null, source, sourceList())),
    h('div', { class: 'grid2', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: async () => { const t = await readClipboard(); if (t) ta.value = (ta.value ? ta.value + '\n' : '') + t; else toast('Pano okunamadı'); } }, 'Panodan yapıştır'),
      h('button', { class: 'btn primary', onclick: save }, 'Hepsini ekle')),
  );
}
