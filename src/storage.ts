import { pauseKey, readingPreferences } from './shared';

// Apply the restriction before the first credential write AND before every context's first read.
let protectedStore: Promise<chrome.storage.LocalStorageArea> | undefined;
export function localStore() {
  protectedStore ??= chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .then(() => chrome.storage.local)
    .catch(error => { protectedStore = undefined; throw error; });
  return protectedStore;
}
export async function switchState(site: string | null) {
  const key = site ? pauseKey(site) : null;
  const keys = ['enabled', 'doubleClickPreload', 'underlineTheme'];
  if (key) keys.push(key);
  const data = await (await localStore()).get(keys);
  const enabled = data.enabled !== false;
  const paused = key !== null && data[key] === true;
  return { enabled, paused, active: Boolean(site && enabled && !paused), ...readingPreferences(data) };
}
