import { DEFAULT_MODEL, siteOf, validModel, validReading, type ClientMessage, type Reading, type Reply, type WorkerMessage } from '../shared';
import { localStore, switchState } from '../storage';
import { explain, LookupFailure } from './api';
import { cacheKey, ExplanationCache } from './cache';

const cache = new ExplanationCache(localStore);
const active = new Map<number, { id: string; site: string; controller: AbortController }>();
const menuId = 'context-explain-selection';
void localStore().catch(() => undefined);
chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({ id: menuId, title: '用 Context 解释', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
});
function tellTab(tabId: number, message: WorkerMessage) {
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined);
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === menuId && tab?.id !== undefined && !info.editable && !info.frameId && info.selectionText) {
    void tellTab(tab.id, { type: 'selection', text: info.selectionText });
  }
});
function stop(tabId: number) {
  active.get(tabId)?.controller.abort();
  active.delete(tabId);
}
chrome.tabs.onRemoved.addListener(stop);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') stop(tabId);
});
async function lookup(tab: number, site: string, id: string, reading: Reading): Promise<Reply> {
  stop(tab);
  const controller = new AbortController();
  active.set(tab, { id, site, controller });
  const signal = controller.signal;
  try {
    if (!(await switchState(site)).active) return { ok: false, error: 'disabled' };
    const prefs = await (await localStore()).get(['apiKey', 'model']);
    if (typeof prefs.apiKey !== 'string' || !prefs.apiKey) return { ok: false, error: 'noKey' };
    const model = typeof prefs.model === 'string' ? prefs.model : DEFAULT_MODEL;
    if (!validModel(model)) return { ok: false, error: 'model' };
    const key = await cacheKey(reading, model);
    const cached = await cache.get(key).catch(() => undefined);
    if (signal.aborted) throw new LookupFailure('cancelled');
    if (cached) return { ok: true, explanation: cached };
    const answer = await explain(reading, prefs.apiKey, model, signal, explanation => {
      if (!signal.aborted) void tellTab(tab, { type: 'preview', id, explanation });
    });
    if (signal.aborted) throw new LookupFailure('cancelled');
    await cache.put(key, answer).catch(() => undefined);
    return { ok: true, explanation: answer };
  } catch (error) {
    return { ok: false, error: error instanceof LookupFailure ? error.code : 'settings' };
  } finally {
    if (active.get(tab)?.controller === controller) active.delete(tab);
  }
}
chrome.runtime.onMessage.addListener((msg: ClientMessage, sender, respond) => {
  const tab = sender.tab?.id;
  const site = siteOf(sender.url);
  if (!msg || sender.id !== chrome.runtime.id || tab === undefined || sender.frameId !== 0 || !site) return;
  if (msg.type === 'state') {
    void switchState(site).then(s => respond(s.active), () => respond(false));
    return true;
  }
  if (msg.type === 'lookup' && typeof msg.id === 'string' && msg.id.length <= 64 && validReading(msg.reading)) {
    void lookup(tab, site, msg.id, msg.reading).then(respond);
    return true;
  }
  if (msg.type === 'cancel' && active.get(tab)?.id === msg.id) stop(tab);
  if (msg.type === 'options') void chrome.runtime.openOptionsPage();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  const all = keys.some(k => ['enabled', 'apiKey', 'model'].includes(k));
  const sites = new Set(keys.filter(k => k.startsWith('paused:')).map(k => k.slice(7)));
  if (!all && !sites.size) return;
  for (const [tab, request] of active) if (all || sites.has(request.site)) stop(tab);
  void chrome.tabs.query({}).then(tabs => Promise.all(tabs.map(async tab => {
    if (tab.id === undefined) return;
    if (!all) {
      const site = siteOf(tab.url) ?? await tellTab(tab.id, { type: 'site' });
      if (!sites.has(site)) return;
    }
    await tellTab(tab.id, { type: 'refresh' });
  })));
});
