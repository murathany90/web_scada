const WebSCADAQuery = (() => {
  const BATCH_SIZE = 200; const rowsFrom = (r) => Array.isArray(r?.data?.result) ? r.data.result.flatMap((x) => Array.isArray(x?.data) ? x.data : []) : [];
  const chunks = (ids) => ids.length ? Array.from({ length: Math.ceil(ids.length / BATCH_SIZE) }, (_, i) => ids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)) : [[]]; const uniqueIds = (p) => [...new Set((Array.isArray(p?.measurementIds) ? p.measurementIds : []).map(String).filter(Boolean))];
  const status = (p, message) => { if (p?.requestId) chrome.runtime.sendMessage({ type: 'SCADA_FETCH_PROGRESS', payload: { requestId: p.requestId, stage: 'auth', phaseMessage: message } }).catch(() => {}); };
  async function chartFirst(config, request, payload) {
    let result = await WebSCADAApi.fetchChart(config, request, 'session');
    if (result.ok || !result.shouldRetryAuth) return result;
    // The failed chart is the only authoritative auth signal.  Clearing CSRF and
    // retrying the chart refreshes a stale cookie/token without an advisory /me gate.
    WebSCADAAuth.invalidateCsrf(config);
    result = await WebSCADAApi.fetchChart(config, request, 'session-recovery');
    if (result.ok || !result.shouldRetryAuth) return result;
    status(payload, 'Superset oturumu aciliyor...'); const direct = await WebSCADAAuth.directLogin(config);
    if (direct.ok) { WebSCADAAuth.invalidateCsrf(config); result = await WebSCADAApi.fetchChart(config, request, 'direct-login'); if (result.ok || !result.shouldRetryAuth) return result; }
    status(payload, 'Oturum dogrulaniyor...'); const hidden = await WebSCADAAuth.hiddenTabLogin(config);
    if (hidden.ok) { WebSCADAAuth.invalidateCsrf(config); return WebSCADAApi.fetchChart(config, request, 'hidden-tab'); }
    return { ok: false, error: hidden.error || direct.error || result.error || 'Superset oturumu acilamadi.', errorType: 'AUTH_REQUIRED', authMode: 'hidden-tab', usedFallback: true };
  }
  async function fetchBatches(payload, makePayload) {
    const startedAt = Date.now(); const config = await WebSCADAAuth.loadConfig(); const ids = uniqueIds(payload); const groups = chunks(ids); const results = [];
    for (const group of groups) results.push(await chartFirst(config, makePayload(group, config), payload));
    const failed = results.find((r) => !r.ok); if (failed && !results.some((r) => r.ok)) return { ...failed, usedFallback: failed.authMode === 'hidden-tab' };
    const success = results.filter((r) => r.ok); return { ok: true, data: { result: [{ data: success.flatMap(rowsFrom) }] }, authMode: success[0]?.authMode || 'session', usedFallback: results.some((r) => r.authMode === 'hidden-tab'), httpStatus: success[0]?.httpStatus || null, meta: { totalBatches: groups.length, completedBatches: success.length, failedBatches: results.length - success.length, telemetry: { initialBatchCount: groups.length, initialBatchDurationMs: Date.now() - startedAt, missingIdCount: 0, fallbackQueryCount: 0, fallbackDurationMs: 0, recoveredRows: 0, totalFetchDurationMs: Date.now() - startedAt } } };
  }
  function executeLiveScada(payload) { const p = { ...payload, timeRange: payload?.timeRange || 'DATEADD(DATETIME("now"), -10, minute) : now', queryMode: 'raw' }; return fetchBatches(p, (ids, c) => ({ ...p, measurementIds: ids, chartPayload: WebSCADAApi.chartPayload({ ...c, ...p }, ids) })); }
  function executeHistorySeries(payload) { const p = { ...payload, queryMode: payload?.queryMode || 'timeseries' }; return fetchBatches(p, (ids, c) => ({ ...p, measurementIds: ids, chartPayload: WebSCADAApi.historyPayload(c, { ...p, measurementIds: ids }, ids) })); }
  function timestampOf(row) { const v=row?.__time ?? row?.timestamp ?? row?.['MAX(__time)']; const ms=v instanceof Date?v.getTime():new Date(v).getTime(); return Number.isFinite(ms)?ms:NaN; } const idOf=(r)=>String(r?.sinsid??r?.measurementId??''); const elementOf=(r)=>String(r?.elementName??'');
  function pickSnapshot(rows, at, ids) { const requested=new Set(ids),best=new Map(); rows.forEach((row)=>{const id=idOf(row),time=timestampOf(row);if(!id||(requested.size&&!requested.has(id))||!Number.isFinite(time)||time>at)return;const key=`${id}|${elementOf(row)}`;if(!best.has(key)||timestampOf(best.get(key))<time)best.set(key,row);});return [...best.values()]; }
  async function executeHistoricalSnapshot(payload) { const at=Number(payload?.at);if(!Number.isFinite(at))return {ok:false,error:'Gecmis an (at) eksik veya gecersiz.',errorType:'INVALID_PAYLOAD',authMode:'none',usedFallback:false};const windowMs=Math.max(60000,Number(payload?.windowMs||payload?.toleranceMs||600000)),startTime=at-windowMs;const raw=await executeHistorySeries({...payload,startTime,endTime:at,queryMode:'raw'});if(!raw.ok)return raw;const ids=uniqueIds(payload);let source=rowsFrom(raw),rows=pickSnapshot(source,at,ids),missing=ids.filter((id)=>!rows.some((r)=>idOf(r)===id)),recovered=false;if(missing.length){const fallback=await executeHistorySeries({...payload,measurementIds:missing,startTime:at-86400000,endTime:at,queryMode:'raw'});if(fallback.ok){source=source.concat(rowsFrom(fallback));rows=pickSnapshot(source,at,ids);missing=ids.filter((id)=>!rows.some((r)=>idOf(r)===id));recovered=true;}}return {...raw,data:{result:[{data:rows}]},meta:{...raw.meta,at,windowStartMs:startTime,windowEndMs:at,requestedIds:ids,matchedIds:[...new Set(rows.map(idOf))],missingIds:missing,recoveredViaFallback:recovered}}; }
  return { executeLiveScada, executeHistorySeries, executeHistoricalSnapshot, executeWorkspaceQuery:(p)=>executeHistorySeries({...p,queryMode:'timeseries'}), pickSnapshot, timestampOf, chartFirst };
})();
