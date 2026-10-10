// Filler-word counting. Heuristic and transparent: "like" only counts when it's set off by
// commas or starts a clause ("it was, like, huge"), so "I like this" is not a filler.

const SIMPLE = /\b(u+m+|u+h+m*|e+r+m+|e+r+|a+h+|hmm+|mm+)\b/gi;
const PHRASES = /\b(you know|i mean|basically|kind of like|sort of like)\b/gi;
const LIKE = /(?:^|[,.;!?]\s*)like\b|\blike(?=\s*,)/gi;

export interface FillerHit {
  word: string;
}

export function findFillers(text: string): FillerHit[] {
  const hits: FillerHit[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(SIMPLE)) hits.push({ word: normalize(m[1]) });
  for (const m of lower.matchAll(PHRASES)) hits.push({ word: m[1] });
  for (const _ of lower.matchAll(LIKE)) hits.push({ word: 'like' });
  return hits;
}

function normalize(w: string): string {
  if (/^u+m+$/.test(w)) return 'um';
  if (/^u+h+m*$/.test(w)) return 'uh';
  if (/^e+r+m*$/.test(w)) return 'erm';
  if (/^a+h+$/.test(w)) return 'ah';
  return w;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}
