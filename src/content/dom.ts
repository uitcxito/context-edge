import type { Reading } from '../shared';
import { englishBlock, extractReading, wordAt } from './text';

export const HOST = 'context-reading-card';
const excluded = [
  'input', 'textarea', 'select', 'option', 'button', 'label', 'form', 'pre', 'code', 'kbd', 'samp',
  'nav', 'script', 'style', 'template', 'noscript', 'canvas', 'svg', 'iframe', '[hidden]', '[inert]',
  '[aria-hidden="true"]', '[contenteditable]:not([contenteditable="false" i])', '[role="textbox"]',
  '[role="combobox"]', '[role="button"]', '.monaco-editor', '.CodeMirror', '.cm-editor', '.ace_editor',
  '[data-lexical-editor]', '[data-slate-editor]', '.ProseMirror', HOST
].join(',');
export function skip(element: Element | null) { return Boolean(element?.closest(excluded)); }
function elementAt(node: Node) { return node instanceof Element ? node : node.parentElement; }
const blockTag = 'p,li,dt,dd,blockquote,figcaption,h1,h2,h3,h4,h5,h6,td,th';
const tweet = '[data-testid="tweetText"]';
const onX = /(^|\.)(?:x|twitter)\.com$/i.test(location.hostname);

function scopeOf(element: Element | null): Element | null {
  if (!element || skip(element)) return null;
  if (onX) return element.closest(tweet);
  for (let el: Element | null = element; el; el = el.parentElement) {
    if (el.matches(blockTag) || /^(?:block|list-item|table-cell|flex|grid|flow-root)/.test(getComputedStyle(el).display)) return el;
  }
  return null;
}
interface Leaf { node: Text; start: number }
interface Block { raw: string; leaves: Leaf[]; starts: Map<Text, number> }
function flatten(root: Element): Block {
  const leaves: Leaf[] = [];
  const starts = new Map<Text, number>();
  const chunks: string[] = [];
  let length = 0;
  let previousLine: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Text) return node.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      const el = node as Element;
      if (el.matches(excluded)) return NodeFilter.FILTER_REJECT;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      // In a fallback div/body with direct text, sibling paragraphs are different contexts.
      if (!onX && el.matches(blockTag + ',article,section,div') && !root.matches(blockTag)) return NodeFilter.FILTER_REJECT;
      return el.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      const line = node.parentElement?.closest('p,div,li,blockquote') ?? root;
      if (previousLine && line !== previousLine) { chunks.push('\n'); length++; }
      previousLine = line;
      starts.set(node, length);
      leaves.push({ node, start: length });
      chunks.push(node.data);
      length += node.length;
    } else { chunks.push('\n'); length++; }
  }
  return { raw: chunks.join(''), leaves, starts };
}

