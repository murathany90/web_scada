const WebSCADAQuery = (() => {
  const BATCH_SIZE = 200; const LiveCache = globalThis.WebSCADALiveMeasurementCache || null;
  const diagnostic = input => { const write = globalThis.WebSCADADiagnosticLog?.append?.({ subsystem: 'superset', ...input }); if (write?.catch) void write.catch(() => {}); };
  const cancelledMapRequests = new Set();
  const rowsFrom = result => Array.isArray(result?.data?.result) ? result.data.result.flatMap(item => Array.isArray(item?.data) ? item.data : []) : [];
  const chunks = (ids, size = BATCH_SIZE) => ids.length ? Array.from({ length: Math.ceil(ids.length / size) }, (_, index) => ids.slice(index * size, (index + 1) * size)) : [[]]; const uniqueIds = payload => [...new Set((Array.isArray(payload?.measurementIds) ? payload.measurementIds : []).map(String).filter(Boolean))];
  const status = (payload, message, extra = {}) => { if (payload?.requestId) chrome.runtime.sendMessage({ type: 'SCADA_FETCH_PROGRESS', payload: { requestId: payload.requestId, stage: 'auth', phaseMessage: message, ...extra } }).catch(() => {}); };
  const timestampOf = row => { const value = row?.__time ?? row?.timestamp ?? row?.['MAX(__time)']; const time = value instanceof Date ? value.getTime() : new Date(value).getTime(); return Number.isFinite(time) ? time : NaN; }; const idOf = row => String(row?.sinsid ?? row?.measurementId ?? ''); const elementOf = row => String(row?.elementName ?? '');
  function latestRows(rows) { const latest = new Map(); (rows || []).forEach(row => { const key = `${idOf(row)}|${elementOf(row)}`; if (idOf(row) && elementOf(row) && Number.isFinite(timestampOf(row)) && (!latest.has(key) || timestampOf(latest.get(key)) <= timestampOf(row))) latest.set(key, row); }); return [...latest.values()]; }
  async function chartFirst(config, request, payload) {
    let result = await WebSCADAApi.fetchChart(config, request, 'session'); if (result.ok || !result.shouldRetryAuth) return result;
    WebSCADAAuth.invalidateCsrf(config); result = await WebSCADAApi.fetchChart(config, request, 'session-recovery'); if (result.ok || !result.shouldRetryAuth) return result;
    status(payload, 'Superset oturumu aciliyor...'); const direct = await WebSCADAAuth.directLogin(config); if (direct.ok) { WebSCADAAuth.invalidateCsrf(config); result = await WebSCADAApi.fetchChart(config, request, 'direct-login'); if (result.ok || !result.shouldRetryAuth) return result; }
    status(payload, 'Oturum dogrulaniyor...'); const hidden = await WebSCADAAuth.hiddenTabLogin(config); if (hidden.ok) { WebSCADAAuth.invalidateCsrf(config); return WebSCADAApi.fetchChart(config, request, 'hidden-tab'); }
    return { ok: false, error: hidden.error || direct.error || result.error || 'Superset oturumu acilamadi.', errorType: 'AUTH_REQUIRED', authMode: 'hidden-tab', usedFallback: true };
  }
  function cancelMapRequest(requestId) {
    if (requestId) cancelledMapRequests.add(String(requestId));
  }
  function cancelledScopeResult(payload, groups, results, startedAt) {
    const completed = results.length;
    return {
      ok: false,
      error: 'Kapsam değiştiği için sorgu durduruldu.',
      errorType: 'CANCELLED_SCOPE_CHANGED',
      authMode: 'none',
      usedFallback: false,
      meta: {
        totalBatches: groups.length,
        completedBatches: completed,
        failedBatches: 0,
        completedMeasurementIds: groups.slice(0, completed).flat(),
        failedMeasurementIds: [],
        telemetry: { totalFetchDurationMs: Date.now() - startedAt }
      }
    };
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const retryableNetworkFailure = result => Boolean(!result?.ok
    && !['AUTH_REQUIRED', 'CANCELLED_SCOPE_CHANGED', 'INVALID_PAYLOAD'].includes(String(result?.errorType || ''))
    && /network|failed to fetch/i.test(`${result?.errorType || ''} ${result?.error || ''}`));
  async function fetchBatches(payload, makePayload) {
    const startedAt = Date.now(); const config = await WebSCADAAuth.loadConfig(); const groups = chunks(uniqueIds(payload), Math.max(1, Number(payload?.batchSize || BATCH_SIZE))); const results = [];
    const requestId = String(payload?.requestId || `q-${startedAt}-${Math.random().toString(36).slice(2, 7)}`); let retriedBatches = 0;
    await diagnostic({ event: 'SUPERSET_QUERY_START', message: 'Mantıksal Superset sorgusu başladı.', requestId, trigger: payload?.triggerType || payload?.trigger || '', measurementCount: uniqueIds(payload).length, totalBatches: groups.length });
    try {
      for (const ids of groups) {
        if (payload?.mapScopeRequest && cancelledMapRequests.has(requestId)) { await diagnostic({ event: 'SUPERSET_QUERY_CANCELLED', level: 'warn', message: 'Kapsam değişikliği nedeniyle Superset sorgusu durduruldu.', requestId, totalBatches: groups.length, batchIndex: results.length, result: 'CANCELLED_SCOPE_CHANGED' }); return cancelledScopeResult(payload, groups, results, startedAt); }
        const batchStartedAt = Date.now(); await diagnostic({ event: 'SUPERSET_BATCH_START', message: 'Superset batch başladı; batchler sıralı çalışır.', requestId, batchIndex: results.length + 1, totalBatches: groups.length, measurementCount: ids.length });
        results.push(await chartFirst(config, makePayload(ids, config), payload));
        let batchResult = results[results.length - 1];
        if (retryableNetworkFailure(batchResult)) {
          retriedBatches += 1; await diagnostic({ event: 'SUPERSET_BATCH_RETRY', level: 'warn', message: 'Network hatası sonrası batch bir kez yeniden denenecek.', requestId, batchIndex: results.length, totalBatches: groups.length, measurementCount: ids.length, durationMs: Date.now() - batchStartedAt, errorType: batchResult.errorType || 'NETWORK_ERROR' }); await wait(1000);
          if (payload?.mapScopeRequest && cancelledMapRequests.has(requestId)) { await diagnostic({ event: 'SUPERSET_QUERY_CANCELLED', level: 'warn', message: 'Retry öncesi kapsam değişti.', requestId, batchIndex: results.length, totalBatches: groups.length, result: 'CANCELLED_SCOPE_CHANGED' }); return cancelledScopeResult(payload, groups, results, startedAt); }
          batchResult = await chartFirst(config, makePayload(ids, config), payload);
        }
        results[results.length - 1] = batchResult;
        await diagnostic({ event: batchResult.ok ? 'SUPERSET_BATCH_OK' : 'SUPERSET_BATCH_FAILED', level: batchResult.ok ? 'info' : 'error', message: batchResult.ok ? 'Superset batch tamamlandı.' : 'Superset batch başarısız.', requestId, batchIndex: results.length, totalBatches: groups.length, measurementCount: ids.length, durationMs: Date.now() - batchStartedAt, errorType: batchResult.errorType || null, httpStatus: batchResult.httpStatus || null, authMode: batchResult.authMode || null, result: batchResult.ok ? 'OK' : 'FAILED' });
        status(payload, `Batch ${results.length}/${groups.length} tamamlandi.`, { stage: 'batches', completedBatches: results.length, totalBatches: groups.length });
      }
    } finally {
      cancelledMapRequests.delete(requestId);
    }
    const entries = results.map((result, index) => ({ ids: groups[index], result }));
    const successful = entries.filter(entry => entry.result.ok); const failed = entries.filter(entry => !entry.result.ok); if (failed.length && !successful.length) { const output = { ...failed[0].result, usedFallback: failed[0].result.authMode === 'hidden-tab', meta: { totalBatches: groups.length, completedBatches: 0, failedBatches: failed.length, retriedBatches, completedMeasurementIds: [], failedMeasurementIds: failed.flatMap(entry => entry.ids), telemetry: { totalFetchDurationMs: Date.now() - startedAt } } }; await diagnostic({ event: 'SUPERSET_QUERY_END', level: 'error', message: 'Superset mantıksal sorgusu başarısız.', requestId, totalBatches: groups.length, result: 'FAILED', errorType: output.errorType || null, durationMs: Date.now() - startedAt }); return output; }
    const output = { ok: true, data: { result: [{ data: successful.flatMap(entry => rowsFrom(entry.result)) }] }, authMode: successful[0]?.result.authMode || 'session', usedFallback: successful.some(entry => entry.result.authMode === 'hidden-tab'), httpStatus: successful[0]?.result.httpStatus || null, meta: { totalBatches: groups.length, completedBatches: successful.length, failedBatches: failed.length, retriedBatches, resultKind: failed.length ? (successful.length ? 'PARTIAL_NETWORK' : 'FAILED') : 'OK', completedMeasurementIds: successful.flatMap(entry => entry.ids), failedMeasurementIds: failed.flatMap(entry => entry.ids), telemetry: { initialBatchCount: groups.length, initialBatchDurationMs: Date.now() - startedAt, missingIdCount: 0, fallbackQueryCount: 0, fallbackDurationMs: 0, recoveredRows: 0, totalFetchDurationMs: Date.now() - startedAt } } }; await diagnostic({ event: 'SUPERSET_QUERY_END', message: 'Superset mantıksal sorgusu tamamlandı.', requestId, totalBatches: groups.length, returnedRows: rowsFrom(output).length, durationMs: Date.now() - startedAt, result: output.meta.resultKind, authMode: output.authMode }); return output;
  }
  async function cachedCurrent(payload, semantics, executeNetwork, source) {
    const ids = uniqueIds(payload); const startedAt = Date.now(); const cached = LiveCache ? await LiveCache.read(ids, semantics, { forceFresh: Boolean(payload?.forceFresh) }) : { rows: [], reusedIds: [], missingIds: ids }; let network = null; let networkRows = [];
    if (cached.missingIds.length) { network = await executeNetwork({ ...payload, measurementIds: cached.missingIds }); if (network?.errorType === 'CANCELLED_SCOPE_CHANGED') return network; if (!network?.ok && !cached.rows.length) return network; if (network?.ok) networkRows = latestRows(rowsFrom(network)); if (networkRows.length && LiveCache) await LiveCache.merge(networkRows, semantics, source); }
    const combined = latestRows([...cached.rows, ...networkRows]); const meta = { ...(network?.meta || {}), cacheSemantics: semantics, cacheReuseCount: cached.reusedIds.length, networkMeasurementIdCount: cached.missingIds.length, totalBatches: Number(network?.meta?.totalBatches || (cached.missingIds.length ? 1 : 0)), completedBatches: Number(network?.meta?.completedBatches || 0), failedBatches: Number(network?.meta?.failedBatches || (!network && 0)), failedMeasurementIds: network?.meta?.failedMeasurementIds || [], telemetry: { ...(network?.meta?.telemetry || {}), totalFetchDurationMs: Date.now() - startedAt } };
    return { ok: true, data: { result: [{ data: combined }] }, authMode: network?.authMode || 'cache', usedFallback: Boolean(network?.usedFallback), httpStatus: network?.httpStatus || null, meta };
  }
  function executeLiveScada(payload) { const request = { ...payload, timeRange: payload?.timeRange || 'DATEADD(DATETIME("now"), -10, minute) : now', queryMode: 'raw' }; const network = value => fetchBatches(value, (ids, config) => ({ ...value, measurementIds: ids, chartPayload: WebSCADAApi.chartPayload({ ...config, ...value }, ids) })); return request.liveCacheSemantics ? cachedCurrent(request, request.liveCacheSemantics, network, 'map-live') : network(request); }
  async function executeAlarmCurrentScada(payload) { const request = { ...payload, timeRange: payload?.timeRange || 'DATEADD(DATETIME("now"), -5, minute) : now', queryMode: 'raw', rowLimit: Math.min(Number(payload?.rowLimit || 5000), 10000) }; const network = async value => { const initial = await fetchBatches(value, (ids, config) => ({ ...value, measurementIds: ids, chartPayload: WebSCADAApi.historyPayload(config, { ...value, queryMode: 'raw' }, ids) })); if (!initial?.ok) return initial; const requested = uniqueIds(value), returned = new Set(rowsFrom(initial).map(idOf)), failed = new Set((initial.meta?.failedMeasurementIds || []).map(String)); const recoveryIds = requested.filter(id => !returned.has(id) && !failed.has(id)); let recovery = null; if (recoveryIds.length) recovery = await fetchBatches({ ...value, measurementIds: recoveryIds, batchSize: 50 }, (ids, config) => ({ ...value, measurementIds: ids, batchSize: 50, chartPayload: WebSCADAApi.historyPayload(config, { ...value, measurementIds: ids, queryMode: 'raw' }, ids) })); const combined = latestRows(rowsFrom(initial).concat(recovery?.ok ? rowsFrom(recovery) : [])); const finalMissingIds = requested.filter(id => !combined.some(row => idOf(row) === id)); return { ...initial, data: { result: [{ data: combined }] }, meta: { ...initial.meta, totalBatches: Number(initial.meta?.totalBatches || 0) + Number(recovery?.meta?.totalBatches || 0), completedBatches: Number(initial.meta?.completedBatches || 0) + Number(recovery?.meta?.completedBatches || 0), failedBatches: Number(initial.meta?.failedBatches || 0) + Number(recovery?.meta?.failedBatches || 0), failedMeasurementIds: [...new Set([...(initial.meta?.failedMeasurementIds || []), ...(recovery?.meta?.failedMeasurementIds || [])])], recoveryQueriedIds: recoveryIds, finalMissingIds } }; }; return cachedCurrent(request, 'latest-current', network, 'alarm-current'); }
  function executeHistorySeries(payload) { const request = { ...payload, queryMode: payload?.queryMode || 'timeseries' }; return fetchBatches(request, (ids, config) => ({ ...request, measurementIds: ids, chartPayload: WebSCADAApi.historyPayload(config, { ...request, measurementIds: ids }, ids) })); }
  function pickSnapshot(rows, at, ids) { const requested = new Set(ids), best = new Map(); rows.forEach(row => { const id = idOf(row), time = timestampOf(row); if (!id || (requested.size && !requested.has(id)) || !Number.isFinite(time) || time > at) return; const key = `${id}|${elementOf(row)}`; if (!best.has(key) || timestampOf(best.get(key)) < time) best.set(key, row); }); return [...best.values()]; }
  async function executeHistoricalSnapshot(payload) { const at = Number(payload?.at); if (!Number.isFinite(at)) return { ok: false, error: 'Gecmis an (at) eksik veya gecersiz.', errorType: 'INVALID_PAYLOAD', authMode: 'none', usedFallback: false }; const windowMs = Math.max(60000, Number(payload?.windowMs || payload?.toleranceMs || 600000)), startTime = at - windowMs; const raw = await executeHistorySeries({ ...payload, startTime, endTime: at, queryMode: 'raw' }); if (!raw.ok) return raw; const ids = uniqueIds(payload); let source = rowsFrom(raw), rows = pickSnapshot(source, at, ids), missing = ids.filter(id => !rows.some(row => idOf(row) === id)), recovered = false; if (missing.length) { const fallback = await executeHistorySeries({ ...payload, measurementIds: missing, startTime: at - 86400000, endTime: at, queryMode: 'raw' }); if (fallback.ok) { source = source.concat(rowsFrom(fallback)); rows = pickSnapshot(source, at, ids); missing = ids.filter(id => !rows.some(row => idOf(row) === id)); recovered = true; } } return { ...raw, data: { result: [{ data: rows }] }, meta: { ...raw.meta, at, windowStartMs: startTime, windowEndMs: at, requestedIds: ids, matchedIds: [...new Set(rows.map(idOf))], missingIds: missing, recoveredViaFallback: recovered } }; }
  return { executeLiveScada, executeAlarmCurrentScada, executeHistorySeries, executeHistoricalSnapshot, executeWorkspaceQuery: payload => executeHistorySeries({ ...payload, queryMode: 'timeseries' }), fetchBatches, pickSnapshot, latestRows, timestampOf, chartFirst, cancelMapRequest };
})();
if (typeof module === 'object' && module.exports) module.exports = WebSCADAQuery;
