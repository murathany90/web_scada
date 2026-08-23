const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('background V2 apply uses the same generic metric normalizer as manual fetch', () => {
  const runtime = source('map/scada-v2-runtime.js');
  const apply = runtime.slice(runtime.indexOf('async function applyBackgroundMapResult'), runtime.indexOf('function handleDashboardMapSlotActive'));
  assert.match(apply, /SCADA_COMMON\.normalizeMetricRows\(result\.data, \{ elementNames: scope\.elementNames \}\)/);
  assert.doesNotMatch(apply, /normalizeScadaRows\(/);
});

test('zero-match background data is rejected before it can replace the current snapshot', () => {
  const runtime = source('map/scada-v2-runtime.js');
  assert.match(runtime, /previewBackgroundSnapshot\(rows, scope\)/);
  assert.match(runtime, /if \(!preview\.matched && !preview\.available\) return rejectBackgroundMapResult\(scope, 'zero-visible-match'/);
  assert.match(runtime, /MAP_BACKGROUND_APPLY_REJECTED/);
});

test('temporary unavailable data retains a usable V2 flow snapshot', () => {
  const runtime = source('map/scada-v2-runtime.js');
  assert.match(runtime, /if \(isScadaV2RuntimeActive\(\) && hasUsableScadaSnapshot\(\)\) \{[\s\S]*preserveScadaSnapshotOnError/);
  assert.match(runtime, /Yeni veri alınamadı · son başarılı veri/);
});

test('map view uses a fixed header-relative viewport and an in-map sidebar control', () => {
  const appCss = source('app.css'); const mapCss = source('map/map-modern.css'); const html = source('app.html');
  assert.match(appCss, /#webscadaMap\.active \{ position:fixed; top:54px; right:0; bottom:0; left:0; height:auto; min-height:0; overflow:hidden; \}/);
  assert.match(mapCss, /\.sidebar\.collapsed \+ \.sidebar-toggle \{[\s\S]*left: 0/);
  assert.match(html, /<\/aside>\s*<button id="btnToggleSidebar"/);
});
