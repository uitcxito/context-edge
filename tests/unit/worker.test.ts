import { afterEach, describe, expect, it, vi } from 'vitest';
import { explain, parseResponse, validateExplanation } from '../../src/background/api';
import { CAPACITY, TTL, cacheKey, ExplanationCache } from '../../src/background/cache';
import type { Explanation, Reading } from '../../src/shared';

const r: Reading = { selected: 'right', sentence: 'Turn right to earn the right to speak.', start: 23, end: 28, before: '', after: '', title: 'Test' };
const ex: Explanation = { status: 'ok', target: 'earn the right to speak', meaning_en: 'Get the chance to have your say.', meaning_zh: '赢得发言的资格。', note_en: '' };
const unclear = { ...ex, status: 'unclear', target: 'right', meaning_en: '', meaning_zh: '' };

describe('structured output', () => {
  it('requires the phrase to cover the selected occurrence, including word edges', () => {
    expect(validateExplanation(ex, r)).toEqual(ex);
    for (const target of ['Turn right', 'left', 'arn the right', 'right to spe', 'RIGHT', '']) {
      expect(() => validateExplanation({ ...ex, target }, r)).toThrow('target');
    }
    expect(validateExplanation({ ...ex, target: 'right to' }, r).target).toBe('right to');
  });
  it('accepts unclear only with original target and empty explanations', () => {
    expect(validateExplanation(unclear, r)).toEqual(unclear);
    for (const v of [{ ...unclear, note_en: 'maybe' }, { ...unclear, target: ex.target }, { ...ex, meaning_en: '  ' },
      { ...ex, extra: true }, { ...ex, meaning_zh: null }, { ...ex, meaning_zh: 'English only' }, { ...ex, status: 'other' }]) {
      expect(() => validateExplanation(v, r)).toThrow('invalid');
    }
  });
  it('finds message content after reasoning, recognizes refusal, incomplete and invalid results', () => {
    const body = (content: object[]) => ({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content }] });
    expect(parseResponse(body([{ type: 'output_text', text: JSON.stringify(ex) }]), r)).toEqual(ex);
    expect(() => parseResponse(body([{ type: 'refusal' }]), r)).toThrow('refusal');
    expect(() => parseResponse({ status: 'incomplete' }, r)).toThrow('incomplete');
    expect(() => parseResponse(body([{ type: 'output_text', text: '{' }]), r)).toThrow('invalid');
    expect(() => parseResponse(null, r)).toThrow('invalid');
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each([[401, 'badKey'], [403, 'forbidden'], [404, 'model'], [429, 'rate'], [503, 'service']])(
    'maps HTTP %i to %s', async (status, code) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: Number(status) })));
      await expect(explain(r, 'fixture', 'test', new AbortController().signal)).rejects.toThrow(String(code));
    });
  it('distinguishes an expired deadline from user cancellation', async () => {
    const clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    try {
      await expect(explain(r, 'fixture', 'test', new AbortController().signal)).rejects.toThrow('timeout');
      await expect(explain(r, 'fixture', 'test', AbortSignal.abort())).rejects.toThrow('cancelled');
    } finally { clock.mockRestore(); }
  });
});
describe('context cache', () => {
  function memory() {
    let data = {};
    let now = 1;
    const store = {
      get: async () => structuredClone(data),
      set: async (values: object) => { data = structuredClone(values); }
    };
    return { cache: new ExplanationCache(async () => store, () => now), tick: (ms: number) => { now += ms; } };
  }
  it('keys by location, full context, title, model, language and prompt version', async () => {
    const keys = await Promise.all([cacheKey(r, 'a'), cacheKey({ ...r, start: 5, end: 10 }, 'a'),
      cacheKey({ ...r, before: 'Another paragraph.' }, 'a'), cacheKey(r, 'b'), cacheKey(r, 'a', 'v2'),
      cacheKey(r, 'a', undefined, 'fr'), cacheKey({ ...r, title: 'Other' }, 'a')]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(await cacheKey({ ...r }, 'a')).toBe(keys[0]);
  });
  it('expires seven days from creation even after a hit', async () => {
    const { cache, tick } = memory();
    await cache.put('A', ex);
    tick(TTL - 1);
    expect(await cache.get('A')).toEqual(ex);
    tick(1);
    expect(await cache.get('A')).toBeUndefined();
  });
  it('retains concurrent writes and evicts the least recently used of 301 entries', async () => {
    const { cache, tick } = memory();
    await Promise.all(Array.from({ length: CAPACITY }, (_, i) => cache.put(String(i), ex)));
    tick(1);
    expect(await cache.get('0')).toEqual(ex);
    tick(1);
    await cache.put('new', ex);
    expect(await cache.get('1')).toBeUndefined();
    expect(await cache.get('0')).toEqual(ex);
    expect(await cache.get('299')).toEqual(ex);
    expect(await cache.get('new')).toEqual(ex);
  });
});
