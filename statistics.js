// Only hostnames and counts are kept, in memory-backed session storage.
// Chrome exposes detailed DNR events only for unpacked development extensions.
const installation = chrome.management.getSelf();
const feedbackEnabled = chrome.runtime.getManifest().permissions.includes('declarativeNetRequestFeedback');
let queue = Promise.resolve();
const key = (id) => `tab:${id}`;
const empty = () => ({ network: 0, domains: {}, frames: {}, since: Date.now() });

function serialize(operation) {
  const result = queue.then(operation);
  queue = result.catch((error) => console.warn('Addblock statistics:', error.message));
  return result;
}

async function modify(id, update) {
  const name = key(id);
  const previous = (await chrome.storage.session.get(name))[name] || empty();
  update(previous);
  await chrome.storage.session.set({ [name]: previous });
}

chrome.webNavigation.onCommitted.addListener((details) => {
  serialize(async () => {
    if (details.frameId === 0) await chrome.storage.session.set({ [key(details.tabId)]: empty() });
    else await modify(details.tabId, (state) => { delete state.frames[details.frameId]; });
  });
});
chrome.tabs.onRemoved.addListener((id) => serialize(() => chrome.storage.session.remove(key(id))));

if (feedbackEnabled) chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(({ rule, request }) => {
  if (request.tabId < 0 || rule.rulesetId !== 'advertising') return;
  serialize(() => modify(request.tabId, (state) => {
    const domain = new URL(request.url).hostname;
    state.network++;
    if (Object.hasOwn(state.domains, domain) || Object.keys(state.domains).length < 100) {
      state.domains[domain] = (state.domains[domain] || 0) + 1;
    }
  }));
});

export async function recordCosmetics(sender, count) {
  if (!sender.tab || !Number.isInteger(count) || count < 0 || count > 100000) return;
  // Ignore reports from documents that have already navigated away.
  const frame = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId });
  if (!frame || frame.documentId !== sender.documentId) return;
  await serialize(() => modify(sender.tab.id, (state) => {
    state.frames[sender.frameId] = count;
  }));
}

export async function readStatistics(id) {
  await queue;
  const state = (await chrome.storage.session.get(key(id)))[key(id)] || empty();
  const info = await installation;
  const detailed = feedbackEnabled && info.installType === 'development';
  const frames = await chrome.webNavigation.getAllFrames({ tabId: id }).catch(() => []);
  const liveFrames = new Set((frames || []).map((frame) => String(frame.frameId)));
  return {
    network: detailed ? state.network : null,
    hidden: Object.entries(state.frames).reduce((sum, [frameId, count]) => sum + (liveFrames.has(frameId) ? count : 0), 0),
    domains: Object.entries(state.domains).sort((a, b) => b[1] - a[1]).slice(0, 20),
    detailed
  };
}

function configureBadge() {
  chrome.action.setBadgeBackgroundColor({ color: '#234c40' });
  chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
}
chrome.runtime.onInstalled.addListener(configureBadge);
chrome.runtime.onStartup.addListener(configureBadge);
