(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADAAlarmCatalog = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const numeric = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  const pick = (...values) => values.map(numeric).find(Boolean) || null;
  function typeOf(entity, supplied) { return supplied === 'trafo' || entity.kind === 'trafo' ? 'trafo' : 'hat'; }
  function tmName(entity) { return entity.kind === 'hat' ? `${entity.startTm || ''} ↔ ${entity.endTm || ''}` : String(entity.tmName || entity.trafoMerkezi || entity.tm || ''); }
  function descriptors(entity, metric) { const field = metric === 'P' ? 'active' : 'reactive'; return (entity?.scada?.[field]?.rows || []).map((row) => ({ id: String(row.measurementId || ''), metric, terminalKey: row.terminalSide || row.sourceTmName || row.formulaStationCode || '', formulaSign: Number.isFinite(Number(row.formulaSign ?? row.polarizationSign)) ? Number(row.formulaSign ?? row.polarizationSign) : 1 })).filter((row) => row.id); }
  function build(network, hierarchy) {
    const result = []; const add = (entity, suppliedType) => { const active = descriptors(entity, 'P'); const reactive = descriptors(entity, 'Q'); const kind = typeOf(entity, suppliedType); const winterCapacityMva = kind === 'hat' ? pick(entity.winterCapacityMva, entity.summerCapacityMva) : pick(entity.ofafMva, entity.onafMva, entity.onanMva, entity.bazGucuMva); const summerCapacityMva = kind === 'hat' ? pick(entity.summerCapacityMva, entity.winterCapacityMva) : winterCapacityMva; const membership = entity.__ytbs || hierarchy?.memberships?.(entity) || {}; result.push({ entityId: String(entity.id), entityName: entity.displayName || entity.name || String(entity.id), entityType: kind, ytm: membership.ytm || entity.ytmNames || [], bm: membership.bm || [], tm: tmName(entity), kv: String(entity.kvBucket || entity.kv || entity.primaryKv || entity.gerilimKv || ''), winterCapacityMva, summerCapacityMva, activeDescriptors: active, reactiveDescriptors: reactive }); };
    (network?.hatLines || []).forEach(entity => add(entity, 'hat')); (network?.trafos || []).forEach(entity => add(entity, 'trafo')); return result;
  }
  function resolve(rule, catalog) { const all = Array.isArray(catalog) ? catalog : []; const scope = rule?.scopeType || 'selected'; if (scope === 'all-hats') return all.filter(x => x.entityType === 'hat'); if (scope === 'all-trafos') return all.filter(x => x.entityType === 'trafo'); if (scope === 'filter') { const f = rule.filters || {}; return all.filter(x => (!f.type || x.entityType === f.type) && (!f.ytm || x.ytm.includes(f.ytm)) && (!f.bm || x.bm.includes(f.bm)) && (!f.tm || String(x.tm).includes(f.tm)) && (!f.kv || x.kv === String(f.kv))); } const ids = new Set((rule?.entityIds || []).map(String)); return all.filter(x => ids.has(x.entityId)); }
  function ids(entries) { return [...new Set((entries || []).flatMap(x => [...x.activeDescriptors, ...x.reactiveDescriptors]).map(x => x.id))]; }
  return { build, resolve, ids };
}));
