import { DEFAULT_MODEL, validModel } from '../shared';
import { localStore } from '../storage';

const key = document.querySelector<HTMLInputElement>('#api-key')!;
const model = document.querySelector<HTMLInputElement>('#model')!;
const forget = document.querySelector<HTMLButtonElement>('#forget')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const state = document.querySelector<HTMLElement>('#key-state')!;
const feedback = document.querySelector<HTMLElement>('#feedback')!;
const prefs = document.querySelector<HTMLFormElement>('#prefs')!;
const showKeyState = (saved: boolean) => {
  state.textContent = saved ? '已保存密钥。留空可继续使用。' : '尚未保存密钥。';
  forget.hidden = !saved;
};
async function init() {
  save.disabled = true;
  try {
    const values = await (await localStore()).get(['apiKey', 'model']);
    model.value = typeof values.model === 'string' ? values.model : DEFAULT_MODEL;
    showKeyState(Boolean(values.apiKey));
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
void init();
