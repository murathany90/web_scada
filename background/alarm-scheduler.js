const WebSCADAAlarmScheduler = (() => {
  const NAME = 'webscada-background-monitor';
  const PERIOD = 1;
  const reasonableSchedule = alarm => Number.isFinite(Number(alarm?.scheduledTime)) && Number(alarm.scheduledTime) > Date.now() - (PERIOD * 2 * 60000) && Number(alarm.scheduledTime) < Date.now() + (PERIOD * 5 * 60000);
  async function enabled() { const data = await chrome.storage.local.get(['webscadaAlarmSettings', 'webscadaAlarmRules']); return Boolean(data.webscadaAlarmSettings?.backgroundMonitoringEnabled) && (data.webscadaAlarmRules || []).some(rule => rule.enabled); }
  async function status(alarm) { if (typeof WebSCADAAlarmMonitor === 'undefined') return; await WebSCADAAlarmMonitor.recordWake({ schedulerExists: Boolean(alarm), schedulerPeriodMinutes: Number(alarm?.periodInMinutes || PERIOD), schedulerScheduledTime: alarm?.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : null }); }
  async function ensureBackgroundMonitorAlarm() {
    let alarm = await chrome.alarms.get(NAME);
    if (await enabled()) {
      if (!alarm || Number(alarm.periodInMinutes) !== PERIOD || !reasonableSchedule(alarm)) { if (alarm) await chrome.alarms.clear(NAME); await chrome.alarms.create(NAME, { periodInMinutes: PERIOD }); alarm = await chrome.alarms.get(NAME); }
      await status(alarm); return true;
    }
    if (alarm) await chrome.alarms.clear(NAME);
    await status(null); return false;
  }
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm?.name !== NAME || typeof WebSCADAAlarmMonitor === 'undefined') return; WebSCADAAlarmMonitor.recordWake({ schedulerExists: true, schedulerPeriodMinutes: Number(alarm.periodInMinutes || PERIOD), schedulerScheduledTime: alarm.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : null }).then(() => WebSCADAAlarmMonitor.run('alarm-background')).catch(() => {}); });
  return { NAME, PERIOD, reasonableSchedule, ensureBackgroundMonitorAlarm };
})();
if (typeof module === 'object' && module.exports) module.exports = WebSCADAAlarmScheduler;
