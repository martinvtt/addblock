import { PAUSE_ID, isException } from "./rules.js";

const button = document.getElementById("run");
const results = document.getElementById("results");
function report(text) {
  const item = document.createElement("li");
  item.textContent = text;
  results.append(item);
}

button.addEventListener("click", async () => {
  button.disabled = true;
  results.replaceChildren();
  try {
    const info = await chrome.management.getSelf();
    if (info.installType !== 'development' ||
        !chrome.runtime.getManifest().permissions.includes('declarativeNetRequestFeedback')) {
      report('Les simulations sont réservées à la version de développement. Le filtrage reste actif : utilisez la démonstration locale ou le badge pour le vérifier.');
      return;
    }
    const api = chrome.declarativeNetRequest;
    const [dynamic, enabled] = await Promise.all([api.getDynamicRules(), api.getEnabledRulesets()]);
    const paused = dynamic.some((rule) => rule.id === PAUSE_ID);
    const active = enabled.includes("advertising") && !paused;
    report(active ? "Protection activée." : "Protection en pause : les tests attendent des autorisations.");
    const checks = [
      ["Script publicitaire", "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", "script", true],
      ["Publicité pour adultes", "https://ads.exoclick.com/test.png", "image", true],
      ["Liste communautaire AdAway", "https://s0.2mdn.net/banner.png", "image", true],
      ["Contenu ordinaire", "https://example.org/photo.png", "image", false],
      ["Domaine ressemblant", "https://notdoubleclick.net/photo.png", "image", false],
      ["Domaine dans un paramètre", "https://example.org/?url=doubleclick.net", "xmlhttprequest", false],
      ["Navigation directe préservée", "https://doubleclick.net/", "main_frame", false]
    ];
    let passed = 0;
    for (const [label, url, type, listed] of checks) {
      const result = await api.testMatchOutcome({ url, type });
      const blockMatch = result.matchedRules.some((rule) => rule.rulesetId === "advertising");
      const pauseMatch = result.matchedRules.some((rule) => rule.rulesetId === "_dynamic" && rule.ruleId === PAUSE_ID);
      const blocked = blockMatch && !pauseMatch;
      const ok = blocked === (active && listed);
      if (ok) passed++;
      report(`${ok ? "✓" : "ÉCHEC"} ${label} : ${blocked ? "bloquée" : "autorisée"}.`);
    }
    for (const exception of dynamic.filter(isException)) {
      const domain = exception.condition.requestDomains[0];
      const result = await api.testMatchOutcome({ url: `https://${domain}/`, type: "main_frame" });
      const ok = result.matchedRules.some((rule) => rule.ruleId === exception.id && rule.rulesetId === "_dynamic");
      report(`${ok ? "✓" : "ÉCHEC"} Exception de navigation : ${domain}.`);
    }
    report(`${passed}/${checks.length} tests de filtrage réussis. Les exceptions doivent aussi être vérifiées après rechargement du site, notamment dans ses cadres intégrés.`);
  } catch (error) {
    report(`Vérification impossible : ${error.message}`);
  } finally {
    button.disabled = false;
  }
});
