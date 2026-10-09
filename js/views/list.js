import { S } from '../store.js';
import { stateLabel, nextDue } from '../srs.js';
import { h, mount, fmtDate, norm } from '../util.js';

let q = '';
let filter = 'all';
let limit = 100;

const FILTERS = [
  ['all', 'Tümü'], ['word', 'Kelime'], ['phrase', 'Kalıp'], ['error', 'Hata'],
  ['mine', 'Benim'], ['raw', 'Zenginleşmemiş'], ['hard', 'Zorlananlar'], ['off', 'Askıda/Bilinen'],
];

export function render(root) {
  const input = h('input', { type: 'search', placeholder: 'Ara: kelime, anlam, cümle…', value: q, autocapitalize: 'off', autocorrect: 'off' });
  const listBox = h('div');
  const draw = () => {
    const nq = norm(q);
    const lapses = id => Math.max(0, ...[...S.items.values()].filter(i => i.noteId === id).map(i => i.c.lapses || 0));
    let rows = [...S.notes.values()].filter(n => {
      if (filter === 'off') { if (!n.suspended) return false; }
      else if (n.suspended && filter !== 'all') return false;
      if (filter === 'word' && n.type !== 'word') return false;
      if (filter === 'phrase' && n.type !== 'phrase') return false;
      if (filter === 'error' && n.type !== 'error') return false;
      if (filter === 'mine' && !['mine', 'writing'].includes(n.origin)) return false;
      if (filter === 'raw' && n.enriched) return false;
      if (filter === 'hard' && lapses(n.id) < 2) return false;
      if (!nq) return true;
      return norm([n.term, n.tr, n.defEn, n.context, n.wrong, n.correct, n.source, n.topic, ...(n.collocations || [])].join(' ')).includes(nq);
    });
    rows.sort(filter === 'hard' ? (a, b) => lapses(b.id) - lapses(a.id) : (a, b) => b.createdAt - a.createdAt);
    const total = rows.length;
    rows = rows.slice(0, limit);
    mount(listBox, 
      h('div', { class: 'small muted', style: { margin: '8px 2px' } }, `${total} kart`),
      rows.length ? h('div', { class: 'list' }, rows.map(row)) : h('div', { class: 'empty' }, q ? 'Sonuç yok.' : 'Henüz kart yok. “Ekle” sekmesinden başla.'),
      total > limit ? h('button', { class: 'btn block', style: { marginTop: '10px' }, onclick: () => { limit += 200; draw(); } }, 'Daha fazla göster') : null,
    );
  };
  input.addEventListener('input', () => { q = input.value; limit = 100; draw(); });
  mount(root, 
    h('h1', null, 'Liste'),
    input,
    h('div', { class: 'chips', style: { margin: '10px 0 0' } }, FILTERS.map(([k, l]) =>
      h('button', { class: `chip${filter === k ? ' on' : ''}`, onclick: () => { filter = k; limit = 100; render(root); } }, l))),
    listBox,
  );
  draw();
}

function row(n) {
  const [label, cls] = stateLabel(n);
  const due = nextDue(n);
  const isErr = n.type === 'error';
  return h('a', { class: 'li', href: `#/note/${n.id}` },
    h('div', { class: 'grow' },
      h('div', { class: 't' }, isErr ? `✗ ${n.wrong}` : n.term),
      h('div', { class: 's' }, isErr ? (n.correct ? `✓ ${n.correct}` : 'düzeltme bekliyor') : (n.tr || n.defEn || (n.enriched ? '' : 'zenginleştirilmedi'))),
    ),
    h('div', { style: { textAlign: 'right' } },
      h('span', { class: `badge ${isErr ? 'err' : cls}` }, isErr ? 'Hata' : label),
      due ? h('div', { class: 'small muted', style: { marginTop: '3px' } }, fmtDate(due)) : null,
    ),
  );
}
