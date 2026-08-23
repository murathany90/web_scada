const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('coordinator diagnostic request IDs never expose the measurement payload', async () => {
  const logs = []; global.WebSCADADiagnosticLog = { append: async value => logs.push(value), compactRequestId: () => 'map-short' };
  delete require.cache[require.resolve('../background/request-coordinator.js')]; const coordinator = require('../background/request-coordinator.js');
  await coordinator.create().run({ key: 'SCADA_FETCH:{"ids":["1001","1002","1003"]}', label: 'map' }, async () => ({ ok: true }));
  assert.ok(logs.length >= 2); assert.ok(logs.every(log => log.requestId === 'map-short')); assert.equal(JSON.stringify(logs).includes('1001'), false);
});

test('quota recovery retries the critical active runtime persistence', async () => {
  const data = {}; let quota = true, recovered = 0; global.chrome = { storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])), set: async value => { if (quota) { quota = false; throw Error('Resource::kQuotaBytes quota exceeded'); } Object.assign(data, value); } } } }; global.WebSCADADiagnosticLog = { recoverStorage: async () => { recovered += 1; } }; global.WebSCADAAlarmModel = require('../core/alarm-model.js'); global.WebSCADAAlarmCatalog = require('../core/alarm-catalog.js'); global.WebSCADAAlarmExemptions = require('../core/alarm-exemptions.js'); delete require.cache[require.resolve('../background/alarm-monitor.js')]; const monitor = require('../background/alarm-monitor.js');
  await monitor.persistCritical({ webscadaAlarmRuntime: { 'r:entity': { state: 'ACTIVE' } } }); assert.equal(recovered, 1); assert.equal(data.webscadaAlarmRuntime['r:entity'].state, 'ACTIVE');
});

test('active state is committed before notification and sound side effects', () => {
  const monitor = source('background/alarm-monitor.js'); const committed = monitor.indexOf('ALARM_STATE_COMMITTED'), notification = monitor.indexOf('WebSCADAAlarmNotifications.alarm'), sound = monitor.indexOf('WebSCADAAlarmNotifications.sound'); assert.ok(committed >= 0 && committed < notification && notification < sound); assert.match(monitor, /SOUND_SKIPPED_NOTIFICATION_FAILED/);
});

test('enabled alarm background is automatic and no checkbox is rendered', () => {
  const scheduler = source('background/alarm-scheduler.js'); const html = source('app.html'); assert.match(scheduler, /async function enabled\(\) \{ return true; \}/); assert.doesNotMatch(html, /id="alarmBackgroundEnabled" type="checkbox"/); assert.match(html, /Arka plan: <b>OTOMATİK<\/b>/);
});

test('map network failure retries three times and leaves future scheduler enabled', () => {
  const refresh = source('background/map-refresh.js'); assert.match(refresh, /const RETRY_DELAYS_MS = \[0, 2000, 5000\]/); assert.match(refresh, /MAP_AUTO_RETRY_EXHAUSTED/); assert.match(refresh, /enabled: true, running: false/); assert.match(refresh, /retryable\(type\)/);
});
