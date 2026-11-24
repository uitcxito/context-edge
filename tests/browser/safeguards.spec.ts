import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { answer, envelope, expect, origin, test } from './fixture';

test('with double-click preload off, native selection, copy, alternate chords, Ctrl-click and Ctrl-wheel send zero API requests', async ({ reader: r }) => {
  const p = r.page;
  await r.options();
  await p.getByRole('switch', { name: /双击预查/ }).uncheck();
  await expect.poll(() => r.worker.evaluate(async () => (await chrome.storage.local.get('doubleClickPreload')).doubleClickPreload)).toBe(false);
  await r.open();
  await r.point('#pitch');
  await p.waitForTimeout(550);
  await expect(r.card).toHaveCount(0);
  const pos = await r.point('h1', 3);
  await p.mouse.dblclick(pos.x, pos.y);
  expect(await p.evaluate(() => getSelection()?.toString().trim())).toBe('Finding');
  await r.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await p.keyboard.press('ControlLeft+c');
  expect((await p.evaluate(() => navigator.clipboard.readText())).trim()).toBe('Finding');
  await p.keyboard.press('ControlRight');
  await p.keyboard.press('ControlLeft+ShiftLeft');
  await p.keyboard.down('ControlLeft');
  await p.waitForTimeout(550);
  await p.keyboard.up('ControlLeft');
  await r.point('#pitch');
  await p.evaluate(() => {
    document.addEventListener('wheel', event => {
      document.body.dataset.wheel = String(event.ctrlKey) + '/' + String(event.defaultPrevented);
    }, { once: true, passive: true });
  });
  await p.keyboard.down('ControlLeft');
  await p.mouse.wheel(0, -60);
  await expect(p.locator('body')).toHaveAttribute('data-wheel', 'true/false');
  await p.keyboard.up('ControlLeft');
  const server = createServer((_req, res) => res.end('Linked notes'));
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/notes';
    await p.locator('#pitch').evaluate((el, href) => el.setAttribute('href', href), url);
    const link = await r.point('#pitch');
    const newTab = r.context.waitForEvent('page');
    await p.keyboard.down('ControlLeft'); await p.mouse.click(link.x, link.y); await p.keyboard.up('ControlLeft');
    const opened = await newTab;
    await expect(opened).toHaveURL(url);
    await expect(opened.locator('body')).toContainText('Linked notes');
    await opened.close(); await p.bringToFront();
  } finally { server.close(); }
  await p.mouse.move(5, 5); await p.keyboard.press('ControlLeft');
  await expect(r.card).toHaveCount(0);
  expect(r.calls).toHaveLength(0);
  await r.tap('#pitch'); await expect(r.card.locator('.zh')).toBeVisible();
  expect(r.calls).toHaveLength(1);
});

test('Chinese articles, editable focus, form fields, code and synthetically dispatched gestures stay silent', async ({ reader: r }) => {
  const body = '<p>团队的 <b id="ceo">CEO</b> 开始讨论 <b id="ai">AI</b> 的预算。</p><p>My <span id="p">pitch</span> needs work.</p>' +
    '<input type="password" id="pw"><textarea id="form">My private notes.</textarea><div id="edit" contenteditable>Editable English words</div>' +
    '<div class="cm-editor"><span id="cm">The editor</span></div><pre><code id="code">The example</code></pre><div role="textbox" id="box">Text here</div>';
  await r.open(body, origin + 'mixed', 'zh-CN');
  for (const sel of ['#ceo','#ai','#edit','#cm','#code','#box']) {
    await r.tap(sel); await expect(r.card).toHaveCount(0);
    const word = await r.point(sel);
    await r.page.mouse.dblclick(word.x, word.y);
  }
  await expect(r.page.locator('context-reading-underline')).toHaveCount(0);
  for (const sel of ['#pw','#form','#edit']) {
    await r.page.locator(sel).focus();
    await r.tap('#p'); await expect(r.card).toHaveCount(0);
  }
  await r.page.locator('#pw').focus(); await r.page.keyboard.type('test');
  await expect(r.page.locator('#pw')).toHaveValue('test');
  await r.page.locator('#pw').evaluate(el => el.blur());
  await r.point('#p');
  await r.page.evaluate(() => {
    for (const type of ['keydown','keyup']) window.dispatchEvent(new KeyboardEvent(type, { code: 'ControlLeft', bubbles: true }));
  });
  await r.page.waitForTimeout(120);
  await expect(r.card).toHaveCount(0); expect(r.calls).toHaveLength(0);
  await r.tap('#p'); await expect(r.card.locator('.zh')).toBeVisible();
  expect(r.calls).toHaveLength(1);
});

