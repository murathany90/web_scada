const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../core/alarm-model.js');
const catalogApi = require('../core/alarm-catalog.js');
const evaluator = require('../core/alarm-evaluator.js');

const entity = (id, type = 'hat') => ({ entityId: id, entityName: id, entityType: type, ytm: ['YTM'], bm: ['BM'], tm: 'TM', kv: '154', winterCapacityMva: 100, summerCapacityMva: 80, activeDescriptors: [{ id: `${id}-p`, metric: 'P', formulaSign: 1 }], reactiveDescriptors: [{ id: `${id}-q`, metric: 'Q', formulaSign: 1 }] });
const rows = (id, p, q, at = new Date().toISOString()) => [{ sinsid: `${id}-p`, elementName: 'P', 'AVG(maxValue)': p, 'MAX(__time)': at }, { sinsid: `${id}-q`, elementName: 'Q', 'AVG(maxValue)': q, 'MAX(__time)': at }];

test('alarm loading parity uses apparent P/Q magnitude and seasonal capacity', () => {
  const e = entity('hat-1'); const result = evaluator.evaluate(e, rows('hat-1', 60, 80), 'winter');
  assert.equal(result.loadingPct, 100); assert.equal(result.capacityMva, 100);
  assert.equal(evaluator.evaluate(e, rows('hat-1', 60, 80), 'summer').loadingPct, 125);
});

test('alarm evaluator keeps map-compatible Q-only fallback and invalid data separate', () => {
  const e = entity('hat-1'); assert.equal(evaluator.evaluate(e, [{ sinsid: 'hat-1-q', elementName: 'Q', 'AVG(maxValue)': 50, 'MAX(__time)': new Date().toISOString() }]).loadingPct, 50);
  assert.equal(evaluator.evaluate(e, [], 'winter').loadingPct, null);
  assert.equal(evaluator.evaluate(e, rows('hat-1', 50, 0, '2020-01-01T00:00:00Z')).loadingPct, null);
});

test('hysteresis, acknowledgement and unavailable data never false-clear an active alarm', () => {
  const rule = { thresholdPct: 90, hysteresisPct: 2, repeatMinutes: 0 }; const active = model.nextState({}, rule, 90, 1);
  assert.equal(active.state, 'ACTIVE'); assert.equal(model.nextState(active, rule, 89, 2).state, 'ACTIVE'); assert.equal(model.nextState(active, rule, 87.9, 3).state, 'NORMAL');
  const unavailable = model.nextState(active, rule, null, 4); assert.equal(unavailable.state, 'ACTIVE_DATA_UNAVAILABLE'); assert.equal(unavailable.notify, false);
});

test('alarm rule validation rejects unsafe threshold, hysteresis and empty scope', () => {
  assert.match(model.validate({ thresholdPct: 0, hysteresisPct: 0 }, 1), /Eşik/);
  assert.match(model.validate({ thresholdPct: 90, hysteresisPct: 91 }, 1), /Histerezis/);
  assert.match(model.validate({ thresholdPct: 90, hysteresisPct: 2 }, 0), /izlenebilir/);
});

test('catalog scope resolution and measurement planning deduplicate shared IDs', () => {
  const catalog = [entity('a'), { ...entity('b'), activeDescriptors: [{ id: 'a-p', metric: 'P' }] }];
  const selected = model.rule({ scopeType: 'selected', entityIds: ['a'], thresholdPct: 90 }); const all = model.rule({ scopeType: 'all-hats', thresholdPct: 95 });
  assert.equal(catalogApi.resolve(selected, catalog).length, 1); assert.equal(catalogApi.resolve(all, catalog).length, 2);
  assert.deepEqual(catalogApi.ids(catalog).sort(), ['a-p', 'a-q', 'b-q']);
});

test('catalog preserves raw topology Hat and Trafo collections without a synthetic kind field', () => {
  const built = catalogApi.build({ hatLines: [{ id: 'h', scada: {} }], trafos: [{ id: 't', scada: {} }] });
  assert.deepEqual(built.map(item => item.entityType), ['hat', 'trafo']);
});

test('scheduler uses one persisted Chrome alarm and never a page interval', async () => {
  const state = { webscadaAlarmSettings: { backgroundMonitoringEnabled: false }, webscadaAlarmRules: [] }; const alarms = new Map();
  global.chrome = { storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, state[key]])), set: async value => Object.assign(state, value) } }, alarms: { get: async name => alarms.get(name), create: async (name, info) => alarms.set(name, { name, ...info }), clear: async name => alarms.delete(name), onAlarm: { addListener() {} } } };
  delete require.cache[require.resolve('../background/alarm-scheduler.js')]; const scheduler = require('../background/alarm-scheduler.js');
  assert.equal(await scheduler.ensureBackgroundMonitorAlarm(), false); assert.equal(alarms.size, 0);
  state.webscadaAlarmSettings.backgroundMonitoringEnabled = true; state.webscadaAlarmRules = [{ enabled: true }]; assert.equal(await scheduler.ensureBackgroundMonitorAlarm(), true); assert.deepEqual(alarms.get(scheduler.NAME), { name: scheduler.NAME, periodInMinutes: 1 });
  const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'alarm-scheduler.js'), 'utf8'); assert.doesNotMatch(source, /setInterval/);
});

test('alarm runtime includes offscreen audio, compact history and no credential storage fields', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'alarm-monitor.js'), 'utf8'); const worker = fs.readFileSync(path.join(__dirname, '..', 'background', 'service-worker.js'), 'utf8'); const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
  assert.match(worker, /ALARM_RUN_NOW/); assert.match(worker, /onStartup/); assert.match(source, /webscadaMonitorCycles/); assert.match(source, /function acquire/); assert.match(source, /WebSCADAAlarmModel\.LIMITS\.events/); assert.ok(!/password|username|csrf/i.test(source)); assert.match(html, /data-webscada-tab="alarms"/); assert.ok(fs.existsSync(path.join(__dirname, '..', 'offscreen', 'alarm-audio.html')));
});

test('alarm UI binds controls before catalog loading and exposes explicit action feedback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'alarm-view.js'), 'utf8');
  assert.ok(source.indexOf('bind(); bindFeedbackActions();') < source.indexOf('await loadCatalog()'));
  assert.match(source, /Alarm kataloğu yüklenemedi/);
  assert.match(source, /Kaydediliyor…/);
  assert.match(source, /Kural kaydedildi\./);
  assert.match(source, /Test bildirimi gönderildi\./);
  assert.match(source, /Test sesi çalındı\./);
});
