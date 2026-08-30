(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WebSCADAHatCable = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LENGTH_EPSILON_KM = 0.011;

  function fold(value) {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i');
  }

  function parseSegments(characteristic) {
    const lines = String(characteristic || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    const segments = lines.map((line) => {
      const match = line.match(/^([0-9]+(?:[.,][0-9]+)?)\s*km\b/i);
      const lengthKm = match ? Number(match[1].replace(',', '.')) : null;
      const normalized = fold(line);
      return {
        lengthKm,
        cable: normalized.includes('kilif') || normalized.includes('kablo') || normalized.includes('xlpe'),
        overhead: /\b(?:mcm|opgw|ehs)\b/.test(normalized)
      };
    });
    return segments.every((segment) => Number.isFinite(segment.lengthKm) && segment.lengthKm >= 0)
      ? segments
      : null;
  }

  function classify(hat) {
    const totalLengthKm = Number(hat?.lengthKm);
    const segments = parseSegments(hat?.characteristic);
    if (!(Number.isFinite(totalLengthKm) && totalLengthKm > 0) || !segments) {
      return { cableLengthKm: null, cableRatio: null, cableDominant: false };
    }
    const segmentTotalKm = segments.reduce((sum, segment) => sum + segment.lengthKm, 0);
    if (Math.abs(segmentTotalKm - totalLengthKm) > LENGTH_EPSILON_KM) {
      return { cableLengthKm: null, cableRatio: null, cableDominant: false };
    }
    if (segments.some((segment) => !segment.cable && !segment.overhead)) {
      return { cableLengthKm: null, cableRatio: null, cableDominant: false };
    }
    const cableLengthKm = segments
      .filter((segment) => segment.cable)
      .reduce((sum, segment) => sum + segment.lengthKm, 0);
    const cableRatio = cableLengthKm / totalLengthKm;
    return {
      cableLengthKm,
      cableRatio,
      cableDominant: cableRatio > 0.5
    };
  }

  return { classify, parseSegments, LENGTH_EPSILON_KM };
});
