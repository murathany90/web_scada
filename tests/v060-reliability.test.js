const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const settings = require('../core/webscada-settings.js'); const catalog = require('../core/alarm-catalog.js');
const duration = file => { const b = fs.readFileSync(file); assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WAVE'); let at = 12, rate = 0, length = 0, format = 0; while (at + 8 <= b.length) { const kind = b.toString('ascii', at, at + 4), size = b.readInt32LE(at + 4); if (kind === 'fmt ') { format = b.readInt16LE(at + 8); rate = b.readInt32LE(at + 16); } if (kind === 'data') { length = size; break; } at += 8 + size + size % 2; } assert.equal(format, 1); return length / rate; };

test('alarm sounds have separate warning/critical choices and valid 5-10 second PCM WAV assets', () => {
  assert.equal(settings.DEFAULTS.warningSound, 'warning_02_double_beep.wav'); assert.equal(settings.DEFAULTS.criticalSound, 'critical_01_dualtone.wav'); assert.equal(settings.WARNING_SOUNDS.length, 3); assert.equal(settings.CRITICAL_SOUNDS.length, 3);
  [...settings.WARNING_SOUNDS, ...settings.CRITICAL_SOUNDS].forEach(file => { const seconds = duration(path.join(root, 'docs', 'WebSCADA_6_Alarm_Sesi_8sn', file)); assert.ok(seconds >= 5 && seconds <= 10, `${file}: ${seconds}`); });
});

test('notification uses extension icon URL and surfaces create failures', async () => {
  const store = {}; global.chrome = { runtime: { getURL: file => `chrome-extension://id/${file}` }, storage: { local: { get: async key => ({ [key]: store[key] }), set: async value => Object.assign(store, value) } }, notifications: { getPermissionLevel: async () => 'granted', create: async (_id, options) => { assert.equal(options.iconUrl, 'chrome-extension://id/icons/icon-128.png'); throw Error('icon failed'); } }, action: { setBadgeText() {}, setBadgeBackgroundColor() {} } };
  delete require.cache[require.resolve('../background/alarm-notifications.js')]; const notifications = require('../background/alarm-notifications.js'); await assert.rejects(() => notifications.notify('x', { title: 'x', message: 'x' }), /icon failed/); assert.match(store.webscadaNotificationStatus.lastNotificationError, /icon failed/);
});

test('all-hats applies exact YTM membership and never leaks another YTM', () => {
  const entries = [{ entityId: 'orta', entityType: 'hat', ytm: ['Orta Anadolu YTM'], bm: ['A'], tm: 'TM A', kv: '154', activeDescriptors: [], reactiveDescriptors: [] }, { entityId: 'diger', entityType: 'hat', ytm: ['Diger YTM'], bm: ['A'], tm: 'TM A', kv: '154', activeDescriptors: [], reactiveDescriptors: [] }];
  assert.deepEqual(catalog.resolve({ scopeType: 'all-hats', filters: { ytm: 'Orta Anadolu YTM' } }, entries).map(x => x.entityId), ['orta']);
});

test('settings keep v060 defaults and normalise persisted values', () => {
  assert.deepEqual(settings.normalize({}), settings.DEFAULTS); const saved = settings.normalize({ autoRefreshMinutes: 99, capacitySeason: 'summer', alarmVolume: 140, warningSound: 'wrong.wav' }); assert.equal(saved.autoRefreshMinutes, 3); assert.equal(saved.capacitySeason, 'summer'); assert.equal(saved.alarmVolume, 100); assert.equal(saved.warningSound, settings.DEFAULTS.warningSound);
});

test('alarm edit UI restores severity and all rule filters while previewing candidates', () => {
  const source = fs.readFileSync(path.join(root, 'alarm-view.js'), 'utf8'); ['alarmSeverity', "rule.filters?.ytm", "rule.filters?.bm", "rule.filters?.tm", "rule.filters?.kv", 'alarmEditCancel', 'alarmRuleCopy', 'renderRulePreview'].forEach(value => assert.ok(source.includes(value), value));
});

test('map auto refresh is worker-owned and package verifies settings, sounds and icon runtime files', () => {
  const map = fs.readFileSync(path.join(root, 'map', 'scada-v2-runtime.js'), 'utf8'); const worker = fs.readFileSync(path.join(root, 'background', 'map-refresh.js'), 'utf8'); const build = fs.readFileSync(path.join(root, 'scripts', 'build-extension.ps1'), 'utf8'); assert.match(worker, /webscada-map-auto-refresh/); assert.match(worker, /priority: 4/); assert.match(map, /MAP_REFRESH_CONTEXT/); assert.doesNotMatch(map, /document\.addEventListener\('visibilitychange'/); ['settings-view.js', 'Assert-PcmWav', 'sounds/alarm/', 'icons/icon-128.png'].forEach(value => assert.ok(build.includes(value), value));
});

test('runtime reconciliation removes deleted, disabled and out-of-scope alarm entries', () => {
  global.WebSCADAAlarmModel = require('../core/alarm-model.js'); global.WebSCADAAlarmCatalog = catalog;
  delete require.cache[require.resolve('../background/alarm-monitor.js')]; const monitor = require('../background/alarm-monitor.js');
  const entries = [{ entityId: 'hat-1', entityType: 'hat', ytm: [], bm: [], tm: 'TM', kv: '154', activeDescriptors: [], reactiveDescriptors: [] }, { entityId: 'hat-2', entityType: 'hat', ytm: [], bm: [], tm: 'TM', kv: '154', activeDescriptors: [], reactiveDescriptors: [] }];
  const rules = [{ id: 'kept', enabled: true, scopeType: 'selected', entityIds: ['hat-1'], filters: {} }, { id: 'disabled', enabled: false, scopeType: 'selected', entityIds: ['hat-2'], filters: {} }];
  const result = monitor.reconcileAlarmRuntime(rules, { 'kept:hat-1': { ruleId: 'kept', entityId: 'hat-1', state: 'ACTIVE' }, 'kept:hat-2': { ruleId: 'kept', entityId: 'hat-2', state: 'ACTIVE' }, 'disabled:hat-2': { ruleId: 'disabled', entityId: 'hat-2', state: 'ACTIVE' }, 'deleted:hat-1': { ruleId: 'deleted', entityId: 'hat-1', state: 'ACTIVE' } }, { kept: 1, disabled: 2, deleted: 3 }, entries);
  assert.deepEqual(Object.keys(result.runtime), ['kept:hat-1']); assert.deepEqual(result.checks, { kept: 1 });
});

test('trafo catalog creates a detailed display label without changing the canonical name', () => {
  const [entry] = catalog.build({ trafos: [{ id: 'tr-a', kind: 'trafo', name: 'TR-A', tmName: 'A TM', kv: 154, gerilimTuru: 'Dağıtım', scada: { active: { rows: [] }, reactive: { rows: [] } } }] });
  assert.equal(entry.entityName, 'TR-A'); assert.equal(entry.entityDisplayName, 'A TM >> 154 kV >> Dağıtım >> TR-A');
});

test('sound delivery is selected independently from Chrome notifications', () => {
  const source = fs.readFileSync(path.join(root, 'background', 'alarm-monitor.js'), 'utf8');
  assert.match(source, /const wantsSound = next\.alertDue && rule\.soundEnabled && globalSettings\.alarmSoundEnabled/); assert.doesNotMatch(source, /notifications && soundSeverity/);
});

test('scheduler self-heals stale alarms and a not-due wake finalizes status', async () => {
  const store = {}; let alarm = { name: 'webscada-background-monitor', periodInMinutes: 5, scheduledTime: Date.now() - 999999 }; const listeners = [];
  global.chrome = { storage: { local: { get: async keys => Array.isArray(keys) ? Object.fromEntries(keys.map(key => [key, store[key]])) : { [keys]: store[keys] }, set: async value => Object.assign(store, value) } }, alarms: { get: async () => alarm, clear: async () => { alarm = null; return true; }, create: async (_name, value) => { alarm = { name: 'webscada-background-monitor', ...value, scheduledTime: Date.now() + 60000 }; }, onAlarm: { addListener: listener => listeners.push(listener) } } };
  global.WebSCADAAlarmModel = require('../core/alarm-model.js'); global.WebSCADAAlarmCatalog = catalog; delete require.cache[require.resolve('../background/alarm-monitor.js')]; const monitor = require('../background/alarm-monitor.js'); const status = await monitor.finalizeCycleStatus({ running: true }, Date.now(), 'alarm-background', { skipped: 'not-due' }); assert.equal(status.running, false); assert.equal(status.lastSkippedReason, 'not-due'); assert.ok(status.lastBackgroundCompletedAt);
  store.webscadaAlarmSettings = { backgroundMonitoringEnabled: true }; store.webscadaAlarmRules = [{ enabled: true }]; global.WebSCADAAlarmMonitor = { recordWake: async () => {}, run: async () => ({ ok: true, skipped: 'not-due' }) }; delete require.cache[require.resolve('../background/alarm-scheduler.js')]; const scheduler = require('../background/alarm-scheduler.js'); await scheduler.ensureBackgroundMonitorAlarm(); assert.equal(alarm.periodInMinutes, 1); assert.equal(listeners.length, 1);
});
