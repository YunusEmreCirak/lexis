// Scheduling: FSRS (ts-fsrs) + daily queue, sibling burying, pool top-up.
//
// Each note produces SRS "items":
//   word / phrase → 'recog' (see/hear → recall meaning) and 'prod' (meaning/cloze → type the English)
//   error         → 'fix'   (see the wrong sentence → write the correct one)
// The 'prod' item is created only after the first 'recog' review and starts the next day,
// so a brand-new word is first met receptively, then produced.

import { fsrs, generatorParameters, createEmptyCard, State, Rating } from './vendor/ts-fsrs.mjs';
import { S, saveItem, saveItems, saveNote, saveMeta, addLog, deleteLog, savePool, deletePool, idb } from './store.js';
import { uid, dayKey, nextDayStart, shuffle } from './util.js';

export { State, Rating };
let F;

export function initScheduler() {
  F = fsrs(generatorParameters({
    request_retention: S.settings.retention,
    maximum_interval: 3650,
    enable_fuzz: true,
    enable_short_term: true,
  }));
}

const toStore = c => ({ ...c, due: +new Date(c.due), last_review: c.last_review ? +new Date(c.last_review) : null });

export function newItem(noteId, kind, now = Date.now(), introduced = false) {
  return { id: `${noteId}:${kind}`, noteId, kind, introduced, c: toStore(createEmptyCard(new Date(now))) };
}

export const OWN = new Set(['mine', 'writing']);

export function createNote(fields, origin = 'mine') {
  const now = Date.now();
  const note = {
    id: uid('n'),
    type: 'word',
    term: '',
    tr: '', defEn: '', pos: '', ipa: '', audio: '',
    examples: [], cloze: [], collocations: [], synonyms: [], antonyms: [],
    family: '', cefr: '', topic: '', source: '', context: '', mnemonic: '', note: '',
    wrong: '', correct: '', explanation: '', category: '',
    origin, enriched: false, dictFetched: false, suspended: false,
    createdAt: now, updatedAt: now,
    ...fields,
  };
  const items = note.type === 'error' ? [newItem(note.id, 'fix', now)] : [newItem(note.id, 'recog', now)];
  return { note, items };
}

export async function addNote(fields, origin) {
  const { note, items } = createNote(fields, origin);
  await saveNote(note);
  await saveItems(items);
  return note;
}

// ---------- day bookkeeping ----------
function today() { return dayKey(Date.now(), S.settings.dayStart); }
function dayCounter(key) {
  const d = today();
  if (!S.meta[key] || S.meta[key].day !== d) S.meta[key] = { day: d, count: 0, ids: [] };
  return S.meta[key];
}
export const newToday = () => dayCounter('newDay').count;
export const reviewsToday = () => dayCounter('revDay').count;
const touched = () => dayCounter('touched');

export function extraNewToday(n) { dayCounter('newDay').count -= n; return saveMeta(); }

// ---------- queue ----------
export function newCandidates() {
  const list = [];
  for (const it of S.items.values()) {
    if (it.introduced || it.kind === 'prod') continue;
    const n = S.notes.get(it.noteId);
    if (!n || n.suspended) continue;
    list.push({ it, own: OWN.has(n.origin), t: n.createdAt });
  }
  list.sort((a, b) => (b.own - a.own) || (a.t - b.t));
  return list.map(x => x.it);
}

export function newQuota() { return Math.max(0, S.settings.newPerDay - newToday()); }

export function buildQueue(now = Date.now()) {
  const end = nextDayStart(now, S.settings.dayStart);
  const t = new Set(touched().ids);
  const learning = [], reviews = [];
  for (const it of S.items.values()) {
    if (!it.introduced) continue;
    const n = S.notes.get(it.noteId);
    if (!n || n.suspended || it.suspended) continue;
    const st = it.c.state;
    if (st === State.Learning || st === State.Relearning) {
      if (it.c.due < end) learning.push(it);
    } else if (it.c.due <= (st === State.New ? now : end - 1)) {
      if (!t.has(it.noteId)) reviews.push(it);
    }
  }
  reviews.sort((a, b) => a.c.due - b.c.due);
  // one item per note per day (bury siblings)
  const seen = new Set(learning.map(i => i.noteId));
  const revs = [];
  for (const it of reviews) { if (!seen.has(it.noteId)) { seen.add(it.noteId); revs.push(it); } }
  const capped = revs.slice(0, Math.max(0, S.settings.maxReviews - reviewsToday()));
  const fresh = newCandidates().filter(i => !seen.has(i.noteId) && !t.has(i.noteId)).slice(0, newQuota());
  return { learning, reviews: capped, fresh };
}

export function dueCounts(now = Date.now()) {
  const q = buildQueue(now);
  return { learn: q.learning.length, review: q.reviews.length, fresh: q.fresh.length, total: q.learning.length + q.reviews.length + q.fresh.length };
}

