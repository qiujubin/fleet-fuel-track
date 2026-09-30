/**
 * 易流云轨迹地图截图（快版）
 *
 * 用法:
 *   node trackshot.js                      读 tools/tasks.json，自动起浏览器（未登录会等你登录）
 *   node trackshot.js --close              跑完关闭浏览器（正常关闭可保留登录态）
 *   node trackshot.js --tasks=xx.json      指定任务文件
 *
 * 设计要点（省时间的关键）:
 *   1. 一次大画布查询 + 居中裁剪，取代「先查一遍拿范围、再按尺寸重载查第二遍」
 *   2. 用 waitForFunction 等页面就绪，取代固定 sleep
 *   3. 每辆车只输出一行摘要，不需要人工/DOM 排查
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.cwd();
const OUT = path.join(BASE, 'outputs');           // 输出目录跟随当前工作目录，便于跨项目复用
const PROFILE = path.join(__dirname, 'profile');  // 浏览器配置（含登录态）跟随脚本
const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'https://webgispro.e6yun.com/map/#/track';
const PORT = 9222;

const RATIO = 16 / 9;
// 不对称留白（用户 2026-09-30 定）：车辆/停车/起终点图标都是从定位点向**右上方**伸出的，
// 所以右边和上边多留，左边和下边少留，既不裁掉图标又不浪费画面
const PAD = { left: 0.06, right: 0.12, top: 0.12, bottom: 0.06 };
const FIT = 1 - (PAD.top + PAD.bottom);   // = 0.82，选 zoom 时判断能否装下
// 画布渲染倍率：1 = 与浏览器里看到的像素密度一致（默认，用户偏好）；
// 2 = 2 倍渲染，同样的地理范围但图像更细腻（放大看不糊）。可用 --dpr=2 切换
// 渲染倍率：2 = 先按 2 倍渲染再缩到输出尺寸（缩小不失真，文字更锐利）
const DPR = parseInt((process.argv.find(a => a.startsWith('--dpr=')) || '--dpr=2').split('=')[1], 10);
// 输出画布尺寸（CSS px）。地图按这个尺寸渲染，字号是固定 CSS px，所以画面越小字占比越大。
// 可用 --w=1600 --h=900 覆盖；视口高度 = 画布高 + CHROME(119)
const OUT_W = parseInt((process.argv.find(a => a.startsWith('--w=')) || '--w=1280').split('=')[1], 10);
const OUT_H = parseInt((process.argv.find(a => a.startsWith('--h=')) || '--h=720').split('=')[1], 10);
// 画布尺寸 ≠ 输出尺寸。画布开大一些，高德才能用上更高的 zoom 级别；
// 出图时再缩小到目标宽度（缩小不失真），这样留白再多也不会把底图放大糊掉。
const CANVAS_W = parseInt((process.argv.find(a => a.startsWith('--canvas=')) || '--canvas=2560').split('=')[1], 10);
const VP_W = CANVAS_W, VP_H = Math.round(CANVAS_W * 9 / 16) + 119;  // 119 = 顶部导航+底部列表

const argv = process.argv.slice(2).reduce((a, s) => {
  const m = s.match(/^--([^=]+)=(.*)$/); if (m) a[m[1]] = m[2]; else a[s.replace(/^--/, '')] = true; return a;
}, {});
const tasks = JSON.parse(fs.readFileSync(path.resolve(argv.tasks || 'tasks.json'), 'utf8'));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const merc = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI / 180) / 2));
const t0All = Date.now();
const el = (s) => ((Date.now() - t0All) / 1000).toFixed(1) + 's';

let browser = null, ownBrowser = false;

async function getBrowser() {
  try {
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    console.log('[browser] 复用已运行的实例');
    return { b, own: false };
  } catch (e) {
    console.log('[browser] 启动新实例（未登录会等待）');
    const ctx = await chromium.launchPersistentContext(PROFILE, {
      executablePath: CHROME_EXE,
      headless: false,
      viewport: null,
      args: [`--remote-debugging-port=${PORT}`, '--start-maximized', '--disable-blink-features=AutomationControlled',
        '--no-first-run', '--no-default-browser-check'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    return { b: ctx.browser(), own: true, ctx };
  }
}

async function waitLogin(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 300; i++) {   // 最多等 10 分钟
    const u = page.url();
    if (/webgispro\.e6yun\.com/.test(u) && !/uc\/login|g7e6\.com\.cn/.test(u)) return true;
    if (i === 0) console.log('[login] 请在弹出的浏览器窗口中登录…');
    await page.waitForTimeout(2000);
  }
  return false;
}

// 登录后 G7 默认落在首页，直接进 /map 子系统有时会被路由守卫弹回；先落首页预热再跳转，并重试
async function goTrack(page) {
  for (let i = 0; i < 3; i++) {
    await page.goto('https://webgispro.e6yun.com/#/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForFunction(() => /\/map\/#\/track/.test(location.href), null, { timeout: 20000, polling: 500 });
      return true;
    } catch (e) {
      console.log(`[goto] 第${i + 1}次未进入轨迹页: ${await page.url()}`);
    }
  }
  return false;
}

async function ready(page) {
  // 注意：第二个参数是 arg，选项必须放第三位；polling 用定时器而非 rAF（窗口不可见时 rAF 不触发）
  const fn = () => {
    const i = document.querySelector('.tack-search-box .el-select.item-r input');
    return !!(window.maplet && i);
  };
  try {
    await page.waitForFunction(fn, null, { timeout: 45000, polling: 1000 });
  } catch (e) {
    console.log('[ready] 首次等待超时，刷新重试…', await page.url());
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(fn, null, { timeout: 60000, polling: 1000 });
  }
  await page.waitForTimeout(1500);
}

async function pick(page, plate) {
  await page.evaluate(() => {
    const i = document.querySelector('.tack-search-box .el-select.item-r input');
    if (i) i.click();
  });
  await page.waitForTimeout(1800);
  const r = await page.evaluate((p) => {
    const d = [...document.querySelectorAll('.el-select-dropdown')]
      .find(x => getComputedStyle(x).display !== 'none' && x.querySelectorAll('.el-select-dropdown__item').length > 20);
    if (!d) { const i = document.querySelector('.tack-search-box .el-select.item-r input'); i && i.click(); return 'RETRY'; }
    const items = [...d.querySelectorAll('.el-select-dropdown__item')];
    const t = items.find(x => x.textContent.trim() === p) || items.find(x => x.textContent.trim().startsWith(p));
    if (!t) return 'NOT_FOUND';
    t.click(); return 'OK';
  }, plate);
  if (r === 'RETRY') {
    await page.waitForTimeout(1800);
    return page.evaluate((p) => {
      const d = [...document.querySelectorAll('.el-select-dropdown')]
        .find(x => getComputedStyle(x).display !== 'none' && x.querySelectorAll('.el-select-dropdown__item').length > 20);
      if (!d) return 'NO_DROPDOWN';
      const items = [...d.querySelectorAll('.el-select-dropdown__item')];
      const t = items.find(x => x.textContent.trim() === p) || items.find(x => x.textContent.trim().startsWith(p));
      if (!t) return 'NOT_FOUND';
      t.click(); return 'OK';
    }, plate);
  }
  await page.waitForTimeout(1200);
  return r;
}

async function setTime(page, start, end) {
  const loc = page.locator('.tack-search-box .el-date-editor.datetime input');
  for (const [idx, v] of [[0, start], [1, end]]) {
    const one = loc.nth(idx);
    await one.fill('');
    await one.fill(v);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }
  return page.evaluate(() => [...document.querySelectorAll('.tack-search-box .el-date-editor.datetime input')].map(i => i.value).join('|'));
}

async function waitTrack(page, timeout = 90000) {
  await page.waitForFunction(() => {
    try { return window.maplet.getAllOverlays('polyline').length > 0; } catch (e) { return false; }
  }, null, { timeout, polling: 1000 });
  let last = -1;
  for (let i = 0; i < 12; i++) {
    const n = await page.evaluate(() => window.maplet.getAllOverlays('polyline').length);
    if (n === last) return n;
    last = n;
    await page.waitForTimeout(2000);
  }
  return last;
}

// 读取「最高速度 / 平均速度」。XPath 会随版本变，所以用「指定 XPath + 关键词自动搜索」双保险
const SPEED_XP = [
  '/html/body/div[1]/div/div[2]/div[1]/div/div[2]/div[3]/div[11]/div[1]/div[5]',
];
async function getSpeeds(page) {
  // 最高/平均速度在「速度分析」标签里，需先点开；且该面板会挤压地图布局，
  // 所以必须在截图之后调用（见主流程顺序）
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('body *')]
      .find(e => e.children.length === 0 && (e.textContent || '').trim() === '速度分析');
    if (el) el.click();
  });
  const read = () => page.evaluate(() => {
    const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
    const grab = (label) => {
      let best = '';
      document.querySelectorAll('body *').forEach(el => {
        const t = norm(el.textContent);
        if (!t || t.length > 60 || !t.includes(label)) return;
        if (!/\d/.test(t)) return;
        if (!best || t.length < best.length) best = t;
      });
      return best;
    };
    return { max: grab('最高速度'), avg: grab('平均速度') };
  });
  let r = await read();
  for (let i = 0; i < 4 && !(r.max && r.avg); i++) {   // 数值是异步加载的，最多再等 20s
    await page.waitForTimeout(5000);
    r = await read();
  }
  return r;
}

async function getSpeedsDiag(page) {
  return page.evaluate((xps) => {
    const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
    const out = { byXp: [], hit: [] };
    for (const xp of xps) {
      try {
        const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (r.singleNodeValue) out.byXp.push(norm(r.singleNodeValue.textContent).slice(0, 120));
      } catch (e) { out.byXp.push('XP_ERR'); }
    }
    const seen = new Set();
    document.querySelectorAll('body *').forEach(el => {
      const t = norm(el.textContent);
      if (!t || t.length > 120) return;
      if (/速度|km\/h|km\/H|时速/.test(t) && !seen.has(t)) { seen.add(t); out.hit.push(t); }
    });
    out.hit.sort((a, b) => a.length - b.length);
    out.hit = out.hit.slice(0, 25);
    // 底部/侧边面板整体文本，便于定位统计区
    const panel = document.querySelector('.box-layor') || document.querySelector('.track-list');
    if (panel) out.panel = norm(panel.textContent).slice(0, 500);
    return out;
  }, SPEED_XP);
}

const SPAN_FN = () => {
  const m = window.maplet;
  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90, count = 0;
  for (const p of m.getAllOverlays('polyline')) {
    for (const pt of ((p.getPath ? p.getPath() : []) || [])) {
      const lng = pt.lng !== undefined ? pt.lng : pt[0];
      const lat = pt.lat !== undefined ? pt.lat : pt[1];
      if (!isFinite(lng) || !isFinite(lat)) continue;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      count++;
    }
  }
  return { count, minLng, minLat, maxLng, maxLat };
};

async function fitAndCrop(page) {
  return page.evaluate(async (cfg) => {
    const m = window.maplet;
    const cont = document.querySelector('.amap-container').getBoundingClientRect();
    const span = (() => {
      let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90, count = 0;
      for (const p of m.getAllOverlays('polyline')) {
        for (const pt of ((p.getPath ? p.getPath() : []) || [])) {
          const lng = pt.lng !== undefined ? pt.lng : pt[0];
          const lat = pt.lat !== undefined ? pt.lat : pt[1];
          if (!isFinite(lng) || !isFinite(lat)) continue;
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
          count++;
        }
      }
      return { count, minLng, minLat, maxLng, maxLat };
    })();
    if (!span.count) return { err: 'NO_POINTS' };
    const merc = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI / 180) / 2));
    const spanMerc = Math.abs(merc(span.maxLat) - merc(span.minLat));
    const spanLng = Math.max(span.maxLng - span.minLng, 1e-6);
    const cLat = (2 * Math.atan(Math.exp((merc(span.minLat) + merc(span.maxLat)) / 2)) - Math.PI / 2) * 180 / Math.PI;
    const cLng = (span.minLng + span.maxLng) / 2;

    const need = (z) => ({
      w: spanLng * 256 * Math.pow(2, z) / 360,
      h: spanMerc * 256 * Math.pow(2, z) / (2 * Math.PI),
    });
    const check = () => {
      const b = m.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
      let inside = 0, outside = 0;
      for (const p of m.getAllOverlays('polyline')) {
        for (const pt of ((p.getPath ? p.getPath() : []) || [])) {
          const lng = pt.lng !== undefined ? pt.lng : pt[0];
          const lat = pt.lat !== undefined ? pt.lat : pt[1];
          if (!isFinite(lng) || !isFinite(lat)) continue;
          if (lng >= sw.lng && lng <= ne.lng && lat >= sw.lat && lat <= ne.lat) inside++; else outside++;
        }
      }
      return { inside, outside };
    };

    let z = 3;
    for (let t = 17; t >= 3; t--) {
      const n = need(t);
      if (n.h <= cont.height * cfg.fit && n.w <= cont.width * cfg.fit) { z = t; break; }
    }
    let res = null, crop = null;
    for (let tryZ = z; tryZ >= 3; tryZ--) {
      m.setZoomAndCenter(tryZ, [cLng, cLat]);
      await new Promise(r => setTimeout(r, 1500));
      res = check();
      if (res.outside === 0) {
        // 裁掉四周空白：只留轨迹外框 + 少量边距。
        // 关键：起终点/停车点图标是从定位点向上伸出的（约 40px），只按轨迹经纬度算会把图标切掉，
        // 所以把 marker 的实际像素位置一起并入裁剪框，再统一外扩 2%。
        const n = need(tryZ);
        const trajX0 = cont.width / 2 - n.w / 2, trajY0 = cont.height / 2 - n.h / 2;
        let x0 = trajX0, y0 = trajY0, x1 = trajX0 + n.w, y1 = trajY0 + n.h;
        document.querySelectorAll('.amap-container .amap-marker').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return;
          x0 = Math.min(x0, r.left - cont.left); y0 = Math.min(y0, r.top - cont.top);
          x1 = Math.max(x1, r.right - cont.left); y1 = Math.max(y1, r.bottom - cont.top);
        });
        const bw = x1 - x0, bh = y1 - y0;
        const P = cfg.pad;
        // 按四边各自的留白比例反推裁剪框尺寸（不再居中，而是左/上按指定边距对齐）
        const h = Math.max(bh / (1 - P.top - P.bottom), (bw / (1 - P.left - P.right)) * 9 / 16);
        const w = h * cfg.ratio;
        if (h <= cont.height && w <= cont.width) {   // 装不下就降一级缩放再来，绝不裁掉内容
          crop = {
            w, h,
            x: Math.max(0, Math.min(x0 - P.left * w, cont.width - w)),
            y: Math.max(0, Math.min(y0 - P.top * h, cont.height - h)),
          };
          z = tryZ;
          break;
        }
      }
    }
    return { z, ...res, crop, cont: [cont.width, cont.height], span };
  }, { pad: PAD, fit: FIT, ratio: RATIO });
}

async function hideUI(page) {
  return page.evaluate(() => {
    // 1) 页面浮层 + 地图自带控件/Logo：这些是真 UI，必须隐藏
    ['.e6yun-sidebar-tool', '.tack-search-box', '.tack-action', '.track-update-link', '.box-layor',
      '.el-dialog__wrapper', '.resizer-mask', '.resizer-drag',
      '.amap-logo', '.amap-copyright', '.amap-scalecontrol', '.amap-toolbar', '.amap-controlbar',
      '.amap-maptype', '.amap-geolocation']
      .forEach(s => document.querySelectorAll(s).forEach(e => e.style.setProperty('display', 'none', 'important')));
    // 2) 其余：子树里没有「地图要素」的一律隐藏。
    //    注意 keep 要包含 img/svg —— 车辆图标、起终点、停车点图标都是 marker 里的 img，不能误杀
    const box = document.querySelector('.map-box') || document.body;
    const keep = 'canvas, img, svg, .amap-icon, .amap-marker, .amap-marker-content, .amap-marker-label, .e6-marker-label';
    box.querySelectorAll('*').forEach(e => {
      if (e.matches && e.matches(keep)) return;
      if (e.querySelector && e.querySelector(keep)) return;
      if (getComputedStyle(e).display === 'none') return;
      e.style.setProperty('display', 'none', 'important');
    });
    // 3) 自检：会盖在地图上的 UI 是否都藏住了
    //    （.e6-header / .track-list 故意保留：它们在裁剪区外，且隐藏会让画布尺寸错位）
    const must = ['.tack-search-box', '.tack-action', '.amap-logo', '.amap-copyright',
      '.amap-scalecontrol', '.track-update-link', '.box-layor'];
    const leak = must.filter(s => {
      const e = document.querySelector(s);
      return e && e.getBoundingClientRect().width > 2 && getComputedStyle(e).display !== 'none';
    });
    // 统计保留下来的地图要素，确认车辆图标/停车点/起终点没被误杀
    let markers = 0, icons = 0;
    document.querySelectorAll('.amap-container .amap-marker').forEach(() => markers++);
    document.querySelectorAll('.amap-container img, .amap-container .amap-icon').forEach(() => icons++);
    return JSON.stringify({ leak, markers, icons });
  });
}

(async () => {
  const { b, own } = await getBrowser();
  browser = b; ownBrowser = own;
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => /webgispro/.test(p.url())) || ctx.pages()[0];
  const client = await ctx.newCDPSession(page);
  // deviceScaleFactor=2：让高德按 2 倍渲染画布（底图/地名/轨迹线都是矢量重绘），
  // 而不是 1 倍渲染完再把位图拉大——后者会让地图文字发虚、看起来偏小
  await client.send('Emulation.setDeviceMetricsOverride', { width: VP_W, height: VP_H, deviceScaleFactor: DPR, mobile: false });

  if (!/webgispro\.e6yun\.com\/map/.test(page.url())) {
    const ok = await waitLogin(page);
    if (!ok) { console.log('[login] 登录超时'); process.exit(1); }
    console.log('[login] 已登录', el());
  }
  if (!(await goTrack(page))) {
    console.log('[fatal] 无法进入轨迹页，当前:', await page.url(), '|', await page.title());
    process.exit(1);
  }
  await ready(page);
  console.log('[ready]', el());

  const results = [];
  for (const t of tasks) {
    const s = Date.now();
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await ready(page);
      const v = await pick(page, t.plate);
      await setTime(page, t.start, t.end);
      await page.click('.tack-search-box button.search');
      const n = await waitTrack(page);
      const fit = await fitAndCrop(page);
      const uiLeft = await hideUI(page);
      await page.waitForTimeout(1500);

      const box = await page.locator('.amap-container').boundingBox();
      const c = fit.crop || { x: 0, y: 0, w: box.width, h: box.height };
      const ui = JSON.parse(uiLeft);
      const cv = await page.evaluate(() => {
        const c = document.querySelector('canvas.amap-layer');
        return [c.width, c.height, Math.round(c.getBoundingClientRect().width)];
      });
      const p = path.join(OUT, t.file);
      const { data } = await client.send('Page.captureScreenshot', {
        format: 'png',
        // 输出 = clip宽 × DPR × scale，令其等于目标宽度 OUT_W（2 倍渲染后缩小，文字更锐利）
        clip: { x: box.x + c.x, y: box.y + c.y, width: c.w, height: c.h, scale: OUT_W / (c.w * DPR) },
        captureBeyondViewport: true,
      });
      fs.writeFileSync(p, Buffer.from(data, 'base64'));
      console.log(`${t.plate} OK  ${OUT_W}x${Math.round(OUT_W * c.h / c.w)} ratio=${(c.w / c.h).toFixed(3)} ` +
        `crop=${Math.round(c.w)}x${Math.round(c.h)} ` +
        `zoom=${fit.z} pts=${fit.span ? fit.span.count : '?'} outside=${fit.outside} polylines=${n} ` +
        `ui=${ui.leak.length ? 'LEAK:' + ui.leak.join(',') : 'CLEAN'} markers=${ui.markers} icons=${ui.icons} ` +
        `canvas=${cv[0]}px/${cv[2]}css(${DPR}x) ` +
        `sel=${v} ${((Date.now() - s) / 1000).toFixed(0)}s -> ${t.file}`);
      // 截图完成后再读速度：点开「速度分析」会挤压地图布局，放前面会毁掉截图
      const sp = await getSpeeds(page);
      console.log(`   速度: 最高=${sp.max || '(未取到)'} 平均=${sp.avg || '(未取到)'}`);
      const num = (s) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };
      results.push({
        plate: t.plate, sheet: t.sheet || null, row: t.row || null,
        start: t.start, end: t.end, file: t.file,
        maxSpeed: num(sp.max), avgSpeed: num(sp.avg),
        maxText: sp.max || null, avgText: sp.avg || null,
      });
    } catch (e) {
      console.log(`${t.plate} FAILED ${e.message.split('\n')[0]}`);
    }
  }
  // 结果落盘，供回写 Excel 的脚本直接读取，不用再从日志手抄
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log('[results] -> outputs/results.json');

  console.log('[done] 总耗时', el());
  if (argv.close) {
    try { await b.close(); } catch (e) { }
    console.log('[browser] 已关闭');
  }
  process.exit(0);
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
