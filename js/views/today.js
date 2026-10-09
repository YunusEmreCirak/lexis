import { S } from '../store.js';
import { dueCounts, topUpFromPool, streak, addNote, State } from '../srs.js';
import { pendingEnrichment } from '../prompts.js';
import { enrichFromDictionary } from '../dict.js';
import { h, mount, toast, DAY } from '../util.js';
import { termExists } from '../store.js';
import { unlockAudio } from '../tts.js';

const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function render(root) {
  await topUpFromPool();
  const c = dueCounts();
  const st = streak();
  const name = S.settings.name || '';
  const hour = new Date().getHours();
  const hello = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';

  const notes = [...S.notes.values()];
  const active = notes.filter(n => !n.suspended);
  const mature = active.filter(n => {
    const its = [...S.items.values()].filter(i => i.noteId === n.id && i.introduced);
    return its.length && its.every(i => (i.c.stability || 0) >= 21);
  }).length;
  const pend = pendingEnrichment(999);
  const pendOwn = pend.ownTotal;

  let examLine = null;
  if (S.settings.examDate) {
    const days = Math.ceil((new Date(S.settings.examDate) - Date.now()) / DAY);
    if (days >= 0) examLine = h('span', { class: 'chip' }, `IELTS'e ${days} gün`);
  }

  const quick = h('input', { type: 'text', placeholder: 'Hızlı ekle: kelime veya kalıp…', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', enterkeyhint: 'done' });
  const doQuick = async () => {
    const term = quick.value.trim();
    if (!term) return;
    const ex = termExists(term);
    if (ex) { toast(`“${ex.term}” zaten listende`); return; }
    const n = await addNote({ term, type: /\s/.test(term) ? 'phrase' : 'word' }, 'mine');
    quick.value = '';
    toast(`“${term}” eklendi`);
    enrichFromDictionary(n);
    render(root);
  };
  quick.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doQuick(); } });

  const lastBackup = S.meta.lastBackup || 0;
  const ownCount = notes.filter(n => n.origin === 'mine' || n.origin === 'writing').length;
  const studied = (S.meta.studyDays || []).length;
  const needBackup = (ownCount >= 5 || studied >= 2) && Date.now() - lastBackup > 7 * DAY;

  const wroteRecently = (S.meta.lastWriting || 0) > Date.now() - 7 * DAY;
  const learnedCount = [...S.items.values()].filter(i => i.introduced && i.c.state === State.Review).length;

  mount(root, 
    h('div', { class: 'header' },
      h('div', null, h('div', { class: 'muted small' }, new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })), h('h1', null, `${hello}${name ? ', ' + name : ''}`)),
      h('div', { class: 'row' }, st > 0 ? h('span', { class: 'chip', title: 'Seri' }, `🔥 ${st}`) : null),
    ),
    examLine ? h('div', { class: 'row', style: { marginTop: '6px' } }, examLine) : null,

    !isStandalone() && isIOS() ? h('div', { class: 'card warn' },
      h('b', null, 'Ana ekrana ekle'),
      h('div', { class: 'small' }, 'Safari’de Paylaş ⬆︎ → “Ana Ekrana Ekle”. Böylece uygulama tam ekran açılır ve verilerin kalıcı olur.')) : null,

    h('div', { class: 'card hero' },
      h('div', { class: 'grid4', style: { textAlign: 'center' } },
        kpi(c.fresh, 'yeni'), kpi(c.learn, 'öğrenme'), kpi(c.review, 'tekrar'), kpi(`~${Math.ceil(((c.fresh + c.learn) * 3 + c.review) * 12 / 60)}`, 'dakika')),
      h('div', { style: { marginTop: '16px' } },
        c.total
          ? h('button', { class: 'btn primary block', style: { minHeight: '52px', fontSize: '17px' }, onclick: () => { unlockAudio(); location.hash = '#/study'; } }, `Çalışmaya başla · ${c.total}`)
          : h('div', { class: 'center', style: { fontWeight: 600 } }, active.length ? 'Bugünlük her şey tamam 🎉' : 'İlk kelimeni ekleyerek başla 👇'),
      ),
    ),

    h('div', { class: 'row' }, h('div', { class: 'grow' }, quick), h('button', { class: 'btn primary', onclick: doQuick }, 'Ekle')),

    pend.list.length ? h('a', { class: 'card', href: '#/enrich', style: { display: 'block', textDecoration: 'none', color: 'inherit' } },
      h('div', { class: 'row between' },
        h('div', null, h('b', null, '✨ Claude ile zenginleştir'),
          h('div', { class: 'small muted' }, pendOwn ? `${pendOwn} kartta Türkçe anlam, collocation ve örnek eksik` : 'Sıradaki havuz kelimelerini önceden hazırla')),
        h('span', { class: 'badge new' }, pendOwn || pend.list.length))) : null,

    needBackup ? h('a', { class: 'card warn', href: '#/profile', style: { display: 'block', textDecoration: 'none', color: 'inherit' } },
      h('b', null, '💾 Yedek alma zamanı'),
      h('div', { class: 'small' }, lastBackup ? `Son yedek ${Math.floor((Date.now() - lastBackup) / DAY)} gün önce.` : 'Henüz hiç yedek almadın.', ' Profil → Yedekle ile iCloud Drive’a kaydet.')) : null,

    !wroteRecently && learnedCount >= 8 ? h('a', { class: 'card', href: '#/write', style: { display: 'block', textDecoration: 'none', color: 'inherit' } },
      h('b', null, '✍️ Haftalık yazma görevi'),
      h('div', { class: 'small muted' }, 'Öğrendiğin kelimelerle kısa bir paragraf yaz, Claude değerlendirsin. Hataların hata defterine eklenir.')) : null,

    h('div', { class: 'grid2', style: { marginTop: '12px' } },
      h('div', { class: 'card soft', style: { margin: 0 } }, kpi(active.length, 'aktif kart')),
      h('div', { class: 'card soft', style: { margin: 0 } }, kpi(mature, 'olgun (21+ gün)'))),

    !notes.length && !S.pool.size ? welcome() : null,
  );
}

function kpi(v, label) {
  return h('div', null, h('div', { class: 'kpi' }, v), h('div', { class: 'kpi-label' }, label));
}

function welcome() {
  return h('div', { class: 'card' },
    h('h3', { style: { marginTop: 0 } }, 'Lexis’e hoş geldin'),
    h('ol', { class: 'steps' },
      h('li', null, h('b', null, 'Kelime/kalıp ekle. '), 'Okurken ya da dinlerken bilmediğin her şeyi “Ekle” sekmesinden, karşılaştığın cümleyle birlikte kaydet.'),
      h('li', null, h('b', null, 'Zenginleştir. '), 'Haftada bir “Claude ile zenginleştir” ile Türkçe anlam, collocation ve boşluk doldurma cümleleri ekle.'),
      h('li', null, h('b', null, 'Her gün çalış. '), 'FSRS algoritması her kartı unutmak üzereyken tekrar gösterir. Günde 15–25 dakika yeter.'),
      h('li', null, h('b', null, 'Havuz (isteğe bağlı). '), 'Profil → Havuz paketi ile AWL ve Oxford B2–C1 listelerini yükle. Kendi kelimen az olduğu günlerde açığı onlar kapatır.'),
    ),
  );
}
