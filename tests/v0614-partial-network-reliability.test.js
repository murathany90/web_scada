const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('partial network map responses retry failed IDs and preserve last-good IDs only through a safe merge', () => {
  const refresh = source('background/map-refresh.js'); const runtime = source('map/scada-v2-runtime.js');
  assert.match(refresh, /async function retryPartialNetwork/); assert.match(refresh, /measurementIds: failedMeasurementIds/); assert.match(refresh, /forceFresh: true/);
  assert.match(runtime, /MAP_BACKGROUND_PARTIAL_MERGED/); assert.match(runtime, /MAP_BACKGROUND_PARTIAL_REJECTED/); assert.match(runtime, /mergePartialBackgroundRows\(rows, failedIds\)/);
});

test('diagnostic logging buffers normal hot-path events and exposes a controlled flush', () => {
  const logger = source('core/diagnostic-log.js'); const query = source('background/query-service.js');
  assert.match(logger, /DEBOUNCE_MS = 350/); assert.match(logger, /BATCH_SIZE = 16/); assert.match(logger, /setTimeout\([\s\S]*DEBOUNCE_MS/); assert.match(logger, /const flushNow = async/);
  assert.doesNotMatch(query, /const diagnostic = input => await/);
});

test('no-measurements background alarm status remains distinct from a queried cycle', () => {
  const monitor = source('background/alarm-monitor.js');
  assert.match(monitor, /skipped: 'no-measurements'[\s\S]*lastBackgroundDecision: trigger === 'alarm-background' \? 'no-measurements'/);
});

test('legacy alarm background toggle is absent while automatic monitoring remains visible', () => {
  for (const file of ['app.html', 'alarm-view.js', 'background/service-worker.js']) assert.doesNotMatch(source(file), /alarmBackgroundEnabled|ALARM_SET_ENABLED/);
  assert.match(source('app.html'), /Arka plan: <b>OTOMATİK<\/b>/);
});
