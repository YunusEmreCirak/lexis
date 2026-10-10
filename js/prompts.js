// Copy-paste bridge to Claude (Claude iPhone app, claude.ai or Claude Code on the PC).
// The app builds a prompt → you paste it into Claude → you paste Claude's JSON answer back.
// No API key, no server.

import { S, saveNote, savePool } from './store.js';
import { TOPICS, ERROR_CATS } from './data/constants.js';
import { upcomingPool } from './srs.js';

const PROMPT_MARKER = 'Return ONLY one JSON code block';
const TEMPLATE_WRONG = 'exact erroneous fragment copied from the text';

const profile = () => `Learner: ${S.settings.name || 'the learner'}, Turkish native speaker, Industrial Engineering senior, level B2 → target C1 (${S.settings.target}). Weak areas: vocabulary range and grammar accuracy. Strong: listening and speaking fluency.`;

// ---------- enrichment ----------
export function pendingEnrichment(limit = S.settings.enrichBatch) {
  const notes = [...S.notes.values()]
    .filter(n => !n.enriched && !n.suspended)
    .sort((a, b) => a.createdAt - b.createdAt);
  const own = notes.slice(0, limit).map(n => ({ kind: 'note', id: n.id, obj: n }));
  const room = limit - own.length;
  const pool = room > 0 ? upcomingPool(room * 3).filter(p => !p.data).slice(0, room).map(p => ({ kind: 'pool', id: p.id, obj: p })) : [];
  return { list: [...own, ...pool], ownTotal: notes.length };
}

export function buildEnrichPrompt(entries) {
  const items = entries.map(({ id, kind, obj }) => {
    if (kind === 'note' && obj.type === 'error') return { id, type: 'error', wrong: obj.wrong, correct: obj.correct || undefined };
    const o = { id, type: kind === 'pool' ? (/\s/.test(obj.term) ? 'phrase' : 'word') : obj.type, term: obj.term };
    if (obj.context) o.context = obj.context;
    if (obj.pos) o.pos_hint = obj.pos;
    if (obj.tr) o.user_meaning_tr = obj.tr;
    return o;
  });
  return `You are building personalised IELTS flashcards. ${profile()}

${PROMPT_MARKER}, no other text, exactly in this shape:
{"lexis":"enrich","v":1,"items":[ ... one object per input item, same "id" ... ]}

For type "word" or "phrase", each object has:
- "id": copy from input
- "term": canonical dictionary form (fix spelling; for inflected list words like "invoked" give the base "invoke"; keep phrases as natural chunks)
- "pos": part of speech (noun, verb, adj, adv, phrasal verb, idiom, linking phrase, …)
- "tr": concise Turkish meaning(s), max 6 words, the sense most useful for IELTS first. If "context" is given, match that sense. If "user_meaning_tr" is given, keep it unless wrong.
- "defEn": learner-dictionary style English definition, max 20 words
- "cefr": A2 | B1 | B2 | C1 | C2
- "topic": one of ${JSON.stringify(TOPICS)}
- "examples": 2 natural sentences in IELTS Academic register (one Writing Task 2 style, one Speaking style)
- "cloze": 2 NEW sentences (different from examples) with exactly one target wrapped in {{ }}, e.g. "Governments must {{mitigate}} the effects of climate change." The wrapped text is exactly what the learner must type (an inflected form is fine). For long phrases wrap only the key 1–3 words.
- "collocations": 3–5 high-frequency collocations / chunks that contain the term
- "family": word family with parts of speech, e.g. "mitigation (n), mitigating (adj)"; "" if none
- "synonyms": 2–4 synonyms of similar register; "antonyms": 0–2
- "mnemonic": a short Turkish memory hook (sound-alike keyword or vivid image)
- "note": one short Turkish usage tip (register, preposition, a typical Turkish-speaker mistake)

For type "error" (a mistake the learner made), each object has:
- "id", "correct": minimal correction that keeps the learner's meaning (keep the given one if it is right)
- "explanation": the rule in Turkish, max 2 sentences
- "category": one of ${JSON.stringify(Object.keys(ERROR_CATS))}
- "examples": 1–2 extra correct sentences that use the same rule

Input items:
${JSON.stringify(items, null, 1)}`;
}

// Pull the first JSON object out of Claude's reply (handles ```json fences and surrounding text).
export function extractJSON(text) {
  if (!text) throw new Error('Boş metin.');
  // Both prompts contain a JSON template; pasting the prompt back must not be mistaken for Claude's answer.
  if (text.includes(PROMPT_MARKER)) throw new Error('Panoda hâlâ uygulamanın komutu var. Önce Claude’un cevabındaki JSON bloğunu kopyala.');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  let s = (fence ? fence[1] : text).trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Metinde JSON bulunamadı.');
  s = s.slice(a, b + 1);
  const attempts = [
    x => x,
    x => x.replace(/,\s*([}\]])/g, '$1'),               // trailing commas
    x => x.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1'), // whole reply typed with smart quotes
  ];
  let err;
  for (const fix of attempts) {
    try { return JSON.parse(fix(s)); } catch (e) { err = err || e; }
  }
  throw err;
}

