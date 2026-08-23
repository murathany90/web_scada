const WebSCADAAlarmNotifications = (() => {
  const STATUS_KEY = 'webscadaNotificationStatus'; let offscreenPromise = null;
  async function diagnostic(patch = {}) { const old = await chrome.storage.local.get(STATUS_KEY); const permission = chrome.notifications.getPermissionLevel ? await chrome.notifications.getPermissionLevel() : 'unknown'; const next = { ...(old[STATUS_KEY] || {}), notificationPermission: permission, ...patch }; await chrome.storage.local.set({ [STATUS_KEY]: next }); return next; }
  async function notify(id, options) {
    const iconUrl = chrome.runtime.getURL('icons/icon-128.png');
    try { await chrome.notifications.create(id, { type: 'basic', iconUrl, priority: 1, ...options }); await diagnostic({ lastNotificationAt: new Date().toISOString(), lastNotificationError: '', lastNotificationResult: 'ok' }); return { ok: true, id, iconUrl }; }
    catch (error) { await diagnostic({ lastNotificationAt: new Date().toISOString(), lastNotificationError: error.message || String(error), lastNotificationResult: 'error' }); throw error; }
  }
  async function sound(severity, overrides = {}) {
    const settings = { ...(await WebSCADASettings.load()), ...overrides }; if (!settings.alarmSoundEnabled) return { ok: true, skipped: 'global-disabled' }; if (!chrome.offscreen) throw new Error('Offscreen audio desteklenmiyor.');
    const url = chrome.runtime.getURL('offscreen/alarm-audio.html'); const contexts = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] }) : [];
    if (!contexts.length) { offscreenPromise ||= chrome.offscreen.createDocument({ url: 'offscreen/alarm-audio.html', reasons: ['AUDIO_PLAYBACK'], justification: 'WebSCADA packaged alarm sound' }).finally(() => { offscreenPromise = null; }); await offscreenPromise; }
    const soundName = severity === 'warning' ? settings.warningSound : settings.criticalSound; const response = await chrome.runtime.sendMessage({ target: 'offscreen-audio', type: 'PLAY_ALARM_SOUND', severity, soundName, volume: settings.alarmVolume }); await diagnostic({ lastSoundAt: new Date().toISOString(), lastSoundSeverity: severity, lastSoundError: response?.ok ? '' : response?.error || 'Ses çalınamadı.' }); if (!response?.ok) throw new Error(response?.error || 'Ses çalınamadı.'); return response;
  }
  function activeBadge(count) { chrome.action.setBadgeText({ text: count ? (count > 99 ? '99+' : String(count)) : '' }); if (count) chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); }
  const alarmKey = entry => `${String(entry?.ruleId || '')}:${String(entry?.entityId || '')}`;
  const alarmKeyFromNotificationId = id => { const prefix = 'webscada-alarm:'; const key = String(id || '').startsWith(prefix) ? String(id).slice(prefix.length) : ''; return key && !key.includes('summary') && !key.includes('test') ? key : ''; };
  async function alarm(rule, entry) { const key = alarmKey({ ruleId: rule.id, entityId: entry.entityId }); const id = `webscada-alarm:${key}`; return notify(id, { title: `WebSCADA — ${rule.severity === 'warning' ? 'Uyarı' : 'Kritik alarm'}`, message: `${entry.entityDisplayName || entry.entityName}\nYüklenme %${entry.loadingPct.toFixed(1)} · Limit %${rule.thresholdPct}`, buttons: [{ title: '15 dk sustur' }] }); }
  async function summary(count) { return notify('webscada-alarm:summary', { title: 'WebSCADA — Çoklu alarm', message: `${count} ekipman alarm eşiğinin üzerinde.` }); }
  return { diagnostic, sound, activeBadge, alarm, alarmKey, alarmKeyFromNotificationId, summary, notify };
})();
if (typeof module === 'object' && module.exports) module.exports = WebSCADAAlarmNotifications;
