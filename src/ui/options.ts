import { DEFAULT_MODEL, readingPreferences, validModel, type ReadingPreferences } from '../shared';
import { localStore } from '../storage';
import { sampleReader } from './demo';

const key = document.querySelector<HTMLInputElement>('#api-key')!;
const model = document.querySelector<HTMLInputElement>('#model')!;
const forget = document.querySelector<HTMLButtonElement>('#forget')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const state = document.querySelector<HTMLElement>('#key-state')!;
const feedback = document.querySelector<HTMLElement>('#feedback')!;
const prefs = document.querySelector<HTMLFormElement>('#prefs')!;
const doubleClick = document.querySelector<HTMLInputElement>('#double-click')!;
const inks = [...document.querySelectorAll<HTMLInputElement>('input[name="ink"]')];
const updateSample = sampleReader();
const installed = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id && chrome.storage?.local);
function showPreferences(values: ReadingPreferences) {
  doubleClick.checked = values.doubleClickPreload;
  for (const ink of inks) ink.checked = ink.value === values.underlineTheme;
  updateSample(values);
}
async function changeAppearance(event: Event) {
  const values = readingPreferences({ doubleClickPreload: doubleClick.checked, underlineTheme: inks.find(ink => ink.checked)?.value });
  updateSample(values);
  if (!installed) return;
  try {
    const db = await localStore();
    await db.set<ReadingPreferences>(event.target === doubleClick ? { doubleClickPreload: values.doubleClickPreload } : { underlineTheme: values.underlineTheme });
  } catch {
    document.querySelector('#ink-help')!.textContent = '设置未能保存，请重新选择。';
  }
}
for (const control of [doubleClick, ...inks]) control.addEventListener('change', e => void changeAppearance(e));
const showKeyState = (saved: boolean) => {
  state.textContent = saved ? '已保存密钥。留空可继续使用。' : '尚未保存密钥。';
  forget.hidden = !saved;
};
async function init() {
  save.disabled = true;
  if (!installed) {
    document.body.classList.add('local-demo');
    document.querySelector('h1')!.textContent = '试试蜡笔下划线';
    document.querySelector('.lead')!.textContent = '在英文例句里试两种查词手势，切换笔色和底色即可比较效果。';
    return;
  }
  try {
    const values = await (await localStore()).get(['apiKey', 'model', 'doubleClickPreload', 'underlineTheme']);
    model.value = typeof values.model === 'string' ? values.model : DEFAULT_MODEL;
    showKeyState(Boolean(values.apiKey));
    showPreferences(readingPreferences(values));
    save.disabled = false;
  } catch { feedback.textContent = '无法读取设置，请重新打开扩展。'; }
}
model.addEventListener('input', () => model.setCustomValidity(''));
prefs.addEventListener('submit', async event => {
  event.preventDefault();
  const name = model.value.trim();
  if (!validModel(name)) {
    model.setCustomValidity('请填写有效的模型 ID，例如 gpt-6-luna。');
    model.reportValidity();
    return;
  }
  const newKey = key.value.trim();
  if (/\s/.test(newKey)) { feedback.textContent = '密钥中含有空白字符，请重新粘贴。'; key.focus(); return; }
  save.disabled = forget.disabled = true;
  try {
    const storage = await localStore();
    await storage.set<{ model: string; apiKey?: string }>(newKey ? { model: name, apiKey: newKey } : { model: name });
    if (newKey) showKeyState(true);
    key.value = '';
    model.value = name;
    feedback.textContent = '设置已保存。';
  } catch { feedback.textContent = '保存失败，请重试。'; }
  finally { save.disabled = forget.disabled = false; }
});
forget.addEventListener('click', async () => {
  save.disabled = forget.disabled = true;
  try {
    await (await localStore()).remove('apiKey');
    key.value = '';
    showKeyState(false);
    feedback.textContent = '密钥已移除。';
  } catch { feedback.textContent = '移除失败，请重试。'; }
  finally { save.disabled = forget.disabled = false; }
});
if (installed) chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.doubleClickPreload && !changes.underlineTheme)) return;
  void localStore().then(db => db.get(['doubleClickPreload', 'underlineTheme'])).then(values => showPreferences(readingPreferences(values)));
});
void init();
