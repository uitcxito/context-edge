import { chromium, expect, test as base, type BrowserContext, type Page, type Route, type Worker } from '@playwright/test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Explanation } from '../../src/shared';

type Input = { selected_text: string; current_sentence: string; previous_context: string; following_context: string;
  selected_start: number; selected_end: number; page_title: string };
export interface Call { input: Input; model: string; strict: boolean; noStore: boolean; fromWorker: boolean; authorized: boolean }
export function answer(input: Input): Explanation {
  const basic = { status: 'ok' as const, target: input.selected_text, note_en: '',
    meaning_en: 'The meaning of this expression in the passage.', meaning_zh: '这个表达在文中的含义。' };
  switch (input.selected_text.toLowerCase()) {
    case 'pitch': return { ...basic, meaning_en: input.current_sentence.includes('grass') ? 'The field where the teams play.' : 'The way you present your business idea to potential investors.',
      meaning_zh: input.current_sentence.includes('grass') ? '球队比赛的球场。' : '向潜在投资人推介项目的说辞。' };
    case 'right': return { ...basic, target: 'earn the right to get there', meaning_en: 'Show investors why your ambitious goal is achievable.',
      meaning_zh: '向投资人证明自己有能力实现目标。', note_en: 'A convincing plan earns their confidence.' };
    case 'this': return input.previous_context.includes('costs') ? { ...basic, meaning_en: 'The rise in costs mentioned just before.', meaning_zh: '指前文说的成本上涨。' } :
      { ...basic, status: 'unclear', meaning_en: '', meaning_zh: '' };
    case 'haaalp': return { ...basic, meaning_en: 'A playful, drawn-out call for help.', meaning_zh: '拖长语气、带点玩笑的求助。' };
    default: return basic;
  }
}
export function envelope(ex: unknown) {
  return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(ex) }] }] };
}
export const origin = 'https://reader.test/';
export const sample = '<article><h1>Finding the right words</h1><p>We met with the investors on Thursday. My <a id="pitch" href="/notes">pitch</a> isn’t working on the fundraising side. We have one more meeting tomorrow.</p><p>Show how you earn the <strong id="right">right</strong> to get there.</p></article>';
function html(body: string, lang: string) {
  return '<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><title>Field notes</title><style>' +
    '*{box-sizing:border-box}body{margin:0;background:#f8f7f2;color:#23302b;font:21px/1.7 Georgia,serif;min-height:160vh}' +
    'article{max-width:760px;margin:0 auto;padding:64px 36px}h1{font:normal clamp(30px,5vw,54px)/1.12 Georgia,serif;letter-spacing:-.04em;margin:0 0 40px}' +
    'p{margin:0 0 24px}a{color:#28594e;text-underline-offset:4px;text-decoration-thickness:1px}button,input,textarea{font:inherit}' +
    '@media(prefers-color-scheme:dark){body{background:#202420;color:#eceee6}a{color:#b7d9c2}}' +
    '</style></head><body>' + body + '</body></html>';
}
export class Reader {
  readonly calls: Call[] = [];
  readonly extension: string;
  respond = (route: Route, call: Call) => route.fulfill({ json: envelope(answer(call.input)) });
  constructor(readonly context: BrowserContext, readonly page: Page, readonly worker: Worker) {
    this.extension = worker.url().slice(0, worker.url().indexOf('/js/'));
  }
  async installMock() {
    await this.context.route('https://api.openai.com/**', async route => {
      const req = route.request();
      if (req.url() !== 'https://api.openai.com/v1/responses' || req.method() !== 'POST') {
        await route.fulfill({ status: 404, body: '{}' }); return;
      }
      const body = req.postDataJSON();
      const call: Call = {
        input: JSON.parse(body.input.at(-1).content), model: body.model,
        strict: body.text.format.strict === true && body.text.format.type === 'json_schema' && body.text.format.schema.additionalProperties === false,
        noStore: body.store === false, fromWorker: Boolean(req.serviceWorker()), authorized: req.headers().authorization === 'Bearer context-test-only'
      };
      this.calls.push(call);
      await this.respond(route, call);
    });
  }
  async options(page = this.page) {
    await page.goto(this.extension + '/options.html');
    await expect(page.getByRole('button', { name: '保存设置' })).toBeEnabled();
  }
  async open(body = sample, url = origin + 'reading', lang = 'en') {
    await this.context.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html(body, lang) }));
    await this.page.goto(url);
    await this.page.bringToFront();
    await this.page.locator('body').waitFor();
  }
  get card() { return this.page.locator('context-reading-card'); }
  async point(selector: string, index = 0) {
    const p = await this.page.locator(selector).evaluate((element, i) => {
      const it = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = it.nextNode())) {
        if (i >= n.textContent!.length) { i -= n.textContent!.length; continue; }
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 1);
        const rect = r.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      throw Error('Missing glyph in ' + element.outerHTML);
    }, index);
    await this.page.mouse.move(p.x, p.y);
    return p;
  }
  async tap(selector: string, index = 0) {
    await this.point(selector, index);
    await this.page.keyboard.press('ControlLeft');
  }
  async menuCommand(selector: string, target: string) {
    const pos = await this.point(selector, 1);
    await this.page.mouse.click(pos.x, pos.y, { button: 'right' });
    // Chromium's native menu is outside the Playwright page. Deliver its normal tab message.
    await this.worker.evaluate(async text => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab!.id!, { type: 'selection', text }, { frameId: 0 });
    }, target);
  }
  async capture(name: string) {
    const dir = process.env.CONTEXT_SCREENSHOTS;
    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await this.page.screenshot({ path: path.join(dir, name + '.png'), animations: 'disabled' });
  }
}
export const test = base.extend<{ reader: Reader }>({
  reader: async ({}, use) => {
    const dist = path.resolve('dist');
    const ctx = await chromium.launchPersistentContext('', {
      channel: 'chromium', executablePath: process.env.CONTEXT_EDGE_BINARY, headless: true,
      args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
      viewport: { width: 1100, height: 760 }, locale: 'zh-CN', colorScheme: 'light'
    });
    try {
      const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
      const page = ctx.pages()[0] ?? await ctx.newPage();
      const reader = new Reader(ctx, page, worker);
      await reader.installMock();
      await reader.options();
      await page.getByLabel('OpenAI API Key').fill('context-test-only');
      await page.getByRole('button', { name: '保存设置' }).click();
      await expect(page.getByRole('status')).toHaveText('设置已保存。');
      await use(reader);
    } finally { await ctx.close(); }
  }
});
export { expect };