test('popup switches persist and suppress both keyboard and menu lookups', async ({ reader: r }) => {
  await r.open();
  // Create an inactive extension tab so popup.html resolves the real active reading tab.
  const createPopup = async () => {
    const created = r.context.waitForEvent('page');
    await r.worker.evaluate(async () => { await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: false }); });
    const page = await created;
    await expect(page.locator('#site')).toHaveText('reader.test');
    return page;
  };
  for (const toggle of ['#paused', '#enabled']) {
    let popup = await createPopup();
    await popup.locator(toggle).click();
    await expect(popup.locator('#hint')).toContainText(toggle === '#paused' ? '已暂停' : '已关闭');
    await popup.close();
    await r.tap('#pitch');
    await r.page.locator('#pitch').evaluate(el => {
      const range = new Range(); range.selectNodeContents(el);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    });
    await r.menuCommand('#pitch', 'pitch');
    await r.page.waitForTimeout(120);
    await expect(r.card).toHaveCount(0); expect(r.calls).toHaveLength(0);
    popup = await createPopup();
    await expect(popup.locator(toggle)).toBeChecked({ checked: toggle === '#paused' });
    await popup.locator(toggle).click();
    await expect(popup.locator('#hint')).toContainText('左 Ctrl');
    await popup.close();
  }
  await r.tap('#pitch');
  await expect(r.card.locator('.zh')).toBeVisible(); expect(r.calls).toHaveLength(1);
});
test('injected content scripts cannot read the stored key', async ({ reader: r }) => {
  const cdp = await r.context.newCDPSession(r.page);
  let extensionWorld: number | undefined;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.origin.startsWith('chrome-extension://') && context.auxData?.type === 'isolated') extensionWorld = context.id;
  });
  await cdp.send('Runtime.enable');
  await r.open();
  await expect.poll(() => extensionWorld).toBeDefined();
  const { result } = await cdp.send('Runtime.evaluate', {
    contextId: extensionWorld, awaitPromise: true, returnByValue: true,
    expression: "(async () => { try { await chrome.storage.local.get('apiKey'); return 'readable'; } catch { return 'denied'; } })()"
  });
  expect(result.value).toBe('denied');
  expect(await r.page.evaluate(() => document.documentElement.innerText.includes('context-test-only'))).toBe(false);
});

for (const [name, expected] of [
  ['401', 'API Key 无效'], ['429','请求过于频繁'], ['quota','额度不足'], ['offline','无法连接'],
  ['refusal','拒绝解释'], ['incomplete','完整释义'], ['invalid','格式有误'], ['wrong-target','没有准确覆盖']
] as const) {
  test('API failure ' + name + ' has a distinct message and no automatic retry', async ({ reader: r }) => {
    r.respond = async (route, call) => {
      if (name === 'offline') return route.abort('internetdisconnected');
      if (name === '401' || name === '429' || name === 'quota') return route.fulfill({
        status: name === '401' ? 401 : 429, json: { error: { code: name === 'quota' ? 'insufficient_quota' : 'error' } }
      });
      if (name === 'refusal') return route.fulfill({ json: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] } });
      if (name === 'incomplete') return route.fulfill({ json: { status: 'incomplete' } });
      if (name === 'invalid') return route.fulfill({ json: { status: 'completed', output: [{ type: 'message', content: [{ type:'output_text', text: '{bad' }] }] } });
      return route.fulfill({ json: envelope({ ...answer(call.input), target: 'Turn right' }) });
    };
    await r.open('<p>Turn right or earn the <b id="second">right</b> to go.</p>');
    await r.tap('#second');
    await expect(r.card).toContainText(expected);
    expect(r.calls).toHaveLength(1);
    if (name === 'offline') {
      r.respond = (route, call) => route.fulfill({ json: envelope({ ...answer(call.input), target: 'right' }) });
      await r.card.getByRole('button', { name: '再试一次' }).click();
      await expect(r.card.locator('.zh')).toBeVisible();
      expect(r.calls).toHaveLength(2);
    }
  });
}
test('timeout on a stalled fetch allows a manual retry', async ({ reader: r }) => {
  let release!: () => void;
  r.respond = async route => {
    await new Promise<void>(done => { release = done; });
    await route.abort().catch(() => {});
  };
  await r.open();
  await r.tap('#pitch');
  try {
    await expect(r.card).toContainText('响应超时', { timeout: 26_000 });
    expect(r.calls).toHaveLength(1);
    await expect(r.card.getByRole('button', { name: '再试一次' })).toBeVisible();
  } finally { release?.(); }
});
test('dark narrow viewport keeps the card inside all four corners and treats markup as text', async ({ reader: r }) => {
  await r.page.setViewportSize({ width: 330, height: 445 });
  await r.page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await r.open('<style>p{position:fixed;margin:0;font-size:16px}</style>' +
    ['top:1px;left:1px','top:1px;right:1px','bottom:1px;left:1px','bottom:1px;right:1px']
      .map((s,i) => '<p style="' + s + '">My <a id="p' + i + '">pitch</a>.</p>').join(''));
  r.respond = (route, call) => route.fulfill({ json: envelope({ ...answer(call.input), note_en: '<b>Only text</b>' }) });
  for (let i = 0; i < 4; i++) {
    await r.tap('#p' + i);
    await expect(r.card.locator('.zh')).toBeVisible();
    await r.card.getByRole('button', { name: 'More' }).click();
    await expect(r.card.locator('.note')).toHaveText('<b>Only text</b>');
    await expect(r.card.locator('b')).toHaveCount(0);
    const panel = r.card.locator('article');
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(7); expect(box.x + box.width).toBeLessThanOrEqual(323);
    expect(box.y).toBeGreaterThanOrEqual(7); expect(box.y + box.height).toBeLessThanOrEqual(438);
    expect(await panel.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    expect(await panel.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(41, 41, 37)');
    await r.page.keyboard.press('Escape');
  }
  expect(r.calls).toHaveLength(1);
});
