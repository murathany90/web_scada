const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('production runtime and package have no mock SCADA path', () => {
  const production = ['app.html', 'map/map-modern.js', 'map/scada-client.js', 'map/scada-flow.js', 'map/scada-v2-runtime.js'].map(source).join('\n');
  ['scadaFetchMock', 'MOCK_ENABLED', 'MOCK_DATA_PATH', 'btnScadaMock', 'data-scada-btn="mock"'].forEach(token => assert.equal(production.includes(token), false, token));
  const build = source('scripts/build-extension.ps1'); assert.match(build, /mockTokens/); assert.match(build, /runtime mock belirteci/);
});

test('individual notification carries a 15-minute snooze button and maps only real alarm keys', async () => {
  const store = {}; let created; global.chrome = { runtime: { getURL: value => value }, storage: { local: { get: async key => ({ [key]: store[key] }), set: async value => Object.assign(store, value) } }, notifications: { getPermissionLevel: async () => 'granted', create: async (id, options) => { created = { id, options }; } }, action: { setBadgeText() {}, setBadgeBackgroundColor() {} } }; delete require.cache[require.resolve('../background/alarm-notifications.js')]; const notices = require('../background/alarm-notifications.js'); await notices.alarm({ id: 'rule', severity: 'warning' }, { entityId: 'entity', entityName: 'Hat', loadingPct: 91, thresholdPct: 90 }); assert.equal(created.id, 'webscada-alarm:rule:entity'); assert.deepEqual(created.options.buttons, [{ title: '15 dk sustur' }]); assert.equal(notices.alarmKeyFromNotificationId(created.id), 'rule:entity'); assert.equal(notices.alarmKeyFromNotificationId('webscada-alarm:summary'), ''); const worker = source('background/service-worker.js'); assert.match(worker, /notifications\.onButtonClicked/); assert.match(worker, /type: 'ALARM_SNOOZE'/);
});

test('ACK and snooze render from persisted runtime state', () => {
  const view = source('alarm-view.js'); const model = require('../core/alarm-model.js'); const until = model.snooze({}, 15, 1000); assert.equal(until.snoozedUntil, 901000); assert.equal(until.snoozeReminderAt, 901000); ['✓ ACK', 'is-acknowledged', 'Susturuldu · ${remaining} dk', 'is-snoozed', 'aria-pressed'].forEach(token => assert.ok(view.includes(token), token));
});

test('shared map status covers live loading error and historical state while panel state persists', () => {
  const map = source('map/map-modern.js'); const html = source('app.html'); const runtime = source('map/scada-v2-runtime.js'); ['CANLI · Veri', 'SORGULANIYOR', 'BEKLİYOR · Superset kuyruğu', 'HATA ·', 'GEÇMİŞ ·', 'panelOpen', 'updateSharedMapStatus'].forEach(token => assert.ok(map.includes(token), token)); assert.match(runtime, /autoRefreshMinutes = settings\.autoRefreshMinutes/); assert.match(html, /data-map-panel="layers" open/); assert.match(html, /data-map-panel="hat-display"/); assert.match(html, /data-map-panel="bara-set"/); assert.match(html, /id="webscadaStatus"/);
});
