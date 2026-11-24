"use strict";
(() => {
  // src/shared.ts
  var DEFAULT_MODEL = "gpt-6-luna";
  var CONTEXT_LIMIT = 1200;
  var TARGET_LIMIT = 260;
  var TITLE_LIMIT = 100;
  function readingPreferences(values) {
    const theme = values.underlineTheme;
    return { doubleClickPreload: values.doubleClickPreload !== false, underlineTheme: theme === "blue" || theme === "clay" ? theme : "auto" };
  }
  function englishSelection(text) {
    return new RegExp("\\p{Script=Latin}", "u").test(text) && !new RegExp("\\p{L}", "u").test(text.replace(new RegExp("\\p{Script=Latin}", "gu"), ""));
  }
  function validModel(model2) {
    return /^[\w][\w.:-]{0,127}$/.test(model2);
  }

  // src/storage.ts
  var protectedStore;
  function localStore() {
    protectedStore ??= chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).then(() => chrome.storage.local).catch((error) => {
      protectedStore = void 0;
      throw error;
    });
    return protectedStore;
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
  function clippingBounds(element2) {
    let left = 0, right = innerWidth, top = 0, bottom = innerHeight;
    for (let el = element2; el && el !== document.documentElement; el = el.parentElement) {
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
    }
    return { left, right, top, bottom };
  }
  function visibleRect(range, leaf, glyph) {
    const rect = fragmentRect(range, glyph);
    if (!rect || !leaf.parentElement) return null;
    const clip = clippingBounds(leaf.parentElement);
    const left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right);
    const top = Math.max(rect.top, clip.top), bottom = Math.min(rect.bottom, clip.bottom);
    if (left >= right || top >= bottom) return null;
    return new DOMRect(left, top, right - left, bottom - top);
  }
  function makeAnchor(root, block, from, to, glyph) {
    const span = block.raw.slice(from, to);
    from += span.length - span.trimStart().length;
    to -= span.length - span.trimEnd().length;
    const runs = [];
    for (const { node, start } of block.leaves) {
      const begin = Math.max(0, from - start), end = Math.min(node.length, to - start);
      if (begin >= end) continue;
      const run = new Range();
      run.setStart(node, begin);
      run.setEnd(node, end);
      runs.push(run);
    }
    const first = runs[0], last = runs.at(-1);
    if (!first || !last) return null;
    const leaf = (glyph ?? first).startContainer;
    if (!englishBlock(block.raw, language(root, leaf))) return null;
    const reading = extractReading(block.raw, from, to, onX ? "" : document.title);
    const range = first.cloneRange();
    range.setEnd(last.endContainer, last.endOffset);
    return reading && {
      root,
      range,
      runs,
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
    return makeAnchor(root, block, word.start, word.end, glyph.range);
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
    return fragmentRect(range) ? makeAnchor(root, block, from, to) : null;
  }

  // src/content/pronunciation.ts
  var unavailable = "暂时无法播放发音，请重试。";
  var isEnglish = (voice) => /^en(?:[-_]|$)/i.test(voice.lang);
  async function availableVoices(synth) {
    const ready = (list) => list.some(isEnglish) && list.some((voice) => voice.localService);
    const voices = synth.getVoices();
    if (ready(voices)) return voices;
    await new Promise((resolve) => {
      function finish() {
        clearTimeout(timer);
        synth.removeEventListener("voiceschanged", changed);
        resolve();
      }
      function changed() {
        if (ready(synth.getVoices())) finish();
      }
      const timer = window.setTimeout(finish, 500);
      synth.addEventListener("voiceschanged", changed);
    });
    return synth.getVoices();
  }
  function speakerIcon() {
    const ns2 = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(ns2, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns2, "path");
    path.setAttribute("d", "M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14");
    icon.append(path);
    return icon;
  }
  var PronunciationButton = class {
    button = document.createElement("button");
    message = document.createElement("p");
    target = "";
    active = null;
    constructor() {
      this.button.type = "button";
      this.button.className = "pronounce";
      this.button.append(speakerIcon());
      this.button.addEventListener("click", (event) => {
        if (event.isTrusted) void this.play();
      });
      this.message.className = "speech-message status";
      this.message.setAttribute("role", "status");
    }
    setTarget(target) {
      if (this.target === target) return;
      this.target = target;
      this.button.title = "朗读 " + target;
      this.button.setAttribute("aria-label", this.button.title);
      this.message.textContent = "";
      this.updateButton();
    }
    updateButton() {
      this.button.setAttribute("aria-disabled", String(this.active?.text === this.target));
    }
    async play() {
      const target = this.target;
      if (this.active?.text === target) return;
      this.message.textContent = "";
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance !== "function") {
        this.message.textContent = "此浏览器未提供语音播放功能。";
        return;
      }
      const utterance = new SpeechSynthesisUtterance(target);
      this.active = utterance;
      this.updateButton();
      const finish = (message = "") => {
        if (this.active !== utterance) return;
        this.active = null;
        this.updateButton();
        if (this.target === target) this.message.textContent = message;
      };
      try {
        const voices = await availableVoices(synth);
        if (this.active !== utterance) return;
        const english = voices.filter(isEnglish);
        const american = english.filter((voice2) => /[-_]US(?:[-_]|$)/i.test(voice2.lang));
        const voice = american.find((voice2) => voice2.localService) ?? english.find((voice2) => voice2.localService) ?? american[0] ?? english[0];
        if (voices.length && !voice) {
          finish("未找到英语语音，请在系统设置中添加。");
          return;
        }
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang.replaceAll("_", "-") ?? "en-US";
        utterance.onend = () => finish();
        utterance.onerror = () => finish(unavailable);
        synth.speak(utterance);
      } catch {
        finish(unavailable);
      }
    }
    dispose() {
      if (this.active) {
        this.active.onend = null;
        this.active.onerror = null;
        this.active = null;
      }
    }
  };

  // src/content/card.css
  var card_default = ':host {\r\n  all: initial;\r\n  display: flex !important;\r\n  flex-direction: column !important;\r\n  position: fixed !important;\r\n  box-sizing: border-box !important;\r\n  inset: auto;\r\n  width: calc(420px * var(--context-card-scale)) !important;\r\n  min-width: 0 !important;\r\n  max-width: calc(100% - 16px) !important;\r\n  height: auto !important;\r\n  max-height: calc(100% - 16px) !important;\r\n  padding: 0 !important;\r\n  margin: 0 !important;\r\n  border: 0 !important;\r\n  background: transparent !important;\r\n  overflow: visible !important;\r\n  z-index: 2147483647 !important;\r\n  color-scheme: light dark;\r\n}\r\n:host([hidden]) { display: none !important; }\r\n:host::backdrop { background: transparent; pointer-events: none; }\r\n* { box-sizing: border-box; }\r\narticle {\r\n  --paper: #fffcf6; --ink: #292824; --sub: #67645d; --line: #e8e1d6; --accent: #316057;\r\n  font: calc(17px * var(--context-card-scale))/1.55 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;\r\n  color: var(--ink); background: var(--paper); border: 1px solid var(--line);\r\n  border-radius: 1em; padding: 1em;\r\n  box-shadow: 0 6px 24px rgb(45 36 22 / .13), 0 2px 5px rgb(45 36 22 / .04);\r\n  overflow-wrap: anywhere; overflow-y: auto; scrollbar-gutter: stable;\r\n  min-height: 0; text-align: start; direction: ltr;\r\n  animation: enter 130ms ease-out;\r\n}\r\n@keyframes enter { from { opacity: 0; } to { opacity: 1; } }\r\n@media (prefers-reduced-motion: reduce) { article { animation: none; } }\r\n@media (prefers-color-scheme: dark) {\r\n  article { --paper: #292925; --ink: #f5f1e8; --sub: #c0bcb1; --line: #4b4b43; --accent: #acd7c2; }\r\n}\r\narticle:focus { outline: none; }\r\n.heading { display: flex; align-items: center; gap: .35em; margin-bottom: .45em; }\r\nh2 { font: 600 1.15em/1.32 "Segoe UI", system-ui, sans-serif; min-width: 0; margin: 0; color: var(--ink); }\r\np { margin: 0; }\r\n.zh, .status, .note { font-size: .94em; color: var(--sub); }\r\n.zh { margin-top: .38em; }\r\nbutton {\r\n  appearance: none; border: 0; border-radius: 4px; background: transparent; color: var(--accent);\r\n  font: 600 .86em/1.5 "Segoe UI", system-ui, sans-serif; padding: .25em .18em; margin-top: .65em; cursor: pointer;\r\n}\r\nbutton:hover { text-decoration: underline; }\r\nbutton:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\r\n.pronounce {\r\n  flex: none; display: grid; place-items: center; width: 1.85em; height: 1.85em;\r\n  font-size: 1em; margin: 0; padding: 0; border-radius: 50%;\r\n}\r\n.pronounce:hover, .pronounce[aria-disabled="true"] { background: var(--line); }\r\n.pronounce[aria-disabled="true"] { cursor: default; }\r\n.pronounce svg {\r\n  width: 1.2em; height: 1.2em; fill: none; stroke: currentColor;\r\n  stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;\r\n}\r\n@media (pointer: coarse) {\r\n  .pronounce {\r\n    min-width: calc(44px * var(--context-card-scale));\r\n    min-height: calc(44px * var(--context-card-scale));\r\n  }\r\n}\r\n.speech-message:empty { display: none; }\r\n.speech-message { margin-bottom: .4em; }\r\n.note { margin-top: .45em; padding-top: .6em; border-top: 1px solid var(--line); }\r\n';

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
    constructor(getAnchorRect, target, pageZoom, retry, settings) {
      this.getAnchorRect = getAnchorRect;
      this.target = target;
      this.retry = retry;
      this.settings = settings;
      const sheet2 = new CSSStyleSheet();
      sheet2.replaceSync(card_default);
      this.shadow.adoptedStyleSheets = [sheet2];
      this.setPageZoom(pageZoom);
      this.host.setAttribute("popover", "manual");
      this.host.lang = "zh-CN";
      this.panel.tabIndex = -1;
      this.panel.setAttribute("role", "region");
      this.panel.setAttribute("aria-label", "Context 词义");
      this.setTitle(target);
      this.title.lang = "en";
      this.english.lang = "en";
      this.body.setAttribute("aria-live", "polite");
      this.body.append(element("p", "正在读取语境…", "status"));
      const heading = element("div", void 0, "heading");
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
    getAnchorRect;
    target;
    retry;
    settings;
    host = document.createElement(HOST);
    shadow = this.host.attachShadow({ mode: "open" });
    panel = element("article");
    title = element("h2");
    pronunciation = new PronunciationButton();
    body = element("div");
    english = element("p");
    chinese = element("p", void 0, "zh");
    previousFocus = document.activeElement;
    resize = new ResizeObserver(() => this.schedulePosition());
    frame = null;
    setPageZoom(pageZoom) {
      const visualZoom = Math.min(1.2, 1 + (pageZoom - 1) * 0.4);
      const scale = pageZoom > 1 ? visualZoom / pageZoom : 1;
      this.host.style.setProperty("--context-card-scale", String(scale), "important");
      this.schedulePosition();
    }
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
      const panel = this.panel.getBoundingClientRect();
      const viewport = document.compatMode === "BackCompat" ? document.body : document.documentElement;
      const { clientWidth, clientHeight } = viewport;
      const margin = 8, gap = 6;
      const x = Math.max(margin, Math.min(rect.left, clientWidth - panel.width - margin));
      const bottomInset = Math.max(margin, clientHeight - rect.top + gap);
      const topInset = Math.max(margin, rect.bottom + gap);
      const spaceAbove = clientHeight - bottomInset - margin;
      const spaceBelow = clientHeight - topInset - margin;
      const bodyStart = this.body.getBoundingClientRect().top - panel.top + this.panel.scrollTop;
      const style = getComputedStyle(this.panel);
      const lineHeight = parseFloat(style.lineHeight);
      const bottomPadding = parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
      const readableHeight = bodyStart + 2 * lineHeight + bottomPadding;
      const above = spaceAbove >= readableHeight || spaceAbove >= spaceBelow;
      const oneLine = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + Math.floor(lineHeight) + bottomPadding;
      const inset = Math.min(above ? bottomInset : topInset, Math.max(margin, clientHeight - margin - oneLine));
      this.panel.style.maxHeight = Math.max(0, clientHeight - inset - margin) + "px";
      this.host.style.setProperty("left", x + "px", "important");
      this.host.style.setProperty("top", above ? "auto" : inset + "px", "important");
      this.host.style.setProperty("bottom", above ? inset + "px" : "auto", "important");
    }
    button(label, action) {
      const button = element("button", label);
      button.type = "button";
      button.addEventListener("click", (e) => {
        if (e.isTrusted) action();
      });
      return button;
    }
    setTitle(target) {
      if (this.title.textContent !== target) this.title.textContent = target;
      this.pronunciation.setTarget(target);
    }
    showMeanings({ target, meaning_en, meaning_zh }) {
      this.setTitle(target);
      if (this.english.textContent !== meaning_en) this.english.textContent = meaning_en;
      if (!this.english.parentNode) this.body.replaceChildren(this.english);
      if (meaning_zh && this.chinese.textContent !== meaning_zh) {
        this.chinese.textContent = meaning_zh;
        this.body.append(this.chinese);
      }
    }
    show(reply) {
      if (!reply.ok) {
        this.setTitle(this.target);
        this.body.replaceChildren(element("p", messages[reply.error], "status"));
        if (["noKey", "badKey", "forbidden", "model", "settings"].includes(reply.error)) {
          this.body.append(this.button("打开设置", this.settings));
        } else if (["timeout", "network", "rate", "service", "incomplete", "invalid", "target"].includes(reply.error)) {
          this.body.append(this.button("再试一次", this.retry));
        }
      } else {
        const ex = reply.explanation;
        if (ex.status === "unclear") {
          this.setTitle(ex.target);
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
      this.pronunciation.dispose();
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
      const tap = code === "ControlLeft" && this.pressedAt !== null && time - this.pressedAt <= TAP_MS;
      this.cancel();
      this.held.delete(code);
      return tap;
    }
    cancel() {
      this.pressedAt = null;
    }
    reset() {
      this.cancel();
      this.held.clear();
    }
  };

  // src/content/underline.ts
  var ns = "http://www.w3.org/2000/svg";
  var blue = "#6F93B8";
  var lightBlue = "#8CB0D4";
  var clay = "#C98B5E";
  var motion = matchMedia("(prefers-reduced-motion: reduce)");
  var scheme = matchMedia("(prefers-color-scheme: dark)");
  var nextFilter = 0;
  var sheet;
  var canvas = null;
  function darkBehind(element2) {
    let red = 0, green = 0, blueChannel = 0, remaining = 1;
    for (let el = element2; el && remaining > 5e-3; el = el.parentElement) {
      const style = getComputedStyle(el);
      const color = style.backgroundColor;
      if (style.backgroundImage !== "none") {
        const ink = style.color.match(/[\d.]+/g)?.map(Number);
        if (ink && ink.length >= 3) {
          const backdrop = 0.2126 * ink[0] + 0.7152 * ink[1] + 0.0722 * ink[2] > 150 ? 0 : 255;
          red += backdrop * remaining;
          green += backdrop * remaining;
          blueChannel += backdrop * remaining;
          remaining = 0;
          break;
        }
      }
      if (color === "rgba(0, 0, 0, 0)" || color === "transparent") continue;
      let channels;
      if (color.startsWith("rgb")) channels = color.match(/[\d.]+/g).map(Number);
      else {
        canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        if (!canvas) continue;
        canvas.clearRect(0, 0, 1, 1);
        canvas.fillStyle = color;
        canvas.fillRect(0, 0, 1, 1);
        channels = Array.from(canvas.getImageData(0, 0, 1, 1).data);
        channels[3] = channels[3] / 255;
      }
      const alpha = channels[3] ?? 1;
      red += channels[0] * alpha * remaining;
      green += channels[1] * alpha * remaining;
      blueChannel += channels[2] * alpha * remaining;
      remaining *= 1 - alpha;
    }
    const modes = getComputedStyle(document.documentElement).colorScheme;
    const darkCanvas = modes.includes("dark") && (!modes.includes("light") || scheme.matches);
    const base = darkCanvas ? 0 : 255;
    return 0.2126 * red + 0.7152 * green + 0.0722 * blueChannel + base * remaining < 128;
  }
  function svg(name, attrs = {}) {
    const node = document.createElementNS(ns, name);
    for (const [key2, value] of Object.entries(attrs)) node.setAttribute(key2, String(value));
    return node;
  }
  function createStroke(animate) {
    const id = "grain-" + ++nextFilter;
    const image = svg("svg", { "aria-hidden": "true" });
    const defs = svg("defs");
    const filter = svg("filter", { id, filterUnits: "userSpaceOnUse", x: -10, y: -10, height: 45 });
    filter.append(
      svg("feTurbulence", { type: "fractalNoise", baseFrequency: "0.04 0.5", numOctaves: 2, seed: 4, result: "edge" }),
      svg("feDisplacementMap", { in: "SourceGraphic", in2: "edge", scale: 1.4, result: "stroke" }),
      svg("feTurbulence", { type: "fractalNoise", baseFrequency: 1.1, numOctaves: 2, seed: 9, result: "grain" }),
      svg("feColorMatrix", { in: "grain", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.4 0 0 0 -1.3", result: "holes" }),
      svg("feComposite", { in: "stroke", in2: "holes", operator: "in" })
    );
    defs.append(filter);
    const group = svg("g", { filter: "url(#" + id + ")" });
    const path = svg("path", { fill: "none", "stroke-linecap": "round", pathLength: 1 });
    if (animate) path.classList.add("draw");
    group.append(path);
    image.append(defs, group);
    return { image, path, filter };
  }
  function measure(anchor, theme) {
    const lines = [];
    for (const run of anchor.runs) {
      const el = run.startContainer.parentElement;
      const rects = [...run.getClientRects()].filter((r) => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight);
      if (!el || !rects.length) continue;
      const style = getComputedStyle(el);
      if (style.visibility !== "visible") continue;
      let box = el;
      while (box && getComputedStyle(box).display === "contents") box = box.parentElement;
      if (!box?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
      const clip = clippingBounds(el);
      const size = parseFloat(style.fontSize) || 16;
      const dark = theme !== "clay" && darkBehind(el);
      const color = theme === "clay" || theme === "auto" && dark ? clay : dark ? lightBlue : blue;
      for (const rect of rects) {
        const left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right);
        const top = Math.max(rect.top, clip.top);
        if (right <= left || Math.min(rect.bottom, clip.bottom) <= top) continue;
        const prev = lines.at(-1);
        const overlap = prev ? Math.min(prev.bottom, rect.bottom) - Math.max(prev.top, top) : 0;
        if (prev && overlap > Math.min(prev.bottom - prev.top, rect.height) * 0.6 && Math.abs(prev.right - left) < 1 && prev.color === color && prev.clipBottom === clip.bottom) {
          prev.right = right;
          prev.top = Math.min(prev.top, top);
          prev.bottom = Math.max(prev.bottom, rect.bottom);
          prev.size = Math.max(prev.size, size);
        } else lines.push({ left, right, top, bottom: rect.bottom, clipBottom: clip.bottom, size, color });
      }
    }
    return lines;
  }
  var CrayonUnderline = class {
    constructor(anchor, theme) {
      this.anchor = anchor;
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
      const shadow = this.host.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [sheet];
      this.host.setAttribute("aria-hidden", "true");
      shadow.append(this.layer);
      document.documentElement.append(this.host);
      this.position(theme, true);
    }
    anchor;
    host = document.createElement("context-reading-underline");
    layer = document.createElement("div");
    strokes = [];
    hits = [];
    position(theme, animate = false) {
      this.hits = [];
      let index = 0;
      for (const line of measure(this.anchor, theme)) {
        const sw = Math.min(5, Math.max(2.5, line.size * 0.19));
        const width = line.right - line.left, top = line.bottom + line.size * 0.04;
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
        stroke.image.style.left = line.left + "px";
        stroke.image.style.top = top + "px";
        stroke.image.setAttribute("width", String(width));
        stroke.image.setAttribute("height", String(height));
        stroke.filter.setAttribute("width", String(width + 20));
        stroke.path.setAttribute("d", "M" + inset + "," + sw + " L" + (width - inset) + "," + (sw + 0.8));
        stroke.path.setAttribute("stroke", line.color);
        stroke.path.setAttribute("stroke-width", String(sw));
      }
      for (const stroke of this.strokes.splice(index)) stroke.image.remove();
    }
    hit(x, y) {
      return this.hits.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
    }
    remove(fade = false) {
      if (!fade || motion.matches) {
        this.host.remove();
        return;
      }
      const animation = this.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
      animation.finished.then(() => this.host.remove(), () => this.host.remove());
    }
  };

  // src/content/reader.ts
  var capture = { capture: true, passive: true };
  var interactive = 'a[href],area[href],[role="link"],summary,audio,video';
  function plainClick(event) {
    return event.isTrusted && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  }
  function sameRange(a, b) {
    return a.startContainer === b.startContainer && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
  }
  function requestId() {
    return Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
  }
  var ReadingSession = class {
    constructor(service, scope) {
      this.service = service;
      this.scope = scope;
      this.bindGestures();
      window.addEventListener("scroll", (e) => {
        if (!this.insideCard(e)) this.schedule();
      }, capture);
      window.addEventListener("resize", () => this.schedule());
      document.fonts.addEventListener("loadingdone", () => this.schedule());
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.schedule());
      const articleUrl = () => {
        const url = new URL(location.href);
        if (!/^#[!/]/.test(url.hash)) url.hash = "";
        return url.href;
      };
      let article = articleUrl();
      const navigate = () => {
        const next = articleUrl();
        if (next !== article) this.clear();
        article = next;
      };
      window.addEventListener("pagehide", () => this.clear());
      window.addEventListener("hashchange", navigate);
      window.addEventListener("popstate", navigate);
      window.navigation?.addEventListener("currententrychange", navigate);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this.closeCard();
          this.tap.reset();
          this.menuRange = null;
          this.point = null;
          this.buttons = 0;
        } else this.schedule();
      });
    }
    service;
    scope;
    enabled = false;
    prefs = readingPreferences({});
    zoom = 1;
    marks = /* @__PURE__ */ new Map();
    opened;
    frame;
    resize = new ResizeObserver(() => this.schedule());
    observer = new MutationObserver((records) => {
      if (records.every((r) => r.target instanceof Element && r.target.matches(HOST + ",context-reading-underline"))) return;
      for (const mark of this.marks.values()) {
        const { root, range, textAtLookup } = mark.anchor;
        if (!root.isConnected || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer) || records.some((r) => r.type !== "attributes" && root.contains(r.target)) && root.textContent !== textAtLookup) this.discard(mark);
      }
      this.schedule();
    });
    menuRange = null;
    setPreferences(prefs2) {
      this.prefs = prefs2;
      if (!prefs2.doubleClickPreload) {
        for (const mark of this.marks.values()) if (mark.persistent) this.discard(mark);
      }
      this.schedule();
    }
    setZoom(factor) {
      this.zoom = factor;
      this.opened?.card.setPageZoom(factor);
      this.tap.cancel();
      this.schedule();
    }
    preview(id, result) {
      const mark = this.marks.get(id);
      if (!mark || mark.reply) return;
      mark.preview = result;
      if (this.opened?.mark === mark) this.opened.card.showMeanings(result);
    }
    explainSelection(text) {
      const range = this.menuRange;
      this.menuRange = null;
      if (!this.enabled || !range || document.designMode === "on") return;
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
    schedule() {
      if (this.frame !== void 0 || !this.marks.size) return;
      this.opened?.card.schedulePosition();
      this.frame = requestAnimationFrame(() => {
        this.frame = void 0;
        for (const mark of this.marks.values()) mark.line.position(this.prefs.underlineTheme);
      });
    }
    discard(mark, fade = false) {
      if (this.opened?.mark === mark) {
        this.opened.card.remove();
        this.opened = void 0;
      }
      this.marks.delete(mark.id);
      mark.line.remove(fade);
      if (!mark.reply) this.service.cancel(mark.id);
      if (![...this.marks.values()].some((m) => m.anchor.root === mark.anchor.root)) this.resize.unobserve(mark.anchor.root);
      if (!this.marks.size) {
        this.observer.disconnect();
        this.resize.disconnect();
      }
    }
    closeCard() {
      const open = this.opened;
      if (!open) return;
      this.opened = void 0;
      open.card.remove();
      if (!open.mark.persistent) this.discard(open.mark, true);
    }
    open(mark) {
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
    lookup(anchor, preload) {
      if (!this.enabled || !anchor.root.isConnected || anchor.range.collapsed || this.scope && !this.scope.contains(anchor.root)) return;
      const match = [...this.marks.values()].find((m) => sameRange(m.anchor.range, anchor.range));
      if (match) {
        if (preload) match.persistent = true;
        else this.open(match);
        return match;
      }
      if (!preload) this.closeCard();
      const mark = { id: requestId(), anchor, persistent: preload, line: new CrayonUnderline(anchor, this.prefs.underlineTheme) };
      if (!this.marks.size) {
        this.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
        this.resize.observe(document.documentElement);
      }
      this.resize.observe(anchor.root);
      this.marks.set(mark.id, mark);
      if (!preload) this.open(mark);
      void this.service.lookup(mark.id, anchor.reading, preload).catch(() => ({ ok: false, error: "reload" })).then((reply) => {
        if (this.marks.get(mark.id) !== mark) return;
        if (!reply || !reply.ok && (reply.error === "disabled" || reply.error === "cancelled")) {
          this.discard(mark);
          return;
        }
        mark.reply = reply;
        mark.preview = void 0;
        if (this.opened?.mark === mark) this.opened.card.show(reply);
      });
      return mark;
    }
    insideCard(event) {
      return Boolean(this.opened && event.composedPath().includes(this.opened.card.host));
    }
    editing(event) {
      if (this.insideCard(event)) return false;
      if (this.scope && event instanceof KeyboardEvent && this.point && document.activeElement?.matches("input[type=radio],input[type=checkbox]") && this.scope.contains(document.elementFromPoint(this.point.x, this.point.y))) return false;
      const target = event.composedPath().find((v) => v instanceof Element);
      return document.designMode === "on" || skip(target instanceof Element ? target : null) || skip(document.activeElement);
    }
    tap = new CtrlTap();
    point = null;
    buttons = 0;
    bindGestures() {
      let press;
      window.addEventListener("pointermove", (e) => {
        if (!e.isTrusted || e.pointerType !== "mouse") return;
        this.point = { x: e.clientX, y: e.clientY };
        this.buttons = e.buttons;
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press = void 0;
      }, capture);
      window.addEventListener("pointerout", (e) => {
        if (!e.relatedTarget) {
          this.point = null;
          this.tap.cancel();
        }
      }, capture);
      window.addEventListener("pointerdown", (e) => {
        if (!e.isTrusted) return;
        press = void 0;
        this.tap.cancel();
        this.buttons = e.buttons;
        this.menuRange = null;
        if (this.insideCard(e)) return;
        this.closeCard();
        if (!plainClick(e) || !this.enabled || !this.prefs.doubleClickPreload || !(e.target instanceof Element) || skip(e.target) || e.target.closest(interactive)) return;
        const target = e.target;
        const mark = [...this.marks.values()].find((m) => m.persistent && (m.anchor.root.contains(target) || target.contains(m.anchor.root)) && m.line.hit(e.clientX, e.clientY));
        if (mark) press = { mark, x: e.clientX, y: e.clientY };
      }, capture);
      window.addEventListener("pointerup", (e) => {
        this.buttons = e.buttons;
        this.tap.cancel();
      }, capture);
      window.addEventListener("pointercancel", () => {
        press = void 0;
        this.buttons = 0;
        this.tap.cancel();
      }, capture);
      window.addEventListener("click", (e) => {
        const clicked = press;
        press = void 0;
        if (clicked && plainClick(e) && e.detail !== 2 && !this.editing(e) && this.marks.has(clicked.mark.id) && clicked.mark.line.hit(e.clientX, e.clientY)) this.open(clicked.mark);
      }, capture);
      window.addEventListener("dblclick", (e) => {
        if (!plainClick(e) || !this.enabled || !this.prefs.doubleClickPreload || this.insideCard(e) || this.editing(e) || !(e.target instanceof Element) || e.target.closest(interactive)) return;
        const selection = getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) return;
        const anchor = pointedWord({ x: e.clientX, y: e.clientY });
        if (anchor && selection.toString().trim() === anchor.reading.selected && selection.containsNode(anchor.range.startContainer, true)) {
          this.lookup(anchor, true);
        }
      }, capture);
      window.addEventListener("wheel", () => this.tap.cancel(), capture);
      window.addEventListener("keydown", (e) => {
        if (!e.isTrusted) return;
        this.tap.down(e, performance.now());
        if (e.code === "ControlLeft" && (!this.enabled || this.buttons || this.editing(e))) this.tap.cancel();
        if (e.key === "Escape") this.closeCard();
      }, capture);
      window.addEventListener("keyup", (e) => {
        if (!e.isTrusted || !this.tap.up(e.code, performance.now()) || !this.enabled || !this.point || this.buttons || this.editing(e)) return;
        const anchor = pointedWord(this.point);
        if (anchor) this.lookup(anchor, false);
      }, capture);
      window.addEventListener("contextmenu", (e) => {
        this.menuRange = null;
        if (!e.isTrusted || !this.enabled || this.editing(e)) return;
        const selection = getSelection();
        if (selection?.rangeCount === 1 && !selection.isCollapsed) this.menuRange = selection.getRangeAt(0).cloneRange();
      }, capture);
      window.addEventListener("scroll", () => this.tap.cancel(), capture);
      window.addEventListener("blur", () => {
        this.tap.reset();
        this.buttons = 0;
        press = void 0;
      });
    }
  };

  // src/ui/demo.ts
  var meanings = {
    my: ["Belonging to the person speaking.", "我的。"],
    pitch: ["The way you present your idea to potential investors.", "向潜在投资人推介项目的说辞。"],
    "isn’t": ["A short form of “is not”.", "是 is not 的缩写，在这里否定后面的 working。"],
    working: ["Getting the result the speaker wants.", "起作用，达到预期效果。"],
    on: ["With regard to a particular part of something.", "在某一方面。"],
    the: ["Refers to the particular aspect that follows.", "特指后面提到的方面。"],
    fundraising: ["The work of raising money from investors.", "向投资人筹集资金，也就是融资。"],
    side: ["One aspect of an activity.", "事情的一个方面，这里指融资这一块。"]
  };
  function sampleReader() {
    const sample = document.querySelector("#sample-text");
    const dark = document.querySelector("#sample-dark");
    dark.addEventListener("change", () => sample.classList.toggle("dark", dark.checked));
    const reader = new ReadingSession({
      async lookup(_id, reading) {
        const target = reading.selected;
        const pair = meanings[target.toLowerCase()];
        await new Promise((resolve) => setTimeout(resolve, 220));
        return { ok: true, explanation: {
          status: pair ? "ok" : "unclear",
          target,
          meaning_en: pair?.[0] ?? "",
          meaning_zh: pair?.[1] ?? "",
          note_en: ""
        } };
      },
      cancel() {
      },
      options() {
      }
    }, sample);
    reader.enabled = true;
    return (prefs2) => {
      reader.setPreferences(prefs2);
      document.querySelector("#sample-gesture").hidden = !prefs2.doubleClickPreload;
    };
  }

  // src/ui/options.ts
  var key = document.querySelector("#api-key");
  var model = document.querySelector("#model");
  var forget = document.querySelector("#forget");
  var save = document.querySelector("#save");
  var state = document.querySelector("#key-state");
  var feedback = document.querySelector("#feedback");
  var prefs = document.querySelector("#prefs");
  var doubleClick = document.querySelector("#double-click");
  var inks = [...document.querySelectorAll('input[name="ink"]')];
  var updateSample = sampleReader();
  var installed = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id && chrome.storage?.local);
  function showPreferences(values) {
    doubleClick.checked = values.doubleClickPreload;
    for (const ink of inks) ink.checked = ink.value === values.underlineTheme;
    updateSample(values);
  }
  async function changeAppearance(event) {
    const values = readingPreferences({ doubleClickPreload: doubleClick.checked, underlineTheme: inks.find((ink) => ink.checked)?.value });
    updateSample(values);
    if (!installed) return;
    try {
      const db = await localStore();
      await db.set(event.target === doubleClick ? { doubleClickPreload: values.doubleClickPreload } : { underlineTheme: values.underlineTheme });
    } catch {
      document.querySelector("#ink-help").textContent = "设置未能保存，请重新选择。";
    }
  }
  for (const control of [doubleClick, ...inks]) control.addEventListener("change", (e) => void changeAppearance(e));
  var showKeyState = (saved) => {
    state.textContent = saved ? "已保存密钥。留空可继续使用。" : "尚未保存密钥。";
    forget.hidden = !saved;
  };
  async function init() {
    save.disabled = true;
    if (!installed) {
      document.body.classList.add("local-demo");
      document.querySelector("h1").textContent = "试试蜡笔下划线";
      document.querySelector(".lead").textContent = "在英文例句里试两种查词手势，切换笔色和底色即可比较效果。";
      return;
    }
    try {
      const values = await (await localStore()).get(["apiKey", "model", "doubleClickPreload", "underlineTheme"]);
      model.value = typeof values.model === "string" ? values.model : DEFAULT_MODEL;
      showKeyState(Boolean(values.apiKey));
      showPreferences(readingPreferences(values));
      save.disabled = false;
    } catch {
      feedback.textContent = "无法读取设置，请重新打开扩展。";
    }
  }
  model.addEventListener("input", () => model.setCustomValidity(""));
  prefs.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = model.value.trim();
    if (!validModel(name)) {
      model.setCustomValidity("请填写有效的模型 ID，例如 gpt-6-luna。");
      model.reportValidity();
      return;
    }
    const newKey = key.value.trim();
    if (/\s/.test(newKey)) {
      feedback.textContent = "密钥中含有空白字符，请重新粘贴。";
      key.focus();
      return;
    }
    save.disabled = forget.disabled = true;
    try {
      const storage = await localStore();
      await storage.set(newKey ? { model: name, apiKey: newKey } : { model: name });
      if (newKey) showKeyState(true);
      key.value = "";
      model.value = name;
      feedback.textContent = "设置已保存。";
    } catch {
      feedback.textContent = "保存失败，请重试。";
    } finally {
      save.disabled = forget.disabled = false;
    }
  });
  forget.addEventListener("click", async () => {
    save.disabled = forget.disabled = true;
    try {
      await (await localStore()).remove("apiKey");
      key.value = "";
      showKeyState(false);
      feedback.textContent = "密钥已移除。";
    } catch {
      feedback.textContent = "移除失败，请重试。";
    } finally {
      save.disabled = forget.disabled = false;
    }
  });
  if (installed) chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.doubleClickPreload && !changes.underlineTheme) return;
    void localStore().then((db) => db.get(["doubleClickPreload", "underlineTheme"])).then((values) => showPreferences(readingPreferences(values)));
  });
  void init();
})();
