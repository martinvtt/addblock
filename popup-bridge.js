(() => {
  const CONFIG_EVENT = "addblock:popup-config:v1";
  let lastConfig;
  let generation = 0;
  let lastCount = -1;
  globalThis.addblockCosmeticCountChanged = (count) => {
    if (lastCount === count) return;
    lastCount = count;
    chrome.runtime.sendMessage({ type: 'cosmetic-count', count }).catch(() => {});
  };

  function publish() {
    if (lastConfig) window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: lastConfig }));
  }

  async function refresh() {
    const request = ++generation;
    const config = await chrome.runtime.sendMessage({ type: "popup-configuration" });
    if (config?.error) throw new Error(config.error);
    if (request === generation) {
      lastConfig = config;
      globalThis.addblockCosmetics?.configure(config);
      publish();
    }
  }

  window.addEventListener("addblock:popup-ready:v1", publish);
  window.addEventListener("pageshow", () => { refresh().catch(() => {}); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id === chrome.runtime.id && message?.type === "refresh-popup-protection") {
      refresh().then(() => respond({ ok: true }), (error) => respond({ error: error.message }));
      return true;
    }
  });
  refresh().catch(() => {});
})();
