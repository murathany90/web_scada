(function () {
  const V2_NETWORK_PATH = 'data/kml_layers_v2.json';
  const INNER_RING_RADIUS = 15;
  const OUTER_RING_RADIUS = 27;
  const LABEL_MIN_ZOOM = 7.2;
  const TRAFO_TYPE_COLORS = {
    distribution: '#22c55e',
    transmission: '#0ea5e9'
  };

  if (typeof state === 'undefined' || typeof el === 'undefined') return;

  el.showTrafoDist = document.getElementById('showTrafoDist');
  el.showTrafoTransmission = document.getElementById('showTrafoTransmission');
  el.trafoLayer = document.getElementById('trafoLayer');

  state.network.trafos = state.network.trafos || [];
  state.network.baraNodes = state.network.baraNodes || [];
  state.network.tmById = state.network.tmById || new Map();
  state.network.tmByName = state.network.tmByName || new Map();
  state.network.hatById = state.network.hatById || new Map();
  state.network.trafosByTmId = state.network.trafosByTmId || new Map();
  state.network.baraNodesByTmId = state.network.baraNodesByTmId || new Map();

  state.filters.showTrafoDist = Boolean(state.filters.showTrafoDist);
  state.filters.showTrafoTransmission = Boolean(state.filters.showTrafoTransmission);
  state.filters.scadaMetric = state.filters.scadaMetric || 'hat-active';
  state.filters.scadaListEntity = state.filters.scadaListEntity || 'hat';
  state.ui.activeEntityPopup = state.ui.activeEntityPopup || null;

  function normalizeKvBucket(value) {
    const raw = String(value || '').replace(',', '.').trim();
    const num = Number(raw);
    if (!Number.isFinite(num)) return '';
    if (num >= 300) return '400';
    if (num >= 120) return '154';
    if (num >= 50) return '66';
    return String(Math.round(num));
  }

  function normalizeTrafoType(value) {
    const text = normalizeText(value);
    return text.includes('iletim') ? 'transmission' : 'distribution';
  }

  function getTrafoInstalledPowerValue(trafo) {
    const candidates = [
      Number(trafo?.ofafMva),
      Number(trafo?.onafMva),
      Number(trafo?.onanMva),
      Number(trafo?.bazGucuMva)
    ].filter((value) => Number.isFinite(value) && value > 0);
    return candidates.length ? candidates[0] : null;
  }

  function formatTrafoInstalledPower(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    const rounded = Math.abs(value - Math.round(value)) < 0.01
      ? String(Math.round(value))
      : value.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
    return `${rounded} MVA`;
  }

  function getTrafoDisplayName(trafo) {
    const baseName = String(trafo?.name || '-');
    const installedPower = formatTrafoInstalledPower(getTrafoInstalledPowerValue(trafo));
    return installedPower ? `${baseName} (${installedPower})` : baseName;
  }

  function getEntityTm(entity) {
    if (!entity) return null;
    if (entity.tm && Number.isFinite(Number(entity.tm.lon)) && Number.isFinite(Number(entity.tm.lat))) return entity.tm;
    const byId = state.network.tmById?.get(String(entity.tmId || ''));
    if (byId) return byId;
    return state.network.tmByName?.get(String(entity.tmName || '')) || null;
  }

  function buildNetworkIndexes() {
    const network = state.network || {};
    network.tmPoints = Array.isArray(network.tmPoints) ? network.tmPoints : [];
    network.hatLines = Array.isArray(network.hatLines) ? network.hatLines : [];
    network.trafos = Array.isArray(network.trafos) ? network.trafos : [];
    network.baraNodes = Array.isArray(network.baraNodes) ? network.baraNodes : [];
    network.tmMap = new Map();
    network.tmById = new Map();
    network.tmByName = new Map();
    network.hatById = new Map();
    network.trafosByTmId = new Map();
    network.baraNodesByTmId = new Map();

    network.tmPoints.forEach((tm) => {
      tm.kvBucket = normalizeKvBucket(tm.kv);
      network.tmMap.set(tm.name, tm);
      network.tmById.set(String(tm.id), tm);
      network.tmByName.set(String(tm.name || ''), tm);
    });

    network.hatLines.forEach((hat) => {
      hat.kvBucket = normalizeKvBucket(hat.kv);
      hat.startTmRef = network.tmById.get(String(hat.startTmId || '')) || network.tmByName.get(String(hat.startTm || '')) || null;
      hat.endTmRef = network.tmById.get(String(hat.endTmId || '')) || network.tmByName.get(String(hat.endTm || '')) || null;
      network.hatById.set(String(hat.id), hat);
    });

    network.trafos.forEach((trafo) => {
      trafo.type = normalizeTrafoType(trafo.gerilimTuru);
      trafo.kvBucket = normalizeKvBucket(trafo.primaryKv || trafo.secondaryKv);
      trafo.tm = getEntityTm(trafo);
      trafo.displayName = getTrafoDisplayName(trafo);
      const key = String(trafo.tmId || trafo.tm?.id || '');
      if (!network.trafosByTmId.has(key)) network.trafosByTmId.set(key, []);
      network.trafosByTmId.get(key).push(trafo);
    });

    network.baraNodes.forEach((bara) => {
      bara.kvBucket = normalizeKvBucket(bara.gerilimKv);
      bara.tm = getEntityTm(bara);
      const key = String(bara.tmId || bara.tm?.id || '');
      if (!network.baraNodesByTmId.has(key)) network.baraNodesByTmId.set(key, []);
      network.baraNodesByTmId.get(key).push(bara);
    });

    state.network = network;
    if (typeof invalidateVisibleEntityCache === 'function') invalidateVisibleEntityCache();
    return network;
  }

  function getEffectiveTrafoKv(entity) {
    return normalizeKvBucket(entity?.primaryKv || entity?.secondaryKv || entity?.kvBucket || '');
  }

  function getVisibleTrafoEntities() {
    return getVisibleEntityList('trafos', () => {
      const effectiveKv = getEffectiveKvFilter();
      return state.network.trafos.filter((trafo) => {
        const tm = trafo.tm || getEntityTm(trafo);
        if (!tm) return false;
        const kvBucket = getEffectiveTrafoKv(trafo);
        if (!effectiveKv.has(kvBucket)) return false;
        if (!matchesYtm(trafo.ytm || tm.ytm)) return false;
        return true;
      });
    });
  }

  function getVisibleTrafoDist() {
    return getVisibleTrafoEntities().filter((trafo) => {
      if (trafo.type !== 'distribution') return false;
      const ownership = normalizeText(trafo.tm?.mulk || '');
      return ownership === 'teias';
    });
  }

  function getVisibleTrafoTransmission() {
    return getVisibleTrafoEntities().filter((trafo) => trafo.type === 'transmission');
  }

  const baseFetchJson = fetchJson;
  fetchJson = async function (path) {
    const actualPath = path === 'data/kml_layers.json' ? V2_NETWORK_PATH : path;
    return baseFetchJson(actualPath);
  };

  const baseInitializeFilters = initializeFilters;
  initializeFilters = function () {
    buildNetworkIndexes();
    baseInitializeFilters();
    state.filters.showBaras = false;
    state.filters.showTrafoDist = false;
    state.filters.showTrafoTransmission = false;
    syncLayerFilterInputs();
  };

  const baseSyncLayerFilterInputs = syncLayerFilterInputs;
  syncLayerFilterInputs = function () {
    baseSyncLayerFilterInputs();
    if (el.showTrafoDist) el.showTrafoDist.checked = Boolean(state.filters.showTrafoDist);
    if (el.showTrafoTransmission) el.showTrafoTransmission.checked = Boolean(state.filters.showTrafoTransmission);
  };

  const baseBindEvents = bindEvents;
  bindEvents = function () {
    baseBindEvents();
    if (el.showTrafoDist && !el.showTrafoDist.dataset.bound) {
      el.showTrafoDist.dataset.bound = '1';
      el.showTrafoDist.addEventListener('change', () => {
        clearSearchPins();
        state.filters.showTrafoDist = el.showTrafoDist.checked;
        handleVisibilityFiltersChanged();
      });
    }
    if (el.showTrafoTransmission && !el.showTrafoTransmission.dataset.bound) {
      el.showTrafoTransmission.dataset.bound = '1';
      el.showTrafoTransmission.addEventListener('change', () => {
        clearSearchPins();
        state.filters.showTrafoTransmission = el.showTrafoTransmission.checked;
        handleVisibilityFiltersChanged();
      });
    }
  };

  const baseHandleVisibilityFiltersChanged = handleVisibilityFiltersChanged;
  handleVisibilityFiltersChanged = function () {
    baseHandleVisibilityFiltersChanged();
    if (state.scada.enabled && typeof scadaDoFetch === 'function') {
      scadaDoFetch({ trigger: 'filter-change' });
    }
  };

  const baseHideInfo = hideInfo;
  hideInfo = function (clearSelection = true) {
    state.ui.activeEntityPopup = null;
    baseHideInfo(clearSelection);
  };

  getVisibleBaras = function () {
    return getVisibleEntityList('baras', () => {
      const effectiveKv = getEffectiveKvFilter();
      return state.network.baraNodes.filter((bara) => {
        const tm = bara.tm || getEntityTm(bara);
        if (!tm) return false;
        return effectiveKv.has(String(bara.kvBucket || '')) && matchesYtm(bara.ytm || tm.ytm);
      });
    });
  };

  getVisibleTms = function () {
    return getVisibleEntityList('tms', () => {
      const effectiveKv = getEffectiveKvFilter();
      const baseTms = state.network.tmPoints.filter((row) => effectiveKv.has(String(row.kvBucket || row.kv || '')) && matchesYtm(row.ytm));
      if (state.filters.hatDisplayMode === 'sade-ayrik' || state.filters.hatDisplayMode === 'sade') {
        const visibleNames = new Set(baseTms.map((tm) => tm.name));
        const connectedNames = new Set();
        getVisibleHats().forEach((hat) => {
          if (hat.startTm) connectedNames.add(hat.startTm);
          if (hat.endTm) connectedNames.add(hat.endTm);
        });
        const extras = state.network.tmPoints.filter((tm) => !visibleNames.has(tm.name) && connectedNames.has(tm.name) && effectiveKv.has(String(tm.kvBucket || tm.kv || '')));
        return [...baseTms, ...extras];
      }
      return baseTms;
    });
  };

  getVisibleHats = function () {
    return getVisibleEntityList('hats', () => {
      const effectiveKv = getEffectiveKvFilter();
      return state.network.hatLines.filter((row) => effectiveKv.has(String(row.kvBucket || row.kv || '')) && matchesAnyYtm(row.ytmNames));
    });
  };

  function collectFilterPoints(includeAll = false) {
    const points = [];
    const tmRows = includeAll ? state.network.tmPoints : getVisibleTms();
    const hatRows = includeAll ? state.network.hatLines : getVisibleHats();
    const trafoRows = includeAll ? state.network.trafos : getVisibleTrafoEntities();
    const baraRows = includeAll ? state.network.baraNodes : getVisibleBaras();

    tmRows.forEach((row) => points.push([Number(row.lon), Number(row.lat)]));
    hatRows.forEach((row) => {
      if (row.bbox?.length === 4) points.push([row.bbox[0], row.bbox[1]], [row.bbox[2], row.bbox[3]]);
    });
    trafoRows.forEach((trafo) => {
      const tm = trafo.tm || getEntityTm(trafo);
      if (tm) points.push([Number(tm.lon), Number(tm.lat)]);
    });
    baraRows.forEach((bara) => {
      const tm = bara.tm || getEntityTm(bara);
      if (tm) points.push([Number(tm.lon), Number(tm.lat)]);
    });
    return points;
  }

  resetView = function () {
    const points = collectFilterPoints(true);
    if (!points.length) return;
    const lons = points.map((point) => point[0]);
    const lats = points.map((point) => point[1]);
    state.map.centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
    state.map.centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    state.map.zoom = fitZoom(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats));
    state.map.tileState.rangeKey = '';
  };

  fitFiltersView = function () {
    const points = collectFilterPoints(false);
    if (!points.length) {
      setStatus('Secili filtrede haritada oge bulunamadi.', 'warn');
      return;
    }
    const lons = points.map((point) => point[0]);
    const lats = points.map((point) => point[1]);
    state.map.centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
    state.map.centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    state.map.zoom = fitZoom(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats));
    state.map.tileState.rangeKey = '';
    requestRender({ forceTiles: true });
    setStatus('Gorunum mevcut filtrelere gore ortalandi.');
  };

  function getScreenGeoFromLocal(x, y) {
    const width = el.mapViewport.clientWidth || 1200;
    const height = el.mapViewport.clientHeight || 800;
    const center = project(state.map.centerLon, state.map.centerLat, state.map.zoom);
    return unproject(center.x - width / 2 + x, center.y - height / 2 + y, state.map.zoom);
  }

  function sortByDisplayName(a, b) {
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'tr');
  }

  function sortTrafoItems(items) {
    return items.slice().sort((a, b) => {
      const typeCompare = String(a.type || '').localeCompare(String(b.type || ''), 'tr');
      if (typeCompare !== 0) return typeCompare;
      const kvCompare = Number(b.primaryKv || 0) - Number(a.primaryKv || 0);
      if (kvCompare !== 0) return kvCompare;
      return sortByDisplayName(a, b);
    });
  }

  function sortBaraItems(items) {
    return items.slice().sort((a, b) => {
      const kvCompare = Number(b.gerilimKv || 0) - Number(a.gerilimKv || 0);
      if (kvCompare !== 0) return kvCompare;
      return sortByDisplayName(a, b);
    });
  }

  function buildFanoutSlots(items, radius) {
    return items.map((item, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2) * index / Math.max(items.length, 1));
      return {
        item,
        dx: Math.cos(angle) * radius,
        dy: Math.sin(angle) * radius
      };
    });
  }

  function appendPillLabel(group, x, y, text, extraClass) {
    const label = String(text || '').trim();
    if (!label) return;
    const width = Math.max(40, Math.min(124, 18 + label.length * 6.1));
    const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    box.setAttribute('x', round1(x));
    box.setAttribute('y', round1(y));
    box.setAttribute('width', round1(width));
    box.setAttribute('height', '18');
    box.setAttribute('rx', '9');
    box.setAttribute('class', extraClass === 'value' ? 'entity-value-box' : 'entity-label-box');
    group.appendChild(box);

    const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textNode.setAttribute('x', round1(x + 8));
    textNode.setAttribute('y', round1(y + 12));
    textNode.setAttribute('class', `entity-${extraClass || 'label'}-text`);
    textNode.textContent = label;
    group.appendChild(textNode);
  }

  function appendPillLabelCentered(group, xCenter, y, text, extraClass) {
    const label = String(text || '').trim();
    if (!label) return;
    const width = Math.max(40, Math.min(124, 18 + label.length * 6.1));
    appendPillLabel(group, xCenter - (width / 2), y, label, extraClass);
  }

  function getMetricVisual(entityType, entity) {
    if (typeof buildEntityMetricVisual === 'function') {
      return buildEntityMetricVisual(entityType, entity);
    }
    return null;
  }

  function formatOverlayMetricValue(value, digits = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return numeric.toLocaleString('tr-TR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatHatLengthKm(lengthKm) {
    const numeric = Number(lengthKm);
    if (!Number.isFinite(numeric)) return '-';
    return numeric.toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function getMetricRecord(entityType, entityId) {
    return state.scada?.entityMetricsByKey?.get(`${entityType}:${entityId}`) || null;
  }

  function getTimePriority(timeState) {
    if (timeState === 'live') return 4;
    if (timeState === 'warn') return 3;
    if (timeState === 'dead') return 2;
    return 1;
  }

  function getDeclutterLimit() {
    const zoom = Number(state.map?.zoom || 0);
    if (zoom < 7.5) return 1;
    if (zoom < 8.5) return 2;
    if (zoom < 9.2) return 4;
    return Infinity;
  }

  function applyScreenDeclutter(items) {
    if (!Array.isArray(items) || !items.length) return [];
    const limit = getDeclutterLimit();
    if (!Number.isFinite(limit)) {
      return items.slice().sort((a, b) => Number(a.renderOrder || 0) - Number(b.renderOrder || 0));
    }
    const kept = new Map();
    const buckets = new Map();
    items
      .slice()
      .sort((left, right) => {
        const forceCompare = Number(Boolean(right.forceVisible)) - Number(Boolean(left.forceVisible));
        if (forceCompare !== 0) return forceCompare;
        return Number(right.priorityScore || 0) - Number(left.priorityScore || 0);
      })
      .forEach((item) => {
        const itemKey = String(item.itemKey || item.groupKey || `${item.declutterX}:${item.declutterY}:${item.renderOrder || 0}`);
        if (item.forceVisible) {
          kept.set(itemKey, item);
          return;
        }
        const bucketX = Math.floor(Number(item.declutterX || 0) / 56);
        const bucketY = Math.floor(Number(item.declutterY || 0) / 56);
        const bucketKey = `${bucketX}:${bucketY}`;
        const used = Number(buckets.get(bucketKey) || 0);
        if (used >= limit) return;
        buckets.set(bucketKey, used + 1);
        kept.set(itemKey, item);
      });
    return [...kept.values()].sort((a, b) => Number(a.renderOrder || 0) - Number(b.renderOrder || 0));
  }

  function ensureHeatFilterDefs(layer, filterId) {
    if (!layer || layer.querySelector(`filter#${filterId}`)) return;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('x', '-60%');
    filter.setAttribute('y', '-60%');
    filter.setAttribute('width', '220%');
    filter.setAttribute('height', '220%');
    const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur.setAttribute('stdDeviation', '14');
    blur.setAttribute('edgeMode', 'none');
    filter.appendChild(blur);
    defs.appendChild(filter);
    layer.appendChild(defs);
  }

  function appendHeatSpot(group, x, y, radius, color, className, filterId) {
    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    glow.setAttribute('cx', round1(x));
    glow.setAttribute('cy', round1(y));
    glow.setAttribute('r', round1(radius));
    glow.setAttribute('fill', color);
    glow.setAttribute('opacity', '0.24');
    glow.setAttribute('filter', `url(#${filterId})`);
    glow.setAttribute('class', className);
    group.appendChild(glow);

    const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    core.setAttribute('cx', round1(x));
    core.setAttribute('cy', round1(y));
    core.setAttribute('r', round1(Math.max(5, radius * 0.34)));
    core.setAttribute('fill', color);
    core.setAttribute('opacity', '0.86');
    core.setAttribute('class', className);
    group.appendChild(core);
  }

  function appendPlainLabel(group, x, y, text, extraClass = '') {
    const label = String(text || '').trim();
    if (!label) return;
    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    halo.setAttribute('x', round1(x));
    halo.setAttribute('y', round1(y));
    halo.setAttribute('class', `entity-inline-label entity-inline-label-halo ${extraClass}`.trim());
    halo.textContent = label;
    group.appendChild(halo);

    const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textNode.setAttribute('x', round1(x));
    textNode.setAttribute('y', round1(y));
    textNode.setAttribute('class', `entity-inline-label ${extraClass}`.trim());
    textNode.textContent = label;
    group.appendChild(textNode);
  }

  function getShortTrafoLabel(trafo) {
    return String(trafo?.name || trafo?.displayName || '-').trim();
  }

  function hasTransferBaraToken(value) {
    const tokens = normalizeText(value).split(' ').filter(Boolean);
    return tokens.includes('bt') || tokens.includes('transfer');
  }

  function isTransferBaraForVoltage(bara) {
    // Structured topology data takes priority when it explicitly identifies a transfer bus.
    if (hasTransferBaraToken(bara?.kullanim) || hasTransferBaraToken(bara?.turu)) return true;
    // Older topology rows do not always expose that classification, so retain a token-only name fallback.
    return hasTransferBaraToken(bara?.name);
  }

  function getVoltageTimestampMs(record) {
    const timestamp = record?.primaryTimestamp;
    if (typeof timestamp?.getTime === 'function') return Number(timestamp.getTime()) || 0;
    const parsed = Date.parse(timestamp || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getVoltageCandidateTieKey(candidate) {
    return `${normalizeText(candidate?.bara?.name)}\u0000${String(candidate?.bara?.id || '')}`;
  }

  function isBetterVoltageCandidate(candidate, current) {
    if (!current) return true;
    const candidateTimePriority = getTimePriority(candidate.record?.primaryStaleState);
    const currentTimePriority = getTimePriority(current.record?.primaryStaleState);
    if (candidateTimePriority !== currentTimePriority) return candidateTimePriority > currentTimePriority;

    const candidateTimestamp = getVoltageTimestampMs(candidate.record);
    const currentTimestamp = getVoltageTimestampMs(current.record);
    if (candidateTimestamp !== currentTimestamp) return candidateTimestamp > currentTimestamp;

    return getVoltageCandidateTieKey(candidate).localeCompare(getVoltageCandidateTieKey(current), 'tr') < 0;
  }

  function selectActiveVoltagePerTmLevel(items) {
    const byLevel = new Map();
    (items || []).forEach((bara) => {
      const record = getMetricRecord('bara', bara.id);
      if (!record || !Number.isFinite(record.primaryValue) || isTransferBaraForVoltage(bara)) return;
      const levelKey = String(bara.kvBucket || bara.gerilimKv || '');
      const candidate = { bara, record, visual: getMetricVisual('bara', bara) };
      if (isBetterVoltageCandidate(candidate, byLevel.get(levelKey))) byLevel.set(levelKey, candidate);
    });
    return ['400', '154'].map((levelKey) => byLevel.get(levelKey)).filter(Boolean);
  }

  function buildVoltageOverlayGroups() {
    const visibleBaras = getVisibleBaras()
      .filter((bara) => ['154', '400'].includes(String(bara.kvBucket || bara.gerilimKv || '')));
    const byTmId = new Map();
    visibleBaras.forEach((bara) => {
      const tm = bara.tm || getEntityTm(bara);
      if (!tm) return;
      const key = String(tm.id || bara.tmId || bara.id);
      if (!byTmId.has(key)) byTmId.set(key, { tm, items: [] });
      byTmId.get(key).items.push(bara);
    });
    return [...byTmId.values()].map(({ tm, items }) => {
      const activeLevels = selectActiveVoltagePerTmLevel(items);
      const representative = activeLevels.reduce((best, entry) => (
        !best || Number(entry.visual?.priorityScore || 0) > Number(best.visual?.priorityScore || 0) ? entry : best
      ), null);
      return {
        tm,
        activeLevels,
        representative
      };
    }).filter((entry) => entry.activeLevels.length);
  }

  function buildTrafoOverlayGroups() {
    const items = [
      ...getVisibleTrafoDist(),
      ...getVisibleTrafoTransmission()
    ];
    return items.reduce((list, trafo) => {
      const tm = trafo.tm || getEntityTm(trafo);
      const record = getMetricRecord('trafo', trafo.id);
      const visual = getMetricVisual('trafo', trafo);
      if (!tm || !record || !Number.isFinite(record.primaryValue) || !visual) return list;
      list.push({ trafo, tm, record, visual });
      return list;
    }, []);
  }

  function getActiveScadaDomain() {
    if (!state.scada?.enabled) return '';
    if (state.filters.scadaMetric === 'voltage') return 'bara';
    if (String(state.filters.scadaMetric || '').startsWith('trafo')) return 'trafo';
    if (String(state.filters.scadaMetric || '').startsWith('hat')) return 'hat';
    return '';
  }

  function shouldShowEntityRing(entityType) {
    const domain = getActiveScadaDomain();
    if (entityType === 'trafo' && domain !== 'trafo') return false;
    if (entityType === 'bara' && domain !== 'bara') return false;
    return ['point', 'point-label'].includes(state.filters.scadaMapDisplayMode || '');
  }

  function shouldShowEntityValueBox(entityType, visual, isSelectedEntity) {
    const domain = getActiveScadaDomain();
    if (entityType === 'trafo' && domain === 'trafo') {
      return Boolean(visual?.valueText) && ['box'].includes(state.filters.scadaMapDisplayMode || '');
    }
    if (entityType === 'bara' && domain === 'bara') {
      return Boolean(visual?.valueText) && ['box'].includes(state.filters.scadaMapDisplayMode || '');
    }
    return Boolean(visual?.valueText) || state.map.zoom >= LABEL_MIN_ZOOM || isSelectedEntity;
  }

  function rememberEntityPopup(entityType, entityId, anchorCoord, expanded) {
    state.ui.activeEntityPopup = {
      entityType,
      entityId,
      anchorCoord,
      screenPosition: null,
      expanded: Boolean(expanded)
    };
  }

  function openTmInfo(tm, anchorCoord) {
    state.selection = { kind: 'tm', id: tm.id, measureSourceId: '', measureTargetIds: [] };
    showInfo({
      title: tm.name,
      subtitle: tm.kv ? `${tm.kv} kV TM` : 'TM',
      tags: [tm.ytm || '-', tm.il || '-'],
      fields: [
        ['TM ID', tm.kmlDescriptionId || '-'],
        ['YTM', tm.ytm || '-'],
        ['Il', tm.il || '-'],
        ['BM', tm.bolgeMudurlugu || tm.bm || '-'],
        ['Salt Turu', tm.saltTuru || '-'],
        ['Mulk', tm.mulk || '-'],
        ['Trafo / Bara / Hat', `${tm.childTrafoIds?.length || 0} / ${tm.childBaraIds?.length || 0} / ${tm.childHatIds?.length || 0}`]
      ],
      anchor: anchorCoord ? { hatId: tm.id, coord: anchorCoord } : null
    });
    if (anchorCoord) rememberEntityPopup('tm', tm.id, anchorCoord, false);
    if (typeof requestRender === 'function') requestRender();
  }

  function buildTrafoFields(trafo) {
    const metric = state.scada?.entityMetricsByKey?.get(`trafo:${trafo.id}`) || null;
    const fields = [
      ['Trafo ID', trafo.id || '-'],
      ['TM', trafo.tmName || trafo.tm?.name || '-'],
      ['Tip', trafo.gerilimTuru || '-'],
      ['Primer / Sekonder', `${trafo.primaryKv || '-'} / ${trafo.secondaryKv || '-'} kV`],
      ['Baz Gucu', formatNumber(trafo.bazGucuMva, ' MVA')],
      ['Durum', trafo.status || trafo.normalIsletmeDurumu || '-']
    ];
    if (metric?.active?.value != null) fields.push(['Aktif Guc (MW)', formatNumber(metric.active.value, '')]);
    if (metric?.reactive?.value != null) fields.push(['Reaktif Guc (MVar)', formatNumber(metric.reactive.value, '')]);
    if (metric?.primaryTimestamp) fields.push(['Olcum Zamani', `${metric.primaryTimestamp.toLocaleDateString('tr-TR')} ${metric.primaryTimestamp.toLocaleTimeString('tr-TR')}`]);
    if (metric?.primaryStatusText) fields.push(['Veri Durumu', metric.primaryStatusText]);
    return fields;
  }

  function openTrafoDetails(trafo, anchorCoord) {
    state.selection = { kind: trafo.type === 'transmission' ? 'trafo-trans' : 'trafo-dist', id: trafo.id, measureSourceId: '', measureTargetIds: [] };
    showInfo({
      title: trafo.displayName || getTrafoDisplayName(trafo),
      subtitle: trafo.gerilimTuru || 'Trafo',
      tags: [trafo.tmName || '-', trafo.ytm || '-'],
      fields: buildTrafoFields(trafo),
      anchor: anchorCoord ? { hatId: trafo.id, coord: anchorCoord } : null
    });
    if (anchorCoord) rememberEntityPopup(state.selection.kind, trafo.id, anchorCoord, false);
    requestRender();
  }

  function buildBaraFields(bara) {
    const metric = state.scada?.entityMetricsByKey?.get(`bara:${bara.id}`) || null;
    const fields = [
      ['Bara ID', bara.id || '-'],
      ['TM', bara.tmName || bara.tm?.name || '-'],
      ['Gerilim', bara.gerilimSeviyesi || `${bara.gerilimKv || '-'} kV`],
      ['Kullanim', bara.kullanim || '-'],
      ['Tur', bara.turu || '-'],
      ['Veri Toplama', bara.veriToplama || '-']
    ];
    if (metric?.voltage?.value != null) fields.push(['Olculen Gerilim (kV)', formatNumber(metric.voltage.value, '')]);
    if (metric?.primaryTimestamp) fields.push(['Olcum Zamani', `${metric.primaryTimestamp.toLocaleDateString('tr-TR')} ${metric.primaryTimestamp.toLocaleTimeString('tr-TR')}`]);
    if (metric?.primaryStatusText) fields.push(['Veri Durumu', metric.primaryStatusText]);
    return fields;
  }

  function openBaraNodeDetails(bara, anchorCoord) {
    state.selection = { kind: 'bara-node', id: bara.id, measureSourceId: '', measureTargetIds: [] };
    showInfo({
      title: bara.name,
      subtitle: `${bara.gerilimKv || '-'} kV Bara`,
      tags: [bara.tmName || '-', bara.ytm || '-'],
      fields: buildBaraFields(bara),
      anchor: anchorCoord ? { hatId: bara.id, coord: anchorCoord } : null
    });
    if (anchorCoord) rememberEntityPopup('bara-node', bara.id, anchorCoord, false);
    requestRender();
  }

  function formatStatusAgeText(record) {
    if (!record) return 'Veri yok';
    const label = record.timeStateLabel || record.primaryStatusText || '-';
    return record.ageLabel ? `${label} | ${record.ageLabel}` : label;
  }

  function getHatDirectionLabel(hat, metric) {
    const directionValue = Number(metric?.directionValue);
    if (!Number.isFinite(directionValue)) return '';
    const from = directionValue >= 0 ? (hat.startTm || '?') : (hat.endTm || '?');
    const to = directionValue >= 0 ? (hat.endTm || '?') : (hat.startTm || '?');
    return `${from} >> ${to}`;
  }

  function buildHatHoverTooltip(row) {
    const record = getMetricRecord('hat', row.id);
    const lines = [
      `<strong>${escapeHtml(row.name || '-')} (${escapeHtml(formatHatLengthKm(row.lengthKm))} km)</strong>`
    ];
    if (record?.active && Number.isFinite(record.active.value)) {
      const mwDirection = getHatDirectionLabel(row, record.active);
      const mwPct = record.active.valueInvalid
        ? '!'
        : record.displayPctMode === 'loading' && Number.isFinite(record.loadingPct)
          ? `%${record.loadingPct.toFixed(1)}`
          : '';
      lines.push(`${escapeHtml(mwDirection)} ${record.active.value >= 0 ? '+' : ''}${record.active.value.toFixed(1)} MW${mwPct ? ` - ${escapeHtml(mwPct)}` : ''}`);
    }
    if (record?.reactive && Number.isFinite(record.reactive.value)) {
      const reactiveDirection = getHatDirectionLabel(row, record.reactive);
      const reactivePct = record.reactive.valueInvalid
        ? '!'
        : Number.isFinite(record.reactive?.loadingHintValue) && Number.isFinite(record.active?.loadingHintValue) && Math.abs(record.active.loadingHintValue) >= 1
          ? `%${((Math.abs(record.reactive.loadingHintValue) / Math.max(Math.abs(record.active.loadingHintValue), 1)) * 100).toFixed(1)}`
          : '';
      lines.push(`${escapeHtml(reactiveDirection)} ${record.reactive.value >= 0 ? '+' : ''}${record.reactive.value.toFixed(1)} MVAr${reactivePct ? ` - ${escapeHtml(reactivePct)}` : ''}`);
    }
    if (lines.length === 1) {
      lines.push(`<span class="tt-label">${escapeHtml(`${row.startTm || '?'} >> ${row.endTm || '?'}`)}</span>`);
    }
    return lines.join('<br>');
  }

  function buildTmHoverTooltip(tm) {
    return `<strong>${escapeHtml(tm.name || '-')} (${escapeHtml(tm.kvBucket || tm.kv || '?')})</strong>`;
  }

  function buildTrafoHoverTooltip(entry) {
    const trafo = entry?.trafo || entry;
    const record = entry?.record || getMetricRecord('trafo', trafo?.id);
    const unit = state.filters.scadaMetric === 'trafo-reactive' ? 'MVar' : 'MW';
    const pct = Number.isFinite(record?.displayPct) ? ` | ${record.displayPct.toFixed(1)}%` : '';
    const statusText = formatStatusAgeText(record);
    return `
      <strong>${escapeHtml(trafo?.displayName || getTrafoDisplayName(trafo) || '-')}</strong><br>
      <span class="tt-label">${escapeHtml(trafo?.tmName || trafo?.tm?.name || '-')}</span><br>
      ${Number.isFinite(record?.primaryValue) ? `${record.primaryValue >= 0 ? '+' : ''}${record.primaryValue.toFixed(1)} ${unit}${pct}` : '<span class="tt-label">Veri yok</span>'}<br>
      <span class="tt-label">${escapeHtml(statusText)}</span>
    `;
  }

  function buildVoltageHoverTooltip(entry) {
    const bara = entry?.bara || entry;
    const record = entry?.record || getMetricRecord('bara', bara?.id);
    const nominal = Number(bara?.gerilimKv || bara?.kvBucket || 0) || 1;
    const pu = Number.isFinite(record?.primaryValue) ? (record.primaryValue / nominal) : null;
    return `
      <strong>${escapeHtml(bara?.tmName || bara?.tm?.name || bara?.name || '-')}</strong><br>
      ${Number.isFinite(record?.primaryValue) ? `${record.primaryValue.toFixed(1)} kV${Number.isFinite(pu) ? ` | ${pu.toFixed(3)} p.u.` : ''}` : '<span class="tt-label">Veri yok</span>'}<br>
      <span class="tt-label">${escapeHtml(formatStatusAgeText(record))}</span>
    `;
  }

  renderTmLayer = function () {
    el.tmLayer.innerHTML = '';
    if (!state.filters.showTm && !isSelectionForceVisible('tm')) return;
    const bounds = currentGeoBounds();
    const fragment = document.createDocumentFragment();
    const visibleTms = getVisibleTms().slice();
    if (isSelectionForceVisible('tm')) {
      const selectedTm = state.network.tmPoints.find((row) => String(row.id) === String(state.selection.id));
      if (selectedTm && !visibleTms.some((row) => String(row.id) === String(selectedTm.id))) visibleTms.push(selectedTm);
    }
    visibleTms.filter((row) => insideBounds(row.lon, row.lat, bounds)).forEach((row) => {
      const point = screenPoint(row.lon, row.lat);
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'tm-point-group');

      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hit.setAttribute('cx', round1(point.x));
      hit.setAttribute('cy', round1(point.y));
      hit.setAttribute('r', row.kvBucket === '400' ? '12' : row.kvBucket === '154' ? '11' : '10');
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('class', 'hover-hit-target tm-hover-hit');
      hit.addEventListener('click', (event) => {
        event.stopPropagation();
        openTmInfo(row, getScreenGeoFromLocal(point.x, point.y));
      });
      attachHoverTooltip(hit, () => buildTmHoverTooltip(row), { owner: `tm:${row.id}` });

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', round1(point.x));
      circle.setAttribute('cy', round1(point.y));
      circle.setAttribute('r', row.kvBucket === '400' ? '3.1' : row.kvBucket === '154' ? '2.6' : '2.2');
      circle.setAttribute('fill', HAT_TM_COLORS[row.kvBucket || row.kv] || HAT_TM_COLORS['']);
      circle.setAttribute('class', `tm-point${isSelected('tm', row.id) ? ' feature-selected' : ''}`);
      circle.addEventListener('click', (event) => {
        event.stopPropagation();
        openTmInfo(row, getScreenGeoFromLocal(point.x, point.y));
      });
      attachHoverTooltip(circle, () => buildTmHoverTooltip(row), { owner: `tm:${row.id}` });
      group.appendChild(hit);
      group.appendChild(circle);
      fragment.appendChild(group);
    });
    el.tmLayer.appendChild(fragment);
  };

  renderTrafoLayer = function () {
    if (!el.trafoLayer) return;
    el.trafoLayer.innerHTML = '';
    const bounds = currentGeoBounds();
    const fragment = document.createDocumentFragment();
    const isTrafoOverlayMode = state.scada?.enabled && getActiveScadaDomain() === 'trafo';
    const displayMode = state.filters.scadaMapDisplayMode || 'box';
    if (isTrafoOverlayMode) {
      const grouped = new Map();
      buildTrafoOverlayGroups().forEach((entry) => {
        const tm = entry.tm;
        if (!tm || !insideBounds(tm.lon, tm.lat, bounds)) return;
        const key = String(tm.id || entry.trafo.tmId || entry.trafo.id);
        if (!grouped.has(key)) grouped.set(key, { tm, items: [] });
        grouped.get(key).items.push(entry);
      });

      if (displayMode === 'heatmap') {
        ensureHeatFilterDefs(el.trafoLayer, 'scadaTrafoHeatBlur');
        const heatItems = [];
        grouped.forEach(({ tm, items }) => {
          const center = screenPoint(tm.lon, tm.lat);
          const representative = items
            .slice()
            .sort((left, right) => Number(right.visual?.priorityScore || 0) - Number(left.visual?.priorityScore || 0))[0];
          if (!representative) return;
          heatItems.push({
            ...representative,
            declutterX: center.x,
            declutterY: center.y,
            renderOrder: heatItems.length,
            itemKey: `trafo-heat:${representative.trafo.id}`,
            forceVisible: isSelected('trafo-dist', representative.trafo.id) || isSelected('trafo-trans', representative.trafo.id)
          });
        });
        const visibleHeatItems = applyScreenDeclutter(heatItems);
        const heatGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        heatGroup.setAttribute('class', 'trafo-heatmap-group');
        visibleHeatItems.forEach((entry) => {
          const tm = entry.tm;
          const center = screenPoint(tm.lon, tm.lat);
          const metricColor = entry.record.displayColor || entry.visual?.ringColor || entry.visual?.fillColor || '#22c55e';
          const radius = 18 + Math.min(28, Number(entry.visual?.heatValue || 0) * 0.24);
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          group.setAttribute('class', 'trafo-overlay-item trafo-heatmap-item');
          appendHeatSpot(group, center.x, center.y, radius, metricColor, 'trafo-heat-spot', 'scadaTrafoHeatBlur');
          group.addEventListener('click', (event) => {
            event.stopPropagation();
            openTrafoDetails(entry.trafo, { lon: Number(tm.lon), lat: Number(tm.lat) });
          });
          attachHoverTooltip(group, () => buildTrafoHoverTooltip(entry), { owner: `trafo:${entry.trafo.id}` });
          heatGroup.appendChild(group);
        });
        fragment.appendChild(heatGroup);
        el.trafoLayer.appendChild(fragment);
        return;
      }

      const renderItems = [];
      grouped.forEach(({ tm, items }) => {
        const center = screenPoint(tm.lon, tm.lat);
        const sortedItems = items
          .slice()
          .sort((left, right) => Number(right.visual?.priorityScore || 0) - Number(left.visual?.priorityScore || 0));
        buildFanoutSlots(sortedItems, OUTER_RING_RADIUS).forEach((slot, index) => {
          const entry = slot.item;
          renderItems.push({
            ...entry,
            x: center.x + slot.dx,
            y: center.y + slot.dy,
            declutterX: center.x + slot.dx,
            declutterY: center.y + slot.dy,
            renderOrder: renderItems.length + index,
            itemKey: `trafo:${entry.trafo.id}`,
            forceVisible: isSelected('trafo-dist', entry.trafo.id) || isSelected('trafo-trans', entry.trafo.id)
          });
        });
      });

      applyScreenDeclutter(renderItems).forEach((entry) => {
        const { trafo, x, y } = entry;
        const metricColor = entry.record.displayColor || entry.visual?.ringColor || entry.visual?.fillColor || '#22c55e';
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'trafo-marker trafo-overlay-item trafo-overlay-group');
        const isSelectedEntity = isSelected('trafo-dist', trafo.id) || isSelected('trafo-trans', trafo.id);
        if (trafo.type === 'transmission') {
          const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          diamond.setAttribute('points', `${round1(x)},${round1(y - 5.6)} ${round1(x + 5.6)},${round1(y)} ${round1(x)},${round1(y + 5.6)} ${round1(x - 5.6)},${round1(y)}`);
          diamond.setAttribute('fill', metricColor);
          diamond.setAttribute('class', `${isSelectedEntity ? 'feature-selected' : ''}`);
          group.appendChild(diamond);
        } else {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', round1(x));
          circle.setAttribute('cy', round1(y));
          circle.setAttribute('r', displayMode === 'point-label' ? '5.2' : '5');
          circle.setAttribute('fill', metricColor);
          circle.setAttribute('class', `${isSelectedEntity ? 'feature-selected' : ''}`);
          group.appendChild(circle);
        }
        if (displayMode === 'box') {
          const valueLabel = `${getShortTrafoLabel(trafo)} ${entry.visual?.rawValueText || formatOverlayMetricValue(entry.record.primaryValue)}`;
          appendPillLabel(group, x + 8, y - 10, valueLabel, 'value');
        } else if (displayMode === 'point-label') {
          appendPlainLabel(group, x + 10, y + 4, getShortTrafoLabel(trafo), 'entity-inline-label-trafo');
        }
        const anchorCoord = getScreenGeoFromLocal(x, y);
        group.addEventListener('click', (event) => {
          event.stopPropagation();
          openTrafoDetails(trafo, anchorCoord);
        });
        attachHoverTooltip(group, () => buildTrafoHoverTooltip(entry), { owner: `trafo:${trafo.id}` });
        fragment.appendChild(group);
      });

      el.trafoLayer.appendChild(fragment);
      return;
    }
    let visibleTrafos = [];
    if (state.filters.showTrafoDist) visibleTrafos = visibleTrafos.concat(getVisibleTrafoDist());
    if (state.filters.showTrafoTransmission) visibleTrafos = visibleTrafos.concat(getVisibleTrafoTransmission());
    if (isSelectionForceVisible('trafo-dist') || isSelectionForceVisible('trafo-trans')) {
      const selected = state.network.trafos.find((row) => String(row.id) === String(state.selection.id));
      if (selected && !visibleTrafos.some((row) => String(row.id) === String(selected.id))) visibleTrafos.push(selected);
    }
    const byTmId = new Map();
    visibleTrafos.forEach((trafo) => {
      const tm = trafo.tm || getEntityTm(trafo);
      if (!tm || !insideBounds(tm.lon, tm.lat, bounds)) return;
      const key = String(tm.id);
      if (!byTmId.has(key)) byTmId.set(key, { tm, items: [] });
      byTmId.get(key).items.push(trafo);
    });

    byTmId.forEach(({ tm, items }) => {
      const center = screenPoint(tm.lon, tm.lat);
      buildFanoutSlots(sortTrafoItems(items), OUTER_RING_RADIUS).forEach((slot) => {
        const trafo = slot.item;
        const x = center.x + slot.dx;
        const y = center.y + slot.dy;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'trafo-marker');
        const visual = getMetricVisual('trafo', trafo);
        if (visual?.ringColor && shouldShowEntityRing('trafo')) {
          const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          ring.setAttribute('cx', round1(x));
          ring.setAttribute('cy', round1(y));
          ring.setAttribute('r', '7.2');
          ring.setAttribute('class', 'entity-marker-ring');
          ring.setAttribute('stroke', visual.ringColor);
          group.appendChild(ring);
        }
        if (trafo.type === 'transmission') {
          const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          diamond.setAttribute('points', `${round1(x)},${round1(y - 5.2)} ${round1(x + 5.2)},${round1(y)} ${round1(x)},${round1(y + 5.2)} ${round1(x - 5.2)},${round1(y)}`);
          diamond.setAttribute('fill', visual?.fillColor || TRAFO_TYPE_COLORS.transmission);
          diamond.setAttribute('class', `${isSelected('trafo-trans', trafo.id) ? 'feature-selected' : ''}`);
          group.appendChild(diamond);
        } else {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', round1(x));
          circle.setAttribute('cy', round1(y));
          circle.setAttribute('r', '4.8');
          circle.setAttribute('fill', visual?.fillColor || TRAFO_TYPE_COLORS.distribution);
          circle.setAttribute('class', `${isSelected('trafo-dist', trafo.id) ? 'feature-selected' : ''}`);
          group.appendChild(circle);
        }
        const isSelectedEntity = isSelected('trafo-dist', trafo.id) || isSelected('trafo-trans', trafo.id);
        const shouldLabel = shouldShowEntityValueBox('trafo', visual, isSelectedEntity);
        if (shouldLabel) {
          appendPillLabel(group, x + 8, y - 10, visual?.valueText || trafo.name, visual?.valueText ? 'value' : 'label');
        }
        const anchorCoord = getScreenGeoFromLocal(x, y);
        group.addEventListener('click', (event) => {
          event.stopPropagation();
          openTrafoDetails(trafo, anchorCoord);
        });
        attachHoverTooltip(group, `<strong>${trafo.name || '-'}</strong><br><span class="tt-label">${trafo.tmName || '-'}</span> · ${trafo.gerilimTuru || '-'}`);
        fragment.appendChild(group);
      });
    });

    el.trafoLayer.appendChild(fragment);
  };

  renderBaraLayer = function () {
    el.baraLayer.innerHTML = '';
    const isVoltageOverlayMode = state.scada?.enabled && getActiveScadaDomain() === 'bara';
    const displayMode = state.filters.scadaMapDisplayMode || 'box';
    const bounds = currentGeoBounds();
    const fragment = document.createDocumentFragment();
    if (isVoltageOverlayMode) {
      const overlayGroups = buildVoltageOverlayGroups().filter(({ tm }) => tm && insideBounds(tm.lon, tm.lat, bounds));
      if (displayMode === 'heatmap') {
        ensureHeatFilterDefs(el.baraLayer, 'scadaVoltageHeatBlur');
        const heatItems = overlayGroups.map((entry, index) => {
          const center = screenPoint(entry.tm.lon, entry.tm.lat);
          const representative = entry.representative;
          return {
            ...entry,
            representative,
            declutterX: center.x,
            declutterY: center.y,
            renderOrder: index,
            itemKey: `bara-heat:${representative?.bara?.id || entry.tm.id}`,
            forceVisible: entry.activeLevels.some((level) => isSelected('bara-node', level.bara.id))
          };
        }).filter((entry) => entry.representative);
        const heatGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        heatGroup.setAttribute('class', 'voltage-heatmap-group');
        applyScreenDeclutter(heatItems).forEach((entry) => {
          const center = screenPoint(entry.tm.lon, entry.tm.lat);
          const color = entry.representative.visual?.fillColor || '#2563eb';
          const radius = 20 + Math.min(30, Number(entry.representative.visual?.heatValue || 0) * 180);
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          group.setAttribute('class', 'voltage-overlay-item voltage-heatmap-item');
          appendHeatSpot(group, center.x, center.y, radius, color, 'voltage-heat-spot', 'scadaVoltageHeatBlur');
          group.addEventListener('click', (event) => {
            event.stopPropagation();
            openBaraNodeDetails(entry.representative.bara, { lon: Number(entry.tm.lon), lat: Number(entry.tm.lat) });
          });
          attachHoverTooltip(group, () => buildVoltageHoverTooltip(entry.representative), { owner: `bara:${entry.representative.bara.id}` });
          heatGroup.appendChild(group);
        });
        fragment.appendChild(heatGroup);
        el.baraLayer.appendChild(fragment);
        return;
      }

      if (displayMode === 'box') {
        const renderGroups = overlayGroups.map((entry, index) => {
          const center = screenPoint(entry.tm.lon, entry.tm.lat);
          return {
            ...entry,
            declutterX: center.x,
            declutterY: center.y,
            renderOrder: index,
            itemKey: `bara-box:${entry.tm.id}`,
            priorityScore: Number(entry.representative?.visual?.priorityScore || 0),
            forceVisible: entry.activeLevels.some((level) => isSelected('bara-node', level.bara.id))
          };
        });
        applyScreenDeclutter(renderGroups).forEach((entry) => {
          const center = screenPoint(entry.tm.lon, entry.tm.lat);
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          group.setAttribute('class', 'bara-node-marker voltage-overlay-group');
          appendPillLabelCentered(group, center.x, center.y - 28, entry.tm.name || '-', 'label');
          const levels = entry.activeLevels.slice(0, 2);
          const spacing = levels.length > 1 ? 36 : 0;
          levels.forEach((level, levelIndex) => {
            const offset = levels.length > 1 ? (levelIndex === 0 ? -spacing / 2 : spacing / 2) : 0;
            appendPillLabelCentered(group, center.x + offset, center.y - 2, level.visual?.rawValueText || formatOverlayMetricValue(level.record.primaryValue), 'value');
          });
          group.addEventListener('click', (event) => {
            event.stopPropagation();
            const target = entry.representative?.bara || entry.activeLevels[0]?.bara;
            if (!target) return;
            openBaraNodeDetails(target, { lon: Number(entry.tm.lon), lat: Number(entry.tm.lat) });
          });
          const owner = entry.representative?.bara?.id || entry.tm.id;
          attachHoverTooltip(group, () => buildVoltageHoverTooltip(entry.representative || entry.activeLevels[0]), { owner: `bara:${owner}` });
          fragment.appendChild(group);
        });
        el.baraLayer.appendChild(fragment);
        return;
      }

      const pointItems = overlayGroups
        .map((entry, index) => {
          const representative = entry.representative;
          if (!representative) return null;
          const center = screenPoint(entry.tm.lon, entry.tm.lat);
          return {
            ...entry,
            representative,
            declutterX: center.x,
            declutterY: center.y,
            renderOrder: index,
            itemKey: `bara-point:${representative.bara.id}`,
            priorityScore: Number(representative.visual?.priorityScore || 0),
            forceVisible: entry.activeLevels.some((level) => isSelected('bara-node', level.bara.id))
          };
        })
        .filter(Boolean);

      applyScreenDeclutter(pointItems).forEach((entry) => {
        const center = screenPoint(entry.tm.lon, entry.tm.lat);
        const representative = entry.representative;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'bara-node-marker voltage-overlay-item');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        marker.setAttribute('cx', round1(center.x));
        marker.setAttribute('cy', round1(center.y));
        marker.setAttribute('r', '10.2');
        marker.setAttribute('fill', representative.visual?.fillColor || '#2563eb');
        marker.setAttribute('opacity', '0.94');
        marker.setAttribute('class', `${isSelected('bara-node', representative.bara.id) ? 'feature-selected' : ''}`);
        group.appendChild(marker);
        if (displayMode === 'point-label') {
          appendPlainLabel(group, center.x + 14, center.y + 4, entry.tm.name || representative.bara.tmName || '-', 'entity-inline-label-voltage');
        }
        group.addEventListener('click', (event) => {
          event.stopPropagation();
          openBaraNodeDetails(representative.bara, { lon: Number(entry.tm.lon), lat: Number(entry.tm.lat) });
        });
        attachHoverTooltip(group, () => buildVoltageHoverTooltip(representative), { owner: `bara:${representative.bara.id}` });
        fragment.appendChild(group);
      });
      el.baraLayer.appendChild(fragment);
      return;
    }
    if (!state.filters.showBaras && !isSelectionForceVisible('bara-node')) return;
    const visibleBaras = getVisibleBaras().slice();
    if (isSelectionForceVisible('bara-node')) {
      const selectedBara = state.network.baraNodes.find((row) => String(row.id) === String(state.selection.id));
      if (selectedBara && !visibleBaras.some((row) => String(row.id) === String(selectedBara.id))) visibleBaras.push(selectedBara);
    }
    const byTmId = new Map();
    visibleBaras.forEach((bara) => {
      const tm = bara.tm || getEntityTm(bara);
      if (!tm || !insideBounds(tm.lon, tm.lat, bounds)) return;
      const key = String(tm.id);
      if (!byTmId.has(key)) byTmId.set(key, { tm, items: [] });
      byTmId.get(key).items.push(bara);
    });

    byTmId.forEach(({ tm, items }) => {
      const center = screenPoint(tm.lon, tm.lat);
      buildFanoutSlots(sortBaraItems(items), INNER_RING_RADIUS).forEach((slot) => {
        const bara = slot.item;
        const x = center.x + slot.dx;
        const y = center.y + slot.dy;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'bara-node-marker');
        const visual = getMetricVisual('bara', bara);
        if (visual?.ringColor && shouldShowEntityRing('bara')) {
          const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          ring.setAttribute('cx', round1(x));
          ring.setAttribute('cy', round1(y));
          ring.setAttribute('r', '6.6');
          ring.setAttribute('class', 'entity-marker-ring');
          ring.setAttribute('stroke', visual.ringColor);
          group.appendChild(ring);
        }
        const size = bara.kvBucket === '400' ? 8.6 : 7.2;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', round1(x - size / 2));
        rect.setAttribute('y', round1(y - size / 2));
        rect.setAttribute('width', size);
        rect.setAttribute('height', size);
        rect.setAttribute('fill', visual?.fillColor || BARA_COLORS[bara.kvBucket] || BARA_COLORS['']);
        rect.setAttribute('class', `${isSelected('bara-node', bara.id) ? 'feature-selected' : ''}`);
        group.appendChild(rect);
        const shouldLabel = shouldShowEntityValueBox('bara', visual, isSelected('bara-node', bara.id));
        if (shouldLabel) {
          appendPillLabel(group, x + 8, y - 10, visual?.valueText || `${bara.tmName || bara.name}`, visual?.valueText ? 'value' : 'label');
        }
        const anchorCoord = getScreenGeoFromLocal(x, y);
        group.addEventListener('click', (event) => {
          event.stopPropagation();
          openBaraNodeDetails(bara, anchorCoord);
        });
        attachHoverTooltip(group, `<strong>${bara.tmName || bara.name || '-'}</strong><br><span class="tt-label">${bara.gerilimKv || '?'} kV Bara</span> · ${bara.name || '-'}`);
        fragment.appendChild(group);
      });
    });

    el.baraLayer.appendChild(fragment);
  };

  renderAll = function (forceTiles = false) {
    renderTiles(forceTiles);
    renderHatLayer();
    if (typeof renderFlowLayer === 'function') renderFlowLayer();
    renderTmLayer();
    renderTrafoLayer();
    renderBaraLayer();
    renderBaraSetLayer();
    renderMeasureLayer();
    updateSummary();
    syncInfoCardPosition();
  };

  updateSummary = function () {
    el.baraCount.textContent = String(getVisibleBaras().length);
    el.tmCount.textContent = String(getVisibleTms().length);
    el.hatCount.textContent = String(getVisibleHats().length);
  };

  doSearch = function () {
    const query = normalizeText(el.searchInput.value);
    if (!query) return;
    clearSearchPins();

    const tm = state.network.tmPoints.find((row) => normalizeText([row.name, row.ytm, row.il, row.kmlDescriptionId].join(' ')).includes(query));
    if (tm) {
      const changes = ensureSearchVisibility({ kv: tm.kvBucket || tm.kv, ytm: tm.ytm });
      focusOn(Number(tm.lon), Number(tm.lat), tm.kvBucket === '400' ? 8 : 9);
      openTmInfo(tm);
      setStatus(`${tm.name} vurgulandi.${changes.length ? ` Filtreler gecici genisletildi: ${changes.join(', ')}.` : ''}`, changes.length ? 'warn' : 'info');
      requestRender({ forceTiles: true });
      return;
    }

    const hat = state.network.hatLines.find((row) => normalizeText([row.name, row.kmlDescriptionId, row.startTm, row.endTm, (row.ytmNames || []).join(' ')].join(' ')).includes(query));
    if (hat) {
      const changes = ensureSearchVisibility({ kv: hat.kvBucket || hat.kv, ytmNames: hat.ytmNames });
      const bbox = Array.isArray(hat.bbox) && hat.bbox.length === 4 ? hat.bbox : null;
      const centerLon = bbox ? (bbox[0] + bbox[2]) / 2 : Number(hat.lon || 0);
      const centerLat = bbox ? (bbox[1] + bbox[3]) / 2 : Number(hat.lat || 0);
      focusOn(centerLon || Number(hat.lon || 0), centerLat || Number(hat.lat || 0), hat.kvBucket === '400' ? 7 : 8);
      if (typeof openScadaHatDetails === 'function') {
        openScadaHatDetails(hat, { anchorCoord: getHatAnchorCoord(hat), forceTiles: true });
      }
      setStatus(`${hat.name} vurgulandi.${changes.length ? ` Filtreler gecici genisletildi: ${changes.join(', ')}.` : ''}`, changes.length ? 'warn' : 'info');
      requestRender({ forceTiles: true });
      return;
    }

    const trafo = state.network.trafos.find((row) => normalizeText([row.name, row.tmName, row.gerilimTuru, row.id].join(' ')).includes(query));
    if (trafo) {
      const tmRef = trafo.tm || getEntityTm(trafo);
      const changes = ensureSearchVisibility({ kv: trafo.kvBucket || getEffectiveTrafoKv(trafo), ytm: trafo.ytm || tmRef?.ytm });
      if (tmRef) focusOn(Number(tmRef.lon), Number(tmRef.lat), (trafo.kvBucket || getEffectiveTrafoKv(trafo)) === '400' ? 8 : 9);
      openTrafoDetails(trafo, tmRef ? { lon: Number(tmRef.lon), lat: Number(tmRef.lat) } : null);
      setStatus(`${trafo.name} vurgulandi.${changes.length ? ` Filtreler gecici genisletildi: ${changes.join(', ')}.` : ''}`, changes.length ? 'warn' : 'info');
      requestRender({ forceTiles: true });
      return;
    }

    const bara = state.network.baraNodes.find((row) => normalizeText([row.name, row.tmName, row.gerilimSeviyesi, row.id].join(' ')).includes(query));
    if (bara) {
      const tmRef = bara.tm || getEntityTm(bara);
      const changes = ensureSearchVisibility({ kv: bara.kvBucket || bara.gerilimKv, ytm: bara.ytm || tmRef?.ytm });
      if (tmRef) focusOn(Number(tmRef.lon), Number(tmRef.lat), bara.kvBucket === '400' ? 8 : 9);
      openBaraNodeDetails(bara, tmRef ? { lon: Number(tmRef.lon), lat: Number(tmRef.lat) } : null);
      setStatus(`${bara.name} vurgulandi.${changes.length ? ` Filtreler gecici genisletildi: ${changes.join(', ')}.` : ''}`, changes.length ? 'warn' : 'info');
      requestRender({ forceTiles: true });
      return;
    }

    setStatus('Arama sonucu bulunamadi.', 'warn');
  };

  globalThis.buildNetworkIndexes = buildNetworkIndexes;
  globalThis.getVisibleTrafoEntities = getVisibleTrafoEntities;
  globalThis.getVisibleTrafoDist = getVisibleTrafoDist;
  globalThis.getVisibleTrafoTransmission = getVisibleTrafoTransmission;
  globalThis.normalizeKvBucket = normalizeKvBucket;
  globalThis.normalizeTrafoType = normalizeTrafoType;
  globalThis.getEntityTm = getEntityTm;
  globalThis.openTrafoDetails = openTrafoDetails;
  globalThis.openBaraNodeDetails = openBaraNodeDetails;
  if (globalThis.__MAP_V2_TEST_HOOKS__) {
    Object.assign(globalThis.__MAP_V2_TEST_HOOKS__, {
      isTransferBaraForVoltage,
      selectActiveVoltagePerTmLevel
    });
  }
})();
