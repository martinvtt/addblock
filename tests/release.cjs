// Test the generated runtime archive, not just the development working tree.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
execFileSync('python3', ['scripts/release.py'], { cwd: root, stdio: 'inherit' });
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version;
const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'addblock-distribution-'));
execFileSync('python3', ['-m', 'zipfile', '-e', path.join(root, 'dist', `addblock-${version}.zip`), extension]);
const id = crypto.createHash('sha256').update(extension).digest('hex').slice(0,32)
  .replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c,16)));
let adHits = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/ad.js') {
    adHits++; res.setHeader('Content-Type', 'application/javascript');
    res.end('window.adLoaded=true'); return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><article id="content">Normal content</article>
    <div class="ad-slot" id="ad">Ad</div>
    <script src="http://pagead2.googlesyndication.com:${server.address().port}/ad.js"></script>`);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'addblock-release-profile-')), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
             '--host-resolver-rules=MAP * 127.0.0.1', '--no-proxy-server']
    });
    const errors = [];
    const ui = await context.newPage();
    ui.on('pageerror', e => errors.push(e.message));
    await ui.goto(`chrome-extension://${id}/popup.html`);
    await ui.waitForFunction(() => document.getElementById('badge').textContent === 'ACTIF');
    const page = await context.newPage();
    await page.goto(`http://site.test:${server.address().port}/`);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('ad')).display === 'none');
    assert(await page.locator('#content').isVisible());
    assert.equal(adHits, 0);
    const tabId = await ui.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url?.startsWith('http://site.test:')).id);
    await ui.waitForFunction(async id => {
      const s = await chrome.runtime.sendMessage({type:'statistics', tabId:id});
      return s.hidden === 1 && s.network === null && !s.detailed && s.domains.length === 0;
    }, tabId);
    await ui.waitForFunction(async id => Number(await chrome.action.getBadgeText({tabId:id})) >= 1, tabId);
    await ui.locator('#global-toggle').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('ad')).display !== 'none');
    await page.reload();
    assert(adHits >= 1);
    await ui.goto(`chrome-extension://${id}/about.html`);
    assert(await ui.getByRole('heading', {name:'Sources et vie privée', exact:true}).isVisible());
    await ui.goto(`chrome-extension://${id}/diagnostics.html`);
    await ui.locator('#run').click();
    await ui.waitForFunction(() => document.getElementById('results').textContent.includes('réservées'));
    assert.deepEqual(errors, []);
    console.log('PASS Distribution ZIP: blocking, badge, cosmetics, pause, private statistics, privacy page and diagnostics fallback.');
  } finally {
    await context?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
