(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WebSCADASelection = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  let current = null;
  const listeners = new Set();
  function select(entity) {
    current = entity || null;
    listeners.forEach((listener) => listener(current));
    return current;
  }
  function get() { return current; }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  return { select, get, subscribe };
}));
