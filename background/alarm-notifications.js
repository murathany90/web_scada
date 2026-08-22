const WebSCADAAlarmNotifications = (() => {
  let offscreenPromise = null;
  const notify = (id, options) => chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon-128.png', priority: 1, ...options }).catch(() => {});
  async function sound(severity) {
    if (!chrome.offscreen) return false;
    const url = chrome.runtime.getURL('offscreen/alarm-audio.html');
    const contexts = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] }) : [];
    if (!contexts.length) { offscreenPromise ||= chrome.offscreen.createDocument({ url: 'offscreen/alarm-audio.html', reasons: ['AUDIO_PLAYBACK'], justification: 'WebSCADA alarm notification sound' }).catch(() => {}).finally(() => { offscreenPromise = null; }); await offscreenPromise; }
    chrome.runtime.sendMessage({ target: 'offscreen-audio', type: 'PLAY_ALARM_SOUND', severity }).catch(() => {}); return true;
  }
  function activeBadge(count) { chrome.action.setBadgeText({ text: count ? (count > 99 ? '99+' : String(count)) : '' }); if (count) chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); }
  function alarm(rule, entry) { const id = `webscada-alarm:${rule.id}:${entry.entityId}`; notify(id, { title: `WebSCADA — ${rule.severity === 'warning' ? 'Yüklenme' : 'Kritik Yüklenme'}`, message: `${entry.entityName}\nYüklenme %${entry.loadingPct.toFixed(1)} · Limit %${rule.thresholdPct}` }); return id; }
  function summary(count) { notify('webscada-alarm:summary', { title: 'WebSCADA — Çoklu alarm', message: `${count} ekipman alarm eşiğinin üzerinde.` }); }
  return { sound, activeBadge, alarm, summary };
})();
if (typeof module === 'object' && module.exports) module.exports = WebSCADAAlarmNotifications;
