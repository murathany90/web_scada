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

  const namedCableWithoutCableSegment = cable.classify({
    name: 'KABLO yazan ama havai hat',
    lengthKm: 10,
    characteristic: '10.000 km 154kV Hawk (477 MCM) A2,B2,C2,D2, OPGW 95'
  });
  assert.deepEqual(namedCableWithoutCableSegment, { cableLengthKm: 0, cableRatio: 0, cableDominant: false });
  assert.deepEqual(cable.classify({ lengthKm: 1, characteristic: '1.000 km tanımsız karakteristik' }), {
    cableLengthKm: null,
    cableRatio: null,
    cableDominant: false
  });
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
  assert.match(mapRuntime, /buildHatModelTooltipHtml/);
  assert.match(scadaRuntime, /getHatCableBadgeHtml/);
  assert.match(scadaRuntime, /buildHatModelTooltipHtml\(hat\)/);
});
