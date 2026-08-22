(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADAAlarmModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LIMITS = { cycles: 60, events: 500, samplesPerEntity: 60, notificationBurst: 5 };
  const clean = (value) => String(value || '').trim();
  const finite = (value) => Number.isFinite(Number(value));
  function rule(input = {}, now = new Date().toISOString()) {
    const thresholdPct = Number(input.thresholdPct); const hysteresisPct = Number(input.hysteresisPct || 0);
    return { id: clean(input.id) || `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: clean(input.name) || 'Yüklenme alarmı', enabled: input.enabled !== false, scopeType: clean(input.scopeType) || 'selected', entityIds: [...new Set((input.entityIds || []).map(String).filter(Boolean))], filters: input.filters || {}, metric: 'loadingPct', thresholdPct, hysteresisPct, severity: input.severity === 'warning' ? 'warning' : 'critical', capacitySeason: input.capacitySeason === 'summer' ? 'summer' : 'winter', notificationEnabled: input.notificationEnabled !== false, soundEnabled: Boolean(input.soundEnabled), repeatMinutes: Math.max(0, Number(input.repeatMinutes || 0)), createdAt: input.createdAt || now, updatedAt: now };
  }
  function validate(value, entityCount) {
    if (!finite(value?.thresholdPct) || Number(value.thresholdPct) <= 0 || Number(value.thresholdPct) > 500) return 'Eşik %0 ile %500 arasında olmalı.';
    if (!finite(value?.hysteresisPct) || Number(value.hysteresisPct) < 0 || Number(value.hysteresisPct) > Number(value.thresholdPct)) return 'Histerezis eşikten küçük ve sıfır veya büyük olmalı.';
    if (entityCount != null && Number(entityCount) < 1) return 'Kural için izlenebilir Hat veya Trafo bulunamadı.';
    return '';
  }
  function append(list, entry, max) { return [...(Array.isArray(list) ? list : []), entry].slice(-max); }
  function nextState(previous = {}, evaluation, value, nowMs = Date.now()) {
    const current = previous.state || 'NORMAL'; const threshold = Number(evaluation.thresholdPct); const clearAt = threshold - Number(evaluation.hysteresisPct || 0);
    if (!Number.isFinite(value)) return { ...previous, state: current === 'ACTIVE' ? 'ACTIVE_DATA_UNAVAILABLE' : 'NO_DATA', loadingPct: null, valueTimestamp: evaluation.valueTimestamp || null, updatedAt: new Date(nowMs).toISOString(), changed: false, notify: false };
    const active = current === 'ACTIVE' || current === 'ACTIVE_DATA_UNAVAILABLE';
    const target = active && value >= clearAt ? 'ACTIVE' : value >= threshold ? 'ACTIVE' : 'NORMAL';
    const changed = target !== current && !(current === 'ACTIVE_DATA_UNAVAILABLE' && target === 'ACTIVE');
    const due = target === 'ACTIVE' && evaluation.repeatMinutes > 0 && nowMs - Number(previous.lastNotifiedAt || 0) >= evaluation.repeatMinutes * 60000;
    const snoozed = Number(previous.snoozedUntil || 0) > nowMs;
    const notify = target === 'ACTIVE' && !snoozed && !previous.acknowledgedAt && ((current !== 'ACTIVE' && current !== 'ACTIVE_DATA_UNAVAILABLE') || due);
    return { ...previous, state: target, loadingPct: value, valueTimestamp: evaluation.valueTimestamp || null, updatedAt: new Date(nowMs).toISOString(), changed, notify, clearAt, ...(target === 'NORMAL' ? { acknowledgedAt: null, snoozedUntil: null, lastNotifiedAt: 0 } : {}) };
  }
  return { LIMITS, rule, validate, append, nextState };
}));