// Interleave new cards evenly among reviews.
export function makeSession(now = Date.now()) {
  const q = buildQueue(now);
  const main = [];
  const revs = shuffle(q.reviews.slice(0, 30)).concat(q.reviews.slice(30));
  const k = q.fresh.length ? Math.max(1, Math.floor(revs.length / (q.fresh.length + 1))) : Infinity;
  let r = 0;
  for (const nw of q.fresh) { main.push(...revs.slice(r, r + k)); r += k; main.push(nw); }
  main.push(...revs.slice(r));
  return { learning: q.learning, main, done: 0, startTotal: main.length + q.learning.length, history: [] };
}

export function nextItem(sess, now = Date.now()) {
  const dueL = sess.learning.filter(i => i.c.due <= now).sort((a, b) => a.c.due - b.c.due);
  if (dueL.length) return dueL[0];
  if (sess.main.length) return sess.main[0];
  if (sess.learning.length) return [...sess.learning].sort((a, b) => a.c.due - b.c.due)[0];
  return null;
}

export function remaining(sess) {
  let n = 0, l = 0, r = 0;
  for (const i of sess.main) {
    if (!i.introduced || i.c.state === State.New) n++; else r++;
  }
  l = sess.learning.length;
  return { n, l, r };
}

export function preview(item, now = Date.now()) {
  const p = F.repeat(item.c, new Date(now));
  const out = {};
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) out[g] = +p[g].card.due - now;
  return out;
}

export async function answer(sess, item, rating, info = {}) {
  const now = Date.now();
  const before = structuredClone(item);
  const metaBefore = structuredClone({ newDay: S.meta.newDay, revDay: S.meta.revDay, touched: S.meta.touched, studyDays: S.meta.studyDays });
  const sessBefore = { learning: [...sess.learning], main: [...sess.main], done: sess.done };

  const res = F.next(item.c, new Date(now), rating);
  const wasNew = !item.introduced;
  item.c = toStore(res.card);
  item.introduced = true;
  await saveItem(item);

  if (wasNew) dayCounter('newDay').count++;
  dayCounter('revDay').count++;
  const days = S.meta.studyDays || (S.meta.studyDays = []);
  if (days[days.length - 1] !== today()) { days.push(today()); if (days.length > 800) days.splice(0, days.length - 800); }
  const tc = touched();
  if (!tc.ids.includes(item.noteId)) tc.ids.push(item.noteId);
  await saveMeta();

  // first recognition review → schedule the production sibling for tomorrow
  let createdProd = null;
  const note = S.notes.get(item.noteId);
  if (item.kind === 'recog' && note && note.type !== 'error' && !S.items.has(`${note.id}:prod`)) {
    createdProd = newItem(note.id, 'prod', nextDayStart(now, S.settings.dayStart), true);
    await saveItem(createdProd);
  }

  const logId = await addLog({
    itemId: item.id, noteId: item.noteId, kind: item.kind, variant: info.variant || '',
    rating, stateBefore: before.c.state, ts: now, ms: info.ms || 0,
    ivl: Math.round((item.c.due - now) / 86400000 * 10) / 10,
  });

  // session bookkeeping
  sess.main = sess.main.filter(i => i.id !== item.id && i.noteId !== item.noteId);
  sess.learning = sess.learning.filter(i => i.id !== item.id);
  const end = nextDayStart(now, S.settings.dayStart);
  if ((item.c.state === State.Learning || item.c.state === State.Relearning) && item.c.due < end) sess.learning.push(item);
  sess.done++;
  sess.history.push({ before, metaBefore, sessBefore, logId, createdProd });
  return item;
}

export async function undo(sess) {
  const h = sess.history.pop();
  if (!h) return null;
  await saveItem(h.before);
  if (h.createdProd) { S.items.delete(h.createdProd.id); await idb.del('items', h.createdProd.id); }
  await deleteLog(h.logId);
  Object.assign(S.meta, h.metaBefore);
  await saveMeta();
  const restored = S.items.get(h.before.id);
  sess.learning = h.sessBefore.learning.map(i => (i.id === restored.id ? restored : i));
  sess.main = h.sessBefore.main.map(i => (i.id === restored.id ? restored : i));
  if (!sess.main.includes(restored) && !sess.learning.includes(restored)) sess.main.unshift(restored);
  sess.done = h.sessBefore.done;
  return restored;
}

// "I already know this" for a new card: retire the note without spending the daily quota.
export async function markKnown(sess, item) {
  const n = S.notes.get(item.noteId);
  n.suspended = true; n.known = true;
  await saveNote(n);
  sess.main = sess.main.filter(i => i.noteId !== n.id);
  sess.learning = sess.learning.filter(i => i.noteId !== n.id);
  await topUpFromPool();
  const add = newCandidates().filter(i => !sess.main.includes(i)).slice(0, Math.max(0, newQuota() - sess.main.filter(i => !i.introduced).length));
  sess.main.push(...add);
}

