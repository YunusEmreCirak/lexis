// Stats, settings, backup/restore, pool pack.
import { S, idb, saveSettings, saveMeta, exportAll, importAll, requestPersistence } from '../store.js';
import { streak, State, initScheduler, importPoolEntries, POOL_SOURCES } from '../srs.js';
import { h, mount, toast, dayKey, DAY, download, fmtDate } from '../util.js';
import { APP_VERSION } from '../version.js';

export async function render(root) {
  const since = Date.now() - 120 * DAY;
  const logs = await idb.logsSince(since);
  const ds = S.settings.dayStart;

  // ---- numbers
  const notes = [...S.notes.values()];
  const active = notes.filter(n => !n.suspended);
  const its = [...S.items.values()].filter(i => i.introduced);
  const mature = its.filter(i => (i.c.stability || 0) >= 21).length;
  const last30 = logs.filter(l => l.ts > Date.now() - 30 * DAY && l.stateBefore === State.Review);
  const retention = last30.length ? Math.round((last30.filter(l => l.rating > 1).length / last30.length) * 100) : null;
  const byDay = new Map();
  for (const l of logs) { const k = dayKey(l.ts, ds); byDay.set(k, (byDay.get(k) || 0) + 1); }
  const todayKey = dayKey(Date.now(), ds);
  const minutesToday = Math.round(logs.filter(l => dayKey(l.ts, ds) === todayKey).reduce((s, l) => s + Math.min(l.ms || 0, 60000), 0) / 60000);

  // ---- heatmap (17 weeks, columns = weeks, rows = Mon..Sun)
  const cells = [];
  const start = new Date(); start.setHours(12, 0, 0, 0);
  const dow = (start.getDay() + 6) % 7;
  const first = start.getTime() - (16 * 7 + dow) * DAY;
  for (let t = first; t <= start.getTime(); t += DAY) {
    const k = dayKey(t + ds * 3600000, ds);
    const c = byDay.get(k) || 0;
    const lvl = c === 0 ? '' : c < 20 ? 'h1' : c < 50 ? 'h2' : c < 100 ? 'h3' : 'h4';
    cells.push(h('i', { class: lvl, title: `${k}: ${c}` }));
  }

  // ---- 7-day forecast
  const fc = [];
  for (let d = 0; d < 7; d++) {
    const from = d === 0 ? 0 : startOfDay(Date.now() + d * DAY, ds);
    const to = startOfDay(Date.now() + (d + 1) * DAY, ds);
    fc.push(its.filter(i => i.c.due >= from && i.c.due < to && i.c.state !== State.New).length);
  }
  const fmax = Math.max(1, ...fc);

  // ---- leeches
  const lapsesBy = new Map();
  for (const i of its) lapsesBy.set(i.noteId, Math.max(lapsesBy.get(i.noteId) || 0, i.c.lapses || 0));
  const leeches = [...lapsesBy.entries()].filter(([, l]) => l >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, l]) => [S.notes.get(id), l]).filter(([n]) => n);

  const persisted = await requestPersistence();
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(1)} MB kullanılıyor`; } catch {}

  const pc = {};
  for (const p of S.pool.values()) pc[p.src] = (pc[p.src] || 0) + 1;

  mount(root, 
    h('div', { class: 'header' },
      h('div', null, h('div', { class: 'muted small' }, S.settings.target), h('h1', null, S.settings.name || 'Profil')),
      h('span', { class: 'chip' }, `🔥 ${streak()} gün`)),

    h('div', { class: 'grid2', style: { marginTop: '12px' } },
      stat(active.length, 'aktif kart'), stat(mature, 'olgun öğe (21+ gün)'),
      stat(retention == null ? '–' : `%${retention}`, 'gerçek hatırlama (30 gün)'), stat(`${minutesToday} dk`, 'bugün çalışma')),

    h('h2', null, 'Son 17 hafta'),
    h('div', { class: 'card' }, h('div', { class: 'heat' }, cells)),

    h('h2', null, 'Önümüzdeki 7 gün'),
    h('div', { class: 'card' }, h('div', { class: 'bars' }, fc.map((v, d) =>
      h('div', { class: 'b' }, h('span', null, v), h('i', { style: { height: `${Math.round((v / fmax) * 70)}px` } }),
        h('span', null, d === 0 ? 'bugün' : new Date(Date.now() + d * DAY).toLocaleDateString('tr-TR', { weekday: 'short' })))))),

    leeches.length ? h('div', null, h('h2', null, 'En çok zorlandıkların'),
      h('div', { class: 'list' }, leeches.map(([n, l]) => h('a', { class: 'li', href: `#/note/${n.id}` },
        h('div', { class: 'grow' }, h('div', { class: 't' }, n.type === 'error' ? n.wrong : n.term), h('div', { class: 's' }, n.tr || n.correct || '')),
        h('span', { class: 'badge err' }, `${l}× unutuldu`)))),
      h('p', { class: 'small muted' }, 'İpucu: bu kartlara kendi hafıza ipucunu ya da kendi cümleni ekle; bağlam zenginleştikçe “sızıntı” azalır.')) : null,

    h('h2', null, 'Ayarlar'),
    h('div', { class: 'card' }, settingsForm(root)),

    h('h2', null, 'Kelime havuzu'),
    h('div', { class: 'card' },
      ...POOL_SOURCES.map(k => h('div', { class: 'switch' },
        h('span', null, POOL_LABELS[k], h('div', { class: 'small muted' }, pc[k] ? `${pc[k]} kart bekliyor` : k === 'awl' || k === 'oxford' ? 'paket yüklenmedi / bitti' : 'tamamlandı')),
        h('div', { class: 'row' },
          h('select', { style: { minWidth: '70px' }, onchange: async e => { S.settings.poolWeights[k] = +e.target.value; await saveSettings(); } },
            [1, 2, 3].map(w => h('option', { value: w, selected: S.settings.poolWeights[k] === w }, `×${w}`))),
          h('input', { type: 'checkbox', checked: !!S.settings.pools[k], onchange: async e => { S.settings.pools[k] = e.target.checked; await saveSettings(); } })))),
      h('p', { class: 'small muted' }, 'Havuz sadece günlük yeni kart kotan kendi kelimelerinle dolmadığında devreye girer. ×2 = o kaynaktan iki kat sık.'),
      fileButton('Havuz paketini yükle (.json)', async data => {
        if (data?.lexis !== 'pool') throw new Error('Bu bir Lexis havuz paketi değil.');
        const n = await importPoolEntries(data.entries || []);
        toast(`${n} havuz kelimesi yüklendi`);
        render(root);
      }),
    ),

    h('h2', null, 'Veri ve yedek'),
    h('div', { class: 'card' },
      h('div', { class: 'small muted' }, `Tüm veriler sadece bu cihazda. ${usage}. Kalıcı depolama: ${persisted ? 'açık ✓' : 'tarayıcı onaylamadı'}.`),
      h('div', { class: 'small muted', style: { marginTop: '4px' } }, S.meta.lastBackup ? `Son yedek: ${fmtDate(S.meta.lastBackup)}` : 'Henüz yedek alınmadı.'),
      h('div', { class: 'stack', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary block', onclick: backup }, 'Yedekle (iCloud Drive / Dosyalar)'),
        fileButton('Yedekten geri yükle', async data => {
          if (!confirm('Mevcut tüm veriler yedektekiyle DEĞİŞTİRİLECEK. Devam edilsin mi?')) return;
          await importAll(data);
          initScheduler();
          toast('Yedek geri yüklendi');
          render(root);
        }),
      )),

    h('p', { class: 'small muted center', style: { marginTop: '24px' } }, `Lexis v${APP_VERSION} · FSRS (ts-fsrs) · Sözlük: dictionaryapi.dev, Datamuse`),
  );
}

