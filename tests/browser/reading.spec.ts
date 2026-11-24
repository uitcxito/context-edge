import { answer, envelope, expect, sample, test } from './fixture';
import type { Locator, Route } from '@playwright/test';

async function offsetFromWord(card: Locator, word: Locator) {
  const [panel, text] = await Promise.all([card.boundingBox(), word.boundingBox()]);
  if (!panel || !text) return null;
  return [Math.round(panel.x - text.x), Math.round(panel.y - text.y - text.height)];
}

test('link lookup waits for release, validates the request and renders a bilingual Shadow DOM card', async ({ reader: r }) => {
  await r.open();
  await r.point('#pitch', 2);
  await r.page.keyboard.down('ControlLeft');
  expect(r.calls).toHaveLength(0);
  await expect(r.card).toHaveCount(0);
  await r.page.keyboard.up('ControlLeft');
  await expect(r.card.getByRole('heading')).toHaveText('pitch');
  await expect(r.card.locator('.zh')).toHaveText('向潜在投资人推介项目的说辞。');
  await expect(r.card.getByRole('button', { name: 'More' })).toHaveCount(0);
  expect(r.calls).toHaveLength(1);
  expect(r.calls[0]).toMatchObject({ model: 'gpt-6-luna', stream: true, reasoning: 'none', strict: true, noStore: true, fromWorker: true, authorized: true,
    input: { selected_text: 'pitch', current_sentence: 'My pitch isn’t working on the fundraising side.',
      previous_context: 'We met with the investors on Thursday.', following_context: 'We have one more meeting tomorrow.', selected_start: 3, selected_end: 8 }
  });
  expect(await r.card.evaluate(host => Boolean(host.shadowRoot?.querySelector('article')))).toBe(true);
  await r.capture('edge-reading');
  await r.page.keyboard.press('Escape');
  await expect(r.card).toHaveCount(0);
});
test('a Ctrl lookup follows the word on wheel scroll and keeps its pending reply while out of view', async ({ reader: r }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const respond = r.respond;
  r.respond = async (route, call) => {
    await pending;
    await respond(route, call);
  };
  const word = r.page.locator('#pitch');
  try {
    await r.open('<article style="padding-top:280px;min-height:2000px"><p>My <span id="pitch">pitch</span> needs work.</p></article>');
    await r.tap('#pitch', 2);
    await expect(r.card).toContainText('正在读取');
    await expect.poll(() => r.calls.length).toBe(1);
    await expect.poll(() => offsetFromWord(r.card, word)).toEqual([0, 6]);

    await r.page.mouse.wheel(0, 45);
    await expect.poll(() => r.page.evaluate(() => scrollY)).toBeGreaterThan(30);
    await expect(r.card).toBeVisible();
    await expect.poll(() => offsetFromWord(r.card, word)).toEqual([0, 6]);

    await r.page.mouse.wheel(0, 500);
    await expect.poll(() => word.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(0);
    await expect(r.card).toBeHidden();
    await expect(r.card).toHaveCount(1);
    release();
    await expect(r.card.locator('.zh')).toContainText('投资人');
    await expect(r.card).toBeHidden();

    await r.page.mouse.wheel(0, -700);
    await expect(r.card.locator('.zh')).toBeVisible();
    await r.page.setViewportSize({ width: 850, height: 640 });
    await expect.poll(() => offsetFromWord(r.card, word)).toEqual([0, 6]);
    expect(r.calls).toHaveLength(1);
  } finally { release(); }
});

test('one open card scales, rewraps and stays anchored as the window resizes', async ({ reader: r }) => {
  await r.page.setViewportSize({ width: 480, height: 500 });
  await r.open('<p style="position:fixed;top:16px;left:16px">Her <b id="word">sabbatical</b> starts soon.</p>');
  r.respond = (route, call) => route.fulfill({ json: envelope({ ...answer(call.input),
    meaning_en: 'A planned break from regular work to rest, study, or spend time on a personal project.'
  }) });
  await r.tap('#word');
  await expect(r.card.locator('.zh')).toBeVisible();
  const panel = r.card.locator('article'), word = r.page.locator('#word');
  const metrics = () => panel.evaluate(el => {
    const english = el.querySelector('p[lang="en"]')!;
    const range = new Range();
    range.selectNodeContents(english);
    return {
      width: el.getBoundingClientRect().width, lines: range.getClientRects().length,
      font: parseFloat(getComputedStyle(english).fontSize), padding: parseFloat(getComputedStyle(el).paddingLeft),
      title: parseFloat(getComputedStyle(el.querySelector('h2')!).fontSize),
      chinese: parseFloat(getComputedStyle(el.querySelector('.zh')!).fontSize)
    };
  });
  const narrow = await metrics();
  expect(narrow).toMatchObject({ width: 240, font: 14 });
  await r.page.setViewportSize({ width: 1000, height: 500 });
  await expect(panel).toHaveCSS('width', '320px');
  await expect.poll(() => offsetFromWord(r.card, word)).toEqual([0, 6]);

  await r.page.setViewportSize({ width: 1800, height: 500 });
  const wide = await metrics();
  expect(wide).toMatchObject({ width: 420, font: 17 });
  expect(wide.lines).toBeLessThan(narrow.lines);
  expect(wide.title).toBeGreaterThan(narrow.title);
  expect(wide.chinese).toBeGreaterThan(narrow.chinese);
  expect(wide.padding).toBeGreaterThan(narrow.padding);
  await r.page.setViewportSize({ width: 480, height: 500 });
  await expect.poll(metrics).toEqual(narrow);
  await expect.poll(() => offsetFromWord(r.card, word)).toEqual([0, 6]);

  await r.page.setViewportSize({ width: 220, height: 110 });
  await expect.poll(() => panel.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return [rect.left, rect.top, document.documentElement.clientWidth - rect.right, document.documentElement.clientHeight - rect.bottom];
  })).toEqual([8, 8, 8, 8]);
  const scrollTop = await panel.evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
  expect(scrollTop).toBeGreaterThan(0);
  expect(r.calls).toHaveLength(1);
});

