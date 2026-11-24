export const DEFAULT_MODEL = 'gpt-6-luna';
export const CONTEXT_LIMIT = 1200;
export const TARGET_LIMIT = 260;
export const TITLE_LIMIT = 100;
export const PROMPT_VERSION = 'context-v1.1';
export const LANGUAGES = 'en+zh-CN';

export interface Reading {
  selected: string;
  sentence: string;
  before: string;
  after: string;
  title: string;
  /** UTF-16 offsets in sentence, end exclusive, as in DOM Range. */
  start: number;
  end: number;
}
export interface Explanation {
  status: 'ok' | 'unclear';
  target: string;
  meaning_en: string;
  meaning_zh: string;
  note_en: string;
}
export type ExplanationPreview = Pick<Explanation, 'target' | 'meaning_en' | 'meaning_zh'>;
export type ErrorCode = 'disabled' | 'cancelled' | 'noKey' | 'badKey' | 'forbidden' |
  'model' | 'quota' | 'rate' | 'network' | 'timeout' | 'refusal' | 'incomplete' |
  'invalid' | 'target' | 'service' | 'settings' | 'reload';
export type Reply = { ok: true; explanation: Explanation } | { ok: false; error: ErrorCode };
export type UnderlineTheme = 'auto' | 'blue' | 'clay';
export interface ReadingPreferences {
  doubleClickPreload: boolean;
  underlineTheme: UnderlineTheme;
}
export function readingPreferences(values: { doubleClickPreload?: unknown; underlineTheme?: unknown }): ReadingPreferences {
  const theme = values.underlineTheme;
  return { doubleClickPreload: values.doubleClickPreload !== false, underlineTheme: theme === 'blue' || theme === 'clay' ? theme : 'auto' };
}
export interface ReaderState extends ReadingPreferences { active: boolean }
export type ClientMessage =
  | { type: 'state' | 'options' | 'getZoom' }
  | { type: 'lookup'; id: string; reading: Reading; preload: boolean }
  | { type: 'cancel'; id: string };
export type WorkerMessage =
  | { type: 'refresh' | 'site' }
  | { type: 'preferences'; preferences: ReadingPreferences }
  | { type: 'zoomChanged'; factor: number }
  | { type: 'selection'; text: string }
  | { type: 'preview'; id: string; explanation: ExplanationPreview };

export function englishSelection(text: string) {
  return /\p{Script=Latin}/u.test(text) && !/\p{L}/u.test(text.replace(/\p{Script=Latin}/gu, ''));
}
export function validReading(r: unknown): r is Reading {
  if (!r || typeof r !== 'object') return false;
  const v = r as Reading;
  if (![v.selected, v.sentence, v.before, v.after, v.title].every(s => typeof s === 'string')) return false;
  return v.selected.length > 0 && v.selected.length <= TARGET_LIMIT && englishSelection(v.selected) &&
    Number.isInteger(v.start) && Number.isInteger(v.end) && v.start >= 0 && v.end <= v.sentence.length &&
    v.end === v.start + v.selected.length && v.sentence.slice(v.start, v.end) === v.selected &&
    v.title.length <= TITLE_LIMIT && v.sentence.length + v.before.length + v.after.length + v.title.length <= CONTEXT_LIMIT;
}
export function siteOf(url?: string): string | null {
  try {
    const site = new URL(url ?? '');
    return ['https:', 'http:'].includes(site.protocol) ? site.hostname : null;
  } catch { return null; }
}
export function pauseKey(site: string) { return 'paused:' + site; }
export function validModel(model: string) { return /^[\w][\w.:-]{0,127}$/.test(model); }
