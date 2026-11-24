import type { UnderlineTheme } from '../shared';
import { clippingBounds, type Anchor } from './dom';

const ns = 'http://www.w3.org/2000/svg';
const blue = '#6F93B8', lightBlue = '#8CB0D4', clay = '#C98B5E';
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const scheme = matchMedia('(prefers-color-scheme: dark)');
let nextFilter = 0;
let sheet: CSSStyleSheet | undefined;
let canvas: CanvasRenderingContext2D | null = null;

function darkBehind(element: Element) {
  // Composite translucent backgrounds from the text outwards to the page canvas.
  let red = 0, green = 0, blueChannel = 0, remaining = 1;
  for (let el: Element | null = element; el && remaining > .005; el = el.parentElement) {
    const style = getComputedStyle(el);
    const color = style.backgroundColor;
    if (style.backgroundImage !== 'none') {
      // The image's pixels are unavailable. The author's text color is a local contrast cue.
      const ink = style.color.match(/[\d.]+/g)?.map(Number);
      if (ink && ink.length >= 3) {
        const backdrop = .2126 * ink[0]! + .7152 * ink[1]! + .0722 * ink[2]! > 150 ? 0 : 255;
        red += backdrop * remaining; green += backdrop * remaining; blueChannel += backdrop * remaining;
        remaining = 0;
        break;
      }
    }
    if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') continue;
    let channels: number[];
    if (color.startsWith('rgb')) channels = color.match(/[\d.]+/g)!.map(Number);
    else {
      // Convert CSS Color 4 values such as oklch() to sRGB using the browser.
      canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (!canvas) continue;
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = color;
      canvas.fillRect(0, 0, 1, 1);
      channels = Array.from(canvas.getImageData(0, 0, 1, 1).data);
      channels[3] = channels[3]! / 255;
    }
    const alpha = channels[3] ?? 1;
    red += channels[0]! * alpha * remaining;
    green += channels[1]! * alpha * remaining;
    blueChannel += channels[2]! * alpha * remaining;
    remaining *= 1 - alpha;
  }
  const modes = getComputedStyle(document.documentElement).colorScheme;
  const darkCanvas = modes.includes('dark') && (!modes.includes('light') || scheme.matches);
  const base = darkCanvas ? 0 : 255;
  return .2126 * red + .7152 * green + .0722 * blueChannel + base * remaining < 128;
}

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function createStroke(animate: boolean) {
  const id = 'grain-' + ++nextFilter;
  const image = svg('svg', { 'aria-hidden': 'true' });
  const defs = svg('defs');
  const filter = svg('filter', { id, filterUnits: 'userSpaceOnUse', x: -10, y: -10, height: 45 });
  filter.append(
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.04 0.5', numOctaves: 2, seed: 4, result: 'edge' }),
    svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge', scale: 1.4, result: 'stroke' }),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: 1.1, numOctaves: 2, seed: 9, result: 'grain' }),
    svg('feColorMatrix', { in: 'grain', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.4 0 0 0 -1.3', result: 'holes' }),
    svg('feComposite', { in: 'stroke', in2: 'holes', operator: 'in' })
  );
  defs.append(filter);
  const group = svg('g', { filter: 'url(#' + id + ')' });
  const path = svg('path', { fill: 'none', 'stroke-linecap': 'round', pathLength: 1 });
  if (animate) path.classList.add('draw');
  group.append(path);
  image.append(defs, group);
  return { image, path, filter };
}

interface Line {
  left: number; right: number; top: number; bottom: number; clipBottom: number; size: number; color: string;
}
function measure(anchor: Anchor, theme: UnderlineTheme) {
  const lines: Line[] = [];
  for (const run of anchor.runs) {
    const el = run.startContainer.parentElement;
    const rects = [...run.getClientRects()].filter(r => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight);
    if (!el || !rects.length) continue;
    const style = getComputedStyle(el);
    if (style.visibility !== 'visible') continue;
    let box: Element | null = el;
    while (box && getComputedStyle(box).display === 'contents') box = box.parentElement;
    if (!box?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
    const clip = clippingBounds(el);
    const size = parseFloat(style.fontSize) || 16;
    const dark = theme !== 'clay' && darkBehind(el);
    const color = theme === 'clay' || (theme === 'auto' && dark) ? clay : dark ? lightBlue : blue;
    for (const rect of rects) {
      const left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right);
      const top = Math.max(rect.top, clip.top);
      if (right <= left || Math.min(rect.bottom, clip.bottom) <= top) continue;
      const prev = lines.at(-1);
      const overlap = prev ? Math.min(prev.bottom, rect.bottom) - Math.max(prev.top, top) : 0;
      if (prev && overlap > Math.min(prev.bottom - prev.top, rect.height) * .6 && Math.abs(prev.right - left) < 1 &&
          prev.color === color && prev.clipBottom === clip.bottom) {
        prev.right = right;
        prev.top = Math.min(prev.top, top);
        prev.bottom = Math.max(prev.bottom, rect.bottom);
        prev.size = Math.max(prev.size, size);
      } else lines.push({ left, right, top, bottom: rect.bottom, clipBottom: clip.bottom, size, color });
    }
  }
  return lines;
}

export class CrayonUnderline {
  private host = document.createElement('context-reading-underline');
  private layer = document.createElement('div');
  private strokes: ReturnType<typeof createStroke>[] = [];
  private hits: DOMRect[] = [];

  constructor(private anchor: Anchor, theme: UnderlineTheme) {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        :host { all: initial !important; position: fixed !important; display: block !important;
          inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; overflow: visible !important;
          pointer-events: none !important; z-index: 2147483646 !important; }
        svg { position: absolute; overflow: hidden; pointer-events: none; }
        @media (prefers-reduced-motion: no-preference) {
          .draw { stroke-dasharray: 1; animation: draw 420ms cubic-bezier(.25,.8,.25,1); }
          @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        }`);
    }
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [sheet];
    this.host.setAttribute('aria-hidden', 'true');
    shadow.append(this.layer);
    document.documentElement.append(this.host);
    this.position(theme, true);
  }

  position(theme: UnderlineTheme, animate = false) {
    this.hits = [];
    let index = 0;
    for (const line of measure(this.anchor, theme)) {
      const sw = Math.min(5, Math.max(2.5, line.size * .19));
      const width = line.right - line.left, top = line.bottom + line.size * .04;
      const height = Math.min(Math.ceil(sw * 2 + 2), line.clipBottom - top);
      this.hits.push(new DOMRect(line.left, line.top, width, Math.min(line.clipBottom, top + sw * 2 + 2) - line.top));
      if (height <= 0) continue;
      let stroke = this.strokes[index++];
      if (!stroke) {
        stroke = createStroke(animate);
        this.strokes.push(stroke);
        this.layer.append(stroke.image);
      }
      const inset = Math.min(width / 2, sw / 2);
      stroke.image.style.left = line.left + 'px';
      stroke.image.style.top = top + 'px';
      stroke.image.setAttribute('width', String(width));
      stroke.image.setAttribute('height', String(height));
      stroke.filter.setAttribute('width', String(width + 20));
      stroke.path.setAttribute('d', 'M' + inset + ',' + sw + ' L' + (width - inset) + ',' + (sw + .8));
      stroke.path.setAttribute('stroke', line.color);
      stroke.path.setAttribute('stroke-width', String(sw));
    }
    for (const stroke of this.strokes.splice(index)) stroke.image.remove();
  }

  hit(x: number, y: number) {
    return this.hits.some(r => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
  }
  remove(fade = false) {
    if (!fade || motion.matches) { this.host.remove(); return; }
    const animation = this.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    animation.finished.then(() => this.host.remove(), () => this.host.remove());
  }
}
