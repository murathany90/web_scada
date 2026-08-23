const WebSCADADiagnosticLog = (() => {
  const KEY = 'webscadaDiagnosticLogs';
  const LIMIT = 1800;
  let writeChain = Promise.resolve();
  const secretKey = /password|credential|cookie|token|authorization|csrf|secret/i;
  const redact = (value, key = '') => {
    if (secretKey.test(String(key))) return '[REDACTED]';
    if (typeof value === 'string') return value.replace(/(password|credential|cookie|token|authorization|csrf|secret)\s*([=:])\s*[^\s,;]+/gi, '$1$2[REDACTED]');
    if (Array.isArray(value)) return value.slice(0, 24).map(item => redact(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
    return value;
  };
  const entry = (input = {}) => {
    const safe = redact(input);
    return {
      id: String(safe.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
      ts: safe.ts || new Date().toISOString(), level: safe.level || 'info', subsystem: safe.subsystem || 'worker',
      event: safe.event || 'DIAGNOSTIC', message: safe.message || '', trigger: safe.trigger || null,
      requestId: safe.requestId || null, cycleId: safe.cycleId || null, ruleId: safe.ruleId || null,
      ruleName: safe.ruleName || null, mode: safe.mode || null, scopeSummary: safe.scopeSummary || null,
      filterSummary: safe.filterSummary || null, entityCount: Number.isFinite(Number(safe.entityCount)) ? Number(safe.entityCount) : null,
      measurementCount: Number.isFinite(Number(safe.measurementCount)) ? Number(safe.measurementCount) : null,
      batchIndex: Number.isFinite(Number(safe.batchIndex)) ? Number(safe.batchIndex) : null,
      totalBatches: Number.isFinite(Number(safe.totalBatches)) ? Number(safe.totalBatches) : null,
      cacheCount: Number.isFinite(Number(safe.cacheCount)) ? Number(safe.cacheCount) : null,
      networkCount: Number.isFinite(Number(safe.networkCount)) ? Number(safe.networkCount) : null,
      returnedRows: Number.isFinite(Number(safe.returnedRows)) ? Number(safe.returnedRows) : null,
      rows: Number.isFinite(Number(safe.rows)) ? Number(safe.rows) : null,
      normalizedRows: Number.isFinite(Number(safe.normalizedRows)) ? Number(safe.normalizedRows) : null,
      visibleTotal: Number.isFinite(Number(safe.visibleTotal)) ? Number(safe.visibleTotal) : null,
      visibleMatched: Number.isFinite(Number(safe.visibleMatched)) ? Number(safe.visibleMatched) : null,
      available: Number.isFinite(Number(safe.available)) ? Number(safe.available) : null,
      missing: Number.isFinite(Number(safe.missing)) ? Number(safe.missing) : null,
      dataTimestamp: safe.dataTimestamp || null,
      idIntersection: Number.isFinite(Number(safe.idIntersection)) ? Number(safe.idIntersection) : null,
      previousMatched: Number.isFinite(Number(safe.previousMatched)) ? Number(safe.previousMatched) : null,
      reason: safe.reason || null,
      durationMs: Number.isFinite(Number(safe.durationMs)) ? Number(safe.durationMs) : null,
      queueWaitMs: Number.isFinite(Number(safe.queueWaitMs)) ? Number(safe.queueWaitMs) : null,
      result: safe.result || null, errorType: safe.errorType || null, httpStatus: safe.httpStatus || null, authMode: safe.authMode || null
    };
  };
  const read = async () => (await chrome.storage.local.get(KEY))[KEY] || [];
  const append = async input => {
    const nextEntry = entry(input);
    writeChain = writeChain.then(async () => {
      const current = await read();
      await chrome.storage.local.set({ [KEY]: [...current, nextEntry].slice(-LIMIT) });
      return nextEntry;
    });
    return writeChain;
  };
  const clear = async () => { await chrome.storage.local.set({ [KEY]: [] }); return true; };
  return { KEY, LIMIT, redact, entry, read, append, clear };
})();
globalThis.WebSCADADiagnosticLog = WebSCADADiagnosticLog;
if (typeof module === 'object' && module.exports) module.exports = WebSCADADiagnosticLog;
