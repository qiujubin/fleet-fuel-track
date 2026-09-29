const { chromium } = require('playwright-core');
const BASE = 'E:\\WorkSpace\\workbuddy\\2026-09-27-17-41-57';
const argv = process.argv.slice(2).reduce((a, s) => {
  const m = s.match(/^--([^=]+)=(.*)$/);
  if (m) a[m[1]] = m[2]; else a[s.replace(/^--/, '')] = true;
  return a;
}, {});
const W = parseInt(argv.w || '900', 10);
const H = parseInt(argv.h || '1200', 10);
const DSF = parseInt(argv.dsf || '2', 10);
const ZOOM = argv.zoom ? parseInt(argv.zoom, 10) : null;
const OUT = argv.out || 'track.png';
const HIDE = argv.keepui === '1' ? false : true;

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => /webgispro/.test(p.url())) || ctx.pages()[0];
  const client = await ctx.newCDPSession(page);

  // 1. 设置视口（含二倍像素）
  await client.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(4000);

  // 2. 计算轨迹边界并定位
  const info = await page.evaluate((zoomArg) => {
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
    const cLng = (minLng + maxLng) / 2, cLat = (minLat + maxLat) / 2;
    if (zoomArg) m.setZoomAndCenter(zoomArg, [cLng, cLat]);
    return { count, minLng, minLat, maxLng, maxLat, cLng, cLat, zoom: m.getZoom() };
  }, ZOOM);
  console.log('TRACK:', JSON.stringify(info));
  await page.waitForTimeout(6000);

  // 3. 校验轨迹是否完整落在当前视野内
  const check = await page.evaluate(() => {
    const m = window.maplet;
    const b = m.getBounds();
    const sw = b.getSouthWest(), ne = b.getNorthEast();
    const pls = m.getAllOverlays('polyline');
    let inside = 0, outside = 0;
    for (const p of pls) {
      const path = (p.getPath ? p.getPath() : []) || [];
      for (const pt of path) {
        const lng = pt.lng !== undefined ? pt.lng : pt[0];
        const lat = pt.lat !== undefined ? pt.lat : pt[1];
        if (!isFinite(lng) || !isFinite(lat)) continue;
        if (lng >= sw.lng && lng <= ne.lng && lat >= sw.lat && lat <= ne.lat) inside++;
        else outside++;
      }
    }
    return { zoom: m.getZoom(), inside, outside, view: [sw.lng.toFixed(4), sw.lat.toFixed(4), ne.lng.toFixed(4), ne.lat.toFixed(4)] };
  });
  console.log('CHECK:', JSON.stringify(check));

  // 4. 隐藏页面 UI
  if (HIDE) {
    await page.evaluate(() => {
      const sels = ['.e6-header', '.e6yun-sidebar-tool', '.tack-search-box', '.tack-action', '.track-list',
        '.track-update-link', '.box-layor', '.search-input-main', '.searchBox', '.amap-scalecontrol',
        '.amap-logo', '.amap-copyright', '.amap-toolbar', '.amap-controlbar', '.amap-maptype',
        '.el-dialog__wrapper', '.resizer-mask', '.resizer-drag'];
      sels.forEach(s => document.querySelectorAll(s).forEach(e => e.style.setProperty('display', 'none', 'important')));
    });
    await page.waitForTimeout(2500);
  }

  // 5. 截取地图区域（CDP 2 倍高清）
  const p = `${BASE}\\outputs\\${OUT}`;
  const box = await page.locator('.amap-container').boundingBox();
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: DSF },
    captureBeyondViewport: true,
  });
  require('fs').writeFileSync(p, Buffer.from(data, 'base64'));
  console.log('BOX:', JSON.stringify(box));
  console.log('SHOT:', p);

  // 6. 恢复 UI
  await page.evaluate(() => {
    const sels = ['.e6-header', '.e6yun-sidebar-tool', '.tack-search-box', '.tack-action', '.track-list',
      '.track-update-link', '.box-layor', '.search-input-main', '.searchBox', '.amap-scalecontrol',
      '.amap-logo', '.amap-copyright', '.amap-toolbar', '.amap-controlbar', '.amap-maptype'];
    sels.forEach(s => document.querySelectorAll(s).forEach(e => e.style.removeProperty('display')));
  });
  process.exit(0);
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
