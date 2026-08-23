const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const model = require('../core/alarm-model.js'); const catalog = require('../core/alarm-catalog.js'); const exemptions = require('../core/alarm-exemptions.js');
const evaluator = require('../core/alarm-evaluator.js');
function storage(seed = {}) { const data = { ...seed }; return { data, local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])), set: async value => Object.assign(data, value) } }; }
function monitorWith(store) { global.chrome = { storage: { local: store.local } }; global.WebSCADAAlarmModel = model; global.WebSCADAAlarmCatalog = catalog; global.WebSCADAAlarmExemptions = exemptions; delete require.cache[require.resolve('../background/alarm-monitor.js')]; return require('../background/alarm-monitor.js'); }

test('45-second cache reuse never lets five-minute retention skip a due alarm query', async () => {
  const store = storage(); global.chrome = { storage: { local: store.local } }; delete require.cache[require.resolve('../core/live-measurement-cache.js')]; const cache = require('../core/live-measurement-cache.js'); const now = Date.now(); await cache.merge([{ sinsid: 'p', elementName: 'P', __time: new Date(now).toISOString(), maxValue: 10 }], 'latest-current', 'alarm-current', now - 46000); assert.deepEqual((await cache.read(['p'], 'latest-current', { now })).missingIds, ['p']); assert.equal((await cache.read(['p'], 'latest-current', { now, maxAgeMs: cache.CACHE_RETENTION_MS })).reusedIds.length, 1); assert.equal(cache.CACHE_REUSE_MAX_AGE_MS, 45000);
});

test('manual force-fresh run keeps automatic cadence anchors untouched', () => {
  const monitor = monitorWith(storage()); const rule = model.rule({ id: 'five', thresholdPct: 90, checkIntervalMinutes: 5 }); const anchor = 1_000_000; assert.equal(monitor.cadenceCheckAt(rule, anchor, anchor + 300000, anchor + 300000), anchor + 300000); const source = fs.readFileSync(path.join(root, 'background', 'alarm-monitor.js'), 'utf8'); const worker = fs.readFileSync(path.join(root, 'background', 'service-worker.js'), 'utf8'); assert.match(source, /if \(trigger !== 'alarm-manual'\) prepared\.forEach/); assert.match(worker, /forceAll: true, forceFresh: true/);
});

test('latest raw query retries requested IDs missing from the first response exactly once', async () => {
  global.WebSCADALiveMeasurementCache = null; global.chrome = { runtime: { sendMessage: () => ({ catch() {} }) } }; global.WebSCADAAuth = { loadConfig: async () => ({}), invalidateCsrf() {}, directLogin: async () => ({ ok: false }), hiddenTabLogin: async () => ({ ok: false }) }; const calls = []; global.WebSCADAApi = { historyPayload: (_config, payload, ids) => ({ ...payload, measurementIds: ids }), fetchChart: async (_config, request) => { calls.push(request.measurementIds.join(',')); const row = request.measurementIds.length > 1 ? { sinsid: 'a', elementName: 'P', __time: '2026-08-23T10:00:00Z', maxValue: 10 } : { sinsid: 'b', elementName: 'P', __time: '2026-08-23T10:01:00Z', maxValue: 20 }; return { ok: true, data: { result: [{ data: [row] }] } }; } }; delete require.cache[require.resolve('../background/query-service.js')]; const query = require('../background/query-service.js'); const result = await query.executeAlarmCurrentScada({ measurementIds: ['a', 'b'], elementNames: ['P'] }); assert.equal(result.ok, true); assert.deepEqual(calls, ['a,b', 'b']); assert.deepEqual(result.meta.recoveryQueriedIds, ['b']); assert.deepEqual(result.meta.finalMissingIds, []);
});

test('expired lease recovers within three minutes while an old owner cannot clear a new lease', async () => {
  const store = storage({ alarmMonitorLease: { running: true, ownerId: 'dead', expiresAt: Date.now() - 1 } }); const monitor = monitorWith(store); assert.ok(monitor.LEASE_TTL_MS <= 3 * 60000); assert.equal(await monitor.acquire('new'), true); assert.equal(await monitor.release('old'), false); assert.equal(store.data.alarmMonitorLease.ownerId, 'new');
});

test('final missing candidate does not block an available alternative while transport failure preserves unavailable state', () => {
  const now = new Date().toISOString(); const entity = { entityType: 'hat', winterCapacityMva: 100, summerCapacityMva: 100, activeDescriptors: [{ id: 'p-primary' }, { id: 'p-backup' }], reactiveDescriptors: [] }; const outcome = evaluator.evaluate(entity, [{ sinsid: 'p-backup', elementName: 'P', maxValue: 40, __time: now }]); const monitor = monitorWith(storage()); const rule = model.rule({ thresholdPct: 30 }); assert.equal(outcome.loadingPct, 40); assert.equal(monitor.allCandidatesFailed(entity, new Set()), false); assert.equal(monitor.allCandidatesFailed(entity, new Set(['p-primary', 'p-backup'])), true); assert.equal(model.nextState({ state: 'ACTIVE' }, rule, null).state, 'ACTIVE_DATA_UNAVAILABLE');
});

test('partial data and partial network results remain distinct', () => {
  const monitor = monitorWith(storage()); assert.equal(monitor.classifyAlarmResult({}), 'OK'); assert.equal(monitor.classifyAlarmResult({ finalMissingIds: ['missing'] }), 'PARTIAL_DATA'); assert.equal(monitor.classifyAlarmResult({ failedBatches: 1, finalMissingIds: ['missing'] }), 'PARTIAL_NETWORK');
});

test('not-due display retains configured monitoring count and shows its background decision', () => {
  const source = fs.readFileSync(path.join(root, 'background', 'alarm-monitor.js'), 'utf8'); const view = fs.readFileSync(path.join(root, 'alarm-view.js'), 'utf8'); assert.match(source, /configuredMonitoredEntityCount/); assert.match(source, /lastBackgroundDecision: trigger === 'alarm-background' \? 'not-due'/); assert.match(view, /Son değerlendirmede/);
});
