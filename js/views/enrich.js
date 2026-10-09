// Copy prompt → Claude → paste JSON back.
import { S, saveSettings } from '../store.js';
import { pendingEnrichment, buildEnrichPrompt, extractJSON, applyEnrichment } from '../prompts.js';
import { h, mount, toast, copyText, readClipboard } from '../util.js';

let lastBatch = null;

export function render(root) {
  const size = S.settings.enrichBatch;
  const { list, ownTotal } = pendingEnrichment(size);
  const prompt = list.length ? buildEnrichPrompt(list) : '';
  const paste = h('textarea', { rows: 5, placeholder: 'Claude’un cevabını buraya yapıştır (```json … ``` dahil olabilir)', spellcheck: false, autocapitalize: 'off' });
  const result = h('div');

  const apply = async text => {
    try {
      const json = extractJSON(text);
      const r = await applyEnrichment(json);
      mount(result, h('div', { class: 'verdict ok' }, `✓ ${r.notes} kart${r.pools ? ` + ${r.pools} havuz kelimesi` : ''} güncellendi${r.skipped.length ? ` · ${r.skipped.length} eşleşmeyen atlandı` : ''}`));
      toast('Zenginleştirme uygulandı');
      paste.value = '';
      setTimeout(() => render(root), 1400);
    } catch (e) {
      mount(result, h('div', { class: 'verdict bad' }, `Okunamadı: ${e.message}`, h('div', { class: 'small', style: { fontWeight: 400 } }, 'Claude’dan sadece JSON bloğunu döndürmesini isteyip tekrar dene.')));
    }
  };

  mount(root, 
    h('div', { class: 'row between' },
      h('a', { class: 'btn ghost', style: { paddingLeft: 0 }, href: '#/today' }, '‹ Bugün'),
      h('select', { style: { width: 'auto' }, onchange: async e => { S.settings.enrichBatch = +e.target.value; await saveSettings(); render(root); } },
        [10, 20, 30, 40].map(n => h('option', { value: n, selected: n === size }, `${n}'lu paket`)))),
    h('h1', null, 'Claude ile zenginleştir'),
    h('p', { class: 'muted small' },
      'API anahtarı gerekmez: komutu kopyala, Claude’a (iPhone uygulaması, claude.ai ya da bilgisayarda Claude Code) yapıştır, gelen cevabı buraya geri yapıştır. ',
      ownTotal ? `${ownTotal} kendi kartın bekliyor.` : 'Kendi kartların tamam; sıradaki havuz kelimeleri önceden hazırlanabilir.'),

    list.length ? h('div', null,
      h('div', { class: 'chips', style: { margin: '10px 0' } }, list.map(e => h('span', { class: `chip${e.kind === 'pool' ? '' : ' on'}` }, e.obj.type === 'error' ? `✗ ${e.obj.wrong.slice(0, 28)}…` : e.obj.term))),
      h('ol', { class: 'steps' },
        h('li', null, h('b', null, 'Komutu kopyala'), h('div', { class: 'small muted' }, `${list.length} öğe tek seferde.`),
          h('div', { class: 'row', style: { marginTop: '8px' } },
            h('button', { class: 'btn primary', onclick: async () => { lastBatch = list.map(e => e.id); toast((await copyText(prompt)) ? 'Komut kopyalandı' : 'Kopyalanamadı — aşağıdan elle seç'); } }, 'Komutu kopyala'),
            h('a', { class: 'btn', href: 'https://claude.ai/new', target: '_blank', rel: 'noopener' }, 'Claude’u aç ↗')),
          h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'small' }, 'Komutu göster'), h('pre', { class: 'prompt-box' }, prompt))),
        h('li', null, h('b', null, 'Claude’a yapıştır ve gönder'), h('div', { class: 'small muted' }, 'Cevap bir JSON kod bloğu olacak. Tamamını kopyala (kod bloğunun sağ üstündeki kopyala düğmesi).')),
        h('li', null, h('b', null, 'Cevabı buraya yapıştır'),
          h('div', { class: 'row', style: { margin: '8px 0' } },
            h('button', { class: 'btn primary', onclick: async () => { const t = await readClipboard(); if (t) apply(t); else toast('Pano okunamadı — aşağıya elle yapıştır'); } }, 'Panodan uygula')),
          paste,
          h('button', { class: 'btn block', style: { marginTop: '8px' }, onclick: () => apply(paste.value) }, 'Yapıştırdığımı uygula'),
          result),
      ),
    ) : h('div', { class: 'empty' }, '✨ Zenginleştirilecek kart kalmadı.'),
  );
}
