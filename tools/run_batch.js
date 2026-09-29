const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = 'E:\\WorkSpace\\workbuddy\\2026-09-27-17-41-57';
const URL = 'https://webgispro.e6yun.com/map/#/track';

const tasks = JSON.parse(fs.readFileSync(BASE + '\\tools\\tasks.json', 'utf8'));
const RATIO = 16 / 9;
const CHROME = 119;      // header + 底部列表占用的高度
const FILL = 0.92;       // 轨迹占容器的最大比例
const MAXH = 1150;       // 容器高度上限
const SCALE = 2;

const sleep = (p, ms) => p.waitForTimeout(ms);
const merc = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI / 180) / 2));

async function load(page, w, h) {
  await page.evaluate(() => {}).catch(() => {});
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(page, 13000);
}

async function pickVehicle(page, plate) {
  await page.evaluate(() => {
    const inp = document.querySelector('.tack-search-box .el-select.item-r input');
    if (inp) inp.click();
  });
  await sleep(page, 2500);
  const r = await page.evaluate((p) => {
    const d = [...document.querySelectorAll('.el-select-dropdown')]
      .find(x => getComputedStyle(x).display !== 'none' && x.querySelectorAll('.el-select-dropdown__item').length > 50);
    if (!d) return 'NO_DROPDOWN';
    const items = [...d.querySelectorAll('.el-select-dropdown__item')];
    const t = items.find(i => i.textContent.trim() === p) || items.find(i => i.textContent.trim().startsWith(p));
    if (!t) return 'NOT_FOUND';
    t.click();
    return 'OK';
  }, plate);
  await sleep(page, 2000);
  return r;
}

async function setTime(page, start, end) {
  const loc = page.locator('.tack-search-box .el-date-editor.datetime input');
  if (await loc.count() < 2) return 'NO_INPUTS';
  for (const [idx, v] of [[0, start], [1, end]]) {
    const one = loc.nth(idx);
    await one.scrollIntoViewIfNeeded();
    await one.fill('');
    await one.fill(v);
    await page.keyboard.press('Enter');
    await sleep(page, 1500);
  }
  return (await page.evaluate(() => [...document.querySelectorAll('.tack-search-box .el-date-editor.datetime input')].map(i => i.value))).join('|');
}

async function waitTrack(page, timeout = 120000) {
  const t0 = Date.now();
  let last = 0, stable = 0;
  while (Date.now() - t0 < timeout) {
    const n = await page.evaluate(() => { try { return window.maplet.getAllOverlays('polyline').length; } catch (e) { return -1; } });
    if (n > 0 && n === last) { stable++; if (stable >= 2) return n; } else stable = 0;
    last = n;
    await sleep(page, 3000);
  }
  return last;
}

async function getSpan(page) {
  return page.evaluate(() => {
    const m = window.maplet;
    const pls = m.getAllOverlays('polyline');
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90, count = 0;
    for (const p of pls) {
      const path = (p.getPath ? p.getPath() : []) || [];
      for (const pt of path) {
        const lng = pt.lng !== undefined ? pt.lng : pt[0];
        const lat = pt.lat !== undefined ? pt.lat : pt[1];
        if (!isFinite(lng) || !isFinite(lat)) continue;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        count++;
      }
    }
    return { count, minLng, minLat, maxLng, maxLat };
  });
}

function planLayout(span) {
  const spanMerc = Math.abs(merc(span.maxLat) - merc(span.minLat));
  const spanLng = Math.max(span.maxLng - span.minLng, 1e-6);
  let best = null;
  for (let z = 17; z >= 3; z--) {
    const k = 256 * Math.pow(2, z);
    const needW = spanLng * k / 360;
    const needH = spanMerc * k / (2 * Math.PI);
    const H = needH / FILL;
    const W = H * RATIO;
    if (H > MAXH) continue;
    if (needW > W * FILL) continue;
    best = { z, W: Math.round(W), H: Math.round(H), needW: Math.round(needW), needH: Math.round(needH) };
    break;
  }
  if (!best) best = { z: 3, W: 1600, H: 900 };
  const cLat = (2 * Math.atan(Math.exp((merc(span.minLat) + merc(span.maxLat)) / 2)) - Math.PI / 2) * 180 / Math.PI;
  best.cLat = cLat;
  best.cLng = (span.minLng + span.maxLng) / 2;
  return best;
}

