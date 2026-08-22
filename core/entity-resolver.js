(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADAEntityResolver = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const metricKey = { P: 'active', Q: 'reactive', U: 'voltage', S: 'apparent', I: 'current' };
  function entityType(entity) {
    if (entity?.kind !== 'trafo') return entity?.kind || '';
    const type = globalThis.WebSCADAYtbsHierarchy?.classifyTrafo(entity) || (/iletim/i.test(String(entity.gerilimTuru || '')) ? 'transmission' : 'unknown');
    return type === 'transmission' ? 'trafo-transmission' : type === 'distribution' ? 'trafo-distribution' : 'trafo-unknown';
  }
  function idsForEntity(entity, metrics) {
    const requested = (metrics || []).map(String); const ids = new Set();
    requested.forEach((metric) => (entity?.scada?.[metricKey[metric]]?.ids || []).forEach((id) => ids.add(String(id))));
    return [...ids];
  }
  function resolveMeasurementIds(entity, metrics, allEntities) {
    const direct = idsForEntity(entity, metrics); if (entity?.kind !== 'tm') return direct;
    const tmId = String(entity.id || ''); const children = (allEntities || []).filter((candidate) => String(candidate.tmId || '') === tmId);
    return [...new Set(children.flatMap((candidate) => idsForEntity(candidate, metrics)))];
  }
  function resolveMeasurementDescriptors(entity, metrics, allEntities) {
    const requested = new Set((metrics || []).map(String)); const descriptors = []; const seen = new Set();
    const addEntity = (target) => {
      requested.forEach((metric) => {
        const key = metricKey[metric]; const source = target?.scada?.[key]; const rows = Array.isArray(source?.rows) ? source.rows : []; const rowById = new Map(rows.map((row) => [String(row.measurementId || ''), row]));
        (source?.ids || []).forEach((id) => {
          const measurementId = String(id); if (!measurementId || seen.has(`${target?.id}|${metric}|${measurementId}`)) return; seen.add(`${target?.id}|${metric}|${measurementId}`); const row = rowById.get(measurementId) || {};
          const ordinal = descriptors.filter((item) => item.entityId === String(target?.id || '') && item.metric === metric).length + 1;
          const terminalKey = row.terminalSide || [row.sourceTmName, row.targetTmName, row.formulaStationCode, row.formulaTargetCode, row.candidateSlot, ordinal].filter(Boolean).join('|') || `measurement-${ordinal}`;
          descriptors.push({ measurementId, metric, metricKey: key, unit: ({ P: 'MW', Q: 'MVar', U: 'kV', S: 'MVA', I: 'A' })[metric] || '', terminalSide: row.terminalSide || 'unknown', terminalKey, sourceTmName: row.sourceTmName || null, targetTmName: row.targetTmName || null, sourceSide: row.sourceSide || null, role: row.candidateSlot || row.role || null, polarization: row.polarizationSign ?? row.formulaSign ?? null, element: row.analogName || row.elementName || null, elementName: row.elementName || metric, b1: row.b1Name || null, b2: row.b2Name || null, b3: row.b3Name || null, terminalOrdinal: ordinal, entityId: String(target?.id || ''), entityName: target?.displayName || target?.name || '', entityType: entityType(target) });
        });
      });
    };
    if (entity?.kind !== 'tm') addEntity(entity);
    return descriptors;
  }
  function metricCoverage(entity) { const result = {}; Object.entries(metricKey).forEach(([metric, key]) => { result[metric] = entity?.kind === 'tm' ? 0 : (Array.isArray(entity?.scada?.[key]?.ids) ? entity.scada[key].ids.length : 0); }); return result; }
  function hasScadaMatch(entity) { return entity?.kind !== 'tm' && Object.values(entity?.scada || {}).some((metric) => Array.isArray(metric?.ids) && metric.ids.length); }
  return { metricKey, entityType, idsForEntity, resolveMeasurementIds, resolveMeasurementDescriptors, metricCoverage, hasScadaMatch };
}));
