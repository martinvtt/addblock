import { PAUSE_ID, isException, matchingExceptions, pauseRule, siteRule } from "./rules.js";

const $ = (id) => document.getElementById(id);
const dnr = chrome.declarativeNetRequest;
let state;
let tab;
let hostname = "";
let busy = false;
let statsPending = false;

async function refreshStatistics() {
  if (statsPending || !Number.isInteger(tab?.id)) return;
  statsPending = true;
  try {
    const stats = await chrome.runtime.sendMessage({ type: 'statistics', tabId: tab.id });
    if (stats.error) throw new Error(stats.error);
    $('network-count').textContent = stats.network === null ? '—' : String(stats.network);
    $('hidden-count').textContent = String(stats.hidden);
    $('activity-note').textContent = stats.detailed
      ? 'Depuis le chargement. Journal local, limité à 20 domaines affichés.'
      : 'Cette version ne collecte pas le détail réseau. Le badge Chrome reste disponible.';
    $('blocked-domains').replaceChildren();
    for (const [domain, count] of stats.domains) {
      const item = document.createElement('li');
      item.textContent = `${domain} · ${count}`;
      $('blocked-domains').append(item);
    }
    if (!stats.domains.length) {
      const item = document.createElement('li');
      item.textContent = stats.detailed ? 'Aucun domaine observé pour cet onglet.' : 'Journal détaillé indisponible.';
      $('blocked-domains').append(item);
    }
  } catch {
    $('network-count').textContent = '—';
    $('hidden-count').textContent = '—';
    $('activity-note').textContent = 'Statistiques indisponibles pour le moment.';
  } finally { statsPending = false; }
}

function lock(value) {
  busy = value;
  document.querySelectorAll("button").forEach((button) => { button.disabled = value; });
  if (!value) {
    $("site-toggle").disabled = !hostname;
    $("reload").disabled = !hostname;
  }
}

async function refresh() {
  const [rules, enabled] = await Promise.all([dnr.getDynamicRules(), dnr.getEnabledRulesets()]);
  state = {
    rules,
    active: enabled.includes("advertising") && !rules.some((rule) => rule.id === PAUSE_ID),
    exceptions: rules.filter(isException)
  };
  const exempt = matchingExceptions(state.exceptions, hostname).length > 0;
  $("badge").textContent = state.active ? "ACTIF" : "EN PAUSE";
  $("status-title").textContent = !state.active ? "Protection en pause"
    : exempt ? "Site autorisé" : "Protection activée";
  $("status-detail").textContent = !state.active ? "Filtrage publicitaire et protection anti-pop-up en pause."
    : exempt ? "Publicités et fenêtres autorisées. Rechargez pour appliquer le filtrage réseau."
    : "Filtrage publicitaire et protection contre les ouvertures abusives au clic.";
  $("global-toggle").textContent = state.active ? "Mettre en pause partout" : "Activer la protection";
  $("site-name").textContent = hostname || "Page non prise en charge";
  $("site-detail").textContent = !hostname ? "Ouvrez un site HTTP ou HTTPS pour gérer son exception."
    : exempt ? "Exception enregistrée, sous-domaines inclus."
    : state.active ? "Filtrage activé sur ce site." : "La protection globale est en pause.";
  $("site-toggle").textContent = exempt ? "Retirer l’exception de ce site" : "Autoriser ce site";
  $("exception-count").textContent = String(state.exceptions.length);
  $("exceptions").replaceChildren();
  for (const rule of state.exceptions) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = rule.condition.requestDomains[0];
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Retirer";
    remove.setAttribute("aria-label", `Retirer l’exception pour ${label.textContent}`);
    remove.addEventListener("click", () => change(async () => {
      await dnr.updateDynamicRules({ removeRuleIds: [rule.id] });
    }));
    item.append(label, remove);
    $("exceptions").append(item);
  }
  if (!state.exceptions.length) {
    const item = document.createElement("li");
    item.textContent = "Aucun site autorisé.";
    $("exceptions").append(item);
  }
}

async function change(operation) {
  if (busy) return;
  lock(true);
  $("message").textContent = "";
  try {
    await operation();
    const sync = await chrome.runtime.sendMessage({ type: "refresh-popup-protection" });
    if (!sync?.ok) throw new Error(sync?.error || "Protection anti-pop-up non synchronisée. Rechargez la page.");
    await refresh();
    $("message").textContent = "Réglage enregistré. Rechargez la page pour l’appliquer complètement.";
    lock(false);
  } catch (error) {
    $("message").textContent = `Modification impossible : ${error.message}`;
    try { await refresh(); lock(false); }
    catch { lock(true); $("badge").textContent = "ERREUR"; }
  }
}

$("global-toggle").addEventListener("click", () => change(async () => {
  if (state.active) {
    await dnr.updateDynamicRules({ removeRuleIds: [PAUSE_ID], addRules: [pauseRule()] });
  } else {
    await dnr.updateEnabledRulesets({ enableRulesetIds: ["advertising"] });
    await dnr.updateDynamicRules({ removeRuleIds: [PAUSE_ID] });
  }
}));

$("site-toggle").addEventListener("click", () => change(async () => {
  if (!hostname) return;
  const matches = matchingExceptions(state.exceptions, hostname);
  if (matches.length) {
    await dnr.updateDynamicRules({ removeRuleIds: matches.map((rule) => rule.id) });
  } else {
    const id = Math.max(99, ...state.rules.map((rule) => rule.id)) + 1;
    await dnr.updateDynamicRules({ addRules: [siteRule(id, hostname)] });
  }
}));

$("reload").addEventListener("click", async () => {
  try { await chrome.tabs.reload(tab.id); window.close(); }
  catch (error) { $("message").textContent = `Rechargement impossible : ${error.message}`; }
});

async function init() {
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const url = new URL(tab.url);
      if (["http:", "https:"].includes(url.protocol)) hostname = url.hostname;
    }
    await refresh();
    await refreshStatistics();
    lock(false);
    const source = await fetch('rules/sources.json').then(response => response.json());
    $('filter-info').textContent = `${source.domains.toLocaleString('fr-FR')} domaines · AdAway et liste locale`;
    setInterval(refreshStatistics, 1500);
  } catch (error) {
    lock(true);
    $("badge").textContent = "ERREUR";
    $("status-title").textContent = "Protection non vérifiée";
    $("status-detail").textContent = "Rechargez Addblock dans chrome://extensions.";
    $("message").textContent = error.message;
  }
}
init();