async function applyZoom(page, plan) {
  return page.evaluate(async (p) => {
    const m = window.maplet;
    const check = () => {
      const b = m.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
      let inside = 0, outside = 0;
      for (const pl of m.getAllOverlays('polyline')) {
        for (const pt of ((pl.getPath ? pl.getPath() : []) || [])) {
          const lng = pt.lng !== undefined ? pt.lng : pt[0];
          const lat = pt.lat !== undefined ? pt.lat : pt[1];
          if (!isFinite(lng) || !isFinite(lat)) continue;
          if (lng >= sw.lng && lng <= ne.lng && lat >= sw.lat && lat <= ne.lat) inside++; else outside++;
        }
      }
      return { inside, outside };
    };
    let res = null, usedZ = p.z;
    for (let z = p.z; z >= 3; z--) {
      m.setZoomAndCenter(z, [p.cLng, p.cLat]);
      await new Promise(r => setTimeout(r, 1800));
      res = check();
      usedZ = z;
      if (res.outside === 0) break;
    }
    return { zoom: usedZ, realZoom: m.getZoom(), ...res };
  }, plan);
}

async function hideUI(page) {
  return page.evaluate(() => {
    // 只隐藏浮层；header 和底部列表参与布局，隐藏会让画布尺寸错位
    ['.e6yun-sidebar-tool', '.tack-search-box', '.tack-action', '.track-update-link', '.box-layor',
      '.el-dialog__wrapper', '.resizer-mask', '.resizer-drag']
      .forEach(s => document.querySelectorAll(s).forEach(e => e.style.setProperty('display', 'none', 'important')));
    const box = document.querySelector('.map-box') || document.body;
    const keep = 'canvas, .amap-icon, .amap-marker-label, .e6-marker-label';
    let n = 0;
    box.querySelectorAll('*').forEach(el => {
      if (el.tagName.toLowerCase() === 'canvas') return;
      if (el.matches && el.matches(keep)) return;
      if (el.querySelector && el.querySelector(keep)) return;
      if (getComputedStyle(el).display === 'none') return;
      el.style.setProperty('display', 'none', 'important');
      n++;
    });
    return n;
  });
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => /webgispro/.test(p.url())) || ctx.pages()[0];
  const client = await ctx.newCDPSession(page);
  const setVP = (w, h) => client.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });

  for (const t of tasks) {
    console.log('\n===== ' + t.plate + ' =====');
    try {
      // 第一轮：用标准视口查询，拿到轨迹经纬度范围
      await setVP(1920, 1080);
      await sleep(page, 1500);
      await load(page);
      await pickVehicle(page, t.plate);
      await setTime(page, t.start, t.end);
      await page.click('.tack-search-box button.search');
      await waitTrack(page, 120000);
      const span = await getSpan(page);
      const plan = planLayout(span);
      console.log('span:', JSON.stringify({ ...span, count: span.count }), '\nplan:', JSON.stringify(plan));

      // 第二轮：按该轨迹专属的 16:9 画布尺寸重新加载并查询（画布尺寸在初始化时确定）
      await setVP(plan.W, plan.H + CHROME);
      await sleep(page, 1500);
      await load(page);
      await pickVehicle(page, t.plate);
      await setTime(page, t.start, t.end);
      await page.click('.tack-search-box button.search');
      const n = await waitTrack(page, 120000);
      console.log('polylines:', n);

      const fit = await applyZoom(page, plan);
      console.log('fit:', JSON.stringify(fit));
      await sleep(page, 5000);
      await hideUI(page);
      await sleep(page, 2000);

      const dims = await page.evaluate(() => {
        const c = document.querySelector('.amap-container').getBoundingClientRect();
        const cv = document.querySelector('canvas.amap-layer');
        const r = cv ? cv.getBoundingClientRect() : null;
        return { cont: [Math.round(c.width), Math.round(c.height)], canvas: r ? [Math.round(r.width), Math.round(r.height)] : null };
      });
      console.log('dims:', JSON.stringify(dims));

      const box = await page.locator('.amap-container').boundingBox();
      const p = `${BASE}\\outputs\\${t.file}`;
      const { data } = await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: SCALE },
        captureBeyondViewport: true,
      });
      fs.writeFileSync(p, Buffer.from(data, 'base64'));
      console.log('SHOT:', p, `${Math.round(box.width * SCALE)}x${Math.round(box.height * SCALE)}`,
        'ratio', (box.width / box.height).toFixed(3));
    } catch (e) {
      console.log('FAILED:', e.message.split('\n')[0]);
    }
  }
  console.log('\nALL DONE');
  process.exit(0);
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
