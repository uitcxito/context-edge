import { readingPreferences, type ExplanationPreview, type Reading, type ReadingPreferences, type Reply } from '../shared';
import { Card } from './card';
import { type Anchor, HOST, pointedWord, selectionAnchor, skip } from './dom';
import { CtrlTap } from './gesture';
import { CrayonUnderline } from './underline';

interface LookupService {
  lookup(id: string, reading: Reading, preload: boolean): Promise<Reply>;
  cancel(id: string): void;
  options(): void;
}
interface Mark {
  id: string;
  anchor: Anchor;
  line: CrayonUnderline;
  persistent: boolean;
  reply?: Reply;
  preview?: ExplanationPreview;
}
const capture = { capture: true, passive: true } as const;
const interactive = 'a[href],area[href],[role="link"],summary,audio,video';
function plainClick(event: MouseEvent) {
  return event.isTrusted && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
function sameRange(a: Range, b: Range) {
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}
function requestId() {
  // randomUUID isn't available on all HTTP reading pages.
  return Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
}

export class ReadingSession {
  enabled = false;
  private prefs = readingPreferences({});
  private zoom = 1;
  private marks = new Map<string, Mark>();
  private opened?: { mark: Mark; card: Card };
  private frame?: number;
  private resize = new ResizeObserver(() => this.schedule());
  private observer = new MutationObserver(records => {
    if (records.every(r => r.target instanceof Element && r.target.matches(HOST + ',context-reading-underline'))) return;
    for (const mark of this.marks.values()) {
      const { root, range, textAtLookup } = mark.anchor;
      if (!root.isConnected || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer) ||
          (records.some(r => r.type !== 'attributes' && root.contains(r.target)) && root.textContent !== textAtLookup)) this.discard(mark);
    }
    this.schedule();
  });
  private menuRange: Range | null = null;

  constructor(private service: LookupService, private scope?: Element) {
    this.bindGestures();
    window.addEventListener('scroll', e => {
      if (!this.insideCard(e)) this.schedule();
    }, capture);
    window.addEventListener('resize', () => this.schedule());
    document.fonts.addEventListener('loadingdone', () => this.schedule());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.schedule());
    const articleUrl = () => {
      const url = new URL(location.href);
      // A section link can scroll within the same article. Hash routers use #/ or #! for a new view.
      if (!/^#[!/]/.test(url.hash)) url.hash = '';
      return url.href;
    };
    let article = articleUrl();
    const navigate = () => {
      const next = articleUrl();
      if (next !== article) this.clear();
      article = next;
    };
    window.addEventListener('pagehide', () => this.clear());
    window.addEventListener('hashchange', navigate);
    window.addEventListener('popstate', navigate);
    (window as Window & { navigation?: EventTarget }).navigation?.addEventListener('currententrychange', navigate);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.closeCard();
        this.tap.reset();
        this.menuRange = null;
        this.point = null;
        this.buttons = 0;
      } else this.schedule();
    });
  }
  setPreferences(prefs: ReadingPreferences) {
    this.prefs = prefs;
    if (!prefs.doubleClickPreload) for (const mark of this.marks.values()) if (mark.persistent) this.discard(mark);
    this.schedule();
  }
  setZoom(factor: number) {
    this.zoom = factor;
    this.opened?.card.setPageZoom(factor);
    this.tap.cancel();
    this.schedule();
  }
  preview(id: string, result: ExplanationPreview) {
    const mark = this.marks.get(id);
    if (!mark || mark.reply) return;
    mark.preview = result;
    if (this.opened?.mark === mark) this.opened.card.showMeanings(result);
  }
  explainSelection(text: string) {
    const range = this.menuRange;
    this.menuRange = null;
    if (!this.enabled || !range || document.designMode === 'on') return;
    const anchor = selectionAnchor(range, text);
    if (anchor) this.lookup(anchor, false);
  }
  clear() {
    for (const mark of this.marks.values()) this.discard(mark);
    this.tap.reset();
    this.menuRange = null;
    this.point = null;
    this.buttons = 0;
  }
  private schedule() {
    if (this.frame !== undefined || !this.marks.size) return;
    this.opened?.card.schedulePosition();
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      for (const mark of this.marks.values()) mark.line.position(this.prefs.underlineTheme);
    });
  }
  private discard(mark: Mark, fade = false) {
    if (this.opened?.mark === mark) {
      this.opened.card.remove();
      this.opened = undefined;
    }
    this.marks.delete(mark.id);
    mark.line.remove(fade);
    if (!mark.reply) this.service.cancel(mark.id);
    if (![...this.marks.values()].some(m => m.anchor.root === mark.anchor.root)) this.resize.unobserve(mark.anchor.root);
    if (!this.marks.size) {
      this.observer.disconnect();
      this.resize.disconnect();
    }
  }
  private closeCard() {
    const open = this.opened;
    if (!open) return;
    this.opened = undefined;
    open.card.remove();
    if (!open.mark.persistent) this.discard(open.mark, true);
  }
  private open(mark: Mark) {
    if (this.opened?.mark === mark) return;
    this.closeCard();
    const card = new Card(mark.anchor.getRect, mark.anchor.reading.selected, this.zoom, () => {
      const { anchor, persistent } = mark;
      this.discard(mark);
      const retry = this.lookup(anchor, persistent);
      if (retry) this.open(retry);
    }, () => this.service.options());
    this.opened = { mark, card };
    if (mark.reply) card.show(mark.reply);
    else if (mark.preview) card.showMeanings(mark.preview);
  }
  private lookup(anchor: Anchor, preload: boolean) {
    if (!this.enabled || !anchor.root.isConnected || anchor.range.collapsed || (this.scope && !this.scope.contains(anchor.root))) return;
    const match = [...this.marks.values()].find(m => sameRange(m.anchor.range, anchor.range));
    if (match) {
      if (preload) match.persistent = true;
      else this.open(match);
      return match;
    }
    if (!preload) this.closeCard();
    const mark: Mark = { id: requestId(), anchor, persistent: preload, line: new CrayonUnderline(anchor, this.prefs.underlineTheme) };
    if (!this.marks.size) {
      this.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      this.resize.observe(document.documentElement);
    }
    this.resize.observe(anchor.root);
    this.marks.set(mark.id, mark);
    if (!preload) this.open(mark);
    void this.service.lookup(mark.id, anchor.reading, preload)
      .catch((): Reply => ({ ok: false, error: 'reload' }))
      .then(reply => {
        if (this.marks.get(mark.id) !== mark) return;
        if (!reply || (!reply.ok && (reply.error === 'disabled' || reply.error === 'cancelled'))) { this.discard(mark); return; }
        mark.reply = reply;
        mark.preview = undefined;
        if (this.opened?.mark === mark) this.opened.card.show(reply);
      });
    return mark;
  }
  private insideCard(event: Event) {
    return Boolean(this.opened && event.composedPath().includes(this.opened.card.host));
  }
  private editing(event: Event) {
    if (this.insideCard(event)) return false;
    // After trying a sample color, the radio or switch can still have keyboard focus.
    if (this.scope && event instanceof KeyboardEvent && this.point && document.activeElement?.matches('input[type=radio],input[type=checkbox]') &&
        this.scope.contains(document.elementFromPoint(this.point.x, this.point.y))) return false;
    const target = event.composedPath().find(v => v instanceof Element);
    return document.designMode === 'on' || skip(target instanceof Element ? target : null) || skip(document.activeElement);
  }
  private tap = new CtrlTap();
  private point: { x: number; y: number } | null = null;
  private buttons = 0;

  private bindGestures() {
    let press: { mark: Mark; x: number; y: number } | undefined;
    window.addEventListener('pointermove', e => {
      if (!e.isTrusted || e.pointerType !== 'mouse') return;
      this.point = { x: e.clientX, y: e.clientY };
      this.buttons = e.buttons;
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press = undefined;
    }, capture);
    window.addEventListener('pointerout', e => { if (!e.relatedTarget) { this.point = null; this.tap.cancel(); } }, capture);
    window.addEventListener('pointerdown', e => {
      if (!e.isTrusted) return;
      press = undefined;
      this.tap.cancel();
      this.buttons = e.buttons;
      this.menuRange = null;
      if (this.insideCard(e)) return;
      this.closeCard();
      if (!plainClick(e) || !this.enabled || !this.prefs.doubleClickPreload || !(e.target instanceof Element) ||
          skip(e.target) || e.target.closest(interactive)) return;
      const target = e.target;
      const mark = [...this.marks.values()].find(m => m.persistent && (m.anchor.root.contains(target) || target.contains(m.anchor.root))
        && m.line.hit(e.clientX, e.clientY));
      if (mark) press = { mark, x: e.clientX, y: e.clientY };
    }, capture);
    window.addEventListener('pointerup', e => { this.buttons = e.buttons; this.tap.cancel(); }, capture);
    window.addEventListener('pointercancel', () => { press = undefined; this.buttons = 0; this.tap.cancel(); }, capture);
    window.addEventListener('click', e => {
      const clicked = press;
      press = undefined;
      if (clicked && plainClick(e) && e.detail !== 2 && !this.editing(e) && this.marks.has(clicked.mark.id) &&
          clicked.mark.line.hit(e.clientX, e.clientY)) this.open(clicked.mark);
    }, capture);
    window.addEventListener('dblclick', e => {
      if (!plainClick(e) || !this.enabled || !this.prefs.doubleClickPreload || this.insideCard(e) || this.editing(e) ||
          !(e.target instanceof Element) || e.target.closest(interactive)) return;
      const selection = getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const anchor = pointedWord({ x: e.clientX, y: e.clientY });
      if (anchor && selection.toString().trim() === anchor.reading.selected && selection.containsNode(anchor.range.startContainer, true)) {
        this.lookup(anchor, true);
      }
    }, capture);
    window.addEventListener('wheel', () => this.tap.cancel(), capture);
    window.addEventListener('keydown', e => {
      if (!e.isTrusted) return;
      this.tap.down(e, performance.now());
      if (e.code === 'ControlLeft' && (!this.enabled || this.buttons || this.editing(e))) this.tap.cancel();
      if (e.key === 'Escape') this.closeCard();
    }, capture);
    window.addEventListener('keyup', e => {
      if (!e.isTrusted || !this.tap.up(e.code, performance.now()) || !this.enabled || !this.point || this.buttons || this.editing(e)) return;
      const anchor = pointedWord(this.point);
      if (anchor) this.lookup(anchor, false);
    }, capture);
    window.addEventListener('contextmenu', e => {
      this.menuRange = null;
      if (!e.isTrusted || !this.enabled || this.editing(e)) return;
      const selection = getSelection();
      if (selection?.rangeCount === 1 && !selection.isCollapsed) this.menuRange = selection.getRangeAt(0).cloneRange();
    }, capture);
    window.addEventListener('scroll', () => this.tap.cancel(), capture);
    window.addEventListener('blur', () => { this.tap.reset(); this.buttons = 0; press = undefined; });
  }
}
