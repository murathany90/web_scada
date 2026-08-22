const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chart = require('../core/query-chart.js');

const at = Date.parse('2026-08-22T12:00:00Z');
const row = (metric, terminalSide, value, offset = 0) => ({
  entityId: 'hat-1', metric, terminalSide, value, timestampMs: at + offset,
  seriesKey: `hat-1|${terminalSide}|${metric}`, seriesLabel: `${terminalSide === 'start' ? 'Merkez A' : 'Merkez B'} | ${metric}`
});
const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('multi-pane chart keeps terminal P/Q series and derives MVA only from matched pairs', () => {
  const rows = [row('P', 'start', 100), row('Q', 'start', -20), row('P', 'end', 60), row('Q', 'end', 30), row('U', 'start', 154), row('I', 'start', 180)];
  const panes = chart.buildPanes(rows, { kind: 'hat', summerCapacityMva: 180 });
  assert.deepEqual(panes.map((pane) => pane.key), ['mw', 'mvar', 'mva', 'voltage', 'current']);
  assert.equal(panes.find((pane) => pane.key === 'mw').series.length, 2);
  assert.equal(panes.find((pane) => pane.key === 'mvar').series.length, 2);
  assert.equal(panes.find((pane) => pane.key === 'mva').series.length, 2);
  assert.equal(panes.find((pane) => pane.key === 'mva').series[0].points[0].value, Math.hypot(100, -20));
  assert.deepEqual(panes.find((pane) => pane.key === 'mva').refs, [{ value: 180, label: 'Yaz kapasitesi' }]);
  assert.ok(!chart.buildPanes([row('P', 'start', 100)], {}).some((pane) => pane.key === 'mva'));
});

test('chart zoom and pan preserve a bounded time range without client resampling', () => {
  const full = { start: at, end: at + 3_600_000 }; const range = { ...full };
  const zoomed = chart.rangeAfterWheel(range, full, .5, true);
  assert.ok(zoomed.end - zoomed.start < range.end - range.start);
  const moved = chart.rangeAfterPan(zoomed, full, -.25);
  assert.equal(moved.end - moved.start, zoomed.end - zoomed.start);
  assert.ok(moved.start >= full.start && moved.end <= full.end);
  const chartSource = source('core/query-chart.js');
  assert.match(chartSource, /addEventListener\('dblclick'/);
  assert.match(chartSource, /gap \? 'M' : 'L'/);
  assert.match(chartSource, /minMaxDownsample/);
});

test('reference lines reuse only verified map capacity and voltage semantics', () => {
  assert.deepEqual(chart.capacityLines({ kind: 'hat', summerCapacityMva: 100, winterCapacityMva: 120 }), [{ value: 100, label: 'Yaz kapasitesi' }, { value: 120, label: 'Kış kapasitesi' }]);
  assert.deepEqual(chart.capacityLines({ kind: 'trafo', onafMva: 75 }), [{ value: 75, label: 'Kapasite' }]);
  assert.deepEqual(chart.capacityLines({ kind: 'bara', onafMva: 75 }), []);
  assert.deepEqual(chart.voltageLines({ kv: 66 }), [{ value: 66, label: '66 kV nominal' }]);
});

test('native and derived MVA remain separate chart series', () => {
  const panes = chart.buildPanes([row('P','start',100),row('Q','start',20),row('S','start',103)], { kind:'hat' });
  const mva = panes.find((pane) => pane.key === 'mva'); assert.equal(mva.series.length, 2);
  assert.ok(mva.series.some((series) => /Ölçülen MVA/.test(series.label))); assert.ok(mva.series.some((series) => /Hesaplanan MVA/.test(series.label)));
  assert.match(source('core/query-chart.js'), /formatTick/); assert.match(source('core/query-chart.js'), /ref\.label/);
});

test('v0.3 data/query UI removes normal query table but keeps audit IDs in CSV only', () => {
  const html = source('app.html'); const app = source('app.js');
  assert.match(html, /id="dataYtm"/); assert.match(html, /id="dataTm"/); assert.match(html, /id="dataKv"/); assert.match(html, /id="queryChart"/);
  assert.ok(!html.includes('query-table-toolbar')); assert.ok(!html.includes('queryRows'));
  assert.match(app, /WebSCADAYtbsHierarchy\.create/);
  assert.match(app, /VarlikID:e\.id/); assert.match(app, /SINSID:d\.measurementId/); assert.match(app, /BM:bm\(e\)/);
  assert.match(app, /WebSCADAQueryChart\.mount/);
  assert.match(app, /window\.applyTheme/); assert.match(app, /document\.documentElement\.dataset\.theme/);
  assert.match(app, /WebSCADASelection\.subscribe/);
  assert.ok(!app.includes('6 saat'));
});
