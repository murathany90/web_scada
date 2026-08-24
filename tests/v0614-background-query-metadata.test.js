const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const functionSource = (text, name) => {
  const start = text.indexOf(`function ${name}()`);
  if (start < 0) throw new Error(`${name} not found`);
  const brace = text.indexOf('{', start); let depth = 0;
  for (let index = brace; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') { depth -= 1; if (!depth) return text.slice(start, index + 1); }
  }
  throw new Error(`${name} boundary not found`);
};
const element = () => ({ textContent: '', title: '', className: '', style: {}, classList: { toggle() {} } });

test('background result carries timing and transport metadata into the atomic apply path', () => {
  const refresh = source('background/map-refresh.js'); const runtime = source('map/scada-v2-runtime.js');
  assert.match(refresh, /resultEntry = \{ at: Date\.now\(\), startedAt, completedAt, durationMs, returnedRows: rows/);
  const apply = runtime.slice(runtime.indexOf('async function applyBackgroundMapResult'), runtime.indexOf('function handleDashboardMapSlotActive'));
  const dataAt = apply.indexOf('applyGenericScadaSnapshot(rows, scope)'); const metaAt = apply.indexOf('updateScadaFetchMeta(fetchMeta, false)'); const uiAt = apply.indexOf('updateScadaCardUI()'); const persistAt = apply.indexOf('void persistScadaDashboardSnapshot');
  assert.ok(dataAt >= 0 && dataAt < metaAt && metaAt < uiAt && uiAt < persistAt);
  assert.match(apply, /triggerType: 'auto'/); assert.match(apply, /triggerLabel: 'Otomatik \(Arka Plan\)'/); assert.match(apply, /rawRows,/); assert.match(apply, /normalizedRows: entries\.length/); assert.match(apply, /httpStatus: transport\.httpStatus/);
});

test('Son Sorgu DOM renders newer automatic metadata instead of retained manual values', () => {
  const runtime = source('map/scada-v2-runtime.js'); const elements = Object.fromEntries(['scadaFetchBadge', 'scadaFetchMessage', 'scadaFetchSummary', 'scadaFetchClosedSummary', 'scadaFetchTrigger', 'scadaFetchStart', 'scadaFetchEnd', 'scadaFetchDuration', 'scadaFetchRawRows', 'scadaFetchNormalizedRows', 'scadaFetchVisibleRows', 'scadaFetchTransport'].map(id => [id, element()]));
  const sandbox = { Date, Number, Math, state: { scada: { fetchMeta: { status: 'success', triggerLabel: 'Otomatik (Arka Plan)', startedAt: '2026-08-24T20:02:00.000Z', finishedAt: '2026-08-24T20:02:24.000Z', durationMs: 24000, rawRows: 531, normalizedRows: 299, visibleMatched: 277, visibleTotal: 312, authMode: 'session', httpStatus: 200 }, operationMeta: {}, visibleSummary: { available: 299, total: 312 }, fetchInProgress: false } }, document: { getElementById: id => elements[id] || null, querySelector: () => null } };
  vm.runInNewContext(`${functionSource(runtime, 'syncScadaFetchUi')}; syncScadaFetchUi();`, sandbox);
  assert.equal(elements.scadaFetchTrigger.textContent, 'Otomatik (Arka Plan)'); assert.match(elements.scadaFetchStart.textContent, /23:02:00|20:02:00/); assert.equal(elements.scadaFetchRawRows.textContent, '531'); assert.equal(elements.scadaFetchNormalizedRows.textContent, '299'); assert.equal(elements.scadaFetchVisibleRows.textContent, '277/312'); assert.match(elements.scadaFetchTransport.textContent, /session.*200/);
});

test('background apply uses the fresh visible summary for quality UI and snapshot metadata', () => {
  const runtime = source('map/scada-v2-runtime.js'); const apply = runtime.slice(runtime.indexOf('async function applyBackgroundMapResult'), runtime.indexOf('function handleDashboardMapSlotActive'));
  assert.match(apply, /const visibleSummary = applyGenericScadaSnapshot\(rows, scope\)/); assert.match(apply, /visibleMatched: visibleSummary\.matched/); assert.match(apply, /visibleTotal: visibleSummary\.total/);
  assert.match(runtime, /fetchMeta: \{[\s\S]*startedAt: serializeDateLike\(state\.scada\.fetchMeta\?\.startedAt\)/); assert.match(runtime, /const elKalite = document\.getElementById\('scadaKalite'\)/); assert.match(runtime, /Gorunen kalite: \$\{summary\.matched \|\| 0\}\/\$\{summary\.total \|\| 0\}/);
});

test('storage failure cannot delay UI and rejected or failed network results keep last-good data safe', () => {
  const runtime = source('map/scada-v2-runtime.js'); const apply = runtime.slice(runtime.indexOf('async function applyBackgroundMapResult'), runtime.indexOf('function handleDashboardMapSlotActive'));
  assert.match(apply, /void persistScadaDashboardSnapshot\(\{ force: true, source: 'background-worker' \}\)/); assert.doesNotMatch(apply, /await persistScadaDashboardSnapshot/);
  assert.match(apply, /if \(partial\) \{ const merged = mergePartialBackgroundRows[\s\S]*MAP_BACKGROUND_PARTIAL_REJECTED[\s\S]*return \{ ok: false, skipped: true, reason: 'partial-network-unsafe' \}/); assert.match(runtime, /hasUsableScadaSnapshot\(\)[\s\S]*preserveScadaSnapshotOnError/);
});
