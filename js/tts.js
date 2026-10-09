// Pronunciation: recorded audio from the dictionary when online, otherwise the iPhone's built-in voices.

import { S } from './store.js';

let voices = [];
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
function loadVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }

const PREFERRED = {
  'en-GB': ['Daniel', 'Kate', 'Serena', 'Arthur', 'Martha', 'Google UK English'],
  'en-US': ['Samantha', 'Alex', 'Ava', 'Allison', 'Google US English'],
};

function pickVoice(lang) {
  if (!voices.length) loadVoices();
  const same = voices.filter(v => v.lang?.replace('_', '-') === lang);
  for (const name of PREFERRED[lang] || []) {
    const v = same.find(x => x.name.includes(name) && /enhanced|premium/i.test(x.name)) || same.find(x => x.name.includes(name));
    if (v) return v;
  }
  return same[0] || voices.find(v => v.lang?.startsWith('en')) || null;
}

export const ttsAvailable = () => !!synth;

// iOS only allows speech/audio after a user gesture; call once from the first tap.
let unlocked = false;
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try { if (synth) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } } catch {}
}

export function speak(text, rate = 0.92) {
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\{\{|\}\}/g, ''));
  u.lang = S.settings.accent;
  const v = pickVoice(S.settings.accent);
  if (v) u.voice = v;
  u.rate = rate;
  synth.speak(u);
}

let current;
export function playTerm(note) {
  const text = note.type === 'error' ? note.correct : note.term;
  if (current) { current.pause(); current = null; }
  if (note.audio && navigator.onLine && !/\s/.test(note.term)) {
    current = new Audio(note.audio);
    current.play().catch(() => speak(text));
  } else {
    speak(text);
  }
}
