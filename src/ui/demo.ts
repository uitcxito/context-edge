import type { ReadingPreferences } from '../shared';
import { ReadingSession } from '../content/reader';

const meanings: Record<string, [string, string]> = {
  my: ['Belonging to the person speaking.', '我的。'],
  pitch: ['The way you present your idea to potential investors.', '向潜在投资人推介项目的说辞。'],
  'isn’t': ['A short form of “is not”.', '是 is not 的缩写，在这里否定后面的 working。'],
  working: ['Getting the result the speaker wants.', '起作用，达到预期效果。'],
  on: ['With regard to a particular part of something.', '在某一方面。'],
  the: ['Refers to the particular aspect that follows.', '特指后面提到的方面。'],
  fundraising: ['The work of raising money from investors.', '向投资人筹集资金，也就是融资。'],
  side: ['One aspect of an activity.', '事情的一个方面，这里指融资这一块。']
};
export function sampleReader() {
  const sample = document.querySelector<HTMLElement>('#sample-text')!;
  const dark = document.querySelector<HTMLInputElement>('#sample-dark')!;
  dark.addEventListener('change', () => sample.classList.toggle('dark', dark.checked));
  const reader = new ReadingSession({
    async lookup(_id, reading) {
      const target = reading.selected;
      const pair = meanings[target.toLowerCase()];
      await new Promise(resolve => setTimeout(resolve, 220));
      return { ok: true, explanation: { status: pair ? 'ok' : 'unclear', target,
        meaning_en: pair?.[0] ?? '', meaning_zh: pair?.[1] ?? '', note_en: '' } };
    },
    cancel() {},
    options() {}
  }, sample);
  reader.enabled = true;
  return (prefs: ReadingPreferences) => {
    reader.setPreferences(prefs);
    document.querySelector<HTMLElement>('#sample-gesture')!.hidden = !prefs.doubleClickPreload;
  };
}
