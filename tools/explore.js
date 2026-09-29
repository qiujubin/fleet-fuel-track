const { chromium } = require('playwright-core');
const fs = require('fs');

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
  await page.waitForTimeout(12000);
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());

  const dump = await page.evaluate(() => {
    const out = [];
    function walk(el, depth) {
      if (depth > 8 || out.length > 600) return;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'path', 'defs', 'br'].includes(tag)) return;
      const id = el.id ? '#' + el.id : '';
      let cls = '';
      if (typeof el.className === 'string' && el.className.trim()) {
        cls = '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
      }
      const ph = el.getAttribute ? (el.getAttribute('placeholder') || '') : '';
      let txt = '';
      if (el.children.length === 0) txt = (el.textContent || '').trim().slice(0, 40);
      out.push('  '.repeat(depth) + tag + id + cls + (ph ? ` [ph="${ph}"]` : '') + (txt ? ` "${txt}"` : ''));
      for (const c of el.children) walk(c, depth + 1);
    }
    walk(document.body, 0);
    return out.join('\n');
  });
  fs.writeFileSync(BASE + '\\outputs\\dom.txt', dump, 'utf8');
  console.log('DOM lines:', dump.split('\n').length);

  await page.screenshot({ path: BASE + '\\outputs\\track_page.png' });
  console.log('screenshot saved');
  await ctx.close();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