const POOL_LABELS = {
  topics: 'IELTS konu kelimeleri (16 konu)',
  errors: 'Türk öğrencilerin tipik hataları',
  phrases: 'IELTS akademik kalıplar',
  awl: 'Academic Word List',
  oxford: 'Oxford 5000 (B2–C1)',
};

function startOfDay(ts, ds) {
  const d = new Date(ts - ds * 3600000); d.setHours(0, 0, 0, 0);
  return d.getTime() + ds * 3600000;
}

const stat = (v, l) => h('div', { class: 'card soft', style: { margin: 0 } }, h('div', { class: 'kpi' }, v), h('div', { class: 'kpi-label' }, l));

function fileButton(label, onData) {
  const inp = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try { await onData(JSON.parse(await f.text())); }
    catch (e) { toast(`Hata: ${e.message}`, 4000); }
    inp.value = '';
  });
  return h('div', null, inp, h('button', { class: 'btn block', onclick: () => inp.click() }, label));
}

async function backup() {
  const data = await exportAll();
  const name = `lexis-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  const text = JSON.stringify(data);
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Lexis yedeği' });
    else download(name, text);
  } catch (e) {
    if (e.name === 'AbortError') return;
    download(name, text);
  }
  S.meta.lastBackup = Date.now();
  await saveMeta();
  toast('Yedek hazır');
}

function settingsForm(root) {
  const s = S.settings;
  const set = async (k, v) => { s[k] = v; await saveSettings(); if (k === 'retention') initScheduler(); };
  const num = (k, min, max, step = 1) => h('input', { type: 'number', min, max, step, value: s[k], inputmode: 'numeric', onchange: e => set(k, Math.min(max, Math.max(min, +e.target.value || min))) });
  return h('div', null,
    row('Adın', h('input', { type: 'text', value: s.name, onchange: e => set('name', e.target.value.trim()) })),
    row('Hedef', h('input', { type: 'text', value: s.target, onchange: e => set('target', e.target.value.trim()) })),
    row('Sınav tarihi', h('input', { type: 'date', value: s.examDate, onchange: e => set('examDate', e.target.value) })),
    row('Günlük yeni kart', num('newPerDay', 0, 60)),
    row('Günlük en fazla tekrar', num('maxReviews', 20, 999, 10)),
    row('Hedef hatırlama', h('select', { onchange: e => set('retention', +e.target.value) },
      [[0.85, '%85 · az tekrar'], [0.9, '%90 · önerilen'], [0.93, '%93 · sınav öncesi'], [0.95, '%95 · yoğun']].map(([v, l]) => h('option', { value: v, selected: s.retention === v }, l)))),
    row('Aksan', h('select', { onchange: e => set('accent', e.target.value) },
      [['en-GB', 'İngiliz (IELTS)'], ['en-US', 'Amerikan']].map(([v, l]) => h('option', { value: v, selected: s.accent === v }, l)))),
    row('Sesi otomatik çal', h('input', { type: 'checkbox', checked: s.autoplay, onchange: e => set('autoplay', e.target.checked) })),
    row('“Dinle & yaz” oranı', h('select', { onchange: e => set('listenShare', +e.target.value) },
      [[0, 'kapalı'], [0.15, '%15'], [0.3, '%30'], [0.5, '%50']].map(([v, l]) => h('option', { value: v, selected: s.listenShare === v }, l)))),
    row('Gün başlangıcı', h('select', { onchange: e => set('dayStart', +e.target.value) },
      [0, 2, 3, 4, 5, 6].map(v => h('option', { value: v, selected: s.dayStart === v }, `${String(v).padStart(2, '0')}:00`)))),
  );
}
const row = (label, ctl) => h('label', { class: 'switch' }, h('span', null, label), ctl);
