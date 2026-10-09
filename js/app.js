import { loadAll, S, saveMeta, requestPersistence } from './store.js';
import { initScheduler, importPoolEntries } from './srs.js';
import { backfillDictionary } from './dict.js';
import { unlockAudio } from './tts.js';
import { PHRASES, PHRASES_VERSION } from './data/phrases.js';
import { h } from './util.js';
import * as today from './views/today.js';
import * as study from './views/study.js';
import * as add from './views/add.js';
import * as list from './views/list.js';
import * as note from './views/note.js';
import * as enrich from './views/enrich.js';
import * as write from './views/write.js';
import * as profile from './views/profile.js';

const routes = { today, study, add, list, note, enrich, write, profile };
const tabOf = { today: 'today', study: 'today', enrich: 'today', add: 'add', list: 'list', note: 'list', write: 'write', profile: 'profile' };
const view = document.getElementById('view');
let current = null;

async function route() {
  const [, name = 'today', arg] = location.hash.replace(/^#/, '').split('/');
  const mod = routes[name] || today;
  if (current && current !== mod && current.leave) current.leave();
  current = mod;
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tabOf[name]));
  try {
    await mod.render(view, arg ? decodeURIComponent(arg) : undefined);
  } catch (e) {
    console.error(e);
    view.replaceChildren(h('div', { class: 'card warn' }, h('b', null, 'Bir hata oluştu'), h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, String(e?.stack || e))));
  }
  if (name !== 'study') window.scrollTo(0, 0);
}

async function seedPhrases() {
  if (S.meta.phrasesVersion === PHRASES_VERSION) return;
  await importPoolEntries(PHRASES);
  S.meta.phrasesVersion = PHRASES_VERSION;
  await saveMeta();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const prompt = () => {
      if (document.querySelector('.update-bar')) return;
      document.body.append(h('div', { class: 'update-bar' },
        h('div', { class: 'grow small' }, 'Lexis’in yeni sürümü hazır.'),
        h('button', { class: 'btn primary', onclick: () => reg.waiting?.postMessage('skipWaiting') }, 'Güncelle')));
    };
    if (reg.waiting && navigator.serviceWorker.controller) prompt();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

(async function main() {
  await loadAll();
  initScheduler();
  await seedPhrases();
  if (!S.meta.installedAt) { S.meta.installedAt = Date.now(); await saveMeta(); }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('hashchange', route);
  await route();
  registerSW();
  requestPersistence();
  backfillDictionary();
  window.addEventListener('online', () => backfillDictionary());
})();
