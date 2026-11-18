export const PAUSE_ID = 1;

export function isException(rule) {
  return rule.id >= 100 && rule.action.type === "allowAllRequests";
}

export function matchingExceptions(rules, hostname) {
  return rules.filter((rule) => rule.condition.requestDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  ));
}

export function pauseRule() {
  return {
    id: PAUSE_ID,
    priority: 1000,
    action: { type: "allow" },
    condition: { urlFilter: "*" }
  };
}

export function siteRule(id, hostname) {
  return {
    id,
    priority: 100,
    action: { type: "allowAllRequests" },
    condition: { requestDomains: [hostname], resourceTypes: ["main_frame"] }
  };
}
