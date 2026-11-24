"use strict";
(() => {
  // src/shared.ts
  var CONTEXT_LIMIT = 1200;
  var TARGET_LIMIT = 260;
  var TITLE_LIMIT = 100;
  function englishSelection(text) {
    return new RegExp("\\p{Script=Latin}", "u").test(text) && !new RegExp("\\p{L}", "u").test(text.replace(new RegExp("\\p{Script=Latin}", "gu"), ""));
  }

  // src/content/text.ts
  var words = new Intl.Segmenter("en", { granularity: "word" });
  var sentences = new Intl.Segmenter("en", { granularity: "sentence" });
  var commonEnglish = /\b(?:a|an|the|i|he|she|we|you|they|my|your|our|it|its|of|to|and|but|or|for|from|with|on|in|at|is|are|was|were|be|been|have|had|has|can|could|will|would|that|this|these|those|how|what|who|why|if|not|as|by|so|out|up|down|off|back|there|here|please|help)\b/gi;
  var compact = (s) => s.replace(/\s+/gu, " ");
  function englishBlock(text, lang) {
    const latin = text.match(new RegExp("\\p{Script=Latin}", "gu"))?.length ?? 0;
    const letters = text.match(new RegExp("\\p{L}", "gu"))?.length ?? 0;
    if (!latin || latin / letters < 0.78) return false;
    const tokens = text.match(new RegExp("\\p{Script=Latin}+(?:['’]\\p{Script=Latin}+)*", "gu")) ?? [];
    const cues = (text.match(commonEnglish) ?? []).length;
    const containsCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
    if (containsCJK && (tokens.length < 3 || cues === 0)) return false;
    if (/^en(?:-|$)/i.test(lang)) return true;
    if (/^(fr|de|es|pt|it|nl|sv|no|da|fi|pl|tr|ro|vi)(?:-|$)/i.test(lang)) return false;
    return tokens.length >= 2 && cues >= 1 || tokens.length === 1 && /^(?:h+a+l+p|help|thanks|hello|wow|ouch|oops)$/i.test(tokens[0]);
  }
  function wordAt(raw, index) {
    const segment = words.segment(raw).containing(index);
    if (!segment?.isWordLike || !/^[\p{Script=Latin}\p{M}]+(?:['’][\p{Script=Latin}\p{M}]+)*$/u.test(segment.segment)) return null;
    return { start: segment.index, end: segment.index + segment.segment.length };
  }
  function windowAround(length, start, end, budget) {
    const left = Math.max(0, Math.min(start - Math.floor((budget - (end - start)) / 2), length - budget));
    return { left, right: Math.min(length, left + budget) };
  }
  function extractReading(raw, from, to, pageTitle) {
    if (from < 0 || to > raw.length || from >= to) return null;
    const span = raw.slice(from, to);
    const trimmed = span.trim();
    const selected = compact(trimmed);
    if (!selected || selected.length > TARGET_LIMIT || !englishSelection(selected)) return null;
    from += span.length - span.trimStart().length;
    to = from + trimmed.length;
    const prefix = compact(raw.slice(0, from)).trimStart();
    const text = prefix + selected + compact(raw.slice(to)).trimEnd();
    const start = prefix.length;
    const end = start + selected.length;
    const parts = sentences.segment(text);
    const first = parts.containing(start);
    const last = parts.containing(end - 1);
    const sentenceStart = first.index;
    const sentenceEnd = last.index + last.segment.trimEnd().length;
    const title = compact(pageTitle).trim().slice(0, TITLE_LIMIT);
    const budget = CONTEXT_LIMIT - title.length;
    const focus = windowAround(sentenceEnd - sentenceStart, start - sentenceStart, end - sentenceStart, budget);
    const fromSentence = sentenceStart + focus.left;
    const toSentence = sentenceStart + focus.right;
    const window2 = windowAround(text.length, fromSentence, toSentence, budget);
    return {
      selected,
      title,
      before: text.slice(window2.left, fromSentence).trim(),
      sentence: text.slice(fromSentence, toSentence),
      after: text.slice(toSentence, window2.right).trim(),
      start: start - fromSentence,
      end: end - fromSentence
    };
  }

  // src/content/dom.ts
  var HOST = "context-reading-card";
  var excluded = [
    "input",
    "textarea",
    "select",
    "option",
    "button",
    "label",
    "form",
    "pre",
    "code",
    "kbd",
    "samp",
    "nav",
    "script",
    "style",
    "template",
    "noscript",
    "canvas",
    "svg",
    "iframe",
    "[hidden]",
    "[inert]",
    '[aria-hidden="true"]',
    '[contenteditable]:not([contenteditable="false" i])',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="button"]',
    ".monaco-editor",
    ".CodeMirror",
    ".cm-editor",
    ".ace_editor",
    "[data-lexical-editor]",
    "[data-slate-editor]",
    ".ProseMirror",
    HOST
  ].join(",");
  function skip(element2) {
    return Boolean(element2?.closest(excluded));
  }
  function elementAt(node) {
    return node instanceof Element ? node : node.parentElement;
  }
  var blockTag = "p,li,dt,dd,blockquote,figcaption,h1,h2,h3,h4,h5,h6,td,th";
  var tweet = '[data-testid="tweetText"]';
  var onX = /(^|\.)(?:x|twitter)\.com$/i.test(location.hostname);
  function scopeOf(element2) {
    if (!element2 || skip(element2)) return null;
    if (onX) return element2.closest(tweet);
    for (let el = element2; el; el = el.parentElement) {
      if (el.matches(blockTag) || /^(?:block|list-item|table-cell|flex|grid|flow-root)/.test(getComputedStyle(el).display)) return el;
    }
    return null;
  }
  function flatten(root) {
    const leaves = [];
    const starts = /* @__PURE__ */ new Map();
    const chunks = [];
    let length = 0;
    let previousLine = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node instanceof Text) return node.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        const el = node;
        if (el.matches(excluded)) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
        if (!onX && el.matches(blockTag + ",article,section,div") && !root.matches(blockTag)) return NodeFilter.FILTER_REJECT;
        return el.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text) {
        const line = node.parentElement?.closest("p,div,li,blockquote") ?? root;
        if (previousLine && line !== previousLine) {
          chunks.push("\n");
          length++;
        }
        previousLine = line;
        starts.set(node, length);
        leaves.push({ node, start: length });
        chunks.push(node.data);
        length += node.length;
      } else {
        chunks.push("\n");
        length++;
      }
    }
    return { raw: chunks.join(""), leaves, starts };
  }
  function includes(rect, p) {
    return rect.width > 0 && rect.height > 0 && p.x >= rect.left && p.x < rect.right && p.y >= rect.top && p.y < rect.bottom;
  }
  function glyphAt(p, hit) {
    const doc = document;
    const caret = doc.caretPositionFromPoint?.(p.x, p.y);
    const fallback = !caret && doc.caretRangeFromPoint?.(p.x, p.y);
    const node = caret?.offsetNode ?? (fallback && fallback.startContainer);
    const offset = caret?.offset ?? (fallback && fallback.startOffset);
    if (!(node instanceof Text) || typeof offset !== "number" || !hit.contains(node)) return null;
    for (const index of [offset, offset - 1]) {
      if (index < 0 || index >= node.length) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      if ([...range.getClientRects()].some((r) => includes(r, p))) return { node, index, range };
    }
    return null;
  }
  function language(root, leaf) {
    const mark = leaf.parentElement?.closest("[lang]");
    if (onX && mark && !root.contains(mark)) return "";
    return mark?.getAttribute("lang") ?? "";
  }
  function fragmentRect(range, glyph) {
    const rects = [...range.getClientRects()];
    if (glyph && rects.length > 1) {
      const hit = glyph.getBoundingClientRect();
      const center = { x: hit.left + hit.width / 2, y: hit.top + hit.height / 2 };
      return rects.find((rect) => includes(rect, center)) ?? hit;
    }
    return rects.find((rect) => rect.width && rect.height);
  }
  function visibleRect(range, leaf, glyph) {
    const rect = fragmentRect(range, glyph);
    if (!rect) return null;
    let left = Math.max(rect.left, 0), right = Math.min(rect.right, innerWidth);
    let top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight);
    if (left >= right || top >= bottom) return null;
    for (let el = leaf.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const { overflowX, overflowY, display } = getComputedStyle(el);
      if (overflowX === "visible" && overflowY === "visible" || display === "inline" || display === "contents") continue;
      if (el === document.body && getComputedStyle(document.documentElement).overflow === "visible") continue;
      const box = el.getBoundingClientRect();
      if (overflowX !== "visible") {
        const x = box.left + el.clientLeft;
        left = Math.max(left, x);
        right = Math.min(right, x + el.clientWidth);
      }
      if (overflowY !== "visible") {
        const y = box.top + el.clientTop;
        top = Math.max(top, y);
        bottom = Math.min(bottom, y + el.clientHeight);
      }
      if (left >= right || top >= bottom) return null;
    }
    return new DOMRect(left, top, right - left, bottom - top);
  }
  function makeAnchor(root, block, from, to, range, leaf, glyph) {
    if (!englishBlock(block.raw, language(root, leaf))) return null;
    const reading = extractReading(block.raw, from, to, onX ? "" : document.title);
    return reading && {
      root,
      range,
      reading,
      textAtLookup: root.textContent ?? "",
      getRect: () => visibleRect(range, leaf, glyph)
    };
  }
  function pointedWord(p) {
    const hit = document.elementFromPoint(p.x, p.y);
    const root = scopeOf(hit);
    if (!root || !hit) return null;
    const glyph = glyphAt(p, hit);
    if (!glyph || scopeOf(glyph.node.parentElement) !== root) return null;
    const block = flatten(root);
    const base = block.starts.get(glyph.node);
    if (base === void 0) return null;
    const word = wordAt(block.raw, base + glyph.index);
    if (!word) return null;
    const first = block.leaves.find((l) => l.start + l.node.length > word.start);
    const last = block.leaves.find((l) => l.start + l.node.length >= word.end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, word.start - first.start);
    range.setEnd(last.node, word.end - last.start);
    return makeAnchor(root, block, word.start, word.end, range, glyph.node, glyph.range);
  }
  function selectionAnchor(range, menuText) {
    if (range.collapsed || !range.commonAncestorContainer.isConnected) return null;
    const root = scopeOf(elementAt(range.startContainer));
    if (!root || scopeOf(elementAt(range.endContainer)) !== root) return null;
    const block = flatten(root);
    const selectedLeaves = block.leaves.filter((l) => range.intersectsNode(l.node));
    const first = selectedLeaves[0];
    const last = selectedLeaves.at(-1);
    if (!first || !last) return null;
    const from = first.start + (range.startContainer === first.node ? range.startOffset : 0);
    const to = last.start + (range.endContainer === last.node ? range.endOffset : last.node.length);
    const normalize = (s) => s.trim().replace(/\s+/gu, " ");
    if (normalize(block.raw.slice(from, to)) !== normalize(menuText)) return null;
    return fragmentRect(range) ? makeAnchor(root, block, from, to, range, first.node) : null;
  }

  // src/content/card.css
  var card_default = ':host {\r\n  all: initial;\r\n  display: flex !important;\r\n  flex-direction: column !important;\r\n  position: fixed !important;\r\n  box-sizing: border-box !important;\r\n  inset: auto;\r\n  width: clamp(240px, 140px + 18vw, 420px) !important;\r\n  min-width: 0 !important;\r\n  max-width: calc(100% - 16px) !important;\r\n  height: auto !important;\r\n  max-height: calc(100% - 16px) !important;\r\n  padding: 0 !important;\r\n  margin: 0 !important;\r\n  border: 0 !important;\r\n  background: transparent !important;\r\n  overflow: visible !important;\r\n  z-index: 2147483647 !important;\r\n  color-scheme: light dark;\r\n}\r\n:host([hidden]) { display: none !important; }\r\n:host::backdrop { background: transparent; pointer-events: none; }\r\n* { box-sizing: border-box; }\r\narticle {\r\n  --paper: #fffcf6; --ink: #292824; --sub: #67645d; --line: #e8e1d6; --accent: #316057;\r\n  font: clamp(14px, 12px + 0.3vw, 17px)/1.55 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;\r\n  color: var(--ink); background: var(--paper); border: 1px solid var(--line);\r\n  border-radius: 1em; padding: 1em;\r\n  box-shadow: 0 6px 24px rgb(45 36 22 / .13), 0 2px 5px rgb(45 36 22 / .04);\r\n  overflow-wrap: anywhere; overflow-y: auto;\r\n  min-height: 0; text-align: start; direction: ltr;\r\n  animation: enter 130ms ease-out;\r\n}\r\n@keyframes enter { from { opacity: 0; } to { opacity: 1; } }\r\n@media (prefers-reduced-motion: reduce) { article { animation: none; } }\r\n@media (prefers-color-scheme: dark) {\r\n  article { --paper: #292925; --ink: #f5f1e8; --sub: #c0bcb1; --line: #4b4b43; --accent: #acd7c2; }\r\n}\r\narticle:focus { outline: none; }\r\nh2 { font: 600 1.15em/1.32 "Segoe UI", system-ui, sans-serif; margin: 0 0 .45em; color: var(--ink); }\r\np { margin: 0; }\r\n.zh, .status, .note { font-size: .94em; color: var(--sub); }\r\n.zh { margin-top: .38em; }\r\nbutton {\r\n  appearance: none; border: 0; border-radius: 4px; background: transparent; color: var(--accent);\r\n  font: 600 .86em/1.5 "Segoe UI", system-ui, sans-serif; padding: .25em .18em; margin-top: .65em; cursor: pointer;\r\n}\r\nbutton:hover { text-decoration: underline; }\r\nbutton:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\r\n.note { margin-top: .45em; padding-top: .6em; border-top: 1px solid var(--line); }\r\n';

  // src/content/card.ts
  var messages = {
    disabled: "",
    cancelled: "",
    noKey: "请先在设置中保存 OpenAI API Key。",
    badKey: "API Key 无效或已撤销，请更新密钥。",
    forbidden: "当前 Key 没有调用权限，请检查项目和模型权限。",
    model: "模型不可用或不支持此请求，请检查模型名称与访问权限。",
    quota: "OpenAI 项目额度不足，请检查账单与预算。",
    rate: "请求过于频繁，请稍后再试。",
    network: "无法连接 OpenAI，请检查网络。",
    timeout: "等待 OpenAI 响应超时，请稍后再试。",
    refusal: "模型拒绝解释这段文字。",
    incomplete: "模型没有返回完整释义。",
    invalid: "返回的释义格式有误。",
    target: "返回的短语没有准确覆盖所选位置。",
    service: "OpenAI 服务暂时不可用。",
    settings: "无法读取扩展设置。",
    reload: "扩展已经更新，请刷新网页。"
  };
  function element(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== void 0) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  var Card = class {
    constructor(getAnchorRect, target, retry, settings) {
      this.getAnchorRect = getAnchorRect;
      this.target = target;
      this.retry = retry;
      this.settings = settings;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(card_default);
      this.shadow.adoptedStyleSheets = [sheet];
      this.host.setAttribute("popover", "manual");
      this.host.lang = "zh-CN";
      this.panel.tabIndex = -1;
      this.panel.setAttribute("role", "region");
      this.panel.setAttribute("aria-label", "Context 词义");
      this.title.textContent = target;
      this.title.lang = "en";
      this.english.lang = "en";
      this.body.setAttribute("aria-live", "polite");
      this.body.append(element("p", "正在读取语境…", "status"));
      this.panel.append(this.title, this.body);
      this.shadow.append(this.panel);
      document.documentElement.append(this.host);
      this.host.showPopover();
      this.position();
      this.panel.focus({ preventScroll: true });
      this.resize.observe(this.panel);
    }
    getAnchorRect;
    target;
    retry;
    settings;
    host = document.createElement(HOST);
    shadow = this.host.attachShadow({ mode: "open" });
    panel = element("article");
    title = element("h2");
    body = element("div");
    english = element("p");
    chinese = element("p", void 0, "zh");
    previousFocus = document.activeElement;
    resize = new ResizeObserver(() => this.position());
    frame = null;
    schedulePosition() {
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.position();
      });
    }
    position() {
      if (!this.host.isConnected) return;
      const rect = this.getAnchorRect();
      this.host.toggleAttribute("hidden", !rect);
      if (!rect) return;
      const { width, height } = this.panel.getBoundingClientRect();
      const viewport = document.compatMode === "BackCompat" ? document.body : document.documentElement;
      const { clientWidth, clientHeight } = viewport;
      const margin = 8, gap = 6;
      const x = Math.max(margin, Math.min(rect.left, clientWidth - width - margin));
      const below = rect.bottom + gap;
      const y = below + height <= clientHeight - margin ? below : Math.max(margin, rect.top - height - gap);
      this.host.style.setProperty("left", x + "px", "important");
      this.host.style.setProperty("top", Math.min(y, Math.max(margin, clientHeight - height - margin)) + "px", "important");
    }
    button(label, action) {
      const button = element("button", label);
      button.type = "button";
      button.addEventListener("click", (e) => {
        if (e.isTrusted) action();
      });
      return button;
    }
    showMeanings({ target, meaning_en, meaning_zh }) {
      if (this.title.textContent !== target) this.title.textContent = target;
      if (this.english.textContent !== meaning_en) this.english.textContent = meaning_en;
      if (!this.english.parentNode) this.body.replaceChildren(this.english);
      if (meaning_zh && this.chinese.textContent !== meaning_zh) {
        this.chinese.textContent = meaning_zh;
        this.body.append(this.chinese);
      }
    }
    show(reply) {
      if (!reply.ok) {
        this.title.textContent = this.target;
        this.body.replaceChildren(element("p", messages[reply.error], "status"));
        if (["noKey", "badKey", "forbidden", "model", "settings"].includes(reply.error)) {
          this.body.append(this.button("打开设置", this.settings));
        } else if (["timeout", "network", "rate", "service", "incomplete", "invalid", "target"].includes(reply.error)) {
          this.body.append(this.button("再试一次", this.retry));
        }
      } else {
        const ex = reply.explanation;
        if (ex.status === "unclear") {
          this.title.textContent = ex.target;
          this.body.replaceChildren(element("p", "这段上下文不足以确定含义。", "status"));
        } else {
          this.showMeanings(ex);
          if (ex.note_en) {
            const note = element("p", ex.note_en, "note");
            note.lang = "en";
            note.id = "context-note";
            note.hidden = true;
            const more = this.button("More", () => {
              note.hidden = !note.hidden;
              more.setAttribute("aria-expanded", String(!note.hidden));
              more.textContent = note.hidden ? "More" : "Less";
              this.position();
            });
            more.lang = "en";
            more.setAttribute("aria-controls", note.id);
            more.setAttribute("aria-expanded", "false");
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
      if (restore) this.previousFocus.focus({ preventScroll: true });
    }
  };

  // src/content/gesture.ts
  var TAP_MS = 500;
  var CtrlTap = class {
    pressedAt = null;
    held = /* @__PURE__ */ new Set();
    down(event, time) {
      this.pressedAt = !event.repeat && event.code === "ControlLeft" && !this.held.size && !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing ? time : null;
      this.held.add(event.code);
    }
    up(code, time) {
      const tap2 = code === "ControlLeft" && this.pressedAt !== null && time - this.pressedAt <= TAP_MS;
      this.cancel();
      this.held.delete(code);
      return tap2;
    }
    cancel() {
      this.pressedAt = null;
    }
    reset() {
      this.cancel();
      this.held.clear();
    }
  };

  // src/content/main.ts
  var tap = new CtrlTap();
  var capture = { capture: true, passive: true };
  var point = null;
  var buttons = 0;
  var enabled = false;
  var stateVersion = 0;
  var menuRange = null;
  var current = null;
  async function send(message) {
    return chrome.runtime.sendMessage(message);
  }
  function closeCard() {
    if (!current) return;
    const { id, card, observer } = current;
    current = null;
    observer.disconnect();
    card.remove();
    void send({ type: "cancel", id }).catch(() => void 0);
  }
  function reset() {
    closeCard();
    tap.reset();
    menuRange = null;
    point = null;
    buttons = 0;
  }
  async function refresh() {
    const version = ++stateVersion;
    enabled = false;
    closeCard();
    const state = await send({ type: "state" }).catch(() => false);
    if (version === stateVersion) enabled = state === true;
  }
  function lookup(anchor) {
    if (!enabled || !anchor.root.isConnected || anchor.range.collapsed) return;
    closeCard();
    const id = cryptoId();
    const page = location.href;
    const card = new Card(anchor.getRect, anchor.reading.selected, () => lookup(anchor), () => {
      void send({ type: "options" }).catch(() => void 0);
    });
    const observer = new MutationObserver((records) => {
      if (location.href !== page || !anchor.root.isConnected || anchor.range.collapsed || !anchor.root.contains(anchor.range.startContainer) || records.some((record) => anchor.root.contains(record.target)) && anchor.root.textContent !== anchor.textAtLookup) closeCard();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    current = { id, card, observer, pending: true };
    void send({ type: "lookup", id, reading: anchor.reading }).catch(() => ({ ok: false, error: "reload" })).then((reply) => {
      if (current?.id !== id) return;
      current.pending = false;
      if (!reply || !reply.ok && ["disabled", "cancelled"].includes(reply.error)) {
        closeCard();
        return;
      }
      card.show(reply);
    });
  }
  function cryptoId() {
    return Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
  }
  function editing(e) {
    const target = e.composedPath().find((v) => v instanceof Element);
    if (target && current?.card.host.contains(document.activeElement) && e.composedPath().includes(current.card.host)) return false;
    return document.designMode === "on" || skip(target instanceof Element ? target : null) || skip(document.activeElement);
  }
  window.addEventListener("pointermove", (e) => {
    if (!e.isTrusted || e.pointerType !== "mouse") return;
    point = { x: e.clientX, y: e.clientY };
    buttons = e.buttons;
  }, capture);
  window.addEventListener("pointerout", (e) => {
    if (!e.relatedTarget) {
      point = null;
      tap.cancel();
    }
  }, capture);
  window.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted) return;
    tap.cancel();
    buttons = e.buttons;
    menuRange = null;
    if (current && !e.composedPath().includes(current.card.host)) closeCard();
  }, capture);
  window.addEventListener("pointerup", (e) => {
    buttons = e.buttons;
    tap.cancel();
  }, capture);
  window.addEventListener("pointercancel", () => {
    buttons = 0;
    tap.cancel();
  }, capture);
  window.addEventListener("wheel", () => tap.cancel(), capture);
  window.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    tap.down(e, performance.now());
    if (e.code === "ControlLeft" && (!enabled || buttons || editing(e))) tap.cancel();
    if (e.key === "Escape") closeCard();
  }, capture);
  window.addEventListener("keyup", (e) => {
    if (!e.isTrusted || !tap.up(e.code, performance.now()) || !enabled || !point || buttons || editing(e)) return;
    const anchor = pointedWord(point);
    if (anchor) lookup(anchor);
  }, capture);
  window.addEventListener("contextmenu", (e) => {
    menuRange = null;
    if (!e.isTrusted || !enabled || editing(e)) return;
    const selection = getSelection();
    if (selection?.rangeCount === 1 && !selection.isCollapsed) menuRange = selection.getRangeAt(0).cloneRange();
  }, capture);
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg?.type === "site") {
      respond(location.hostname);
      return;
    }
    if (msg?.type === "refresh") {
      void refresh();
      return;
    }
    if (msg?.type === "preview" && current?.pending && current.id === msg.id) {
      current.card.showMeanings(msg.explanation);
      return;
    }
    if (msg?.type === "selection" && enabled && menuRange && document.designMode !== "on") {
      const range = menuRange;
      menuRange = null;
      const anchor = selectionAnchor(range, msg.text);
      if (anchor) lookup(anchor);
    }
  });
  window.addEventListener("scroll", (e) => {
    if (current && !e.composedPath().includes(current.card.host)) current.card.schedulePosition();
    tap.cancel();
  }, capture);
  window.addEventListener("blur", () => {
    tap.reset();
    buttons = 0;
  });
  window.addEventListener("pagehide", reset);
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) void refresh();
  });
  window.addEventListener("resize", () => current?.card.schedulePosition());
  window.addEventListener("hashchange", reset);
  window.addEventListener("popstate", reset);
  window.navigation?.addEventListener("currententrychange", reset);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });
  void refresh();
})();