test('a lookup follows the pointed word fragment within a nested scroll container', async ({ reader: r }) => {
  await r.open('<section id="pane" style="margin:180px 0 0 160px;width:500px;height:200px;overflow:auto">' +
    '<div style="width:900px;height:800px;padding:110px 0 0 140px"><p>They are fund<strong id="part">raising</strong> abroad.</p></div></section>');
  const pane = r.page.locator('#pane'), part = r.page.locator('#part');
  await r.tap('#part', 2);
  await expect(r.card.getByRole('heading')).toHaveText('fundraising');
  await expect(r.card.locator('.zh')).toBeVisible();
  await r.page.mouse.wheel(60, 45);
  await expect.poll(() => pane.evaluate(el => [el.scrollLeft, el.scrollTop])).toEqual([60, 45]);
  await expect.poll(() => offsetFromWord(r.card, part)).toEqual([0, 6]);

  await r.page.mouse.wheel(0, 195);
  await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(240);
  // The word is still inside the browser viewport, but is clipped by the pane.
  expect((await part.boundingBox())!.y).toBeGreaterThan(0);
  await expect(r.card).toBeHidden();
  await pane.evaluate(el => el.scrollTo(30, 20));
  await expect(r.card.locator('.zh')).toBeVisible();
  await expect.poll(() => offsetFromWord(r.card, part)).toEqual([0, 6]);
  expect(r.calls).toHaveLength(1);
});

