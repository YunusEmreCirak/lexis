// Card detail + edit.
import { S, saveNote, deleteNote, saveItems, itemsOf, idb } from '../store.js';
import { newItem, stateLabel } from '../srs.js';
import { enrichFromDictionary } from '../dict.js';
import { playTerm, speak } from '../tts.js';
import { TOPICS, ERROR_CATS, MODE_LABEL } from '../data/constants.js';
import { h, mount, toast, markTerm, fmtDate, fmtIvl } from '../util.js';

let editing = false;

export function render(root, id) {
  const n = S.notes.get(id);
  if (!n) { mount(root, h('div', { class: 'empty' }, 'Kart bulunamadı.'), h('a', { class: 'btn block', href: '#/list' }, 'Listeye dön')); return; }
  mount(root, 
    h('div', { class: 'row between' },
      h('button', { class: 'btn ghost', style: { paddingLeft: 0 }, onclick: () => history.back() }, '‹ Geri'),
      h('button', { class: 'btn ghost', onclick: () => { editing = !editing; render(root, id); } }, editing ? 'Vazgeç' : 'Düzenle')),
    editing ? editForm(root, n) : detail(root, n),
  );
}

function detail(root, n) {
  const [label, cls] = stateLabel(n);
  const its = itemsOf(n.id);
  const sec = (title, body) => body ? h('div', null, h('div', { class: 'lbl', lang: title === 'Collocations' ? 'en' : null, style: { fontSize: '11px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: '14px 0 4px' } }, title), body) : null;
  const isErr = n.type === 'error';
  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('div', { class: 'grow' },
          h('div', { class: 'serif', style: { fontSize: '28px', fontWeight: 600, lineHeight: 1.2 } }, isErr ? n.wrong : n.term),
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, isErr ? (ERROR_CATS[n.category] || 'Hata') : [n.ipa, n.pos, n.cefr].filter(Boolean).join(' · '))),
        h('button', { class: 'icon-btn', onclick: () => playTerm(n) }, '🔊')),
      h('div', { class: 'row wrap', style: { marginTop: '10px' } },
        h('span', { class: `badge ${isErr ? 'err' : cls}` }, isErr ? 'Hata defteri' : label),
        n.topic ? h('span', { class: 'badge' }, n.topic) : null,
        h('span', { class: 'badge' }, { mine: 'Benim', writing: 'Yazmadan', awl: 'AWL', oxford: 'Oxford', phrases: 'IELTS kalıbı' }[n.origin] || n.origin),
        n.enriched ? null : h('span', { class: 'badge learn' }, 'zenginleştirilmedi')),
      isErr ? [sec('Doğrusu', h('div', { class: 'serif', style: { fontSize: '18px' } }, n.correct || '—')), sec('Kural', n.explanation ? h('div', null, n.explanation) : null)]
        : [
          sec('Anlam', h('div', null, h('div', { style: { fontSize: '19px', fontWeight: 700 } }, n.tr || '—'), n.defEn ? h('div', { class: 'muted' }, n.defEn) : null)),
          sec('Kelime ailesi', n.family ? h('div', null, n.family) : null),
          sec('Collocations', (n.collocations || []).length ? h('div', { class: 'chips' }, n.collocations.map(c => h('span', { class: 'chip' }, c))) : null),
          sec('Eş / zıt anlam', (n.synonyms || []).length ? h('div', null, n.synonyms.join(', '), (n.antonyms || []).length ? ` ≠ ${n.antonyms.join(', ')}` : '') : null),
          sec('Hafıza ipucu', n.mnemonic ? h('div', null, '💡 ', n.mnemonic) : null),
          sec('Kullanım notu', n.note ? h('div', null, n.note) : null),
        ],
      sec('Örnekler', (n.examples || []).length ? h('ul', { style: { margin: 0, paddingLeft: '18px' } }, n.examples.map(s => h('li', { onclick: () => speak(s) }, h('span', { html: markTerm(s, n.term) })))) : null),
      sec('Boşluk doldurma cümleleri', (n.cloze || []).length ? h('ul', { style: { margin: 0, paddingLeft: '18px' } }, n.cloze.map(s => h('li', { html: markTerm(s, n.term) }))) : null),
      sec('Karşılaştığın yer', n.context ? h('div', { class: 'serif', html: markTerm(n.context, n.term) }) : null),
      sec('Kaynak', n.source ? h('div', { class: 'small' }, n.source) : null),
    ),
    its.length ? h('div', { class: 'card soft' },
      h('b', null, 'Tekrar durumu'),
      h('dl', { class: 'kv', style: { marginTop: '8px' } }, its.flatMap(i => [
        h('dt', null, MODE_LABEL[i.kind]),
        h('dd', null, !i.introduced ? 'henüz başlamadı' : `${fmtDate(i.c.due)} · stabilite ${fmtIvl((i.c.stability || 0) * 86400000)} · ${i.c.reps} tekrar · ${i.c.lapses} unutma`),
      ]))) : null,
    h('div', { class: 'stack', style: { marginTop: '14px' } },
      !n.dictFetched && !isErr ? h('button', { class: 'btn block', onclick: async () => { toast('Sözlükte aranıyor…'); const ok = await enrichFromDictionary(n); toast(ok ? 'Sözlük bilgisi eklendi' : 'Sözlükte bulunamadı / çevrimdışı'); render(root, n.id); } }, 'Sözlükten bilgi al') : null,
      h('button', { class: 'btn block', onclick: async () => { n.suspended = !n.suspended; n.known = false; await saveNote(n); toast(n.suspended ? 'Askıya alındı' : 'Tekrar aktif'); render(root, n.id); } }, n.suspended ? 'Tekrar aktif et' : 'Askıya al (gösterme)'),
      h('button', { class: 'btn block', onclick: async () => { if (!confirm('İlerleme sıfırlansın mı? Kart yeni gibi baştan başlar.')) return; const fresh = its.filter(i => i.kind !== 'prod').map(i => newItem(n.id, i.kind)); for (const i of its) S.items.delete(i.id); await idb.delMany('items', its.map(i => i.id)); await saveItems(fresh); toast('Sıfırlandı'); render(root, n.id); } }, 'İlerlemeyi sıfırla'),
      h('button', { class: 'btn block danger', onclick: async () => { if (!confirm(`“${n.term}” silinsin mi? Bu geri alınamaz.`)) return; await deleteNote(n.id); toast('Silindi'); history.back(); } }, 'Sil'),
    ),
  );
}

