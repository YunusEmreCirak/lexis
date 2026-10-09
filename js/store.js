// Persistence: IndexedDB on the device, mirrored into memory at startup.
// Data volume is personal-scale (a few thousand notes), so keeping everything in Maps is fine.

const DB_NAME = 'lexis';
const DB_VER = 1;
const STORES = ['notes', 'items', 'logs', 'kv', 'writings', 'pool'];

let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' }).createIndex('noteId', 'noteId');
      if (!d.objectStoreNames.contains('logs')) d.createObjectStore('logs', { keyPath: 'id', autoIncrement: true }).createIndex('ts', 'ts');
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('writings')) d.createObjectStore('writings', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('pool')) d.createObjectStore('pool', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
function done(tx) { return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); }

export const idb = {
  getAll: store => wrap(db.transaction(store).objectStore(store).getAll()),
  put: (store, v) => wrap(db.transaction(store, 'readwrite').objectStore(store).put(v)),
  del: (store, k) => wrap(db.transaction(store, 'readwrite').objectStore(store).delete(k)),
  async putMany(store, vals) {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of vals) os.put(v);
    return done(tx);
  },
  async delMany(store, keys) {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const k of keys) os.delete(k);
    return done(tx);
  },
  async clearAll() {
    const tx = db.transaction(STORES, 'readwrite');
    for (const s of STORES) tx.objectStore(s).clear();
    return done(tx);
  },
  logsSince: ts => wrap(db.transaction('logs').objectStore('logs').index('ts').getAll(IDBKeyRange.lowerBound(ts))),
};

export const DEFAULT_SETTINGS = {
  name: 'Yunus',
  target: 'IELTS Academic 6.5+ (C1)',
  examDate: '',
  newPerDay: 12,
  maxReviews: 200,
  retention: 0.9,
  accent: 'en-GB',
  autoplay: true,
  listenShare: 0.3,
  dayStart: 4,
  pools: { topics: true, errors: true, phrases: true, awl: true, oxford: true },
  poolWeights: { topics: 2, errors: 1, phrases: 1, awl: 1, oxford: 1 },
  enrichBatch: 20,
};

// In-memory state
export const S = {
  notes: new Map(),
  items: new Map(),
  pool: new Map(),
  settings: structuredClone(DEFAULT_SETTINGS),
  meta: {},
};

export async function loadAll() {
  db = await openDB();
  const [notes, items, kv, pool] = await Promise.all([idb.getAll('notes'), idb.getAll('items'), idb.getAll('kv'), idb.getAll('pool')]);
  S.notes = new Map(notes.map(n => [n.id, n]));
  S.items = new Map(items.map(i => [i.id, i]));
  S.pool = new Map(pool.map(p => [p.id, p]));
  const kvMap = Object.fromEntries(kv.map(r => [r.k, r.v]));
  S.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(kvMap.settings || {}) };
  S.settings.pools = { ...DEFAULT_SETTINGS.pools, ...(kvMap.settings?.pools || {}) };
  S.settings.poolWeights = { ...DEFAULT_SETTINGS.poolWeights, ...(kvMap.settings?.poolWeights || {}) };
  S.meta = kvMap.meta || {};
}

export async function saveNote(n) { n.updatedAt = Date.now(); S.notes.set(n.id, n); await idb.put('notes', n); }
export async function saveItem(i) { S.items.set(i.id, i); await idb.put('items', i); }
export async function saveItems(list) { for (const i of list) S.items.set(i.id, i); await idb.putMany('items', list); }
export async function savePool(list) { for (const p of list) S.pool.set(p.id, p); await idb.putMany('pool', list); }
export async function deletePool(ids) { for (const id of ids) S.pool.delete(id); await idb.delMany('pool', ids); }
export async function saveSettings() { await idb.put('kv', { k: 'settings', v: S.settings }); }
export async function saveMeta() { await idb.put('kv', { k: 'meta', v: S.meta }); }
export async function addLog(log) { return idb.put('logs', log); }
export async function deleteLog(id) { return idb.del('logs', id); }
export async function saveWriting(w) { return idb.put('writings', w); }
export async function allWritings() { return (await idb.getAll('writings')).sort((a, b) => b.createdAt - a.createdAt); }

export async function deleteNote(id) {
  const itemIds = [...S.items.values()].filter(i => i.noteId === id).map(i => i.id);
  S.notes.delete(id);
  itemIds.forEach(k => S.items.delete(k));
  await idb.del('notes', id);
  await idb.delMany('items', itemIds);
}

export function itemsOf(noteId) {
  return [...S.items.values()].filter(i => i.noteId === noteId);
}

export function termExists(term) {
  const t = term.trim().toLowerCase();
  for (const n of S.notes.values()) if ((n.term || '').toLowerCase() === t) return n;
  return null;
}

// ---------- backup ----------
export async function exportAll() {
  const [notes, items, logs, kv, writings, pool] = await Promise.all(STORES.map(s => idb.getAll(s)));
  return { lexis: 'backup', v: 1, exportedAt: new Date().toISOString(), notes, items, logs, kv, writings, pool };
}

export async function importAll(data) {
  if (data?.lexis !== 'backup') throw new Error('Bu dosya bir Lexis yedeği değil.');
  await idb.clearAll();
  for (const s of STORES) if (Array.isArray(data[s]) && data[s].length) await idb.putMany(s, data[s]);
  await loadAll();
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted();
      return already || (await navigator.storage.persist());
    }
  } catch {}
  return false;
}
