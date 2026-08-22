(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADAAlarmEvaluator = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const timeOf = (row) => new Date(row?.__time ?? row?.timestamp ?? row?.['MAX(__time)'] ?? 0).getTime();
  const valueOf = (row) => Number(row?.value ?? row?.['AVG(maxValue)'] ?? row?.maxValue);
  const idOf = (row) => String(row?.sinsid ?? row?.measurementId ?? '');
  const metricOf = (row) => String(row?.elementName || '');
  function latest(rows, descriptor, metric) { return (rows || []).filter(row => idOf(row) === descriptor.id && (!metric || metricOf(row) === metric) && Number.isFinite(valueOf(row))).sort((a, b) => timeOf(b) - timeOf(a))[0] || null; }
  function capacity(entity, season) { return season === 'summer' ? Number(entity.summerCapacityMva) : Number(entity.winterCapacityMva); }
  function evaluate(entity, rows, season = 'winter', now = Date.now()) {
    const c = capacity(entity, season); if (!Number.isFinite(c) || c <= 0) return { loadingPct: null, reason: 'Kapasite yok', capacityMva: null };
    const p = (entity.activeDescriptors || []).map(d => ({ d, row: latest(rows, d, 'P') })).filter(x => x.row).sort((a,b) => timeOf(b.row)-timeOf(a.row))[0]; const q = (entity.reactiveDescriptors || []).map(d => ({ d, row: latest(rows, d, 'Q') })).filter(x => x.row).sort((a,b) => timeOf(b.row)-timeOf(a.row))[0];
    if (!p && !q) return { loadingPct: null, reason: 'Veri yok', capacityMva: c };
    const pv = p ? Math.abs(valueOf(p.row) * (p.d.formulaSign || 1)) : null; const qv = q ? Math.abs(valueOf(q.row) * (q.d.formulaSign || 1)) : 0;
    // Map loading semantics: P exists -> sqrt(P²+Q²); only Q can still be a usable magnitude.
    const magnitude = Number.isFinite(pv) ? Math.hypot(pv, Number.isFinite(qv) ? qv : 0) : Number.isFinite(qv) ? qv : null;
    const timestamp = new Date(Math.max(p ? timeOf(p.row) : 0, q ? timeOf(q.row) : 0)); if (!Number.isFinite(magnitude) || now - timestamp.getTime() > 3600000) return { loadingPct: null, reason: 'Bayat veya geçersiz veri', capacityMva: c, valueTimestamp: Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null };
    return { loadingPct: magnitude / c * 100, capacityMva: c, activeMw: pv, reactiveMvar: qv, valueTimestamp: timestamp.toISOString(), reason: '' };
  }
  return { evaluate, capacity, latest };
}));
