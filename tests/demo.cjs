const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const id=crypto.createHash('sha256').update(root).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!['index.html','demo.js','offer.html'].includes(name)){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root,'demo',name)));
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let context;
  try{
    context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'addblock-demo-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
    const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/popup.html`);
    await ui.waitForFunction(()=>document.getElementById('badge').textContent==='ACTIF');
    const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ad-slot')).display==='none');
    assert(await page.locator('.useful').isVisible());
    let count=context.pages().length;
    await page.locator('#trap').click();await page.waitForTimeout(300);
    assert.equal(context.pages().length,count);
    const popupEvent=page.waitForEvent('popup');await page.locator('#legitimate').click();
    await (await popupEvent).close();
    await ui.locator('#global-toggle').click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ad-slot')).display!=='none');
    const allowedEvent=page.waitForEvent('popup');await page.locator('#trap').click();
    await (await allowedEvent).close();
    console.log('PASS Démo locale : encart masqué, contenu préservé, ouverture parasite bloquée, bouton légitime et pause.');
  }finally{await context?.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