export interface Anchor {
  range: Range;
  getRect(): DOMRect | null;
  root: Element;
  /** Detect replacement of the reading block while a card is visible. */
  textAtLookup: string;
  reading: Reading;
}
interface Point { x: number; y: number }
function includes(rect: DOMRect, p: Point) {
  return rect.width > 0 && rect.height > 0 && p.x >= rect.left && p.x < rect.right && p.y >= rect.top && p.y < rect.bottom;
}
function glyphAt(p: Point, hit: Element) {
  const doc = document as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null;
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
  };
  const caret = doc.caretPositionFromPoint?.(p.x, p.y);
  const fallback = !caret && doc.caretRangeFromPoint?.(p.x, p.y);
  const node = caret?.offsetNode ?? (fallback && fallback.startContainer);
  const offset = caret?.offset ?? (fallback && fallback.startOffset);
  if (!(node instanceof Text) || typeof offset !== 'number' || !hit.contains(node)) return null;
  for (const index of [offset, offset - 1]) {
    if (index < 0 || index >= node.length) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    if ([...range.getClientRects()].some(r => includes(r, p))) return { node, index, range };
  }
  return null;
}
function language(root: Element, leaf: Text) {
  const mark = leaf.parentElement?.closest('[lang]');
  if (onX && mark && !root.contains(mark)) return '';
  return mark?.getAttribute('lang') ?? '';
}
function fragmentRect(range: Range, glyph?: Range) {
  const rects = [...range.getClientRects()];
  if (glyph && rects.length > 1) {
    // A word can wrap or cross inline tags. Stay on the fragment originally pointed at.
    const hit = glyph.getBoundingClientRect();
    const center = { x: hit.left + hit.width / 2, y: hit.top + hit.height / 2 };
    return rects.find(rect => includes(rect, center)) ?? hit;
  }
  return rects.find(rect => rect.width && rect.height);
}
function visibleRect(range: Range, leaf: Text, glyph?: Range): DOMRect | null {
  const rect = fragmentRect(range, glyph);
  if (!rect) return null;
  let left = Math.max(rect.left, 0), right = Math.min(rect.right, innerWidth);
  let top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight);
  if (left >= right || top >= bottom) return null;
  for (let el = leaf.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const { overflowX, overflowY, display } = getComputedStyle(el);
    if ((overflowX === 'visible' && overflowY === 'visible') || display === 'inline' || display === 'contents') continue;
    // When the root has visible overflow, the browser applies the body's overflow to the viewport.
    if (el === document.body && getComputedStyle(document.documentElement).overflow === 'visible') continue;
    const box = el.getBoundingClientRect();
    if (overflowX !== 'visible') {
      const x = box.left + el.clientLeft;
      left = Math.max(left, x);
      right = Math.min(right, x + el.clientWidth);
    }
    if (overflowY !== 'visible') {
      const y = box.top + el.clientTop;
      top = Math.max(top, y);
      bottom = Math.min(bottom, y + el.clientHeight);
    }
    if (left >= right || top >= bottom) return null;
  }
  return new DOMRect(left, top, right - left, bottom - top);
}
function makeAnchor(root: Element, block: Block, from: number, to: number, range: Range, leaf: Text, glyph?: Range): Anchor | null {
  if (!englishBlock(block.raw, language(root, leaf))) return null;
  const reading = extractReading(block.raw, from, to, onX ? '' : document.title);
  return reading && {
    root, range, reading, textAtLookup: root.textContent ?? '',
    getRect: () => visibleRect(range, leaf, glyph)
  };
}
export function pointedWord(p: Point): Anchor | null {
  const hit = document.elementFromPoint(p.x, p.y);
  const root = scopeOf(hit);
  if (!root || !hit) return null;
  const glyph = glyphAt(p, hit);
  if (!glyph || scopeOf(glyph.node.parentElement) !== root) return null;
  const block = flatten(root);
  const base = block.starts.get(glyph.node);
  if (base === undefined) return null;
  const word = wordAt(block.raw, base + glyph.index);
  if (!word) return null;
  const first = block.leaves.find(l => l.start + l.node.length > word.start);
  const last = block.leaves.find(l => l.start + l.node.length >= word.end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, word.start - first.start);
  range.setEnd(last.node, word.end - last.start);
  return makeAnchor(root, block, word.start, word.end, range, glyph.node, glyph.range);
}
export function selectionAnchor(range: Range, menuText: string): Anchor | null {
  if (range.collapsed || !range.commonAncestorContainer.isConnected) return null;
  const root = scopeOf(elementAt(range.startContainer));
  if (!root || scopeOf(elementAt(range.endContainer)) !== root) return null;
  const block = flatten(root);
  const selectedLeaves = block.leaves.filter(l => range.intersectsNode(l.node));
  const first = selectedLeaves[0];
  const last = selectedLeaves.at(-1);
  if (!first || !last) return null;
  const from = first.start + (range.startContainer === first.node ? range.startOffset : 0);
  const to = last.start + (range.endContainer === last.node ? range.endOffset : last.node.length);
  const normalize = (s: string) => s.trim().replace(/\s+/gu, ' ');
  if (normalize(block.raw.slice(from, to)) !== normalize(menuText)) return null;
  return fragmentRect(range) ? makeAnchor(root, block, from, to, range, first.node) : null;
}
