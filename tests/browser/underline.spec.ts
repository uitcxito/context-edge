import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { answer, envelope, expect, origin, type Reader, test } from './fixture';

const marks = 'context-reading-underline';
const article = '<article><p>My <span id="pitch">pitch</span> is about <b id="fund">fundraising</b>.</p>' +
  '<p>The grass on the <span id="field">pitch</span> was wet.</p></article>';
async function doubleClick(r: Reader, selector: string) {
  const { x, y } = await r.point(selector, 1);
  await r.page.mouse.dblclick(x, y);
}

test('multiple silent preloads preserve selection and reuse pending, out-of-order and completed replies', async ({ reader: r }) => {
  const pending = new Map<string, () => void>();
  r.respond = async (route, call) => {
    await new Promise<void>(resolve => pending.set(call.input.selected_text, resolve));
    await route.fulfill({ json: envelope(answer(call.input)) }).catch(() => {});
  };
  await r.open(article);
  await doubleClick(r, '#pitch');
  await doubleClick(r, '#fund');
  await expect.poll(() => [...pending.keys()].sort()).toEqual(['fundraising', 'pitch']);
  const lines = r.page.locator(marks);
  await expect(lines).toHaveCount(2);
  await expect(r.card).toHaveCount(0);
  await r.page.evaluate(() => history.replaceState({}, '', '#notes'));
  expect(await r.page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await r.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await r.page.keyboard.press('ControlLeft+c');
  expect((await r.page.evaluate(() => navigator.clipboard.readText())).trim()).toBe('fundraising');
  await r.page.locator('#pitch').click();
  await expect(r.card).toContainText('正在读取');
  pending.get('fundraising')!();
  await r.page.keyboard.press('Escape');
  const ink = (await lines.nth(1).locator('svg').boundingBox())!;
  await r.page.mouse.click(ink.x + ink.width / 2, ink.y + ink.height / 2);
  await expect(r.card.getByRole('heading')).toHaveText('fundraising');
  await expect(r.card.locator('.zh')).toBeVisible();
  pending.get('pitch')!();
  await expect(r.card.getByRole('heading')).toHaveText('fundraising');
  await r.page.mouse.click(5, 5);
  await expect(r.card).toHaveCount(0);
  await expect(lines).toHaveCount(2);
  const other = await r.context.newPage();
  await other.bringToFront();
  await r.page.bringToFront();
  await r.page.locator('#pitch').click();
  await expect(r.card).toContainText('向潜在投资人');
  await r.page.keyboard.press('Escape');
  await r.page.locator('#field').click();
  await expect(r.card).toHaveCount(0);
  await r.tap('#pitch');
  await expect(r.card).toContainText('向潜在投资人');
  await r.page.keyboard.press('Escape');
  await expect(lines).toHaveCount(2);
  expect(r.calls).toHaveLength(2);
  await other.close();
});

test('marks distinguish word occurrences and expire with the source, route, reload or site switch', async ({ reader: r }) => {
  await r.open(article);
  const lines = r.page.locator(marks);
  await doubleClick(r, '#pitch');
  await doubleClick(r, '#field');
  await expect(lines).toHaveCount(2);
  await r.page.evaluate(() => history.replaceState({}, '', '#notes'));
  await expect(lines).toHaveCount(2);
  await r.page.locator('#field').click();
  await expect(r.card).toContainText('球场');
  await r.page.keyboard.press('Escape');
  await r.page.locator('#pitch').evaluate(el => { el.firstChild!.nodeValue = 'plan'; });
  await expect(lines).toHaveCount(1);
  await r.page.evaluate(() => history.pushState({}, '', '/next'));
  await expect(lines).toHaveCount(0);
  await doubleClick(r, '#field');
  await expect(lines).toHaveCount(1);
  await r.worker.evaluate(() => chrome.storage.local.set({ 'paused:reader.test': true }));
  await expect(lines).toHaveCount(0);
  await doubleClick(r, '#fund');
  await expect(lines).toHaveCount(0);
  await r.worker.evaluate(() => chrome.storage.local.remove('paused:reader.test'));
  await r.open(article);
  await doubleClick(r, '#field');
  await expect(lines).toHaveCount(1);
  await r.page.reload();
  await expect(lines).toHaveCount(0);
});

test('crayon ink is painted on the local background, updates live, and follows a clipped word through scroll and zoom', async ({ reader: r }) => {
  await r.page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await r.open('<article><section id="pane" style="height:150px;overflow:auto;background:rgb(32 36 32);color:white;padding:10px">' +
    '<p style="margin:50px 0 300px;font-size:20px">My <span id="word">pitch</span> is ready.</p></section></article>');
  await doubleClick(r, '#word');
  const stroke = r.page.locator(marks + ' path');
  const line = r.page.locator(marks + ' svg');
  await expect(stroke).toHaveAttribute('stroke', '#C98B5E');
  await expect(stroke).toHaveAttribute('stroke-width', '3.8');
  expect(await stroke.evaluate(el => el.getAnimations().length)).toBe(0);
  const box = (await line.boundingBox())!;
  const pixels = await r.page.screenshot({ clip: box });
  const painted = await r.page.evaluate(async data => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i]! > rgba[i + 2]! + 10) count++;
    return count;
  }, pixels.toString('base64'));
  expect(painted).toBeGreaterThan(10);
  await r.worker.evaluate(() => chrome.storage.local.set({ underlineTheme: 'blue' }));
  await expect(stroke).toHaveAttribute('stroke', '#8CB0D4');
  await r.page.locator('#pane').evaluate(el => { (el as HTMLElement).style.background = 'white'; el.scrollTop = 25; });
  await expect(stroke).toHaveAttribute('stroke', '#6F93B8');
  await expect.poll(async () => Math.round(box.y - (await line.boundingBox())!.y)).toBe(25);
  await r.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.setZoom(tab!.id!, 1.5);
  });
  await expect.poll(async () => Math.abs((await line.boundingBox())!.x - (await r.page.locator('#word').boundingBox())!.x)).toBeLessThan(1);
  await r.page.locator('#pane').evaluate(el => { el.scrollTop = 240; });
  await expect(line).toHaveCount(0);
  await r.page.locator('#pane').evaluate(el => { el.scrollTop = 0; });
  await expect(line).toBeVisible();
  await r.worker.evaluate(() => chrome.storage.local.set({ underlineTheme: 'clay' }));
  await expect(stroke).toHaveAttribute('stroke', '#C98B5E');
  expect(r.calls).toHaveLength(1);
});