const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []);
const str = v => (typeof v === 'string' ? v.trim() : '');

function wordFields(it) {
  const f = {
    pos: str(it.pos), tr: str(it.tr), defEn: str(it.defEn), cefr: str(it.cefr).toUpperCase(),
    topic: TOPICS.includes(it.topic) ? it.topic : '',
    examples: arr(it.examples), cloze: arr(it.cloze).filter(c => /\{\{.+?\}\}/.test(c)), collocations: arr(it.collocations),
    family: str(it.family), synonyms: arr(it.synonyms), antonyms: arr(it.antonyms),
    mnemonic: str(it.mnemonic), note: str(it.note),
  };
  for (const k of Object.keys(f)) if (!f[k] || (Array.isArray(f[k]) && !f[k].length)) delete f[k];
  return f;
}

export async function applyEnrichment(json) {
  if (json?.lexis !== 'enrich' || !Array.isArray(json.items)) throw new Error('Bu bir Lexis zenginleştirme cevabı değil ("lexis":"enrich" yok).');
  let notes = 0, pools = 0;
  const skipped = [];
  const poolUpdates = [];
  for (const it of json.items) {
    if (!it?.id) continue;
    const n = S.notes.get(it.id);
    if (n) {
      if (n.type === 'error') {
        if (str(it.correct) && (!n.correct || !n.userCorrect)) n.correct = str(it.correct);
        if (str(it.explanation)) n.explanation = str(it.explanation);
        if (ERROR_CATS[it.category]) n.category = it.category;
        if (arr(it.examples).length) n.examples = arr(it.examples);
      } else {
        const f = wordFields(it);
        if (n.userTr && f.tr) delete f.tr;
        if (n.topic) delete f.topic;
        Object.assign(n, f);
        if (!OWN_ORIGINS.has(n.origin) && str(it.term)) n.term = str(it.term);
      }
      n.enriched = true;
      await saveNote(n);
      notes++;
      continue;
    }
    const p = S.pool.get(it.id);
    if (p) {
      const f = wordFields(it);
      if (str(it.term)) p.term = str(it.term);
      p.data = f;
      poolUpdates.push(p);
      pools++;
      continue;
    }
    skipped.push(it.id);
  }
  if (poolUpdates.length) await savePool(poolUpdates);
  return { notes, pools, skipped };
}
const OWN_ORIGINS = new Set(['mine', 'writing']);

// ---------- writing feedback ----------
export function buildWritingPrompt({ question, words, text }) {
  return `You are an experienced IELTS Academic examiner and writing coach. ${profile()}

He wrote the text below to practise these target words: ${JSON.stringify(words)}
${question ? `Task: ${question}\n` : ''}
This is a single-paragraph vocabulary exercise (about 80–150 words), not a full 250-word essay. Do NOT lower the scores for length or for a missing introduction/conclusion; judge Task Response by how clearly and convincingly the paragraph argues its point, and judge the other criteria as usual.
Text:
"""
${text}
"""

${PROMPT_MARKER}, no other text, exactly in this shape:
{"lexis":"feedback","v":1,
 "band":{"overall":"6.0","TR":"6.0","CC":"6.0","LR":"6.0","GRA":"6.0"},
 "summary":"2–3 sentences in Turkish: overall verdict and the single most important thing to fix",
 "words":[{"term":"<each target word>","used":true,"correct":true,"comment":"short Turkish comment on how it was used, or a model sentence if not used/wrong"}],
 "errors":[{"wrong":"${TEMPLATE_WRONG}","correct":"corrected fragment","explanation":"rule in Turkish, max 2 sentences","category":"one of ${Object.keys(ERROR_CATS).join(' | ')}"}],
 "improved":"a Band 7.5 rewrite that keeps his ideas and uses the target words naturally"}

Band scores are indicative for a short text (use .0/.5 steps). List every grammar/vocabulary error, max 12, most important first.`;
}

export function parseFeedback(json) {
  if (json?.lexis !== 'feedback') throw new Error('Bu bir Lexis geri bildirim cevabı değil ("lexis":"feedback" yok).');
  return {
    band: json.band || {},
    summary: str(json.summary),
    words: Array.isArray(json.words) ? json.words : [],
    errors: (Array.isArray(json.errors) ? json.errors : []).filter(e => str(e.wrong) && str(e.correct) && str(e.wrong) !== TEMPLATE_WRONG),
    improved: str(json.improved),
  };
}
