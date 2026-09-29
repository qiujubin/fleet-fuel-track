const { chromium } = require('playwright-core');

const BASE = 'E:\\WorkSpace\\workbuddy\\2026-09-27-17-41-57';

(async () => {
  const ctx = await chromium.launchPersistentContext(BASE + '\\tools\\profile', {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://webgispro.e6yun.com/map/#/track', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('WAITING_FOR_LOGIN ...');
  const deadline = Date.now() + 15 * 60 * 1000; // 最多等 15 分钟
  let lastUrl = '';
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const url = page.url();
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('URL:', url);
    }
    if (/webgispro\.e6yun\.com\/map/.test(url) && !/login/.test(url)) {
      console.log('LOGIN_SUCCESS');
      break;
    }
  }

  if (/webgispro\.e6yun\.com\/map/.test(lastUrl)) {
    await page.waitForTimeout(5000);
    await page.screenshot({ path: BASE + '\\outputs\\after_login.png' });
    console.log('after_login screenshot saved');
    // 保持会话：不关闭浏览器，由后续脚本接管；这里先保持进程存活等待关闭指令
    console.log('KEEP_ALIVE');
    // 等 10 分钟供后续排查；实际后续用新脚本连接
    await page.waitForTimeout(10 * 60 * 1000);
  }
  await ctx.close();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
