(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WebSCADATopology = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  let topologyPromise = null;
  let mappingPromise = null;

  async function readJson(path) {
    const url = globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : path;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${path} yuklenemedi (${response.status}).`);
    return response.json();
  }

  function loadTopology() {
    topologyPromise ||= readJson('data/kml_layers_v2.json');
    return topologyPromise;
  }

  function loadMapping() {
    mappingPromise ||= readJson('data/mapping.json');
    return mappingPromise;
  }

  async function loadAll() {
    const [network, mapping] = await Promise.all([loadTopology(), loadMapping()]);
    return { network, mapping };
  }

  function listEntities(network) {
    const result = [];
    const add = (kind, values) => (Array.isArray(values) ? values : []).forEach((value) => result.push({ kind, ...value }));
    add('tm', network?.tmPoints);
    add('hat', network?.hatLines);
    add('trafo', network?.trafos);
    add('bara', network?.baraNodes);
    return result;
  }

  return { loadTopology, loadMapping, loadAll, listEntities };
}));