test('settings save, preserve and remove the key; missing-key card opens settings', async ({ reader: r }) => {
  await r.options();
  await expect(r.page.getByLabel('OpenAI API Key')).toHaveValue('');
  await expect(r.page.locator('#key-state')).toContainText('已保存密钥');
  await r.capture('edge-settings');
  await r.page.getByLabel('模型名称').fill('model-fixture');
  await r.page.getByRole('button', { name: '保存设置' }).click();
  await expect(r.page.getByRole('status')).toHaveText('设置已保存。');
  await r.open();
  await r.tap('#pitch');
  await expect(r.card.locator('.zh')).toBeVisible();
  expect(r.calls[0]).toMatchObject({ authorized: true, model: 'model-fixture', stream: true, reasoning: undefined });
  await r.options();
  await r.page.getByRole('button', { name: '移除密钥' }).click();
  await expect(r.page.locator('#key-state')).toHaveText('尚未保存密钥。');
  await r.open();
  await r.tap('#pitch');
  await expect(r.card).toContainText('请先在设置中保存');
  const open = r.context.waitForEvent('page');
  await r.card.getByRole('button', { name: '打开设置' }).click();
  await expect((await open).getByRole('heading', { name: '阅读设置' })).toBeVisible();
  expect(r.calls).toHaveLength(1);
});
test('cross-tag word; sentence and shortest necessary phrase; keyboard More and Esc', async ({ reader: r }) => {
  await r.open('<p>She is fund<a id="mid" href="/more">rais</a><strong>ing</strong> abroad.</p>' + sample);
  await r.tap('#mid');
  await expect(r.card.locator('h2')).toHaveText('fundraising');
  await expect(r.card.locator('.zh')).toBeVisible();
  expect(r.calls[0]!.input.current_sentence).toBe('She is fundraising abroad.');
  await r.page.keyboard.press('Escape');
  await r.tap('#right');
  await expect(r.card.locator('h2')).toHaveText('earn the right to get there');
  const more = r.card.getByRole('button', { name: 'More' });
  await r.page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await r.page.keyboard.press('Enter');
  await expect(r.card.locator('.note')).toBeVisible();
  await r.page.keyboard.press('Escape');
  await expect(r.card).toHaveCount(0);
  expect(r.calls).toHaveLength(2);
});
test('per-post language on X in Chinese; isolates posts, hidden text, account and toolbar', async ({ reader: r }) => {
  const body = '<article><header id="author">SecretHandle</header><div data-testid="tweetText" lang="en">My <span id="p">pitch</span> isn’t working. <i hidden>hidden123</i><span id="h">Haaalp</span>.</div><button>Boost</button></article>' +
    '<article><div data-testid="tweetText" lang="zh">今天和 <span id="ceo">CEO</span> 聊起融资。</div></article>';
  await r.open(body, 'https://x.com/home', 'zh-CN');
  for (const sel of ['#author', '#ceo']) { await r.tap(sel); await expect(r.card).toHaveCount(0); }
  expect(r.calls).toHaveLength(0);
  await r.tap('#p');
  await expect(r.card.locator('.zh')).toContainText('投资人');
  await r.page.keyboard.press('Escape');
  await r.tap('#h');
  await expect(r.card.locator('.zh')).toContainText('求助');
  expect(r.calls).toHaveLength(2);
  expect(r.calls[1]!.input.previous_context).toBe('My pitch isn’t working.');
  for (const call of r.calls) expect(JSON.stringify(call.input)).not.toMatch(/SecretHandle|hidden123|Boost|CEO|Field notes/);
  await r.page.locator('[data-testid="tweetText"]').first().evaluate(el => {
    el.outerHTML = '<div data-testid="tweetText" lang="en">Read the <span id="next">update</span>.</div>';
  });
  await expect(r.card).toHaveCount(0);
  await r.tap('#next');
  await expect(r.card.locator('h2')).toHaveText('update');
  await expect(r.card.locator('.zh')).toBeVisible();
  expect(r.calls).toHaveLength(3);
});
test('preceding sentence resolves This; insufficient context and different senses have distinct cache entries', async ({ reader: r }) => {
  await r.open('<p>Our costs doubled. <span id="this">This</span> worries me.</p><p><span id="alone">This</span> worries me.</p>' +
    '<p>My <span id="fund">pitch</span> impressed the investors.</p><p>The grass on the <span id="field">pitch</span> was wet.</p>');
  for (const [sel, message] of [['#this','成本上涨'], ['#alone','不足以确定'], ['#fund','推介'], ['#field','球场'], ['#fund','推介']] as const) {
    await r.tap(sel); await expect(r.card).toContainText(message); await r.page.keyboard.press('Escape');
  }
  expect(r.calls).toHaveLength(4);
  await r.options();
  await r.page.getByLabel('模型名称').fill('another-model');
  await r.page.getByRole('button', { name: '保存设置' }).click();
  await expect(r.page.getByRole('status')).toHaveText('设置已保存。');
  await r.page.goBack();
  await r.tap('#fund');
  await expect(r.card).toContainText('推介');
  expect(r.calls).toHaveLength(5);
});
test('mouse selection alone is silent; menu command explains exact phrase', async ({ reader: r }) => {
  await r.open('<article><p>We have to <span id="phrase">break the ice</span> before the meeting.</p></article>');
  const b = (await r.page.locator('#phrase').boundingBox())!;
  const y = b.y + b.height / 2;
  await r.page.mouse.move(b.x, y); await r.page.mouse.down();
  await r.page.mouse.move(b.x + b.width, y, { steps: 12 }); await r.page.mouse.up();
  expect(await r.page.evaluate(() => getSelection()?.toString())).toBe('break the ice');
  await expect(r.card).toHaveCount(0); expect(r.calls).toHaveLength(0);
  await r.menuCommand('#phrase', 'break the ice');
  await expect(r.card.locator('h2')).toHaveText('break the ice');
  await expect(r.card.locator('.zh')).toBeVisible();
  expect(r.calls).toHaveLength(1);
  expect(r.calls[0]!.input.selected_text).toBe('break the ice');
  await r.page.mouse.wheel(0, 25);
  await expect.poll(() => r.page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect.poll(() => offsetFromWord(r.card, r.page.locator('#phrase'))).toEqual([0, 6]);
});
test('in-flight A cannot replace B, and closing or navigating invalidates pending results', async ({ reader: r }) => {
  const held: { release: () => void; route: Route }[] = [];
  r.respond = async (route, call) => {
    if (call.input.selected_text !== 'right') await new Promise<void>(release => held.push({ release, route }));
    await route.fulfill({ json: envelope(answer(call.input)) }).catch(() => {});
  };
  await r.open('<article><p id="first">First query.</p><div style="height:175px"></div><p>Show how you earn the <b id="right">right</b> to get there.</p><p id="late">Later query.</p></article>');
  await r.tap('#first');
  await expect.poll(() => held.length).toBe(1);
  await r.tap('#right');
  await expect(r.card.getByRole('heading')).toHaveText('earn the right to get there');
  held[0]!.release();
  await r.page.waitForTimeout(100);
  await expect(r.card.locator('h2')).toHaveText('earn the right to get there');
  for (const mode of ['escape', 'outside', 'navigation']) {
    await r.page.keyboard.press('Escape');
    const expected = held.length + 1;
    await r.tap('#late');
    await expect.poll(() => held.length).toBe(expected);
    await expect(r.card).toContainText('正在读取');
    if (mode === 'escape') await r.page.keyboard.press('Escape');
    if (mode === 'outside') await r.page.mouse.click(12, 12);
    if (mode === 'navigation') await r.page.evaluate(() => history.pushState({}, '', '/other'));
    await expect(r.card).toHaveCount(0);
    held.at(-1)!.release();
    await r.page.waitForTimeout(80);
    await expect(r.card).toHaveCount(0);
  }
  expect(r.calls).toHaveLength(5);
});
test('a persisted cache survives a page reload and a reused SPA text node invalidates its open card', async ({ reader: r }) => {
  await r.open('<p>My <span id="word">pitch</span> needs work.</p>');
  await r.tap('#word'); await expect(r.card.locator('.zh')).toBeVisible();
  await r.page.reload();
  await r.tap('#word'); await expect(r.card.locator('.zh')).toBeVisible();
  expect(r.calls).toHaveLength(1);
  await r.page.locator('#word').evaluate(el => { el.firstChild!.nodeValue = 'draft'; });
  await expect(r.card).toHaveCount(0);
  await r.tap('#word');
  await expect(r.card.locator('.zh')).toBeVisible();
  expect(r.calls).toHaveLength(2);
  expect(r.calls[1]!.input.selected_text).toBe('draft');
});

test('shows each validated line while the stream is open and only caches a successful completion', async ({ reader: r }) => {
  // route.fulfill buffers the whole body. Feed the worker an open fetch stream so each assertion can hold back the next event.
  const streams = await r.worker.evaluateHandle(() => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({ start: c => { streams.push(c); } }),
      { headers: { 'Content-Type': 'text/event-stream' } });
    return streams;
  });
  const emit = (event: object) => streams.evaluate((list, payload) => {
    list.at(-1)!.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(payload) + '\n\n'));
  }, event);
  const requests = () => streams.evaluate(list => list.length);
  const first = { status: 'ok', target: 'earn the right to get there', meaning_en: 'Earn the confidence of investors.' };
  const final = { ...first, meaning_zh: '赢得投资人的信心。', note_en: 'Show them a credible plan.' };
  await r.open();
  await r.tap('#right');
  await expect.poll(requests).toBe(1);
  await emit({ type: 'response.output_text.delta', delta: JSON.stringify(first).slice(0, -1) });
  await expect(r.card).toContainText(first.meaning_en);
  await expect(r.card.getByRole('heading')).toHaveText(first.target);
  await expect(r.card.locator('.zh')).toHaveCount(0);
  await emit({ type: 'response.output_text.delta', delta: ',"meaning_zh":' + JSON.stringify(final.meaning_zh) });
  await expect(r.card.locator('.zh')).toHaveText(final.meaning_zh);
  await expect(r.card.getByRole('button', { name: 'More' })).toHaveCount(0);
  await emit({ type: 'response.incomplete' });
  await expect(r.card).toContainText('没有返回完整释义');
  await expect(r.card.getByRole('heading')).toHaveText('right');
  await expect(r.card.locator('.zh')).toHaveCount(0);
  await r.card.getByRole('button', { name: '再试一次' }).click();
  await expect.poll(requests).toBe(2);
  await emit({ type: 'response.completed', response: envelope(final) });
  await expect(r.card.getByRole('button', { name: 'More' })).toBeVisible();
  await r.page.keyboard.press('Escape');
  await r.tap('#right');
  await expect(r.card.locator('.zh')).toHaveText(final.meaning_zh);
  expect(await requests()).toBe(2);
});