test('menu underlines merge adjacent inline runs per line, trim trailing blanks and fade on close', async ({ reader: r }) => {
  await r.open('<article><p style="width:245px;font:20px/2 monospace;white-space:pre-wrap"><span id="phrase">' +
    '<b id="one">quiet</b> words for an <i id="end">afternoon</i>   </span>read.</p></article>');
  const original = await r.page.locator('#phrase').innerHTML();
  await r.page.locator('#phrase').evaluate(el => {
    const range = new Range();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await r.menuCommand('#one', 'quiet words for an afternoon');
  await expect(r.card.locator('h2')).toHaveText('quiet words for an afternoon');
  const lines = r.page.locator(marks + ' svg');
  await expect(lines).toHaveCount(2);
  await expect(lines.first().locator('path')).toHaveCSS('animation-duration', '0.42s');
  const last = (await lines.last().boundingBox())!, word = (await r.page.locator('#end').boundingBox())!;
  expect(Math.abs(last.x + last.width - word.x - word.width)).toBeLessThan(1);
  expect(await r.page.locator('#phrase').innerHTML()).toBe(original);
  await r.page.keyboard.press('Escape');
  await expect(r.card).toHaveCount(0);
  await expect(lines).toHaveCount(0);
});

test('settings and the unpacked local sample support both gestures and both colors without a key', async ({ reader: r }) => {
  await r.options();
  await r.page.getByRole('button', { name: '移除密钥' }).click();
  await expect(r.page.locator('#key-state')).toHaveText('尚未保存密钥。');
  await r.options();
  const stroke = r.page.locator(marks + ' path');
  await doubleClick(r, '#sample-text span');
  await expect(stroke).toHaveAttribute('stroke', '#6F93B8');
  await expect(r.card).toHaveCount(0);
  await r.page.getByRole('switch', { name: '深色底' }).check();
  await expect(stroke).toHaveAttribute('stroke', '#C98B5E');
  await r.page.getByRole('heading', { name: '查词试玩' }).click();
  await expect(stroke).toBeVisible();
  await r.capture('edge-settings');
  await r.page.getByText('灰蓝', { exact: true }).click();
  await expect(stroke).toHaveAttribute('stroke', '#8CB0D4');
  await r.page.locator('#sample-text span').click();
  await expect(r.card).toContainText('筹集资金');
  await r.page.keyboard.press('Escape');
  await r.page.getByRole('switch', { name: /双击预查/ }).uncheck();
  await expect(stroke).toHaveCount(0);
  await r.tap('#sample-text strong');
  await expect(r.card).toContainText('推介');
  await r.page.keyboard.press('Escape');
  await r.options();
  await expect(r.page.getByRole('radio', { name: '灰蓝' })).toBeChecked();
  await expect(r.page.getByRole('switch', { name: /双击预查/ })).not.toBeChecked();
  await r.page.goto(pathToFileURL(path.resolve('dist/options.html')).href);
  await expect(r.page.getByRole('heading', { name: '试试蜡笔下划线' })).toBeVisible();
  await doubleClick(r, '#sample-text strong');
  await expect(r.card).toHaveCount(0);
  await r.page.locator('#sample-text strong').click();
  await expect(r.card).toContainText('推介');
  expect(r.calls).toHaveLength(0);
});
