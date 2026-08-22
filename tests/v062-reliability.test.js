const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const model = require('../core/alarm-model.js'); const catalog = require('../core/alarm-catalog.js'); const exemptions = require('../core/alarm-exemptions.js');

test('config revision gate detects an edited rule before an old cycle can commit', async () => {
  const store = { alarmConfigRevision: 4 }; global.chrome = { storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key]])), set: async value => Object.assign(store, value) } } }; global.WebSCADAAlarmModel = model; global.WebSCADAAlarmCatalog = catalog; global.WebSCADAAlarmExemptions = exemptions;
  delete require.cache[require.resolve('../background/alarm-monitor.js')]; const monitor = require('../background/alarm-monitor.js'); assert.equal(await monitor.configChanged(4), false); store.alarmConfigRevision = 5; assert.equal(await monitor.configChanged(4), true); assert.match(fs.readFileSync(path.join(root, 'background', 'alarm-monitor.js'), 'utf8'), /configChanged\(revision\).*discarded/);
});

test('filtered group type remains explicit and never mixes Hat, Trafo or Bara', () => {
  const entries = ['hat', 'trafo', 'bara'].map(type => ({ entityId: type, entityType: type, entityName: type, ytm: ['Y'], bm: ['B'], tm: 'TM', kv: '154', activeDescriptors: [], reactiveDescriptors: [] }));
  ['hat', 'trafo', 'bara'].forEach(type => assert.deepEqual(catalog.resolve({ scopeType: 'filter', filters: { type, ytm: 'Y' } }, entries).map(entity => entity.entityType), [type])); assert.deepEqual(catalog.resolve({ scopeType: 'filter', filters: { ytm: 'Y' } }, entries).map(entity => entity.entityType), ['hat']);
});

test('default TEMELLİ-BAYMİNA exclusions use canonical IDs and can be removed', () => {
  const entries = exemptions.DEFAULT_HAT_NAMES.map((entityName, index) => ({ entityId: String(index + 1), entityType: 'hat', entityName, entityDisplayName: entityName })); const seeded = exemptions.seed([], false, entries); assert.equal(seeded.exemptions.length, 3); assert.equal(exemptions.filter(entries, seeded.exemptions).length, 0); const removed = seeded.exemptions.filter(entry => entry.entityId !== '1'); assert.deepEqual(exemptions.filter(entries, removed).map(entry => entry.entityId), ['1']);
});

test('NO_DATA to NORMAL is silent while unavailable active alarms may clear', () => {
  const rule = { thresholdPct: 90, hysteresisPct: 2, repeatMinutes: 0 }; const noData = model.nextState({}, rule, null, 1); const normal = model.nextState(noData, rule, 20, 2); assert.equal(noData.state, 'NO_DATA'); assert.equal(normal.state, 'NORMAL'); assert.equal(normal.changed, false); const active = model.nextState({}, rule, 95, 3); const unavailable = model.nextState(active, rule, null, 4); const cleared = model.nextState(unavailable, rule, 20, 5); assert.equal(cleared.changed, true); assert.equal(cleared.state, 'NORMAL');
});

test('only real scheduler wakes update lastSchedulerWakeAt', async () => {
  const store = {}; global.chrome = { storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key]])), set: async value => Object.assign(store, value) } } }; global.WebSCADAAlarmModel = model; global.WebSCADAAlarmCatalog = catalog; global.WebSCADAAlarmExemptions = exemptions; delete require.cache[require.resolve('../background/alarm-monitor.js')]; const monitor = require('../background/alarm-monitor.js'); await monitor.recordSchedulerInfo({ schedulerExists: true, schedulerPeriodMinutes: 1 }); assert.equal(store.webscadaBackgroundMonitorStatus.lastSchedulerWakeAt, undefined); await monitor.recordSchedulerWake({ schedulerExists: true, schedulerPeriodMinutes: 1, schedulerDelayMs: 12 }); assert.ok(store.webscadaBackgroundMonitorStatus.lastSchedulerWakeAt); assert.equal(store.webscadaBackgroundMonitorStatus.schedulerDelayMs, 12);
});
