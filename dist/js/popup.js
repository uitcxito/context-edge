"use strict";
(() => {
  // src/shared.ts
  function readingPreferences(values) {
    const theme = values.underlineTheme;
    return { doubleClickPreload: values.doubleClickPreload !== false, underlineTheme: theme === "blue" || theme === "clay" ? theme : "auto" };
  }
  function pauseKey(site2) {
    return "paused:" + site2;
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
  async function switchState(site2) {
    const key = site2 ? pauseKey(site2) : null;
    const keys = ["enabled", "doubleClickPreload", "underlineTheme"];
    if (key) keys.push(key);
    const data = await (await localStore()).get(keys);
    const enabled = data.enabled !== false;
    const paused = key !== null && data[key] === true;
    return { enabled, paused, active: Boolean(site2 && enabled && !paused), ...readingPreferences(data) };
  }

  // src/ui/popup.ts
  var globalToggle = document.querySelector("#enabled");
  var siteToggle = document.querySelector("#paused");
  var siteLabel = document.querySelector("#site");
  var hint = document.querySelector("#hint");
  var site = null;
  async function render() {
    const s = await switchState(site);
    globalToggle.checked = s.enabled;
    siteToggle.checked = s.paused;
    globalToggle.disabled = false;
    siteToggle.disabled = !site || !s.enabled;
    siteLabel.textContent = site ?? "此页面不支持查词";
    hint.textContent = !s.enabled ? "阅读助手已关闭。" : !site ? "打开普通英文网页即可使用。" : s.paused ? "已暂停此网站的查词。" : "指向英文单词，轻按左 Ctrl。";
  }
  async function change(which) {
    globalToggle.disabled = siteToggle.disabled = true;
    try {
      const storage = await localStore();
      if (which === "global") await storage.set({ enabled: globalToggle.checked });
      else if (site) {
        if (siteToggle.checked) await storage.set({ [pauseKey(site)]: true });
        else await storage.remove(pauseKey(site));
      }
      await render();
    } catch {
      hint.textContent = "无法保存开关，请重新打开面板。";
    }
  }
  globalToggle.addEventListener("change", () => void change("global"));
  siteToggle.addEventListener("change", () => void change("site"));
  document.querySelector("#settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());
  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== void 0) {
        const host = await chrome.tabs.sendMessage(tab.id, { type: "site" }, { frameId: 0 }).catch(() => null);
        site = typeof host === "string" ? host : null;
      }
      await render();
    } catch {
      hint.textContent = "无法读取设置，请重新打开面板。";
    }
  }
  void init();
})();
