const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({channel: 'chromium', headless: true});
  try {
    const page = await browser.newPage();
    const fixture = `<div role="listbox">
      <div role="option" id="ad" style="display:flex"><span>Revolut Business</span><span>Pub</span></div>
      <div role="option" id="mail"><span>Revolut</span><span>Your account statement</span></div>
      <div role="option" id="subject"><span data-testid="message-subject">Pub</span></div>
      <div role="option" id="identified" data-item-id="mail-1"><span>Pub</span></div>
      <div role="option" id="late"><span>Ordinary content</span></div>
    </div><article id="body"><span>Pub</span><a href="https://example.test">Mail link</a></article>`;
    await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: fixture}));
    for (const host of ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'other.test', 'outlook.live.com.other.test']) {
      await page.goto('https://' + host + '/mail/');
      await page.addScriptTag({path: path.resolve(__dirname, '../cosmetics.js')});
      await page.evaluate(() => addblockCosmetics.configure({enabled: true, domains: []}));
      const supported = ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'].includes(host);
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#ad').isVisible(), !supported);
      for (const id of ['mail', 'subject', 'identified', 'body', 'late']) assert(await page.locator('#' + id).isVisible(), id);
      if (!supported) continue;
      await page.evaluate(() => document.querySelector('#late span').firstChild.data = 'Ad');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#late')).display === 'none');
      // Outlook can recycle an advertising row for an ordinary message.
      await page.evaluate(() => document.querySelector('#late span').textContent = 'Your receipt');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#late')).display !== 'none');
      await page.evaluate(() => addblockCosmetics.configure({enabled: false, domains: []}));
      assert.equal(await page.locator('#ad').evaluate(n => n.style.display), 'flex');
      assert.equal(await page.evaluate(() => addblockCosmetics.count()), 0);
    }
    console.log('PASS Outlook badges, normal mail, host isolation, dynamic badges, recycled rows and pause restoration.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
