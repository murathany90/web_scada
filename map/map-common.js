(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.MAP_COMMON = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
      .replace(/İ/g, 'i')
      .replace(/ç/g, 'c')
      .replace(/Ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/Ğ/g, 'g')
      .replace(/ö/g, 'o')
      .replace(/Ö/g, 'o')
      .replace(/ş/g, 's')
      .replace(/Ş/g, 's')
      .replace(/ü/g, 'u')
      .replace(/Ü/g, 'u')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function addUniqueRow(map, key, row) {
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.some((item) => String(item.tpysBaraId) === String(row.tpysBaraId))) {
      list.push(row);
      map.set(key, list);
    }
  }

  function buildMappingIndex(rows) {
    const byId = new Map();
    const byName = new Map();
    const byYksName = new Map();
    const byAlias = new Map();

    rows.forEach((row) => {
      byId.set(String(row.tpysBaraId), row);
      addUniqueRow(byName, normalizeText(row.tpysBaraAdi), row);
      addUniqueRow(byYksName, normalizeText(row.yksBaraAdi), row);
      const aliases = new Set([...(row.aliases || []), row.tpysBaraAdi, row.yksBaraAdi, row.oysBaraId]);
      aliases.forEach((alias) => addUniqueRow(byAlias, normalizeText(alias), row));
    });

    return { byId, byName, byYksName, byAlias };
  }

  function createMatch(status, reason, candidates, row) {
    return {
      status,
      reason,
      candidates: candidates || [],
      row: row || null
    };
  }

  function resolveBaraSetMatch(input, index) {
    const tpysBaraId = String(input?.tpysBaraId || '').trim();
    if (tpysBaraId) {
      const row = index.byId.get(tpysBaraId);
      if (row) return createMatch('matched', 'tpysBaraId', [row], row);
    }

    const exactText = normalizeText(input?.sourceName || input?.tpysBaraAdi || '');
    if (!exactText) return createMatch('unmatched', 'missing-key', []);

    const exactName = index.byName.get(exactText) || [];
    if (exactName.length === 1) return createMatch('matched', 'tpysBaraAdi', exactName, exactName[0]);
    if (exactName.length > 1) return createMatch('ambiguous', 'tpysBaraAdi', exactName);

    const exactYks = index.byYksName.get(exactText) || [];
    if (exactYks.length === 1) return createMatch('matched', 'yksBaraAdi', exactYks, exactYks[0]);
    if (exactYks.length > 1) return createMatch('ambiguous', 'yksBaraAdi', exactYks);

    const exactAlias = index.byAlias.get(exactText) || [];
    if (exactAlias.length === 1) return createMatch('matched', 'alias', exactAlias, exactAlias[0]);
    if (exactAlias.length > 1) return createMatch('ambiguous', 'alias', exactAlias);

    return createMatch('unmatched', 'not-found', []);
  }

  function splitZoom(zoom) {
    const numericZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 0;
    const tileZoom = Math.max(0, Math.floor(numericZoom));
    return {
      tileZoom,
      scale: 2 ** (numericZoom - tileZoom)
    };
  }

  return {
    normalizeText,
    buildMappingIndex,
    resolveBaraSetMatch,
    splitZoom
  };
});
