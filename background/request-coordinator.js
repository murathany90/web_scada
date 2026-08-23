const WebSCADARequestCoordinator = (() => {
  const MAX_CONCURRENT_SUPERSET = 1;
  const diagnostic = input => globalThis.WebSCADADiagnosticLog?.append?.({ subsystem: 'coordinator', ...input }).catch(() => {});
  const diagnosticId = key => globalThis.WebSCADADiagnosticLog?.compactRequestId?.(key) || `map-${String(key || '').length}`;
  function create() {
    let running = 0; let sequence = 0; let active = null; let lastWaitMs = 0; let lastDurationMs = 0;
    const queue = []; const byKey = new Map();
    const state = () => ({ maxConcurrent: MAX_CONCURRENT_SUPERSET, active: active ? { requestId: active.requestId, label: active.label, priority: active.priority, startedAt: active.startedAt } : null, queueCount: queue.length, pending: queue.map(job => ({ label: job.label, priority: job.priority })), lastWaitMs, lastDurationMs });
    const takeNext = () => queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence).shift();
    function pump() {
      if (running >= MAX_CONCURRENT_SUPERSET) return;
      const job = takeNext(); if (!job) return;
      running += 1; active = { key: job.key, requestId: job.requestId, label: job.label, priority: job.priority, startedAt: Date.now() };
      const started = Date.now(); lastWaitMs = started - job.queuedAt; diagnostic({ event: 'COORDINATOR_START', message: 'Superset işi sıradan çalıştırılıyor.', requestId: job.requestId, scopeSummary: job.label, entityCount: queue.length, queueWaitMs: lastWaitMs, result: 'STARTED' });
      Promise.resolve().then(job.executor).then(job.resolve, job.reject).finally(() => { lastDurationMs = Date.now() - started; diagnostic({ event: 'COORDINATOR_END', message: 'Superset işi tamamlandı.', requestId: job.requestId, scopeSummary: job.label, queueWaitMs: lastWaitMs, durationMs: lastDurationMs, result: 'ENDED' }); running -= 1; active = null; byKey.delete(job.key); pump(); });
    }
    function run(input, executor) {
      const job = { key: String(input?.key || `job-${sequence}`), coalesceKey: String(input?.coalesceKey || ''), label: String(input?.label || 'Superset sorgusu'), priority: Math.max(1, Number(input?.priority || 4)), executor, queuedAt: Date.now(), sequence: sequence++ }; job.requestId = diagnosticId(job.key);
      const existing = byKey.get(job.key); if (existing) return existing.promise;
      const coalesced = job.coalesceKey && queue.find(candidate => candidate.coalesceKey === job.coalesceKey);
      if (coalesced) { byKey.delete(coalesced.key); coalesced.key = job.key; coalesced.requestId = job.requestId; coalesced.label = job.label; coalesced.priority = job.priority; coalesced.executor = job.executor; byKey.set(coalesced.key, coalesced); return coalesced.promise; }
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; }); byKey.set(job.key, job); queue.push(job); diagnostic({ event: 'COORDINATOR_ENQUEUE', message: 'Superset işi kuyruğa eklendi.', requestId: job.requestId, scopeSummary: job.label, queueWaitMs: 0, entityCount: queue.length, result: 'QUEUED' }); pump(); return job.promise;
    }
    return { run, state, _reset: () => { queue.splice(0); byKey.clear(); running = 0; active = null; }, _queue: queue };
  }
  const instance = create();
  const stable = (value) => JSON.stringify(value || {}, Object.keys(value || {}).sort());
  const requestKey = (type, payload = {}) => `${type}:${stable({ ids: [...new Set((payload.measurementIds || []).map(String))].sort(), elements: [...new Set((payload.elementNames || []).map(String))].sort(), mode: payload.queryMode, range: payload.timeRange, start: payload.startTime, end: payload.endTime, grain: payload.timeGrain, at: payload.at, trigger: payload.triggerType || payload.trigger || '' })}`;
  const priorityFor = (type, payload = {}) => type === 'ALARM_NETWORK_QUERY' ? 1 : (type === 'WEBSCADA_QUERY' || type === 'SCADA_HISTORY_FETCH' || type === 'SCADA_HISTORICAL_SNAPSHOT_FETCH') ? 2 : (payload.triggerType === 'auto' || payload.trigger === 'auto') ? 4 : 3;
  return { MAX_CONCURRENT_SUPERSET, create, run: instance.run, state: instance.state, requestKey, priorityFor, _reset: instance._reset };
})();
if (typeof module === 'object' && module.exports) module.exports = WebSCADARequestCoordinator;
