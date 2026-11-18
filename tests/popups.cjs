// Run with: node tests/popups.cjs (requires Playwright and its Chromium).
// No public website is contacted: hostnames resolve to the local fixture server.
const { chromium } = require('playwright');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const extension = path.resolve(__dirname, '..');
const id = crypto.createHash('sha256').update(extension).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'addblock-popup-profile-'));
const results = [];
let port;

const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html');
  if (req.url.startsWith('/destination')) {
    res.end('<!doctype html><title>Destination légitime</title><h1>Destination</h1>');
    return;
  }
  const ad = `http://ads.exoclick.com:${port}/destination`;
  const normal = `http://destination.test:${port}/destination`;
  res.end(`<!doctype html><meta charset="utf-8"><title>Test des pop-ups</title>
    <style>body{padding:30px}a,button,p{display:block;margin:20px;padding:10px}</style>
    <script>
      addEventListener('addblock:popup-config:v1', e => {
        window.guardReady=true; window.guardEnabled=e.detail.enabled;
      });
    </script>
    <p id="passive" onclick="window.open('${normal}')">Contenu avec onglet parasite</p>
    <a id="legitimate" href="${normal}" target="_blank">Lien normal</a>
    <a id="known-ad" href="${ad}" target="_blank">Lien publicitaire</a>
    <a id="hijack" href="#article" onclick="window.open('${normal}')">Article avec ouverture parasite</a>
    <button id="dialog" onclick="window.open('${normal}')">Fenêtre légitime</button>
    <button id="ad-button" onclick="window.open('${ad}')">Bouton publicitaire</button>
    <button id="spam" onclick="window.open('${normal}');window.open('${normal}')">Deux ouvertures</button>
    <form action="${normal}" target="_blank"><button id="form" type="submit">Formulaire légitime</button></form>
    <form action="${ad}" target="_blank"><button id="ad-form" type="submit">Formulaire publicitaire</button></form>
    <form id="programmatic" action="${ad}" target="_blank"></form>
    <button id="submit-ad" onclick="document.querySelector('#programmatic').submit()">Soumission publicitaire</button>
    <button id="synthetic-ad" onclick="document.querySelector('#known-ad').click()">Lien publicitaire synthétique</button>
    <button id="auth" onclick="const w=window.open('about:blank');if(w)w.location.href='${normal}'">Connexion externe</button>
    <button id="microtask" onclick="Promise.resolve().then(()=>window.open('${normal}'))">Dialogue après microtâche</button>
    <button id="delayed-ad" onclick="setTimeout(()=>window.open('${ad}'),50)">Publicité retardée</button>
    <button id="delayed-unknown" onclick="setTimeout(()=>window.open('${normal}'),50)">Ouverture parasite retardée</button>
    <div id="keyboard" role="button" tabindex="0" onkeydown="if(event.key==='Enter')window.open('${normal}')">Action clavier</div>
    <a id="download" download="test.txt" href="data:text/plain,Addblock">Télécharger</a>
    <button id="self-navigation" onclick="window.open('#article','_self')">Navigation normale</button>
    <iframe id="frame" src="http://frame.test:${port}/frame"></iframe>
    <h2 id="article">Article</h2>`);
  // Only the outer fixture needs an iframe.
});

