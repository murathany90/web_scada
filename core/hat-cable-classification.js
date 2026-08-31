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
        text: line,
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
    if (segments.some((segment) => segment.cable === segment.overhead)) {
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

  function formatShortSegment(segment) {
    const lengthKm = Number(segment?.lengthKm);
    const lengthText = Number.isFinite(lengthKm) ? `${Math.round(lengthKm)} km` : '— km';
    const text = String(segment?.text || '')
      .replace(/^\s*[0-9]+(?:[.,][0-9]+)?\s*km\s*/i, '')
      .replace(/\b(?:66|154|220|380|400)\s*kV\b\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const areaMatch = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*mm(?:2|²)\b/i);
    const areaText = areaMatch ? `${Math.round(Number(areaMatch[1].replace(',', '.')))} mm²` : '';
    const normalized = fold(text);

    if (segment?.cable) {
      const cableType = /\bxlpe\b/i.test(text) ? 'XLPE' : 'Kablo';
      const material = normalized.includes('bakir') ? ' Cu' : normalized.includes('aluminyum') ? ' Al' : '';
      return areaText ? `${lengthText} ${cableType} (${areaText}${material})` : `${lengthText} ${cableType}`;
    }

    const conductor = text.match(/(?:\b[0-9]+[A-Za-z]?\s*,\s*)?(?:Pheasant|Hawk|Cardinal|Drake|Rail)\s*\(\s*[0-9]+(?:[.,][0-9]+)?\s*MCM\s*\)/i);
    if (conductor) {
      const shortName = conductor[0]
        .replace(/\bPheasant\b/gi, 'Phe.')
        .replace(/\bCardinal\b/gi, 'Card.')
        .replace(/\bHawk\b/gi, 'Hawk')
        .replace(/\bDrake\b/gi, 'Drake')
        .replace(/,\s*/g, '-');
      return `${lengthText} ${shortName}`;
    }

    const areaMcm = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*mm(?:2|²)\s*\(\s*([0-9]+(?:[.,][0-9]+)?)\s*MCM\s*\)/i);
    if (areaMcm) {
      return `${lengthText} ${Math.round(Number(areaMcm[1].replace(',', '.')))} mm² (${Math.round(Number(areaMcm[2].replace(',', '.')))} MCM)`;
    }

    const mcmEnd = text.indexOf(')');
    const compact = (mcmEnd >= 0 ? text.slice(0, mcmEnd + 1) : text.replace(/\b(?:OPGW|EHS)\b.*$/i, '')).trim();
    return compact ? `${lengthText} ${compact}` : lengthText;
  }

  function summarizeCharacteristic(hat, limit = 3) {
    const parsed = parseSegments(hat?.characteristic) || [];
    const selected = parsed
      .slice()
      .sort((left, right) => Number(right.lengthKm) - Number(left.lengthKm))
      .slice(0, Math.max(0, limit))
      .map(formatShortSegment);
    const totalLengthKm = Number(hat?.lengthKm);
    const cableLengthKm = Number.isFinite(hat?.cableLengthKm) ? Number(hat.cableLengthKm) : null;
    const cableRatio = Number.isFinite(hat?.cableRatio) ? Number(hat.cableRatio) : null;
    const totalText = Number.isFinite(totalLengthKm) ? `${Math.round(totalLengthKm)} km` : '— km';
    const cableText = Number.isFinite(cableRatio)
      ? `Kablo %${Math.round(cableRatio * 100)}${Number.isFinite(cableLengthKm) && cableLengthKm > 0 ? ` · ${Math.round(cableLengthKm)} km` : ''}`
      : 'Kablo —';
    return {
      segments: selected,
      moreCount: Math.max(0, parsed.length - selected.length),
      summary: `${totalText} · ${cableText}`
    };
  }

  return { classify, parseSegments, formatShortSegment, summarizeCharacteristic, LENGTH_EPSILON_KM };
});
