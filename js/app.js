import { loadAll, S, saveMeta, saveSettings, deleteNote, requestPersistence } from './store.js';
import { initScheduler, importPoolEntries } from './srs.js';
import { backfillDictionary } from './dict.js';
import { unlockAudio } from './tts.js';
import { PHRASES, PHRASES_VERSION } from './data/phrases.js';
import { TOPIC_WORDS, TOPICS_VERSION } from './data/topics.js';
import { ERROR_CARDS, ERRORS_VERSION } from './data/errors.js';
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

// Built-in pools ship with the app; each is (re)imported once per version.
const BUILTIN_POOLS = [
  ['topics', TOPICS_VERSION, TOPIC_WORDS],
  ['errors', ERRORS_VERSION, ERROR_CARDS],
  ['phrases', PHRASES_VERSION, PHRASES],
];

async function seedPools() {
  const seeded = S.meta.seeded || (S.meta.seeded = {});
  if (S.meta.phrasesVersion && !seeded.phrases) seeded.phrases = S.meta.phrasesVersion; // v1.0 bookkeeping
  let changed = false;
  for (const [key, version, entries] of BUILTIN_POOLS) {
    if (seeded[key] === version) continue;
    await importPoolEntries(entries);
    seeded[key] = version;
    changed = true;
  }
  // v1.1: ready-made pools get priority over the raw AWL/Oxford lists, unless the user changed the weights
  if (!S.meta.weightsV2) {
    const w = S.settings.poolWeights;
    if (w.awl === 2 && w.oxford === 2 && w.phrases === 1) { w.awl = 1; w.oxford = 1; await saveSettings(); }
    S.meta.weightsV2 = true;
    changed = true;
  }
  if (changed) await saveMeta();
}

// v1.1.1: v1.1.0 could accept the writing prompt's own JSON template as feedback, which created an
// error card with placeholder text. Remove any such card.
async function cleanUpTemplateCards() {
  const junk = [...S.notes.values()].filter(n => n.type === 'error' && n.wrong === 'exact erroneous fragment copied from the text');
  for (const n of junk) await deleteNote(n.id);
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
    // Browsers don't reliably re-check sw.js when a home-screen app is launched, so check on every start.
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

(async function main() {
  await loadAll();
  initScheduler();
  await seedPools();
  await cleanUpTemplateCards();
  if (!S.meta.installedAt) { S.meta.installedAt = Date.now(); await saveMeta(); }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('hashchange', route);
  await route();
  registerSW();
  requestPersistence();
  backfillDictionary();
  window.addEventListener('online', () => backfillDictionary());
})();
