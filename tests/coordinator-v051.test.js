const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const coordinatorApi = require('../background/request-coordinator.js');
const model = require('../core/alarm-model.js');
const evaluator = require('../core/alarm-evaluator.js');
global.WebSCADARequestCoordinator = coordinatorApi;
const monitor = require('../background/alarm-monitor.js');

const deferred = () => { let resolve; let reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('coordinator permits only one executor and promotes alarm before queued history', async () => {
  const coordinator = coordinatorApi.create(); const live = deferred(), alarm = deferred(), history = deferred(); const started = [];
  const one = coordinator.run({ key: 'live', priority: 4, label: 'Live' }, () => { started.push('live'); return live.promise; });
  const two = coordinator.run({ key: 'history', priority: 2, label: 'History' }, () => { started.push('history'); return history.promise; });
  const three = coordinator.run({ key: 'alarm', priority: 1, label: 'Alarm' }, () => { started.push('alarm'); return alarm.promise; }); await tick(); assert.deepEqual(started, ['live']);
  live.resolve('live'); await tick(); assert.deepEqual(started, ['live', 'alarm']); alarm.resolve('alarm'); await tick(); assert.deepEqual(started, ['live', 'alarm', 'history']); history.resolve('history'); assert.deepEqual(await Promise.all([one, two, three]), ['live', 'history', 'alarm']);
});

test('coordinator coalesces pending auto refresh and continues after a failed job', async () => {
  const coordinator = coordinatorApi.create(); const first = deferred(); let oldAutoRuns = 0, latestAutoRuns = 0; const failed = coordinator.run({ key: 'failed', priority: 3 }, () => Promise.reject(Error('network'))).catch(error => error.message); const autoOne = coordinator.run({ key: 'map-auto-old', coalesceKey: 'map-auto', priority: 4 }, () => { oldAutoRuns++; return first.promise; }); const autoTwo = coordinator.run({ key: 'map-auto-latest', coalesceKey: 'map-auto', priority: 4 }, () => { latestAutoRuns++; return Promise.resolve('latest'); }); await tick(); assert.equal(autoOne, autoTwo); assert.equal(await failed, 'network'); await tick(); assert.equal(await autoOne, 'latest'); assert.equal(oldAutoRuns, 0); assert.equal(latestAutoRuns, 1);
});

test('alarm check intervals make only due rules eligible at 1, 2 and 5 minutes', () => {
  const rules = [model.rule({ id: 'a', thresholdPct: 90, checkIntervalMinutes: 1 }), model.rule({ id: 'b', thresholdPct: 90, checkIntervalMinutes: 2 }), model.rule({ id: 'c', thresholdPct: 90, checkIntervalMinutes: 5 })]; const due = (now, checks) => monitor.dueRules(rules, checks, {}, now).map(rule => rule.id);
  const start = 1_000_000; assert.deepEqual(due(start, {}), ['a', 'b', 'c']); const checks = { a: start, b: start, c: start }; assert.deepEqual(due(start + 60_000, checks), ['a']); assert.deepEqual(due(start + 120_000, checks), ['a', 'b']); assert.deepEqual(due(start + 300_000, checks), ['a', 'b', 'c']);
});

test('fresh snapshots fully reuse 100 IDs and query planning receives only 10 missing IDs from 100', () => {
  const ids = Array.from({ length: 100 }, (_, index) => `id-${index}`); const fresh = { at: Date.now(), rows: ids.map(sinsid => ({ sinsid, elementName: 'P', 'MAX(__time)': new Date().toISOString(), 'AVG(maxValue)': 1 })) };
  const full = monitor.snapshotRows(fresh, ids); assert.equal(full.reusedIds.length, 100); assert.equal(full.missingIds.length, 0);
  fresh.rows.splice(90); const partial = monitor.snapshotRows(fresh, ids); assert.equal(partial.reusedIds.length, 90); assert.deepEqual(partial.missingIds, ids.slice(90));
});

test('alarm loading keeps terminal candidates separated and mirrors trafo primary loading', () => {
  const at = new Date().toISOString(); const hat = { entityType: 'hat', winterCapacityMva: 100, summerCapacityMva: 100, activeDescriptors: [{ id: 'p-primary', candidateSlot: 'primary', formulaSign: 1 }, { id: 'p-other', candidateSlot: 'secondary', formulaSign: 1 }], reactiveDescriptors: [{ id: 'q-primary', candidateSlot: 'primary', formulaSign: 1 }, { id: 'q-other', candidateSlot: 'secondary', formulaSign: 1 }] }; const rows = [{ sinsid: 'p-primary', elementName: 'P', 'AVG(maxValue)': 60, 'MAX(__time)': at }, { sinsid: 'p-other', elementName: 'P', 'AVG(maxValue)': 99, 'MAX(__time)': at }, { sinsid: 'q-primary', elementName: 'Q', 'AVG(maxValue)': 80, 'MAX(__time)': at }, { sinsid: 'q-other', elementName: 'Q', 'AVG(maxValue)': 1, 'MAX(__time)': at }]; assert.equal(evaluator.evaluate(hat, rows).loadingPct, 100);
  const trafo = { ...hat, entityType: 'trafo', activeDescriptors: [{ id: 'p-primary', formulaSign: 1 }], reactiveDescriptors: [{ id: 'q-primary', formulaSign: 1 }] }; assert.equal(evaluator.evaluate(trafo, rows).loadingPct, 60);
});

test('alarm UI exposes Hat/Trafo scopes and passes real type to map/query actions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'alarm-view.js'), 'utf8'); const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8'); const worker = fs.readFileSync(path.join(__dirname, '..', 'background', 'service-worker.js'), 'utf8');
  assert.match(html, /single-trafo/); assert.match(html, /multi-trafos/); assert.match(html, /alarmCheckInterval/); assert.match(source, /button\.dataset\.kind === 'trafo'/); assert.match(source, /data-query/); assert.ok(!source.includes("WebSCADASelection.select({ id: button.dataset.map, kind: 'hat' })")); assert.match(worker, /WebSCADARequestCoordinator\.run/);
});
