"use strict";
(() => {
  // src/shared.ts
  var DEFAULT_MODEL = "gpt-6-luna";
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

  // src/ui/options.ts
  var key = document.querySelector("#api-key");
  var model = document.querySelector("#model");
  var forget = document.querySelector("#forget");
  var save = document.querySelector("#save");
  var state = document.querySelector("#key-state");
  var feedback = document.querySelector("#feedback");
  var prefs = document.querySelector("#prefs");
  var showKeyState = (saved) => {
    state.textContent = saved ? "已保存密钥。留空可继续使用。" : "尚未保存密钥。";
    forget.hidden = !saved;
  };
  async function init() {
    save.disabled = true;
    try {
      const values = await (await localStore()).get(["apiKey", "model"]);
      model.value = typeof values.model === "string" ? values.model : DEFAULT_MODEL;
      showKeyState(Boolean(values.apiKey));
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
  void init();
})();