const lines = a => (a || []).join('\n');
const split = s => s.split('\n').map(x => x.trim()).filter(Boolean);

function editForm(root, n) {
  const f = {};
  const field = (label, key, kind = 'input', ph = '') => {
    const val = Array.isArray(n[key]) ? lines(n[key]) : n[key] || '';
    const el = kind === 'textarea' ? h('textarea', { rows: 3, value: val, placeholder: ph }) : h('input', { type: 'text', value: val, placeholder: ph, autocapitalize: 'off' });
    f[key] = el;
    return h('label', { class: 'field' }, h('span', null, label), el);
  };
  const topic = h('select', null, h('option', { value: '' }, '—'), TOPICS.map(t => h('option', { value: t, selected: t === n.topic }, t)));
  const cat = h('select', null, h('option', { value: '' }, '—'), Object.entries(ERROR_CATS).map(([k, v]) => h('option', { value: k, selected: k === n.category }, v)));
  const isErr = n.type === 'error';
  const save = async () => {
    for (const [k, el] of Object.entries(f)) n[k] = Array.isArray(n[k]) || ['examples', 'cloze', 'collocations', 'synonyms', 'antonyms'].includes(k) ? split(el.value) : el.value.trim();
    if (isErr) { n.category = cat.value; n.userCorrect = true; if (n.correct) n.term = n.correct; } else { n.topic = topic.value; if (f.tr.value.trim()) n.userTr = true; }
    await saveNote(n);
    editing = false;
    toast('Kaydedildi');
    render(root, n.id);
  };
  return h('div', null,
    isErr ? [field('Hatalı hâli', 'wrong', 'textarea'), field('Doğru hâli', 'correct', 'textarea'), field('Kural', 'explanation', 'textarea'),
      h('label', { class: 'field' }, h('span', null, 'Kategori'), cat), field('Örnekler (her satıra bir)', 'examples', 'textarea')]
      : [field('Kelime / kalıp', 'term'), field('Türkçe anlam', 'tr'), field('İngilizce tanım', 'defEn', 'textarea'),
        h('div', { class: 'grid2' }, field('Tür', 'pos'), field('CEFR', 'cefr')),
        h('label', { class: 'field' }, h('span', null, 'Konu'), topic),
        field('Bağlam cümlesi', 'context', 'textarea'), field('Kaynak', 'source'),
        field('Örnekler (her satıra bir)', 'examples', 'textarea'),
        field('Boşluk cümleleri — hedefi {{ }} içine al', 'cloze', 'textarea', 'We must {{mitigate}} the risks.'),
        field('Collocations (her satıra bir)', 'collocations', 'textarea'),
        field('Kelime ailesi', 'family'), field('Eş anlamlılar (her satıra bir)', 'synonyms', 'textarea'),
        field('Hafıza ipucu', 'mnemonic'), field('Kullanım notu', 'note', 'textarea'), field('IPA', 'ipa')],
    h('button', { class: 'btn primary block', style: { marginTop: '10px' }, onclick: save }, 'Kaydet'),
  );
}