// ---------- pool ----------
export const POOL_SOURCES = ['topics', 'errors', 'phrases', 'awl', 'oxford'];

function poolQueues() {
  const by = Object.fromEntries(POOL_SOURCES.map(s => [s, []]));
  for (const p of S.pool.values()) if (by[p.src]) by[p.src].push(p);
  for (const k in by) by[k].sort((a, b) => a.order - b.order);
  return by;
}

// The next k pool entries in the order they'd be introduced (weighted round-robin), without mutating.
export function upcomingPool(k) {
  const by = poolQueues();
  const cycle = [];
  for (const s of POOL_SOURCES) {
    if (!S.settings.pools[s]) continue;
    for (let i = 0; i < (S.settings.poolWeights[s] || 0); i++) cycle.push(s);
  }
  if (!cycle.length) return [];
  const idx = Object.fromEntries(POOL_SOURCES.map(s => [s, 0]));
  const out = [];
  let turn = S.meta.poolTurn || 0, guard = 0;
  while (out.length < k && guard < k * cycle.length + cycle.length) {
    const s = cycle[turn % cycle.length]; turn++; guard++;
    const p = by[s][idx[s]];
    if (p) { out.push(p); idx[s]++; }
    else if (cycle.every(c => !by[c][idx[c]])) break;
  }
  return out;
}

export async function topUpFromPool() {
  const need = newQuota() - newCandidates().length;
  if (need <= 0 || !S.pool.size) return 0;
  const picks = upcomingPool(need);
  let added = 0;
  for (const p of picks) {
    S.meta.poolTurn = (S.meta.poolTurn || 0) + 1;
    await idb.del('pool', p.id); S.pool.delete(p.id);
    if ([...S.notes.values()].some(n => (n.term || '').toLowerCase() === p.term.toLowerCase())) continue;
    const source = {
      awl: `AWL sublist ${p.sub}`,
      oxford: `Oxford 5000 · ${p.cefr}`,
      phrases: 'IELTS kalıpları',
      topics: `IELTS konu kelimeleri · ${p.data?.topic || ''}`,
      errors: 'Türk öğrencilerin tipik hataları',
    }[p.src] || '';
    await addNote({
      type: p.data?.type || (/\s/.test(p.term) ? 'phrase' : 'word'),
      term: p.term, pos: p.pos || '', cefr: p.cefr || '', source,
      ...(p.data || {}), enriched: !!p.data,
    }, p.src);
    added++;
  }
  await saveMeta();
  return added;
}

// The same word can appear in several sources (e.g. AWL and the topic list). Only one pool entry per
// term is kept, preferring the one that already carries enrichment data.
export async function importPoolEntries(entries) {
  const existing = new Set([...S.notes.values()].map(n => (n.term || '').toLowerCase()));
  const byTerm = new Map([...S.pool.values()].map(p => [p.term.toLowerCase(), p]));
  const list = [], drop = [];
  for (const e of entries) {
    if (!e?.term || !POOL_SOURCES.includes(e.src)) continue;
    const key = e.term.toLowerCase();
    const id = `p_${e.src}_${key.replace(/[^a-z0-9]+/g, '-')}`;
    if (existing.has(key)) continue;
    const prev = S.pool.get(id);
    const data = e.data || prev?.data || null;
    const other = byTerm.get(key);
    if (other && other.id !== id) {
      if (other.data || !data) continue;
      drop.push(other.id);
    }
    const entry = { id, term: e.term, pos: e.pos || '', cefr: e.cefr || '', sub: e.sub || 0, src: e.src, order: e.order ?? 0, data };
    byTerm.set(key, entry);
    list.push(entry);
  }
  if (drop.length) await deletePool(drop);
  await savePool(list);
  return list.length;
}

export function streak() {
  const days = new Set(S.meta.studyDays || []);
  const ds = S.settings.dayStart;
  let n = 0, t = Date.now();
  if (!days.has(dayKey(t, ds))) t -= 86400000; // today not done yet: streak continues from yesterday
  while (days.has(dayKey(t, ds))) { n++; t -= 86400000; }
  return n;
}

export function stateLabel(note) {
  if (note.suspended) return note.known ? ['Biliniyor', ''] : ['Askıda', ''];
  const its = [...S.items.values()].filter(i => i.noteId === note.id);
  if (!its.some(i => i.introduced)) return ['Yeni', 'new'];
  const minStab = Math.min(...its.filter(i => i.introduced).map(i => i.c.stability || 0));
  if (its.some(i => i.c.state === State.Learning || i.c.state === State.Relearning)) return ['Öğreniliyor', 'learn'];
  if (minStab >= 21) return ['Olgun', 'mature'];
  return ['Tekrarda', ''];
}

export function nextDue(note) {
  const its = [...S.items.values()].filter(i => i.noteId === note.id && i.introduced);
  return its.length ? Math.min(...its.map(i => i.c.due)) : null;
}
