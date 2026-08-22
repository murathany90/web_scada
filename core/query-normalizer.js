(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WebSCADAQueryNormalizer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const METRICS = {
    P: { label: 'MW', unit: 'MW', family: 'power' },
    Q: { label: 'MVar', unit: 'MVar', family: 'power' },
    U: { label: 'Gerilim', unit: 'kV', family: 'voltage' },
    S: { label: 'MVA', unit: 'MVA', family: 'apparent' },
    I: { label: 'Akım', unit: 'A', family: 'current' }
  };
  const metricInfo = (metric) => METRICS[String(metric || '').toUpperCase()] || { label: String(metric || 'Ölçüm'), unit: '', family: 'other' };
  const descriptorMap = (descriptors) => new Map((descriptors || []).map((item) => [String(item.measurementId), item]));
  const text = (date) => date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const terminalLabel = (descriptor) => {
    if (descriptor?.sourceTmName && descriptor?.targetTmName) return `${descriptor.sourceTmName} → ${descriptor.targetTmName}`;
    if (descriptor?.terminalSide) return `Terminal ${descriptor.terminalSide}`;
    return '—';
  };
  function normalizeQueryRows(rawRows, entity, descriptors, common) {
    const scada = common || globalThis.SCADA_COMMON || {};
    const resolveTimestamp = scada.resolveHistoryTimestamp || (() => null);
    const resolveValue = scada.resolveHistoryValue || (() => null);
    const resolveMeasurement = scada.resolveHistoryMeasurementId || ((row) => row?.sinsid || row?.measurementId || null);
    const byId = descriptorMap(descriptors); const rows = []; const seen = new Set();
    const stats = { totalRows: Array.isArray(rawRows) ? rawRows.length : 0, validRows: 0, invalidTimestamp: 0, invalidValue: 0, duplicateLogicalRow: 0 };
    (Array.isArray(rawRows) ? rawRows : []).forEach((raw) => {
      const sinsid = String(resolveMeasurement(raw) || '').trim(); const timestamp = resolveTimestamp(raw); const value = resolveValue(raw);
      if (!timestamp || Number.isNaN(timestamp.getTime())) { stats.invalidTimestamp += 1; return; }
      if (!Number.isFinite(value)) { stats.invalidValue += 1; return; }
      const descriptor = byId.get(sinsid) || {}; const metric = String(raw?.elementName || descriptor.metric || '').toUpperCase() || '—'; const info = metricInfo(metric);
      const timestampMs = timestamp.getTime(); const seriesKey = [descriptor.entityId || entity?.id || '', descriptor.terminalSide || 'unknown', sinsid || 'unknown', metric].join('|');
      const logicalKey = `${seriesKey}|${timestampMs}|${value}`;
      if (seen.has(logicalKey)) { stats.duplicateLogicalRow += 1; return; }
      seen.add(logicalKey); stats.validRows += 1;
      rows.push({ timestamp, timestampMs, timestampText: text(timestamp), rawTimestamp: raw?.__timestamp ?? raw?.__time ?? raw?.timestamp ?? raw?.['MAX(__time)'] ?? null,
        entityId: descriptor.entityId || entity?.id || '', entityName: descriptor.entityName || entity?.displayName || entity?.name || '', entityType: descriptor.entityType || entity?.kind || '',
        terminalSide: descriptor.terminalSide || 'unknown', sourceTmName: descriptor.sourceTmName || null, targetTmName: descriptor.targetTmName || null,
        sinsid, metric, metricLabel: info.label, unit: descriptor.unit || info.unit, value, quality: raw?.quality ?? raw?.dataQuality ?? null,
        seriesKey, seriesLabel: `${terminalLabel(descriptor)} | ${info.label}` });
    });
    return { rows, stats };
  }
  function effectiveGrain(rows) {
    const groups = new Map(); (rows || []).forEach((row) => { if (!groups.has(row.seriesKey)) groups.set(row.seriesKey, []); groups.get(row.seriesKey).push(row.timestampMs); });
    const perSeries = []; groups.forEach((times, key) => { const sorted = [...new Set(times)].sort((a, b) => a - b); const deltas = sorted.slice(1).map((value, index) => value - sorted[index]).filter((value) => value > 0); if (!deltas.length) return; deltas.sort((a, b) => a - b); perSeries.push({ seriesKey: key, ms: deltas[Math.floor(deltas.length / 2)] }); });
    if (!perSeries.length) return { ms: null, text: '—', perSeries: [] };
    const all = perSeries.map((item) => item.ms).sort((a, b) => a - b); const ms = all[Math.floor(all.length / 2)]; const minutes = ms / 60000; return { ms, text: minutes >= 1 ? `~${Math.round(minutes)} dk` : `~${Math.round(ms / 1000)} sn`, perSeries };
  }
  function minMaxDownsample(points, limit) {
    if (!Array.isArray(points) || points.length <= limit) return points || []; const bucketSize = Math.ceil(points.length / Math.max(2, Math.floor(limit / 2))); const result = [];
    for (let index = 0; index < points.length; index += bucketSize) { const bucket = points.slice(index, index + bucketSize); let min = bucket[0]; let max = bucket[0]; bucket.forEach((point) => { if (point.value < min.value) min = point; if (point.value > max.value) max = point; }); result.push(min, max); }
    return [...new Map(result.sort((a, b) => a.timestampMs - b.timestampMs).map((item) => [`${item.timestampMs}|${item.value}`, item])).values()];
  }
  function normalizedCsvRows(rows) { return (rows || []).map((row) => ({ Zaman: row.timestampText, ZamanDilimi: 'Europe/Istanbul', Varlik: row.entityName, VarlikTipi: row.entityType, Terminal: terminalLabel(row), KaynakTM: row.sourceTmName || '', HedefTM: row.targetTmName || '', SINSID: row.sinsid, Olcum: row.metricLabel, Birim: row.unit, Deger: row.value, Kalite: row.quality ?? '—' })); }
  return { METRICS, metricInfo, terminalLabel, normalizeQueryRows, effectiveGrain, minMaxDownsample, normalizedCsvRows };
}));
