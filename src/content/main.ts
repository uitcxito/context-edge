import type { ClientMessage, ReaderState, Reply, WorkerMessage } from '../shared';
import { ReadingSession } from './reader';

function send<T>(message: ClientMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}
const session = new ReadingSession({
  lookup: (id, reading, preload) => send<Reply>({ type: 'lookup', id, reading, preload }),
  cancel: id => { void send({ type: 'cancel', id }).catch(() => undefined); },
  options: () => { void send({ type: 'options' }).catch(() => undefined); }
});
let version = 0, zoomVersion = 0, prefsVersion = 0;
async function refresh() {
  const revision = ++version, zoomAtStart = zoomVersion, prefsAtStart = prefsVersion;
  session.enabled = false;
  session.clear();
  const [state, zoom] = await Promise.all([
    send<ReaderState>({ type: 'state' }).catch(() => null),
    send<number>({ type: 'getZoom' }).catch(() => 1)
  ]);
  if (revision !== version) return;
  if (zoomVersion === zoomAtStart) session.setZoom(zoom);
  if (state && prefsVersion === prefsAtStart) session.setPreferences(state);
  session.enabled = state?.active === true;
}
chrome.runtime.onMessage.addListener((msg: WorkerMessage, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  switch (msg?.type) {
    case 'site': respond(location.hostname); break;
    case 'refresh': void refresh(); break;
    case 'preferences': prefsVersion++; session.setPreferences(msg.preferences); break;
    case 'zoomChanged': zoomVersion++; session.setZoom(msg.factor); break;
    case 'preview': session.preview(msg.id, msg.explanation); break;
    case 'selection': session.explainSelection(msg.text); break;
  }
});
window.addEventListener('pageshow', e => { if (e.persisted) void refresh(); });
void refresh();
