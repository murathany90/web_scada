(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADAAlarmEvaluator = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const timeOf = (row) => new Date(row?.__time ?? row?.timestamp ?? row?.['MAX(__time)'] ?? 0).getTime();
  const valueOf = (row) => Number(row?.value ?? row?.['AVG(maxValue)'] ?? row?.maxValue);
  const idOf = (row) => String(row?.sinsid ?? row?.measurementId ?? '');
  const metricOf = (row) => String(row?.elementName || '');
  const slotRank = descriptor => /^(primary|start|source)$/i.test(String(descriptor?.candidateSlot || '')) ? 0 : 1;
  function latest(rows, descriptor, metric) { return (rows || []).filter(row => idOf(row) === descriptor.id && (!metric || metricOf(row) === metric) && Number.isFinite(valueOf(row))).sort((a, b) => timeOf(b) - timeOf(a))[0] || null; }
  function capacity(entity, season) { return season === 'summer' ? Number(entity.summerCapacityMva) : Number(entity.winterCapacityMva); }
  function selectMetric(entity, descriptors, metric, rows, c) {
    let candidates = (descriptors || []).map(descriptor => ({ descriptor, row: latest(rows, descriptor, metric) })).filter(entry => entry.row).map(entry => ({ ...entry, magnitude: Math.abs(valueOf(entry.row) * (entry.descriptor.formulaSign || 1)) }));
    if (entity.entityType === 'hat' && metric === 'P' && Number.isFinite(c) && c > 0) { const valid = candidates.filter(entry => entry.magnitude <= c * 1.5); if (valid.length) candidates = valid; }
    if (!candidates.length) return null;
    candidates.sort((a, b) => timeOf(b.row) - timeOf(a.row) || (entity.entityType === 'hat' ? slotRank(a.descriptor) - slotRank(b.descriptor) : b.magnitude - a.magnitude) || String(a.descriptor.id).localeCompare(String(b.descriptor.id)));
    return candidates[0];
  }
  function evaluate(entity, rows, season = 'winter', now = Date.now()) {
    const c = capacity(entity, season); if (!Number.isFinite(c) || c <= 0) return { loadingPct: null, reason: 'Kapasite yok', capacityMva: null };
    const p = selectMetric(entity, entity.activeDescriptors, 'P', rows, c); const q = selectMetric(entity, entity.reactiveDescriptors, 'Q', rows, c);
    if (!p && !q) return { loadingPct: null, reason: 'Veri yok', capacityMva: c };
    const pv = p?.magnitude ?? null; const qv = q?.magnitude ?? null; const primary = p || q;
    // Mirrors map/scada-v2-runtime.js: Hat uses P/Q apparent magnitude; Trafo
    // uses the active candidate when present, otherwise its reactive candidate.
    const magnitude = entity.entityType === 'hat' ? (Number.isFinite(pv) ? Math.hypot(pv, Number.isFinite(qv) ? qv : 0) : qv) : (Number.isFinite(pv) ? pv : qv);
    const timestamp = new Date(timeOf(primary?.row)); if (!Number.isFinite(magnitude) || !Number.isFinite(timestamp.getTime()) || now - timestamp.getTime() > 3600000) return { loadingPct: null, reason: 'Bayat veya geçersiz veri', capacityMva: c, valueTimestamp: Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null };
    return { loadingPct: magnitude / c * 100, capacityMva: c, activeMw: pv, reactiveMvar: qv, valueTimestamp: timestamp.toISOString(), activeDescriptor: p?.descriptor || null, reactiveDescriptor: q?.descriptor || null, reason: '' };
  }
  return { evaluate, capacity, latest, selectMetric };
}));
