const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cable = require('../core/hat-cable-classification.js');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const model = require('../data/kml_layers_v2.json');

test('cable classifier sums explicit Kılıf segments and never infers cable from the name', () => {
  const fullCable = cable.classify({
    lengthKm: 9.495,
    characteristic: '9.495 km 400kV 2000mm2 Bakır, Kurşun Kılıf'
  });
  assert.deepEqual(fullCable, { cableLengthKm: 9.495, cableRatio: 1, cableDominant: true });

  const mixed = cable.classify({
    lengthKm: 13.565,
    characteristic: '8.793 km 154kV Pheasant (1272 MCM) CP1,CP2,CP3,CP4, OPGW 96\n4.772 km 154kV 1000mm2 Bakır, Bakır Kılıf'
  });
  assert.equal(mixed.cableLengthKm, 4.772);
  assert.equal(mixed.cableDominant, false);
  assert.ok(Math.abs(mixed.cableRatio - (4.772 / 13.565)) < 1e-12);

  const namedCableWithoutCableSegment = {
    name: 'KABLO yazan ama havai hat',
    lengthKm: 10,
    characteristic: '10.000 km 154kV Hawk (477 MCM) A2,B2,C2,D2, OPGW 95'
  };
  const namedCableModel = cable.classify(namedCableWithoutCableSegment);
  assert.deepEqual(namedCableModel, { cableLengthKm: 0, cableRatio: 0, cableDominant: false });
  assert.deepEqual(cable.classify({ lengthKm: 1, characteristic: '1.000 km 154kV XLPE (1000 MCM) Kılıf' }), {
    cableLengthKm: null,
    cableRatio: null,
    cableDominant: false
  });
  assert.deepEqual(cable.classify({ lengthKm: 1, characteristic: '1.000 km tanımsız karakteristik' }), {
    cableLengthKm: null,
    cableRatio: null,
    cableDominant: false
  });
  assert.equal(cable.summarizeCharacteristic({
    lengthKm: 1,
    cableLengthKm: null,
    cableRatio: null,
    characteristic: '1.000 km 154kV XLPE (1000 MCM) Kılıf'
  }).summary, '1 km · Kablo —');
  assert.equal(cable.summarizeCharacteristic({
    ...namedCableWithoutCableSegment,
    ...namedCableModel
  }).summary, '10 km · Kablo %0');
  const summary = cable.summarizeCharacteristic({
    lengthKm: 272,
    cableLengthKm: 185,
    cableRatio: 185 / 272,
    characteristic: [
      '145.4 km 400kV Pheasant (1272 MCM) PA,PB,PC,PD,PE, OPGW 96',
      '69.1 km 400kV 2B,Rail (954 MCM) 3A1,3B1,3C1, OPGW 96',
      '24.2 km 400kV Pheasant (1272 MCM) PA,PB,PC,PD,PE, OPGW 96',
      '20.0 km 400kV Hawk (477 MCM) A2,B2,C2,D2, OPGW 95',
      '13.3 km 400kV Kablo 2000mm2 Bakır, Kurşun Kılıf'
    ].join('\n')
  });
  assert.deepEqual(summary.segments, ['145 km Phe. (1272 MCM)', '69 km 2B-Rail (954 MCM)', '24 km Phe. (1272 MCM)']);
  assert.equal(summary.moreCount, 2);
  assert.equal(summary.summary, '272 km · Kablo %68 · 185 km');
  assert.ok(summary.segments.every((segment) => !segment.includes('400kV')));
});

test('model classification and render integration keep cable metadata out of the fetch path', () => {
  const totals = model.hatLines.reduce((result, hat) => {
    const classified = cable.classify(hat);
    if (Number.isFinite(classified.cableRatio)) result.known += 1;
    else result.unknown += 1;
    if (classified.cableDominant) result.dominant += 1;
    return result;
  }, { known: 0, unknown: 0, dominant: 0 });
  assert.deepEqual(totals, { known: 2378, unknown: 0, dominant: 108 });

  const indexRuntime = source('map/map-v2-runtime.js');
  const mapRuntime = source('map/map-modern.js');
  const scadaRuntime = source('map/scada-v2-runtime.js');
  assert.match(indexRuntime, /WebSCADAHatCable\?\.classify\?\.\(hat\)/);
  assert.match(mapRuntime, /hat-cable-glow/);
  assert.match(mapRuntime, /pointer-events', 'none'/);
  assert.match(mapRuntime, /summarizeCharacteristic\?\.\(hat, 3\)/);
  assert.match(mapRuntime, /formatHatTooltipTimestamp/);
  const mapHover = mapRuntime.slice(mapRuntime.indexOf('function buildHatHoverTooltipHtml'), mapRuntime.indexOf('function partitionSelectedHats'));
  assert.doesNotMatch(mapHover, /Model:/);
  assert.match(scadaRuntime, /getHatCableBadgeHtml/);
  assert.match(scadaRuntime, /function buildHatActiveTooltipHtml/);
  assert.match(scadaRuntime, /function buildHatReactiveTerminalTooltipLine/);
  assert.match(scadaRuntime, /buildHatModelTooltipHtml\(hat\)/);
  const tmHover = indexRuntime.slice(indexRuntime.indexOf('function buildTmHoverTooltip'), indexRuntime.indexOf('function buildTrafoHoverTooltip'));
  assert.match(tmHover, /U —/);
  assert.match(tmHover, /formatHatTooltipTimestamp/);
});
