// Free, key-less dictionary lookups, run in the background when a word is added.
// Primary: dictionaryapi.dev (IPA, recorded audio, definitions). Fallback: Datamuse (Wiktionary defs, IPA, frequency).

import { S, saveNote } from './store.js';

// Returns parsed JSON, null when the service answered "not found", undefined when it could not be reached.
async function getJSON(url, ms = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) return undefined;
    return await r.json();
  } catch { return undefined; }
  finally { clearTimeout(t); }
}

const POS = { noun: 'noun', verb: 'verb', adjective: 'adj', adverb: 'adv', v: 'verb', n: 'noun', adj: 'adj', adv: 'adv' };

async function fromDictionaryApi(term, accent) {
  const d = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`);
  if (d === undefined) return undefined;
  if (!Array.isArray(d) || !d.length) return null;
  const phon = d.flatMap(e => e.phonetics || []);
  const pref = accent === 'en-US' ? '-us.mp3' : '-uk.mp3';
  const audio = (phon.find(p => p.audio?.endsWith(pref)) || phon.find(p => p.audio?.endsWith('-uk.mp3')) || phon.find(p => p.audio))?.audio || '';
  const ipa = d.find(e => e.phonetic)?.phonetic || phon.find(p => p.text)?.text || '';
  const meanings = d.flatMap(e => e.meanings || []);
  const first = meanings[0];
  const examples = meanings.flatMap(m => m.definitions || []).map(x => x.example).filter(Boolean).slice(0, 2);
  const synonyms = [...new Set(meanings.flatMap(m => [...(m.synonyms || []), ...(m.definitions || []).flatMap(x => x.synonyms || [])]))].slice(0, 5);
  const antonyms = [...new Set(meanings.flatMap(m => [...(m.antonyms || [])]))].slice(0, 3);
  return {
    ipa, audio,
    pos: [...new Set(meanings.map(m => POS[m.partOfSpeech] || m.partOfSpeech))].join(', '),
    defEn: first?.definitions?.[0]?.definition || '',
    examples, synonyms, antonyms,
  };
}

async function fromDatamuse(term) {
  const d = await getJSON(`https://api.datamuse.com/words?sp=${encodeURIComponent(term)}&md=dpfr&ipa=1&max=1`);
  if (d === undefined) return undefined;
  const w = Array.isArray(d) && d[0];
  if (!w || w.word.toLowerCase() !== term.toLowerCase()) return null;
  const tags = w.tags || [];
  const ipa = tags.find(t => t.startsWith('ipa_pron:'))?.slice(9) || '';
  const freq = parseFloat(tags.find(t => t.startsWith('f:'))?.slice(2) || '0');
  const defs = (w.defs || []).map(s => s.split('\t'));
  return {
    ipa: ipa ? `/${ipa}/` : '',
    freq,
    pos: [...new Set(defs.map(([p]) => POS[p] || p))].join(', '),
    defEn: (defs[0]?.[1] || '').trim(),
  };
}

// Fill only empty fields, so user- or Claude-provided content is never overwritten.
export async function enrichFromDictionary(note) {
  if (!navigator.onLine || note.type === 'error') return false;
  const term = note.term.trim();
  const [a, b] = await Promise.all([fromDictionaryApi(term, S.settings.accent), fromDatamuse(term)]);
  const cur = S.notes.get(note.id);
  if (!cur || (!a && !b)) {
    if (cur && a === null && b === null) { cur.dictFetched = true; await saveNote(cur); } // not in any dictionary: stop retrying
    return false;
  }
  // dictionaryapi.dev's IPA is better than Datamuse's, so it may replace one that came from Datamuse earlier
  if (a?.ipa && cur.ipaFrom === 'datamuse') { cur.ipa = a.ipa; cur.ipaFrom = ''; }
  const src = { ...(b || {}), ...(a || {}) };
  for (const k of ['ipa', 'audio', 'pos', 'defEn']) if (!cur[k] && src[k]) { cur[k] = src[k]; if (k === 'ipa' && !a?.ipa) cur.ipaFrom = 'datamuse'; }
  for (const k of ['examples', 'synonyms', 'antonyms']) if (!(cur[k] || []).length && src[k]?.length) cur[k] = src[k];
  if (b?.freq) cur.freq = b.freq;
  // if dictionaryapi.dev was unreachable, keep the note in the retry queue to pick up recorded audio later
  cur.dictFetched = a !== undefined;
  await saveNote(cur);
  return true;
}

// Retry any notes that were added offline.
export async function backfillDictionary(limit = 15) {
  if (!navigator.onLine) return;
  const todo = [...S.notes.values()].filter(n => !n.dictFetched && n.type !== 'error').slice(0, limit);
  for (const n of todo) await enrichFromDictionary(n);
}
