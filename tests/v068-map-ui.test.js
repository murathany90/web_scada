const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('both theme controls use the authoritative tile-refresh path', () => {
  const map = source('map/map-modern.js'); const app = source('app.js'); assert.match(map, /function setWebScadaTheme\(theme\)[\s\S]*requestRender\(\{ forceTiles: true \}\)/); assert.match(map, /window\.setWebScadaTheme = setWebScadaTheme/); assert.match(app, /window\.setWebScadaTheme\(next\)/);
});

test('fetch error and scope discard finalize the visible operation while retaining the snapshot', () => {
  const runtime = source('map/scada-v2-runtime.js'); assert.match(runtime, /function preserveScadaSnapshotOnError/); assert.match(runtime, /stage: 'discarded', progressPct: 100/); assert.match(runtime, /stage: 'error', progressPct: 100/); assert.ok(!runtime.includes('markScadaFlowsUnavailable(errorMessage, result?.errorType'));
});

test('overlay modes persist independently for hat trafo and voltage', () => {
  const map = source('map/map-modern.js'); const runtime = source('map/scada-v2-runtime.js'); assert.match(map, /scadaDisplayModes: \{ hat: 'flow', trafo: 'box', voltage: 'point-label' \}/); assert.match(map, /scadaDisplayModes: state\.filters\.scadaDisplayModes/); assert.match(runtime, /function displayDomain/); assert.match(runtime, /displayModeForDomain/);
});

test('capacity has one Settings source and SCADA card has no editable season toggle', () => {
  const html = source('app.html'); const flow = source('map/scada-flow.js'); assert.ok(!html.includes('scadaSeasonToggle')); assert.ok(!html.includes('btnSeasonWinter')); assert.ok(!flow.includes('btnSeasonSummer')); assert.match(source('settings-view.js'), /state\.scada\.capacitySeason = next\.capacitySeason/);
});

test('rapid scopes coalesce and normal map fetches reuse compatible cache except manual refresh', () => {
  const runtime = source('map/scada-v2-runtime.js'); const query = source('background/query-service.js'); assert.match(runtime, /function queueScadaScopeFetch/); assert.match(runtime, /scopeDebounceTimer/); assert.match(runtime, /liveCacheSemantics: 'map-aggregate'/); assert.match(runtime, /forceFresh: triggerType === 'manual'/); assert.match(query, /completedBatches: results\.length/);
});
