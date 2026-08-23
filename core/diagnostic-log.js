const WebSCADADiagnosticLog = (() => {
  const KEY = 'webscadaDiagnosticLogs'; const LIMIT = 900; const MAX_BYTES = 1200 * 1024;
  const TRANSIENT_KEYS = ['scadaDashboardSnapshot', 'webscadaBackgroundMapResult', 'webscadaLiveMeasurementCache'];
  let writeChain = Promise.resolve(), pending = [], flushing = false, recoveryCount = 0;
  const secretKey = /password|credential|cookie|token|authorization|csrf|secret/i;
  const byteSize = value => new TextEncoder().encode(JSON.stringify(value || [])).length;
  const isQuota = error => /quota|QUOTA_BYTES|MAX_WRITE_OPERATIONS/i.test(String(error?.message || error));
  const shortHash = value => { let hash = 2166136261; for (const char of String(value || '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); };
  const compactRequestId = value => {
    if (!value) return null;
    const raw = String(value); if (/^(map|alarm|query)-[a-z0-9]+$/i.test(raw)) return raw;
    const kind = /ALARM/i.test(raw) ? 'alarm' : /WEBSCADA_QUERY|HISTORY|QUERY/i.test(raw) ? 'query' : 'map';
    return `${kind}-${shortHash(raw)}`;
  };
  const redact = (value, key = '') => {
    if (secretKey.test(String(key))) return '[REDACTED]';
    if (typeof value === 'string') return value.replace(/(password|credential|cookie|token|authorization|csrf|secret)\s*([=:])\s*[^\s,;]+/gi, '$1$2[REDACTED]');
    if (Array.isArray(value)) return value.slice(0, 24).map(item => redact(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
    return value;
  };
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const entry = (input = {}) => {
    const safe = redact(input);
    return {
      id: String(safe.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`), ts: safe.ts || new Date().toISOString(), level: safe.level || 'info', subsystem: safe.subsystem || 'worker', event: safe.event || 'DIAGNOSTIC', message: safe.message || '', trigger: safe.trigger || null,
      requestId: compactRequestId(safe.requestId), cycleId: safe.cycleId || null, ruleId: safe.ruleId || null, ruleName: safe.ruleName || null, mode: safe.mode || null, scopeSummary: safe.scopeSummary || null, filterSummary: safe.filterSummary || null,
      entityCount: number(safe.entityCount), measurementCount: number(safe.measurementCount), batchIndex: number(safe.batchIndex), totalBatches: number(safe.totalBatches), cacheCount: number(safe.cacheCount), networkCount: number(safe.networkCount), returnedRows: number(safe.returnedRows), rows: number(safe.rows), normalizedRows: number(safe.normalizedRows), visibleTotal: number(safe.visibleTotal), visibleMatched: number(safe.visibleMatched), available: number(safe.available), missing: number(safe.missing), dataTimestamp: safe.dataTimestamp || null, idIntersection: number(safe.idIntersection), previousMatched: number(safe.previousMatched), reason: safe.reason || null,
      recoveryCount: number(safe.recoveryCount), finalMissing: number(safe.finalMissing ?? safe.finalMissingIdCount), evaluated: number(safe.evaluated ?? safe.lastEvaluatedEntityCount), active: number(safe.active ?? safe.activeAlarmCount), new: number(safe.new ?? safe.newAlarmCount), cleared: number(safe.cleared ?? safe.clearedAlarmCount), storageBytes: number(safe.storageBytes),
      durationMs: number(safe.durationMs), queueWaitMs: number(safe.queueWaitMs), result: safe.result || null, errorType: safe.errorType || null, httpStatus: safe.httpStatus || null, authMode: safe.authMode || null
    };
  };
  const trim = values => { const next = (values || []).slice(-LIMIT); while (next.length && byteSize(next) > MAX_BYTES) next.shift(); return next; };
  const read = async () => (await chrome.storage.local.get(KEY))[KEY] || [];
  async function recoverStorage(reason = 'quota') {
    const stored = await chrome.storage.local.get([KEY, ...TRANSIENT_KEYS]); const before = stored[KEY] || []; const compact = trim(before.slice(-Math.min(LIMIT, 480)));
    recoveryCount += 1;
    const recovery = entry({ subsystem: 'storage', event: 'STORAGE_QUOTA_RECOVERY', level: 'warn', message: 'Storage kota toparlama uygulandı.', reason, recoveryCount, storageBytes: byteSize(compact), result: 'RECOVERED' });
    await chrome.storage.local.remove(TRANSIENT_KEYS); await chrome.storage.local.set({ [KEY]: trim([...compact, recovery]) });
    return { recoveryCount, storageBytes: byteSize(compact) };
  }
  async function flush() {
    const batch = pending.splice(0); if (!batch.length) return null;
    try {
      const current = await read(); const next = trim([...current, ...batch]);
      try { await chrome.storage.local.set({ [KEY]: next }); }
      catch (error) { if (!isQuota(error)) throw error; await recoverStorage('diagnostic-log'); const fresh = await read(); await chrome.storage.local.set({ [KEY]: trim([...fresh, ...batch]) }); }
      return batch[batch.length - 1];
    } catch (_error) { return batch[batch.length - 1]; }
    finally { flushing = false; if (pending.length) scheduleFlush(); }
  }
  function scheduleFlush() { if (!flushing) { flushing = true; writeChain = writeChain.then(flush, flush); } return writeChain; }
  const append = input => { const nextEntry = entry(input); pending.push(nextEntry); return scheduleFlush().then(() => nextEntry, () => nextEntry); };
  const clear = async () => { pending = []; await chrome.storage.local.set({ [KEY]: [] }); return true; };
  return { KEY, LIMIT, MAX_BYTES, redact, entry, compactRequestId, read, append, clear, recoverStorage, isQuota };
})();
globalThis.WebSCADADiagnosticLog = WebSCADADiagnosticLog;
if (typeof module === 'object' && module.exports) module.exports = WebSCADADiagnosticLog;
