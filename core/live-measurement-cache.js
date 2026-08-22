(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADALiveMeasurementCache = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY = 'webscadaLiveMeasurementCache'; const TTL_MS = 5 * 60 * 1000; const LIMIT = 2000;
  const idOf = row => String(row?.sinsid ?? row?.measurementId ?? ''); const elementOf = row => String(row?.elementName ?? '');
  const timeOf = row => { const value = row?.__time ?? row?.timestamp ?? row?.['MAX(__time)']; const time = new Date(value).getTime(); return Number.isFinite(time) ? time : NaN; };
  const keyOf = row => `${idOf(row)}|${elementOf(row)}`;
  function usable(entry, semantics, now = Date.now()) { return entry?.semantics === semantics && Number(entry?.fetchedAt) > now - TTL_MS && Number.isFinite(timeOf(entry.row)) && now - timeOf(entry.row) <= TTL_MS; }
  async function read(ids, semantics, now = Date.now()) { const data = await chrome.storage.local.get(KEY); const entries = Object.values(data[KEY] || {}).filter(entry => usable(entry, semantics, now)); const wanted = new Set((ids || []).map(String)); const rows = entries.filter(entry => wanted.has(idOf(entry.row))).map(entry => entry.row); const present = new Set(rows.map(idOf)); return { rows, reusedIds: [...wanted].filter(id => present.has(id)), missingIds: [...wanted].filter(id => !present.has(id)) }; }
  async function merge(rows, semantics, source = 'network', fetchedAt = Date.now()) { const data = await chrome.storage.local.get(KEY); const cache = data[KEY] || {}; (rows || []).filter(row => idOf(row) && elementOf(row) && Number.isFinite(timeOf(row))).forEach(row => { const key = `${semantics}:${keyOf(row)}`; const existing = cache[key]; if (!existing || timeOf(existing.row) <= timeOf(row)) cache[key] = { row, semantics, source, sourceTimestamp: new Date(timeOf(row)).toISOString(), fetchedAt }; }); const kept = Object.entries(cache).sort((a, b) => Number(b[1].fetchedAt || 0) - Number(a[1].fetchedAt || 0)).slice(0, LIMIT); await chrome.storage.local.set({ [KEY]: Object.fromEntries(kept) }); return kept.length; }
  return { KEY, TTL_MS, idOf, elementOf, timeOf, keyOf, usable, read, merge };
}));
