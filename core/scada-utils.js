(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WebSCADAScadaUtils = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COLORS = { green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444', darkRed: '#dc2626', purple: '#7c3aed', gray: '#9ca3af' };
  function isFiniteNumber(value) { return Number.isFinite(Number(value)); }
  function flowColor(pct, reactive) {
    if (!isFiniteNumber(pct) || Number(pct) < 0) return COLORS.gray;
    const p = Number(pct);
    const limits = reactive ? [10, 20, 30, 40, 60] : [55, 65, 75, 80, 90];
    const colors = [COLORS.green, COLORS.yellow, COLORS.orange, COLORS.red, COLORS.darkRed, COLORS.purple];
    return colors[limits.findIndex((limit) => p <= limit) < 0 ? 5 : limits.findIndex((limit) => p <= limit)];
  }
  function reactiveRatioPct(p, q) {
    if (!isFiniteNumber(p) || !isFiniteNumber(q) || Math.abs(Number(p)) < 1) return null;
    return Math.abs(Number(q)) / Math.abs(Number(p)) * 100;
  }
  return { COLORS, flowColor, reactiveRatioPct, isFiniteNumber };
}));
