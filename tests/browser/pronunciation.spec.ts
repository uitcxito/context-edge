import { expect, test, type Reader } from './fixture';

async function mockSpeech(reader: Reader) {
  // Content scripts have their own JS globals. Install the fake in the extension's world only.
  const cdp = await reader.context.newCDPSession(reader.page);
  let world: number | undefined;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.origin === reader.extension && context.auxData?.type === 'isolated') world = context.id;
  });
  await cdp.send('Runtime.enable');
  await expect.poll(() => world).toBeDefined();
  const evaluate = async (expression: string) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      contextId: world, expression, returnByValue: true, awaitPromise: true
    });
    if (exceptionDetails) throw Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  await evaluate(`
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      constructor(text) { this.text = text; }
    } });
    void Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: Object.assign(new EventTarget(), {
      voices: [
        { lang: 'zh-CN', localService: true, name: 'Chinese' },
        { lang: 'en-US', localService: false, name: 'Online US' },
        { lang: 'en-GB', localService: true, name: 'Local UK' },
        { lang: 'en-US', localService: true, name: 'Local US' }
      ],
      calls: [], getVoices() { return this.voices; }, speak(utterance) { this.calls.push(utterance); }
    }) });
  `);
  return evaluate;
}

test('a trusted click or key reads the current heading once, including before the explanation arrives', async ({ reader: r }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const respond = r.respond;
  r.respond = async (route, call) => { await held; await respond(route, call); };
  await r.open();
  const speech = await mockSpeech(r);
  const spoken = () => speech('speechSynthesis.calls.map(u => [u.text, u.lang, u.voice.name])');
  try {
    await r.tap('#right');
    const word = r.card.getByRole('button', { name: '朗读 right', exact: true });
    await expect(word).toBeEnabled();
    await word.evaluate((button: HTMLButtonElement) => button.click());
    expect(await spoken()).toEqual([]);
    await r.page.keyboard.press('Tab');
    await expect(word).toBeFocused();
    await r.page.keyboard.press('Enter');
    await r.page.keyboard.press('Enter');
    await expect.poll(spoken).toEqual([['right', 'en-US', 'Local US']]);
    await expect(word).toBeDisabled();

    release();
    const phrase = 'earn the right to get there';
    const speaker = r.card.getByRole('button', { name: '朗读 ' + phrase });
    await expect(speaker).toBeEnabled();
    expect(await spoken()).toHaveLength(1);
    await speaker.dblclick();
    await expect.poll(spoken).toEqual([['right', 'en-US', 'Local US'], [phrase, 'en-US', 'Local US']]);
    await speech('speechSynthesis.calls[0].onend()');
    await expect(speaker).toBeDisabled();
    await speech('speechSynthesis.calls[1].onend()');
    await expect(speaker).toBeEnabled();
    await r.page.keyboard.press('Space');
    await expect.poll(() => speech('speechSynthesis.calls.map(u => u.text)')).toEqual(['right', phrase, phrase]);
    expect(r.calls).toHaveLength(1);
  } finally { release(); }
});

test('pronunciation handles delayed English voices, playback errors, retries and dismissal', async ({ reader: r }) => {
  await r.open('<p>Her <b id="word">sabbatical</b> starts soon.</p>');
  const speech = await mockSpeech(r);
  await speech('speechSynthesis.voices = []');
  await r.tap('#word');
  const speaker = r.card.getByRole('button', { name: '朗读 sabbatical' });
  await speaker.click();
  await speech(`speechSynthesis.voices = [{lang:'zh-CN', localService:true}];
    speechSynthesis.dispatchEvent(new Event('voiceschanged'))`);
  await speech(`speechSynthesis.voices = [{lang:'en-GB', localService:true, name:'UK'}];
    speechSynthesis.dispatchEvent(new Event('voiceschanged'))`);
  await expect.poll(() => speech('speechSynthesis.calls[0]?.voice.name')).toBe('UK');
  await speech('speechSynthesis.calls[0].onerror()');
  await expect(r.card.getByRole('status')).toHaveText('暂时无法播放发音，请重试。');
  await expect(r.card.locator('.zh')).toBeVisible();
  await speech("speechSynthesis.voices = [{lang:'zh-CN', localService:true}]");
  await speaker.click();
  await expect(r.card.getByRole('status')).toContainText('未找到英语语音');
  await speech("speechSynthesis.voices = [{lang:'en-AU', localService:false, name:'Online AU'}]");
  await speaker.click();
  await expect.poll(() => speech('speechSynthesis.calls[1]?.lang')).toBe('en-AU');
  await expect(r.card.getByRole('status')).toHaveCount(0);
  await speech('speechSynthesis.calls[1].onend(); speechSynthesis.voices = []');
  await speaker.click();
  await r.page.keyboard.press('Escape');
  await speech("speechSynthesis.voices = [{lang:'en-US', localService:true}]; speechSynthesis.dispatchEvent(new Event('voiceschanged'))");
  await expect(r.card).toHaveCount(0);
  expect(await speech('speechSynthesis.calls.length')).toBe(2);
  expect(r.calls).toHaveLength(1);
});
