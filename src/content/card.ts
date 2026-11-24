import { type ErrorCode, type ExplanationPreview, type Reply } from '../shared';
import { HOST } from './dom';
import { PronunciationButton } from './pronunciation';
import css from './card.css';

const messages: Record<ErrorCode, string> = {
  disabled: '', cancelled: '', noKey: '请先在设置中保存 OpenAI API Key。', badKey: 'API Key 无效或已撤销，请更新密钥。',
  forbidden: '当前 Key 没有调用权限，请检查项目和模型权限。', model: '模型不可用或不支持此请求，请检查模型名称与访问权限。',
  quota: 'OpenAI 项目额度不足，请检查账单与预算。', rate: '请求过于频繁，请稍后再试。',
  network: '无法连接 OpenAI，请检查网络。', timeout: '等待 OpenAI 响应超时，请稍后再试。',
  refusal: '模型拒绝解释这段文字。', incomplete: '模型没有返回完整释义。',
  invalid: '返回的释义格式有误。', target: '返回的短语没有准确覆盖所选位置。',
  service: 'OpenAI 服务暂时不可用。', settings: '无法读取扩展设置。', reload: '扩展已经更新，请刷新网页。'
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
export class Card {
  readonly host = document.createElement(HOST);
  private shadow = this.host.attachShadow({ mode: 'open' });
  private panel = element('article');
  private title = element('h2');
  private pronunciation = new PronunciationButton();
  private body = element('div');
  private english = element('p');
  private chinese = element('p', undefined, 'zh');
  private previousFocus = document.activeElement;
  private resize = new ResizeObserver(() => this.schedulePosition());
  private frame: number | null = null;

  constructor(
    private getAnchorRect: () => DOMRect | null,
    private target: string,
    private retry: () => void,
    private settings: () => void
  ) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    this.shadow.adoptedStyleSheets = [sheet];
    this.host.setAttribute('popover', 'manual');
    this.host.lang = 'zh-CN';
    this.panel.tabIndex = -1;
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-label', 'Context 词义');
    this.setTitle(target);
    this.title.lang = 'en';
    this.english.lang = 'en';
    this.body.setAttribute('aria-live', 'polite');
    this.body.append(element('p', '正在读取语境…', 'status'));
    const heading = element('div', undefined, 'heading');
    heading.append(this.title, this.pronunciation.button);
    this.panel.append(heading, this.pronunciation.message, this.body);
    this.shadow.append(this.panel);
    document.documentElement.append(this.host);
    this.host.showPopover();
    this.position();
    this.panel.focus({ preventScroll: true });
    this.resize.observe(this.panel);
    this.resize.observe(this.title);
  }
  schedulePosition() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.position();
    });
  }
  private position() {
    if (!this.host.isConnected) return;
    const rect = this.getAnchorRect();
    this.host.toggleAttribute('hidden', !rect);
    if (!rect) return;
    const panel = this.panel.getBoundingClientRect();
    const viewport = document.compatMode === 'BackCompat' ? document.body : document.documentElement;
    const { clientWidth, clientHeight } = viewport;
    const margin = 8, gap = 6;
    const x = Math.max(margin, Math.min(rect.left, clientWidth - panel.width - margin));
    const bottomInset = Math.max(margin, clientHeight - rect.top + gap);
    const topInset = Math.max(margin, rect.bottom + gap);
    const spaceAbove = clientHeight - bottomInset - margin;
    const spaceBelow = clientHeight - topInset - margin;

    // Measure where definitions start, even when the panel is scrolled internally.
    const bodyStart = this.body.getBoundingClientRect().top - panel.top + this.panel.scrollTop;
    const style = getComputedStyle(this.panel);
    const lineHeight = parseFloat(style.lineHeight);
    const bottomPadding = parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
    const readableHeight = bodyStart + 2 * lineHeight + bottomPadding;
    const above = spaceAbove >= readableHeight || spaceAbove >= spaceBelow;
    // An oversized glyph can fill a short viewport. Keep one line available to scroll through.
    const oneLine = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + Math.floor(lineHeight) + bottomPadding;
    const inset = Math.min(above ? bottomInset : topInset, Math.max(margin, clientHeight - margin - oneLine));
    this.panel.style.maxHeight = Math.max(0, clientHeight - inset - margin) + 'px';
    this.host.style.setProperty('left', x + 'px', 'important');
    this.host.style.setProperty('top', above ? 'auto' : inset + 'px', 'important');
    this.host.style.setProperty('bottom', above ? inset + 'px' : 'auto', 'important');
  }
  private button(label: string, action: () => void) {
    const button = element('button', label);
    button.type = 'button';
    button.addEventListener('click', e => { if (e.isTrusted) action(); });
    return button;
  }
  private setTitle(target: string) {
    if (this.title.textContent !== target) this.title.textContent = target;
    this.pronunciation.setTarget(target);
  }
  showMeanings({ target, meaning_en, meaning_zh }: ExplanationPreview) {
    this.setTitle(target);
    if (this.english.textContent !== meaning_en) this.english.textContent = meaning_en;
    if (!this.english.parentNode) this.body.replaceChildren(this.english);
    if (meaning_zh && this.chinese.textContent !== meaning_zh) {
      this.chinese.textContent = meaning_zh;
      this.body.append(this.chinese);
    }
  }
  show(reply: Reply) {
    if (!reply.ok) {
      this.setTitle(this.target);
      this.body.replaceChildren(element('p', messages[reply.error], 'status'));
      if (['noKey', 'badKey', 'forbidden', 'model', 'settings'].includes(reply.error)) {
        this.body.append(this.button('打开设置', this.settings));
      } else if (['timeout', 'network', 'rate', 'service', 'incomplete', 'invalid', 'target'].includes(reply.error)) {
        this.body.append(this.button('再试一次', this.retry));
      }
    } else {
      const ex = reply.explanation;
      if (ex.status === 'unclear') {
        this.setTitle(ex.target);
        this.body.replaceChildren(element('p', '这段上下文不足以确定含义。', 'status'));
      } else {
        this.showMeanings(ex);
        if (ex.note_en) {
          const note = element('p', ex.note_en, 'note');
          note.lang = 'en';
          note.id = 'context-note';
          note.hidden = true;
          const more = this.button('More', () => {
            note.hidden = !note.hidden;
            more.setAttribute('aria-expanded', String(!note.hidden));
            more.textContent = note.hidden ? 'More' : 'Less';
            this.position();
          });
          more.lang = 'en';
          more.setAttribute('aria-controls', note.id);
          more.setAttribute('aria-expanded', 'false');
          this.body.append(more, note);
        }
      }
    }
    this.position();
  }
  remove() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.pronunciation.dispose();
    const restore = this.host === document.activeElement && this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected;
    this.host.remove();
    if (restore) (this.previousFocus as HTMLElement).focus({ preventScroll: true });
  }
}
