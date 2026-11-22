import { CONTEXT_LIMIT, TARGET_LIMIT, TITLE_LIMIT, englishSelection, type Reading } from '../shared';

const words = new Intl.Segmenter('en', { granularity: 'word' });
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const commonEnglish = /\b(?:a|an|the|i|he|she|we|you|they|my|your|our|it|its|of|to|and|but|or|for|from|with|on|in|at|is|are|was|were|be|been|have|had|has|can|could|will|would|that|this|these|those|how|what|who|why|if|not|as|by|so|out|up|down|off|back|there|here|please|help)\b/gi;
const compact = (s: string) => s.replace(/\s+/gu, ' ');

export function englishBlock(text: string, lang: string) {
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (!latin || latin / letters < 0.78) return false;
  const tokens = text.match(/\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu) ?? [];
  const cues = (text.match(commonEnglish) ?? []).length;
  const containsCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
  if (containsCJK && (tokens.length < 3 || cues === 0)) return false;
  if (/^en(?:-|$)/i.test(lang)) return true;
  // A surrounding Chinese UI can contain a fully English paragraph. Prefer local evidence.
  if (/^(fr|de|es|pt|it|nl|sv|no|da|fi|pl|tr|ro|vi)(?:-|$)/i.test(lang)) return false;
  return tokens.length >= 2 && cues >= 1 ||
    tokens.length === 1 && /^(?:h+a+l+p|help|thanks|hello|wow|ouch|oops)$/i.test(tokens[0]!);
}

export function wordAt(raw: string, index: number) {
  const segment = words.segment(raw).containing(index);
  if (!segment?.isWordLike || !/^[\p{Script=Latin}\p{M}]+(?:['’][\p{Script=Latin}\p{M}]+)*$/u.test(segment.segment)) return null;
  return { start: segment.index, end: segment.index + segment.segment.length };
}

/** Return a slice of at most budget characters, including [start, end]. */
function windowAround(length: number, start: number, end: number, budget: number) {
  const left = Math.max(0, Math.min(start - Math.floor((budget - (end - start)) / 2), length - budget));
  return { left, right: Math.min(length, left + budget) };
}
export function extractReading(raw: string, from: number, to: number, pageTitle: string): Reading | null {
  if (from < 0 || to > raw.length || from >= to) return null;
  const span = raw.slice(from, to);
  const trimmed = span.trim();
  const selected = compact(trimmed);
  if (!selected || selected.length > TARGET_LIMIT || !englishSelection(selected)) return null;
  from += span.length - span.trimStart().length;
  to = from + trimmed.length;
  const prefix = compact(raw.slice(0, from)).trimStart();
  const text = prefix + selected + compact(raw.slice(to)).trimEnd();
  const start = prefix.length;
  const end = start + selected.length;
  const parts = sentences.segment(text);
  const first = parts.containing(start)!;
  const last = parts.containing(end - 1)!;
  const sentenceStart = first.index;
  const sentenceEnd = last.index + last.segment.trimEnd().length;
  const title = compact(pageTitle).trim().slice(0, TITLE_LIMIT);
  const budget = CONTEXT_LIMIT - title.length;
  const focus = windowAround(sentenceEnd - sentenceStart, start - sentenceStart, end - sentenceStart, budget);
  const fromSentence = sentenceStart + focus.left;
  const toSentence = sentenceStart + focus.right;
  const window = windowAround(text.length, fromSentence, toSentence, budget);
  return {
    selected, title,
    before: text.slice(window.left, fromSentence).trim(),
    sentence: text.slice(fromSentence, toSentence),
    after: text.slice(toSentence, window.right).trim(),
    start: start - fromSentence, end: end - fromSentence
  };
}
