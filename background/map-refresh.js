const WebSCADAMapRefresh = (() => {
  const NAME = 'webscada-map-auto-refresh'; const CONTEXT = 'scadaBackgroundRefreshState'; const RESULT = 'webscadaBackgroundMapResult'; const STATUS = 'webscadaBackgroundMapStatus';
  const errorType = error => /timeout|zaman aşımı/i.test(String(error?.message || error)) ? 'timeout' : /auth|oturum|401|403/i.test(String(error?.message || error)) ? 'auth' : 'network';
  const diagnostic = input => globalThis.WebSCADADiagnosticLog?.append?.({ subsystem: 'map', ...input }).catch(() => {});
  const resultRows = result => Array.isArray(result?.data?.result) ? result.data.result.reduce((count, item) => count + (Array.isArray(item?.data) ? item.data.length : 0), 0) : 0;
  const nextWholeMinute = now => (Math.floor(Number(now || Date.now()) / 60000) + 1) * 60000;
  async function state() { const data = await chrome.storage.local.get([CONTEXT, STATUS]); return { context: data[CONTEXT] || {}, status: data[STATUS] || {} }; }
  async function currentSchedule(periodMinutes) { const alarm = await chrome.alarms.get(NAME); return { nextScheduledAt: Number(alarm?.scheduledTime) || null, periodMinutes: Number(alarm?.periodInMinutes || periodMinutes) || null }; }
  async function storeStatus(patch = {}, periodMinutes) { const { status } = await state(); const schedule = await currentSchedule(periodMinutes); const next = { ...status, ...patch, ...schedule }; await chrome.storage.local.set({ [STATUS]: next }); chrome.runtime.sendMessage({ type: 'MAP_REFRESH_STATUS_UPDATED', payload: next }).catch(() => {}); return next; }
  async function ensure() {
    const { context } = await state(); const settings = await WebSCADASettings.load(); const enabled = settings.autoRefreshEnabled && context.enabled !== false && Array.isArray(context.payload?.measurementIds) && context.payload.measurementIds.length; const exists = await chrome.alarms.get(NAME);
    if (enabled) {
      if (!exists || Number(exists.periodInMinutes) !== settings.autoRefreshMinutes) {
        if (exists) await chrome.alarms.clear(NAME);
        await chrome.alarms.create(NAME, { when: nextWholeMinute(Date.now()), periodInMinutes: settings.autoRefreshMinutes });
      }
    } else if (exists) await chrome.alarms.clear(NAME);
    await storeStatus({ enabled: Boolean(enabled), running: false }, settings.autoRefreshMinutes);
    return Boolean(enabled);
  }
  async function setContext(value = {}) { const prior = (await state()).context; const context = { ...prior, ...value, enabled: value.enabled !== false, updatedAt: Date.now() }; await chrome.storage.local.set({ [CONTEXT]: context }); await ensure(); return context; }
  async function run(trigger = 'map-background', wake = {}) {
    const { context, status: old } = await state(); const settings = await WebSCADASettings.load(); const startedAt = new Date().toISOString();
    if (!settings.autoRefreshEnabled || context.enabled === false || !context.payload?.measurementIds?.length) return { ok: true, skipped: 'disabled' };
    if (wake.at) await diagnostic({ event: 'MAP_SCHEDULER_WAKE', message: 'Harita otomatik yenileme scheduler uyandı.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, measurementCount: context.payload.measurementIds.length });
    await storeStatus({ ...old, enabled: true, running: true, lastStartedAt: startedAt, lastSchedulerWakeAt: wake.at || old.lastSchedulerWakeAt || null, lastTrigger: trigger, lastError: '' }, settings.autoRefreshMinutes);
    try {
      const payload = { ...context.payload, triggerType: 'auto-background', liveCacheSemantics: 'map-aggregate' };
      await diagnostic({ event: 'MAP_AUTO_QUERY_START', message: 'Harita arka plan sorgusu başladı.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, entityCount: context.scope?.entityCount || context.scope?.entities?.length || 0, measurementCount: payload.measurementIds.length });
      const result = await WebSCADARequestCoordinator.run({ key: WebSCADARequestCoordinator.requestKey('SCADA_FETCH', payload), coalesceKey: 'map-auto-refresh', priority: 4, label: 'Harita arka plan yenileme' }, () => WebSCADAQuery.executeLiveScada(payload));
      if (!result?.ok) throw Object.assign(new Error(result?.error || 'SCADA arka plan sorgusu başarısız.'), { type: result?.errorType });
      const completedAt = new Date().toISOString(); const rows = resultRows(result); const meta = result.meta || {}; const durationMs = Date.now() - new Date(startedAt).getTime(); const resultEntry = { at: Date.now(), completedAt, scope: context.scope, data: result.data, transport: { authMode: result.authMode, httpStatus: result.httpStatus, meta } };
      await chrome.storage.local.set({ [RESULT]: resultEntry });
      await diagnostic({ event: 'MAP_AUTO_QUERY_END', message: 'Harita arka plan sorgusu tamamlandı.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, entityCount: context.scope?.entityCount || context.scope?.entities?.length || 0, measurementCount: payload.measurementIds.length, batchIndex: meta.completedBatches, totalBatches: meta.totalBatches, cacheCount: meta.cacheReuseCount, networkCount: meta.networkMeasurementIdCount, returnedRows: rows, durationMs, result: meta.resultKind || 'OK', authMode: result.authMode });
      await diagnostic({ event: 'MAP_BACKGROUND_RESULT_STORED', message: 'Harita arka plan sonucu kalıcı depoya yazıldı.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, returnedRows: rows, result: 'OK' });
      await storeStatus({ enabled: true, running: false, lastStartedAt: startedAt, lastCompletedAt: completedAt, lastTrigger: trigger, lastDurationMs: durationMs, durationMs, mode: context.scope?.mode || '', scope: context.scope?.filterKey || '', entityCount: context.scope?.entityCount || context.scope?.entities?.length || 0, measurementIdCount: payload.measurementIds.length, batchCount: meta.totalBatches || 0, cacheCount: meta.cacheReuseCount || 0, networkCount: meta.networkMeasurementIdCount || 0, returnedRows: rows, result: meta.resultKind || 'OK', errorType: '', lastError: '', lastErrorType: '' }, settings.autoRefreshMinutes);
      return { ok: true, result: resultEntry };
    } catch (error) {
      const completedAt = new Date().toISOString(); const type = error.type || errorType(error);
      const durationMs = Date.now() - new Date(startedAt).getTime(); await diagnostic({ event: 'MAP_AUTO_QUERY_END', level: 'error', message: 'Harita arka plan sorgusu başarısız.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, measurementCount: context.payload?.measurementIds?.length || 0, durationMs, result: 'FAILED', errorType: type });
      await storeStatus({ ...old, enabled: true, running: false, lastStartedAt: startedAt, lastCompletedAt: completedAt, lastTrigger: trigger, lastDurationMs: durationMs, durationMs, result: 'FAILED', errorType: type, lastError: error.message || String(error), lastErrorType: type }, settings.autoRefreshMinutes);
      return { ok: false, error: error.message || String(error), errorType: type };
    }
  }
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm?.name === NAME) void run('map-background', { at: new Date().toISOString() }); });
  return { NAME, CONTEXT, RESULT, STATUS, nextWholeMinute, state, currentSchedule, ensure, setContext, run };
})();
