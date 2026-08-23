const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('voltage keeps the metric row visible and uses the selected 66/154/400 kV scope', () => {
  const runtime = source('map/scada-v2-runtime.js');
  const overlay = source('map/map-v2-runtime.js');
  assert.match(runtime, /metricRow\.classList\.remove\('hidden'\)/);
  assert.doesNotMatch(runtime, /metricRow\.classList\.toggle\('hidden', modeConfig\.domain === 'bara'\)/);
  assert.match(runtime, /new Set\(\['66', '154', '400'\]\)/);
  assert.match(overlay, /\['400', '154', '66'\]/);
});

test('fresh identical map scope is skipped while manual refresh remains force-fresh', () => {
  const runtime = source('map/scada-v2-runtime.js');
  assert.match(runtime, /function getScadaScopeSignature/);
  assert.match(runtime, /hasFreshSuccessfulScope\(scopeSignature\)/);
  assert.match(runtime, /triggerType !== 'manual' && !options\.forceFresh/);
  assert.match(runtime, /forceFresh: triggerType === 'manual' \|\| Boolean\(options\.forceFresh\)/);
});

test('obsolete map scope stops at a batch boundary and returns cancelled', async () => {
  const queryPath = path.join(root, 'background', 'query-service.js');
  delete require.cache[require.resolve(queryPath)];
  let resolveFirst;
  global.chrome = { runtime: { sendMessage: () => Promise.resolve() } };
  global.WebSCADAAuth = { loadConfig: async () => ({}) };
  global.WebSCADAApi = { fetchChart: async () => new Promise(resolve => { resolveFirst = resolve; }) };
  const query = require(queryPath);
  const pending = query.fetchBatches({ requestId: 'scope-change', mapScopeRequest: true, measurementIds: ['1', '2'], batchSize: 1 }, (ids, config) => ({ ids, config }));
  await new Promise(resolve => setImmediate(resolve));
  query.cancelMapRequest('scope-change');
  resolveFirst({ ok: true, data: { result: [{ data: [] }] }, authMode: 'session' });
  const result = await pending;
  assert.equal(result.errorType, 'CANCELLED_SCOPE_CHANGED');
  assert.equal(result.meta.completedBatches, 1);
  delete global.chrome; delete global.WebSCADAAuth; delete global.WebSCADAApi;
});

test('discarded and cancelled operation stages are terminal and do not keep progress open', () => {
  const runtime = source('map/scada-v2-runtime.js');
  assert.match(runtime, /new Set\(\['done', 'error', 'discarded', 'cancelled'\]\)/);
  assert.match(runtime, /stage: 'cancelled', progressPct: 100/);
  assert.match(runtime, /status: 'cancelled', stage: 'cancelled'/);
});
