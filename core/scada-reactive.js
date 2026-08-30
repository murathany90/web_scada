((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WebSCADAReactive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_REFERENCES = Object.freeze({ kv154: 120, kv400: 300 });

  function positiveReference(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 10000 ? numeric : fallback;
  }

  function normalizeReferences(input = {}) {
    return {
      kv154: positiveReference(input.reactiveReference154Mvar, DEFAULT_REFERENCES.kv154),
      kv400: positiveReference(input.reactiveReference400Mvar, DEFAULT_REFERENCES.kv400)
    };
  }

  function referenceForKv(kv, references = {}) {
    const numericKv = Number(String(kv ?? '').match(/\d+(?:\.\d+)?/)?.[0]);
    const normalized = {
      kv154: positiveReference(references.kv154 ?? references.reactiveReference154Mvar, DEFAULT_REFERENCES.kv154),
      kv400: positiveReference(references.kv400 ?? references.reactiveReference400Mvar, DEFAULT_REFERENCES.kv400)
    };
    return numericKv >= 300 ? normalized.kv400 : normalized.kv154;
  }

  function reactiveReferenceRatioPct(startValue, endValue, referenceMvar) {
    const values = [startValue, endValue]
      .map(Number)
      .filter(Number.isFinite)
      .map(Math.abs);
    const reference = Number(referenceMvar);
    if (!values.length || !Number.isFinite(reference) || reference <= 0) return null;
    return (Math.max(...values) / reference) * 100;
  }

  // Terminal arrows are a presentation of the already-resolved line
  // direction.  Never derive them from the raw Superset sign again here.
  function terminalDirectionValue(normalizedValue, directionValue, terminalSide = '') {
    const resolvedDirection = Number(directionValue);
    const canonicalDirection = Number.isFinite(resolvedDirection)
      ? resolvedDirection
      : Number(normalizedValue);
    if (!Number.isFinite(canonicalDirection)) return null;
    // The resolved value is canonicalized as start -> end.  A terminal's own
    // signed Q convention is the inverse at the end terminal.
    return terminalSide === 'end' ? -canonicalDirection : canonicalDirection;
  }

  function terminalArrowDirection(terminalSide, terminalValue) {
    const value = Number(terminalValue);
    if (!Number.isFinite(value) || value === 0) return 'unknown';
    if (terminalSide === 'start') return value > 0 ? 'forward' : 'reverse';
    if (terminalSide === 'end') return value > 0 ? 'reverse' : 'forward';
    return 'unknown';
  }

  function dominantTerminalSide(startValue, endValue) {
    const start = Number(startValue);
    const end = Number(endValue);
    const hasStart = Number.isFinite(start);
    const hasEnd = Number.isFinite(end);
    if (!hasStart && !hasEnd) return '';
    if (!hasEnd || (hasStart && Math.abs(start) >= Math.abs(end))) return 'start';
    return 'end';
  }

  function terminalDirectionsMismatch(startValue, endValue) {
    const startDirection = terminalArrowDirection('start', startValue);
    const endDirection = terminalArrowDirection('end', endValue);
    return startDirection !== 'unknown' && endDirection !== 'unknown' && startDirection !== endDirection;
  }

  function trafoClass(trafo) {
    const type = String(trafo?.type || trafo?.trafoClass || '').toLowerCase();
    if (type === 'transmission' || type === 'distribution') return type;
    return 'unknown';
  }

  function filterTrafosForScada(entities, panelFilter) {
    const expected = panelFilter === 'trafo-trans' ? 'transmission'
      : panelFilter === 'trafo-dist' ? 'distribution'
        : '';
    return (entities || []).filter((entity) => !expected || trafoClass(entity) === expected);
  }

  return {
    DEFAULT_REFERENCES,
    normalizeReferences,
    referenceForKv,
    reactiveReferenceRatioPct,
    terminalDirectionValue,
    terminalArrowDirection,
    dominantTerminalSide,
    terminalDirectionsMismatch,
    trafoClass,
    filterTrafosForScada
  };
});
