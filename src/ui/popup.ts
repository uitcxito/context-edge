import { pauseKey } from '../shared';
import { localStore, switchState } from '../storage';

const globalToggle = document.querySelector<HTMLInputElement>('#enabled')!;
const siteToggle = document.querySelector<HTMLInputElement>('#paused')!;
const siteLabel = document.querySelector<HTMLElement>('#site')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
let site: string | null = null;

async function render() {
  const s = await switchState(site);
  globalToggle.checked = s.enabled;
  siteToggle.checked = s.paused;
  globalToggle.disabled = false;
  siteToggle.disabled = !site || !s.enabled;
  siteLabel.textContent = site ?? '此页面不支持查词';
  hint.textContent = !s.enabled ? '阅读助手已关闭。' : !site ? '打开普通英文网页即可使用。' :
    s.paused ? '已暂停此网站的查词。' : '指向英文单词，轻按左 Ctrl。';
}
async function change(which: 'global' | 'site') {
  globalToggle.disabled = siteToggle.disabled = true;
  try {
    const storage = await localStore();
    if (which === 'global') await storage.set({ enabled: globalToggle.checked });
    else if (site) {
      if (siteToggle.checked) await storage.set({ [pauseKey(site)]: true });
      else await storage.remove(pauseKey(site));
    }
    await render();
  } catch { hint.textContent = '无法保存开关，请重新打开面板。'; }
}
globalToggle.addEventListener('change', () => void change('global'));
siteToggle.addEventListener('change', () => void change('site'));
document.querySelector('#settings')!.addEventListener('click', () => void chrome.runtime.openOptionsPage());
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      const host = await chrome.tabs.sendMessage(tab.id, { type: 'site' }, { frameId: 0 }).catch(() => null);
      site = typeof host === 'string' ? host : null;
    }
    await render();
  } catch { hint.textContent = '无法读取设置，请重新打开面板。'; }
}
void init();
