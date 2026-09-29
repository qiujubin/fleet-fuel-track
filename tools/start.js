const { chromium } = require('playwright-core');
const BASE = 'E:\\WorkSpace\\workbuddy\\2026-09-27-17-41-57';
const PORT = 9222;

(async () => {
  const ctx = await chromium.launchPersistentContext(BASE + '\\tools\\profile', {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    viewport: null,
    args: [
      `--remote-debugging-port=${PORT}`,
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://webgispro.e6yun.com/map/#/track', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('WAITING_FOR_LOGIN');
  const deadline = Date.now() + 20 * 60 * 1000;
  let ok = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const url = page.url();
    if (/webgispro\.e6yun\.com/.test(url) && !/uc\/login|g7e6\.com\.cn/.test(url)) { ok = true; break; }
  }
  if (!ok) { console.log('LOGIN_TIMEOUT'); await ctx.close(); process.exit(1); }
  console.log('LOGIN_OK');
  // 登录后跳到轨迹页
  if (!/\/map\/#\/track/.test(page.url())) {
    await page.goto('https://webgispro.e6yun.com/map/#/track', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
  }
  console.log('READY url=', page.url());
  // 保持进程常驻，供后续 CDP 脚本操作
  await new Promise(() => {});
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
