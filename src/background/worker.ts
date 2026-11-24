import { DEFAULT_MODEL, readingPreferences, siteOf, validModel, validReading, type ClientMessage, type Reading, type Reply, type WorkerMessage } from '../shared';
import { localStore, switchState } from '../storage';
import { explain, LookupFailure } from './api';
import { cacheKey, ExplanationCache } from './cache';

const cache = new ExplanationCache(localStore);
interface PendingLookup { site: string; documentId?: string; preload: boolean; controller: AbortController }
const active = new Map<number, Map<string, PendingLookup>>();
const menuId = 'context-explain-selection';
void localStore().catch(() => undefined);
chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({ id: menuId, title: '用 Context 解释', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
});
function tellTab(tabId: number, message: WorkerMessage, documentId?: string) {
  return chrome.tabs.sendMessage(tabId, message, documentId ? { documentId } : { frameId: 0 }).catch(() => undefined);
}
chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
  void tellTab(tabId, { type: 'zoomChanged', factor: newZoomFactor });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === menuId && tab?.id !== undefined && !info.editable && !info.frameId && info.selectionText) {
    void tellTab(tab.id, { type: 'selection', text: info.selectionText });
  }
});
function stop(tabId: number, id?: string) {
  const requests = active.get(tabId);
  if (!requests) return;
  if (id === undefined) {
    for (const request of requests.values()) request.controller.abort();
    active.delete(tabId);
  } else {
    requests.get(id)?.controller.abort();
    requests.delete(id);
    if (!requests.size) active.delete(tabId);
  }
}
chrome.tabs.onRemoved.addListener(tab => stop(tab));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const requests = active.get(tabId);
  if (change.status !== 'complete' || !requests) return;
  // Edge also reports "loading" for an in-page fragment. pagehide normally cancels departed
  // documents. If it couldn't deliver, clean up only requests whose document is actually gone.
  for (const doc of new Set([...requests.values()].map(r => r.documentId))) {
    if (doc) void tellTab(tabId, { type: 'site' }, doc).then(site => {
      if (site !== undefined || active.get(tabId) !== requests) return;
      for (const [id, request] of requests) if (request.documentId === doc) stop(tabId, id);
    });
  }
});
async function lookup(tab: number, site: string, id: string, reading: Reading, preload: boolean, documentId?: string): Promise<Reply> {
  const requests = active.get(tab) ?? new Map<string, PendingLookup>();
  active.set(tab, requests);
  const controller = new AbortController();
  requests.get(id)?.controller.abort();
  requests.set(id, { site, preload, controller, documentId });
  const signal = controller.signal;
  try {
    const state = await switchState(site);
    if (!state.active || (preload && !state.doubleClickPreload)) return { ok: false, error: 'disabled' };
    const prefs = await (await localStore()).get(['apiKey', 'model']);
    if (typeof prefs.apiKey !== 'string' || !prefs.apiKey) return { ok: false, error: 'noKey' };
    const model = typeof prefs.model === 'string' ? prefs.model : DEFAULT_MODEL;
    if (!validModel(model)) return { ok: false, error: 'model' };
    const key = await cacheKey(reading, model);
    const cached = await cache.get(key).catch(() => undefined);
    if (signal.aborted) throw new LookupFailure('cancelled');
    if (cached) return { ok: true, explanation: cached };
    const answer = await explain(reading, prefs.apiKey, model, signal, explanation => {
      if (!signal.aborted) void tellTab(tab, { type: 'preview', id, explanation }, documentId);
    });
    if (signal.aborted) throw new LookupFailure('cancelled');
    await cache.put(key, answer).catch(() => undefined);
    return { ok: true, explanation: answer };
  } catch (error) {
    return { ok: false, error: error instanceof LookupFailure ? error.code : 'settings' };
  } finally {
    if (requests.get(id)?.controller === controller) requests.delete(id);
    if (!requests.size && active.get(tab) === requests) active.delete(tab);
  }
}
chrome.runtime.onMessage.addListener((msg: ClientMessage, sender, respond) => {
  const tab = sender.tab?.id;
  const site = siteOf(sender.url);
  if (!msg || sender.id !== chrome.runtime.id || tab === undefined || sender.frameId !== 0 || !site) return;
  if (msg.type === 'state') {
    void switchState(site).then(({ active, doubleClickPreload, underlineTheme }) => respond({ active, doubleClickPreload, underlineTheme }),
      () => respond({ active: false, ...readingPreferences({}) }));
    return true;
  }
  if (msg.type === 'getZoom') {
    void chrome.tabs.getZoom(tab).then(respond, () => respond(1));
    return true;
  }
  if (msg.type === 'lookup' && typeof msg.id === 'string' && msg.id.length <= 64 && validReading(msg.reading)) {
    void lookup(tab, site, msg.id, msg.reading, msg.preload === true, sender.documentId).then(respond);
    return true;
  }
  if (msg.type === 'cancel' && typeof msg.id === 'string') stop(tab, msg.id);
  if (msg.type === 'options') void chrome.runtime.openOptionsPage();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  const all = keys.some(k => ['enabled', 'apiKey', 'model'].includes(k));
  const sites = new Set(keys.filter(k => k.startsWith('paused:')).map(k => k.slice(7)));
  const appearance = keys.includes('doubleClickPreload') || keys.includes('underlineTheme');
  if (!all && !sites.size && !appearance) return;
  for (const [tab, requests] of active) {
    for (const [id, request] of requests) {
      if (all || sites.has(request.site) || (request.preload && changes.doubleClickPreload?.newValue === false)) stop(tab, id);
    }
  }
  const prefs = appearance ? localStore().then(db => db.get(['doubleClickPreload', 'underlineTheme'])).then(readingPreferences) : null;
  void Promise.all([chrome.tabs.query({}), prefs]).then(([tabs, preferences]) => Promise.all(tabs.map(async tab => {
    if (tab.id === undefined) return;
    if (preferences && !all) await tellTab(tab.id, { type: 'preferences', preferences });
    if (!all && !sites.size) return;
    if (!all) {
      const site = siteOf(tab.url) ?? await tellTab(tab.id, { type: 'site' });
      if (!sites.has(site)) return;
    }
    await tellTab(tab.id, { type: 'refresh' });
  })));
});
