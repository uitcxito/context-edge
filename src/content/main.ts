import type { ClientMessage, Reply, WorkerMessage } from '../shared';
import { Card } from './card';
import { type Anchor, pointedWord, selectionAnchor, skip } from './dom';
import { CtrlTap } from './gesture';

const tap = new CtrlTap();
const capture = { capture: true, passive: true } as const;
let point: { x: number; y: number } | null = null;
let buttons = 0;
let enabled = false;
let stateVersion = 0;
let menuRange: Range | null = null;
let current: { id: string; card: Card; observer: MutationObserver } | null = null;
async function send<T>(message: ClientMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

function closeCard() {
  if (!current) return;
  const { id, card, observer } = current;
  current = null;
  observer.disconnect();
  card.remove();
  void send({ type: 'cancel', id }).catch(() => undefined);
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
  const state = await send<boolean>({ type: 'state' }).catch(() => false);
  if (version === stateVersion) enabled = state === true;
}
function lookup(anchor: Anchor) {
  if (!enabled || !anchor.root.isConnected || anchor.range.collapsed) return;
  closeCard();
  const id = cryptoId();
  const page = location.href;
  const card = new Card(anchor.rect, anchor.reading.selected, () => lookup(anchor), () => {
    void send({ type: 'options' }).catch(() => undefined);
  });
  const observer = new MutationObserver(records => {
    if (location.href !== page || !anchor.root.isConnected || anchor.range.collapsed ||
      !anchor.root.contains(anchor.range.startContainer) ||
      (records.some(record => anchor.root.contains(record.target)) && anchor.root.textContent !== anchor.textAtLookup)) closeCard();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  current = { id, card, observer };
  void send<Reply>({ type: 'lookup', id, reading: anchor.reading })
    .then(reply => {
      if (current?.id !== id) return;
      if (!reply || (!reply.ok && ['disabled', 'cancelled'].includes(reply.error))) { closeCard(); return; }
      card.show(reply);
    })
    .catch(() => { if (current?.id === id) card.show({ ok: false, error: 'reload' }); });
}
// randomUUID is unavailable to content scripts on some non-secure HTTP pages.
function cryptoId() { return Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'); }
function editing(e: Event) {
  const target = e.composedPath().find(v => v instanceof Element);
  if (target && current?.card.host.contains(document.activeElement) && e.composedPath().includes(current.card.host)) return false;
  return document.designMode === 'on' || skip(target instanceof Element ? target : null) || skip(document.activeElement);
}
window.addEventListener('pointermove', e => {
  if (!e.isTrusted || e.pointerType !== 'mouse') return;
  point = { x: e.clientX, y: e.clientY };
  buttons = e.buttons;
}, capture);
window.addEventListener('pointerout', e => { if (!e.relatedTarget) { point = null; tap.cancel(); } }, capture);
window.addEventListener('pointerdown', e => {
  if (!e.isTrusted) return;
  tap.cancel();
  buttons = e.buttons;
  menuRange = null;
  if (current && !e.composedPath().includes(current.card.host)) closeCard();
}, capture);
window.addEventListener('pointerup', e => { buttons = e.buttons; tap.cancel(); }, capture);
window.addEventListener('pointercancel', () => { buttons = 0; tap.cancel(); }, capture);
window.addEventListener('wheel', () => tap.cancel(), capture);
window.addEventListener('keydown', e => {
  if (!e.isTrusted) return;
  tap.down(e, performance.now());
  if (e.code === 'ControlLeft' && (!enabled || buttons || editing(e))) tap.cancel();
  if (e.key === 'Escape') closeCard();
}, capture);
window.addEventListener('keyup', e => {
  if (!e.isTrusted || !tap.up(e.code, performance.now()) || !enabled || !point || buttons || editing(e)) return;
  const anchor = pointedWord(point);
  if (anchor) lookup(anchor);
}, capture);
window.addEventListener('contextmenu', e => {
  menuRange = null;
  if (!e.isTrusted || !enabled || editing(e)) return;
  const selection = getSelection();
  if (selection?.rangeCount === 1 && !selection.isCollapsed) menuRange = selection.getRangeAt(0).cloneRange();
}, capture);
chrome.runtime.onMessage.addListener((msg: WorkerMessage, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'site') { respond(location.hostname); return; }
  if (msg?.type === 'refresh') { void refresh(); return; }
  if (msg?.type === 'selection' && enabled && menuRange && document.designMode !== 'on') {
    const range = menuRange;
    menuRange = null;
    const anchor = selectionAnchor(range, msg.text);
    if (anchor) lookup(anchor);
  }
});
window.addEventListener('scroll', e => {
  if (current && !e.composedPath().includes(current.card.host)) closeCard();
  tap.cancel();
}, capture);
window.addEventListener('blur', () => { tap.reset(); buttons = 0; });
window.addEventListener('pagehide', reset);
window.addEventListener('pageshow', e => { if (e.persisted) void refresh(); });
window.addEventListener('resize', closeCard);
window.addEventListener('hashchange', reset);
window.addEventListener('popstate', reset);
(window as Window & { navigation?: EventTarget }).navigation?.addEventListener('currententrychange', reset);
document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
void refresh();
