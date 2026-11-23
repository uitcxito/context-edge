import { EventSourceParserStream } from 'eventsource-parser/stream';
import { DEFAULT_MODEL, type ErrorCode, type Explanation, type ExplanationPreview, type Reading } from '../shared';
import instructions from './instructions.txt';

export class LookupFailure extends Error {
  constructor(public readonly code: ErrorCode) { super(code); }
}
const fields = ['status', 'target', 'meaning_en', 'meaning_zh', 'note_en'] as const;
export const format = {
  type: 'json_schema', name: 'context_explanation', strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: fields,
    properties: {
      status: { type: 'string', enum: ['ok', 'unclear'] }, target: { type: 'string' },
      meaning_en: { type: 'string' }, meaning_zh: { type: 'string' }, note_en: { type: 'string' }
    }
  }
};
const examples = [
  {
    selected: 'Haaalp', sentence: "My pitch isn't working on the fundraising side. Haaalp.",
    target: 'Haaalp', meaning_en: 'A dramatic, playful way of asking for help.', meaning_zh: '救命啊！快帮我支支招。', note_en: ''
  }, {
    selected: 'right', sentence: 'Show how you earn the right to get there.',
    before: 'The founder is explaining an ambitious outcome to investors.',
    target: 'earn the right to get there', meaning_en: 'Show investors why your ambitious goal is actually achievable.',
    meaning_zh: '向投资人证明你确实有能力实现这个目标。',
    note_en: "It's about earning confidence through a convincing plan, not having a literal right."
  }, {
    selected: 'pitch', sentence: "My pitch isn't working on the fundraising side.",
    target: 'pitch', meaning_en: 'The way you present your business idea to potential investors.',
    meaning_zh: '向潜在投资人介绍并推销商业想法的说辞。', note_en: ''
  }
];
function inputText(r: Reading) {
  return JSON.stringify({
    selected_text: r.selected, current_sentence: r.sentence, selected_start: r.start, selected_end: r.end,
    previous_context: r.before, following_context: r.after, page_title: r.title
  });
}
const demonstrations = examples.flatMap(ex => {
  const start = ex.sentence.indexOf(ex.selected);
  return [
    { role: 'user', content: inputText({ ...ex, start, end: start + ex.selected.length, before: ex.before ?? '', after: '', title: '' }) },
    { role: 'assistant', content: JSON.stringify({ status: 'ok', target: ex.target, meaning_en: ex.meaning_en, meaning_zh: ex.meaning_zh, note_en: ex.note_en }) }
  ];
});

function coversOccurrence(r: Reading, target: string) {
  const wordChar = /[\p{L}\p{M}\p{N}_]/u;
  for (let at = r.sentence.indexOf(target); at !== -1 && at <= r.start; at = r.sentence.indexOf(target, at + 1)) {
    const end = at + target.length;
    if (end < r.end) continue;
    // Reject made-up partial words at either edge of an expanded expression.
    if (at < r.start && wordChar.test(target[0]!) && wordChar.test(r.sentence[at - 1] ?? '')) continue;
    if (end > r.end && wordChar.test(target.at(-1)!) && wordChar.test(r.sentence[end] ?? '')) continue;
    return true;
  }
  return false;
}
function validTarget(r: Reading, target: unknown): target is string {
  return typeof target === 'string' && target.length > 0 && target === target.trim() && coversOccurrence(r, target);
}
function validEnglish(text: unknown): text is string {
  return typeof text === 'string' && text.length <= 650 && /\p{Script=Latin}/u.test(text);
}
function validChinese(text: unknown): text is string {
  return typeof text === 'string' && text.length <= 400 && /\p{Script=Han}/u.test(text);
}
export function validateExplanation(data: unknown, r: Reading): Explanation {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new LookupFailure('invalid');
  const v = data as Explanation;
  if (Object.keys(v).length !== fields.length || !fields.every(k => typeof v[k] === 'string') ||
      !['ok', 'unclear'].includes(v.status)) throw new LookupFailure('invalid');
  if (!validTarget(r, v.target)) throw new LookupFailure('target');
  if (v.status === 'unclear') {
    if (v.target !== r.selected || v.meaning_en || v.meaning_zh || v.note_en) throw new LookupFailure('invalid');
  } else if (!validEnglish(v.meaning_en) || !validChinese(v.meaning_zh) || v.note_en.length > 800) throw new LookupFailure('invalid');
  return { status: v.status, target: v.target, meaning_en: v.meaning_en.trim(), meaning_zh: v.meaning_zh.trim(), note_en: v.note_en.trim() };
}
interface OutputPart { type?: string; text?: unknown }
interface ResponseBody { status?: string; output?: { type?: string; content?: OutputPart[] }[] }
export function parseResponse(body: ResponseBody | null, reading: Reading) {
  if (body?.status === 'incomplete' || body?.status === 'in_progress') throw new LookupFailure('incomplete');
  if (body?.status === 'failed') throw new LookupFailure('service');
  if (body?.status !== 'completed' || !Array.isArray(body.output)) throw new LookupFailure('invalid');
  const messages = body.output.filter(m => m?.type === 'message');
  const parts = messages.flatMap(m => Array.isArray(m.content) ? m.content : []);
  if (parts.some(p => p?.type === 'refusal')) throw new LookupFailure('refusal');
  const text = parts.filter(p => p?.type === 'output_text' && typeof p.text === 'string').map(p => p.text).join('');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new LookupFailure('invalid'); }
  return validateExplanation(data, reading);
}

