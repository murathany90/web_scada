const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const model = require('../core/alarm-model.js'); const catalog = require('../core/alarm-catalog.js'); const exemptions = require('../core/alarm-exemptions.js');

test('legacy rules without severity normalize to warning and only explicit critical stays critical', () => {
  assert.equal(model.rule({ thresholdPct: 90 }).severity, 'warning'); assert.equal(model.rule({ thresholdPct: 90, severity: 'critical' }).severity, 'critical'); assert.equal(model.rule({ thresholdPct: 90, severity: 'warning' }).severity, 'warning');
});

test('Bara stays eligible for exemptions but never resolves as an alarm filter type', () => {
  const entries = [{ entityId: 'hat', entityType: 'hat', ytm: [], bm: [], tm: '', kv: '', activeDescriptors: [] }, { entityId: 'bara', entityType: 'bara', ytm: [], bm: [], tm: '', kv: '', activeDescriptors: [] }]; assert.deepEqual(catalog.resolve({ scopeType: 'filter', filters: { type: 'bara' } }, entries).map(entry => entry.entityType), []); assert.equal(exemptions.normalize([{ entityId: 'bara', entityType: 'bara', displayLabel: 'B1' }]).length, 1); const view = fs.readFileSync(path.join(root, 'alarm-view.js'), 'utf8'); assert.ok(view.includes(`querySelector('option[value="bara"]')?.remove()`));
});

test('scheduler diagnostics store the freshly read next scheduler time', async () => {
  const store = {}; global.chrome = { storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key]])), set: async value => Object.assign(store, value) } } }; global.WebSCADAAlarmModel = model; global.WebSCADAAlarmCatalog = catalog; global.WebSCADAAlarmExemptions = exemptions; delete require.cache[require.resolve('../background/alarm-monitor.js')]; const monitor = require('../background/alarm-monitor.js'); await monitor.recordSchedulerWake({ schedulerScheduledTime: '2026-08-23T12:00:00.000Z', nextSchedulerAt: '2026-08-23T12:01:00.000Z' }); assert.equal(store.webscadaBackgroundMonitorStatus.nextSchedulerAt, '2026-08-23T12:01:00.000Z'); assert.match(fs.readFileSync(path.join(root, 'background', 'alarm-scheduler.js'), 'utf8'), /chrome\.alarms\.get\(NAME\).*nextSchedulerAt/s);
});

test('alarm CSV includes rule, rule ID and source fields', () => {
  const view = fs.readFileSync(path.join(root, 'alarm-view.js'), 'utf8'); ['Kural:', 'KuralID:', 'Kaynak:', 'event.ruleName', 'event.ruleId', 'event.trigger'].forEach(value => assert.ok(view.includes(value), value));
});
