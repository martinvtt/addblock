const { chromium } = require('playwright');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const extension = path.resolve(__dirname, '..');
const id = crypto.createHash('sha256').update(extension).digest('hex').slice(0,32)
  .replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c,16)));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'addblock-profile-'));
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'addblock-test-results-'));
const log = [];
const hits = [];
const server = http.createServer((req,res) => {
  hits.push({host:req.headers.host,path:req.url});
  res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/ad.js')) {
    res.setHeader('Content-Type','application/javascript');
    res.end('window.adLoaded=true;');
  } else if(req.url.startsWith('/regular.js')) {
    res.setHeader('Content-Type','application/javascript');
    res.end('window.regularLoaded=true;');
  } else {
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><html><body><h1>Test local Addblock</h1>
      <script src="/regular.js"></script>
      <script src="http://pagead2.googlesyndication.com:${server.address().port}/ad.js"></script>
      </body></html>`);
  }
});

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const launch=()=>chromium.launchPersistentContext(profile,{
    channel:'chromium',headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,
      '--host-resolver-rules=MAP * 127.0.0.1','--no-proxy-server']
  });
  let context;
  try {
    context=await launch();
    const ui=await context.newPage();
    await ui.goto(`chrome-extension://${id}/popup.html`);
    await ui.waitForFunction(()=>document.getElementById('badge').textContent==='ACTIF');
    log.push('Extension réelle chargée, protection active.');
    const page=await context.newPage();
    const failures=[];
    page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure().errorText}));
    async function check(label,expectedAd,host='site.test') {
      hits.length=0;
      failures.length=0;
      await page.goto(`http://${host}:${port}/`);
      const flags=await page.evaluate(()=>({ad:!!window.adLoaded,regular:!!window.regularLoaded}));
      assert.equal(flags.regular,true,`${label}: contenu normal`);
      assert.equal(flags.ad,expectedAd,`${label}: publicité ; ${JSON.stringify({failures,hits,rules:await ui.evaluate(()=>chrome.declarativeNetRequest.getDynamicRules())})}`);
      assert.equal(hits.some(h=>h.path==='/ad.js'),expectedAd,`${label}: réception serveur`);
      if(!expectedAd)assert(failures.some(f=>f.error.includes('ERR_BLOCKED_BY_CLIENT')));
      log.push(`${label} : contenu normal chargé ; script publicitaire ${expectedAd?'reçu et exécuté':'bloqué avant le serveur (ERR_BLOCKED_BY_CLIENT)'}.`);
    }
    await check('Protection active',false);
    await ui.locator('#global-toggle').click();
    await ui.waitForFunction(()=>document.getElementById('badge').textContent==='EN PAUSE');
    await check('Pause via interface',true);
    await ui.locator('#global-toggle').click();
    await ui.waitForFunction(()=>document.getElementById('badge').textContent==='ACTIF');
    await check('Reprise via interface',false);
    // Exercise the user's complete path, including synchronization with page
    // scripts, instead of inserting a rule behind the interface's back.
    await page.bringToFront();
    await ui.reload();
    await ui.locator('#site-toggle').click();
    await ui.waitForFunction(()=>document.getElementById('status-title').textContent==='Site autorisé' && !document.getElementById('site-toggle').disabled);
    await check('Exception de site',true);
    await check('Sous-domaine autorisé',true,'sub.site.test');
    await check('Domaine ressemblant non autorisé',false,'notsite.test');
    await context.close();
    context=await launch();
    const restarted=await context.newPage();
    await restarted.goto(`chrome-extension://${id}/popup.html`);
    const saved=await restarted.evaluate(()=>chrome.declarativeNetRequest.getDynamicRules());
    assert(saved.some(r=>r.id===100));
    log.push('Exception conservée après redémarrage complet du navigateur.');
    await restarted.waitForFunction(()=>document.getElementById('exception-count').textContent==='1');
    await restarted.locator('summary').filter({hasText:'Sites autorisés'}).click();
    await restarted.getByRole('button',{name:'Retirer l’exception pour site.test',exact:true}).click();
    await restarted.waitForFunction(()=>document.getElementById('exception-count').textContent==='0');
    log.push('Suppression de l’exception via interface réussie.');
    await restarted.goto(`chrome-extension://${id}/diagnostics.html`);
    await restarted.locator('#run').click();
    await restarted.waitForFunction(()=>!document.getElementById('run').disabled);
    const diagnostic=await restarted.locator('#results').innerText();
    assert(!diagnostic.includes('ÉCHEC')&&!diagnostic.includes('impossible'),diagnostic);
    assert(diagnostic.includes('7/7'),diagnostic);
    log.push('Diagnostic intégré : 7/7 tests réussis dans Chromium, dont la source communautaire.');
    await restarted.screenshot({path:path.join(artifacts,'diagnostics.png'),fullPage:true});
    await restarted.goto(`chrome-extension://${id}/popup.html`);
    await restarted.waitForFunction(()=>document.getElementById('badge').textContent==='ACTIF');
    await restarted.screenshot({path:path.join(artifacts,'popup.png'),fullPage:true});
    log.push(`Navigateur : ${context.browser().version()}`);
    console.log(log.join('\n'));
    fs.writeFileSync(path.join(artifacts,'results.txt'),log.join('\n')+'\n');
    console.log(`Rapport et captures : ${artifacts}`);
  } finally {
    await context?.close();
    server.close();
  }
})().catch(error=>{console.error(log.join('\n'));console.error(error);process.exitCode=1;});