// The schema is a flat object of strings. At a possible end of a string, close
// the object and let JSON.parse distinguish complete values from keys or escaped quotes.
function readPreview(text: string, from: number, reading: Reading): ExplanationPreview | undefined {
  const endings = /"(?=\s*(?:[,}]|$))/g;
  endings.lastIndex = from;
  let latest: ExplanationPreview | undefined;
  for (const end of text.matchAll(endings)) {
    let fields: Partial<Explanation>;
    try { fields = JSON.parse(text.slice(0, end.index + 1) + '}'); } catch { continue; }
    if (fields.status !== 'ok' || !validTarget(reading, fields.target) || !validEnglish(fields.meaning_en)) continue;
    if (fields.meaning_zh !== undefined && !validChinese(fields.meaning_zh)) continue;
    latest = { target: fields.target, meaning_en: fields.meaning_en.trim(), meaning_zh: fields.meaning_zh?.trim() ?? '' };
  }
  return latest;
}

type PreviewListener = (preview: ExplanationPreview) => void;
const PREVIEW_LIMIT = 24 * 1024;
interface ResponseEvent { type?: string; delta?: unknown; response?: ResponseBody }
async function readStream(body: NonNullable<Response['body']>, reading: Reading, signal: AbortSignal, onPreview?: PreviewListener) {
  const reader = body.pipeThrough(new TextDecoderStream(), { signal }).pipeThrough(new EventSourceParserStream()).getReader();
  let text = '';
  let previous: ExplanationPreview | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done || value.data === '[DONE]') throw new LookupFailure('incomplete');
      let event: ResponseEvent | null;
      try { event = JSON.parse(value.data); } catch { throw new LookupFailure('invalid'); }
      switch (event?.type) {
        case 'response.completed': return parseResponse(event.response ?? null, reading);
        case 'response.incomplete': throw new LookupFailure('incomplete');
        case 'response.failed':
        case 'error': throw new LookupFailure('service');
        case 'response.refusal.delta':
        case 'response.refusal.done': throw new LookupFailure('refusal');
        case 'response.output_text.delta': {
          // Once both lines are visible (or the prefix is oversized), wait for the authoritative final message.
          if (!onPreview || previous?.meaning_zh || typeof event.delta !== 'string' || text.length >= PREVIEW_LIMIT) break;
          const from = text.length;
          text += event.delta.slice(0, PREVIEW_LIMIT - from);
          const preview = readPreview(text, from, reading);
          if (preview && previous?.meaning_zh !== preview.meaning_zh) {
            previous = preview;
            onPreview(preview);
          }
          break;
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function httpFailure(status: number, code: string | undefined): ErrorCode {
  if (status === 401) return 'badKey';
  if (status === 403) return 'forbidden';
  if (status === 429) return code === 'insufficient_quota' ? 'quota' : 'rate';
  if (status === 400 || status === 404) return 'model';
  if (status === 408 || status === 504) return 'timeout';
  return 'service';
}
export async function explain(reading: Reading, key: string, model: string, cancel: AbortSignal, onPreview?: PreviewListener) {
  const timeout = AbortSignal.timeout(20_000);
  const signal = AbortSignal.any([cancel, timeout]);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
      body: JSON.stringify({
        model, store: false, stream: true, text: { format },
        reasoning: model === DEFAULT_MODEL ? { effort: 'none' } : undefined,
        instructions: instructions + '\nExplain the expression in the final user message. Offsets identify the exact occurrence (zero-based UTF-16, end exclusive). Copy the target exactly from current_sentence, including its case.',
        input: [...demonstrations, { role: 'user', content: inputText(reading) }]
      })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new LookupFailure(httpFailure(response.status, detail?.error?.code));
    }
    if (response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      if (!response.body) throw new LookupFailure('incomplete');
      return await readStream(response.body, reading, signal, onPreview);
    }
    let body: ResponseBody;
    try { body = await response.json(); } catch { throw new LookupFailure('invalid'); }
    return parseResponse(body, reading);
  } catch (error) {
    if (cancel.aborted) throw new LookupFailure('cancelled');
    if (timeout.aborted) throw new LookupFailure('timeout');
    if (error instanceof LookupFailure) throw error;
    throw new LookupFailure('network');
  }
}
