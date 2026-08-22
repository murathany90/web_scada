const WebSCADAAlarmMonitor = (() => {
  const KEYS = { settings: 'webscadaAlarmSettings', rules: 'webscadaAlarmRules', runtime: 'webscadaAlarmRuntime', events: 'webscadaAlarmEvents', cycles: 'webscadaMonitorCycles', samples: 'webscadaAlarmSamples', catalog: 'webscadaAlarmCatalog', catalogVersion: 'webscadaAlarmCatalogVersion', status: 'webscadaBackgroundMonitorStatus', lease: 'alarmMonitorLease', snapshot: 'scadaDashboardSnapshot' };
  const get = async (...keys) => chrome.storage.local.get(keys);
  const set = (value) => chrome.storage.local.set(value);
  const iso = () => new Date().toISOString();
  const rows = (result) => Array.isArray(result?.data?.result) ? result.data.result.flatMap(x => Array.isArray(x?.data) ? x.data : []) : [];
  async function catalog() {
    const current = await get(KEYS.catalog, KEYS.catalogVersion); const version = chrome.runtime.getManifest().version;
    if (Array.isArray(current[KEYS.catalog]) && current[KEYS.catalogVersion] === version) return current[KEYS.catalog];
    const network = await fetch(chrome.runtime.getURL('data/kml_layers_v2.json')).then(r => r.json()); const hierarchy = self.WebSCADAYtbsHierarchy?.create?.(network); const next = WebSCADAAlarmCatalog.build(network, hierarchy); await set({ [KEYS.catalog]: next, [KEYS.catalogVersion]: version }); return next;
  }
  function plan(rules, items) { const entities = [...new Map(rules.flatMap(rule => WebSCADAAlarmCatalog.resolve(rule, items).map(entity => [entity.entityId, entity]))).values()]; return { entities, measurementIds: WebSCADAAlarmCatalog.ids(entities) }; }
  function snapshotRows(snapshot, ids) { const at = Number(snapshot?.at || snapshot?.createdAt || 0); const data = snapshot?.rows || snapshot?.data || (snapshot?.measurementRows || []).map(([key, row]) => ({ ...row, sinsid: String(key).split('|')[0], elementName: String(key).split('|')[1] || row?.elementName })); return Date.now() - at <= 45000 && Array.isArray(data) && ids.every(id => data.some(row => String(row.sinsid ?? row.measurementId ?? '') === id)) ? data : null; }
  async function acquire() { const current = await get(KEYS.lease); const lease = current[KEYS.lease]; if (lease?.running && Number(lease.expiresAt) > Date.now()) return false; await set({ [KEYS.lease]: { running: true, startedAt: Date.now(), expiresAt: Date.now() + 55000 } }); return true; }
  async function release() { await set({ [KEYS.lease]: { running: false, startedAt: 0, expiresAt: 0 } }); }
  async function run(trigger = 'alarm-background') {
    if (!await acquire()) return { ok: false, skipped: 'overlap' };
    const started = Date.now();
    try {
      const saved = await get(KEYS.settings, KEYS.rules, KEYS.runtime, KEYS.events, KEYS.cycles, KEYS.samples, KEYS.snapshot, KEYS.status);
      const settings = saved[KEYS.settings] || { backgroundMonitoringEnabled: false }; const enabledRules = (saved[KEYS.rules] || []).filter(rule => rule.enabled);
      await set({ [KEYS.status]: { ...(saved[KEYS.status] || {}), enabled: Boolean(settings.backgroundMonitoringEnabled), running: true, lastStartedAt: new Date(started).toISOString(), lastError: '' } });
      if (!settings.backgroundMonitoringEnabled || !enabledRules.length) return { ok: true, skipped: 'disabled' };
      const all = await catalog(); const prepared = enabledRules.map(input => WebSCADAAlarmModel.rule(input)); const queryPlan = plan(prepared, all);
      if (!queryPlan.measurementIds.length) return { ok: true, skipped: 'no-measurements' };
      let values = snapshotRows(saved[KEYS.snapshot], queryPlan.measurementIds), source = values ? 'map-snapshot' : 'network', result = null;
      if (!values) { result = await WebSCADAQuery.executeLiveScada({ measurementIds: queryPlan.measurementIds, elementNames: ['P', 'Q'] }); if (!result?.ok) throw Object.assign(new Error(result?.error || 'SCADA sorgusu başarısız.'), { authMode: result?.authMode || 'none' }); values = rows(result); }
      const runtime = { ...(saved[KEYS.runtime] || {}) }; let events = saved[KEYS.events] || []; let samples = saved[KEYS.samples] || {}; let notifications = 0, newCount = 0, cleared = 0, max = null, soundRequested = false;
      for (const rule of prepared) for (const entity of WebSCADAAlarmCatalog.resolve(rule, all)) {
        const key = `${rule.id}:${entity.entityId}`; const outcome = WebSCADAAlarmEvaluator.evaluate(entity, values, rule.capacitySeason, Date.now()); const prior = runtime[key] || {}; const next = WebSCADAAlarmModel.nextState(prior, { ...rule, valueTimestamp: outcome.valueTimestamp }, outcome.loadingPct); next.entityId = entity.entityId; next.entityName = entity.entityName; next.entityType = entity.entityType; next.ruleId = rule.id; next.thresholdPct = rule.thresholdPct; next.capacityMva = outcome.capacityMva; next.capacitySeason = rule.capacitySeason; runtime[key] = next;
        if (Number.isFinite(outcome.loadingPct) && (!max || outcome.loadingPct > max.loadingPct)) max = { loadingPct: outcome.loadingPct, entity };
        if (next.changed) { const type = next.state === 'ACTIVE' ? 'activated' : next.state === 'NORMAL' ? 'cleared' : 'data-unavailable'; if (type === 'activated') newCount++; if (type === 'cleared') cleared++; events = WebSCADAAlarmModel.append(events, { id: `${Date.now()}-${key}-${type}`, at: iso(), type, ruleId: rule.id, entityId: entity.entityId, entityName: entity.entityName, entityType: entity.entityType, stateFrom: prior.state || 'NORMAL', stateTo: next.state, loadingPct: outcome.loadingPct, thresholdPct: rule.thresholdPct, capacityMva: outcome.capacityMva, capacitySeason: rule.capacitySeason, valueTimestamp: outcome.valueTimestamp, notificationSent: false, soundPlayed: false, acknowledged: Boolean(next.acknowledgedAt) }, WebSCADAAlarmModel.LIMITS.events); }
        if (next.notify && rule.notificationEnabled && notifications < WebSCADAAlarmModel.LIMITS.notificationBurst) { WebSCADAAlarmNotifications.alarm(rule, next); next.lastNotifiedAt = Date.now(); notifications++; soundRequested ||= rule.soundEnabled; }
        if (Number.isFinite(outcome.loadingPct) && (rule.scopeType === 'selected' || rule.scopeType === 'multi' || next.state === 'ACTIVE')) samples[entity.entityId] = WebSCADAAlarmModel.append(samples[entity.entityId], { at: iso(), entityId: entity.entityId, loadingPct: outcome.loadingPct, activeMw: outcome.activeMw, reactiveMvar: outcome.reactiveMvar, capacityMva: outcome.capacityMva, state: next.state }, WebSCADAAlarmModel.LIMITS.samplesPerEntity);
      }
      if (newCount > WebSCADAAlarmModel.LIMITS.notificationBurst) WebSCADAAlarmNotifications.summary(newCount);
      if (notifications && soundRequested) await WebSCADAAlarmNotifications.sound('critical');
      const active = Object.values(runtime).filter(entry => entry.state === 'ACTIVE' || entry.state === 'ACTIVE_DATA_UNAVAILABLE').length; WebSCADAAlarmNotifications.activeBadge(active);
      const cycle = { id: `${started}`, source: trigger, startedAt: new Date(started).toISOString(), completedAt: iso(), durationMs: Date.now() - started, ruleCount: prepared.length, monitoredEntityCount: queryPlan.entities.length, measurementIdCount: queryPlan.measurementIds.length, returnedRowCount: values.length, matchedEntityCount: queryPlan.entities.length, missingEntityCount: 0, activeAlarmCount: active, newAlarmCount: newCount, clearedAlarmCount: cleared, maxLoadingPct: max?.loadingPct || null, maxLoadingEntityId: max?.entity.entityId || '', maxLoadingEntityName: max?.entity.entityName || '', authMode: result?.authMode || 'snapshot', querySource: source, error: '' };
      const status = { enabled: true, running: false, lastStartedAt: new Date(started).toISOString(), lastCompletedAt: iso(), lastDurationMs: cycle.durationMs, nextExpectedAt: new Date(Date.now() + 60000).toISOString(), lastError: '', lastAuthMode: cycle.authMode, monitoredEntityCount: cycle.monitoredEntityCount, measurementIdCount: cycle.measurementIdCount, ruleCount: cycle.ruleCount, activeAlarmCount: active, schedulerDelayMs: 0, gapDetected: saved[KEYS.status]?.lastCompletedAt && Date.now() - new Date(saved[KEYS.status].lastCompletedAt).getTime() > 150000 };
      await set({ [KEYS.runtime]: runtime, [KEYS.events]: events, [KEYS.samples]: samples, [KEYS.cycles]: WebSCADAAlarmModel.append(saved[KEYS.cycles], cycle, WebSCADAAlarmModel.LIMITS.cycles), [KEYS.status]: status }); return { ok: true, cycle };
    } catch (error) { const prior = await get(KEYS.status, KEYS.cycles); const status = { ...(prior[KEYS.status] || {}), enabled: true, running: false, lastCompletedAt: iso(), lastDurationMs: Date.now() - started, lastError: error.message || String(error), lastAuthMode: error.authMode || 'none' }; const cycle = { id: `${started}`, source: trigger, startedAt: new Date(started).toISOString(), completedAt: iso(), durationMs: Date.now() - started, error: status.lastError, activeAlarmCount: status.activeAlarmCount || 0 }; await set({ [KEYS.status]: status, [KEYS.cycles]: WebSCADAAlarmModel.append(prior[KEYS.cycles], cycle, WebSCADAAlarmModel.LIMITS.cycles) }); return { ok: false, error: status.lastError }; }
    finally { await release(); }
  }
  async function syncCatalog(value) { if (!Array.isArray(value)) return false; await set({ [KEYS.catalog]: value, [KEYS.catalogVersion]: chrome.runtime.getManifest().version }); return true; }
  return { KEYS, catalog, plan, run, syncCatalog };
})();
if (typeof module === 'object' && module.exports) module.exports = WebSCADAAlarmMonitor;
