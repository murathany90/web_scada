(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADAAlarmExemptions = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY = 'webscadaAlarmExemptions'; const SEEDED_KEY = 'alarmExemptionsSeededV1';
  const DEFAULT_HAT_NAMES = ['154kV TEMELLİ - BAYMİNA DGKÇ - I EİH', '154kV TEMELLİ - BAYMİNA DGKÇ - II EİH', '154kV TEMELLİ - BAYMİNA DGKÇ - III EİH'];
  const types = new Set(['hat', 'trafo', 'bara']);
  function normalize(entries) { const used = new Set(); return (Array.isArray(entries) ? entries : []).map(entry => ({ entityId: String(entry?.entityId || ''), entityType: String(entry?.entityType || ''), displayLabel: String(entry?.displayLabel || entry?.entityName || ''), tm: String(entry?.tm || ''), kv: String(entry?.kv || '') })).filter(entry => entry.entityId && types.has(entry.entityType) && !used.has(`${entry.entityType}:${entry.entityId}`) && (used.add(`${entry.entityType}:${entry.entityId}`), true)); }
  function fromEntity(entity) { return { entityId: String(entity.entityId), entityType: String(entity.entityType), displayLabel: entity.entityDisplayName || entity.entityName || String(entity.entityId), tm: entity.tmName || entity.tm || '', kv: String(entity.kv || '') }; }
  function isExempt(entity, entries) { return normalize(entries).some(entry => entry.entityId === String(entity?.entityId) && entry.entityType === String(entity?.entityType)); }
  function filter(entities, entries) { return (entities || []).filter(entity => !isExempt(entity, entries)); }
  function seed(entries, seeded, catalog) { if (seeded) return { exemptions: normalize(entries), seeded: true, changed: false }; const defaults = (catalog || []).filter(entity => entity.entityType === 'hat' && DEFAULT_HAT_NAMES.includes(entity.entityName)).map(fromEntity); const exemptions = normalize([...(entries || []), ...defaults]); return { exemptions, seeded: true, changed: true }; }
  return { KEY, SEEDED_KEY, DEFAULT_HAT_NAMES, normalize, fromEntity, isExempt, filter, seed };
}));
