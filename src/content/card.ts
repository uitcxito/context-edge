import { type ErrorCode, type ExplanationPreview, type Reply } from '../shared';
import { HOST } from './dom';
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
  private body = element('div');
  private english = element('p');
  private chinese = element('p', undefined, 'zh');
  private previousFocus = document.activeElement;
  private resize = new ResizeObserver(() => this.position());
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
    this.title.textContent = target;
    this.title.lang = 'en';
    this.english.lang = 'en';
    this.body.setAttribute('aria-live', 'polite');
    this.body.append(element('p', '正在读取语境…', 'status'));
    this.panel.append(this.title, this.body);
    this.shadow.append(this.panel);
    document.documentElement.append(this.host);
    this.host.showPopover();
    this.position();
    this.panel.focus({ preventScroll: true });
    this.resize.observe(this.panel);
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
    const { width, height } = this.panel.getBoundingClientRect();
    const margin = 8, gap = 6;
    const x = Math.max(margin, Math.min(rect.left, innerWidth - width - margin));
    const below = rect.bottom + gap;
    const y = below + height <= innerHeight - margin ? below : Math.max(margin, rect.top - height - gap);
    this.host.style.setProperty('left', x + 'px', 'important');
    this.host.style.setProperty('top', Math.min(y, Math.max(margin, innerHeight - height - margin)) + 'px', 'important');
  }
  private button(label: string, action: () => void) {
    const button = element('button', label);
    button.type = 'button';
    button.addEventListener('click', e => { if (e.isTrusted) action(); });
    return button;
  }
  showMeanings({ target, meaning_en, meaning_zh }: ExplanationPreview) {
    if (this.title.textContent !== target) this.title.textContent = target;
    if (this.english.textContent !== meaning_en) this.english.textContent = meaning_en;
    if (!this.english.parentNode) this.body.replaceChildren(this.english);
    if (meaning_zh && this.chinese.textContent !== meaning_zh) {
      this.chinese.textContent = meaning_zh;
      this.body.append(this.chinese);
    }
  }
  show(reply: Reply) {
    if (!reply.ok) {
      this.title.textContent = this.target;
      this.body.replaceChildren(element('p', messages[reply.error], 'status'));
      if (['noKey', 'badKey', 'forbidden', 'model', 'settings'].includes(reply.error)) {
        this.body.append(this.button('打开设置', this.settings));
      } else if (['timeout', 'network', 'rate', 'service', 'incomplete', 'invalid', 'target'].includes(reply.error)) {
        this.body.append(this.button('再试一次', this.retry));
      }
    } else {
      const ex = reply.explanation;
      if (ex.status === 'unclear') {
        this.title.textContent = ex.target;
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
    const restore = this.host === document.activeElement && this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected;
    this.host.remove();
    if (restore) (this.previousFocus as HTMLElement).focus({ preventScroll: true });
  }
}
