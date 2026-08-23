const WebSCADAAlarmNotifications = (() => {
  const STATUS_KEY = 'webscadaNotificationStatus'; let offscreenPromise = null;
  const log = input => globalThis.WebSCADADiagnosticLog?.append?.({ subsystem: 'notification', ...input }).catch(() => {});
  async function permissionLevel() { try { return chrome.notifications.getPermissionLevel ? await chrome.notifications.getPermissionLevel() : 'unknown'; } catch (_error) { return 'unknown'; } }
  async function recordStatus(patch = {}) {
    try { const old = await chrome.storage.local.get(STATUS_KEY); const next = { ...(old[STATUS_KEY] || {}), notificationPermission: await permissionLevel(), ...patch }; await chrome.storage.local.set({ [STATUS_KEY]: next }); return next; }
    catch (error) { log({ event: 'NOTIFICATION_STATUS_STORAGE_FAILED', level: 'warn', message: 'Bildirim durum kaydı yazılamadı.', errorType: /quota/i.test(String(error?.message || error)) ? 'STORAGE_QUOTA' : 'STORAGE_ERROR', result: 'BEST_EFFORT' }); return null; }
  }
  async function notify(id, options) {
    const iconUrl = chrome.runtime.getURL('icons/icon-128.png'); const permission = await permissionLevel(); log({ event: 'NOTIFICATION_PERMISSION_CHECK', message: 'Chrome bildirim izni kontrol edildi.', result: permission });
    if (permission === 'denied') { const error = 'Chrome bildirim izni reddedildi.'; await recordStatus({ lastNotificationAt: new Date().toISOString(), lastNotificationError: error, lastNotificationResult: 'permission-denied', notificationPermission: permission }); log({ event: 'NOTIFICATION_PERMISSION_DENIED', level: 'warn', message: error, result: 'DENIED' }); return { ok: false, id, error, permission }; }
    try {
      await chrome.notifications.create(id, { type: 'basic', iconUrl, priority: 1, ...options });
      void recordStatus({ lastNotificationAt: new Date().toISOString(), lastNotificationError: '', lastNotificationResult: 'ok', notificationPermission: permission });
      log({ event: 'NOTIFICATION_CREATED', message: 'Chrome bildirimi oluşturuldu.', result: 'OK' }); return { ok: true, id, iconUrl, permission };
    } catch (caught) {
      const error = caught?.message || String(caught); void recordStatus({ lastNotificationAt: new Date().toISOString(), lastNotificationError: error, lastNotificationResult: 'error', notificationPermission: permission });
      log({ event: 'NOTIFICATION_FAILED', level: 'warn', message: 'Chrome bildirimi oluşturulamadı.', errorType: 'NOTIFICATION_ERROR', result: 'FAILED' }); return { ok: false, id, error, permission };
    }
  }
  async function sound(severity, overrides = {}) {
    const settings = { ...(await WebSCADASettings.load()), ...overrides }; if (!settings.alarmSoundEnabled) return { ok: true, skipped: 'global-disabled' }; if (!chrome.offscreen) return { ok: false, error: 'Offscreen audio desteklenmiyor.' };
    try {
      const url = chrome.runtime.getURL('offscreen/alarm-audio.html'); const contexts = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] }) : [];
      if (!contexts.length) { offscreenPromise ||= chrome.offscreen.createDocument({ url: 'offscreen/alarm-audio.html', reasons: ['AUDIO_PLAYBACK'], justification: 'WebSCADA packaged alarm sound' }).finally(() => { offscreenPromise = null; }); await offscreenPromise; }
      const soundName = severity === 'warning' ? settings.warningSound : settings.criticalSound; const response = await chrome.runtime.sendMessage({ target: 'offscreen-audio', type: 'PLAY_ALARM_SOUND', severity, soundName, volume: settings.alarmVolume });
      void recordStatus({ lastSoundAt: new Date().toISOString(), lastSoundSeverity: severity, lastSoundError: response?.ok ? '' : response?.error || 'Ses çalınamadı.' });
      if (!response?.ok) { log({ event: 'SOUND_SKIPPED', level: 'warn', message: 'Alarm sesi çalınamadı.', result: 'FAILED' }); return { ok: false, error: response?.error || 'Ses çalınamadı.' }; }
      log({ event: 'SOUND_PLAYED', message: 'Alarm sesi çalındı.', result: 'OK' }); return response;
    } catch (caught) { const error = caught?.message || String(caught); void recordStatus({ lastSoundAt: new Date().toISOString(), lastSoundSeverity: severity, lastSoundError: error }); log({ event: 'SOUND_SKIPPED', level: 'warn', message: 'Alarm sesi çalınamadı.', result: 'FAILED' }); return { ok: false, error }; }
  }
  function activeBadge(count) { chrome.action.setBadgeText({ text: count ? (count > 99 ? '99+' : String(count)) : '' }); if (count) chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); }
  const alarmKey = entry => `${String(entry?.ruleId || '')}:${String(entry?.entityId || '')}`;
  const alarmKeyFromNotificationId = id => { const prefix = 'webscada-alarm:'; const key = String(id || '').startsWith(prefix) ? String(id).slice(prefix.length) : ''; return key && !key.includes('summary') && !key.includes('test') ? key : ''; };
  async function alarm(rule, entry) { const key = alarmKey({ ruleId: rule.id, entityId: entry.entityId }); const id = `webscada-alarm:${key}`; return notify(id, { title: `WebSCADA — ${rule.severity === 'warning' ? 'Uyarı' : 'Kritik alarm'}`, message: `${entry.entityDisplayName || entry.entityName}\nYüklenme %${entry.loadingPct.toFixed(1)} · Limit %${rule.thresholdPct}`, buttons: [{ title: '15 dk sustur' }] }); }
  async function summary(count) { return notify('webscada-alarm:summary', { title: 'WebSCADA — Çoklu alarm', message: `${count} ekipman alarm eşiğinin üzerinde.` }); }
  return { recordStatus, permissionLevel, sound, activeBadge, alarm, alarmKey, alarmKeyFromNotificationId, summary, notify };
})();
if (typeof module === 'object' && module.exports) module.exports = WebSCADAAlarmNotifications;
