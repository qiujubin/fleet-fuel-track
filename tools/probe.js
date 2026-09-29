const { chromium } = require('playwright-core');

const BASE = 'E:\\WorkSpace\\workbuddy\\2026-09-27-17-41-57';

(async () => {
  const ctx = await chromium.launchPersistentContext(BASE + '\\tools\\profile', {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    viewport: { width: 1600, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://webgispro.e6yun.com/map/#/track', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
  const ls = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      o[k] = (localStorage.getItem(k) || '').slice(0, 100);
    }
    return o;
  });
  console.log('LOCALSTORAGE:', JSON.stringify(ls).slice(0, 2000));
  const cookies = await ctx.cookies('https://webgispro.e6yun.com');
  console.log('COOKIES:', JSON.stringify(cookies.map(c => c.name)).slice(0, 500));
  await page.screenshot({ path: BASE + '\\outputs\\probe.png' });
  console.log('screenshot saved');
  await ctx.close();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
