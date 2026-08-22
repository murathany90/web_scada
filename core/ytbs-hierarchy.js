(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADAYtbsHierarchy = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const norm = (value) => String(value || '').trim();
  const fold = (value) => norm(value).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
  const canonicalYtm = (value) => { const ytm = norm(value); return ytm && fold(ytm) !== 'milli ytm' ? ytm : null; };
  const canonicalBm = (value) => { const bm = norm(value); return bm && !fold(bm).includes('dairesi') ? bm : null; };
  function classifyTrafo(entity) {
    const text = fold([entity?.gerilimTuru, entity?.trafoTuru, entity?.tip, entity?.type, entity?.category].filter(Boolean).join(' '));
    if (text.includes('iletim')) return 'transmission';
    if (text.includes('dagitim')) return 'distribution';
    return 'unknown';
  }
  function create(network) {
    const tms = (Array.isArray(network?.tmPoints) ? network.tmPoints : []).map((x) => ({ kind:'tm', ...x }));
    const hats = (Array.isArray(network?.hatLines) ? network.hatLines : []).map((x) => ({ kind:'hat', ...x }));
    const trafos = (Array.isArray(network?.trafos) ? network.trafos : []).map((x) => ({ kind:'trafo', ...x }));
    const baras = (Array.isArray(network?.baraNodes) ? network.baraNodes : []).map((x) => ({ kind:'bara', ...x }));
    const tmById = new Map(tms.map((tm) => [String(tm.id), tm]));
    const tmByName = new Map(tms.map((tm) => [norm(tm.name), tm]));
    const tmOf = (entity) => entity?.kind === 'tm' ? entity : tmById.get(String(entity?.tmId || '')) || tmByName.get(norm(entity?.tmName)) || null;
    const memberships = (entity) => {
      const endpoints = entity?.kind === 'hat' ? [tmById.get(String(entity.startTmId || '')), tmById.get(String(entity.endTmId || ''))].filter(Boolean) : [tmOf(entity)].filter(Boolean);
      const ytm = new Set(); const bm = new Set();
      endpoints.forEach((tm) => { const y = canonicalYtm(tm.ytm); const b = canonicalBm(tm.bolgeMudurlugu); if (y) ytm.add(y); if (b) bm.add(b); });
      (entity?.ytmNames || []).map(canonicalYtm).filter(Boolean).forEach((y) => ytm.add(y));
      const directYtm = canonicalYtm(entity?.ytm); if (directYtm) ytm.add(directYtm);
      return { ytm: [...ytm], bm: [...bm], tm: endpoints };
    };
    const all = [...tms, ...hats, ...trafos, ...baras];
    all.forEach((entity) => { entity.__ytbs = memberships(entity); if (entity.kind === 'trafo') entity.trafoClass = classifyTrafo(entity); });
    const ytmOptions = [...new Set(tms.map((tm) => canonicalYtm(tm.ytm)).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'tr'));
    const bmOptions = [...new Set(tms.map((tm) => canonicalBm(tm.bolgeMudurlugu)).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'tr'));
    const matches = (entity, filters = {}) => {
      const data = entity?.__ytbs || memberships(entity); const type = filters.type || '';
      if (filters.ytm && !data.ytm.includes(filters.ytm)) return false;
      if (filters.bm && !data.bm.includes(filters.bm)) return false;
      if (filters.tm && !data.tm.some((tm) => String(tm.id) === String(filters.tm))) return false;
      if (type) { const actual = entity.kind === 'trafo' ? `trafo-${entity.trafoClass || classifyTrafo(entity)}` : entity.kind; if (actual !== type) return false; }
      return true;
    };
    const children = (tm) => { const id = String(tm?.id || tm); return { baras: baras.filter((x) => String(x.tmId) === id), trafos: trafos.filter((x) => String(x.tmId) === id), hats: hats.filter((x) => String(x.startTmId) === id || String(x.endTmId) === id) }; };
    return { all, tms, hats, trafos, baras, tmById, tmOf, memberships, matches, children, ytmOptions, bmOptions, classifyTrafo };
  }
  return { create, canonicalYtm, canonicalBm, classifyTrafo };
}));
