const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = 'E:\\WorkSpace\\workbuddy\\2026-09-27-17-41-57';
const argv = process.argv.slice(2).reduce((a, s) => {
  const m = s.match(/^--([^=]+)=(.*)$/);
  if (m) a[m[1]] = m[2]; else a[s.replace(/^--/, '')] = true;
  return a;
}, {});
const TAG = argv.tag || 'cdp';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => /webgispro/.test(p.url())) || ctx.pages()[0];
  console.log('CONNECTED url=', page.url());

  if (argv.goto) { await page.goto(argv.goto, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(6000); }
  if (argv.wait) await page.waitForTimeout(parseInt(argv.wait, 10));

  if (argv.click) {
    for (const sel of argv.click.split(';;')) {
      console.log('CLICK:', sel);
      try { await page.click(sel, { timeout: 8000 }); }
      catch (e) { console.log('  failed:', e.message.split('\n')[0]); }
      await page.waitForTimeout(parseInt(argv.postwait || '2000', 10));
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
        if (argv.enter !== 'no') await page.keyboard.press('Enter');
      } catch (e) { console.log('  failed:', e.message.split('\n')[0]); }
      await page.waitForTimeout(2500);
    }
  }
  if (argv.evaljs) {
    try {
      const r = await page.evaluate(new Function('return (' + argv.evaljs + ')()'));
      console.log('EVAL:', typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e) { console.log('eval failed:', e.message.split('\n')[0]); }
  }
  if (argv.shot) {
    const p = `${BASE}\\outputs\\${argv.shot}`;
    if (argv.sel) await page.locator(argv.sel).screenshot({ path: p });
    else await page.screenshot({ path: p });
    console.log('SHOT:', p);
  }

  const els = await page.evaluate((onlySel) => {
    const root = onlySel ? document.querySelector(onlySel) : document.body;
    if (!root) return ['ROOT_NOT_FOUND'];
    const res = [];
    root.querySelectorAll('*').forEach(el => {
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
      if (el.children.length === 0) txt = (el.textContent || '').trim().slice(0, 60);
      const interactive = ['input', 'select', 'textarea', 'button', 'a', 'canvas'].includes(tag) || el.getAttribute('role');
      if (!txt && !ph && !interactive && !cls) return;
      res.push(`${tag}${cls} | x${Math.round(r.x)},y${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} | ${ph ? 'ph=' + ph + ' ' : ''}${txt}`);
    });
    return res;
  }, argv.root || '');
  fs.writeFileSync(`${BASE}\\outputs\\ui_${TAG}.txt`, els.join('\n'), 'utf8');
  console.log('UI elements:', els.length);
  console.log('URL:', page.url());
  // 不断开浏览器
  process.exit(0);
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
