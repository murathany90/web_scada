const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reactive = require('../core/scada-reactive.js');
const settings = require('../core/webscada-settings.js');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('distribution and transmission transformers use the same authoritative scope filter', () => {
  const entities = [
    { id: 'd', type: 'distribution' },
    { id: 't', type: 'transmission' },
    { id: 'u', type: 'unknown' }
  ];
  assert.deepEqual(reactive.filterTrafosForScada(entities, 'trafo-dist').map(entity => entity.id), ['d']);
  assert.deepEqual(reactive.filterTrafosForScada(entities, 'trafo-trans').map(entity => entity.id), ['t']);
  const runtime = source('map/scada-v2-runtime.js');
  const overlay = source('map/map-v2-runtime.js');
  assert.match(runtime, /REACTIVE\.filterTrafosForScada\(allVisible, state\.filters\.scadaListEntity\)/);
  assert.match(runtime, /const source = getVisibleTrafoEntitiesForScadaScope\(\)/);
  assert.match(overlay, /globalThis\.getVisibleTrafoEntitiesForScadaScope\?\.\(\)/);
  assert.match(runtime, /queueScadaScopeFetch\(\{ trigger: 'trafo-class-change' \}\)/);
});

test('fixed reactive references use 120 MVar at 154 kV and 300 MVar at 400 kV and persist valid overrides', () => {
  const defaults = reactive.normalizeReferences({});
  assert.equal(reactive.referenceForKv(154, defaults), 120);
  assert.equal(reactive.reactiveReferenceRatioPct(60, -30, reactive.referenceForKv(154, defaults)), 50);
  assert.equal(reactive.referenceForKv(400, defaults), 300);
  assert.equal(reactive.referenceForKv('400 kV', defaults), 300);
  assert.equal(reactive.reactiveReferenceRatioPct(150, -40, reactive.referenceForKv(400, defaults)), 50);
  assert.deepEqual(reactive.normalizeReferences({ kv154: 40, kv400: 40 }), defaults);
  const saved = settings.normalize({ reactiveReference154Mvar: 135, reactiveReference400Mvar: 360 });
  assert.equal(saved.reactiveReference154Mvar, 135);
  assert.equal(saved.reactiveReference400Mvar, 360);
  assert.match(source('settings-reactive-reference.js'), /WEBSCADA_SETTINGS_SAVE/);
  const runtime = source('map/scada-v2-runtime.js');
  assert.match(runtime, /REACTIVE\.reactiveReferenceRatioPct/);
  assert.doesNotMatch(runtime, /computeReactiveRatioPct/);
});

test('line reactive terminals retain their own normalized direction and independent arrow identity', () => {
  const qStart = reactive.terminalDirectionValue(82.4, 82.4, 'start');
  const qEnd = reactive.terminalDirectionValue(74.1, 74.1, 'end');
  assert.equal(qStart, 82.4);
  assert.equal(qEnd, -74.1);
  assert.equal(reactive.terminalArrowDirection('start', qStart), 'forward');
  assert.equal(reactive.terminalArrowDirection('end', qEnd), 'forward');
  assert.equal(reactive.terminalArrowDirection('end', 74.1), 'reverse');
  assert.equal(reactive.dominantTerminalSide(qStart, qEnd), 'start');
  assert.equal(reactive.terminalDirectionsMismatch(qStart, qEnd), false);
  assert.equal(reactive.terminalDirectionsMismatch(qStart, 74.1), true);
  const runtime = source('map/scada-v2-runtime.js');
  assert.match(runtime, /resolveHatReactiveTerminals/);
  assert.match(runtime, /REACTIVE\.terminalDirectionValue\(terminal\?\.normalizedValue, terminal\?\.directionValue, side\)/);
  assert.match(runtime, /qStart:/);
  assert.match(runtime, /qEnd:/);
  assert.match(runtime, /data-terminal-arrow/);
  assert.match(runtime, /data-terminal-key/);
});

test('Hat MVar renders Q first and queues a separate U/kV request without MW scope', () => {
  const runtime = source('map/scada-v2-runtime.js');
  const liveTypes = runtime.slice(runtime.indexOf('function getLiveMetricTypes'), runtime.indexOf('function getHistoryMetricTypes'));
  assert.doesNotMatch(liveTypes, /\['active', 'reactive'\]/);
  assert.match(liveTypes, /return \[modeConfig\.primaryMetric\]/);
  const fetch = runtime.slice(runtime.indexOf('scadaDoFetch = async function'), runtime.indexOf('function getMetricLegendCounts'));
  const renderAt = fetch.indexOf('requestScadaOverlayRender({ styleOnly: true })');
  const voltageAt = fetch.indexOf('void queueHatReactiveVoltageFetch(scope, requestContext');
  assert.ok(renderAt >= 0 && voltageAt > renderAt);
  const stagedScope = runtime.slice(runtime.indexOf('function buildHatReactiveVoltageScope'), runtime.indexOf('function isHatReactiveVoltageScopeCurrent'));
  const stagedFetch = runtime.slice(runtime.indexOf('async function queueHatReactiveVoltageFetch'), runtime.indexOf('refreshScadaVisibleSummary = function'));
  assert.match(stagedScope, /elementNames: \['U'\]/);
  assert.match(stagedFetch, /type: 'SCADA_FETCH'/);
  assert.match(stagedFetch, /isHatReactiveVoltageScopeCurrent/);
  assert.doesNotMatch(stagedFetch, /state\.scada\.(?:currentScope|fetchSeq|entityMetricsByKey|lineFlowByLineId)\s*=/);
  assert.doesNotMatch(stagedFetch, /MAP_REFRESH_CONTEXT/);
  assert.doesNotMatch(fetch, /await queueHatReactiveVoltageFetch/);
});

test('staged voltage result is deterministic per TM and voltage level and updates details without map labels', () => {
  const runtime = source('map/scada-v2-runtime.js');
  const overlay = source('map/map-v2-runtime.js');
  assert.match(runtime, /function selectHatReactiveVoltages/);
  assert.match(runtime, /isBetterVoltagePanelRepresentative\(candidate, byTmKey\.get\(tmKey\)\)/);
  assert.match(runtime, /\|kv:\$\{level\}/);
  assert.match(runtime, /getHatReactiveVoltageForTm/);
  assert.match(runtime, /refreshOpenHatReactiveDetails\(\)/);
  assert.match(overlay, /getHatReactiveVoltageOverlay/);
  assert.match(overlay, /isHatReactiveOverlay/);
  assert.match(overlay, /Gerilim ölçüm zamanı/);
  assert.doesNotMatch(overlay, /appendPillLabelCentered\(group, point\.x, point\.y - 17/);
});
