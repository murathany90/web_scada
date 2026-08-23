const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const settings = require('../core/webscada-settings.js');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('map viewport uses its header-relative container instead of inner 100vh heights', () => {
  const appCss = source('app.css'); const mapCss = source('map/map-modern.css');
  assert.match(appCss, /#webscadaMap\.active \{ position:fixed; top:54px; right:0; bottom:0; left:0; height:auto; min-height:0; overflow:hidden; \}/);
  assert.match(mapCss, /\.layout \{[\s\S]*height: 100%;[\s\S]*min-height: 0/);
  assert.match(mapCss, /\.map-viewport \{[\s\S]*height: 100%;[\s\S]*min-height: 0/);
  assert.doesNotMatch(mapCss, /height: 100vh/);
});

test('auto refresh defaults to three minutes and Chrome alarm starts on the next whole minute', () => {
  const refresh = source('background/map-refresh.js');
  assert.equal(settings.DEFAULTS.autoRefreshMinutes, 3);
  assert.equal(settings.normalize({ autoRefreshMinutes: 3 }).autoRefreshMinutes, 3);
  assert.match(refresh, /nextWholeMinute = now => \(Math\.floor\(Number\(now \|\| Date\.now\(\)\) \/ 60000\) \+ 1\) \* 60000/);
  assert.match(refresh, /when: nextWholeMinute\(Date\.now\(\)\), periodInMinutes: settings\.autoRefreshMinutes/);
});

test('map status reads Chrome alarm scheduledTime instead of a page estimate', () => {
  const refresh = source('background/map-refresh.js'); const runtime = source('map/scada-v2-runtime.js');
  assert.match(refresh, /chrome\.alarms\.get\(NAME\)/);
  assert.match(refresh, /nextScheduledAt: Number\(alarm\?\.scheduledTime\) \|\| null/);
  assert.match(runtime, /backgroundRefreshStatus/);
  assert.doesNotMatch(refresh, /nextExpectedAt/);
});

test('hat voltage history has dedicated bara metadata and terminal-aware labels', () => {
  const runtime = source('map/scada-v2-runtime.js');
  assert.match(runtime, /function buildHatVoltageMeasurementMeta\(voltageMetrics, entity\)/);
  assert.match(runtime, /s\.label = metadata\.label/);
  assert.match(runtime, /formatScadaTerminalLabel\(\{ terminals, label: '' \}\)/);
  assert.match(runtime, /Gerilim`/);
});

test('multiple terminal baras retain a deterministic non-transfer voltage candidate and network retry stays single', () => {
  const runtime = source('map/scada-v2-runtime.js'); const query = source('background/query-service.js');
  assert.match(runtime, /\.filter\(\(b\) => !isTransferBaraForVoltagePanel\(b\)\)/);
  assert.match(runtime, /tm-kv-deterministic/);
  assert.match(query, /if \(retryableNetworkFailure\(batchResult\)\)/);
  assert.match(query, /await wait\(1000\)/);
});
