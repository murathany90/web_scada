importScripts('../core/ytbs-hierarchy.js', '../core/alarm-model.js', '../core/alarm-catalog.js', '../core/alarm-evaluator.js', 'request-coordinator.js', 'superset-auth.js', 'superset-api.js', 'query-service.js', 'alarm-notifications.js', 'alarm-monitor.js', 'alarm-scheduler.js');

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }));

async function alarmState() { const data = await chrome.storage.local.get([WebSCADAAlarmMonitor.KEYS.settings, WebSCADAAlarmMonitor.KEYS.rules, WebSCADAAlarmMonitor.KEYS.runtime, WebSCADAAlarmMonitor.KEYS.events, WebSCADAAlarmMonitor.KEYS.cycles, WebSCADAAlarmMonitor.KEYS.samples, WebSCADAAlarmMonitor.KEYS.status]); return { ok: true, settings: data[WebSCADAAlarmMonitor.KEYS.settings] || { backgroundMonitoringEnabled: false }, rules: data[WebSCADAAlarmMonitor.KEYS.rules] || [], runtime: data[WebSCADAAlarmMonitor.KEYS.runtime] || {}, events: data[WebSCADAAlarmMonitor.KEYS.events] || [], cycles: data[WebSCADAAlarmMonitor.KEYS.cycles] || [], samples: data[WebSCADAAlarmMonitor.KEYS.samples] || {}, status: data[WebSCADAAlarmMonitor.KEYS.status] || { enabled: false }, coordinator: WebSCADARequestCoordinator.state() }; }
async function alarmMessage(message) {
  const keys = WebSCADAAlarmMonitor.KEYS; const payload = message.payload || {};
  if (message.type === 'ALARM_GET_STATE' || message.type === 'ALARM_GET_HISTORY') return alarmState();
  if (message.type === 'ALARM_SET_ENABLED') { const old = await chrome.storage.local.get(keys.settings); await chrome.storage.local.set({ [keys.settings]: { ...(old[keys.settings] || {}), backgroundMonitoringEnabled: Boolean(payload.enabled) } }); await WebSCADAAlarmScheduler.ensureBackgroundMonitorAlarm(); return alarmState(); }
  if (message.type === 'ALARM_SAVE_RULE') { const all = await WebSCADAAlarmMonitor.catalog(); const normalized = WebSCADAAlarmModel.rule(payload); const entities = WebSCADAAlarmCatalog.resolve(normalized, all).filter(x => x.winterCapacityMva || x.summerCapacityMva).filter(x => x.activeDescriptors.length || x.reactiveDescriptors.length); const error = WebSCADAAlarmModel.validate(normalized, entities.length); if (error) return { ok: false, error }; const old = await chrome.storage.local.get(keys.rules); const rules = old[keys.rules] || []; const index = rules.findIndex(rule => rule.id === normalized.id); if (index >= 0) rules[index] = normalized; else rules.push(normalized); await chrome.storage.local.set({ [keys.rules]: rules }); await WebSCADAAlarmScheduler.ensureBackgroundMonitorAlarm(); WebSCADAAlarmMonitor.run('rule-save', { forceRuleIds: [normalized.id] }).catch(() => {}); return alarmState(); }
  if (message.type === 'ALARM_DELETE_RULE') { const old = await chrome.storage.local.get(keys.rules); await chrome.storage.local.set({ [keys.rules]: (old[keys.rules] || []).filter(rule => rule.id !== String(payload.id)) }); await WebSCADAAlarmScheduler.ensureBackgroundMonitorAlarm(); return alarmState(); }
  if (message.type === 'ALARM_ACK' || message.type === 'ALARM_SNOOZE') { const old = await chrome.storage.local.get(keys.runtime); const runtime = old[keys.runtime] || {}; const entry = runtime[String(payload.key)]; if (!entry) return { ok: false, error: 'Alarm bulunamadı.' }; if (message.type === 'ALARM_ACK') entry.acknowledgedAt = Date.now(); else entry.snoozedUntil = Date.now() + Math.max(1, Number(payload.minutes || 15)) * 60000; runtime[String(payload.key)] = entry; await chrome.storage.local.set({ [keys.runtime]: runtime }); return alarmState(); }
  if (message.type === 'ALARM_RUN_NOW') return WebSCADAAlarmMonitor.run('alarm-manual');
  if (message.type === 'ALARM_TEST_NOTIFICATION') { await chrome.notifications.create('webscada-alarm:test', { type: 'basic', iconUrl: 'icons/icon-128.png', title: 'WebSCADA — Test bildirimi', message: 'Bildirim hattı çalışıyor.' }); return { ok: true }; }
  if (message.type === 'ALARM_TEST_SOUND') { await WebSCADAAlarmNotifications.sound('warning'); return { ok: true }; }
  if (message.type === 'ALARM_SYNC_CATALOG') return { ok: await WebSCADAAlarmMonitor.syncCatalog(payload.catalog) };
  if (message.type === 'ALARM_RECORD_REFRESH_SUMMARY') { const old = await chrome.storage.local.get(keys.cycles); const entry = { id: `${Date.now()}`, source: payload.source || 'map-manual', startedAt: payload.startedAt || new Date().toISOString(), completedAt: payload.completedAt || new Date().toISOString(), durationMs: Number(payload.durationMs || 0), ruleCount: 0, monitoredEntityCount: Number(payload.entityCount || 0), measurementIdCount: Number(payload.measurementIdCount || 0), returnedRowCount: Number(payload.returnedRowCount || 0), activeAlarmCount: 0, error: payload.error || '' }; await chrome.storage.local.set({ [keys.cycles]: WebSCADAAlarmModel.append(old[keys.cycles], entry, WebSCADAAlarmModel.LIMITS.cycles) }); return { ok: true }; }
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (String(message?.type || '').startsWith('ALARM_')) { alarmMessage(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message || String(error) })); return true; }
  const handlers = { SCADA_FETCH: WebSCADAQuery.executeLiveScada, SCADA_HISTORY_FETCH: WebSCADAQuery.executeHistorySeries, SCADA_HISTORICAL_SNAPSHOT_FETCH: WebSCADAQuery.executeHistoricalSnapshot, WEBSCADA_QUERY: WebSCADAQuery.executeWorkspaceQuery };
  if (handlers[message?.type]) {
    const payload = message.payload || {}; const type = message.type; const key = WebSCADARequestCoordinator.requestKey(type, payload); const priority = WebSCADARequestCoordinator.priorityFor(type, payload);
    WebSCADARequestCoordinator.run({ key, priority, coalesceKey: type === 'SCADA_FETCH' && priority === 4 ? 'map-auto-refresh' : '', label: type === 'SCADA_FETCH' ? (priority === 4 ? 'Harita otomatik yenileme' : 'Harita yenileme') : type === 'WEBSCADA_QUERY' ? 'Manuel sorgu' : 'Geçmiş sorgu' }, () => handlers[type](payload)).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || String(error), errorType: 'BACKGROUND_ERROR', authMode: 'none', usedFallback: false }));
    return true;
  }
  if (message?.type === 'WEBSCADA_STATUS') {
    WebSCADAAuth.loadConfig().then(async (config) => sendResponse({ ok: true, session: await WebSCADAAuth.ensureSession(config), baseUrl: config.baseUrl })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  return false;
});

chrome.notifications.onClicked.addListener((notificationId) => { if (!notificationId.startsWith('webscada-alarm:')) return; chrome.storage.local.set({ webscadaAlarmUiFocus: { tab: 'alarms', notificationId } }); chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); });
chrome.runtime.onInstalled.addListener(() => WebSCADAAlarmScheduler.ensureBackgroundMonitorAlarm());
chrome.runtime.onStartup.addListener(() => WebSCADAAlarmScheduler.ensureBackgroundMonitorAlarm());
WebSCADAAlarmScheduler.ensureBackgroundMonitorAlarm();
