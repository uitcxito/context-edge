import { describe, expect, it } from 'vitest';
import { englishBlock, extractReading, wordAt } from '../../src/content/text';
import { CtrlTap } from '../../src/content/gesture';
import { CONTEXT_LIMIT, siteOf, validReading } from '../../src/shared';

describe('reading boundaries', () => {
  it.each([
    ["My pitch isn't working on the fundraising side.", 'zh-CN', true],
    ['Haaalp.', '', true], ['It worked.', '', true],
    ['今天和 CEO 聊了 AI 融资的事情。', 'en', false],
    ['我今天用了 AI。', 'zh', false], ['看 OpenAI', 'en', false], ['AI', '', false],
    ['La maison est bien située.', 'fr', false], ['これは日本語です。', 'en', false]
  ])('language of %s', (text, lang, expected) => expect(englishBlock(String(text), String(lang))).toBe(expected));
  it.each([["I can't go.", 4, "can't"], ['please don’t', 10, 'don’t'], ['a pitch.', 6, 'pitch'], ['word!', 4, null], ['CEO 2026', 5, null]])(
    'maps a glyph in %s to its word', (text, index, expected) => {
      const w = wordAt(String(text), Number(index));
      expect(w && String(text).slice(w.start, w.end)).toBe(expected);
    });
  it('keeps adjacent sentences and the exact selected occurrence after whitespace folding', () => {
    const text = '   We found a way.  The bank near the   bank was shut.   It opens tomorrow. ';
    const i = text.lastIndexOf('bank');
    expect(extractReading(text, i, i + 4, ' A  title ')).toEqual({
      selected: 'bank', sentence: 'The bank near the bank was shut.', start: 18, end: 22,
      before: 'We found a way.', after: 'It opens tomorrow.', title: 'A title'
    });
  });
  it('keeps a selected phrase over a sentence boundary', () => {
    const raw = 'She said yes. We left. It rained.';
    const r = extractReading(raw, 9, 16, 'Test')!;
    expect(r.selected).toBe('yes. We');
    expect(r.sentence).toBe('She said yes. We left.');
    expect(r.after).toBe('It rained.');
    expect(validReading(r)).toBe(true);
  });
  it.each([0, 500, 2000])('bounds even a single long sentence at offset %i', count => {
    const prefix = 'word '.repeat(count);
    const r = extractReading(prefix + 'target' + ' tail'.repeat(2100 - count), prefix.length, prefix.length + 6, 'T'.repeat(180))!;
    expect(validReading(r)).toBe(true);
    expect(r.sentence.slice(r.start, r.end)).toBe('target');
    expect(r.sentence.length + r.before.length + r.after.length + r.title.length).toBeLessThanOrEqual(CONTEXT_LIMIT);
  });
  it('rejects oversized selections, incorrect offsets and non-HTTP sites', () => {
    expect(extractReading('Read the 中文 here.', 5, 11, '')).toBeNull();
    expect(extractReading('a'.repeat(300), 0, 300, '')).toBeNull();
    expect(validReading({ ...extractReading('The cat.', 4, 7, ''), start: 3 })).toBe(false);
    expect(siteOf('edge://extensions')).toBeNull();
    expect(siteOf('https://reader.example:8443/a')).toBe('reader.example');
  });
});
describe('left Ctrl state', () => {
  const key = (code: string) => ({ code, repeat: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false });
  it('fires once on release and rejects a long hold, autorepeat, and right Ctrl', () => {
    const g = new CtrlTap();
    g.down(key('ControlLeft'), 10);
    expect(g.up('ControlLeft', 120)).toBe(true);
    expect(g.up('ControlLeft', 130)).toBe(false);
    g.down(key('ControlLeft'), 200);
    expect(g.up('ControlLeft', 800)).toBe(false);
    g.down(key('ControlLeft'), 900);
    g.down({ ...key('ControlLeft'), repeat: true }, 910);
    expect(g.up('ControlLeft', 920)).toBe(false);
    g.down(key('ControlRight'), 1000);
    expect(g.up('ControlRight', 1020)).toBe(false);
  });
  it('cancels for a chord in either order, pointer cancellation or focus loss', () => {
    const g = new CtrlTap();
    g.down(key('KeyA'), 0);
    g.down(key('ControlLeft'), 1);
    expect(g.up('ControlLeft', 5)).toBe(false);
    g.reset();
    g.down(key('ControlLeft'), 10);
    g.down(key('KeyC'), 12);
    g.up('KeyC', 15);
    expect(g.up('ControlLeft', 20)).toBe(false);
    for (const clear of [() => g.cancel(), () => g.reset()]) {
      g.down(key('ControlLeft'), 21);
      clear();
      expect(g.up('ControlLeft', 24)).toBe(false);
    }
  });
});
