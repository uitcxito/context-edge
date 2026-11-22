import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validReading, type Reading } from '../../src/shared';
import { validateExplanation } from '../../src/background/api';

it('all 30 evaluation cases map to the intended original occurrence and fit the request budget', () => {
  const data = JSON.parse(readFileSync(new URL('../../examples/contexts.json', import.meta.url), 'utf8'));
  expect(data.cases).toHaveLength(30);
  for (const c of data.cases) {
    const r: Reading = { selected: c.selected, sentence: c.sentence, start: c.start, end: c.end,
      before: c.before, after: c.after, title: '' };
    expect(data.sources[c.source]).toBeDefined();
    expect(validReading(r), 'case ' + c.id).toBe(true);
    const ok = c.expected_status === 'ok';
    expect(validateExplanation({ status: c.expected_status, target: c.expected_target, meaning_en: ok ? 'Example.' : '',
      meaning_zh: ok ? c.expected_meaning_zh : '', note_en: '' }, r).target).toBe(c.expected_target);
  }
});
