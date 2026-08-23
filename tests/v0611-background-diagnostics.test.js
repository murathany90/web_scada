const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('background map result applies the V2 snapshot and refreshes the ranking', () => {
  const runtime = source('map/scada-v2-runtime.js');
  assert.match(runtime, /applyGenericScadaSnapshot\(rows, scope\)/);
  assert.match(runtime, /requestScadaOverlayRender\(\).*updateScadaCardUI\(\).*refreshRankingTable\(\)/s);
  assert.match(runtime, /MAP_BACKGROUND_RESULT_APPLIED/);
});

test('rule-save waits for its first fresh alarm check', () => {
  const worker = source('background/service-worker.js');
  assert.match(worker, /const initialCheck = await WebSCADAAlarmMonitor\.run\('rule-save', \{ forceRuleIds: \[normalized\.id\], forceFresh: true \}\)/);
  assert.doesNotMatch(worker, /WebSCADAAlarmMonitor\.run\('rule-save'[^\n]*\.catch\(\(\) => \{\}\)/);
});

test('alarm scheduler decisions are persisted as diagnostic events', () => {
  const monitor = source('background/alarm-monitor.js');
  assert.match(monitor, /ALARM_DECISION_NOT_DUE/);
  assert.match(monitor, /ALARM_DECISION_OVERLAP/);
  assert.match(monitor, /ALARM_QUERY_START/);
});

test('persistent diagnostic logger redacts secrets and keeps its ring limit', async () => {
  const store = {};
  global.chrome = { storage: { local: { get: async key => ({ [key]: store[key] }), set: async value => Object.assign(store, value) } } };
  const loggerPath = path.join(root, 'core', 'diagnostic-log.js'); delete require.cache[loggerPath]; const logger = require(loggerPath);
  await Promise.all(Array.from({ length: logger.LIMIT + 9 }, (_, index) => logger.append({ event: 'TEST', message: `row-${index}`, token: 'never-store' }))); await logger.flushNow();
  assert.equal(store[logger.KEY].length, logger.LIMIT);
  assert.deepEqual(logger.redact({ password: 'x', nested: { Authorization: 'y' }, message: 'token=never-store' }), { password: '[REDACTED]', nested: { Authorization: '[REDACTED]' }, message: 'token=[REDACTED]' });
});

test('diagnostic CSV exposes the requested export columns and UI action', () => {
  const flow = source('map/scada-flow.js'); const html = source('app.html');
  assert.match(flow, /'Zaman', 'Seviye', 'Kaynak', 'Olay', 'Mesaj', 'Trigger', 'RequestId'/);
  assert.match(flow, /WebSCADA_diagnostic_log_/);
  assert.match(html, /data-scada-btn="logcsv"/);
});
