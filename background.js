import { PAUSE_ID, isException, matchingExceptions } from "./rules.js";
import { readStatistics, recordCosmetics } from "./statistics.js";

const domains = fetch(chrome.runtime.getURL("rules/advertising.json"))
  .then((response) => {
    if (!response.ok) throw new Error("Liste publicitaire indisponible.");
    return response.json();
  })
  .then((rules) => [...new Set(rules.flatMap((rule) => rule.condition.requestDomains || []))]);

async function configuration(sender) {
  const [rules, enabled, blockedDomains] = await Promise.all([
    chrome.declarativeNetRequest.getDynamicRules(),
    chrome.declarativeNetRequest.getEnabledRulesets(),
    domains
  ]);
  // The tab URL belongs to Chrome: an iframe cannot opt out by supplying
  // the hostname of an allowed site in its message.
  const topUrl = sender.tab?.url;
  const hostname = topUrl ? new URL(topUrl).hostname : "";
  return {
    enabled: Boolean(hostname) && enabled.includes("advertising")
      && !rules.some((rule) => rule.id === PAUSE_ID)
      && !matchingExceptions(rules.filter(isException), hostname).length,
    domains: blockedDomains
  };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'cosmetic-count' && sender.tab) {
    recordCosmetics(sender, message.count).then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  if (message?.type === 'statistics' && Number.isInteger(message.tabId) &&
      sender.url?.startsWith(chrome.runtime.getURL(''))) {
    readStatistics(message.tabId).then(respond, (error) => respond({ error: error.message }));
    return true;
  }
  if (message?.type === "popup-configuration" && sender.tab) {
    configuration(sender).then(respond, (error) => respond({ error: error.message }));
    return true;
  }
  // Only our extension pages can request a settings broadcast.
  if (message?.type === "refresh-popup-protection" &&
      sender.url?.startsWith(chrome.runtime.getURL(""))) {
    chrome.tabs.query({}).then(async (tabs) => {
      await Promise.allSettled(tabs.map((tab) =>
        chrome.tabs.sendMessage(tab.id, { type: "refresh-popup-protection" })
      ));
      respond({ ok: true });
    }).catch((error) => respond({ error: error.message }));
    return true;
  }
});
