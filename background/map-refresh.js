const WebSCADAMapRefresh = (() => {
  const NAME = 'webscada-map-auto-refresh'; const CONTEXT = 'scadaBackgroundRefreshState'; const RESULT = 'webscadaBackgroundMapResult'; const STATUS = 'webscadaBackgroundMapStatus'; const RETRY_DELAYS_MS = [0, 2000, 5000];
  const errorType = error => /timeout|zaman aşımı/i.test(String(error?.message || error)) ? 'TIMEOUT' : /auth|oturum|401|403/i.test(String(error?.message || error)) ? 'AUTH_REQUIRED' : 'NETWORK_ERROR';
  const diagnostic = input => globalThis.WebSCADADiagnosticLog?.append?.({ subsystem: 'map', ...input }).catch(() => {});
  const resultRows = result => Array.isArray(result?.data?.result) ? result.data.result.reduce((count, item) => count + (Array.isArray(item?.data) ? item.data.length : 0), 0) : 0;
  const nextWholeMinute = now => (Math.floor(Number(now || Date.now()) / 60000) + 1) * 60000;
  const transient = () => chrome.storage.session || chrome.storage.local;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const retryable = type => type === 'NETWORK_ERROR' || type === 'TIMEOUT' || type === 'network' || type === 'timeout';
  async function state() { const data = await chrome.storage.local.get([CONTEXT, STATUS]); return { context: data[CONTEXT] || {}, status: data[STATUS] || {} }; }
  async function currentSchedule(periodMinutes) { const alarm = await chrome.alarms.get(NAME); return { nextScheduledAt: Number(alarm?.scheduledTime) || null, periodMinutes: Number(alarm?.periodInMinutes || periodMinutes) || null }; }
  async function storeStatus(patch = {}, periodMinutes) { const { status } = await state(); const schedule = await currentSchedule(periodMinutes); const next = { ...status, ...patch, ...schedule }; await chrome.storage.local.set({ [STATUS]: next }); chrome.runtime.sendMessage({ type: 'MAP_REFRESH_STATUS_UPDATED', payload: next }).catch(() => {}); return next; }
  async function ensure() {
    const { context } = await state(); const settings = await WebSCADASettings.load(); const enabled = settings.autoRefreshEnabled && context.enabled !== false && Array.isArray(context.payload?.measurementIds) && context.payload.measurementIds.length; const exists = await chrome.alarms.get(NAME);
    if (enabled) { if (!exists || Number(exists.periodInMinutes) !== settings.autoRefreshMinutes) { if (exists) await chrome.alarms.clear(NAME); await chrome.alarms.create(NAME, { when: nextWholeMinute(Date.now()), periodInMinutes: settings.autoRefreshMinutes }); } }
    else if (exists) await chrome.alarms.clear(NAME);
    await storeStatus({ enabled: Boolean(enabled), running: false }, settings.autoRefreshMinutes); return Boolean(enabled);
  }
  async function setContext(value = {}) { const prior = (await state()).context; const context = { ...prior, ...value, enabled: value.enabled !== false, updatedAt: Date.now() }; await chrome.storage.local.set({ [CONTEXT]: context }); await ensure(); return context; }
  async function executeWithRetry(payload, context, trigger) {
    let last = null; const delays = trigger === 'map-background' ? RETRY_DELAYS_MS : [0];
    for (let index = 0; index < delays.length; index += 1) {
      if (index) { await diagnostic({ event: 'MAP_AUTO_RETRY', level: 'warn', message: 'Harita otomatik sorgusu yeniden deneniyor.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, measurementCount: payload.measurementIds.length, recoveryCount: index, result: 'RETRY' }); await wait(delays[index]); }
      try {
        const result = await WebSCADARequestCoordinator.run({ key: WebSCADARequestCoordinator.requestKey('SCADA_FETCH', { ...payload, retryAttempt: index }), coalesceKey: 'map-auto-refresh', priority: 4, label: 'Harita arka plan yenileme' }, () => WebSCADAQuery.executeLiveScada(payload));
        if (result?.ok) return { result, attempts: index + 1 };
        last = Object.assign(new Error(result?.error || 'SCADA arka plan sorgusu başarısız.'), { type: result?.errorType || 'NETWORK_ERROR' });
      } catch (caught) { last = caught; }
      const type = errorType(last); if (!retryable(type)) break;
    }
    throw Object.assign(last || new Error('SCADA arka plan sorgusu başarısız.'), { type: errorType(last) });
  }
  async function run(trigger = 'map-background', wake = {}) {
    const { context, status: old } = await state(); const settings = await WebSCADASettings.load(); const startedAt = new Date().toISOString();
    if (!settings.autoRefreshEnabled || context.enabled === false || !context.payload?.measurementIds?.length) return { ok: true, skipped: 'disabled' };
    if (wake.at) await diagnostic({ event: 'MAP_SCHEDULER_WAKE', message: 'Harita otomatik yenileme scheduler uyandı.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, measurementCount: context.payload.measurementIds.length });
    await storeStatus({ ...old, enabled: true, running: true, lastStartedAt: startedAt, lastSchedulerWakeAt: wake.at || old.lastSchedulerWakeAt || null, lastTrigger: trigger, lastError: '' }, settings.autoRefreshMinutes);
    try {
      const payload = { ...context.payload, triggerType: 'auto-background', liveCacheSemantics: 'map-aggregate' }; await diagnostic({ event: 'MAP_AUTO_QUERY_START', message: 'Harita arka plan sorgusu başladı.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, entityCount: context.scope?.entityCount || context.scope?.entities?.length || 0, measurementCount: payload.measurementIds.length });
      const { result, attempts } = await executeWithRetry(payload, context, trigger); const completedAt = new Date().toISOString(); const rows = resultRows(result); const meta = result.meta || {}; const durationMs = Date.now() - new Date(startedAt).getTime(); const resultEntry = { at: Date.now(), completedAt, scope: context.scope, data: result.data, transport: { authMode: result.authMode, httpStatus: result.httpStatus, meta } };
      await transient().set({ [RESULT]: resultEntry }); await diagnostic({ event: 'MAP_AUTO_QUERY_END', message: 'Harita arka plan sorgusu tamamlandı.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, entityCount: context.scope?.entityCount || context.scope?.entities?.length || 0, measurementCount: payload.measurementIds.length, batchIndex: meta.completedBatches, totalBatches: meta.totalBatches, cacheCount: meta.cacheReuseCount, networkCount: meta.networkMeasurementIdCount, returnedRows: rows, durationMs, recoveryCount: attempts - 1, result: meta.resultKind || 'OK', authMode: result.authMode });
      await storeStatus({ enabled: true, running: false, lastStartedAt: startedAt, lastCompletedAt: completedAt, lastTrigger: trigger, lastDurationMs: durationMs, durationMs, mode: context.scope?.mode || '', scope: context.scope?.filterKey || '', entityCount: context.scope?.entityCount || context.scope?.entities?.length || 0, measurementIdCount: payload.measurementIds.length, batchCount: meta.totalBatches || 0, cacheCount: meta.cacheReuseCount || 0, networkCount: meta.networkMeasurementIdCount || 0, returnedRows: rows, result: meta.resultKind || 'OK', errorType: '', lastError: '', lastErrorType: '', recoveryCount: attempts - 1 }, settings.autoRefreshMinutes); return { ok: true, result: resultEntry };
    } catch (caught) {
      const completedAt = new Date().toISOString(); const type = errorType(caught); const durationMs = Date.now() - new Date(startedAt).getTime(); const exhausted = trigger === 'map-background' && retryable(type); await diagnostic({ event: exhausted ? 'MAP_AUTO_RETRY_EXHAUSTED' : 'MAP_AUTO_QUERY_END', level: 'error', message: exhausted ? 'Harita otomatik yenileme denemeleri tükendi.' : 'Harita arka plan sorgusu başarısız.', trigger, mode: context.scope?.mode, scopeSummary: context.scope?.filterKey, measurementCount: context.payload?.measurementIds?.length || 0, durationMs, recoveryCount: exhausted ? 2 : 0, result: 'FAILED', errorType: type });
      await storeStatus({ ...old, enabled: true, running: false, lastStartedAt: startedAt, lastCompletedAt: completedAt, lastTrigger: trigger, lastDurationMs: durationMs, durationMs, result: 'FAILED', errorType: type, lastError: caught?.message || String(caught), lastErrorType: type, recoveryCount: exhausted ? 2 : 0, lastGoodAt: old.lastCompletedAt || null }, settings.autoRefreshMinutes); return { ok: false, error: caught?.message || String(caught), errorType: type };
    }
  }
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm?.name === NAME) void run('map-background', { at: new Date().toISOString() }).catch(() => {}); });
  return { NAME, CONTEXT, RESULT, STATUS, RETRY_DELAYS_MS, nextWholeMinute, retryable, state, currentSchedule, ensure, setContext, executeWithRetry, run };
})();
