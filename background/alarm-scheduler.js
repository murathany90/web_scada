const WebSCADAAlarmScheduler = (() => {
  const NAME = 'webscada-background-monitor';
  async function enabled() { const data = await chrome.storage.local.get(['webscadaAlarmSettings', 'webscadaAlarmRules']); return Boolean(data.webscadaAlarmSettings?.backgroundMonitoringEnabled) && (data.webscadaAlarmRules || []).some(rule => rule.enabled); }
  async function ensureBackgroundMonitorAlarm() { const exists = await chrome.alarms.get(NAME); if (await enabled()) { if (!exists) await chrome.alarms.create(NAME, { periodInMinutes: 1 }); return true; } if (exists) await chrome.alarms.clear(NAME); return false; }
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm?.name === NAME) WebSCADAAlarmMonitor.run('alarm-background'); });
  return { NAME, ensureBackgroundMonitorAlarm };
})();
if (typeof module === 'object' && module.exports) module.exports = WebSCADAAlarmScheduler;
