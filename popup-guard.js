(() => {
  // MAIN world is necessary to intercept page calls. This is a compatibility
  // heuristic, not a security boundary: hostile page code can tamper with it.
  const nativeOpen = window.open;
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const schedule = window.setTimeout.bind(window);
  const baseURL = () => document.baseURI;
  let enabled = false; // Respect exceptions until Chrome supplies the configuration.
  let domains = [];
  let gesture = null;

  function url(value) {
    try { return new URL(String(value || "about:blank"), baseURL()); }
    catch { return null; }
  }

  function advertising(destination) {
    return destination && domains.some((domain) =>
      destination.hostname === domain || destination.hostname.endsWith(`.${domain}`)
    );
  }

  function newContext(target) {
    const name = String(target || "_blank").toLowerCase();
    return !["_self", "_top", "_parent"].includes(name);
  }

  function freshGesture() {
    return gesture && !gesture.used && performance.now() - gesture.time < 1000
      && navigator.userActivation.isActive;
  }

  function permitted(destination, consume = true) {
    if (!enabled) return true;
    if (!destination || advertising(destination) || !freshGesture()) return false;
    // A link may open its own destination. A script attached to that link
    // may not substitute an unrelated tab. Explicit buttons may open a dialog.
    if (gesture.href && destination.href !== gesture.href) return false;
    if (!gesture.href && !gesture.button) return false;
    if (consume) gesture.used = true;
    return true;
  }

  function cancel(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function capture(event) {
    const path = event.composedPath();
    const anchor = path.find((node) => node instanceof HTMLAnchorElement && node.hasAttribute("href"));
    const button = path.find((node) => node instanceof Element &&
      node.matches("button, input[type=button], input[type=submit], input[type=image], [role=button]"));
    if (event.isTrusted) {
      gesture = {
        time: performance.now(), used: false, button: Boolean(button),
        href: anchor ? url(anchor.href)?.href : null
      };
      // A previous click must not authorize a later, unrelated script.
      // Keep only the current event task (including its immediate microtasks).
      const currentGesture = gesture;
      schedule(() => {
        if (gesture === currentGesture) gesture = null;
      }, 0);
    }
    if (!enabled || !anchor || anchor.hasAttribute("download")) return;
    const destination = url(anchor.href);
    const target = anchor.target || document.querySelector("base[target]")?.target || "_self";
    const opensTab = newContext(target) || event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1;
    if (!opensTab) return;
    if (advertising(destination) || (!event.isTrusted && !permitted(destination))) cancel(event);
  }

  window.addEventListener("click", capture, true);
  window.addEventListener("auxclick", capture, true);
  window.addEventListener("keydown", (event) => {
    if (event.isTrusted && ["Enter", " "].includes(event.key)) capture(event);
  }, true);

  window.open = function (destination, target, features) {
    if (enabled && newContext(target) && !permitted(url(destination))) return null;
    return Reflect.apply(nativeOpen, this, arguments);
  };

  function formAllowed(form) {
    const target = form.target || document.querySelector("base[target]")?.target || "_self";
    return !enabled || !newContext(target) || permitted(url(form.action));
  }

  window.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    // Respect submitter overrides (formaction/formtarget).
    const target = event.submitter?.getAttribute("formtarget") || form.target ||
      document.querySelector("base[target]")?.target || "_self";
    const action = event.submitter?.getAttribute("formaction") || form.action;
    if (enabled && newContext(target) && !permitted(url(action))) cancel(event);
  }, true);

  HTMLFormElement.prototype.submit = function () {
    if (!formAllowed(this)) return;
    return Reflect.apply(nativeSubmit, this, arguments);
  };

  window.addEventListener("addblock:popup-config:v1", (event) => {
    const config = event.detail;
    if (!config || typeof config.enabled !== "boolean" || !Array.isArray(config.domains)) return;
    domains = config.domains.filter((domain) => typeof domain === "string");
    enabled = config.enabled;
    gesture = null;
  });
  window.dispatchEvent(new Event("addblock:popup-ready:v1"));
})();
