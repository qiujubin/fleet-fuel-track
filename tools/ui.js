const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = 'E:\\WorkSpace\\workbuddy\\2026-09-27-17-41-57';
// 用法: node ui.js [--click=sel1;;sel2] [--type=sel::text] [--wait=ms] [--tag=name] [--url=...]
const argv = process.argv.slice(2).reduce((a, s) => {
  const m = s.match(/^--([^=]+)=(.*)$/);
  if (m) a[m[1]] = m[2];
  else a[s.replace(/^--/, '')] = true;
  return a;
}, {});

const URL = argv.url || 'https://webgispro.e6yun.com/map/#/track';
const TAG = argv.tag || 'step';
const WAIT = parseInt(argv.wait || '12000', 10);

(async () => {
  const ctx = await chromium.launchPersistentContext(BASE + '\\tools\\profile', {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    viewport: { width: 1600, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(WAIT);

  if (argv.click) {
    for (const sel of argv.click.split(';;')) {
      console.log('CLICK:', sel);
      try {
        await page.click(sel, { timeout: 8000 });
      } catch (e) {
        console.log('  click failed:', e.message.split('\n')[0]);
      }
      await page.waitForTimeout(2500);
    }
  }
  if (argv.type) {
    for (const pair of argv.type.split(';;')) {
      const [sel, text] = pair.split('::');
      console.log('TYPE:', sel, '<-', text);
      try {
        await page.click(sel, { timeout: 5000 });
        await page.fill(sel, text.replace(/\+/g, ' '), { timeout: 5000 });
        await page.waitForTimeout(2500);
        await page.keyboard.press('Enter');
      } catch (e) {
        console.log('  type failed:', e.message.split('\n')[0]);
      }
      await page.waitForTimeout(3000);
    }
  }
  if (argv.press) {
    try { await page.keyboard.press(argv.press); } catch (e) { console.log('press failed', e.message); }
    await page.waitForTimeout(1500);
  }
  if (argv.evaljs) {
    try {
      const r = await page.evaluate(argv.evaljs);
      console.log('EVAL:', typeof r === 'string' ? r.slice(0, 3000) : JSON.stringify(r).slice(0, 3000));
    } catch (e) { console.log('eval failed:', e.message.split('\n')[0]); }
  }

  const els = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'path', 'defs', 'br', 'symbol', 'g', 'circle'].includes(tag)) return;
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      const ph = el.getAttribute ? (el.getAttribute('placeholder') || '') : '';
      let txt = '';
      if (el.children.length === 0) txt = (el.textContent || '').trim().slice(0, 50);
      const interactive = ['input', 'select', 'textarea', 'button', 'a', 'canvas'].includes(tag) || el.getAttribute('role');
      if (!txt && !ph && !interactive && !cls) return;
      res.push(`${tag}${cls} | x${Math.round(r.x)},y${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} | ${ph ? 'ph=' + ph + ' ' : ''}${txt}`);
    });
    return res;
  });
  fs.writeFileSync(`${BASE}\\outputs\\ui_${TAG}.txt`, els.join('\n'), 'utf8');
  console.log('UI elements:', els.length);
  await page.screenshot({ path: `${BASE}\\outputs\\ui_${TAG}.png` });
  await ctx.close();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
