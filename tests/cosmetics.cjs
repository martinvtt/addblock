const { chromium } = require('playwright');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const extension = path.resolve(__dirname, '..');
const id = crypto.createHash('sha256').update(extension).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const server = http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');
  if (req.url === '/clean') { res.end('<!doctype html><h1>Page sans publicité</h1>'); return; }
  res.end(`<!doctype html><body>
    <article id="content">Article à préserver</article>
    <aside id="sidebar"><p id="useful">Lien utile</p><div id="ad" data-ad-slot="1" style="display:flex !important">Publicité</div></aside>
    <div id="false-positive" class="shadow address download">Texte normal</div>
    <div id="mixed" class="ad-container"><article>Article inclus : ne pas masquer</article></div>
    <div id="hidden" class="ad-slot" style="display:none">Déjà invisible</div>
    <img id="remote-ad" src="http://ads.exoclick.com:${server.address().port}/image.png">
  </body>`);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let context;
  try {
    context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'addblock-cosmetics-')),{
      channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP * 127.0.0.1','--no-proxy-server']
    });
    const ui=await context.newPage(); await ui.goto(`chrome-extension://${id}/popup.html`);
    await ui.waitForFunction(()=>document.getElementById('badge').textContent==='ACTIF');
    const page=await context.newPage(); await page.goto(`http://site.test:${server.address().port}/`);
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('ad')).display==='none');
    for (const selector of ['#content','#useful','#sidebar','#false-positive','#mixed']) assert(await page.locator(selector).isVisible(),selector);
    assert(!(await page.locator('#remote-ad').isVisible()));
    const tabId=await ui.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url?.startsWith('http://site.test:')).id);
    await ui.waitForFunction(async(id)=>{
      const stats=await chrome.runtime.sendMessage({type:'statistics',tabId:id});
      return stats.network===1 && stats.hidden===1 && stats.domains.some(([d])=>d==='ads.exoclick.com');
    },tabId);
    // Loading the popup in a background tab lets it inspect the active website.
    await page.bringToFront(); await ui.reload();
    // Chrome already collapses a blocked image: do not count it twice.
    await ui.waitForFunction(()=>document.getElementById('network-count').textContent==='1' && document.getElementById('hidden-count').textContent==='1');
    assert.equal(await ui.locator('#hidden-count').innerText(),'1');
    assert((await ui.locator('#blocked-domains').textContent()).includes('ads.exoclick.com'));
    if (process.env.ADDBLOCK_CAPTURE) {
      fs.mkdirSync(path.join(extension,'docs'),{recursive:true});
      await ui.setViewportSize({width:380,height:640});
      await ui.locator('#activity-details').evaluate(n=>n.open=true);
      await ui.screenshot({path:path.join(extension,'docs/popup.png'),fullPage:true});
    }
    await page.evaluate(()=>{const d=document.createElement('div');d.id='late';d.className='ad-banner';d.textContent='Publicité ajoutée';document.body.append(d)});
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('late')).display==='none');
    await page.evaluate(()=>document.getElementById('late').className='normal');
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('late')).display!=='none');
    await ui.locator('#global-toggle').click();
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('ad')).display==='flex');
    await ui.waitForFunction(async(id)=>(await chrome.runtime.sendMessage({type:'statistics',tabId:id})).hidden===0,tabId);
    assert.equal(await page.locator('#ad').evaluate(n=>n.style.getPropertyPriority('display')),'important');
    assert(!(await page.locator('#hidden').isVisible()));
    await ui.locator('#global-toggle').click();
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('ad')).display==='none');
    await ui.evaluate(async()=>{
      const {siteRule}=await import('./rules.js');
      await chrome.declarativeNetRequest.updateDynamicRules({addRules:[siteRule(100,'site.test')]});
      await chrome.runtime.sendMessage({type:'refresh-popup-protection'});
    });
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('ad')).display==='flex');
    await page.goto(`http://site.test:${server.address().port}/clean`);
    await ui.waitForFunction(async(id)=>{
      const s=await chrome.runtime.sendMessage({type:'statistics',tabId:id});
      return s.network===0 && s.hidden===0 && s.domains.length===0;
    },tabId);
    await page.close();
    await ui.waitForFunction(async(id)=>!(await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`],tabId);
    console.log('PASS Encarts, ajouts dynamiques, faux positifs, pause, styles, exception, compteurs réels, domaines, affichage et nettoyage des statistiques.');
  } finally {await context?.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
