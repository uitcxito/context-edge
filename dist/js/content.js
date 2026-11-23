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
      const rect = [...range.getClientRects()].find((r) => includes(r, p));
      if (rect) return { node, index, rect };
    }
    return null;
  }
  function language(root, leaf) {
    const mark = leaf.parentElement?.closest("[lang]");
    if (onX && mark && !root.contains(mark)) return "";
    return mark?.getAttribute("lang") ?? "";
  }
  function makeAnchor(root, block, from, to, range, rect, leaf) {
    if (!englishBlock(block.raw, language(root, leaf))) return null;
    const reading = extractReading(block.raw, from, to, onX ? "" : document.title);
    return reading && { root, range, rect, reading, textAtLookup: root.textContent ?? "" };
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
    const rect = [...range.getClientRects()].find((r) => includes(r, p)) ?? glyph.rect;
    return makeAnchor(root, block, word.start, word.end, range, rect, glyph.node);
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
    const rect = [...range.getClientRects()].find((r) => r.width && r.height);
    return rect ? makeAnchor(root, block, from, to, range, rect, first.node) : null;
  }

  // src/content/card.css
  var card_default = ':host {\n  all: initial;\n  display: block !important;\n  position: fixed !important;\n  box-sizing: border-box !important;\n  inset: auto;\n  width: min(320px, calc(100vw - 16px)) !important;\n  min-width: 0 !important;\n  max-width: none !important;\n  height: auto !important;\n  padding: 0 !important;\n  margin: 0 !important;\n  border: 0 !important;\n  background: transparent !important;\n  overflow: visible !important;\n  z-index: 2147483647 !important;\n  color-scheme: light dark;\n}\n:host::backdrop { background: transparent; pointer-events: none; }\n* { box-sizing: border-box; }\narticle {\n  --paper: #fffcf6; --ink: #292824; --sub: #67645d; --line: #e8e1d6; --accent: #316057;\n  font: 14px/1.55 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;\n  color: var(--ink); background: var(--paper); border: 1px solid var(--line);\n  border-radius: 15px; padding: 15px;\n  box-shadow: 0 6px 24px rgb(45 36 22 / .13), 0 2px 5px rgb(45 36 22 / .04);\n  overflow-wrap: anywhere; overflow-y: auto; overscroll-behavior: contain;\n  max-height: calc(100dvh - 16px); text-align: start; direction: ltr;\n  animation: enter 130ms ease-out;\n}\n@keyframes enter { from { opacity: 0; } to { opacity: 1; } }\n@media (prefers-reduced-motion: reduce) { article { animation: none; } }\n@media (prefers-color-scheme: dark) {\n  article { --paper: #292925; --ink: #f5f1e8; --sub: #c0bcb1; --line: #4b4b43; --accent: #acd7c2; }\n}\narticle:focus { outline: none; }\nh2 { font: 600 16px/1.32 "Segoe UI", system-ui, sans-serif; margin: 0 0 7px; color: var(--ink); }\np { margin: 0; }\n.zh, .status, .note { font-size: 13px; color: var(--sub); }\n.zh { margin-top: 5px; }\nbutton {\n  appearance: none; border: 0; border-radius: 4px; background: transparent; color: var(--accent);\n  font: 600 12px/1.5 "Segoe UI", system-ui, sans-serif; padding: 3px 2px; margin-top: 8px; cursor: pointer;\n}\nbutton:hover { text-decoration: underline; }\nbutton:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\n.note { margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--line); }\n';

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
    constructor(rect, target, retry, settings) {
      this.rect = rect;
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
    rect;
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
    position() {
      if (!this.host.isConnected) return;
      const { width, height } = this.panel.getBoundingClientRect();
      const margin = 8, gap = 6;
      const x = Math.max(margin, Math.min(this.rect.left, innerWidth - width - margin));
      const below = this.rect.bottom + gap;
      const y = below + height <= innerHeight - margin ? below : Math.max(margin, this.rect.top - height - gap);
      this.host.style.setProperty("left", x + "px", "important");
      this.host.style.setProperty("top", Math.min(y, Math.max(margin, innerHeight - height - margin)) + "px", "important");
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
    const card = new Card(anchor.rect, anchor.reading.selected, () => lookup(anchor), () => {
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
    if (current && !e.composedPath().includes(current.card.host)) closeCard();
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
  window.addEventListener("resize", closeCard);
  window.addEventListener("hashchange", reset);
  window.addEventListener("popstate", reset);
  window.navigation?.addEventListener("currententrychange", reset);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });
  void refresh();
})();
