const WebSCADAMapRefresh = (() => {
  const NAME = 'webscada-map-auto-refresh'; const CONTEXT = 'scadaBackgroundRefreshState'; const RESULT = 'webscadaBackgroundMapResult'; const STATUS = 'webscadaBackgroundMapStatus';
  const errorType = error => /timeout|zaman aşımı/i.test(String(error?.message || error)) ? 'timeout' : /auth|oturum|401|403/i.test(String(error?.message || error)) ? 'auth' : 'network';
  async function state() { const data = await chrome.storage.local.get([CONTEXT, STATUS]); return { context: data[CONTEXT] || {}, status: data[STATUS] || {} }; }
  async function ensure() { const { context } = await state(); const settings = await WebSCADASettings.load(); const enabled = settings.autoRefreshEnabled && context.enabled !== false && Array.isArray(context.payload?.measurementIds) && context.payload.measurementIds.length; const exists = await chrome.alarms.get(NAME); if (enabled) { if (!exists || Number(exists.periodInMinutes) !== settings.autoRefreshMinutes) { if (exists) await chrome.alarms.clear(NAME); await chrome.alarms.create(NAME, { periodInMinutes: settings.autoRefreshMinutes }); } } else if (exists) await chrome.alarms.clear(NAME); return Boolean(enabled); }
  async function setContext(value = {}) { const prior = (await state()).context; const context = { ...prior, ...value, enabled: value.enabled !== false, updatedAt: Date.now() }; await chrome.storage.local.set({ [CONTEXT]: context }); await ensure(); return context; }
  async function run(trigger = 'map-background') {
    const { context, status: old } = await state(); const settings = await WebSCADASettings.load(); const startedAt = new Date().toISOString();
    if (!settings.autoRefreshEnabled || context.enabled === false || !context.payload?.measurementIds?.length) return { ok: true, skipped: 'disabled' };
    await chrome.storage.local.set({ [STATUS]: { ...old, enabled: true, running: true, lastStartedAt: startedAt, lastTrigger: trigger, lastError: '' } });
    try {
      const payload = { ...context.payload, triggerType: 'auto-background' };
      const result = await WebSCADARequestCoordinator.run({ key: WebSCADARequestCoordinator.requestKey('SCADA_FETCH', payload), coalesceKey: 'map-auto-refresh', priority: 4, label: 'Harita arka plan yenileme' }, () => WebSCADAQuery.executeLiveScada(payload));
      if (!result?.ok) throw Object.assign(new Error(result?.error || 'SCADA arka plan sorgusu başarısız.'), { type: result?.errorType });
      const completedAt = new Date().toISOString(); const resultEntry = { at: Date.now(), completedAt, scope: context.scope, data: result.data, transport: { authMode: result.authMode, httpStatus: result.httpStatus, meta: result.meta } };
      await chrome.storage.local.set({ [RESULT]: resultEntry, [STATUS]: { enabled: true, running: false, lastStartedAt: startedAt, lastCompletedAt: completedAt, lastTrigger: trigger, lastDurationMs: Date.now() - new Date(startedAt).getTime(), lastError: '', lastErrorType: '', nextExpectedAt: new Date(Date.now() + settings.autoRefreshMinutes * 60000).toISOString() } });
      return { ok: true, result: resultEntry };
    } catch (error) { const completedAt = new Date().toISOString(); const type = error.type || errorType(error); await chrome.storage.local.set({ [STATUS]: { ...old, enabled: true, running: false, lastStartedAt: startedAt, lastCompletedAt: completedAt, lastTrigger: trigger, lastError: error.message || String(error), lastErrorType: type, nextExpectedAt: new Date(Date.now() + settings.autoRefreshMinutes * 60000).toISOString() } }); return { ok: false, error: error.message || String(error), errorType: type };
    }
  }
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm?.name === NAME) void run('map-background'); });
  return { NAME, CONTEXT, RESULT, STATUS, ensure, setContext, run };
})();
