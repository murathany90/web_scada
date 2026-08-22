const test = require('node:test');
const assert = require('node:assert/strict');
const normalizer = require('../core/query-normalizer.js');
const resolver = require('../core/entity-resolver.js');
const scada = require('../map/scada-common.js');
const workspace = require('../core/workspace-utils.js');

const entity = { id: 'line-1', kind: 'hat', name: '400kV DAVUTPAŞA-YILDIZTEPE', startTm: 'DAVUTPAŞA', endTm: 'YILDIZTEPE', scada: {
  active: { ids: ['p-start', 'p-end'], rows: [{ measurementId: 'p-start', terminalSide: 'start', sourceTmName: 'DAVUTPAŞA', targetTmName: 'YILDIZTEPE' }, { measurementId: 'p-end', terminalSide: 'end', sourceTmName: 'YILDIZTEPE', targetTmName: 'DAVUTPAŞA' }] },
  reactive: { ids: ['q-start', 'q-end'], rows: [{ measurementId: 'q-start', terminalSide: 'start', sourceTmName: 'DAVUTPAŞA', targetTmName: 'YILDIZTEPE' }, { measurementId: 'q-end', terminalSide: 'end', sourceTmName: 'YILDIZTEPE', targetTmName: 'DAVUTPAŞA' }] }
} };
const descriptors = resolver.resolveMeasurementDescriptors(entity, ['P', 'Q'], [entity]);
const fixture = [
  { __timestamp: 1787424180000, sinsid: 'p-start', elementName: 'P', 'AVG(maxValue)': 43.98 },
  { __timestamp: 1787424180000, sinsid: 'p-end', elementName: 'P', 'AVG(maxValue)': -23.92 },
  { __timestamp: 1787424180000, sinsid: 'q-start', elementName: 'Q', 'AVG(maxValue)': -35.14 },
  { __timestamp: 1787424180000, sinsid: 'q-end', elementName: 'Q', 'AVG(maxValue)': -52.87 }
];

test('recorded Superset __timestamp fixture preserves Turkey wall-clock and numeric value', () => {
  const result = normalizer.normalizeQueryRows([fixture[0]], entity, descriptors, scada);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].timestamp.getHours(), 18); assert.equal(result.rows[0].timestamp.getMinutes(), 43); assert.equal(result.rows[0].value, 43.98); assert.match(result.rows[0].timestampText, /18:43/);
});
test('multi-terminal P/Q fixture creates exactly four unique terminal-aware series', () => {
  const result = normalizer.normalizeQueryRows(fixture, entity, descriptors, scada);
  assert.equal(result.rows.length, 4); assert.equal(new Set(result.rows.map((row) => row.seriesKey)).size, 4); assert.equal(new Set(result.rows.map((row) => row.seriesLabel)).size, 4); assert.ok(result.rows.every((row) => row.timestampMs));
});
test('normalized CSV uses Turkish runtime columns and preserves terminal data', () => {
  const rows = normalizer.normalizeQueryRows(fixture, entity, descriptors, scada).rows; const csvRows = normalizer.normalizedCsvRows(rows);
  assert.deepEqual(Object.keys(csvRows[0]), ['Zaman', 'ZamanDilimi', 'Varlik', 'VarlikTipi', 'Terminal', 'KaynakTM', 'HedefTM', 'SINSID', 'Olcum', 'Birim', 'Deger', 'Kalite']); assert.match(csvRows[0].Terminal, /DAVUTPAŞA/);
});
test('effective grain reports server PT1M response even when PT5M was requested', () => {
  const rows = [0, 60000, 120000, 180000].map((offset) => ({ seriesKey: 'a', timestampMs: 1787424180000 + offset })); const grain = normalizer.effectiveGrain(rows);
  assert.equal(grain.ms, 60000); assert.equal(grain.text, '~1 dk');
});
test('normalizer counts invalid timestamp and duplicate logical response rows', () => {
  const result = normalizer.normalizeQueryRows([fixture[0], fixture[0], { ...fixture[0], __timestamp: 'bad' }], entity, descriptors, scada);
  assert.equal(result.stats.validRows, 1); assert.equal(result.stats.duplicateLogicalRow, 1); assert.equal(result.stats.invalidTimestamp, 1);
});
test('descriptor resolver carries terminal metadata and metric-specific coverage', () => {
  assert.equal(descriptors.length, 4); assert.equal(descriptors[0].sourceTmName, 'DAVUTPAŞA'); assert.equal(descriptors[0].unit, 'MW'); assert.deepEqual(resolver.metricCoverage(entity), { P: 2, Q: 2, U: 0, S: 0, I: 0 });
});
test('pagination remains real pagination and conservative one-minute guardrail blocks oversized query', () => {
  assert.equal(workspace.pageSlice(Array.from({ length: 4458 }), 1, 100).rows.length, 100); const check = workspace.guardrail(300, 0, 7 * 86400000, 'PT15M'); assert.ok(check.conservativeEstimate > check.requestedEstimate); assert.equal(check.ok, false);
});
test('query workspace uses normalizer, exact map selection and no silent 1000 row truncation', () => {
  const fs = require('node:fs'); const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(source, /WebSCADAQueryNormalizer\.normalizeQueryRows/); assert.match(source, /state\.selection = \{ kind, id: entity\.id/); assert.ok(!source.includes('queryRows.slice(0,1000)'));
});
