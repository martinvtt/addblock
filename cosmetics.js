(() => {
  // Conservative, original selectors: never hide an entire sidebar or article.
  const containers = 'ins.adsbygoogle,[data-ad-slot],[data-ad-unit],.ad-slot,.ad-container,.ad-banner,.advertisement,#ad-sidebar,#ad-banner';
  const outlook = ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'].includes(location.hostname);
  const outlookRows = '[role="listbox"] [role="option"]';
  const candidates = `${containers},iframe[src],img[src]${outlook ? ',' + outlookRows : ''}`;

  function outlookAdvertisement(node) {
    if (!outlook || !node.matches(outlookRows)) return false;
    // Only a separate badge inside a message-list row, never message body text.
    // Leave rows with nested items or message identifiers alone.
    if (node.querySelector('[role="option"]') || node.matches('[data-item-id],[data-convid]')) return false;
    return [...node.querySelectorAll('span,button,[aria-label],[title]')].some(badge => {
      if (badge.closest('[role="option"]') !== node || badge.children.length) return false;
      const label = badge.textContent.trim();
      return /^(Pub|Ad|Advertisement|Publicité)$/i.test(label)
        && !badge.closest('[role="heading"],[data-testid="message-subject"]');
    });
  }
  const saved = new Map();
  let domains = new Set();
  let enabled = false;
  let timer;
  const pending = new Set();

  function listed(source) {
    try {
      let host = new URL(source, document.baseURI).hostname;
      while (host) {
        if (domains.has(host)) return true;
        const index = host.indexOf('.');
        if (index < 0) break;
        host = host.slice(index + 1);
      }
    } catch { /* Ignore malformed and non-network URLs. */ }
    return false;
  }

  function eligible(node) {
    if (!(node instanceof HTMLElement) || node.matches('html,body,main,article') || node.querySelector('main,article')) return false;
    return outlookAdvertisement(node) || node.matches(containers) || (node.matches('iframe[src],img[src]') && listed(node.getAttribute('src')));
  }

  function restore(node, original) {
    if (original.value) node.style.setProperty('display', original.value, original.priority);
    else node.style.removeProperty('display');
    saved.delete(node);
  }

  function hide(node) {
    if (!node.isConnected || !eligible(node) || saved.has(node)) return;
    // Already hidden by the site is not an element hidden by Addblock.
    if (getComputedStyle(node).display === 'none') return;
    saved.set(node, { value: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') });
    node.style.setProperty('display', 'none', 'important');
  }

  function flush() {
    timer = undefined;
    if (!enabled) return;
    for (const [node, original] of saved) {
      if (!node.isConnected || !eligible(node)) restore(node, original);
    }
    for (const root of pending) {
      if (root instanceof Element) {
        hide(root);
        if (outlook) {
          const row = root.closest(outlookRows);
          if (row) hide(row);
        }
      }
      root.querySelectorAll?.(candidates).forEach(hide);
    }
    pending.clear();
    globalThis.addblockCosmeticCountChanged?.(saved.size);
  }

  function schedule(root) {
    pending.add(root);
    if (!timer) timer = setTimeout(flush, 50);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') schedule(record.target);
      else {
        if (outlook) schedule(record.target.parentElement || record.target);
        for (const node of record.addedNodes) if (node instanceof Element) schedule(node);
        // Trigger cleanup even if only removals occurred.
        if (record.removedNodes.length) schedule(record.target);
      }
    }
  });

  globalThis.addblockCosmetics = {
    configure(config) {
      observer.disconnect();
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
      enabled = config.enabled;
      domains = new Set(config.domains);
      if (!enabled) {
        for (const [node, original] of saved) restore(node, original);
        globalThis.addblockCosmeticCountChanged?.(0);
        return;
      }
      observer.observe(document, { subtree: true, childList: true, characterData: outlook, attributes: true,
        attributeFilter: ['src', 'class', 'id', 'data-ad-slot', 'data-ad-unit', 'role', 'aria-label', 'title', 'data-item-id', 'data-convid'] });
      schedule(document);
    },
    count: () => saved.size
  };
})();