async function main() {
  // Avoid recursively generating frames in the fixture.
  const originalListeners = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url === '/frame') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><script>
        addEventListener('addblock:popup-config:v1',e=>{window.guardReady=true;window.guardEnabled=e.detail.enabled});
        </script><p id="frame-popup" onclick="window.open('http://destination.test:${port}/destination')">Contenu iframe</p>`);
    } else originalListeners[0](req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--host-resolver-rules=MAP * 127.0.0.1', '--no-proxy-server']
    });
    const ui = await context.newPage();
    await ui.goto(`chrome-extension://${id}/popup.html`);
    await ui.waitForFunction(() => document.getElementById('badge').textContent === 'ACTIF');
    const page = await context.newPage();
    await page.goto(`http://site.test:${port}/`);
    await page.waitForFunction(() => window.guardReady && window.guardEnabled);
    const frame = page.frameLocator('#frame');
    await frame.locator('#frame-popup').waitFor();
    await page.frames().find(f => f.url().includes('/frame')).waitForFunction(() => window.guardReady);

    async function scenario(label, action, count) {
      const before = new Set(context.pages());
      await action();
      await page.waitForTimeout(350);
      const opened = context.pages().filter(p => !before.has(p));
      assert.equal(opened.length, count, label);
      for (const openedPage of opened) await openedPage.close();
      results.push(`PASS ${label} : ${count} nouvel onglet.`);
    }

    await scenario('Clic sur contenu avec ouverture parasite', () => page.locator('#passive').click(), 0);
    await scenario('Lien légitime vers nouvel onglet', () => page.locator('#legitimate').click(), 1);
    await scenario('Lien vers domaine publicitaire connu', () => page.locator('#known-ad').click(), 0);
    await scenario('Clic sur article détourné', () => page.locator('#hijack').click(), 0);
    assert(page.url().endsWith('#article'), 'Le lien original doit continuer de fonctionner.');
    await scenario('Bouton ouvrant une fenêtre légitime', () => page.locator('#dialog').click(), 1);
    await scenario('Bouton ouvrant une publicité connue', () => page.locator('#ad-button').click(), 0);
    await scenario('Plusieurs fenêtres pour un seul clic', () => page.locator('#spam').click(), 1);
    await scenario('Formulaire légitime dans un nouvel onglet', () => page.locator('#form').click(), 1);
    await scenario('Formulaire vers domaine publicitaire', () => page.locator('#ad-form').click(), 0);
    await scenario('form.submit publicitaire', () => page.locator('#submit-ad').click(), 0);
    await scenario('Clic synthétique publicitaire', () => page.locator('#synthetic-ad').click(), 0);
    await scenario('Ouverture parasite depuis iframe', () => frame.locator('#frame-popup').click(), 0);
    await scenario('window.open sans action utilisateur', () => page.evaluate(() => window.open('/destination')), 0);
    await scenario('Connexion via fenêtre vierge puis destination', () => page.locator('#auth').click(), 1);
    await scenario('Dialogue dans une microtâche du clic', () => page.locator('#microtask').click(), 1);
    await scenario('Publicité retardée', () => page.locator('#delayed-ad').click(), 0);
    await scenario('Clic périmé non réutilisable', () => page.locator('#delayed-unknown').click(), 0);
    await scenario('Bouton accessible au clavier', () => page.locator('#keyboard').press('Enter'), 1);
    await scenario('Lien normal avec Ctrl-clic', () => page.locator('#legitimate').click({modifiers:['Control']}), 1);
    const downloadEvent=page.waitForEvent('download');
    await page.locator('#download').click();
    const download=await downloadEvent;
    assert.equal(download.suggestedFilename(),'test.txt');
    assert.equal(await download.failure(),null);
    results.push('PASS Téléchargement légitime préservé.');
    await scenario('Navigation dans l’onglet courant', () => page.locator('#self-navigation').click(), 0);

    await ui.locator('#global-toggle').click();
    await page.waitForFunction(() => window.guardEnabled === false);
    await scenario('Pause appliquée sans rechargement', () => page.locator('#passive').click(), 1);
    await scenario('Pause également dans iframe', () => frame.locator('#frame-popup').click(), 1);
    await ui.locator('#global-toggle').click();
    await page.waitForFunction(() => window.guardEnabled === true);
    await scenario('Reprise appliquée sans rechargement', () => page.locator('#passive').click(), 0);

    await ui.evaluate(async () => {
      const { siteRule } = await import('./rules.js');
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [siteRule(100, 'site.test')] });
      const result = await chrome.runtime.sendMessage({ type: 'refresh-popup-protection' });
      if (!result.ok) throw new Error(result.error);
    });
    await page.waitForFunction(() => window.guardEnabled === false);
    await scenario('Exception du site appliquée sans rechargement', () => page.locator('#passive').click(), 1);
    await scenario('Exception héritée par iframe externe', () => frame.locator('#frame-popup').click(), 1);
    await page.reload();
    await page.waitForFunction(() => window.guardReady && !window.guardEnabled);
    await scenario('Exception après rechargement', () => page.locator('#passive').click(), 1);
    await ui.evaluate(async () => {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [100] });
      await chrome.runtime.sendMessage({ type: 'refresh-popup-protection' });
    });
    await page.waitForFunction(() => window.guardEnabled === true);
    await scenario('Retrait de l’exception', () => page.locator('#passive').click(), 0);
    results.push(`Chromium ${context.browser().version()} — ${results.length} scénarios réussis.`);
    console.log(results.join('\n'));
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(results.join('\n')); console.error(error); process.exitCode = 1; });
