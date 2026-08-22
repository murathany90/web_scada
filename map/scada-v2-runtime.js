(function () {
  const METRIC_MODES = {
    'hat-active': { key: 'hat-active', label: 'Hat (MW)', domain: 'hat', primaryMetric: 'active', elementNames: ['P', 'Q'] },
    'hat-reactive': { key: 'hat-reactive', label: 'Hat (MVar)', domain: 'hat', primaryMetric: 'reactive', elementNames: ['P', 'Q'] },
    'trafo-active': { key: 'trafo-active', label: 'Trafo (MW)', domain: 'trafo', primaryMetric: 'active', elementNames: ['P', 'Q'] },
    'trafo-reactive': { key: 'trafo-reactive', label: 'Trafo (MVar)', domain: 'trafo', primaryMetric: 'reactive', elementNames: ['P', 'Q'] },
    'voltage': { key: 'voltage', label: 'Gerilim (kV)', domain: 'bara', primaryMetric: 'voltage', elementNames: ['U'] }
  };
  const STATUS_TEXT = {
    live: 'Canli',
    warn: 'Gecikmeli',
    dead: 'Bayat',
    ambiguous: 'Belirsiz'
  };
  const ENTITY_LABELS = {
    hat: 'Hatlar',
    'trafo-dist': 'Trafo (Dagitim)',
    'trafo-trans': 'Trafo (Iletim)',
    voltage: 'Gerilim (kV)'
  };
  const MVAR_RATIO_THRESHOLDS = [
    { max: 10, color: '#22c55e', label: '0-10%' },
    { max: 20, color: '#eab308', label: '10-20%' },
    { max: 30, color: '#f97316', label: '20-30%' },
    { max: 40, color: '#ef4444', label: '30-40%' },
    { max: 60, color: '#dc2626', label: '40-60%' },
    { max: Infinity, color: '#7c3aed', label: '60%+' }
  ];
  const INVALID_DISPLAY_THRESHOLD = 300;
  const HAT_VALUE_CAPACITY_MULTIPLIER = 1.5;
  const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
  const HISTORY_CACHE_MAX_ENTRIES = 40;
  const HAT_UNCERTAINTY_TEXT = {
    'reactive-active-too-low': {
      label: 'MW çok düşük',
      short: 'MW çok düşük / oran hesaplanamadı.',
      detail: 'MW çok düşük / oran hesaplanamadı'
    },
    'backup-terminal': {
      label: 'Yedek uc',
      short: 'Yedek uc olcumu kullanildi.',
      detail: 'Yedek uc olcumu kullanildi'
    },
    'candidate-conflict': {
      label: 'Aday uyusmazligi',
      short: 'Iki uc olcumu uyusmuyor.',
      detail: 'Iki uc olcumu arasinda deger uyumsuzlugu var'
    },
    'source-side-unknown': {
      label: 'Terminal belirsiz',
      short: 'Baslangic/bitis terminali dogrulanamadi.',
      detail: 'Baslangic/Bitis terminal eslesmesi dogrulanamadi'
    },
    'polarization-mismatch': {
      label: 'Polarizasyon uyusmaz',
      short: 'Formul polarizasyonu terminal tarafi ile uyusmuyor.',
      detail: 'Formul polarizasyon isareti terminal tarafiyle uyusmuyor'
    },
    'invalid-pct': {
      label: 'Gecersiz oran',
      short: 'Oran %300 uzerinde oldugu icin gecersiz kabul edildi.',
      detail: 'Oran %300 uzeri oldugu icin gecersiz kabul edildi'
    },
    'invalid-value': {
      label: 'Gecersiz deger',
      short: 'Olcum degeri kapasite sinirini asti.',
      detail: 'Olcum degeri 1.5x kapasite sinirini gectigi icin gecersiz kabul edildi'
    },
    'orientation-unknown': {
      label: 'Yon belirsiz',
      short: 'Yon belirlenemedi.',
      detail: 'Akis yonu guvenilir sekilde belirlenemedi'
    },
    'resolved-terminal-mismatch': {
      label: 'Terminal yorumlu cozum',
      short: 'Formul polarizasyonu uyusmadi; yon terminal isaretinden cozuldu.',
      detail: 'Formul polarizasyonu terminal beklentisiyle uyusmadi; akis yonu terminalin cikis/giris isaretine gore cozuldu'
    },
    'ambiguous-live': {
      label: 'Belirsiz canli',
      short: 'Canli adaylar birbiriyle celisiyor.',
      detail: 'Birden fazla canli aday kayit tutarsiz durumda'
    }
  };



  if (typeof globalThis !== 'undefined') {
    globalThis.__SCADA_V2_TEST_HOOKS__ = {
      formatScadaTerminalLabel,
      buildHatCurrentLimitLines,
      buildHatCurrentSeries,
      fetchHatVoltageHistory,
      resolveHatTerminalVoltageBara,
      mountInteractiveHistoryChart,
      buildHistoryCapacitySeries,
      parseHistorySeriesByElement,
      enrichHatHistorySeriesMetadata,
    fetchHatVoltageHistory,
      resolveTerminalSide,
      transformReactiveSeries,
      _nearestVoltageValue,
      prepareSortedHistoryPoints,
      findNearestSortedPoint,
      pruneHistoryCache,
      getHistoryCacheEntry,
      setHistoryCacheEntry
    };
  }
  if (typeof window !== 'undefined') {
    window.__SCADA_V2_TEST_HOOKS__ = globalThis.__SCADA_V2_TEST_HOOKS__;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports.__SCADA_V2_TEST_HOOKS__ = globalThis.__SCADA_V2_TEST_HOOKS__;
  }

  if (typeof state === 'undefined' || typeof SCADA_CONFIG === 'undefined') return;

  const rankingState = {
    search: '',
    sortCol: 'score',
    sortDir: -1,
    activeKey: '',
    entityFilter: state.filters?.scadaListEntity || 'hat',
    page: state.scadaPanel?.page || 1,
    fontScale: state.scadaPanel?.fontScale || 'normal'
  };

  state.scada.entityMetricsByKey = state.scada.entityMetricsByKey || new Map();
  state.scada.measurementRowsById = state.scada.measurementRowsById || new Map();
  state.scada.currentScope = state.scada.currentScope || null;
  state.scada.fetchSeq = state.scada.fetchSeq || 0;
  state.scada.v2RuntimeActive = true;
  globalThis.__TPYS_SCADA_V2_RUNTIME_ACTIVE__ = true;
  const SCADA_DASHBOARD_SNAPSHOT_KEY = 'scadaDashboardSnapshot';
  const SCADA_BACKGROUND_REFRESH_STATE_KEY = 'scadaBackgroundRefreshState';
  state.scada.visibleSummary = state.scada.visibleSummary || {
    total: 0,
    matched: 0,
    delayed: 0,
    dead: 0,
    stale: 0,
    unmatched: 0,
    ambiguousLive: 0,
    orientationUnknown: 0,
    updatedAt: null,
    filterKey: '',
    metricMode: state.filters?.scadaMetric || 'hat-active'
  };
  state.scada.history = state.scada.history || new Map();
  state.scada.history24hCache = state.scada.history24hCache || new Map();
  state.scada.hatVoltageHistoryCache = state.scada.hatVoltageHistoryCache || new Map();
  function pruneHistoryCache(cache, nowMs = Date.now()) {
    if (!(cache instanceof Map)) return;
    for (const [key, entry] of cache) {
      if (!entry || nowMs - Number(entry.fetchedAt || 0) >= HISTORY_CACHE_TTL_MS) cache.delete(key);
    }
    while (cache.size > HISTORY_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }

  function getHistoryCacheEntry(cache, key, nowMs = Date.now()) {
    pruneHistoryCache(cache, nowMs);
    const entry = cache.get(key);
    if (!entry) return null;
    // Map insertion order is our LRU order. Refresh it on every hit.
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  }

  function setHistoryCacheEntry(cache, key, entry, nowMs = Date.now()) {
    if (!(cache instanceof Map)) return;
    pruneHistoryCache(cache, nowMs);
    cache.delete(key);
    cache.set(key, entry);
    pruneHistoryCache(cache, nowMs);
  }
  state.scada.timeMode = state.scada.timeMode || 'live';
  state.scada.historicalAt = state.scada.historicalAt || null;
  state.scada.historicalSelectedAt = state.scada.historicalSelectedAt || null;
  state.scada.historicalSelectionOpen = Boolean(state.scada.historicalSelectionOpen);
  state.scada.lastLiveSnapshot = state.scada.lastLiveSnapshot || null;
  state.scada.pollState = state.scada.pollState || {
    timerId: null,
    nextDueAt: null,
    lastAutoRunAt: null,
    pendingAutoRefresh: false,
    lastVisibilityResumeAt: null
  };
  state.filters.scadaMetric = state.filters.scadaMetric || 'hat-active';
  state.filters.scadaListEntity = state.filters.scadaListEntity || 'hat';
  state.filters.scadaMapDisplayMode = state.filters.scadaMapDisplayMode || 'flow';
  state.scadaPanel = state.scadaPanel || { page: 1, pageSize: 50, fontScale: 'normal' };

  function getModeConfig(mode) {
    return METRIC_MODES[mode || state.filters.scadaMetric] || METRIC_MODES['hat-active'];
  }

  function getScadaMapDisplayOptions(modeConfig) {
    if (modeConfig.domain === 'hat') return ['flow', 'heatmap', 'current'];
    return ['box', 'point-label', 'point', 'heatmap'];
  }

  function normalizeScadaMapDisplayMode(modeConfig, requested) {
    const allowed = getScadaMapDisplayOptions(modeConfig);
    if (allowed.includes(requested)) return requested;
    return modeConfig.domain === 'hat' ? 'flow' : 'box';
  }

  function getScadaMapDisplayLabel(mode) {
    return {
      flow: 'Akis',
      heatmap: 'Isi Haritasi',
      current: 'Mevcut',
      point: 'Nokta (Adsiz)',
      'point-label': 'Nokta (Ad)',
      box: 'Kutu',
    }[mode] || mode;
  }

  function iconMarkup(name, srLabel = '') {
    if (typeof renderIcon !== 'function') return srLabel ? `<span>${escapeHtml(srLabel)}</span>` : '';
    return `${renderIcon(name)}${srLabel ? `<span class="sr-only">${escapeHtml(srLabel)}</span>` : ''}`;
  }

  function setScadaPanelPage(page) {
    const next = Math.max(1, Number(page) || 1);
    rankingState.page = next;
    state.scadaPanel.page = next;
  }

  function setScadaPanelFontScale(scale) {
    const next = ['compact', 'normal', 'large'].includes(scale) ? scale : 'normal';
    rankingState.fontScale = next;
    state.scadaPanel.fontScale = next;
  }

  function getPanelPageSize() {
    const pageSize = Number(state.scadaPanel?.pageSize || 50);
    return Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 50;
  }

  function parseColorChannels(colorValue) {
    const raw = String(colorValue || '').trim().toLowerCase();
    if (!raw) return null;
    const hexMatch = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1].length === 3
        ? hexMatch[1].split('').map((char) => char + char).join('')
        : hexMatch[1];
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }
    const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/);
    if (!rgbMatch) return null;
    const parts = rgbMatch[1].split(',').map((part) => Number(part.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((value) => !Number.isFinite(value))) return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }

  function getReadableTextColor(backgroundColor) {
    const channels = parseColorChannels(backgroundColor);
    if (!channels) return '#f8fafc';
    const [r, g, b] = [channels.r, channels.g, channels.b].map((value) => {
      const normalized = value / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    return luminance > 0.52 ? 'var(--chip-text-dark)' : '#f8fafc';
  }

  function getStalePriorityWeight(staleState) {
    if (staleState === 'live') return 3000000;
    if (staleState === 'warn') return 2000000;
    if (staleState === 'dead') return 1000000;
    return 0;
  }

  function getTimestampPriority(record) {
    return Number(record?.primaryTimestamp?.getTime?.() || 0) / 1000;
  }

  function buildVisualPriorityScore(record, severityValue, nominalKv = 0) {
    const severity = Number.isFinite(Number(severityValue)) ? Number(severityValue) : 0;
    const nominal = Number.isFinite(Number(nominalKv)) ? Number(nominalKv) : 0;
    return getStalePriorityWeight(record?.primaryStaleState) + (severity * 1000) + getTimestampPriority(record) + nominal;
  }

  function getThresholdColor(value, thresholds) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af';
    const bucket = (thresholds || []).find((entry) => numeric <= entry.max);
    return bucket?.color || (thresholds?.[thresholds.length - 1]?.color ?? SCADA_CONFIG.NO_MATCH_COLOR ?? '#9ca3af');
  }

  function getReactiveRatioColor(ratioPct) {
    return getThresholdColor(ratioPct, MVAR_RATIO_THRESHOLDS);
  }

  function getDisplayColor(record, options = {}) {
    if (!record) return SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af';
    if (record.invalidPct || record.valueInvalid) {
      return SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af';
    }
    // Live dead records are faded; historical dead records still carry their
    // threshold color so an old snapshot never collapses to gray.
    if (state.scada.timeMode !== 'historical' && record.primaryStaleState === 'dead') {
      return SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af';
    }
    if (options.respectStale !== false && record.primaryStaleState === 'warn') {
      // Gecikmeli veriler threshold rengini korur.
    }
    if (Number.isFinite(record.displayPct)) {
      return record.displayPctMode === 'reactive-ratio'
        ? getReactiveRatioColor(record.displayPct)
        : getFlowColor(record.displayPct);
    }
    if ((record.primaryMetric === 'active' || record.primaryMetric === 'reactive') && Number.isFinite(record.primaryValue)) {
      return SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af';
    }
    if (record.primaryMetric === 'voltage' && Number.isFinite(record.primaryValue) && typeof getVoltagePuColor === 'function') {
      const nominal = Number(record.entity?.gerilimKv || record.entity?.kvBucket || 0) || 0;
      const pu = nominal > 0 ? record.primaryValue / nominal : null;
      return Number.isFinite(pu) ? getVoltagePuColor(pu) : (SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af');
    }
    return SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af';
  }

  function hasHatUncertainty(record, options = {}) {
    if (!record) return false;
    if (record.entityType && record.entityType !== 'hat') return false;
    if (!record.entityType && !options.assumeHat) return false;
    const hasBlockingUncertainty = Boolean(record.uncertaintyReason && record.uncertaintyReason !== 'resolved-terminal-mismatch');
    return Boolean(record.sourceAmbiguous
      || record.unresolved
      || record.candidateConflict
      || record.backupUsed
      || hasBlockingUncertainty
      || record.valueInvalid);
  }

  function getHatResolutionClass(record) {
    if (!record) return 'missing';
    if (record.sourceAmbiguous || record.unresolved || ['orientation-unknown', 'source-side-unknown', 'polarization-mismatch'].includes(record.unresolvedReason)) return 'unresolved';
    if (record.candidateConflict || record.backupUsed || record.valueInvalid || record.invalidPct) return 'conflict';
    if (record.resolvedTerminalMismatch) return 'resolved-with-warning';
    if (!Number.isFinite(record.primaryValue)) return 'missing';
    return 'resolved';
  }

  function getHatResolutionLabel(record) {
    switch (getHatResolutionClass(record)) {
      case 'resolved-with-warning':
        return 'Terminal yorumlu';
      case 'unresolved':
        return 'Yon belirsiz';
      case 'conflict':
        return 'Uyarili';
      case 'missing':
        return 'Eksik';
      default:
        return 'Cozulmus';
    }
  }

  function getHatFlowDirection(record) {
    if (!record || record.entityType !== 'hat') return 'unknown';
    const directionValue = Number.isFinite(record.directionValue) ? record.directionValue : record.primaryValue;
    if (!Number.isFinite(directionValue)) return 'unknown';
    if (record.sourceAmbiguous || record.unresolved || record.candidateConflict || record.backupUsed || record.valueInvalid || record.invalidPct) return 'unknown';
    return directionValue >= 0 ? 'forward' : 'reverse';
  }

  function buildHatUncertaintyMeta(record) {
    const reasons = [];
    if (!record) {
      return {
        reasons,
        label: '',
        shortTooltip: '',
        detailLines: []
      };
    }
    if (record.backupUsed) reasons.push('backup-terminal');
    if (record.candidateConflict) reasons.push('candidate-conflict');
    if (record.unresolvedReason === 'source-side-unknown') reasons.push('source-side-unknown');
    else if (record.unresolvedReason === 'polarization-mismatch') reasons.push('polarization-mismatch');
    else if (record.unresolvedReason === 'orientation-unknown') reasons.push('orientation-unknown');
    else if (record.unresolvedReason === 'ambiguous-live' || record.sourceAmbiguous) reasons.push('ambiguous-live');
    if (record.resolvedTerminalMismatch) reasons.push('resolved-terminal-mismatch');
    if (record.displayPctReason === 'active-too-low') reasons.push('reactive-active-too-low');
    if (record.valueInvalid) reasons.push('invalid-value');
    if (record.invalidPct) reasons.push('invalid-pct');

    const uniqueReasons = [...new Set(reasons)];
    const labels = uniqueReasons
      .map((reason) => HAT_UNCERTAINTY_TEXT[reason])
      .filter(Boolean);
    return {
      reasons: uniqueReasons,
      label: labels.map((entry) => entry.label).join(' + '),
      shortTooltip: labels.map((entry) => entry.short).join(' '),
      detailLines: labels.map((entry) => entry.detail)
    };
  }

  function getMetricUnit(metricType) {
    if (metricType === 'active') return 'MW';
    if (metricType === 'reactive') return 'MVar';
    return 'kV';
  }

  function getCapacityLimit(entityType, entity) {
    const capacity = getCapacityMva(entityType, entity);
    if (!Number.isFinite(capacity) || capacity <= 0) return null;
    return capacity * HAT_VALUE_CAPACITY_MULTIPLIER;
  }

  function isTimeStateDead(state) {
    return state === 'dead';
  }

  function getPrimaryMetricType(mode) {
    return getModeConfig(mode).primaryMetric;
  }

  function pickPositiveCapacity(...values) {
    for (const value of values) {
      const numeric = Number(value || 0);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return null;
  }

  const METRIC_ELEMENT_BY_TYPE = { voltage: 'U', active: 'P', reactive: 'Q' };

  // Hat MVar colors use the current |Q|/|P| ratio, so a live reactive request
  // must fetch both metrics. Trafo reactive remains capacity based and only Q.
  function getLiveMetricTypes(modeConfig) {
    if (modeConfig.domain === 'bara') return ['voltage'];
    if (modeConfig.domain === 'hat' && modeConfig.primaryMetric === 'reactive') return ['active', 'reactive'];
    return [modeConfig.primaryMetric];
  }

  // History chart scope keeps pairing P+Q for hat/trafo and U for bara so the
  // |MW|, MVar and |S| panes can all render from one request.
  function getHistoryMetricTypes(modeConfig) {
    return modeConfig.domain === 'bara' ? ['voltage'] : ['active', 'reactive'];
  }

  function getFetchMetricTypes(modeConfig) {
    return getLiveMetricTypes(modeConfig);
  }

  function getVisibleEntitiesForMode(modeConfig) {
    if (modeConfig.domain === 'hat') return typeof getVisibleHats === 'function' ? getVisibleHats() : [];
    if (modeConfig.domain === 'trafo') return typeof getVisibleTrafoEntities === 'function' ? getVisibleTrafoEntities() : [];
    const visibleBaras = typeof getVisibleBaras === 'function' ? getVisibleBaras() : [];
    return visibleBaras.filter((bara) => ['154', '400'].includes(String(bara.kvBucket || bara.gerilimKv || '')));
  }

  function getCurrentScadaScope(options = {}) {
    const modeConfig = getModeConfig();
    const metricTypes = options?.history ? getHistoryMetricTypes(modeConfig) : getLiveMetricTypes(modeConfig);
    const entities = getVisibleEntitiesForMode(modeConfig);
    const measurementIds = new Set();
    metricTypes.forEach((metricType) => {
      entities.forEach((entity) => {
        const ids = entity?.scada?.[metricType]?.ids || [];
        ids.forEach((id) => measurementIds.add(String(id)));
      });
    });
    const elementNames = [...new Set(
      metricTypes.map((metricType) => METRIC_ELEMENT_BY_TYPE[metricType]).filter(Boolean)
    )];
    return {
      mode: modeConfig.key,
      modeLabel: modeConfig.label,
      domain: modeConfig.domain,
      primaryMetric: modeConfig.primaryMetric,
      metricTypes: metricTypes.slice(),
      elementNames,
      entities,
      measurementIds: [...measurementIds],
      filterKey: typeof getScadaVisibilityFilterKey === 'function'
        ? `${getScadaVisibilityFilterKey()}|mode:${modeConfig.key}`
        : `mode:${modeConfig.key}`
    };
  }

  function syncScadaMetricButtons() {
    const modeConfig = getModeConfig();
    const buttons = Array.from(document.querySelectorAll('[data-scada-metric]'));
    buttons.forEach((button) => {
      if (button.dataset.scadaMetric === 'active' || button.dataset.scadaMetric === 'reactive') {
        button.classList.toggle('active', modeConfig.domain !== 'bara' && modeConfig.primaryMetric === button.dataset.scadaMetric);
        return;
      }
      button.classList.toggle('active', button.dataset.scadaMetric === state.filters.scadaMetric);
    });
    // The MW/MVar row and the season control are power-mode only; the voltage
    // mode shows neither.
    const metricRow = document.getElementById('scadaMetricRow');
    if (metricRow) metricRow.classList.toggle('hidden', modeConfig.domain === 'bara');
    const seasonToggle = document.getElementById('scadaSeasonToggle');
    if (seasonToggle) seasonToggle.classList.toggle('hidden', modeConfig.domain === 'bara');
  }

  function syncScadaMapDisplayButtons() {
    const modeConfig = getModeConfig();
    const activeMode = normalizeScadaMapDisplayMode(modeConfig, state.filters.scadaMapDisplayMode);
    state.filters.scadaMapDisplayMode = activeMode;
    const buttons = Array.from(document.querySelectorAll('[data-scada-map-display]'));
    buttons.forEach((button) => {
      const buttonMode = button.dataset.scadaMapDisplay || '';
      const buttonDomain = button.dataset.domain === 'hat' ? 'hat' : 'entity';
      const isVisible = modeConfig.domain === 'hat' ? buttonDomain === 'hat' : buttonDomain === 'entity';
      button.classList.toggle('is-hidden', !isVisible);
      button.classList.toggle('active', isVisible && buttonMode === activeMode);
    });
    Array.from(document.querySelectorAll('[data-scada-display-group]')).forEach((group) => {
      const groupDomain = group.dataset.scadaDisplayGroup === 'hat' ? 'hat' : 'entity';
      group.classList.toggle('is-hidden', modeConfig.domain === 'hat' ? groupDomain !== 'hat' : groupDomain !== 'entity');
    });
    const label = document.getElementById('scadaDisplayModeLabel');
    if (label) label.textContent = getScadaMapDisplayLabel(activeMode);
  }

  function setScadaMapDisplayMode(mode) {
    const modeConfig = getModeConfig();
    const next = normalizeScadaMapDisplayMode(modeConfig, mode);
    if (state.filters.scadaMapDisplayMode === next) {
      syncScadaMapDisplayButtons();
      return;
    }
    state.filters.scadaMapDisplayMode = next;
    if (typeof persistMapPrefs === 'function') persistMapPrefs();
    syncScadaMapDisplayButtons();
    if (typeof requestRender === 'function') requestRender();
  }

  requestScadaOverlayRender = function (options = {}) {
    const styleOnly = options?.styleOnly === true;
    if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
    if (typeof renderFlowLayer === 'function') renderFlowLayer();
    // In style-only mode, still render dynamic layers to update SCADA-dependent visuals
    // (colors, tooltips, loading, etc.). Full rebuild is acceptable for SCADA refresh.
    if (typeof renderHatLayer === 'function') renderHatLayer();
    if (typeof renderTmLayer === 'function') renderTmLayer();
    if (typeof renderTrafoLayer === 'function') renderTrafoLayer();
    if (typeof renderBaraLayer === 'function') renderBaraLayer();
    if (typeof renderBaraSetLayer === 'function') renderBaraSetLayer();
    if (typeof renderMeasureLayer === 'function') renderMeasureLayer();
    if (typeof updateSummary === 'function') updateSummary();
    if (typeof syncInfoCardPosition === 'function') syncInfoCardPosition();
  };

  function setScadaMetric(mode, options = {}) {
    if (!METRIC_MODES[mode]) return;
    state.filters.scadaMetric = mode;
    if (mode.startsWith('hat')) state.filters.scadaListEntity = 'hat';
    if (mode.startsWith('trafo')) state.filters.scadaListEntity = state.filters.scadaListEntity === 'trafo-trans' ? 'trafo-trans' : 'trafo-dist';
    if (mode === 'voltage') state.filters.scadaListEntity = 'voltage';
    state.filters.scadaMapDisplayMode = normalizeScadaMapDisplayMode(getModeConfig(mode), state.filters.scadaMapDisplayMode);
    rankingState.entityFilter = state.filters.scadaListEntity;
    setScadaPanelPage(1);
    syncScadaMetricButtons();
    syncScadaMapDisplayButtons();
    if (state.scada.enabled && options.fetch !== false) scadaDoFetch({ trigger: 'mode-change' });
    requestScadaOverlayRender();
    if (typeof refreshRankingTable === 'function') refreshRankingTable();
  }

  function setRankingEntityFilter(filter) {
    if (!ENTITY_LABELS[filter]) return;
    rankingState.entityFilter = filter;
    state.filters.scadaListEntity = filter;
    if (filter === 'hat' && !state.filters.scadaMetric.startsWith('hat')) {
      setScadaMetric('hat-active');
      return;
    }
    if ((filter === 'trafo-dist' || filter === 'trafo-trans') && !state.filters.scadaMetric.startsWith('trafo')) {
      setScadaMetric('trafo-active');
      state.filters.scadaListEntity = filter;
      rankingState.entityFilter = filter;
      return;
    }
    if (filter === 'voltage' && state.filters.scadaMetric !== 'voltage') {
      setScadaMetric('voltage');
      return;
    }
    setScadaPanelPage(1);
    if (typeof refreshRankingTable === 'function') refreshRankingTable();
  }

  function getScadaTriggerLabel(triggerType) {
    switch (triggerType) {
      case 'manual': return 'Manuel';
      case 'auto': return 'Otomatik';
      case 'live-return': return 'Canliya donus';
      case 'historical-fallback-live': return 'Canliya donus (gecmis yok)';
      case 'layer-enable': return 'Katman';
      case 'mode-change': return 'Mod';
      case 'filter-change': return 'Filtre';
      default: return 'Sistem';
    }
  }

  function getCapacityMva(entityType, entity) {
    if (entityType === 'hat') {
      const season = state.scada.capacitySeason === 'summer' ? 'summer' : 'winter';
      const winter = Number(entity.winterCapacityMva || 0);
      const summer = Number(entity.summerCapacityMva || 0);
      return season === 'summer'
        ? pickPositiveCapacity(summer, winter)
        : pickPositiveCapacity(winter, summer);
    }
    if (entityType === 'trafo') {
      return pickPositiveCapacity(entity.ofafMva, entity.onafMva, entity.onanMva, entity.bazGucuMva);
    }
    return null;
  }

  // Freshness reference: historical views age records against the selected
  // instant instead of the clock, so a snapshot is not "stale" just because
  // it is older than today.
  function getScadaReferenceTimeMs() {
    return state.scada.timeMode === 'historical' &&
      Number.isFinite(Number(state.scada.historicalAt))
        ? Number(state.scada.historicalAt)
        : Date.now();
  }

  function formatAgeSeconds(ageSec) {
    if (ageSec < 60) return `${ageSec} sn`;
    const ageMin = Math.floor(ageSec / 60);
    if (ageMin < 60) return `${ageMin} dk`;
    const ageHour = Math.floor(ageMin / 60);
    const restMin = ageMin % 60;
    return restMin ? `${ageHour} sa ${restMin} dk` : `${ageHour} sa`;
  }

  function getStaleState(timestamp) {
    if (!timestamp) return 'dead';
    const ageSec = (getScadaReferenceTimeMs() - timestamp.getTime()) / 1000;
    if (ageSec > SCADA_CONFIG.STALE_DEAD_SEC) return 'dead';
    if (ageSec > SCADA_CONFIG.STALE_WARN_SEC) return 'warn';
    return 'live';
  }

  function getAgeLabel(timestamp) {
    if (!timestamp) return '';
    const ageSec = Math.max(0, Math.floor((getScadaReferenceTimeMs() - timestamp.getTime()) / 1000));
    const ageText = formatAgeSeconds(ageSec);
    return state.scada.timeMode === 'historical' ? `Secili andan ${ageText} once` : ageText;
  }

  // Single visible progress component feeds from this operation record. Only
  // the active requestId may mutate it, so stale async replies never move the
  // bar. Stage-based percentages: prepare 0-10, auth 10-20, batches 20-75
  // (background reports real completed batches), fallback 75-85, normalize
  // 85-92, match/render 92-100.
  function setScadaOperationMeta(patch) {
    state.scada.operationMeta = {
      ...(state.scada.operationMeta || {}),
      ...(patch || {}),
      updatedAt: new Date()
    };
    if (typeof syncScadaFetchUi === 'function') syncScadaFetchUi();
    return state.scada.operationMeta;
  }

  function clearScadaOperationMeta() {
    state.scada.operationMeta = null;
    if (typeof syncScadaFetchUi === 'function') syncScadaFetchUi();
  }

  // Background batch progress only moves the active operation; any other
  // requestId (older fetch, superseded project) is ignored.
  function handleScadaFetchProgressMessage(progress) {
    const op = state.scada.operationMeta;
    if (!op?.requestId || progress?.requestId !== op.requestId) return;
    const completed = Number(progress.completedBatches) || 0;
    const total = Number(progress.totalBatches) || 1;
    const totalMeasurements = Number(op.totalMeasurements) || 0;
    if (progress.stage === 'fallback') {
      setScadaOperationMeta({
        stage: 'fallback',
        progressPct: Math.max(75, Math.min(85, Number(progress.progressPct) || 80)),
        message: op.kind === 'enrichment'
          ? 'Eksik olcumler genis pencereden tamamlaniyor...'
          : 'Bos veriler genis pencereden tamamlaniyor'
      });
      return;
    }
    const pct = Math.max(20, Math.min(75, 20 + Math.round((completed / total) * 55)));
    setScadaOperationMeta({
      stage: 'batches',
      progressPct: pct,
      completedBatches: completed,
      totalBatches: total,
      message: op.kind === 'enrichment'
        ? `Eksik olcumler arka planda tamamlaniyor (batch ${completed}/${total})...`
        : `Batch ${completed}/${total} • ${totalMeasurements} olcum sorgulaniyor`
    });
  }

  function sameTimestamp(left, right) {
    return Number(left?.timestamp?.getTime?.() || 0) === Number(right?.timestamp?.getTime?.() || 0);
  }

  function roundMetricValue(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function getHatResolutionTolerance(entity) {
    const absoluteTolerance = Number(SCADA_CONFIG.HAT_AMBIGUOUS_ABS_TOLERANCE_MW || 12);
    const relativeTolerance = Number(SCADA_CONFIG.HAT_AMBIGUOUS_REL_TOLERANCE || 0.08);
    const capacityMva = getCapacityMva('hat', entity);
    const capacityTolerance = Number.isFinite(capacityMva) && capacityMva > 0
      ? capacityMva * relativeTolerance
      : 0;
    return Math.max(
      Number.isFinite(absoluteTolerance) && absoluteTolerance > 0 ? absoluteTolerance : 12,
      capacityTolerance
    );
  }

  function sameMetricDirection(values) {
    const directionSet = new Set(values
      .filter((value) => Number.isFinite(value) && Math.abs(value) > 1)
      .map((value) => (value >= 0 ? 'forward' : 'reverse')));
    return directionSet.size <= 1;
  }

  function compactAlias(value) {
    return String(normalizeText(value || '') || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function aliasTokenVariants(value) {
    const variants = new Set();
    const compact = compactAlias(value);
    if (compact) variants.add(compact);
    const rawParts = String(value || '').split(/[^0-9A-Za-zçğıöşüÇĞİÖŞÜ]+/);
    const normalizedParts = String(normalizeText(value || '') || '').split(/[^0-9a-zA-Z]+/);
    [...rawParts, ...normalizedParts].forEach((part) => {
      const token = compactAlias(part);
      if (!token) return;
      variants.add(token);
      const noLineSuffix = token.replace(/(?:h|g|tr)?\d+$/i, '');
      if (noLineSuffix.length >= 3) variants.add(noLineSuffix);
      const noDigits = token.replace(/\d+$/i, '');
      if (noDigits.length >= 3) variants.add(noDigits);
    });
    return [...variants].filter((variant) => variant.length >= 2);
  }

  function stripAliasSuffix(value) {
    let next = compactAlias(value);
    const suffixes = [
      'trafomerkezi',
      'merkezi',
      'merkez',
      'santrali',
      'santral',
      'dagitim',
      'iletim',
      'havza',
      'tes',
      'hes',
      'gis',
      'osb',
      'tm'
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of suffixes) {
        if (next.endsWith(suffix) && next.length > suffix.length + 2) {
          next = next.slice(0, -suffix.length);
          changed = true;
        }
      }
    }
    return next;
  }

  function stripAliasVowels(value) {
    return compactAlias(value).replace(/[aeiouy]/g, '');
  }

  function addAliasVariant(bucket, rawValue, basis) {
    const compact = compactAlias(rawValue);
    if (!compact) return;
    if (!bucket.has(compact)) bucket.set(compact, basis);
    const trimmed = stripAliasSuffix(compact);
    if (trimmed && trimmed !== compact && !bucket.has(trimmed)) bucket.set(trimmed, `${basis}:trim`);
    [compact, trimmed].filter(Boolean).forEach((candidate) => {
      if (candidate.length >= 6) {
        const prefix = candidate.slice(0, 6);
        if (!bucket.has(prefix)) bucket.set(prefix, `${basis}:prefix6`);
      }
      [4, 5, 6].forEach((tailLength) => {
        if (candidate.length > tailLength + 1) {
          const abbreviated = `${candidate[0]}${candidate.slice(-tailLength)}`;
          if (!bucket.has(abbreviated)) bucket.set(abbreviated, `${basis}:abbr${tailLength}`);
        }
      });
      const noVowels = stripAliasVowels(candidate);
      if (noVowels.length >= 4 && !bucket.has(noVowels)) bucket.set(noVowels, `${basis}:novowel`);
    });
  }

  function buildTmAliasEntries(tmRef, fallbackName = '') {
    const bucket = new Map();
    addAliasVariant(bucket, tmRef?.name || fallbackName, 'tm-name');
    addAliasVariant(bucket, tmRef?.ucteKodu || '', 'ucte');
    addAliasVariant(bucket, tmRef?.psseAdi || '', 'psse');
    return [...bucket.entries()].map(([value, basis]) => ({
      value,
      basis,
      noVowels: stripAliasVowels(value)
    }));
  }

  function scoreAliasToken(token, aliasEntries) {
    const variants = aliasTokenVariants(token);
    if (!variants.length || !Array.isArray(aliasEntries) || !aliasEntries.length) return null;
    let best = null;
    variants.forEach((compact) => {
      const tokenNoVowels = stripAliasVowels(stripAliasSuffix(compact));
      aliasEntries.forEach((entry) => {
        const alias = entry.value;
        let score = 0;
        let relation = '';
        if (compact === alias) {
          score = 100;
          relation = 'exact';
        } else if (alias.startsWith(compact) && compact.length >= 4) {
          score = 94;
          relation = 'token-prefix';
        } else if (compact.startsWith(alias) && alias.length >= 4) {
          score = 93;
          relation = 'alias-prefix';
        } else if (alias.includes(compact) && compact.length >= 5) {
          score = 86;
          relation = 'token-substring';
        } else if (compact.includes(alias) && alias.length >= 5) {
          score = 85;
          relation = 'alias-substring';
        } else if (entry.noVowels && tokenNoVowels) {
          if (tokenNoVowels === entry.noVowels) {
            score = 78;
            relation = 'novowel-exact';
          } else if (entry.noVowels.startsWith(tokenNoVowels) && tokenNoVowels.length >= 4) {
            score = 74;
            relation = 'novowel-token-prefix';
          } else if (tokenNoVowels.startsWith(entry.noVowels) && entry.noVowels.length >= 4) {
            score = 73;
            relation = 'novowel-alias-prefix';
          }
        }
        if (!score) return;
        const candidate = {
          score,
          relation,
          basis: entry.basis,
          token: compact,
          alias
        };
        if (!best
          || candidate.score > best.score
          || (candidate.score === best.score && String(candidate.alias || '').length < String(best.alias || '').length)) {
          best = candidate;
        }
      });
    });
    return best;
  }

  function scoreAliasSide(token, startAliases, endAliases) {
    const toStart = scoreAliasToken(token, startAliases);
    const toEnd = scoreAliasToken(token, endAliases);
    if (!toStart && !toEnd) return null;
    if (toStart && (!toEnd || toStart.score >= toEnd.score + 2)) {
      return { side: 'start', match: toStart };
    }
    if (toEnd && (!toStart || toEnd.score >= toStart.score + 2)) {
      return { side: 'end', match: toEnd };
    }
    return { side: 'unknown', match: null, conflict: true };
  }

  function resolveOrientationByCandidateSides(candidate) {
    const sourceSide = candidate?.sourceSide || 'unknown';
    const targetSide = candidate?.targetSide || 'unknown';
    if (sourceSide === 'start') {
      return {
        orientation: 1,
        orientationMatch: 'forward',
        directionResolvedBy: 'candidate-side',
        aliasMatchBasis: `sourceSide:start; targetSide:${targetSide || 'unknown'}; slot:${candidate?.candidateSlot || ''}`,
        orientationRule: 'source-side'
      };
    }
    if (sourceSide === 'end') {
      return {
        orientation: -1,
        orientationMatch: 'reverse',
        directionResolvedBy: 'candidate-side',
        aliasMatchBasis: `sourceSide:end; targetSide:${targetSide || 'unknown'}; slot:${candidate?.candidateSlot || ''}`,
        orientationRule: 'source-side'
      };
    }
    if (targetSide === 'end') {
      return {
        orientation: 1,
        orientationMatch: 'forward',
        directionResolvedBy: 'candidate-side',
        aliasMatchBasis: `sourceSide:${sourceSide || 'unknown'}; targetSide:end; slot:${candidate?.candidateSlot || ''}`,
        orientationRule: 'target-side'
      };
    }
    if (targetSide === 'start') {
      return {
        orientation: -1,
        orientationMatch: 'reverse',
        directionResolvedBy: 'candidate-side',
        aliasMatchBasis: `sourceSide:${sourceSide || 'unknown'}; targetSide:start; slot:${candidate?.candidateSlot || ''}`,
        orientationRule: 'target-side'
      };
    }
    return null;
  }

  function resolveOrientationByAlias(sourceToken, targetToken, startAliases, endAliases, resolvedBy) {
    const sourceToStart = scoreAliasToken(sourceToken, startAliases);
    const targetToEnd = scoreAliasToken(targetToken, endAliases);
    const sourceToEnd = scoreAliasToken(sourceToken, endAliases);
    const targetToStart = scoreAliasToken(targetToken, startAliases);
    const forwardScore = sourceToStart && targetToEnd
      ? Math.min(sourceToStart.score, targetToEnd.score)
      : 0;
    const reverseScore = sourceToEnd && targetToStart
      ? Math.min(sourceToEnd.score, targetToStart.score)
      : 0;
    if (forwardScore && (!reverseScore || forwardScore >= reverseScore + 2)) {
      return {
        orientation: 1,
        orientationMatch: 'forward',
        directionResolvedBy: resolvedBy,
        aliasMatchBasis: `source:${sourceToStart.basis}/${sourceToStart.relation}; target:${targetToEnd.basis}/${targetToEnd.relation}`,
        orientationRule: 'dual-alias'
      };
    }
    if (reverseScore && (!forwardScore || reverseScore >= forwardScore + 2)) {
      return {
        orientation: -1,
        orientationMatch: 'reverse',
        directionResolvedBy: resolvedBy,
        aliasMatchBasis: `source:${sourceToEnd.basis}/${sourceToEnd.relation}; target:${targetToStart.basis}/${targetToStart.relation}`,
        orientationRule: 'dual-alias'
      };
    }
    if (forwardScore || reverseScore) {
      return {
        orientation: null,
        orientationMatch: 'unknown',
        directionResolvedBy: resolvedBy,
        aliasMatchBasis: 'conflicting-dual-alias-match',
        orientationRule: 'dual-alias-conflict'
      };
    }

    const sideMatches = [];
    const sourceSide = scoreAliasSide(sourceToken, startAliases, endAliases);
    const targetSide = scoreAliasSide(targetToken, startAliases, endAliases);
    if (sourceSide?.side === 'start') {
      sideMatches.push({
        orientation: 1,
        orientationMatch: 'forward',
        basis: `source:${sourceSide.match.basis}/${sourceSide.match.relation}`,
        rule: 'single-source'
      });
    } else if (sourceSide?.side === 'end') {
      sideMatches.push({
        orientation: -1,
        orientationMatch: 'reverse',
        basis: `source:${sourceSide.match.basis}/${sourceSide.match.relation}`,
        rule: 'single-source'
      });
    }
    if (targetSide?.side === 'end') {
      sideMatches.push({
        orientation: 1,
        orientationMatch: 'forward',
        basis: `target:${targetSide.match.basis}/${targetSide.match.relation}`,
        rule: 'single-target'
      });
    } else if (targetSide?.side === 'start') {
      sideMatches.push({
        orientation: -1,
        orientationMatch: 'reverse',
        basis: `target:${targetSide.match.basis}/${targetSide.match.relation}`,
        rule: 'single-target'
      });
    }
    if (!sideMatches.length) return null;
    const first = sideMatches[0];
    if (sideMatches.every((match) => match.orientation === first.orientation)) {
      return {
        orientation: first.orientation,
        orientationMatch: first.orientationMatch,
        directionResolvedBy: `${resolvedBy}-${[...new Set(sideMatches.map((match) => match.rule))].join('+')}`,
        aliasMatchBasis: sideMatches.map((match) => match.basis).join('; '),
        orientationRule: [...new Set(sideMatches.map((match) => match.rule))].join('+')
      };
    }
    return {
      orientation: null,
      orientationMatch: 'unknown',
      directionResolvedBy: resolvedBy,
      aliasMatchBasis: 'conflicting-single-side-alias-match',
      orientationRule: 'single-side-conflict'
    };
  }

  function resolveMeasuredTerminalSide(row, candidate, startAliases, endAliases) {
    const rowTm = String(row?.tmName || '').trim();
    const rowSide = rowTm ? scoreAliasSide(rowTm, startAliases, endAliases) : null;
    if (rowSide?.side === 'start' || rowSide?.side === 'end') {
      return {
        terminalSide: rowSide.side,
        terminalMatchBasis: `row-tm:${rowSide.match?.basis || 'alias'}/${rowSide.match?.relation || 'match'}`,
        terminalSource: 'row-tm'
      };
    }
    return {
      terminalSide: String(candidate?.terminalSide || candidate?.sourceSide || '').trim(),
      terminalMatchBasis: String(candidate?.terminalMatchBasis || '').trim(),
      terminalSource: 'candidate-meta'
    };
  }

  function collectMeasurementIds(entries) {
    return entries
      .map((entry) => String(entry?.measurementId || entry?.candidate?.measurementId || '').trim())
      .filter(Boolean);
  }

  function candidateSlotRank(entry) {
    const slot = entry?.candidateSlot || entry?.candidate?.candidateSlot || '';
    if (slot === 'primary') return 0;
    if (slot === 'secondary') return 1;
    if (slot === 'extra') return 2;
    return 3;
  }

  function finalizeResolvedHatEntry(entry, options = {}) {
    if (!entry) return null;
    const entries = Array.isArray(options.entries) && options.entries.length ? options.entries : [entry];
    const measurementIds = collectMeasurementIds(entries);
    const selectedMeasurementId = String(entry.measurementId || entry?.candidate?.measurementId || '').trim();
    const selectedSlot = entry.candidateSlot || entry?.candidate?.candidateSlot || '';
    const hadPrimaryCandidate = entries.some((item) => (item.candidateSlot || item?.candidate?.candidateSlot) === 'primary');
    return {
      ...entry,
      value: entry.normalizedValue,
      sourceValue: entry.rawValue,
      flowValue: entry.normalizedValue,
      measurementId: measurementIds.join(',') || String(entry.measurementId || entry?.candidate?.measurementId || '').trim(),
      supportingMeasurementIds: measurementIds,
      sourceAmbiguous: Boolean(options.sourceAmbiguous),
      unresolved: Boolean(options.unresolved),
      unresolvedReason: options.unresolvedReason || '',
      resolvedFromMultiple: Boolean(options.resolvedFromMultiple),
      resolutionMethod: options.resolutionMethod || entry.resolutionMethod || '',
      candidateConflict: Boolean(options.candidateConflict || entry.candidateConflict),
      selectedCandidate: options.selectedCandidate || selectedMeasurementId,
      selectedCandidateReason: options.selectedCandidateReason || entry.selectedCandidateReason || '',
      backupUsed: Boolean(options.backupUsed ?? entry.backupUsed ?? (selectedSlot === 'secondary' && hadPrimaryCandidate)),
      candidateSlot: selectedSlot,
      sourceSide: entry.sourceSide || entry?.candidate?.sourceSide || '',
      targetSide: entry.targetSide || entry?.candidate?.targetSide || '',
      terminalSide: entry.terminalSide || entry?.candidate?.terminalSide || entry.sourceSide || entry?.candidate?.sourceSide || '',
      terminalMatchBasis: entry.terminalMatchBasis || entry?.candidate?.terminalMatchBasis || '',
      polarizationSign: Number.isFinite(Number(entry.polarizationSign ?? entry?.candidate?.polarizationSign))
        ? Number(entry.polarizationSign ?? entry?.candidate?.polarizationSign)
        : null,
      polarizationConsistent: typeof (entry.polarizationConsistent ?? entry?.candidate?.polarizationConsistent) === 'boolean'
        ? Boolean(entry.polarizationConsistent ?? entry?.candidate?.polarizationConsistent)
        : null,
      resolvedTerminalMismatch: Boolean(options.resolvedTerminalMismatch ?? entry.resolvedTerminalMismatch),
      formulaSignApplied: Number.isFinite(Number(entry.formulaSign)) ? Number(entry.formulaSign) : null,
      orientationRule: options.orientationRule || entry.orientationRule || entry.directionResolvedBy || '',
      valueInvalid: Boolean(options.valueInvalid ?? entry.valueInvalid),
      capacityLimit: Number.isFinite(Number(options.capacityLimit ?? entry.capacityLimit)) ? Number(options.capacityLimit ?? entry.capacityLimit) : null,
      capacityFilterPassed: typeof (options.capacityFilterPassed ?? entry.capacityFilterPassed) === 'boolean'
        ? Boolean(options.capacityFilterPassed ?? entry.capacityFilterPassed)
        : null,
      candidateOutcomes: Array.isArray(options.candidateOutcomes) ? options.candidateOutcomes : (Array.isArray(entry.candidateOutcomes) ? entry.candidateOutcomes : [])
    };
  }

  function getLoadingHintValue(entry) {
    if (!entry) return null;
    if (Number.isFinite(Number(entry.loadingHintValue))) return Math.abs(Number(entry.loadingHintValue));
    if (Number.isFinite(Number(entry.normalizedValue))) return Math.abs(Number(entry.normalizedValue));
    return null;
  }

  function getMaxLoadingHint(entries) {
    const hints = (entries || [])
      .map((entry) => getLoadingHintValue(entry))
      .filter((value) => Number.isFinite(value));
    return hints.length ? Math.max(...hints) : null;
  }

  function computeLoadingMagnitude(entityType, resolved) {
    if (entityType === 'hat') {
      const activeMagnitude = getLoadingHintValue(resolved.active);
      const reactiveMagnitude = getLoadingHintValue(resolved.reactive);
      if (Number.isFinite(activeMagnitude)) {
        const reactiveForLoading = Number.isFinite(reactiveMagnitude) ? reactiveMagnitude : 0;
        return Math.sqrt((activeMagnitude ** 2) + (reactiveForLoading ** 2));
      }
      if (Number.isFinite(reactiveMagnitude)) return reactiveMagnitude;
      return null;
    }
    const primaryMetric = resolved.active || resolved.reactive || resolved.voltage || null;
    return getLoadingHintValue(primaryMetric);
  }

  function computeReactiveRatioPct(resolved) {
    const reactiveMagnitude = getLoadingHintValue(resolved?.reactive);
    if (!Number.isFinite(reactiveMagnitude)) return null;
    const activeMagnitude = getLoadingHintValue(resolved?.active);
    if (!Number.isFinite(activeMagnitude) || Math.abs(activeMagnitude) < 1) return null;
    return (Math.abs(reactiveMagnitude) / Math.abs(activeMagnitude)) * 100;
  }

  function isHatMetricValueInvalid(entity, metricType, normalizedValue) {
    const capacityLimit = getCapacityLimit('hat', entity);
    if (!Number.isFinite(capacityLimit) || !Number.isFinite(normalizedValue)) return false;
    if (metricType !== 'active' && metricType !== 'reactive') return false;
    return Math.abs(normalizedValue) > capacityLimit;
  }

  function buildHatCandidateOutcome(entry, selectedIds = new Set()) {
    const measurementId = String(entry?.candidate?.measurementId || entry?.measurementId || '').trim();
    return {
      measurementId,
      formulaRaw: entry?.candidate?.formulaRaw || '',
      rawValue: Number.isFinite(Number(entry?.rawValue)) ? Number(entry.rawValue) : null,
      normalizedValue: Number.isFinite(Number(entry?.normalizedValue)) ? Number(entry.normalizedValue) : null,
      timestamp: entry?.timestamp || null,
      terminalSide: entry?.terminalSide || entry?.sourceSide || '',
      terminalMatchBasis: entry?.terminalMatchBasis || '',
      candidateSlot: entry?.candidateSlot || '',
      selected: selectedIds.has(measurementId),
      valueInvalid: Boolean(entry?.valueInvalid),
      capacityLimit: Number.isFinite(Number(entry?.capacityLimit)) ? Number(entry.capacityLimit) : null,
      capacityFilterPassed: typeof entry?.capacityFilterPassed === 'boolean' ? Boolean(entry.capacityFilterPassed) : null,
      resolvedTerminalMismatch: Boolean(entry?.resolvedTerminalMismatch)
    };
  }

  function buildHatCandidateOutcomeList(entries, selectedMeasurementId) {
    const selectedIds = new Set(String(selectedMeasurementId || '').split(',').map((id) => id.trim()).filter(Boolean));
    return (entries || []).map((entry) => buildHatCandidateOutcome(entry, selectedIds));
  }

  function getHatSelectionReason(key, context = {}) {
    const capacityFiltered = Boolean(context.capacityFiltered);
    switch (key) {
      case 'single-candidate':
        return capacityFiltered ? 'Kapasite filtresini gecen tek aday oldugu icin secildi.' : 'Tek gecerli aday oldugu icin secildi.';
      case 'latest-terminal':
        return capacityFiltered ? 'Kapasite filtresini gecen en yeni aday secildi.' : 'En yeni aday secildi.';
      case 'same-value':
        return 'Adaylar ayni degeri verdigi icin secildi.';
      case 'tolerance-primary':
        return 'Adaylar tolerans icinde oldugu icin primary aday secildi.';
      case 'primary-conflict':
        return 'Adaylar tolerans disi oldugu icin primary/start adayi tercih edildi.';
      case 'invalid-value':
        return 'Tum adaylar 1.5x kapasite sinirini gectigi icin secim yapilmadi.';
      case 'orientation-unknown':
        return 'Adaylar icin guvenilir yon normalize edilemedi.';
      default:
        return '';
    }
  }

  function computeHatDisplayMetrics(modeConfig, resolved, loadingPct) {
    if (modeConfig.primaryMetric === 'reactive') {
      const ratioPct = computeReactiveRatioPct(resolved);
      if (!Number.isFinite(ratioPct)) {
        const activeMagnitude = getLoadingHintValue(resolved?.active);
        return {
          displayPct: null,
          displayPctRaw: null,
          displayPctMode: 'reactive-ratio',
          invalidPct: Number.isFinite(getLoadingHintValue(resolved?.reactive)),
          displayPctReason: Number.isFinite(activeMagnitude) && Math.abs(activeMagnitude) < 1
            ? 'active-too-low'
            : ''
        };
      }
      return {
        displayPct: ratioPct,
        displayPctRaw: ratioPct,
        displayPctMode: 'reactive-ratio',
        invalidPct: false,
        displayPctReason: ''
      };
    }
    return {
      displayPct: Number.isFinite(loadingPct) ? loadingPct : null,
      displayPctRaw: Number.isFinite(loadingPct) ? loadingPct : null,
      displayPctMode: 'loading',
      invalidPct: Number.isFinite(loadingPct) && loadingPct > INVALID_DISPLAY_THRESHOLD,
      displayPctReason: ''
    };
  }

  function resolveHatMetricByTolerance(entity, entries) {
    const values = entries
      .map((entry) => Number(entry.normalizedValue))
      .filter((value) => Number.isFinite(value));
    if (!values.length || !sameMetricDirection(values)) return null;
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    if ((maxValue - minValue) > getHatResolutionTolerance(entity)) return null;
    const candidateMean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const primary = entries.slice().sort((left, right) => {
      const slotDiff = candidateSlotRank(left) - candidateSlotRank(right);
      if (slotDiff !== 0) return slotDiff;
      const timeDiff = Number(right.timestamp?.getTime?.() || 0) - Number(left.timestamp?.getTime?.() || 0);
      if (timeDiff !== 0) return timeDiff;
      const idLeft = String(left.measurementId || '');
      const idRight = String(right.measurementId || '');
      return idLeft.localeCompare(idRight);
    })[0];
    return finalizeResolvedHatEntry({
      ...primary,
      normalizedValue: primary.normalizedValue,
      directionValue: primary.directionValue != null ? primary.directionValue : primary.normalizedValue,
      loadingHintValue: Math.abs(primary.normalizedValue),
      candidateMean
    }, {
      entries,
      sourceAmbiguous: false,
      unresolved: false,
      resolvedFromMultiple: entries.length > 1,
      resolutionMethod: 'tolerance-primary',
      selectedCandidateReason: getHatSelectionReason('tolerance-primary')
    });
  }

  function pickHatUnresolvedReason(entries) {
    const priority = ['polarization-mismatch', 'source-side-unknown', 'orientation-unknown', 'ambiguous-live'];
    for (const reason of priority) {
      if ((entries || []).some((entry) => entry?.unresolvedReason === reason)) return reason;
    }
    return 'orientation-unknown';
  }

  function resolveHatMetric(entity, metricType, candidates) {
    const startAliases = buildTmAliasEntries(entity.startTmRef, entity.startTm || '');
    const endAliases = buildTmAliasEntries(entity.endTmRef, entity.endTm || '');
    const oriented = candidates.map(({ candidate, row }) => {
      const formula = Array.isArray(candidate.formulaParts) ? candidate.formulaParts.find((part) => part?.parsed) : null;
      const sign = Number(formula?.sign ?? candidate?.formulaSign);
      const rawValue = Number(row.value);
      const measuredTerminal = resolveMeasuredTerminalSide(row, candidate, startAliases, endAliases);
      const terminalSide = measuredTerminal.terminalSide;
      const terminalMatchBasis = measuredTerminal.terminalMatchBasis;
      const candidatePolarizationSign = terminalSide === 'start'
        ? 1
        : terminalSide === 'end'
          ? -1
          : null;
      const explicitConsistency = typeof candidate?.polarizationConsistent === 'boolean'
        ? Boolean(candidate.polarizationConsistent)
        : null;
      const hasTerminalMetadata = Boolean(terminalSide || terminalMatchBasis || Number.isFinite(candidatePolarizationSign));
      let normalizedValue = null;
      let directionValue = null;
      let directionResolvedBy = '';
      let orientationMatch = 'unknown';
      let aliasMatchBasis = terminalMatchBasis || '';
      let orientationRule = '';
      let unresolvedReason = '';
      let resolvedTerminalMismatch = false;

      if (Number.isFinite(rawValue) && hasTerminalMetadata) {
        if (terminalSide !== 'start' && terminalSide !== 'end') {
          unresolvedReason = 'source-side-unknown';
        } else {
          const polarizationConsistent = explicitConsistency === false
            ? false
            : explicitConsistency === true
              ? true
              : Number.isFinite(candidatePolarizationSign) && Number.isFinite(sign)
                ? sign === candidatePolarizationSign
                : true;
          if (Number.isFinite(candidatePolarizationSign)) {
            normalizedValue = rawValue * candidatePolarizationSign;
            directionValue = normalizedValue;
            directionResolvedBy = 'terminal-exit-model';
            orientationMatch = normalizedValue >= 0 ? 'forward' : 'reverse';
            orientationRule = 'terminal-exit-model';
            resolvedTerminalMismatch = polarizationConsistent === false;
          } else {
            unresolvedReason = 'source-side-unknown';
          }
        }
      }

      if (Number.isFinite(rawValue) && !Number.isFinite(normalizedValue) && !hasTerminalMetadata) {
        const candidateSideOrientation = resolveOrientationByCandidateSides(candidate);
        const formulaOrientation = (formula?.stationCode || formula?.targetCode)
          ? resolveOrientationByAlias(
            formula?.stationCode || '',
            formula?.targetCode || '',
            startAliases,
            endAliases,
            'formula-alias'
          )
          : null;
        const rowOrientation = resolveOrientationByAlias(
          row.tmName || '',
          row.remoteName || '',
          startAliases,
          endAliases,
          'row-alias'
        );
        const chosenOrientation = formulaOrientation?.orientation
          ? formulaOrientation
          : candidateSideOrientation?.orientation
            ? candidateSideOrientation
            : rowOrientation?.orientation
              ? rowOrientation
              : formulaOrientation || candidateSideOrientation || rowOrientation || {
                orientation: null,
                orientationMatch: 'unknown',
                directionResolvedBy: '',
                aliasMatchBasis: '',
                orientationRule: ''
              };
        const orientationSign = chosenOrientation.orientation === -1 || chosenOrientation.orientation === 1
          ? chosenOrientation.orientation
          : null;
        if (orientationSign != null) {
          normalizedValue = rawValue * (Number.isFinite(sign) ? sign : 1) * orientationSign;
          directionValue = normalizedValue;
          directionResolvedBy = chosenOrientation.directionResolvedBy || '';
          orientationMatch = chosenOrientation.orientationMatch || 'unknown';
          aliasMatchBasis = chosenOrientation.aliasMatchBasis || '';
          orientationRule = chosenOrientation.orientationRule || chosenOrientation.directionResolvedBy || '';
        } else if (!unresolvedReason) {
          unresolvedReason = 'orientation-unknown';
        }
      } else if (!Number.isFinite(rawValue) && !unresolvedReason) {
        unresolvedReason = 'missing-source-row';
      }

      const loadingHintValue = Number.isFinite(rawValue)
        ? Math.abs(rawValue * (Number.isFinite(sign) ? sign : 1))
        : null;
      const capacityLimit = getCapacityLimit('hat', entity);
      const valueInvalid = isHatMetricValueInvalid(entity, metricType, normalizedValue);
      return {
        candidate,
        row,
        metricType,
        timestamp: row.timestamp,
        rawValue,
        normalizedValue,
        loadingHintValue,
        directionValue,
        formulaSign: Number.isFinite(sign) ? sign : null,
        candidateSlot: candidate?.candidateSlot || '',
        sourceSide: candidate?.sourceSide || '',
        targetSide: candidate?.targetSide || '',
        terminalSide,
        terminalMatchBasis,
        polarizationSign: Number.isFinite(candidatePolarizationSign) ? candidatePolarizationSign : null,
        polarizationConsistent: explicitConsistency,
        selectedCandidate: String(candidate?.measurementId || ''),
        formulaSignApplied: Number.isFinite(sign) ? sign : null,
        directionResolvedBy,
        orientationMatch,
        aliasMatchBasis,
        orientationRule,
        unresolvedReason,
        orientationUnknown: !Number.isFinite(normalizedValue),
        resolvedTerminalMismatch,
        valueInvalid,
        capacityLimit,
        capacityFilterPassed: metricType === 'active' ? !valueInvalid : null
      };
    }).sort((left, right) => Number(right.timestamp?.getTime?.() || 0) - Number(left.timestamp?.getTime?.() || 0));

    if (!oriented.length) return null;
    const directionResolved = oriented.filter((entry) => Number.isFinite(entry.normalizedValue));
    if (!directionResolved.length) {
      const unresolved = finalizeResolvedHatEntry({
        ...oriented[0],
        normalizedValue: null,
        directionValue: null,
        loadingHintValue: getMaxLoadingHint(oriented)
      }, {
        entries: oriented,
        sourceAmbiguous: false,
        unresolved: true,
        unresolvedReason: pickHatUnresolvedReason(oriented),
        resolvedFromMultiple: oriented.length > 1,
        resolutionMethod: pickHatUnresolvedReason(oriented),
        selectedCandidateReason: getHatSelectionReason('orientation-unknown')
      });
      unresolved.candidateOutcomes = buildHatCandidateOutcomeList(oriented, unresolved.selectedCandidate);
      return unresolved;
    }

    const capacityFiltered = metricType === 'active'
      ? directionResolved.filter((entry) => entry.capacityFilterPassed !== false)
      : directionResolved.slice();
    const filteredOutByCapacity = metricType === 'active'
      ? directionResolved.filter((entry) => entry.capacityFilterPassed === false)
      : [];
    const selectable = capacityFiltered.length ? capacityFiltered : directionResolved;

    if (metricType === 'active' && !capacityFiltered.length) {
      const newestInvalid = selectable[0];
      const invalidResolved = finalizeResolvedHatEntry(newestInvalid, {
        entries: oriented,
        sourceAmbiguous: false,
        unresolved: false,
        resolvedFromMultiple: oriented.length > 1,
        resolutionMethod: 'invalid-value',
        selectedCandidateReason: getHatSelectionReason('invalid-value'),
        valueInvalid: true,
        capacityLimit: newestInvalid.capacityLimit,
        capacityFilterPassed: false,
        orientationRule: newestInvalid.orientationRule || newestInvalid.directionResolvedBy || '',
        resolvedTerminalMismatch: newestInvalid.resolvedTerminalMismatch
      });
      invalidResolved.candidateOutcomes = buildHatCandidateOutcomeList(oriented, invalidResolved.selectedCandidate);
      return invalidResolved;
    }

    if (selectable.length === 1) {
      const singleResolved = finalizeResolvedHatEntry(selectable[0], {
        entries: oriented,
        sourceAmbiguous: false,
        unresolved: false,
        resolvedFromMultiple: oriented.length > 1,
        resolutionMethod: oriented.length > 1 ? 'latest-terminal' : 'single-candidate',
        selectedCandidateReason: getHatSelectionReason(oriented.length > 1 ? 'latest-terminal' : 'single-candidate', {
          capacityFiltered: filteredOutByCapacity.length > 0
        }),
        resolvedTerminalMismatch: selectable[0].resolvedTerminalMismatch
      });
      singleResolved.candidateOutcomes = buildHatCandidateOutcomeList(oriented, singleResolved.selectedCandidate);
      return singleResolved;
    }

    const newest = selectable.filter((entry) => sameTimestamp(entry, selectable[0]));
    if (newest.length === 1) {
      const latestResolved = finalizeResolvedHatEntry(newest[0], {
        entries: oriented,
        sourceAmbiguous: false,
        unresolved: false,
        resolvedFromMultiple: selectable.length > 1,
        resolutionMethod: selectable.length > 1 ? 'latest-terminal' : 'single-candidate',
        selectedCandidateReason: getHatSelectionReason(selectable.length > 1 ? 'latest-terminal' : 'single-candidate', {
          capacityFiltered: filteredOutByCapacity.length > 0
        }),
        resolvedTerminalMismatch: newest[0].resolvedTerminalMismatch
      });
      latestResolved.candidateOutcomes = buildHatCandidateOutcomeList(oriented, latestResolved.selectedCandidate);
      return latestResolved;
    }

    const distinctValues = new Set(newest.map((entry) => String(roundMetricValue(entry.normalizedValue))));
    if (distinctValues.size === 1) {
      const sameValueResolved = finalizeResolvedHatEntry(newest[0], {
        entries: newest,
        sourceAmbiguous: false,
        unresolved: false,
        resolvedFromMultiple: newest.length > 1,
        resolutionMethod: 'same-value',
        selectedCandidateReason: getHatSelectionReason('same-value'),
        resolvedTerminalMismatch: newest[0].resolvedTerminalMismatch
      });
      sameValueResolved.candidateOutcomes = buildHatCandidateOutcomeList(oriented, sameValueResolved.selectedCandidate);
      return sameValueResolved;
    }
    const toleranceResolved = resolveHatMetricByTolerance(entity, newest);
    if (toleranceResolved) {
      toleranceResolved.candidateOutcomes = buildHatCandidateOutcomeList(oriented, toleranceResolved.selectedCandidate);
      return toleranceResolved;
    }
    if (newest.some((entry) => candidateSlotRank(entry) < 3)) {
      const selected = newest.slice().sort((left, right) => {
        const slotDiff = candidateSlotRank(left) - candidateSlotRank(right);
        if (slotDiff !== 0) return slotDiff;
        return Number(right.timestamp?.getTime?.() || 0) - Number(left.timestamp?.getTime?.() || 0);
      })[0];
      const conflictResolved = finalizeResolvedHatEntry(selected, {
        entries: newest,
        sourceAmbiguous: false,
        unresolved: false,
        resolvedFromMultiple: newest.length > 1,
        resolutionMethod: 'primary-conflict',
        candidateConflict: true,
        backupUsed: candidateSlotRank(selected) > 0 && newest.some((entry) => candidateSlotRank(entry) === 0),
        orientationRule: selected.orientationRule || selected.directionResolvedBy || '',
        selectedCandidateReason: getHatSelectionReason('primary-conflict'),
        resolvedTerminalMismatch: selected.resolvedTerminalMismatch
      });
      conflictResolved.candidateOutcomes = buildHatCandidateOutcomeList(oriented, conflictResolved.selectedCandidate);
      return conflictResolved;
    }
    const ambiguousResolved = finalizeResolvedHatEntry({
      ...newest[0],
      normalizedValue: null,
      directionValue: null,
      loadingHintValue: getMaxLoadingHint(newest)
    }, {
      entries: newest,
      sourceAmbiguous: true,
      unresolved: true,
      unresolvedReason: 'ambiguous-live',
      resolvedFromMultiple: newest.length > 1,
      resolutionMethod: 'ambiguous-live',
      selectedCandidateReason: 'Adaylar birbiriyle celistigi icin guvenilir secim yapilamadi.'
    });
    ambiguousResolved.candidateOutcomes = buildHatCandidateOutcomeList(oriented, ambiguousResolved.selectedCandidate);
    return ambiguousResolved;
  }

  function resolveNodeMetric(candidates) {
    const sorted = candidates.map(({ candidate, row }) => ({
      candidate,
      row,
      timestamp: row.timestamp,
      normalizedValue: Number(row.value),
      value: Number(row.value),
      rawValue: Number(row.value),
      sourceValue: Number(row.value),
      flowValue: Number(row.value),
      measurementId: String(candidate?.measurementId || '')
    })).sort((left, right) => {
      const tsDiff = Number(right.timestamp?.getTime?.() || 0) - Number(left.timestamp?.getTime?.() || 0);
      if (tsDiff !== 0) return tsDiff;
      return Math.abs(right.normalizedValue) - Math.abs(left.normalizedValue);
    });
    if (!sorted.length) return null;
    return { ...sorted[0], sourceAmbiguous: sorted.length > 1 };
  }

  function resolveMetricCandidate(entityType, entity, metricType, measurementRowsById) {
    const rows = Array.isArray(entity?.scada?.[metricType]?.rows) ? entity.scada[metricType].rows : [];
    const elementName = metricType === 'active' ? 'P' : (metricType === 'reactive' ? 'Q' : 'U');
    const present = rows.map((candidate) => {
      const id = String(candidate.measurementId || '');
      return {
        candidate,
        row: measurementRowsById.get(`${id}|${elementName}`) || measurementRowsById.get(id)
      };
    }).filter((entry) => entry.row);
    if (!present.length) return null;
    return entityType === 'hat'
      ? resolveHatMetric(entity, metricType, present)
      : resolveNodeMetric(present);
  }

  function getResolvedMeasurementId(resolved) {
    if (!resolved) return '';
    const explicitId = String(resolved.measurementId || '').trim();
    if (explicitId) return explicitId;
    return String(resolved?.candidate?.measurementId || '').trim();
  }

  function getMetricDebugFields(resolved) {
    if (!resolved) return {};
    return {
      candidateSlot: resolved.candidateSlot || resolved?.candidate?.candidateSlot || '',
      sourceSide: resolved.sourceSide || resolved?.candidate?.sourceSide || '',
      targetSide: resolved.targetSide || resolved?.candidate?.targetSide || '',
      terminalSide: resolved.terminalSide || resolved?.candidate?.terminalSide || resolved.sourceSide || resolved?.candidate?.sourceSide || '',
      terminalMatchBasis: resolved.terminalMatchBasis || resolved?.candidate?.terminalMatchBasis || '',
      polarizationSign: Number.isFinite(Number(resolved.polarizationSign ?? resolved?.candidate?.polarizationSign))
        ? Number(resolved.polarizationSign ?? resolved?.candidate?.polarizationSign)
        : null,
      polarizationConsistent: typeof (resolved.polarizationConsistent ?? resolved?.candidate?.polarizationConsistent) === 'boolean'
        ? Boolean(resolved.polarizationConsistent ?? resolved?.candidate?.polarizationConsistent)
        : null,
      selectedCandidate: resolved.selectedCandidate || String(resolved?.candidate?.measurementId || ''),
      selectedCandidateReason: resolved.selectedCandidateReason || '',
      backupUsed: Boolean(resolved.backupUsed),
      formulaSignApplied: Number.isFinite(Number(resolved.formulaSignApplied))
        ? Number(resolved.formulaSignApplied)
        : Number.isFinite(Number(resolved.formulaSign))
          ? Number(resolved.formulaSign)
          : null,
      orientationRule: resolved.orientationRule || resolved.directionResolvedBy || '',
      candidateConflict: Boolean(resolved.candidateConflict),
      resolvedTerminalMismatch: Boolean(resolved.resolvedTerminalMismatch),
      valueInvalid: Boolean(resolved.valueInvalid),
      capacityLimit: Number.isFinite(Number(resolved.capacityLimit)) ? Number(resolved.capacityLimit) : null,
      capacityFilterPassed: typeof resolved.capacityFilterPassed === 'boolean' ? Boolean(resolved.capacityFilterPassed) : null,
      candidateOutcomes: Array.isArray(resolved.candidateOutcomes) ? resolved.candidateOutcomes : []
    };
  }

  function buildMetricCandidateDetails(entity, metricType, measurementRowsById, resolvedMetric) {
    const rows = Array.isArray(entity?.scada?.[metricType]?.rows) ? entity.scada[metricType].rows : [];
    const selectedIds = new Set(String(resolvedMetric?.selectedCandidate || '').split(',').map((id) => id.trim()).filter(Boolean));
    const seenKeys = new Set();
    return rows.reduce((list, candidate) => {
      const measurementId = String(candidate?.measurementId || '').trim();
      const key = `${measurementId}|${metricType}`;
      if (!measurementId || seenKeys.has(key)) return list;
      seenKeys.add(key);
      const sourceRow = measurementRowsById.get(measurementId);
      const outcome = Array.isArray(resolvedMetric?.candidateOutcomes)
        ? resolvedMetric.candidateOutcomes.find((entry) => String(entry.measurementId || '').trim() === measurementId)
        : null;
      list.push({
        metricType,
        measurementId,
        formulaRaw: candidate?.formulaRaw || '',
        rawValue: Number.isFinite(Number(sourceRow?.value)) ? Number(sourceRow.value) : null,
        normalizedValue: Number.isFinite(Number(outcome?.normalizedValue)) ? Number(outcome.normalizedValue) : null,
        timestamp: sourceRow?.timestamp || null,
        terminalSide: outcome?.terminalSide || candidate?.terminalSide || candidate?.sourceSide || '',
        selected: selectedIds.has(measurementId),
        capacityLimit: Number.isFinite(Number(outcome?.capacityLimit)) ? Number(outcome.capacityLimit) : null,
        capacityFilterPassed: typeof outcome?.capacityFilterPassed === 'boolean' ? Boolean(outcome.capacityFilterPassed) : null,
        valueInvalid: Boolean(outcome?.valueInvalid)
      });
      return list;
    }, []);
  }

  function buildEntityMetricRecord(entityType, entity, modeConfig, measurementRowsById) {
    const resolved = {
      active: entityType !== 'bara' ? resolveMetricCandidate(entityType, entity, 'active', measurementRowsById) : null,
      reactive: entityType !== 'bara' ? resolveMetricCandidate(entityType, entity, 'reactive', measurementRowsById) : null,
      voltage: entityType === 'bara' ? resolveMetricCandidate(entityType, entity, 'voltage', measurementRowsById) : null
    };
    const primaryMetric = resolved[modeConfig.primaryMetric];
    const primaryTimestamp = primaryMetric?.timestamp || resolved.active?.timestamp || resolved.reactive?.timestamp || resolved.voltage?.timestamp || null;
    const primaryStaleState = getStaleState(primaryTimestamp);
    const capacityMva = getCapacityMva(entityType, entity);
    const primaryValue = primaryMetric?.normalizedValue;
    const loadingMagnitude = capacityMva
      ? computeLoadingMagnitude(entityType, resolved)
      : null;
    const loadingPct = capacityMva && Number.isFinite(loadingMagnitude)
      ? (loadingMagnitude / capacityMva) * 100
      : null;
    const displayMetrics = entityType === 'hat'
      ? computeHatDisplayMetrics(modeConfig, resolved, loadingPct)
      : {
        displayPct: Number.isFinite(loadingPct) ? loadingPct : null,
        displayPctRaw: Number.isFinite(loadingPct) ? loadingPct : null,
        displayPctMode: 'loading',
        invalidPct: Number.isFinite(loadingPct) && loadingPct > INVALID_DISPLAY_THRESHOLD
      };
    const statusKey = primaryMetric?.sourceAmbiguous
      ? 'ambiguous'
      : primaryStaleState;
    const historicalStatusText = state.scada.timeMode === 'historical'
      ? (primaryStaleState === 'dead' ? 'Eski' : primaryStaleState === 'warn' ? 'Gecikmeli' : 'Gecerli')
      : null;
    const primaryStatusText = statusKey === 'ambiguous'
      ? (STATUS_TEXT.ambiguous || 'Belirsiz')
      : (historicalStatusText || STATUS_TEXT[statusKey] || STATUS_TEXT.live);
    const record = {
      entityType,
      entityId: entity.id,
      entityKey: `${entityType}:${entity.id}`,
      entity,
      active: resolved.active ? {
        value: resolved.active.normalizedValue,
        rawValue: Number.isFinite(Number(resolved.active.rawValue)) ? Number(resolved.active.rawValue) : null,
        measurementId: getResolvedMeasurementId(resolved.active),
        timestamp: resolved.active.timestamp,
        sourceTm: resolved.active.row.tmName,
        sourceRemote: resolved.active.row.remoteName,
        sourceAmbiguous: Boolean(resolved.active.sourceAmbiguous),
        resolvedFromMultiple: Boolean(resolved.active.resolvedFromMultiple),
        resolutionMethod: resolved.active.resolutionMethod || '',
        unresolvedReason: resolved.active.unresolvedReason || '',
        directionResolvedBy: resolved.active.directionResolvedBy || '',
        orientationMatch: resolved.active.orientationMatch || 'unknown',
        aliasMatchBasis: resolved.active.aliasMatchBasis || '',
        formulaSign: Number.isFinite(Number(resolved.active.formulaSign)) ? Number(resolved.active.formulaSign) : null,
        loadingHintValue: getLoadingHintValue(resolved.active),
        valueInvalid: Boolean(resolved.active.valueInvalid),
        ...getMetricDebugFields(resolved.active)
      } : null,
      reactive: resolved.reactive ? {
        value: resolved.reactive.normalizedValue,
        rawValue: Number.isFinite(Number(resolved.reactive.rawValue)) ? Number(resolved.reactive.rawValue) : null,
        measurementId: getResolvedMeasurementId(resolved.reactive),
        timestamp: resolved.reactive.timestamp,
        sourceTm: resolved.reactive.row.tmName,
        sourceRemote: resolved.reactive.row.remoteName,
        sourceAmbiguous: Boolean(resolved.reactive.sourceAmbiguous),
        resolvedFromMultiple: Boolean(resolved.reactive.resolvedFromMultiple),
        resolutionMethod: resolved.reactive.resolutionMethod || '',
        unresolvedReason: resolved.reactive.unresolvedReason || '',
        directionResolvedBy: resolved.reactive.directionResolvedBy || '',
        orientationMatch: resolved.reactive.orientationMatch || 'unknown',
        aliasMatchBasis: resolved.reactive.aliasMatchBasis || '',
        formulaSign: Number.isFinite(Number(resolved.reactive.formulaSign)) ? Number(resolved.reactive.formulaSign) : null,
        loadingHintValue: getLoadingHintValue(resolved.reactive),
        valueInvalid: Boolean(resolved.reactive.valueInvalid),
        ...getMetricDebugFields(resolved.reactive)
      } : null,
      voltage: resolved.voltage ? {
        value: resolved.voltage.normalizedValue,
        measurementId: getResolvedMeasurementId(resolved.voltage),
        timestamp: resolved.voltage.timestamp,
        sourceTm: resolved.voltage.row.tmName,
        sourceRemote: resolved.voltage.row.remoteName,
        sourceAmbiguous: Boolean(resolved.voltage.sourceAmbiguous),
        resolutionMethod: resolved.voltage.resolutionMethod || '',
        unresolvedReason: resolved.voltage.unresolvedReason || '',
        directionResolvedBy: resolved.voltage.directionResolvedBy || '',
        orientationMatch: resolved.voltage.orientationMatch || 'unknown',
        aliasMatchBasis: resolved.voltage.aliasMatchBasis || '',
        formulaSign: Number.isFinite(Number(resolved.voltage.formulaSign)) ? Number(resolved.voltage.formulaSign) : null,
        loadingHintValue: getLoadingHintValue(resolved.voltage),
        ...getMetricDebugFields(resolved.voltage)
      } : null,
      primaryMetric: modeConfig.primaryMetric,
      primaryValue,
      primaryMeasurementId: getResolvedMeasurementId(primaryMetric),
      primaryTimestamp,
      primaryStaleState,
      primaryStatusText,
      sourceAmbiguous: Boolean(primaryMetric?.sourceAmbiguous),
      unresolved: Boolean(primaryMetric?.unresolved),
      unresolvedReason: primaryMetric?.unresolvedReason || '',
      resolvedFromMultiple: Boolean(primaryMetric?.resolvedFromMultiple),
      resolutionMethod: primaryMetric?.resolutionMethod || '',
      directionMetric: modeConfig.primaryMetric,
      directionModel: entityType === 'hat' ? (primaryMetric?.directionResolvedBy === 'terminal-exit-model' ? 'terminal-exit-model' : primaryMetric?.directionResolvedBy === 'terminal-polarity' ? 'terminal-polarity' : 'legacy-alias') : '',
      directionValue: Number.isFinite(primaryMetric?.directionValue) ? primaryMetric.directionValue : primaryValue,
      directionResolvedBy: primaryMetric?.directionResolvedBy || '',
      orientationMatch: primaryMetric?.orientationMatch || 'unknown',
      aliasMatchBasis: primaryMetric?.aliasMatchBasis || '',
      formulaSign: Number.isFinite(Number(primaryMetric?.formulaSign)) ? Number(primaryMetric.formulaSign) : null,
      ...getMetricDebugFields(primaryMetric),
      capacityMva,
      loadingMagnitude,
      loadingPct,
      displayPct: displayMetrics.displayPct,
      displayPctRaw: displayMetrics.displayPctRaw,
      displayPctMode: displayMetrics.displayPctMode,
      invalidPct: Boolean(displayMetrics.invalidPct),
      displayPctReason: displayMetrics.displayPctReason || '',
      timeState: primaryStaleState,
      timeStateLabel: primaryStatusText,
      ageLabel: getAgeLabel(primaryTimestamp)
    };
    const uncertaintyMeta = entityType === 'hat' ? buildHatUncertaintyMeta(record) : { label: '', shortTooltip: '', detailLines: [], reasons: [] };
    record.uncertaintyReason = uncertaintyMeta.reasons[0] || '';
    record.uncertaintyLabel = uncertaintyMeta.label;
    record.uncertaintyTooltip = uncertaintyMeta.shortTooltip;
    record.uncertaintyDetails = uncertaintyMeta.detailLines;
    record.resolutionClass = entityType === 'hat' ? getHatResolutionClass(record) : '';
    record.displayColor = getDisplayColor(record);
    record.valueInvalid = Boolean(primaryMetric?.valueInvalid);
    record.capacityLimit = Number.isFinite(Number(primaryMetric?.capacityLimit)) ? Number(primaryMetric.capacityLimit) : getCapacityLimit(entityType, entity);
    record.capacityFilterPassed = typeof primaryMetric?.capacityFilterPassed === 'boolean' ? Boolean(primaryMetric.capacityFilterPassed) : null;
    if (record.active) record.active.candidateDetails = buildMetricCandidateDetails(entity, 'active', measurementRowsById, resolved.active);
    if (record.reactive) record.reactive.candidateDetails = buildMetricCandidateDetails(entity, 'reactive', measurementRowsById, resolved.reactive);
    return record;
  }

  function pushMetricHistory(entityKey, record) {
    if (!record.primaryTimestamp) return;
    const history = state.scada.history.get(entityKey) || [];
    history.push({
      ts: record.primaryTimestamp,
      active: record.active?.value ?? null,
      reactive: record.reactive?.value ?? null,
      voltage: record.voltage?.value ?? null,
      pct: Number.isFinite(record.loadingPct) ? record.loadingPct : null
    });
    while (history.length > SCADA_CONFIG.HISTORY_MAX) history.shift();
    state.scada.history.set(entityKey, history);
  }

  function rebuildLineFlowMap(modeConfig, metricMap) {
    const next = new Map();
    if (modeConfig.domain !== 'hat') {
      state.scada.lineFlowByLineId = next;
      return next;
    }
    metricMap.forEach((record) => {
      if (record.entityType !== 'hat') return;
      if (!Number.isFinite(record.primaryValue)) return;
      // Live dead records are dropped; historical snapshots keep the flow with
      // a historical-stale flag so the arrow stays visible with a warning.
      if (record.primaryStaleState === 'dead' && state.scada.timeMode !== 'historical') return;
      const direction = getHatFlowDirection(record);
      if (!Number.isFinite(record.displayPct) || record.invalidPct || record.valueInvalid) return;
      const value = record.primaryValue;
      const staleState = record.primaryStaleState;
      const historicalStale = state.scada.timeMode === 'historical' && staleState === 'dead';
      const displayPct = Number.isFinite(record.displayPct) ? record.displayPct : null;
      const loadingPct = Number.isFinite(record.loadingPct) ? record.loadingPct : null;
      next.set(record.entityId, {
        mw: Number.isFinite(record.active?.value) ? record.active.value : 0,
        mvar: Number.isFinite(record.reactive?.value) ? record.reactive.value : 0,
        primaryValue: value,
        primaryUnit: getMetricUnit(modeConfig.primaryMetric),
        loadingPct,
        displayPct,
        displayPctMode: record.displayPctMode || 'loading',
        invalidPct: Boolean(record.invalidPct),
        displayPctReason: record.displayPctReason || '',
        capacityMva: Number.isFinite(record.capacityMva) ? record.capacityMva : null,
        direction,
        directionMetric: record.directionMetric || modeConfig.primaryMetric,
        directionValue: Number.isFinite(record.directionValue) ? record.directionValue : value,
        directionResolvedBy: record.directionResolvedBy || '',
        orientationMatch: record.orientationMatch || 'unknown',
        aliasMatchBasis: record.aliasMatchBasis || '',
        terminalSide: record.terminalSide || '',
        terminalMatchBasis: record.terminalMatchBasis || '',
        polarizationSign: Number.isFinite(Number(record.polarizationSign)) ? Number(record.polarizationSign) : null,
        resolvedTerminalMismatch: Boolean(record.resolvedTerminalMismatch),
        resolutionClass: record.resolutionClass || getHatResolutionClass(record),
        candidateConflict: Boolean(record.candidateConflict),
        backupUsed: Boolean(record.backupUsed),
        orientationRule: record.orientationRule || '',
        staleState,
        historicalStale,
        color: getDisplayColor(record),
        width: getFlowWidth(Number.isFinite(displayPct) ? displayPct : 0),
        timestamp: record.primaryTimestamp,
        hatName: record.entity.name || '',
        hatKv: record.entity.kvBucket || record.entity.kv || '',
        hatLengthKm: record.entity.lengthKm || 0,
        hatId: record.entity.id,
        sinsid: record.primaryMeasurementId,
        isMock: SCADA_CONFIG.MOCK_ENABLED,
        unavailable: false
      });
    });
    state.scada.lineFlowByLineId = next;
    return next;
  }

  function buildVisibleSummary(scope, metricMap) {
    const presentationEntries = scope.domain === 'bara'
      ? getVoltagePanelRepresentatives(metricMap)
      : scope.entities.map((entity) => ({
        entity,
        record: metricMap.get(`${scope.domain}:${entity.id}`) || null
      }));
    const summary = {
      total: presentationEntries.length,
      matched: 0,
      stale: 0,
      delayed: 0,
      dead: 0,
      unmatched: 0,
      ambiguousLive: 0,
      orientationUnknown: 0,
      resolvedWithWarning: 0,
      available: 0,
      missing: 0,
      updatedAt: state.scada.lastDataTimestamp,
      filterKey: scope.filterKey,
      metricMode: scope.mode
    };
    presentationEntries.forEach(({ entity, record }) => {
      if (!record) {
        summary.unmatched += 1;
        summary.missing += 1;
        return;
      }
      // available = entity with a real value valid at the reference moment
      // (selected instant for historical views, now for live). This is the
      // semantic the summary/badge/ranking share; freshness does not erase it.
      const hasValue = Number.isFinite(record.primaryValue) && record.primaryTimestamp instanceof Date;
      if (hasValue && getScadaReferenceTimeMs() - record.primaryTimestamp.getTime() >= 0) {
        summary.available += 1;
      } else {
        summary.missing += 1;
      }
      if (hasHatUncertainty(record, { assumeHat: scope.domain === 'hat' }) || record.invalidPct) {
        summary.ambiguousLive += 1;
        if (record.unresolvedReason === 'orientation-unknown'
          || record.unresolvedReason === 'source-side-unknown'
          || record.unresolvedReason === 'polarization-mismatch') {
          summary.orientationUnknown += 1;
        }
        return;
      }
      if (record.resolvedTerminalMismatch) {
        summary.resolvedWithWarning += 1;
      }
      if (!Number.isFinite(record.primaryValue)) {
        summary.unmatched += 1;
        return;
      }
      if (record.primaryStaleState === 'dead') {
        summary.stale += 1;
        summary.dead += 1;
        return;
      }
      if (record.primaryStaleState === 'warn') {
        summary.stale += 1;
        summary.delayed += 1;
        return;
      }
      summary.matched += 1;
    });
    state.scada.visibleSummary = summary;
    return summary;
  }

  function hasTransferBaraToken(value) {
    return /(^|[^a-z0-9])(bt|transfer)(?=$|[^a-z0-9])/i.test(String(value || ''));
  }

  function isTransferBaraForVoltagePanel(bara) {
    if (hasTransferBaraToken(bara?.kullanim) || hasTransferBaraToken(bara?.turu)) return true;
    return hasTransferBaraToken(bara?.name);
  }

  function getVoltagePanelTimestamp(record) {
    const timestamp = record?.primaryTimestamp;
    if (typeof timestamp?.getTime === 'function') return Number(timestamp.getTime()) || 0;
    const parsed = Date.parse(timestamp || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getVoltagePanelStalePriority(record) {
    if (record?.primaryStaleState === 'live') return 3;
    if (record?.primaryStaleState === 'warn') return 2;
    if (record?.primaryStaleState === 'dead') return 1;
    return 0;
  }

  function getVoltagePanelTmKey(bara) {
    return String(bara?.tmId || bara?.tm?.id || bara?.tmName || bara?.tm?.name || bara?.id || '');
  }

  function isBetterVoltagePanelRepresentative(candidate, current) {
    if (!current) return true;
    const candidateStalePriority = getVoltagePanelStalePriority(candidate.record);
    const currentStalePriority = getVoltagePanelStalePriority(current.record);
    if (candidateStalePriority !== currentStalePriority) return candidateStalePriority > currentStalePriority;

    const candidateTimestamp = getVoltagePanelTimestamp(candidate.record);
    const currentTimestamp = getVoltagePanelTimestamp(current.record);
    if (candidateTimestamp !== currentTimestamp) return candidateTimestamp > currentTimestamp;

    const candidateKv = Number(candidate.entity?.gerilimKv || candidate.entity?.kvBucket || 0);
    const currentKv = Number(current.entity?.gerilimKv || current.entity?.kvBucket || 0);
    if (candidateKv !== currentKv) return candidateKv > currentKv;

    const candidateKey = `${normalizeText(candidate.entity?.name)}\u0000${String(candidate.entity?.id || '')}`;
    const currentKey = `${normalizeText(current.entity?.name)}\u0000${String(current.entity?.id || '')}`;
    return candidateKey.localeCompare(currentKey, 'tr') < 0;
  }

  function getVoltagePanelRepresentatives(metricMap = state.scada.entityMetricsByKey) {
    const candidatesByTm = new Map();
    const visibleBaras = typeof getVisibleBaras === 'function' ? getVisibleBaras() : [];
    visibleBaras.forEach((bara) => {
      if (!['154', '400'].includes(String(bara.kvBucket || bara.gerilimKv || ''))) return;
      if (isTransferBaraForVoltagePanel(bara)) return;
      const record = metricMap?.get(`bara:${bara.id}`);
      if (!record || !Number.isFinite(record.primaryValue)) return;
      const tmKey = getVoltagePanelTmKey(bara);
      const candidate = { entity: bara, record };
      if (isBetterVoltagePanelRepresentative(candidate, candidatesByTm.get(tmKey))) {
        candidatesByTm.set(tmKey, candidate);
      }
    });
    return [...candidatesByTm.values()];
  }

  function applyGenericScadaSnapshot(measurementRowsById, scope) {
    const modeConfig = getModeConfig(scope.mode);
    const metricMap = new Map();
    let newestTimestamp = null;
    scope.entities.forEach((entity) => {
      const entityType = modeConfig.domain === 'bara' ? 'bara' : modeConfig.domain;
      const record = buildEntityMetricRecord(entityType, entity, modeConfig, measurementRowsById);
      metricMap.set(record.entityKey, record);
      if (state.scada.timeMode !== 'historical') pushMetricHistory(record.entityKey, record);
      if (record.primaryTimestamp && (!newestTimestamp || record.primaryTimestamp > newestTimestamp)) {
        newestTimestamp = record.primaryTimestamp;
      }
    });

    state.scada.entityMetricsByKey = metricMap;
    state.scada.measurementRowsById = measurementRowsById;
    state.scada.rowsBySinsid = measurementRowsById;
    state.scada.totalRows = measurementRowsById.size;
    state.scada.lastDataTimestamp = newestTimestamp;
    state.scada.currentScope = scope;
    rebuildLineFlowMap(modeConfig, metricMap);
    const visibleSummary = buildVisibleSummary(scope, metricMap);
    state.scada.matchedLines = visibleSummary.matched;
    state.scada.unmatchedRows = visibleSummary.unmatched;
    state.scada.staleCount = visibleSummary.stale;
    state.scada.ambiguousRows = [...metricMap.values()].filter((record) => hasHatUncertainty(record) || record.invalidPct).map((record) => ({
      type: record.valueInvalid ? 'invalid-value' : (record.candidateConflict || record.backupUsed ? 'ambiguous-warning' : (record.unresolvedReason || record.uncertaintyReason || 'ambiguous-live')),
      entityKey: record.entityKey,
      entityName: record.entity?.name || record.entityId
    }));
    state.scada.dataQualitySummary = {
      total: visibleSummary.total,
      matched: visibleSummary.matched,
      unmatched: visibleSummary.unmatched,
      stale: visibleSummary.stale,
      duplicates: visibleSummary.ambiguousLive
    };
    return visibleSummary;
  }

  refreshScadaVisibleSummary = function () {
    const scope = state.scada.currentScope || getCurrentScadaScope();
    return buildVisibleSummary(scope, state.scada.entityMetricsByKey || new Map());
  };

  buildChartPayload = function () {
    const scope = getCurrentScadaScope();
    return SCADA_COMMON.buildChartPayload({
      chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
      datasourceId: SCADA_CONFIG.DATASOURCE_ID,
      timeRange: SCADA_CONFIG.QUERY_TIME_RANGE,
      kvFilters: [],
      tearFilters: [],
      elementNames: scope.elementNames,
      measurementIds: scope.measurementIds,
      rowLimit: Math.max(SCADA_CONFIG.QUERY_ROW_LIMIT, scope.measurementIds.length * 3 || 5000)
    });
  };

  function serializeDateLike(value) {
    if (value instanceof Date) return value.toISOString();
    if (value == null) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : value;
  }

  function reviveDateLike(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function serializeScadaDashboardSnapshot(options = {}) {
    const rows = state.scada.measurementRowsById instanceof Map
      ? Array.from(state.scada.measurementRowsById.entries()).map(([key, row]) => [
        String(key),
        {
          ...row,
          timestamp: serializeDateLike(row?.timestamp)
        }
      ])
      : [];
    const scope = state.scada.currentScope || getCurrentScadaScope();
    // Exclude heavy entities array (contains geometry like coords) from snapshot
    // Only store minimal scope metadata needed for restore validation
    const scopeForSnapshot = scope ? {
      mode: scope.mode,
      modeLabel: scope.modeLabel,
      domain: scope.domain,
      primaryMetric: scope.primaryMetric,
      metricTypes: scope.metricTypes,
      elementNames: scope.elementNames,
      measurementIds: scope.measurementIds,
      filterKey: scope.filterKey
    } : null;
    return {
      schemaVersion: 1,
      source: options.source || 'map',
      at: Number(options.at || Date.now()),
      scope: scopeForSnapshot,
      fetchMeta: {
        ...(state.scada.fetchMeta || {}),
        startedAt: serializeDateLike(state.scada.fetchMeta?.startedAt),
        finishedAt: serializeDateLike(state.scada.fetchMeta?.finishedAt)
      },
      lastTransport: state.scada.lastTransport || null,
      measurementRows: rows
    };
  }

  function restoreScadaDashboardSnapshot(snapshot, options = {}) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.measurementRows)) {
      return { ok: false, reason: 'invalid-snapshot' };
    }
    
    // Validation uses FRESH scope from getCurrentScadaScope() - NOT state.scada.currentScope
    const liveScope = getCurrentScadaScope();
    const snapshotScope = snapshot.scope || {};
    
    const scopeMatches = snapshotScope.filterKey === liveScope.filterKey &&
                         snapshotScope.mode === liveScope.mode &&
                         snapshotScope.domain === liveScope.domain &&
                         snapshotScope.primaryMetric === liveScope.primaryMetric &&
                         [...(snapshotScope.measurementIds || [])].sort().join(',') === [...(liveScope.measurementIds || [])].sort().join(',');
    
    // If scope doesn't match, don't mutate ANY state - return early
    if (!scopeMatches) {
      return { ok: false, skipped: true, reason: 'scope-mismatch' };
    }
    
    // Scope matches - now apply all state changes atomically using the SAME liveScope
    const rows = new Map(snapshot.measurementRows.map(([key, row]) => [
      String(key),
      {
        ...row,
        timestamp: reviveDateLike(row?.timestamp)
      }
    ]));
    
    state.scada.measurementRowsById = rows;
    state.scada.rowsBySinsid = rows;
    state.scada.totalRows = rows.size;
    state.scada.lastTransport = snapshot.lastTransport || state.scada.lastTransport || null;
    state.scada.fetchMeta = {
      ...(snapshot.fetchMeta || {}),
      startedAt: reviveDateLike(snapshot.fetchMeta?.startedAt),
      finishedAt: reviveDateLike(snapshot.fetchMeta?.finishedAt),
      status: snapshot.fetchMeta?.status || 'success',
      phaseLabel: 'Onbellek',
      phaseMessage: 'SCADA verisi onbellekten yuklendi; canli yenileme deneniyor.'
    };
    // Use the SAME liveScope for currentScope and apply
    state.scada.currentScope = liveScope;
    
    if (options.apply !== false && rows.size && liveScope.entities?.length) {
      applyGenericScadaSnapshot(rows, liveScope);
    }
    requestScadaOverlayRender();
    if (typeof refreshRankingTable === 'function') refreshRankingTable();
    return { ok: true, rows: rows.size };
  }

  let lastSnapshotTime = 0;
  async function persistScadaDashboardSnapshot(options = {}) {
    try {
      const now = Date.now();
      if (!options.force && now - lastSnapshotTime < (globalThis.SCADA_COMMON?.CONFIG?.SNAPSHOT_INTERVAL_MS || 300000)) {
        return { ok: false, skipped: true, reason: 'throttled' };
      }
      lastSnapshotTime = now;
      if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return { ok: false, skipped: true };
      const scope = state.scada.currentScope || getCurrentScadaScope();
      const snapshot = serializeScadaDashboardSnapshot(options);
      await chrome.storage.local.set({ [SCADA_DASHBOARD_SNAPSHOT_KEY]: snapshot });
      // Store only minimal metadata for background refresh - no entities/geometry
      const backgroundRefreshScope = {
        mode: scope.mode,
        filterKey: scope.filterKey,
        domain: scope.domain,
        primaryMetric: scope.primaryMetric,
        measurementIds: scope.measurementIds,
        elementNames: scope.elementNames
      };
      await chrome.storage.local.set({
        [SCADA_BACKGROUND_REFRESH_STATE_KEY]: {
          enabled: true,
          updatedAt: Date.now(),
          scope: backgroundRefreshScope,
          payload: {
            baseUrl: SCADA_CONFIG.SUPERSET_ORIGIN,
            dashboardId: SCADA_CONFIG.DASHBOARD_ID,
            chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
            datasourceId: SCADA_CONFIG.DATASOURCE_ID,
            timeRange: SCADA_CONFIG.LIVE_WINDOW_TIME_RANGE,
            kvFilters: [],
            tearFilters: [],
            elementNames: scope.elementNames,
            measurementIds: scope.measurementIds,
            rowLimit: Math.max(SCADA_CONFIG.QUERY_ROW_LIMIT, scope.measurementIds.length * 3 || 5000)
          }
        }
      });
      return { ok: true, snapshot };
    } catch (error) {
      scadaLog('warn', 'SCADA dashboard snapshot yazilamadi.', error?.message || String(error));
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function restoreScadaDashboardSnapshotFromStorage() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return { ok: false, skipped: true };
      if (state.scada.timeMode === 'historical') {
        return { ok: false, skipped: true, reason: 'historical-mode' };
      }
      const stored = await chrome.storage.local.get(SCADA_DASHBOARD_SNAPSHOT_KEY);
      const snapshot = stored?.[SCADA_DASHBOARD_SNAPSHOT_KEY];
      const restored = restoreScadaDashboardSnapshot(snapshot);
      if (restored.ok) {
        setScadaStatusMessage('SCADA son dashboard snapshot onbellekten yuklendi.', 'warn');
      }
      return restored;
    } catch (error) {
      scadaLog('warn', 'SCADA dashboard snapshot okunamadi.', error?.message || String(error));
      return { ok: false, error: error?.message || String(error) };
    }
  }

  function handleDashboardMapSlotActive(payload = {}) {
    if (!state.scada.enabled || !state.scada.autoRefresh) {
      return { ok: true, skipped: true, reason: 'scada-disabled' };
    }
    if (!state.scada.pollState) state.scada.pollState = {};
    setScadaStatusMessage('Dashboard harita slotu aktif; SCADA yenileme kontrol ediliyor.', 'info');
    if (state.scada.fetchInProgress) {
      state.scada.pollState.pendingAutoRefresh = true;
      return { ok: true, queued: true, at: payload.at || Date.now() };
    }
    const pollState = state.scada.pollState;
    if (!pollState.nextDueAt || pollState.nextDueAt.getTime() > Date.now()) {
      pollState.nextDueAt = new Date(Date.now() - 1);
    }
    resumeScadaAutoSchedulerIfOverdue('dashboard');
    return { ok: true, triggered: true, at: payload.at || Date.now() };
  }

  scadaBuildIndex = function () {
    buildNetworkIndexes();
    state.scada.entityMetricsByKey = new Map();
    state.scada.measurementRowsById = new Map();
    state.scada.lineFlowByLineId = new Map();
    state.scada.currentScope = getCurrentScadaScope();
    state.scada.duplicateMappings = new Map();
    state.scada.duplicateHatIds = new Set();
    state.scada.ambiguousRows = [];
    refreshScadaVisibleSummary();
    restoreScadaDashboardSnapshotFromStorage();
    scadaLog('info', `SCADA V2 modulu hazir. ${state.network.hatLines.length} hat, ${state.network.trafos.length} trafo, ${state.network.baraNodes.length} bara yuklendi.`);
  };

  function clearScadaAutoTimer() {
    const pollState = state.scada.pollState;
    if (!pollState?.timerId) return;
    clearTimeout(pollState.timerId);
    pollState.timerId = null;
  }

  function getDocumentVisibilityState() {
    return typeof document?.visibilityState === 'string' ? document.visibilityState : 'visible';
  }

  function isDocumentHidden() {
    return getDocumentVisibilityState() === 'hidden';
  }

  function scheduleNextScadaAutoTick(delayMs = SCADA_CONFIG.POLL_INTERVAL_MS) {
    const pollState = state.scada.pollState;
    clearScadaAutoTimer();
    if (!state.scada.enabled || !state.scada.autoRefresh) {
      pollState.nextDueAt = null;
      return;
    }
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    pollState.nextDueAt = new Date(Date.now() + safeDelay);
    pollState.timerId = setTimeout(() => {
      pollState.timerId = null;
      if (!state.scada.enabled || !state.scada.autoRefresh) return;
      if (isDocumentHidden()) {
        scadaLog('info', 'SCADA otomatik yenileme sekme arka planda oldugu icin beklemeye alindi.');
        return;
      }
      pollState.lastAutoRunAt = new Date();
      pollState.nextDueAt = null;
      if (state.scada.fetchInProgress) {
        pollState.pendingAutoRefresh = true;
        scadaLog('warn', 'SCADA otomatik yenileme tetigi beklemeye alindi; aktif sorgu tamamlaninca yeniden denenecek.');
        return;
      }
      scadaDoFetch({ trigger: 'auto' });
    }, safeDelay);
  }

  function stopScadaAutoScheduler() {
    const pollState = state.scada.pollState;
    clearScadaAutoTimer();
    pollState.nextDueAt = null;
    pollState.pendingAutoRefresh = false;
    scadaLog('info', 'SCADA otomatik yenileme zamanlayicisi durduruldu.');
  }

  function startScadaAutoScheduler() {
    const pollState = state.scada.pollState;
    clearScadaAutoTimer();
    pollState.pendingAutoRefresh = false;
    if (!state.scada.enabled || !state.scada.autoRefresh) {
      pollState.nextDueAt = null;
      return;
    }
    if (state.scada.timeMode === 'historical') {
      pollState.nextDueAt = null;
      scadaLog('info', 'SCADA otomatik yenileme gecmis modda durduruldu.');
      return;
    }
    scheduleNextScadaAutoTick(SCADA_CONFIG.POLL_INTERVAL_MS);
    scadaLog('info', `SCADA otomatik yenileme zamanlayicisi baslatildi (${SCADA_CONFIG.POLL_INTERVAL_MS / 1000} sn).`);
  }

  function resumeScadaAutoSchedulerIfOverdue(reason = 'resume') {
    const pollState = state.scada.pollState;
    if (!state.scada.enabled || !state.scada.autoRefresh) return;
    if (state.scada.timeMode === 'historical') {
      pollState.nextDueAt = null;
      return;
    }
    if (isDocumentHidden()) return;
    pollState.lastVisibilityResumeAt = new Date();
    if (!pollState.nextDueAt) {
      scheduleNextScadaAutoTick(SCADA_CONFIG.POLL_INTERVAL_MS);
      return;
    }
    const remainingMs = pollState.nextDueAt.getTime() - Date.now();
    if (remainingMs <= 0) {
      scadaLog('info', `SCADA otomatik yenileme ${reason} sonrasi overdue tespit etti; hemen yenileme deneniyor.`);
      if (state.scada.fetchInProgress) {
        pollState.pendingAutoRefresh = true;
        return;
      }
      pollState.lastAutoRunAt = new Date();
      pollState.nextDueAt = null;
      scadaDoFetch({ trigger: 'auto' });
      return;
    }
    scheduleNextScadaAutoTick(remainingMs);
  }

  markScadaFlowsUnavailable = function (reason, errorType) {
    state.scada.error = reason || 'SCADA verisi alinamadi.';
    state.scada.errorType = errorType || SCADA_ERROR.TRANSPORT_ERROR;

    const nextMetrics = new Map();
    state.scada.entityMetricsByKey.forEach((record, key) => {
      nextMetrics.set(key, {
        ...record,
        primaryStaleState: 'dead',
        primaryStatusText: STATUS_TEXT.dead,
        transportUnavailable: true
      });
    });
    state.scada.entityMetricsByKey = nextMetrics;

    const nextFlows = new Map();
    state.scada.lineFlowByLineId.forEach((flow, hatId) => {
      nextFlows.set(hatId, {
        ...flow,
        staleState: 'dead',
        color: SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af',
        unavailable: true
      });
    });
    state.scada.lineFlowByLineId = nextFlows;
    state.scada.staleCount = nextFlows.size;
    refreshScadaVisibleSummary();
    setScadaStatusMessage(state.scada.error, errorType === SCADA_ERROR.AUTH_REQUIRED ? 'warn' : 'error');
  };

  // Live missing-id fallback throttle key: scope + sorted missing-id hash.
  // Different scopes or id sets never share throttle state.
  function buildMissingIdsFallbackKey(scopeKey, missingIds) {
    let hash = 2166136261;
    const text = [...(missingIds || [])].map(String).sort().join('\u0001');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${String(scopeKey || 'default')}|${(hash >>> 0).toString(36)}`;
  }

  // Asynchronous wide-window enrichment for ids missing from the last live
  // 10-minute snapshot. Never blocks the main render; only merges missing ids
  // into the CURRENT live snapshot and never overwrites fresh rows. A network
  // or timeout failure never sets the throttle timestamp. Responses that land
  // after the user switched time mode, scope, or fetch generation are dropped.
  async function enrichMissingScadaIds(options = {}) {
    const missingIds = Array.isArray(options?.measurementIds) ? options.measurementIds : [];
    const elementNames = Array.isArray(options?.elementNames) ? options.elementNames : [];
    const throttleKey = options?.throttleKey || buildMissingIdsFallbackKey('default', missingIds);
    const armedFilterKey = String(options?.filterKey || '');
    const armedMode = String(options?.mode || '');
    const armedFetchSeq = Number(options?.fetchSeq) || 0;
    // Composite keys that really appeared in the main 10-minute response; any
    // recovered row for those keys is skipped, everything else (including an
    // older snapshot row) may be replaced by the wider-window result.
    const freshKeys = options?.freshKeys instanceof Set ? options.freshKeys : null;
    if (!missingIds.length) return;
    state.scada.missingIdFallbackByScope = state.scada.missingIdFallbackByScope || {};
    const nowMs = Date.now();
    const lastFallbackAt = state.scada.missingIdFallbackByScope[throttleKey] || 0;
    if (nowMs - lastFallbackAt < 5 * 60 * 1000) return;
    // Secondary, non-blocking status: the main progress must not flash back to
    // loading because missing ids are being recovered in the background.
    const enrichRequestId = `enr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setScadaOperationMeta({
      requestId: enrichRequestId,
      kind: 'enrichment',
      stage: 'running',
      progressPct: 0,
      message: `Eksik ${missingIds.length} olcum arka planda tamamlaniyor...`,
      totalMeasurements: missingIds.length,
      startedAt: new Date()
    });
    try {
      const fallbackResult = await chrome.runtime.sendMessage({
        type: 'SCADA_FETCH',
        payload: {
          baseUrl: SCADA_CONFIG.SUPERSET_ORIGIN,
          dashboardId: SCADA_CONFIG.DASHBOARD_ID,
          chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
          datasourceId: SCADA_CONFIG.DATASOURCE_ID,
          timeRange: SCADA_CONFIG.QUERY_TIME_RANGE,
          kvFilters: [],
          tearFilters: [],
          elementNames,
          measurementIds: missingIds,
          rowLimit: Math.max(SCADA_CONFIG.QUERY_ROW_LIMIT, missingIds.length * 3 || 5000),
          requestId: enrichRequestId
        }
      });
      if (!fallbackResult?.ok) {
        setScadaOperationMeta({ stage: 'done', message: 'Eksik olcum kurtarmasi tamamlanamadi.' });
        return; // failure never throttles a retry
      }
      if (state.scada.timeMode !== 'live' || state.scada.snapshotAt != null) {
        setScadaOperationMeta({ stage: 'done' });
        return;
      }
      // A stale response from an older fetch generation is never merged.
      if ((state.scada.fetchSeq || 0) !== armedFetchSeq) {
        setScadaOperationMeta({ stage: 'done' });
        return;
      }
      const liveScope = typeof getCurrentScadaScope === 'function' ? getCurrentScadaScope() : null;
      if (liveScope) {
        if (armedFilterKey && String(liveScope.filterKey || '') !== armedFilterKey) {
          setScadaOperationMeta({ stage: 'done' });
          return;
        }
        if (armedMode && String(liveScope.mode || '') !== armedMode) {
          setScadaOperationMeta({ stage: 'done' });
          return;
        }
      }
      const fallbackRows = SCADA_COMMON.normalizeMetricRows(fallbackResult.data, { elementNames });
      const currentRows = state.scada.measurementRowsById instanceof Map
        ? state.scada.measurementRowsById
        : new Map();
      const merged = new Map(currentRows);
      let added = 0;
      fallbackRows.forEach((row, key) => {
        const id = String(row.measurementId || row.sinsid || '').trim();
        if (!id || !missingIds.includes(id)) return;
        if (freshKeys) {
          if (freshKeys.has(key)) return;
        } else if (merged.has(key)) {
          return;
        }
        merged.set(key, row);
        added += 1;
      });
      state.scada.missingIdFallbackByScope[throttleKey] = nowMs;
      if (!added) {
        scadaLog('warn', `SCADA eksik olcum fallback: ${missingIds.length} ID icin genis pencere sorgusu yapildi, kurtarilan satir yok.`);
        setScadaOperationMeta({ stage: 'done', message: 'Eksik olcum kurtarmasi tamamlandi; ek satir yok.' });
        return;
      }
      state.scada.measurementRowsById = merged;
      if (typeof applyGenericScadaSnapshot === 'function') {
        applyGenericScadaSnapshot(merged, state.scada.currentScope || getCurrentScadaScope());
      }
      // The recovered rows fully satisfy the live view again: lift the
      // empty/error state and mark the snapshot as live for the UI.
      state.scada.error = null;
      state.scada.errorType = null;
      state.scada.snapshotAt = null;
      state.scada.sourceKind = 'live';
      state.scada.lastFetchAt = new Date();
      if (state.scada.fetchMeta?.status === 'error' && typeof updateScadaFetchMeta === 'function') {
        updateScadaFetchMeta({
          status: 'success',
          stage: 'done',
          progressPct: 100,
          phaseLabel: 'Tamamlandi',
          phaseMessage: `Eksik olcum verisi genis pencereden kurtarildi: ${added} satir uygulandi.`,
          finishedAt: new Date(),
          durationMs: null,
          rawRows: 0,
          normalizedRows: added,
          error: null
        });
      }
      if (typeof requestScadaOverlayRender === 'function') requestScadaOverlayRender();
      if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
      if (typeof refreshRankingTable === 'function') refreshRankingTable();
      if (typeof persistScadaDashboardSnapshot === 'function') {
        void persistScadaDashboardSnapshot({ source: 'enrich' });
      }
      setScadaStatusMessage(`Eksik olcum kurtarmasi: ${added} satir genis pencereden eklendi.`, 'info');
      setScadaOperationMeta({ stage: 'done', message: `Eksik olcum kurtarmasi tamamlandi: ${added} satir uygulandi.` });
      scadaLog('info', `SCADA eksik olcum fallback: ${missingIds.length} ID icin genis pencere sorgusu yapildi, ${added} satir kurtarildi.`);
    } catch (fallbackError) {
      setScadaOperationMeta({ stage: 'done', message: 'Eksik olcum kurtarmasi tamamlanamadi.' });
      scadaLog('warn', 'SCADA eksik olcum fallback basarisiz.', fallbackError?.message || String(fallbackError));
    }
  }

  scadaDoFetch = async function (options = {}) {
    const triggerType = options?.trigger || 'manual';
    const triggerLabel = getScadaTriggerLabel(triggerType);
    if (state.scada.timeMode === 'historical' && !options.force) {
      scadaLog('info', 'SCADA canli yenileme atlandi; gecmis modunda polling durduruldu.');
      return;
    }
    if (state.scada.fetchInProgress) {
      // Store the latest pending trigger (including filter-change, mode-change, etc.)
      // so it can be executed after the current fetch completes
      state.scada.pollState = state.scada.pollState || {};
      state.scada.pollState.pendingTrigger = { triggerType, options };
      scadaLog('warn', `SCADA ${triggerLabel.toLowerCase()} yenileme istegi bekletiliyor; mevcut sorgu suruyor.`);
      if (triggerType === 'manual') setScadaStatusMessage('SCADA sorgusu zaten suruyor; filtre degisimi bekletildi.', 'warn');
      if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
      return;
    }

    if ((triggerType === 'manual' || triggerType === 'live-return') && isDocumentHidden()) {
      const hiddenMessage = 'SCADA manuel yenileme sekme arka plandayken ertelendi. Sekmeye donup tekrar deneyin.';
      updateScadaFetchMeta({
        status: 'idle',
        stage: 'idle',
        progressPct: 0,
        triggerType,
        triggerLabel,
        phaseLabel: 'Beklemede',
        phaseMessage: hiddenMessage
      });
      setScadaStatusMessage(hiddenMessage, 'warn');
      scadaLog('warn', hiddenMessage);
      if (typeof refreshRankingTable === 'function') refreshRankingTable();
      return;
    }

    const scope = getCurrentScadaScope();
    if (!scope.measurementIds.length) {
      state.scada.entityMetricsByKey = new Map();
      state.scada.measurementRowsById = new Map();
      state.scada.lineFlowByLineId = new Map();
      state.scada.currentScope = scope;
      state.scada.visibleSummary = {
        total: scope.entities.length,
        matched: 0,
        stale: 0,
        unmatched: scope.entities.length,
        ambiguousLive: 0,
        orientationUnknown: 0,
        updatedAt: null,
        filterKey: scope.filterKey,
        metricMode: scope.mode
      };
      updateScadaFetchMeta({
        status: 'idle',
        stage: 'idle',
        progressPct: 0,
        triggerType,
        triggerLabel,
        phaseLabel: 'Hazir',
        phaseMessage: 'Secili filtre ve mod icin olcum ID bulunamadi.',
        rawRows: 0,
        normalizedRows: 0,
        visibleTotal: scope.entities.length,
        visibleMatched: 0,
        visibleDelayed: 0,
        visibleDead: 0,
        visibleStale: 0,
        visibleUnmatched: scope.entities.length
      });
      if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
      if (typeof refreshRankingTable === 'function') refreshRankingTable();
      if (typeof requestRender === 'function') requestRender();
      return;
    }

    const startedAt = new Date();
    state.scada.fetchSeq = (state.scada.fetchSeq || 0) + 1;
    state.scada.fetchInProgress = true;
    state.scada.error = null;
    state.scada.errorType = null;
    const requestId = `${triggerType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Payload and stale-response context share one immutable scope snapshot.
    const scopeForRequest = scope;
    const requestContext = {
      fetchSeq: state.scada.fetchSeq,
      requestId,
      triggerType,
      filterKey: scopeForRequest.filterKey,
      mode: scopeForRequest.mode,
      domain: scopeForRequest.domain,
      primaryMetric: scopeForRequest.primaryMetric,
      timeMode: state.scada.timeMode,
      measurementIdsSignature: scopeForRequest.measurementIds.map(String).sort().join(','),
      entityCount: scopeForRequest.entities.length
    };
    state.scada.currentRequestContext = requestContext;
    
    state.scada.operationMeta = null;
    setScadaOperationMeta({
      requestId,
      kind: triggerType === 'live-return' ? 'live-return' : 'live',
      stage: 'prepare',
      progressPct: 6,
      message: 'Sorgu hazirlaniyor',
      totalMeasurements: scope.measurementIds.length,
      totalEntities: scope.entities.length,
      startedAt
    });

    updateScadaFetchMeta({
      status: 'loading',
      stage: 'queued',
      progressPct: 8,
      triggerType,
      triggerLabel,
      phaseLabel: 'Sorgu',
      phaseMessage: triggerType === 'live-return'
        ? 'Son canli goruntu gosteriliyor; yeni veri kontrol ediliyor...'
        : `${triggerLabel} yenileme ${startedAt.toLocaleTimeString('tr-TR')} icin baslatildi.`,
      startedAt,
      finishedAt: null,
      durationMs: null,
      rawRows: 0,
      normalizedRows: 0,
      visibleTotal: scope.entities.length,
      visibleMatched: 0,
      visibleDelayed: 0,
      visibleDead: 0,
      visibleStale: 0,
      visibleUnmatched: scope.entities.length,
      authMode: state.scada.lastTransport?.authMode || '-',
      usedFallback: false,
      httpStatus: null,
      error: null
    });

    scadaLog('info', `SCADA ${triggerLabel.toLowerCase()} yenileme tetiklendi.`, `${scope.modeLabel} | ${scope.measurementIds.length} olcum ID`);
    setScadaStatusMessage(
      triggerType === 'manual'
        ? 'SCADA sorgusu gonderildi, veri bekleniyor.'
        : `SCADA ${triggerLabel.toLowerCase()} yenileme basladi.`,
      'info'
    );

    // Stale response validation function - checks if request context matches current scope
    function isRequestContextCurrent(requestContext) {
      if (!requestContext) return true; // Allow if no context captured (backward compat)
      const currentScope = getCurrentScadaScope();
      const currentMeasurementIdsSignature = currentScope.measurementIds.map(String).sort().join(',');
      
      // Check if critical scope properties have changed
      if (requestContext.filterKey !== currentScope.filterKey) return false;
      if (requestContext.mode !== currentScope.mode) return false;
      if (requestContext.domain !== currentScope.domain) return false;
      if (requestContext.primaryMetric !== currentScope.primaryMetric) return false;
      if (requestContext.timeMode !== state.scada.timeMode) return false;
      if (requestContext.measurementIdsSignature !== currentScope.measurementIds.map(String).sort().join(',')) return false;
      if (requestContext.fetchSeq !== state.scada.fetchSeq) return false;
      return true;
    }

try {
      const result = SCADA_CONFIG.MOCK_ENABLED
        ? await scadaFetchMock()
        : await chrome.runtime.sendMessage({
            type: 'SCADA_FETCH',
            payload: {
              baseUrl: SCADA_CONFIG.SUPERSET_ORIGIN,
              dashboardId: SCADA_CONFIG.DASHBOARD_ID,
              chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
              datasourceId: SCADA_CONFIG.DATASOURCE_ID,
              timeRange: SCADA_CONFIG.LIVE_WINDOW_TIME_RANGE,
              kvFilters: [],
              tearFilters: [],
              elementNames: scope.elementNames,
              measurementIds: scope.measurementIds,
              requestId
            }
          });

      // Stale response guard: validate request context immediately after response
      // before ANY state mutation. Covers error, empty data, historical mode, exceptions.
      if (!isRequestContextCurrent(state.scada.currentRequestContext)) {
        scadaLog('warn', `SCADA ${triggerLabel.toLowerCase()} response discarded; scope changed during fetch.`, {
          requestFilterKey: state.scada.currentRequestContext?.filterKey,
          currentFilterKey: getCurrentScadaScope().filterKey,
          requestMode: state.scada.currentRequestContext?.mode,
          currentMode: getCurrentScadaScope().mode,
          requestFetchSeq: state.scada.currentRequestContext?.fetchSeq,
          currentFetchSeq: state.scada.fetchSeq
        });
        
        // Execute pending trigger if any (latest scope will be fetched)
        const pollState = state.scada.pollState;
        if (pollState?.pendingTrigger) {
          const pending = pollState.pendingTrigger;
          pollState.pendingTrigger = null;
          scadaLog('info', `Bekleyen ${pending.triggerType} tetigi aktif sorgu sonrasinda calistiriliyor.`);
          setTimeout(() => {
            if (state.scada.enabled && !state.scada.fetchInProgress) {
              scadaDoFetch(pending.options);
            }
          }, 0);
        }
        
        // Discard stale response - do not apply ANY state mutation
        state.scada.currentRequestContext = null;
        state.scada.fetchInProgress = false;
        if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
        if (typeof refreshRankingTable === 'function') refreshRankingTable();
        return;
      }

      updateScadaTransportState(result);
      updateScadaFetchMeta({
        authMode: result?.authMode || 'session',
        usedFallback: Boolean(result?.usedFallback),
        httpStatus: result?.httpStatus ?? null
      });

      if (!result?.ok) {
        const finishedAt = new Date();
        const errorMessage = result?.error || 'SCADA fetch basarisiz.';
        updateScadaFetchMeta({
          status: 'error',
          stage: 'error',
          progressPct: 100,
          phaseLabel: 'Hata',
          phaseMessage: errorMessage,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          error: errorMessage
        });
        if (triggerType === 'live-return') {
          setScadaOperationMeta({ stage: 'error', progressPct: 100, message: errorMessage });
          setScadaStatusMessage(`${errorMessage} Son canli goruntu korundu.`, 'warn');
          scadaLog('warn', 'SCADA canli donus sorgusu basarisiz; son goruntu korundu.');
          return;
        }
        markScadaFlowsUnavailable(errorMessage, result?.errorType || SCADA_ERROR.NETWORK_ERROR);
        scadaLog('error', 'SCADA fetch hatasi', result?.error || result?.errorType || 'bilinmeyen hata');
        return;
      }

      const rawRows = typeof countScadaTransportRows === 'function' ? countScadaTransportRows(result.data) : 0;
      updateScadaFetchMeta({
        stage: 'fetch',
        progressPct: 64,
        phaseLabel: 'Veri',
        phaseMessage: `${rawRows} ham satir alindi, normalizasyon basliyor.`,
        rawRows
      });

      const rowsByMeasurementId = SCADA_COMMON.normalizeMetricRows(result.data, { elementNames: scope.elementNames });

      // A live response that lands after the user switched to historical mode
      // must never overwrite the historical view.
      if (state.scada.timeMode !== 'live') {
        scadaLog('info', 'SCADA canli yaniti zaman modu degistigi icin uygulanmadi.');
        return;
      }

      const requestedIdSet = new Set(scope.measurementIds.map(String));
      const foundIdSet = new Set();
      rowsByMeasurementId.forEach((row, key) => {
        const id = String(row.measurementId || row.sinsid || '').trim();
        if (id) foundIdSet.add(id);
      });
      const missingMeasurementIds = requestedIdSet.size ? [...requestedIdSet].filter((id) => !foundIdSet.has(id)) : [];
      const fallbackScopeKey = String(scope.filterKey || scope.mode || 'default');
      const missingFallbackThrottleKey = buildMissingIdsFallbackKey(fallbackScopeKey, missingMeasurementIds);

      if (!rowsByMeasurementId.size) {
        const finishedAt = new Date();
        const errorMessage = 'Superset yanitinda veri bulunamadi.';
        updateScadaFetchMeta({
          status: 'error',
          stage: 'error',
          progressPct: 100,
          phaseLabel: 'Bos Veri',
          phaseMessage: errorMessage,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          rawRows,
          normalizedRows: 0,
          error: errorMessage
        });
        markScadaFlowsUnavailable(errorMessage, SCADA_ERROR.EMPTY_DATA);
        setScadaOperationMeta({ stage: 'error', progressPct: 100, message: errorMessage });
        scadaLog('warn', 'SCADA verisi bos dondu.');
        // Zero rows in the live 10-minute window means every requested id is
        // missing; recover all of them from the wide window in the background.
        // The UI keeps the empty state until the fallback actually returns data.
        void enrichMissingScadaIds({
          measurementIds: scope.measurementIds,
          elementNames: scope.elementNames,
          throttleKey: missingFallbackThrottleKey,
          filterKey: fallbackScopeKey,
          mode: scope.mode,
          fetchSeq: state.scada.fetchSeq,
          freshKeys: new Set()
        });
        return;
      }

      updateScadaFetchMeta({
        stage: 'process',
        progressPct: 86,
        phaseLabel: 'Esleme',
        phaseMessage: `${rowsByMeasurementId.size} tekil olcum satiri esleniyor.`,
        rawRows,
        normalizedRows: rowsByMeasurementId.size
      });

      const visibleSummary = applyGenericScadaSnapshot(rowsByMeasurementId, scope);
      state.scada.lastFetchAt = new Date();
      state.scada.sourceKind = 'live';
      state.scada.snapshotAt = null;
      // Style-only render: update flow arrows and SCADA card without full geometry rebuild
      if (typeof requestScadaOverlayRender === 'function') requestScadaOverlayRender({ styleOnly: true });
      setScadaOperationMeta({
        stage: 'done',
        progressPct: 100,
        message: 'Tamamlandi'
      });
      const finishedAt = new Date();
      updateScadaFetchMeta({
        status: 'success',
        stage: 'done',
        progressPct: 100,
        phaseLabel: 'Tamamlandi',
        phaseMessage: `${triggerLabel} yenileme tamamlandi. ${rowsByMeasurementId.size} tekil olcum islendi.`,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        rawRows,
        normalizedRows: rowsByMeasurementId.size,
        visibleTotal: visibleSummary.total || 0,
        visibleMatched: visibleSummary.matched || 0,
        visibleDelayed: visibleSummary.delayed || 0,
        visibleDead: visibleSummary.dead || 0,
        visibleStale: visibleSummary.stale || 0,
        visibleUnmatched: (visibleSummary.unmatched || 0) + (visibleSummary.ambiguousLive || 0),
        error: null
      });

      const unresolvedCount = (visibleSummary.ambiguousLive || 0) + (visibleSummary.unmatched || 0) + (visibleSummary.dead || 0);
      const ambiguousText = unresolvedCount > 0
        ? ` Çözümlenemeyen kayıt: ${unresolvedCount} (Aday çakışması: ${visibleSummary.ambiguousLive || 0}, Yön belirsiz: ${visibleSummary.orientationUnknown || 0}, Kaynak eksik: ${visibleSummary.unmatched || 0}, Geçersiz/eski veri: ${visibleSummary.dead || 0})`
        : '';
      setScadaStatusMessage(
        `SCADA verisi guncellendi (${scope.modeLabel}).${ambiguousText}`,
        visibleSummary.ambiguousLive || result.usedFallback ? 'warn' : 'info'
      );
      scadaLog(
        'info',
        `SCADA ${triggerLabel.toLowerCase()} yenileme tamamlandi: ${rawRows} ham, ${rowsByMeasurementId.size} tekil, gorunen ${visibleSummary.matched || 0}/${visibleSummary.total || 0} cozuldu.`,
        `${result.authMode}${result.usedFallback ? ' fallback' : ''}`
      );
      await persistScadaDashboardSnapshot({ source: triggerType === 'background' ? 'background' : 'map' });
      // Missing ids are enriched from the wide window in the background so the
      // main 10-minute render is never blocked by the fallback request.
      if (missingMeasurementIds.length) {
        void enrichMissingScadaIds({
          measurementIds: missingMeasurementIds,
          elementNames: scope.elementNames,
          throttleKey: missingFallbackThrottleKey,
          filterKey: fallbackScopeKey,
          mode: scope.mode,
          fetchSeq: state.scada.fetchSeq,
          freshKeys: new Set(rowsByMeasurementId.keys())
        });
      }
    } catch (error) {
      // Stale exception guard: check if request context is still current before ANY state mutation
      if (!isRequestContextCurrent(requestContext)) {
        scadaLog('warn', 'Stale SCADA request exception discarded; scope changed during fetch.', {
          requestFilterKey: requestContext?.filterKey,
          currentFilterKey: getCurrentScadaScope().filterKey,
          requestMode: requestContext?.mode,
          currentMode: getCurrentScadaScope().mode,
          requestFetchSeq: requestContext?.fetchSeq,
          currentFetchSeq: state.scada.fetchSeq
        });
        // Execute pending trigger if any (latest scope will be fetched)
        const pollState = state.scada.pollState;
        if (pollState?.pendingTrigger) {
          const pending = pollState.pendingTrigger;
          pollState.pendingTrigger = null;
          scadaLog('info', `Bekleyen ${pending.triggerType} tetigi aktif sorgu sonrasinda calistiriliyor.`);
          setTimeout(() => {
            if (state.scada.enabled && !state.scada.fetchInProgress) {
              scadaDoFetch(pending.options);
            }
          }, 0);
        }
        return;
      }

      const finishedAt = new Date();
      const errorMessage = error.message || String(error);
      updateScadaFetchMeta({
        status: 'error',
        stage: 'error',
        progressPct: 100,
        phaseLabel: 'Hata',
        phaseMessage: errorMessage,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: errorMessage
      });
      if (triggerType === 'live-return') {
        setScadaOperationMeta({ stage: 'error', progressPct: 100, message: errorMessage });
        setScadaStatusMessage(`${errorMessage} Son canli goruntu korundu.`, 'warn');
        scadaLog('warn', 'SCADA canli donus sorgusu basarisiz; son goruntu korundu.');
      } else {
        markScadaFlowsUnavailable(errorMessage, SCADA_ERROR.NETWORK_ERROR);
        setScadaOperationMeta({ stage: 'error', progressPct: 100, message: errorMessage });
        scadaLog('error', 'SCADA fetch istisnasi', errorMessage);
      }
    } finally {
      state.scada.fetchInProgress = false;
      state.scada.currentRequestContext = null;
      // Execute any pending trigger (filter-change, mode-change, etc.) after current fetch completes
      const pollState = state.scada.pollState;
      if (pollState?.pendingTrigger) {
        const pending = pollState.pendingTrigger;
        pollState.pendingTrigger = null;
        scadaLog('info', `Bekleyen ${pending.triggerType} tetigi aktif sorgu sonrasinda calistiriliyor.`);
        setTimeout(() => {
          if (state.scada.enabled && !state.scada.fetchInProgress) {
            scadaDoFetch(pending.options);
          }
        }, 0);
      } else if (state.scada.autoRefresh && state.scada.enabled) {
        if (pollState?.pendingAutoRefresh && !isDocumentHidden()) {
          pollState.pendingAutoRefresh = false;
          pollState.lastAutoRunAt = new Date();
          pollState.nextDueAt = null;
          scadaLog('info', 'Bekleyen otomatik yenileme aktif sorgu sonrasinda hemen calistiriliyor.');
          setTimeout(() => {
            if (state.scada.enabled && state.scada.autoRefresh && !state.scada.fetchInProgress) {
              scadaDoFetch({ trigger: 'auto' });
            }
          }, 0);
        } else {
          scheduleNextScadaAutoTick(SCADA_CONFIG.POLL_INTERVAL_MS);
        }
      }
      if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
      if (typeof refreshRankingTable === 'function') refreshRankingTable();
    }
  };

  function getMetricLegendCounts(modeConfig) {
    if (modeConfig.domain === 'bara') {
      const counts = [
        { label: '0.00-0.80', color: '#6b7280', count: 0 },
        { label: '0.80-0.95', color: '#7c3aed', count: 0 },
        { label: '0.95-0.97', color: '#1d4ed8', count: 0 },
        { label: '0.97-0.99', color: '#7dd3fc', count: 0 },
        { label: '0.99-1.01', color: '#22c55e', count: 0 },
        { label: '1.01-1.03', color: '#fb923c', count: 0 },
        { label: '1.03-1.05', color: '#ea580c', count: 0 },
        { label: '1.05-1.20', color: '#7c3aed', count: 0 },
        { label: '1.20+', color: '#6b7280', count: 0 }
      ];
      getVoltagePanelRepresentatives().forEach(({ entity, record }) => {
        if (record.sourceAmbiguous) return;
        const nominal = Number(entity.gerilimKv || 0) || 1;
        const pu = nominal > 0 ? record.primaryValue / nominal : null;
        if (!Number.isFinite(pu)) return;
        if (pu < 0.80) counts[0].count += 1;
        else if (pu < 0.95) counts[1].count += 1;
        else if (pu < 0.97) counts[2].count += 1;
        else if (pu < 0.99) counts[3].count += 1;
        else if (pu <= 1.01) counts[4].count += 1;
        else if (pu <= 1.03) counts[5].count += 1;
        else if (pu <= 1.05) counts[6].count += 1;
        else if (pu <= 1.20) counts[7].count += 1;
        else counts[8].count += 1;
      });
      return counts;
    }
    const thresholds = modeConfig.primaryMetric === 'reactive' ? MVAR_RATIO_THRESHOLDS : SCADA_CONFIG.LOADING_THRESHOLDS;
    const counts = thresholds.map((threshold) => ({
      label: threshold.label,
      color: threshold.color,
      count: 0
    }));
    state.scada.entityMetricsByKey.forEach((record) => {
      if (record.entityType === 'bara') return;
      if (!Number.isFinite(record.displayPct) || record.invalidPct || record.primaryStaleState === 'dead') return;
      const bucket = counts.find((entry, index) => record.displayPct <= thresholds[index].max);
      if (bucket) bucket.count += 1;
    });
    return counts;
  }

  function syncScadaFetchUi() {
    const fetchMeta = state.scada.fetchMeta || {};
    const op = state.scada.operationMeta || {};
    const opActive = Boolean(op.kind && op.stage && op.stage !== 'done' && op.stage !== 'error');
    const elFetchBadge = document.getElementById('scadaFetchBadge');
    const elFetchMessage = document.getElementById('scadaFetchMessage');
    const elFetchSummary = document.getElementById('scadaFetchSummary');
    const elFetchTrigger = document.getElementById('scadaFetchTrigger');
    const elFetchStart = document.getElementById('scadaFetchStart');
    const elFetchEnd = document.getElementById('scadaFetchEnd');
    const elFetchDuration = document.getElementById('scadaFetchDuration');
    const elFetchRawRows = document.getElementById('scadaFetchRawRows');
    const elFetchNormalizedRows = document.getElementById('scadaFetchNormalizedRows');
    const elFetchVisibleRows = document.getElementById('scadaFetchVisibleRows');
    const elFetchTransport = document.getElementById('scadaFetchTransport');
    const elProgress = document.getElementById('scadaProgress');
    const elProgressTitle = document.getElementById('scadaProgressTitle');
    const elProgressPct = document.getElementById('scadaProgressPct');
    const elProgressBar = document.getElementById('scadaProgressBar');
    const elProgressSub = document.getElementById('scadaProgressSub');
    const elEnrichHint = document.getElementById('scadaEnrichHint');
    const btnRefresh = document.querySelector('[data-scada-btn="refresh"]');
    const btnRefreshLabel = document.getElementById('scadaRefreshBtnLabel');
    const btnHistoricalShow = document.getElementById('btnScadaHistoricalShow');

    const formatClock = (value) => {
      if (!value) return '-';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const formatDuration = (ms) => {
      if (!Number.isFinite(ms) || ms <= 0) return '-';
      if (ms < 1000) return `${Math.round(ms)} ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} sn`;
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.round((ms % 60000) / 1000);
      return `${minutes} dk ${seconds} sn`;
    };

    const displayPct = opActive ? (Number(op.progressPct) || 0) : (Number(fetchMeta.progressPct) || 0);
    const fetchStatusClass = fetchMeta.status === 'loading' || opActive
      ? 'is-loading'
      : fetchMeta.status === 'error'
        ? 'is-error'
        : fetchMeta.status === 'success'
          ? 'is-success'
          : 'is-idle';

    if (elFetchBadge) {
      elFetchBadge.className = `scada-fetch-badge ${fetchStatusClass}`;
      elFetchBadge.textContent = fetchMeta.status === 'loading' || opActive
        ? `${Math.max(1, displayPct)}%`
        : fetchMeta.status === 'error'
          ? 'Hata'
          : fetchMeta.status === 'success'
            ? 'Tamam'
            : 'Hazir';
    }
    if (elFetchMessage) {
      elFetchMessage.textContent = opActive && op.message
        ? op.message
        : (fetchMeta.phaseMessage || 'Henuz sorgu yapilmadi.');
    }
    if (btnHistoricalShow) {
      const historicalLoading = opActive && op.kind === 'historical';
      btnHistoricalShow.disabled = historicalLoading;
      btnHistoricalShow.textContent = historicalLoading ? 'Yükleniyor...' : 'Haritada Göster';
    }
    // Compact "Son sorgu" summary line (e.g. "364 olcum • 267/312").
    if (elFetchSummary) {
      const details = [];
      const normalizedRows = Number(fetchMeta.normalizedRows) || 0;
      if (normalizedRows > 0) details.push(`${normalizedRows} olcum`);
      const summary = state.scada.visibleSummary;
      if (summary) {
        const available = Number.isFinite(Number(summary.available)) ? Number(summary.available) : (Number(summary.matched) || 0);
        const total = Number(summary.total) || 0;
        if (total > 0) details.push(`${available}/${total}`);
      }
      const durationText = formatDuration(fetchMeta.durationMs);
      if (durationText !== '-') details.push(durationText);
      elFetchSummary.textContent = details.length ? details.join(' • ') : fetchMeta.status === 'success' ? 'Tamam' : '-';
    }
    if (elFetchTrigger) elFetchTrigger.textContent = fetchMeta.triggerLabel || '-';
    if (elFetchStart) elFetchStart.textContent = formatClock(fetchMeta.startedAt);
    if (elFetchEnd) elFetchEnd.textContent = formatClock(fetchMeta.finishedAt);
    if (elFetchDuration) elFetchDuration.textContent = formatDuration(fetchMeta.durationMs);
    if (elFetchRawRows) elFetchRawRows.textContent = String(fetchMeta.rawRows || 0);
    if (elFetchNormalizedRows) elFetchNormalizedRows.textContent = String(fetchMeta.normalizedRows || 0);
    if (elFetchVisibleRows) {
      elFetchVisibleRows.textContent = `${fetchMeta.visibleMatched || 0}/${fetchMeta.visibleTotal || 0}`;
      elFetchVisibleRows.title = `Gecikmeli: ${fetchMeta.visibleDelayed || 0} | Bayat: ${fetchMeta.visibleDead || 0} | Eslesmeyen: ${fetchMeta.visibleUnmatched || 0}`;
    }
    if (elFetchTransport) {
      const transportParts = [
        fetchMeta.authMode || '-',
        fetchMeta.usedFallback ? 'fallback' : null,
        Number.isFinite(fetchMeta.httpStatus) ? String(fetchMeta.httpStatus) : null
      ].filter(Boolean);
      elFetchTransport.textContent = transportParts.join(' / ') || '-';
    }

    // Single visible progress component; enrichment keeps its own small hint.
    if (elProgress) {
      const showProgress = opActive && op.kind !== 'enrichment';
      elProgress.classList.toggle('hidden', !showProgress);
      if (showProgress) {
        if (elProgressTitle) {
          elProgressTitle.textContent = op.kind === 'live-return'
            ? 'CANLIYA DONULUYOR'
            : op.kind === 'historical'
              ? 'Gecmis veri yukleniyor'
              : 'Canli veri yenileniyor';
        }
        if (elProgressPct) elProgressPct.textContent = `${Math.max(0, Math.min(100, Math.round(displayPct)))}%`;
        if (elProgressBar) elProgressBar.style.width = `${Math.max(0, Math.min(100, Math.round(displayPct)))}%`;
        const subParts = [];
        if (op.kind === 'live-return') subParts.push('Son canli goruntu gosteriliyor; yeni veri kontrol ediliyor');
        if (op.completedBatches && op.totalBatches) subParts.push(`Batch ${op.completedBatches}/${op.totalBatches}`);
        if (op.message && !subParts.includes(op.message)) subParts.push(op.message);
        if (elProgressSub) elProgressSub.textContent = subParts.join(' • ');
      }
    }
    if (elEnrichHint) {
      const showHint = opActive && op.kind === 'enrichment';
      elEnrichHint.textContent = showHint ? (op.message || 'Eksik olcumler arka planda tamamlaniyor...') : '';
      elEnrichHint.classList.toggle('hidden', !showHint);
    }

    if (btnRefresh) {
      btnRefresh.disabled = Boolean(state.scada.fetchInProgress);
      btnRefresh.classList.toggle('is-loading', Boolean(state.scada.fetchInProgress));
      btnRefresh.classList.toggle('is-success', !state.scada.fetchInProgress && fetchMeta.status === 'success');
      btnRefresh.classList.toggle('is-error', !state.scada.fetchInProgress && fetchMeta.status === 'error');
      btnRefresh.title = state.scada.fetchInProgress
        ? `SCADA sorgusu suruyor: ${fetchMeta.phaseLabel || 'Sorgu'}`
        : 'Manuel Yenile';
    }
    if (btnRefreshLabel) {
      btnRefreshLabel.textContent = state.scada.fetchInProgress || opActive
        ? `${Math.max(1, displayPct)}%`
        : fetchMeta.status === 'error'
          ? 'Hata'
          : 'Yenile';
    }
  }

  function buildScadaQualityChips(summary) {
    const historical = state.scada.timeMode === 'historical';
    const chips = [
      { label: historical ? 'Gecerli' : 'Canli', value: summary.matched || 0, tone: 'is-live' },
      { label: 'Gecikmeli', value: summary.delayed || 0, tone: 'is-warn' },
      { label: historical ? 'Eski' : 'Bayat', value: summary.dead || 0, tone: 'is-dead' },
      { label: 'Yon belirsiz', value: summary.orientationUnknown || 0, tone: 'is-unknown', filter: 'orientation-unknown' },
      { label: 'Terminal yorumlu', value: summary.resolvedWithWarning || 0, tone: 'is-resolved-warning', filter: 'resolved-with-warning' },
      { label: 'Eksik', value: summary.unmatched || 0, tone: 'is-missing', filter: 'missing' }
    ];
    return chips.map((chip) => {
      const body = `${escapeHtml(chip.label)} <strong>${chip.value}</strong>`;
      if (chip.filter) {
        return `<button type="button" class="scada-quality-chip ${chip.tone}" title="${escapeHtml(chip.label)}" data-scada-audit-filter="${escapeHtml(chip.filter)}">${body}</button>`;
      }
      return `<span class="scada-quality-chip ${chip.tone}" title="${escapeHtml(chip.label)}">${body}</span>`;
    }).join('');
  }

  updateScadaCardUI = function () {
    const modeConfig = getModeConfig();
    const summary = state.scada.visibleSummary || refreshScadaVisibleSummary();
    const elSonVeri = document.getElementById('scadaSonVeri');
    const elToplam = document.getElementById('scadaToplam');
    const elEslesen = document.getElementById('scadaEslesen');
    const elEslesmeyen = document.getElementById('scadaEslesmeyen');
    const elStale = document.getElementById('scadaStale');
    const elHata = document.getElementById('scadaHata');
    const elAvailable = document.getElementById('scadaAvailable');
    const elEksik = document.getElementById('scadaEksik');
    const elHeaderState = document.getElementById('scadaHeaderState');
    const elLejant = document.getElementById('scadaLejant');
    const elQualityChips = document.getElementById('scadaQualityChips');
    const elKalite = document.getElementById('scadaKalite');
    const btnBolt = document.getElementById('btnScadaRanking');

    const summaryAvailable = Number.isFinite(Number(summary.available)) ? Number(summary.available) : (Number(summary.matched) || 0);
    const summaryMissing = Number.isFinite(Number(summary.missing)) ? Number(summary.missing) : (Number(summary.total) || 0) - summaryAvailable;

    if (elHeaderState) {
      const historicalState = state.scada.timeMode === 'historical';
      elHeaderState.textContent = historicalState ? '● GECMIS' : '● CANLI';
      elHeaderState.classList.toggle('is-historical', historicalState);
      elHeaderState.classList.toggle('is-live', !historicalState);
    }
    if (elSonVeri) {
      elSonVeri.textContent = state.scada.lastDataTimestamp
        ? state.scada.lastDataTimestamp.toLocaleTimeString('tr-TR')
        : '-';
    }
    if (elToplam) elToplam.textContent = String(summary.total || 0);
    if (elEslesen) elEslesen.textContent = String(summary.matched || 0);
    if (elEslesmeyen) elEslesmeyen.textContent = String((summary.unmatched || 0) + (summary.ambiguousLive || 0));
    if (elStale) elStale.textContent = String(summary.dead || 0);
    if (elHata) elHata.textContent = state.scada.error || '-';
    if (elAvailable) elAvailable.textContent = `${summaryAvailable}/${summary.total || 0} veri`;
    if (elEksik) elEksik.textContent = String(Math.max(0, summaryMissing));

    if (elLejant) {
      const legendCounts = getMetricLegendCounts(modeConfig);
      elLejant.innerHTML = legendCounts.map((entry) => (
        `<span style="color:${entry.color}" title="${entry.label}">&#9679;${entry.count}</span>`
      )).join(' ');
    }

    if (elQualityChips) {
      elQualityChips.innerHTML = buildScadaQualityChips(summary);
      Array.from(elQualityChips.querySelectorAll('[data-scada-audit-filter]')).forEach((button) => {
        button.addEventListener('click', () => {
          if (typeof showScadaMismatchReportModal === 'function') {
            showScadaMismatchReportModal(button.dataset.scadaAuditFilter || '');
          }
        });
      });
    }

    if (elKalite) {
      const transport = state.scada.lastTransport;
      const parts = [
        `Mod: ${modeConfig.label}`,
        `Auth: ${state.scada.authState || 'idle'}`,
        transport?.authMode ? `Tasima: ${transport.authMode}${transport.usedFallback ? ' (fallback)' : ''}` : null,
        `Gorunen kalite: ${summary.matched || 0}/${summary.total || 0}`,
        summary.delayed ? `Gecikmeli: ${summary.delayed}` : null,
        summary.dead ? `Bayat: ${summary.dead}` : null,
        summary.resolvedWithWarning ? `Terminal yorumlu: ${summary.resolvedWithWarning}` : null,
        `Belirsiz: ${summary.ambiguousLive || 0}`,
        summary.orientationUnknown ? `Yon belirsiz: ${summary.orientationUnknown}` : null,
        `Ham satir kalite: ${state.scada.measurementRowsById?.size || 0}/${state.scada.totalRows || 0}`
      ].filter(Boolean);
      elKalite.textContent = parts.join(' | ');
    }

    if (btnBolt) {
      btnBolt.classList.toggle('hidden', !state.scada.enabled || !state.scada.entityMetricsByKey.size);
    }

    syncScadaFetchUi();
    syncScadaMetricButtons();
    syncScadaMapDisplayButtons();
    if (typeof requestRender === 'function') requestRender();
  };

  function getPrimaryStatusClass(record) {
    if (!record || !Number.isFinite(record.primaryValue)) return 'is-ambiguous';
    if (record.sourceAmbiguous || record.unresolved || record.candidateConflict || record.backupUsed || record.uncertaintyReason) return 'is-ambiguous';
    if (record.primaryStaleState === 'dead') return 'is-dead';
    if (record.primaryStaleState === 'warn') return 'is-warn';
    return 'is-live';
  }

  function buildEntityMetricVisual(entityType, entity) {
    const modeConfig = getModeConfig();
    if (!state.scada.enabled) return null;
    if ((modeConfig.domain === 'hat' && entityType !== 'hat')
      || (modeConfig.domain === 'trafo' && entityType !== 'trafo')
      || (modeConfig.domain === 'bara' && entityType !== 'bara')) {
      return null;
    }
    const record = state.scada.entityMetricsByKey.get(`${entityType}:${entity.id}`);
    if (!record || !Number.isFinite(record.primaryValue)) return null;
    const displayMode = normalizeScadaMapDisplayMode(modeConfig, state.filters.scadaMapDisplayMode);
    const showValueBox = entityType === 'hat'
      ? false
      : displayMode === 'box';
    const showRing = entityType === 'hat'
      ? false
      : displayMode === 'point' || displayMode === 'point-label';

    if (entityType === 'bara') {
      const nominal = Number(entity.gerilimKv || 0) || 1;
      const pu = record.primaryValue / nominal;
      const color = typeof getVoltagePuColor === 'function' ? getVoltagePuColor(pu) : '#2563eb';
      const tmLabel = String(entity.tmName || entity.tm?.name || entity.name || '-').trim();
      const rawValueText = record.primaryValue.toFixed(1);
      const severityValue = Number.isFinite(pu) ? Math.abs(pu - 1) : 0;
      return {
        fillColor: color,
        ringColor: showRing ? (record.sourceAmbiguous ? '#ef4444' : color) : '',
        valueText: showValueBox ? rawValueText : '',
        valueTitle: `${tmLabel} | ${record.primaryValue.toFixed(1)} kV | ${pu.toFixed(3)} p.u.`,
        labelText: tmLabel,
        labelTitle: `${tmLabel} (${entity.gerilimKv || entity.kvBucket || '-'})`,
        rawValueText,
        puValue: pu,
        heatValue: severityValue,
        priorityScore: buildVisualPriorityScore(record, severityValue, entity.gerilimKv || entity.kvBucket || 0),
        groupKey: `tm:${entity.tmId || entity.tm?.id || entity.id}|kv:${entity.kvBucket || entity.gerilimKv || ''}`,
        nominalKv: Number(entity.gerilimKv || entity.kvBucket || 0) || 0,
        statusClass: getPrimaryStatusClass(record)
      };
    }

    const color = record.primaryStaleState === 'dead'
      ? (SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af')
      : getDisplayColor(record);
    const primaryUnit = getMetricUnit(record.primaryMetric);
    const rawValueText = `${record.primaryValue >= 0 ? '+' : ''}${record.primaryValue.toFixed(1)}`;
    const severityValue = Number.isFinite(record.displayPct) ? record.displayPct : Math.abs(record.primaryValue || 0);
    return {
      fillColor: entityType === 'trafo'
        ? (entity.type === 'transmission' ? '#0ea5e9' : '#22c55e')
        : color,
      ringColor: showRing ? (record.sourceAmbiguous ? '#ef4444' : color) : '',
      valueText: showValueBox ? `${rawValueText} ${primaryUnit}` : '',
      valueTitle: `${entity.displayName || entity.name || '-'} | ${rawValueText} ${primaryUnit}${Number.isFinite(record.displayPct) ? ` | ${record.displayPct.toFixed(1)}%` : ''}`,
      labelText: entityType === 'trafo' ? String(entity.name || entity.displayName || '-').trim() : '',
      labelTitle: entity.displayName || entity.name || '-',
      rawValueText,
      heatValue: severityValue,
      priorityScore: buildVisualPriorityScore(record, severityValue, entity.primaryKv || entity.kvBucket || 0),
      groupKey: `tm:${entity.tmId || entity.tm?.id || entity.id}|${entityType}`,
      nominalKv: Number(entity.primaryKv || entity.kvBucket || 0) || 0,
      statusClass: getPrimaryStatusClass(record)
    };
  }

  getScadaPopupFields = function (hatRow) {
    const record = state.scada.entityMetricsByKey.get(`hat:${hatRow.id}`);
    if (!state.scada.enabled || !record) return [['SCADA Durumu', 'Eslesmedi']];
    if (!Number.isFinite(record.primaryValue)) {
      return [['SCADA Durumu', ['orientation-unknown', 'source-side-unknown', 'polarization-mismatch'].includes(record.unresolvedReason) ? 'Yon belirsiz' : 'Eslesmedi']];
    }
    const fields = [];
    if (record.active?.valueInvalid) fields.push(['Aktif Guc (MW)', '!']);
    else if (Number.isFinite(record.active?.value)) fields.push(['Aktif Guc (MW)', `${record.active.value >= 0 ? '+' : ''}${record.active.value.toFixed(1)}`]);
    if (record.reactive?.valueInvalid) fields.push(['Reaktif Guc (MVar)', '!']);
    else if (Number.isFinite(record.reactive?.value)) fields.push(['Reaktif Guc (MVar)', `${record.reactive.value >= 0 ? '+' : ''}${record.reactive.value.toFixed(1)}`]);
    if (record.invalidPct) fields.push([record.displayPctMode === 'reactive-ratio' ? 'MVar/MW Orani' : 'Yuklenme', '!']);
    else if (Number.isFinite(record.displayPct)) {
      fields.push([
        record.displayPctMode === 'reactive-ratio' ? 'MVar/MW Orani' : 'Yuklenme',
        `${record.displayPct.toFixed(1)}%${record.displayPctMode === 'loading' ? ` (${formatNumber(record.capacityMva, ' MVA')})` : ''}`
      ]);
    }
    if (record.primaryTimestamp) fields.push(['Olcum Zamani', `${record.primaryTimestamp.toLocaleDateString('tr-TR')} ${record.primaryTimestamp.toLocaleTimeString('tr-TR')}`]);
    fields.push(['Veri Durumu', record.primaryStatusText || '-']);
    if (record.ageLabel) fields.push(['Veri Yasi', record.ageLabel]);
    if (record.primaryMeasurementId) fields.push(['Olcum ID', record.primaryMeasurementId]);
    return fields;
  };

  function buildHatDirectionText(hat, record) {
    if (!record) return 'Belirsiz';
    if (!Number.isFinite(record.directionValue) || hasHatUncertainty(record)) {
      return ['orientation-unknown', 'source-side-unknown', 'polarization-mismatch'].includes(record.unresolvedReason)
        ? 'Yon belirsiz'
        : 'Belirsiz';
    }
    return record.directionValue >= 0
      ? `${hat.startTm || '?'} -> ${hat.endTm || '?'}`
      : `${hat.endTm || '?'} -> ${hat.startTm || '?'}`;
  }

  function renderHatUncertaintyCard(record) {
    const meta = buildHatUncertaintyMeta(record);
    if (!meta.detailLines.length) return '';
    const measurementLabel = record.selectedCandidate || record.primaryMeasurementId || '-';
    const polarizationLabel = Number.isFinite(record.polarizationSign)
      ? `${record.polarizationSign > 0 ? '+' : ''}${record.polarizationSign}`
      : '-';
    const consistencyLabel = record.polarizationConsistent == null
      ? '-'
      : (record.polarizationConsistent ? 'Uyumlu' : 'Uyumsuz');
    return `
      <div class="technical-note-card">
        <div class="technical-note-title">Belirsizlik / Teknik Durum</div>
        <ul class="technical-note-list">
          ${meta.detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
        </ul>
        <div class="technical-note-grid">
          <div class="technical-note-item"><span>Secilen Olcum</span><strong>${escapeHtml(measurementLabel)}</strong></div>
          <div class="technical-note-item"><span>Yedek Kullanimi</span><strong>${record.backupUsed ? 'Evet' : 'Hayir'}</strong></div>
          <div class="technical-note-item"><span>Terminal Tarafi</span><strong>${escapeHtml(record.terminalSide || '-')}</strong></div>
          <div class="technical-note-item"><span>Terminal Eslesmesi</span><strong>${escapeHtml(record.terminalMatchBasis || '-')}</strong></div>
          <div class="technical-note-item"><span>Polarizasyon</span><strong>${escapeHtml(polarizationLabel)}</strong></div>
          <div class="technical-note-item"><span>Polarizasyon Tutarliligi</span><strong>${escapeHtml(consistencyLabel)}</strong></div>
          <div class="technical-note-item"><span>Cozum Yontemi</span><strong>${escapeHtml(record.resolutionMethod || '-')}</strong></div>
          <div class="technical-note-item"><span>Yon Modeli</span><strong>${escapeHtml(record.directionModel || '-')}</strong></div>
        </div>
      </div>
    `;
  }
  function renderHatMeasurementCard(record) {
    if (!record) return '';
    const sections = [];
    const renderRows = (title, metricRecord, unit) => {
      const rows = Array.isArray(metricRecord?.candidateDetails) ? metricRecord.candidateDetails : [];
      if (!rows.length) return '';
      const selectedValue = metricRecord?.valueInvalid
        ? '!'
        : Number.isFinite(metricRecord?.value)
          ? `${metricRecord.value >= 0 ? '+' : ''}${metricRecord.value.toFixed(2)} ${unit}`
          : '-';
      return `
        <div class="technical-note-card">
          <div class="technical-note-title">${escapeHtml(title)}</div>
          <div class="technical-note-grid">
            <div class="technical-note-item"><span>Secilen Olcum</span><strong>${escapeHtml(metricRecord?.measurementId || '-')}</strong></div>
            <div class="technical-note-item"><span>Secilen Deger</span><strong>${escapeHtml(selectedValue)}</strong></div>
            <div class="technical-note-item technical-note-item-wide"><span>Secim Nedeni</span><strong>${escapeHtml(metricRecord?.selectedCandidateReason || record.selectedCandidateReason || '-')}</strong></div>
          </div>
          <div class="technical-note-measurements">
            ${rows.map((row) => {
              const timeText = row.timestamp
                ? `${row.timestamp.toLocaleDateString('tr-TR')} ${row.timestamp.toLocaleTimeString('tr-TR')}`
                : '-';
              const rawText = row.valueInvalid
                ? '!'
                : Number.isFinite(row.rawValue)
                  ? `${row.rawValue >= 0 ? '+' : ''}${row.rawValue.toFixed(2)}`
                  : '-';
              const normalizedText = row.valueInvalid
                ? '!'
                : Number.isFinite(row.normalizedValue)
                  ? `${row.normalizedValue >= 0 ? '+' : ''}${row.normalizedValue.toFixed(2)} ${unit}`
                  : '-';
              return `
                <div class="technical-note-measurement-row${row.selected ? ' is-selected' : ''}">
                  <div><span>Ölçüm Adresi</span><strong>${escapeHtml(row.measurementId || '-')}</strong></div>
                  <div><span>Formül</span><strong>${escapeHtml(row.formulaRaw || '-')}</strong></div>
                  <div><span>Superset Kaynak Değeri</span><strong>${escapeHtml(rawText)}</strong></div>
                  <div><span>Harita Akış Değeri</span><strong>${escapeHtml(normalizedText)}</strong></div>
                  <div><span>Superset Veri Zamanı</span><strong>${escapeHtml(timeText)}</strong></div>
                  <div><span>Terminal Tarafı</span><strong>${escapeHtml(row.terminalSide || '-')}</strong></div>
                  <div><span>Seçim Nedeni</span><strong>${escapeHtml(row.selectedCandidateReason || '-')}</strong></div>
                  <div><span>Seçildi mi</span><strong>${row.selected ? 'Evet' : 'Hayır'}</strong></div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    };
    sections.push(renderRows('Aktif Güç Ölçümleri', record.active, 'MW'));
    sections.push(renderRows('Reaktif Güç Ölçümleri', record.reactive, 'MVar'));
    return sections.filter(Boolean).join('');
  }

  function buildHatPopupModel(hat) {
    const record = state.scada.entityMetricsByKey.get(`hat:${hat.id}`);
    const directionText = buildHatDirectionText(hat, record);
    const pctLabel = record?.displayPctMode === 'reactive-ratio' ? 'MVar/MW Orani' : 'Yuklenme';
    const pctValue = record?.invalidPct
      ? '!'
      : Number.isFinite(record?.displayPct)
        ? `${record.displayPct.toFixed(1)}%`
        : '-';
    const compactFields = [
      ['Uzunluk', formatNumber(hat.lengthKm, ' km')],
      ['Kapasite', formatNumber(getCapacityMva('hat', hat), ' MVA')],
      ['Aktif Guc (MW)', record?.active?.valueInvalid ? '!' : Number.isFinite(record?.active?.value) ? `${record.active.value >= 0 ? '+' : ''}${record.active.value.toFixed(1)}` : '-'],
      ['Reaktif Guc (MVar)', record?.reactive?.valueInvalid ? '!' : Number.isFinite(record?.reactive?.value) ? `${record.reactive.value >= 0 ? '+' : ''}${record.reactive.value.toFixed(1)}` : '-'],
      [pctLabel, pctValue],
      ['Akis Yonu', directionText],
      ['Olcum Zamani', record?.primaryTimestamp ? record.primaryTimestamp.toLocaleTimeString('tr-TR') : '-']
    ];
    const detailFields = [
      ['Hat ID', hat.kmlDescriptionId || '-'],
      ['YTM', (hat.ytmNames || []).join(' / ') || '-'],
      ['Hat Kesit', formatKesit(hat.characteristic || '-')],
      ['Aktif Olcum ID', record?.active?.measurementId || '-'],
      ['Reaktif Olcum ID', record?.reactive?.measurementId || '-'],
      ['Veri Durumu', record?.primaryStatusText || '-'],
      ['Yon Cozumleme', record?.directionResolvedBy || '-'],
      ['Alias Eslesme', record?.aliasMatchBasis || '-'],
      ['Formula Sign', Number.isFinite(Number(record?.formulaSign)) ? String(record.formulaSign) : '-'],
      ['Cozum Yontemi', record?.resolutionMethod || '-'],
      ['Secim Nedeni', record?.selectedCandidateReason || '-'],
      ['Terminal Tarafi', record?.terminalSide || '-'],
      ['Polarizasyon', Number.isFinite(record?.polarizationSign) ? `${record.polarizationSign > 0 ? '+' : ''}${record.polarizationSign}` : '-'],
      ['Polarizasyon Tutarliligi', record?.polarizationConsistent == null ? '-' : (record.polarizationConsistent ? 'Uyumlu' : 'Uyumsuz')],
      ['Veri Durumu', record?.timeStateLabel || record?.primaryStatusText || '-'],
      ['Veri Yasi', record?.ageLabel || '-']
    ];
    return {
      title: hat.name,
      subtitle: hat.kv ? `${hat.kv} kV Hat` : 'Hat',
      tags: [(hat.ytmNames || []).join(' / ') || '-'],
      compactFields,
      detailFields,
      detailExtraHtml: `${renderHatMeasurementCard(record)}${renderHatUncertaintyCard(record)}`
    };
  }

  openScadaHatDetails = function (hat, options = {}) {
    if (!hat) return;
    state.selection = { kind: 'hat', id: hat.id, measureSourceId: '', measureTargetIds: [] };
    const model = buildHatPopupModel(hat);
    const anchorCoord = options.anchorCoord || getHatAnchorCoord(hat);
    const expanded = typeof options.expanded === 'boolean'
      ? options.expanded
      : Boolean(state.ui.activeEntityPopup?.expanded && state.ui.activeEntityPopup?.entityId === hat.id);

    showInfo({
      title: model.title,
      subtitle: model.subtitle,
      tags: model.tags,
      compactFields: model.compactFields,
      detailFields: model.detailFields,
      detailExtraHtml: model.detailExtraHtml,
      actions: [{ id: 'btnShowScadaChart', label: 'Grafik Göster' }],
      anchor: { hatId: hat.id, coord: anchorCoord },
      expanded,
      classes: ['hat-popup']
    });

    state.ui.activeEntityPopup = {
      entityType: 'hat',
      entityId: hat.id,
      anchorCoord,
      expanded,
      screenPosition: null
    };

    const chartBtn = document.getElementById('btnShowScadaChart');
    if (chartBtn) chartBtn.addEventListener('click', () => openScada24hHistory(`hat:${hat.id}`));
    const toggleBtn = document.getElementById('btnToggleInfoDetails');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        openScadaHatDetails(hat, {
          anchorCoord,
          expanded: !expanded,
          forceTiles: false
        });
      });
    }

    requestRender({ forceTiles: Boolean(options.forceTiles) });
  };


  function closeScadaChartModal() {
    const backdrop = document.getElementById('scadaChartModalBackdrop');
    if (backdrop) backdrop.remove();
  }

  const HISTORY_PRESETS = [
    { key: '1h', label: 'Son 1 Saat' },
    { key: '6h', label: 'Son 6 Saat' },
    { key: '24h', label: 'Son 24 Saat' },
    { key: '7d', label: 'Son 7 Gun' },
    { key: 'custom', label: 'Ozel' }
  ];

  function resolveHistoryRange(presetKey, customStartMs, customEndMs) {
    const now = Date.now();
    if (presetKey === 'custom') {
      if (customStartMs != null && customEndMs != null
        && Number.isFinite(Number(customStartMs)) && Number.isFinite(Number(customEndMs))) {
        return { startMs: Number(customStartMs), endMs: Number(customEndMs) };
      }
      return { startMs: now - 24 * 3600 * 1000, endMs: now };
    }
    const spans = {
      '1h': 3600 * 1000,
      '6h': 6 * 3600 * 1000,
      '24h': 24 * 3600 * 1000,
      '7d': 7 * 24 * 3600 * 1000
    };
    const spanMs = spans[presetKey] || 24 * 3600 * 1000;
    return { startMs: now - spanMs, endMs: now };
  }

  function setHistoryStatus(text, kind) {
    const statusEl = document.getElementById('scadaHistoryStatus');
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('is-error', kind === 'error');
    statusEl.classList.toggle('is-ok', kind === 'ok');
    statusEl.classList.toggle('is-loading', kind === 'loading');
  }

  function formatDateTimeLocalInput(valueMs) {
    const date = new Date(Number(valueMs));
    if (Number.isNaN(date.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function buildHistoryHeaderInfo(entityType, entity) {
    const info = {
      kicker: `SCADA GECMIS VERI - ${String(entityType || '').toUpperCase()}`,
      lines: []
    };
    if (!entity) return info;
    if (entityType === 'hat') {
      info.kicker = 'SCADA GECMIS VERI - HAT';
      if (entity.startTm || entity.endTm) info.lines.push(`${entity.startTm || '?'} -> ${entity.endTm || '?'}`);
      if (Number.isFinite(Number(entity.lengthKm)) && Number(entity.lengthKm) > 0) {
        info.lines.push(`Uzunluk: ${Number(entity.lengthKm).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km`);
      }
      const capacity = getCapacityMva('hat', entity);
      if (Number.isFinite(capacity) && capacity > 0) {
        info.lines.push(`Kapasite: ${capacity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MVA`);
      }
    } else if (entityType === 'trafo') {
      info.kicker = 'SCADA GECMIS VERI - TRAFO';
      const capacity = getCapacityMva('trafo', entity);
      if (Number.isFinite(capacity) && capacity > 0) {
        info.lines.push(`Kapasite: ${capacity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MVA`);
      }
      if (entity.tmName) info.lines.push(`Bagli TM: ${entity.tmName}`);
      if (entity.gerilimTuru) info.lines.push(entity.gerilimTuru);
    } else if (entityType === 'bara') {
      info.kicker = 'SCADA GECMIS VERI - BARA';
      const nominal = Number(entity.gerilimKv || entity.kvBucket || 0);
      if (nominal > 0) info.lines.push(`Nominal: ${nominal} kV`);
      if (entity.tmName) info.lines.push(`Bagli TM: ${entity.tmName}`);
    }
    return info;
  }

async function openScada24hHistory(entityKey, presetKey = '24h', customStartMs = null, customEndMs = null) {
    closeScadaChartModal();
    const isHat = entityKey.startsWith('hat:');
    const isTrafo = entityKey.startsWith('trafo:');
    const isBara = entityKey.startsWith('bara:');
    const entityType = isHat ? 'hat' : (isTrafo ? 'trafo' : 'bara');
    const entityId = entityKey.split(':')[1];

    let entity = null;
    if (isHat) {
      entity = state.network?.hatById?.get(String(entityId)) || state.network?.hatLines?.find((entry) => String(entry.id) === String(entityId));
    } else if (isTrafo) {
      entity = state.network?.trafos?.find((trafo) => String(trafo.id) === String(entityId));
    } else if (isBara) {
      const baraList = (typeof getVisibleBaras === 'function' ? getVisibleBaras() : []);
      entity = baraList.find((bara) => String(bara.id) === String(entityId))
        || (Array.isArray(state.network?.baraNodes) ? state.network.baraNodes.find((bara) => String(bara.id) === String(entityId)) : null);
    }

    const name = entity?.name || entityId;
    const headerInfo = buildHistoryHeaderInfo(entityType, entity);

    const lastUsed = state.scada.historyLastPresetByEntity?.get(entityKey);
    if (lastUsed && presetKey === '24h' && customStartMs == null && lastUsed.presetKey !== '24h') {
      openScada24hHistory(entityKey, lastUsed.presetKey, lastUsed.customStartMs, lastUsed.customEndMs);
      return;
    }

    if (!state.scada.historyLastPresetByEntity) state.scada.historyLastPresetByEntity = new Map();
    if (presetKey !== 'custom' || customStartMs != null) {
      state.scada.historyLastPresetByEntity.set(entityKey, { presetKey, customStartMs, customEndMs });
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'scadaChartModalBackdrop';
    backdrop.className = 'scada-chart-backdrop';
    backdrop.innerHTML = `
      <div class="scada-chart-modal" role="dialog" aria-modal="true" aria-label="SCADA Gecmis Grafik">
        <div class="scada-chart-header">
          <div>
            <p class="info-kicker">${escapeHtml(headerInfo.kicker)}</p>
            <h3>${escapeHtml(name)}</h3>
            ${headerInfo.lines.map((line) => `<p class="scada-chart-sub">${escapeHtml(line)}</p>`).join('')}
          </div>
          <button id="btnCloseScadaChart" class="info-close" title="Kapat">X</button>
        </div>
        <div class="scada-chart-controls">
          <div class="scada-history-presets" id="scadaHistoryPresets">
            ${HISTORY_PRESETS.map((preset) => `<button class="segmented-btn${preset.key === presetKey ? ' active' : ''}" data-history-preset="${preset.key}">${preset.label}</button>`).join('')}
          </div>
          <div class="scada-history-custom${presetKey === 'custom' ? '' : ' hidden'}" id="scadaHistoryCustom">
            <label>Baslangic <input type="datetime-local" id="scadaHistoryStart"></label>
            <label>Bitis <input type="datetime-local" id="scadaHistoryEnd"></label>
            <button id="btnScadaHistoryQuery" class="tiny">Sorgula</button>
          </div>
          <div id="scadaHistoryStatus" class="scada-history-status"></div>
        </div>
        <div class="scada-chart-body" id="scadaChartModalBody">
          <div class="scada-chart-empty">Geçmiş veri yükleniyor...</div>
        </div>
      </div>
    `;
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeScadaChartModal();
    });
    const mapShell = document.querySelector('.map-shell');
    if (mapShell) mapShell.appendChild(backdrop);
    const closeBtn = document.getElementById('btnCloseScadaChart');
    if (closeBtn) closeBtn.addEventListener('click', closeScadaChartModal);

    const presetRow = document.getElementById('scadaHistoryPresets');
    if (presetRow) {
      presetRow.addEventListener('click', (event) => {
        const target = event.target.closest('[data-history-preset]');
        if (target) openScada24hHistory(entityKey, target.dataset.historyPreset);
      });
    }
    const customRow = document.getElementById('scadaHistoryCustom');
    if (customRow) {
      const startInput = document.getElementById('scadaHistoryStart');
      const endInput = document.getElementById('scadaHistoryEnd');
      if (startInput && endInput) {
        const prefill = resolveHistoryRange(presetKey === 'custom' && customStartMs != null ? 'custom' : '24h', customStartMs, customEndMs);
        startInput.value = formatDateTimeLocalInput(prefill.startMs);
        endInput.value = formatDateTimeLocalInput(prefill.endMs);
      }
      const queryBtn = document.getElementById('btnScadaHistoryQuery');
      if (queryBtn) {
        queryBtn.addEventListener('click', () => {
          const startVal = document.getElementById('scadaHistoryStart')?.value;
          const endVal = document.getElementById('scadaHistoryEnd')?.value;
          const start = startVal ? new Date(startVal).getTime() : NaN;
          const end = endVal ? new Date(endVal).getTime() : NaN;
          if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
            _renderHistoryError(entityKey, 'Gecersiz ozel aralik: baslangic bitisten once olmali.');
            return;
          }
          openScada24hHistory(entityKey, 'custom', start, end);
        });
      }
    }

    if (presetKey === 'custom' && customStartMs == null) {
      const body = document.getElementById('scadaChartModalBody');
      if (body) body.innerHTML = '<div class="scada-chart-empty">Ozel tarih araligi secin ve Sorgula butonuna basin.</div>';
      setHistoryStatus('Ozel aralik bekleniyor.');
      return;
    }

const range = resolveHistoryRange(presetKey, customStartMs, customEndMs);
    const strategy = (typeof SCADA_COMMON !== 'undefined' && SCADA_COMMON.resolveHistoryAdaptiveStrategy)
      ? SCADA_COMMON.resolveHistoryAdaptiveStrategy(range.startMs, range.endMs)
      : { queryMode: 'raw', timeGrain: null, label: 'Ham' };

    const metricList = (typeof SCADA_COMMON !== 'undefined' && SCADA_COMMON.resolveHistoryMetricsByEntity)
      ? resolveHistoryMetricList(entityType, entity)
      : [];
    if (!metricList.length) {
      _renderHistoryError(entityKey, 'Bu donanimin olcum ID listesi bulunamadi.');
      return;
    }
    const requestedElementNames = [...new Set(metricList.map((metric) => metric.elementName))];
    const requestedMeasurementIds = [...new Set(metricList.flatMap((metric) => metric.measurementIds))];

    const cacheKey = buildHistoryCacheKey(requestedElementNames, requestedMeasurementIds, range, strategy);
    if (!state.scada.history24hCache) state.scada.history24hCache = new Map();
    const nowMs = Date.now();
    const cached = getHistoryCacheEntry(state.scada.history24hCache, cacheKey, nowMs);
    const metricSummaryLabel = `${requestedMeasurementIds.length} olcum (${requestedElementNames.join(', ')})`;

    if (window._scadaBypassCacheFor === entityKey) {
      window._scadaBypassCacheFor = null;
    } else if (cached) {
      setHistoryStatus(`Onbellekten gosterildi (${cached.source}).`, 'ok');
      let extraConfig = null;
      if (entityType === 'hat') {
        const voltageFetchPromise = fetchHatVoltageHistory(entity, range, strategy).catch(() => ({ series: [], nominal: true }));
        extraConfig = { voltageFetchPromise };
      }
      _renderHistoryData(cached.data, entityType, entity, entityKey, cached.wasTruncated, cached.source, strategy, cached.metricList || metricList, extraConfig);
      return;
    }

    async function fetchHistoryLevel(levelStrategy) {
      const useTimeseries = levelStrategy.queryMode === 'timeseries';
      const result = await chrome.runtime.sendMessage({
        type: 'SCADA_HISTORY_FETCH',
        payload: {
          baseUrl: SCADA_CONFIG.SUPERSET_ORIGIN,
          dashboardId: SCADA_CONFIG.DASHBOARD_ID,
          chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
          datasourceId: SCADA_CONFIG.DATASOURCE_ID,
          elementNames: requestedElementNames,
          measurementIds: requestedMeasurementIds,
          queryMode: useTimeseries ? 'timeseries' : 'raw',
          timeGrain: levelStrategy.timeGrain,
          startTime: range.startMs,
          endTime: range.endMs
        }
      });
      if (!result.ok || !result.data) {
        throw new Error(result?.error || 'Superset bos veya gecersiz yanit dondurdu.');
      }
      const rows = SCADA_COMMON.findDataArray(result.data) || [];
      const parsed = parseHistorySeriesByElement(rows, metricList);
      if (entityType === 'hat') {
        enrichHatHistorySeriesMetadata(parsed.series, entity);
      }
      return {
        rows,
        series: parsed.series,
        maxPoints: parsed.maxPoints,
        stats: parsed.stats,
        minTime: parsed.minTime,
        maxTime: parsed.maxTime,
        seenTimeKeys: parsed.seenTimeKeys,
        seenValueKey: parsed.seenValueKey
      };
    }

    const attemptLevels = [strategy];
    if (strategy.queryMode !== 'timeseries') {
      attemptLevels.push({ queryMode: 'timeseries', timeGrain: 'PT1M', label: '1 dk ozet' });
    }

    try {
      let data = null;
      let source = strategy.label;
      for (const level of attemptLevels) {
        if (data && data.maxPoints >= 2) break;
        setHistoryStatus(`${level.label} cozunurluk sorgulaniyor (${metricSummaryLabel})...`, 'loading');
        try {
          const levelData = await fetchHistoryLevel(level);
          if (data == null || levelData.maxPoints >= data.maxPoints) {
            data = levelData;
            source = level.label;
          }
        } catch (levelErr) {
          console.warn('[SCADA_HISTORY] Sorgu seviyesi basarisiz:', level.label, levelErr);
          if (data == null) throw levelErr;
        }
      }

      if (!data) {
        _renderHistoryError(entityKey, 'Veri alinamadi.', { mIds: requestedMeasurementIds, count: 0, source });
        return;
      }

      if (data.maxPoints < 2) {
        _renderHistoryError(entityKey, buildHistoryEmptyReason(data, requestedElementNames, requestedMeasurementIds), { mIds: requestedMeasurementIds, count: data.rows.length, source });
        return;
      }

      const rowLimit = (typeof SCADA_COMMON !== 'undefined' && SCADA_COMMON.CONFIG?.HISTORY_ROW_LIMIT) || 50000;
      const wasTruncated = data.rows.length >= rowLimit;
      const rangeLabel = (typeof SCADA_COMMON !== 'undefined' && SCADA_COMMON.formatSupersetTimeRange)
        ? SCADA_COMMON.formatSupersetTimeRange(range.startMs, range.endMs)
        : '';
      setHistoryStatus(`${source} cozunurluk · ${data.series.length} seri · ${data.maxPoints} nokta${rangeLabel ? ` · ${rangeLabel}` : ''}`, 'ok');
      setHistoryCacheEntry(state.scada.history24hCache, cacheKey, { fetchedAt: nowMs, data, wasTruncated, source, metricList }, nowMs);
      let extraConfig = null;
      if (entityType === 'hat') {
        const voltageFetchPromise = fetchHatVoltageHistory(entity, range, strategy).catch(() => ({ series: [], nominal: true }));
        extraConfig = { voltageFetchPromise };
      }
      _renderHistoryData(data, entityType, entity, entityKey, wasTruncated, source, strategy, metricList, extraConfig);
    } catch (err) {
      _renderHistoryError(entityKey, err?.message || 'Hata olustu', { mIds: requestedMeasurementIds, count: 0, source });
    }
  }

function _renderHistoryData(data, entityType, entity, entityKey, wasTruncated, source, strategy, metricList, extraConfig) {
    const body = document.getElementById('scadaChartModalBody');
    if (!body) return;
    const displaySeries = (data.series || []).slice(0, 6);
    const startFmt = data.minTime ? _formatHistoryAxisLabel(data.minTime) : '-';
    const endFmt = data.maxTime ? _formatHistoryAxisLabel(data.maxTime) : '-';
    const allIds = [...new Set(displaySeries.map((series) => series.measurementId))];
    let html = `
      <div class="scada-history-chart-frame" id="scadaHistoryChartFrame">
        <div class="scada-history-chart-legend" id="scadaHistoryLegend"></div>
        <div class="scada-history-chart-canvas" id="scadaHistoryChartCanvas"></div>
        <div class="scada-chart-tooltip" id="scadaChartTooltip" hidden></div>
      </div>
      <div class="scada-history-meta">
        <div><strong>Olcum ID:</strong> ${escapeHtml(allIds.join(', ') || '-')}</div>
        <div><strong>Satir:</strong> ${data.rows.length}</div>
        <div><strong>Zaman:</strong> ${escapeHtml(`${startFmt} - ${endFmt}`)}</div>
        <div><strong>Kaynak:</strong> ${escapeHtml(source || '-')}</div>
      </div>
    `;
    if (wasTruncated) {
      html += '<div class="scada-chart-warning">Veri satir sinirina ulasti; grafik eksik olabilir.</div>';
    }
    body.innerHTML = html;

    const mountConfig = { series: displaySeries, entityType, entity, strategy };
    const voltageFetchPromise = extraConfig?.voltageFetchPromise || null;

    if (entityType === 'hat' && voltageFetchPromise) {
      // Phase 1: mount with empty voltage data (current/voltage panes show loading)
      mountConfig._voltageFetchData = { series: [], nominal: true };
      mountInteractiveHistoryChart(
        document.getElementById('scadaHistoryChartCanvas'),
        document.getElementById('scadaHistoryLegend'),
        document.getElementById('scadaChartTooltip'),
        mountConfig
      );
      // Phase 2: voltage arrives, re-mount with full data
      voltageFetchPromise.then((voltageResult) => {
        // Only update if this chart modal is still open
        const currentCanvas = document.getElementById('scadaHistoryChartCanvas');
        if (!currentCanvas || !currentCanvas.isConnected) return;
        mountConfig._voltageFetchData = voltageResult || { series: [], nominal: true };
        mountInteractiveHistoryChart(
          document.getElementById('scadaHistoryChartCanvas'),
          document.getElementById('scadaHistoryLegend'),
          document.getElementById('scadaChartTooltip'),
          mountConfig
        );
      });
    } else {
      mountInteractiveHistoryChart(
        document.getElementById('scadaHistoryChartCanvas'),
        document.getElementById('scadaHistoryLegend'),
        document.getElementById('scadaChartTooltip'),
        mountConfig
      );
    }
  }

  function _renderHistoryError(entityKey, reason = 'Veri alınamadı', debugInfo = null) {
    const body = document.getElementById('scadaChartModalBody');
    if (!body) return;
    let html = `<div class="scada-chart-empty">Grafik için yeterli geçmiş veri yok.<br><span style="font-size:11px; opacity:0.8;">${escapeHtml(reason)}</span><br><br><button id="btnRetryScadaHistory">Yenile</button></div>`;

    if (debugInfo) {
       html += `
         <div style="font-size: 11px; color: var(--muted); padding: 8px; border-top: 1px solid var(--border-color); margin-top: 12px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div><strong>Ölçüm ID:</strong> ${escapeHtml(debugInfo.mIds ? debugInfo.mIds.join(', ') : '-')}</div>
            <div><strong>Satır:</strong> ${debugInfo.count}</div>
            <div><strong>Kaynak:</strong> ${escapeHtml(debugInfo.source)}</div>
         </div>
       `;
    }

    body.innerHTML = html;
    const retryBtn = document.getElementById('btnRetryScadaHistory');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
         window._scadaBypassCacheFor = entityKey;
         openScada24hHistory(entityKey);
      });
    }
  }

function _formatHistoryAxisLabel(timestampMs) {
    if (typeof SCADA_COMMON !== 'undefined' && SCADA_COMMON.formatHistoryAxisLabel) {
      return SCADA_COMMON.formatHistoryAxisLabel(timestampMs);
    }
    const date = new Date(Number(timestampMs));
    if (Number.isNaN(date.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // Produces b1(b2)>>b3 label from SCADA series terminals.
  function formatScadaTerminalLabel(series) {
    const b1 = String(series?.terminals?.[0] || '').trim();
    const b2 = String(series?.terminals?.[1] || '').trim();
    const b3 = String(series?.terminals?.[2] || '').trim();
    if (b1 && b2 && b3) return `${b1}(${b2})>>${b3}`;
    if (b1 && b3) return `${b1}>>${b3}`;
    if (b1 && b2) return `${b1}(${b2})`;
    if (b1) return b1;
    return series?.label || 'Olcum';
  }

  function buildCanonicalHatHistoryLabel(series, entity) {
    const b1 = String(series?.terminals?.[0] || '').trim();
    const b2 = String(series?.terminals?.[1] || '').trim();
    const b3 = String(series?.terminals?.[2] || '').trim();

    if (b1 && b2 && b3) return `${b1}(${b2})>>${b3}`;

    const nominalKv = Number(entity?.kv || entity?.primaryKv || 0) || '';
    const startTm = String(entity?.startTm || '').trim();
    const endTm = String(entity?.endTm || '').trim();

    if (series?.terminalSide === 'start' && startTm && endTm) {
       return `${startTm}(${nominalKv})>>${endTm}`;
    }
    if (series?.terminalSide === 'end' && startTm && endTm) {
       return `${endTm}(${nominalKv})>>${startTm}`;
    }

    if (b1 && b3) return `${b1}>>${b3}`;
    if (b1 && b2) return `${b1}(${b2})`;
    if (b1) return b1;
    return series?.label || 'Olcum';
  }

  function resolveTerminalSide(series, entity) {
    if (!series || !entity) return 'unknown';
    const b1 = String(series.terminals?.[0] || '').trim().toLowerCase();
    const b3 = String(series.terminals?.[2] || '').trim().toLowerCase();
    const startTm = String(entity.startTm || '').trim().toLowerCase();
    const endTm = String(entity.endTm || '').trim().toLowerCase();

    if (b1 && startTm && b1 === startTm) return 'start';
    if (b1 && endTm && b1 === endTm) return 'end';
    if (b3 && startTm && b3 === startTm) return 'end'; // Inverse relationship
    if (b3 && endTm && b3 === endTm) return 'start'; // Inverse relationship
    return 'unknown';
  }

  function transformReactiveSeries(rawReactiveSeries, isHatFivePane) {
    return isHatFivePane
      ? rawReactiveSeries.map((series) => {
        if (series.terminalSide === 'end') {
          return {
            ...series,
            _displayLabel: `Bit. -Q`,
            points: series.points.map((pt) => ({ ...pt, value: -pt.value, _rawValue: pt.value }))
          };
        } else if (series.terminalSide === 'start') {
          return { ...series, _displayLabel: `Bas. +Q` };
        }
        return { ...series, _displayLabel: `+Q` };
      })
      : rawReactiveSeries;
  }

  // Returns both summer and winter capacity without season selection.
  function getSeasonalCapacityMva(entityType, entity) {
    if (entityType === 'hat') {
      const winter = Number(entity?.winterCapacityMva || 0);
      const summer = Number(entity?.summerCapacityMva || 0);
      return {
        summer: Number.isFinite(summer) && summer > 0 ? summer : null,
        winter: Number.isFinite(winter) && winter > 0 ? winter : null
      };
    }
    return { summer: null, winter: null };
  }

  // Derives current limit lines from MVA capacity and nominal kV.
  function buildHatCurrentLimitLines(seasonalMva, nominalKv) {
    const kv = Number(nominalKv);
    if (!Number.isFinite(kv) || kv <= 0) return [];
    const sqrt3 = Math.sqrt(3);
    const lines = [];
    if (seasonalMva.summer != null) {
      const iSummer = (1000 * seasonalMva.summer) / (sqrt3 * kv);
      lines.push({ refKey: 'i-summer', value: iSummer, label: `${iSummer.toFixed(0)} A yaz limit`, enabled: true });
    }
    if (seasonalMva.winter != null) {
      const iWinter = (1000 * seasonalMva.winter) / (sqrt3 * kv);
      lines.push({ refKey: 'i-winter', value: iWinter, label: `${iWinter.toFixed(0)} A kis limit`, enabled: true });
    }
    return lines;
  }

  // Finds bara entities matching the hat's start and end TMs.
  function resolveHatTerminalVoltageBara(entity) {
    const baras = Array.isArray(state.network?.baraNodes) ? state.network.baraNodes : [];
    const hatKv = String(entity?.kv || entity?.primaryKv || '').trim();
    const findBara = (tmName, explicitBaraId) => {
      if (explicitBaraId) {
        const exact = baras.find(b => String(b.id) === String(explicitBaraId));
        if (exact) return { bara: exact, quality: 'exact' };
      }
      if (!tmName) return { bara: null, quality: 'none' };
      const tm = String(tmName).trim();
      const matches = baras.filter((b) => String(b.tmName || '').trim() === tm && String(b.kvBucket || b.gerilimKv || '') === hatKv);
      if (matches.length === 1) return { bara: matches[0], quality: 'tm-kv' };
      if (matches.length > 1 && typeof SCADA_COMMON !== 'undefined' && SCADA_COMMON.resolveHistoryMetricsByEntity) {
          const withMeasurement = matches.filter(b => {
              const m = SCADA_COMMON.resolveHistoryMetricsByEntity('bara', b);
              return m?.voltage?.measurementIds?.length > 0;
          });
          if (withMeasurement.length === 1) {
              return { bara: withMeasurement[0], quality: 'tm-kv' };
          }
      }
      return { bara: null, quality: 'none' };
    };
    return {
      startMatch: findBara(entity?.startTm, entity?.startBaraId || entity?.startNodeId),
      endMatch: findBara(entity?.endTm, entity?.endBaraId || entity?.endNodeId)
    };
  }

  // Fetches terminal voltage history for hat from bara measurement IDs.
  // Returns { series, nominal } where nominal=true means no real data.
  async function fetchHatVoltageHistory(entity, range, strategy) {
    if (typeof SCADA_COMMON === 'undefined' || !SCADA_COMMON.resolveHistoryMetricsByEntity) {
      return { series: [], nominal: true };
    }
    const { startMatch, endMatch } = resolveHatTerminalVoltageBara(entity);
    const voltageMetrics = [];
    if (startMatch && startMatch.bara) {
      const m = SCADA_COMMON.resolveHistoryMetricsByEntity('bara', startMatch.bara);
      if (m?.voltage?.measurementIds?.length) {
        voltageMetrics.push({ side: 'start', bara: startMatch.bara, metric: m.voltage, quality: startMatch.quality });
      }
    }
    if (endMatch && endMatch.bara) {
      const m = SCADA_COMMON.resolveHistoryMetricsByEntity('bara', endMatch.bara);
      if (m?.voltage?.measurementIds?.length) {
        voltageMetrics.push({ side: 'end', bara: endMatch.bara, metric: m.voltage, quality: endMatch.quality });
      }
    }
    if (!voltageMetrics.length) return { series: [], nominal: true };
    const allIds = [...new Set(voltageMetrics.flatMap((v) => v.metric.measurementIds))].sort();

    if (!state.scada.hatVoltageHistoryCache) state.scada.hatVoltageHistoryCache = new Map();
    if (!state.scada.hatVoltageHistoryPromises) state.scada.hatVoltageHistoryPromises = new Map();

    const startIds = voltageMetrics.filter(v => v.side === 'start').flatMap(v => v.metric.measurementIds).sort().join(',');
    const endIds = voltageMetrics.filter(v => v.side === 'end').flatMap(v => v.metric.measurementIds).sort().join(',');
    const cacheKey = `hv|${entity.id || ''}|start:${startIds}|end:${endIds}|${range.startMs}|${range.endMs}|${strategy.queryMode}|${strategy.timeGrain}`;
    const nowMs = Date.now();

    const cached = getHistoryCacheEntry(state.scada.hatVoltageHistoryCache, cacheKey, nowMs);
    if (cached) {
      return { series: cached.series, nominal: false, fromCache: true };
    }

    const inFlight = state.scada.hatVoltageHistoryPromises.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = (async () => {
      const diag = {
        start: { baraMatch: startMatch, measurementIds: startIds.split(',').filter(Boolean) },
        end: { baraMatch: endMatch, measurementIds: endIds.split(',').filter(Boolean) },
        queryMode: strategy.queryMode,
        timeGrain: strategy.timeGrain,
        fromCache: false
      };
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'SCADA_HISTORY_FETCH',
          payload: {
            baseUrl: SCADA_CONFIG.SUPERSET_ORIGIN,
            dashboardId: SCADA_CONFIG.DASHBOARD_ID,
            chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
            datasourceId: SCADA_CONFIG.DATASOURCE_ID,
            elementNames: ['U'],
            measurementIds: allIds,
            queryMode: strategy.queryMode === 'timeseries' ? 'timeseries' : 'raw',
            timeGrain: strategy.timeGrain,
            startTime: range.startMs,
            endTime: range.endMs
          }
        });
        if (!result.ok || !result.data) return { series: [], nominal: true };
        const rows = SCADA_COMMON.findDataArray(result.data) || [];
        const metricList = voltageMetrics.map((v) => v.metric);
        const parsed = parseHistorySeriesByElement(rows, metricList);
        if (entity?.type === 'hat' || entity?.kv) {
           enrichHatHistorySeriesMetadata(parsed.series, entity);
        }
        parsed.series.forEach((s) => {
          const vm = voltageMetrics.find((v) => v.metric.measurementIds.includes(s.measurementId));
          if (vm) {
            s._voltageSide = vm.side;
            s._voltageBaraTm = String(vm.bara?.tmName || '').trim();
            s._voltageBaraKv = String(vm.bara?.gerilimKv || vm.bara?.kvBucket || '').trim();
            if (vm.quality === 'exact') {
               s._voltageQuality = 'Gerçek — terminal/bara eşleşmesi';
            } else if (vm.quality === 'tm-kv') {
               s._voltageQuality = 'Gerçek — TM+kV eşleşmesi';
            } else {
               s._voltageQuality = 'Gerçek — Bilinmeyen Eşleşme';
            }
          }
        });
        if (parsed.series.length > 0) {
           setHistoryCacheEntry(state.scada.hatVoltageHistoryCache, cacheKey, { fetchedAt: Date.now(), series: parsed.series });
        }
        diag.rowsReturned = rows.length;
        diag.parsedSeries = parsed.series.length;
        if (typeof window !== 'undefined') window._lastHatVoltageDiagnostic = diag;
        return { series: parsed.series, nominal: false };
      } catch (err) {
        console.warn('[SCADA_HISTORY] Terminal voltage fetch failed:', err?.message || err);
        diag.error = err?.message;
        if (typeof window !== 'undefined') window._lastHatVoltageDiagnostic = diag;
        return { series: [], nominal: true };
      } finally {
        state.scada.hatVoltageHistoryPromises.delete(cacheKey);
      }
    })();

    state.scada.hatVoltageHistoryPromises.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  function prepareSortedHistoryPoints(points) {
    const byTime = new Map();
    (points || []).forEach((point) => {
      const timeMs = point?.ts instanceof Date ? point.ts.getTime() : Number(point?.ts);
      if (Number.isFinite(timeMs)) byTime.set(timeMs, point);
    });
    return [...byTime.entries()].map(([timeMs, point]) => ({ timeMs, point })).sort((left, right) => left.timeMs - right.timeMs);
  }

  // Binary search with a deterministic earlier-timestamp tie break.
  function findNearestSortedPoint(sortedPoints, targetMs, maxToleranceMs) {
    if (!Array.isArray(sortedPoints) || !sortedPoints.length) return null;
    let low = 0;
    let high = sortedPoints.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (sortedPoints[middle].timeMs < targetMs) low = middle + 1;
      else high = middle;
    }
    const after = sortedPoints[low] || null;
    const before = low > 0 ? sortedPoints[low - 1] : null;
    const beforeDiff = before ? Math.abs(before.timeMs - targetMs) : Infinity;
    const afterDiff = after ? Math.abs(after.timeMs - targetMs) : Infinity;
    const nearest = beforeDiff <= afterDiff ? before : after;
    return nearest && Math.min(beforeDiff, afterDiff) <= maxToleranceMs ? nearest.point : null;
  }

  // Compatibility wrapper used by existing callers and test hooks.
  function _nearestVoltageValue(vByTime, targetMs, maxToleranceMs) {
    if (vByTime instanceof Map) {
      return findNearestSortedPoint(
        [...vByTime.entries()].map(([timeMs, point]) => ({ timeMs: Number(timeMs), point })).sort((left, right) => left.timeMs - right.timeMs),
        targetMs,
        maxToleranceMs
      );
    }
    return findNearestSortedPoint(vByTime, targetMs, maxToleranceMs);
  }

  // Builds current series I = 1000*S / (sqrt3*V) from P/Q pairs and voltage.
  function buildHatCurrentSeries(chartSeries, voltageSeriesData, entity, strategy) {
    const sqrt3 = Math.sqrt(3);
    const nominalKv = Number(entity?.kv || entity?.primaryKv || 0) || 0;

    const hatPairs = [];
    chartSeries.forEach((series) => {
      if (!series.pairing || !series.points) return;
      let p = hatPairs.find((x) => x.pairing === series.pairing);
      if (!p) {
        p = { pairing: series.pairing, active: null, reactive: null };
        hatPairs.push(p);
      }
      if (series.elementName === 'P' || series.metricType === 'active') p.active = series;
      if (series.elementName === 'Q' || series.metricType === 'reactive') p.reactive = series;
    });

    const isKnownPair = (p) => p.active && p.reactive && p.active.points?.length > 0 && p.reactive.points?.length > 0 && p.active.terminalSide === p.reactive.terminalSide && p.active.terminalSide !== 'unknown';

    const output = [];
    hatPairs.filter(isKnownPair).forEach((pair) => {
      const side = pair.active.terminalSide;
      const matchedVSeries = (voltageSeriesData || []).find((v) => v._voltageSide === side);
      const reactivePoints = prepareSortedHistoryPoints(pair.reactive.points);
      const voltagePoints = matchedVSeries ? prepareSortedHistoryPoints(matchedVSeries.points) : null;
      const toleranceMs = _getToleranceMs(strategy);

      const points = [];
      let usedNominal = false;
      let actualCount = 0;
      let nominalCount = 0;

      pair.active.points.forEach((actPt) => {
        const tMs = actPt.ts.getTime();
        const reactPt = findNearestSortedPoint(reactivePoints, tMs, toleranceMs);
        if (!reactPt) return;

        const pMw = actPt.value;
        const qMvar = reactPt.value;
        const s = Math.hypot(pMw, qMvar);

        let vKv = 0;
        let bQuality = matchedVSeries?._voltageQuality || 'Nominal fallback';
        if (matchedVSeries) {
          const vPt = findNearestSortedPoint(voltagePoints, tMs, toleranceMs);
          if (vPt) vKv = vPt.value;
        }

        let currentUsedNominal = false;
        if (!Number.isFinite(vKv) || vKv <= 0) {
          vKv = nominalKv;
          usedNominal = true;
          currentUsedNominal = true;
          bQuality = 'Nominal fallback';
        }
        if (vKv <= 0) return;

        if (currentUsedNominal) nominalCount++;
        else actualCount++;

        const iAmpere = (1000 * s) / (sqrt3 * vKv);
        points.push({
          ts: new Date(tMs),
          value: iAmpere,
          _usedVoltageKv: vKv,
          _voltageSource: currentUsedNominal ? 'nominal' : 'actual',
          _baraMatchQuality: bQuality
        });
      });

      const label = buildCanonicalHatHistoryLabel(pair.active, entity);

      const seriesId = `${pair.active.seriesId}_current`;
      const measurementId = pair.active.measurementId;
      output.push({
        seriesId,
        measurementId,
        elementName: 'I',
        metricType: 'current',
        unit: 'A',
        pairing: pair.pairing,
        points,
        terminals: pair.active.terminals || [],
        terminalSide: side,
        label,
        _usedNominalVoltage: usedNominal,
        _actualCount: actualCount,
        _nominalCount: nominalCount,
        _totalCount: actualCount + nominalCount
      });
    });
    return output;
  }

  const HISTORY_SERIES_COLORS = {
    active: '#22c55e',
    reactive: '#ef4444',
    voltage: '#38bdf8',
    capacity: '#a78bfa',
    fallback: '#f59e0b',
    current: '#f97316',
    'hat-voltage': '#06b6d4'
  };

  let activeChartMount = null;

  
  function _getToleranceMs(strategy) {
    if (strategy?.timeGrain === 'PT5M') return 300000;
    if (strategy?.timeGrain === 'PT1M') return 60000;
    return 60000; // RAW or default
  }

  function historyPlotValue(paneMode, value) {
    return paneMode === 'abs' ? Math.abs(value) : value;
  }

  function formatAxisNumber(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return '';
    return numberValue.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  }

  // Pairs P and Q series of the same entity and builds apparent power
  // |S| = sqrt(P^2 + Q^2) at timestamps where both magnitudes are present.
  // MVA capacity is only ever compared against this scale, never the MW axis.
  function buildHistoryCapacitySeries(chartSeries, strategy, entity) {
    const pairs = new Map();
    (chartSeries || []).forEach((series) => {
      const pairing = series?.pairing;
      if (!pairing) return;
      if (series.elementName === 'P' || series.metricType === 'active') {
        if (!pairs.has(pairing)) pairs.set(pairing, {});
        pairs.get(pairing).active = series;
      } else if (series.elementName === 'Q' || series.metricType === 'reactive') {
        if (!pairs.has(pairing)) pairs.set(pairing, {});
        pairs.get(pairing).reactive = series;
      }
    });
    const output = [];
    pairs.forEach((pair, pairing) => {
      if (!pair.active || !pair.reactive) return;

      const isHat = pairing.startsWith('h:');
      if (isHat) {
        if (pair.active.terminalSide !== pair.reactive.terminalSide || pair.active.terminalSide === 'unknown') {
          return;
        }
      }

      let tolerance = 300000;
      if (strategy?.timeGrain === 'PT1M') tolerance = 60000;
      else if (strategy?.timeGrain === 'PT5M') tolerance = 300000;
      
      const reactivePoints = prepareSortedHistoryPoints(pair.reactive.points);
      const points = [];
      
      pair.active.points.forEach((actPt) => {
         const tMs = actPt.ts.getTime();
          const reactVal = findNearestSortedPoint(reactivePoints, tMs, tolerance);
         if (reactVal) {
             points.push({ ts: new Date(tMs), value: Math.hypot(actPt.value, reactVal.value) });
         }
      });

      const seriesId = `s:${pairing}`;
      let label = 'Olcum MVA';
      if (isHat) {
         label = buildCanonicalHatHistoryLabel(pair.active, entity);
      }

      output.push({
        seriesId,
        measurementId: pair.active.measurementId || pairing,
        elementName: 'S',
        metricType: 'capacity',
        unit: 'MVA',
        pairing,
        points,
        label,
        terminalSide: pair.active.terminalSide,
        terminals: pair.active.terminals || []
      });
    });
    return output;
  }

  // Nominal operating band for the voltage Y axis, derived from the bus
  // voltage level. 400 kV buses get 380/420 kV tolerance lines, 154 kV buses
  // 140/170 kV. Other levels get no fixed limits (auto range only).
  function buildVoltageReferenceLines(levelKv) {
    const level = Math.round(Number(levelKv) || 0);
    if (level === 400 || level === 380) {
      return [
        { refKey: 'u380', value: 380, label: '380 kV alt limit', enabled: true },
        { refKey: 'u420', value: 420, label: '420 kV ust limit', enabled: true }
      ];
    }
    if (level === 154 || level === 170) {
      return [
        { refKey: 'u140', value: 140, label: '140 kV alt limit', enabled: true },
        { refKey: 'u170', value: 170, label: '170 kV ust limit', enabled: true }
      ];
    }
    return [];
  }

  // Positive Y axis for voltage: never negative, never forced to 0. The 8%
  // margin (minimum 1 unit) keeps the band readable for flat signals.
  function buildPositiveAxisScale(minValue, maxValue) {
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue > maxValue) return { minY: 0, maxY: 1 };
    const margin = Math.max((maxValue - minValue) * 0.08, 1);
    return { minY: Math.max(0, minValue - margin), maxY: maxValue + margin };
  }

  function buildHistoryCacheKey(elementNames, measurementIds, range, strategy) {
    const sortedElements = (elementNames || []).slice().sort().join(',');
    const sortedIds = (measurementIds || []).slice().sort().join(',');
    const grain = strategy?.timeGrain || (strategy?.queryMode === 'raw' ? 'raw' : '');
    return `history:${sortedElements}|${sortedIds}|${range?.startMs}|${range?.endMs}|${grain || 'raw'}`;
  }

  function resolveHistoryMetricList(entityType, entity) {
    if (typeof SCADA_COMMON === 'undefined' || !SCADA_COMMON.resolveHistoryMetricsByEntity) return [];
    const metrics = SCADA_COMMON.resolveHistoryMetricsByEntity(entityType, entity);
    if (!metrics) return [];
    const list = entityType === 'bara' ? [metrics.voltage] : [metrics.active, metrics.reactive];
    return list.filter((metric) => metric && Array.isArray(metric.measurementIds) && metric.measurementIds.length);
  }

    function buildHatHistoryMeasurementMeta(entity) {
    const meta = new Map();
    if (!entity || !entity.id) return meta;

    const processCandidate = (candidate, defaultSide) => {
      if (!candidate || !candidate.measurementId) return;
      const b1 = String(candidate.b1Name || '').trim();
      const b2 = String(candidate.b2Name || '').trim();
      const b3 = String(candidate.b3Name || '').trim();
      let terminalSide = defaultSide;
      if (candidate.terminalSide) terminalSide = candidate.terminalSide;
      if (!terminalSide || terminalSide === 'unknown') {
         if (b1) {
            const b1Lower = b1.toLowerCase();
            const startTm = String(entity.startTm || '').trim().toLowerCase();
            const endTm = String(entity.endTm || '').trim().toLowerCase();
            if (startTm && b1Lower === startTm) terminalSide = 'start';
            else if (endTm && b1Lower === endTm) terminalSide = 'end';
         }
      }
      
      let label = 'Olcum';
      if (b1 && b3) label = b2 ? `${b1}(${b2})>>${b3}` : `${b1}>>${b3}`;
      else if (b1 && b2) label = `${b1}(${b2})`;
      else if (b1) label = b1;

      meta.set(String(candidate.measurementId), {
        terminalSide,
        b1, b2, b3,
        label,
        candidateSlot: candidate.candidateSlot || 'primary',
        source: 'entity.scada'
      });
    };

    if (entity.scada?.active?.rows) {
      entity.scada.active.rows.forEach(r => processCandidate(r, 'unknown'));
    }
    if (entity.scada?.reactive?.rows) {
      entity.scada.reactive.rows.forEach(r => processCandidate(r, 'unknown'));
    }

    if (typeof state !== 'undefined' && state.scada?.measurementRowsById) {
       for (const [key, candidate] of state.scada.measurementRowsById.entries()) {
           if (candidate && candidate.hatId === entity.id) {
               if (!meta.has(String(candidate.measurementId))) {
                   processCandidate(candidate, 'unknown');
               }
           }
       }
    }

    return meta;
  }

  function enrichHatHistorySeriesMetadata(seriesList, entity) {
    if (!seriesList || !entity) return;
    const meta = buildHatHistoryMeasurementMeta(entity);
    seriesList.forEach(s => {
      const m = meta.get(String(s.measurementId));
      if (m) {
        s.terminalSide = m.terminalSide;
        s.terminals = [m.b1, m.b2, m.b3];
        s.candidateSlot = m.candidateSlot;
        if (!s.terminalSide || s.terminalSide === 'unknown') {
           s.terminalSide = resolveTerminalSide(s, entity);
        }
        if (!s.label || s.label.startsWith('Olcum') || s.label.startsWith('Bas.') || s.label.startsWith('Bit.')) {
           s.label = buildCanonicalHatHistoryLabel(s, entity);
        }
      }
    });
  }

  function parseHistorySeriesByElement(rows, metricList) {
    const requestedKeys = new Set();
    const keyToMetric = new Map();
    (metricList || []).forEach((metric) => {
      (metric.measurementIds || []).forEach((measurementId) => {
        const key = SCADA_COMMON.historySeriesId(measurementId, metric.elementName);
        requestedKeys.add(key);
        keyToMetric.set(key, metric);
      });
    });
    const byKey = new Map();
    const firstRows = new Map();
    let missingMid = 0;
    let missingElement = 0;
    let nonRequested = 0;
    let missingValue = 0;
    let invalidTimestamp = 0;
    const candidateTimeKeys = ['__timestamp', '__time', 'MAX(__time)', 'maxTime', 'timestamp', 'datetime', 'dt', 'time'];
    const candidateValueKeys = ['maxValue', 'AVG(maxValue)', 'avgMaxValue', 'value', 'val'];
    const schemaRow = rows.length ? rows[0] : null;
    const seenTimeKeys = schemaRow ? candidateTimeKeys.filter((key) => key in schemaRow) : [];
    const seenValueKey = schemaRow ? candidateValueKeys.find((key) => key in schemaRow) || null : null;
    const knownElements = [...new Set((metricList || []).map((metric) => metric.elementName))];

    let minTime = Infinity;
    let maxTime = -Infinity;
    for (const row of rows) {
      const measurementId = SCADA_COMMON.resolveHistoryMeasurementId(row);
      if (!measurementId) {
        missingMid += 1;
        continue;
      }
      const elementName = String(row?.elementName ?? row?.el_x ?? '').trim();
      let key = SCADA_COMMON.historySeriesId(measurementId, elementName);
      if (!requestedKeys.has(key)) {
        if (elementName) {
          nonRequested += 1;
          continue;
        }
        const matchedElement = knownElements.find((name) => (
          requestedKeys.has(SCADA_COMMON.historySeriesId(measurementId, name))
        ));
        if (!matchedElement) {
          missingElement += 1;
          continue;
        }
        key = SCADA_COMMON.historySeriesId(measurementId, matchedElement);
      }
      const value = SCADA_COMMON.resolveHistoryValue(row);
      if (value === null) {
        missingValue += 1;
        continue;
      }
      const timestamp = SCADA_COMMON.resolveHistoryTimestamp(row);
      if (!timestamp) {
        invalidTimestamp += 1;
        continue;
      }
      const timeMs = timestamp.getTime();
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ ts: timestamp, value, measurementId });
      if (!firstRows.has(key)) firstRows.set(key, row);
      if (timeMs < minTime) minTime = timeMs;
      if (timeMs > maxTime) maxTime = timeMs;
    }

    let maxPoints = 0;
    const series = [];
    byKey.forEach((points, key) => {
      points.sort((a, b) => a.ts - b.ts);
      const metric = keyToMetric.get(key) || null;
      const uniqueTimes = new Set(points.map((point) => point.ts.getTime())).size;
      if (uniqueTimes > maxPoints) maxPoints = uniqueTimes;
      const firstRow = firstRows.get(key) || null;
      const elementName = metric?.elementName || String(key).split('|')[1] || '';
      const measurementId = String(key).split('|')[0];
      series.push({
        seriesId: key,
        measurementId,
        elementName,
        metricType: metric?.metricType || (elementName === 'Q' ? 'reactive' : elementName === 'U' ? 'voltage' : 'active'),
        unit: metric?.unit || (elementName === 'Q' ? 'MVar' : elementName === 'U' ? 'kV' : 'MW'),
        points,
        terminals: [String(firstRow?.b1Name || ''), String(firstRow?.b2Name || ''), String(firstRow?.b3Name || '')],
        firstRow: firstRow || null
      });
    });

    return {
      series,
      maxPoints,
      minTime: minTime === Infinity ? null : minTime,
      maxTime: maxTime === -Infinity ? null : maxTime,
      stats: { total: rows.length, missingMid, missingElement, nonRequested, missingValue, invalidTimestamp },
      seenTimeKeys,
      seenValueKey
    };
  }

  function buildHistoryEmptyReason(data, elementNames, requestedIds) {
    let reason = 'Superset 0 satir dondurdu.';
    const stats = data?.stats || {};
    const parsed = stats.total - (stats.missingMid || 0) - (stats.missingElement || 0) - (stats.nonRequested || 0) - (stats.missingValue || 0) - (stats.invalidTimestamp || 0);
    if (data?.rows?.length > 0 && stats.missingMid > 0 && parsed === 0) {
      reason = `Yanitin ${stats.missingMid} satirinda olcum ID alani bulunamadi.`;
    } else if (data?.rows?.length > 0 && stats.invalidTimestamp > 0 && stats.missingValue === 0 && parsed === 0) {
      reason = `${data.rows.length} satir geldi ancak zaman alani cozulemedi (zaman anahtari: ${data.seenTimeKeys.join(', ') || '-'}, deger anahtari: ${data.seenValueKey || '-'}).`;
    } else if (data?.rows?.length > 0 && stats.missingValue > 0 && parsed === 0) {
      reason = `${data.rows.length} satir geldi ancak beklenen deger alani bulunamadi (deger anahtari: ${data.seenValueKey || '-'}).`;
    } else if (data?.rows?.length > 0) {
      reason = `${data.rows.length} satir geldi ancak istenen olcumler icin en az 2 farkli zaman noktasi bulunamadi (eleman: ${elementNames.join(', ') || '-'}, olcum: ${requestedIds.length}).`;
    }
    return reason;
  }

  function _chartSeriesColor(series) {
    return HISTORY_SERIES_COLORS[series?.metricType] || HISTORY_SERIES_COLORS.fallback;
  }

  function _niceChartStep(raw) {
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalized = raw / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  function _nearestPointIndex(points, timeMs) {
    let low = 0;
    let high = points.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (points[mid].ts.getTime() < timeMs) low = mid + 1;
      else high = mid - 1;
    }
    if (low === 0) return 0;
    if (low >= points.length) return points.length - 1;
    const before = points[low - 1].ts.getTime();
    const after = points[low].ts.getTime();
    return (timeMs - before) <= (after - timeMs) ? low - 1 : low;
  }

  function _sampleChartPoints(points, maxCount) {
    const count = points.length;
    if (count <= maxCount) return points;
    const step = Math.ceil(count / maxCount);
    const sampled = [];
    for (let index = 0; index < count; index += step) sampled.push(points[index]);
    return sampled;
  }

  function mountInteractiveHistoryChart(canvasEl, legendEl, tooltipEl, config) {
    if (!canvasEl || !tooltipEl) return;

    if (activeChartMount?.cleanup) {
      activeChartMount.cleanup();
    }

    const mountToken = {};
    const entityType = config?.entityType || 'hat';
    const entity = config?.entity || null;
    const strategy = config?.strategy || null;
    
    canvasEl.replaceChildren();
    if (legendEl) legendEl.replaceChildren();
    tooltipEl.hidden = true;
    tooltipEl.innerHTML = '';
    
    const rawSeries = (config?.series || []).filter((series) => series && Array.isArray(series.points) && series.points.length);
    if (!rawSeries.length) {
      canvasEl.replaceChildren();
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'scada-chart-empty';
      emptyDiv.textContent = 'Grafik icin yeterli gecmis veri yok.';
      canvasEl.appendChild(emptyDiv);
      return;
    }

    const counts = new Map();
    const chartSeries = rawSeries.map((series) => {
      const ts = series.terminalSide || 'unknown';
      const groupKey = entityType === 'trafo'
        ? `t:${series.elementName}`
        : (entityType === 'hat' ? `h:${ts}${series.candidateSlot && series.candidateSlot !== 'primary' ? '-' + series.candidateSlot : ''}` : 'b:u');
      const index = (counts.get(groupKey) || 0) + 1;
      counts.set(groupKey, index);
      let label;
      if (entityType === 'bara') {
        label = 'Gerilim';
      } else if (entityType === 'hat') {
        label = buildCanonicalHatHistoryLabel(series, entity);
      } else {
        label = `${series.elementName || 'Olcum'}${index > 1 ? `-${index}` : ''}`;
      }
      if (index > 1 && entityType !== 'trafo') label = `${label} #${index}`;
      const terminalSide = entityType === 'hat' ? (series.terminalSide || resolveTerminalSide(series, entity)) : 'unknown';
      const pairing = entityType === 'hat'
        ? `h:${terminalSide}${series.candidateSlot && series.candidateSlot !== 'primary' ? '-' + series.candidateSlot : ''}`
        : (entityType === 'trafo' ? `t:${index}` : 'b:u');
      return { ...series, label, pairing, terminalSide };
    });

    const isDual = entityType === 'hat' || entityType === 'trafo';
    const isHatFivePane = entityType === 'hat';
    const width = 920;
    const padL = 66;
    const padR = 22;
    const padT = 16;
    const padB = 34;
    const paneGap = 16;
    const paneHeight = isHatFivePane ? 180 : 232;

    const panes = [];
    if (isDual) {
      // Pane 1: Aktif guc
      panes.push({
        key: 'active',
        title: 'Aktif guc (MW)',
        unit: 'MW',
        mode: 'abs',
        seriesGroup: chartSeries.filter((series) => series.elementName === 'P' || series.metricType === 'active'),
        refLines: []
      });
      // Pane 2: Reaktif guc — hat icin baslangic +Q, bitis -Q cizim
      const rawReactiveSeries = chartSeries.filter((series) => series.elementName === 'Q' || series.metricType === 'reactive');
      const reactiveSeries = transformReactiveSeries(rawReactiveSeries, isHatFivePane);
      panes.push({
        key: 'reactive',
        title: 'Reaktif guc (MVar)',
        unit: 'MVar',
        mode: 'signed-zero',
        seriesGroup: reactiveSeries,
        refLines: []
      });
      // Pane 3: MVA — yaz/kis ayri limit cizgileri (hat), tek limit (trafo)
      const sSeries = buildHistoryCapacitySeries(chartSeries, strategy, entity);
      if (true) {
        const mvaRefLines = [];
        if (isHatFivePane) {
          const seasonal = getSeasonalCapacityMva(entityType, entity);
          if (seasonal.summer != null) {
            mvaRefLines.push({ refKey: 'mva-summer', value: seasonal.summer,
              label: `${seasonal.summer.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MVA yaz`, enabled: true });
          }
          if (seasonal.winter != null) {
            mvaRefLines.push({ refKey: 'mva-winter', value: seasonal.winter,
              label: `${seasonal.winter.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MVA kis`, enabled: true });
          }
          if (!mvaRefLines.length) {
            const capacity = getCapacityMva(entityType, entity);
            if (Number.isFinite(capacity) && capacity > 0) {
              mvaRefLines.push({ value: capacity, label: `${capacity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MVA kapasite` });
            }
          }
        } else {
          const capacity = getCapacityMva(entityType, entity);
          if (Number.isFinite(capacity) && capacity > 0) {
            mvaRefLines.push({ value: capacity, label: `${capacity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MVA kapasite` });
          }
        }
        panes.push({
          key: 'capacity',
          title: 'Gorunen guc (|S| MVA)',
          unit: 'MVA',
          mode: 'abs',
          seriesGroup: sSeries,
          refLines: mvaRefLines,
          emptyText: 'Gorunur guc hesaplanamadi'
        });
      }
      // Pane 4 & 5: Hat only — Akim (A) and Gerilim (kV)
      if (isHatFivePane) {
        const nominalKv = Number(entity?.kv || entity?.primaryKv || 0) || 0;
        const seasonal = getSeasonalCapacityMva(entityType, entity);
        const voltageFetchData = config?._voltageFetchData || null;
        const voltageSeriesData = voltageFetchData?.series || [];
        // Pane 4: Akim (A)
        const currentSeries = buildHatCurrentSeries(chartSeries, voltageSeriesData, entity, strategy);
        const currentLimitLines = buildHatCurrentLimitLines(seasonal, nominalKv);
        
        let totalActual = 0;
        let totalNominal = 0;
        currentSeries.forEach((s) => {
           totalActual += (s._actualCount || 0);
           totalNominal += (s._nominalCount || 0);
        });
        const totalPoints = totalActual + totalNominal;

        let currentTitle = 'Akim (A)';
        if (totalPoints > 0) {
           if (totalNominal === 0) {
              currentTitle = 'Akim (A) — gercek terminal gerilimi';
           } else if (totalActual === 0) {
              currentTitle = `Akim (A) — tahmini, nominal ${nominalKv} kV`;
           } else {
              currentTitle = `Akim (A) — karma gerilim kaynagi (Gercek U ${totalActual} / ${totalPoints} • Nominal fallback ${totalNominal} / ${totalPoints})`;
           }
        }

        panes.push({
          key: 'current',
          title: currentTitle,
          unit: 'A',
          mode: 'abs',
          seriesGroup: currentSeries,
          refLines: currentLimitLines,
          emptyText: 'Akim hesaplanamadi'
        });
        // Pane 5: Gerilim (kV)
        const hatVoltageSeries = voltageSeriesData.map((vs) => {
          const sideLabel = buildCanonicalHatHistoryLabel(vs, entity);
          return {
            ...vs,
            seriesId: `hv:${vs.seriesId || vs.measurementId}`,
            metricType: 'hat-voltage',
            label: sideLabel,
            unit: 'kV'
          };
        });
        if (true) {
          panes.push({
            key: 'hat-voltage',
            title: 'Gerilim (kV)',
            unit: 'kV',
            mode: 'positive',
            seriesGroup: hatVoltageSeries,
            refLines: [],
            emptyText: 'Gerilim verisi yok'
          });
        } else {
          panes.push({
            key: 'hat-voltage',
            title: 'Gerilim (kV) — veri yok',
            unit: 'kV',
            mode: 'positive',
            seriesGroup: [],
            refLines: []
          });
        }
      }
    } else {
      panes.push({
        key: 'voltage',
        title: 'Gerilim (kV)',
        unit: 'kV',
        mode: 'positive',
        seriesGroup: chartSeries,
        refLines: []
      });
      const nominal = Number(entity?.gerilimKv || entity?.kvBucket || 0);
      if (Number.isFinite(nominal) && nominal > 0) {
        panes[0].refLines.push({
          refKey: 'u-nominal',
          value: nominal,
          label: `${nominal} kV nominal`,
          enabled: true
        });
      }
      buildVoltageReferenceLines(nominal).forEach((ref) => panes[0].refLines.push(ref));
    }

    const totalHeight = padT + paneHeight * panes.length + paneGap * (panes.length ? panes.length - 1 : 0) + padB;

    const allTimes = chartSeries.flatMap((series) => series.points.map((point) => point.ts.getTime()));
    const fullStartMs = Math.min(...allTimes);
    const fullEndMs = Math.max(...allTimes);
    let viewStartMs = fullStartMs;
    let viewEndMs = fullEndMs;
    const hidden = new Set();
    let hoverTimeMs = null;
    let dragging = false;
    let dragStartClientX = 0;
    let dragStartViewMs = 0;
    let redrawQueued = false;

    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${totalHeight}`);
    svg.setAttribute('xmlns', svgNamespace);
    svg.setAttribute('aria-label', 'scada-gecmis-grafigi');
    svg.style.cursor = 'crosshair';
    canvasEl.appendChild(svg);

    const svgDocumentFragment = document.createDocumentFragment();

    function viewSpanMs() {
      return Math.max(1, viewEndMs - viewStartMs);
    }

    function timeToX(timeMs) {
      return padL + ((timeMs - viewStartMs) / viewSpanMs()) * (width - padL - padR);
    }

    function buildPaneYScale(pane) {
      const visibleSeries = pane.seriesGroup.filter((series) => !hidden.has(series.seriesId));
      const enabledRefs = (pane.refLines || []).filter((ref) => ref.enabled !== false && Number.isFinite(ref.value));
      if (pane.mode === 'positive') {
        // Voltage: auto-range from the visible values plus enabled reference
        // lines. Never clamped to 0, never negative; disabled refs are
        // excluded from both drawing and scaling.
        let minValue = Infinity;
        let maxValue = -Infinity;
        visibleSeries.forEach((series) => {
          for (const point of series.points) {
            if (point.ts.getTime() < viewStartMs || point.ts.getTime() > viewEndMs) continue;
            if (!Number.isFinite(point.value)) continue;
            if (point.value < minValue) minValue = point.value;
            if (point.value > maxValue) maxValue = point.value;
          }
        });
        enabledRefs.forEach((ref) => {
          if (ref.value < minValue) minValue = ref.value;
          if (ref.value > maxValue) maxValue = ref.value;
        });
        if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue > maxValue) return { minY: 0, maxY: 1 };
        return buildPositiveAxisScale(minValue, maxValue);
      }
      let maxAbs = 1;
      visibleSeries.forEach((series) => {
        for (const point of series.points) {
          if (point.ts.getTime() < viewStartMs || point.ts.getTime() > viewEndMs) continue;
          if (!Number.isFinite(point.value)) continue;
          const magnitude = Math.abs(point.value);
          if (magnitude > maxAbs) maxAbs = magnitude;
        }
      });
      enabledRefs.forEach((ref) => {
        if (Math.abs(ref.value) > maxAbs) maxAbs = Math.abs(ref.value);
      });
      maxAbs *= 1.12;
      if (pane.mode === 'abs') return { minY: 0, maxY: maxAbs };
      return { minY: -maxAbs, maxY: maxAbs };
    }

    function drawPane(pane, index) {
      const group = document.createElementNS(svgNamespace, 'g');
      const paneTop = padT + index * (paneHeight + paneGap);
      const paneBottom = paneTop + paneHeight;
      const plotTop = paneTop + 20;
      const plotBottom = paneBottom - 18;
      const plotLeft = padL;
      const plotRight = width - padR;
      const plotWidth = plotRight - plotLeft;
      const plotHeight = plotBottom - plotTop;
      const scale = buildPaneYScale(pane);
      const ySpan = scale.maxY - scale.minY || 1;
      const toY = (value) => plotTop + ((scale.maxY - value) / ySpan) * plotHeight;

      const paneTitle = document.createElementNS(svgNamespace, 'text');
      paneTitle.setAttribute('x', plotLeft);
      paneTitle.setAttribute('y', paneTop + 8);
      paneTitle.setAttribute('fill', 'var(--muted)');
      paneTitle.setAttribute('font-size', '12');
      paneTitle.setAttribute('font-weight', '600');
      paneTitle.textContent = pane.title;
      group.appendChild(paneTitle);

      const gridColor = 'var(--chart-grid)';
      const mutedColor = 'var(--muted)';

      for (let tick = 0; tick <= 4; tick += 1) {
        const value = scale.minY + (ySpan * tick) / 4;
        const y = toY(value);
        const lineEl = document.createElementNS(svgNamespace, 'line');
        lineEl.setAttribute('x1', plotLeft);
        lineEl.setAttribute('y1', y);
        lineEl.setAttribute('x2', plotRight);
        lineEl.setAttribute('y2', y);
        lineEl.setAttribute('stroke', gridColor);
        lineEl.setAttribute('stroke-width', value === 0 ? 1.4 : 0.6);
        group.appendChild(lineEl);
        const labelEl = document.createElementNS(svgNamespace, 'text');
        labelEl.setAttribute('x', plotLeft - 8);
        labelEl.setAttribute('y', y + 4);
        labelEl.setAttribute('fill', mutedColor);
        labelEl.setAttribute('font-size', '10');
        labelEl.setAttribute('text-anchor', 'end');
        labelEl.textContent = `${formatAxisNumber(value)} ${pane.unit}`;
        group.appendChild(labelEl);
      }

      const xStep = _niceChartStep(viewSpanMs() / 5);
      const firstTickTime = Math.floor(viewStartMs / xStep) * xStep;
      for (let tickMs = firstTickTime; tickMs <= viewEndMs; tickMs += xStep) {
        const x = timeToX(tickMs);
        const lineEl = document.createElementNS(svgNamespace, 'line');
        lineEl.setAttribute('x1', x);
        lineEl.setAttribute('y1', plotTop);
        lineEl.setAttribute('x2', x);
        lineEl.setAttribute('y2', plotBottom);
        lineEl.setAttribute('stroke', gridColor);
        lineEl.setAttribute('stroke-width', 0.6);
        lineEl.setAttribute('stroke-dasharray', '3 4');
        group.appendChild(lineEl);
        if (index === panes.length - 1) {
          const labelEl = document.createElementNS(svgNamespace, 'text');
          labelEl.setAttribute('x', x);
          labelEl.setAttribute('y', totalHeight - 10);
          labelEl.setAttribute('fill', mutedColor);
          labelEl.setAttribute('font-size', '10');
          labelEl.setAttribute('text-anchor', 'middle');
          labelEl.textContent = _formatHistoryAxisLabel(tickMs);
          group.appendChild(labelEl);
        }
      }

      if (pane.mode === 'signed-zero' && scale.minY < 0 && scale.maxY > 0) {
        const zeroY = toY(0);
        const zeroEl = document.createElementNS(svgNamespace, 'line');
        zeroEl.setAttribute('x1', plotLeft);
        zeroEl.setAttribute('y1', zeroY);
        zeroEl.setAttribute('x2', plotRight);
        zeroEl.setAttribute('y2', zeroY);
        zeroEl.setAttribute('stroke', 'var(--muted)');
        zeroEl.setAttribute('stroke-width', '1.2');
        zeroEl.setAttribute('stroke-dasharray', '2 3');
        group.appendChild(zeroEl);
      }

      pane.refLines.forEach((ref) => {
        if (ref.enabled === false) return;
        if (!Number.isFinite(ref.value)) return;
        const y = Math.max(plotTop, Math.min(plotBottom, toY(ref.value)));
        const refEl = document.createElementNS(svgNamespace, 'line');
        refEl.setAttribute('x1', plotLeft);
        refEl.setAttribute('y1', y);
        refEl.setAttribute('x2', plotRight);
        refEl.setAttribute('y2', y);
        refEl.setAttribute('stroke', '#38bdf8');
        refEl.setAttribute('stroke-width', '1.4');
        refEl.setAttribute('stroke-dasharray', '8 4');
        group.appendChild(refEl);
        const refLabel = document.createElementNS(svgNamespace, 'text');
        refLabel.setAttribute('x', plotRight - 4);
        refLabel.setAttribute('y', y - 5);
        refLabel.setAttribute('fill', '#38bdf8');
        refLabel.setAttribute('font-size', '10');
        refLabel.setAttribute('text-anchor', 'end');
        refLabel.textContent = ref.label;
        group.appendChild(refLabel);
      });

      const visibleSeries = pane.seriesGroup.filter((series) => !hidden.has(series.seriesId));
      if (!visibleSeries.length) {
        const emptyText = document.createElementNS(svgNamespace, 'text');
        emptyText.setAttribute('x', (plotLeft + plotRight) / 2);
        emptyText.setAttribute('y', (plotTop + plotBottom) / 2);
        emptyText.setAttribute('fill', mutedColor);
        emptyText.setAttribute('font-size', '11');
        emptyText.setAttribute('text-anchor', 'middle');
        emptyText.textContent = `${pane.title} icin veri yok`;
        group.appendChild(emptyText);
        return group;
      }

      visibleSeries.forEach((series, seriesIndex) => {
        const inView = series.points.filter((point) => point.ts.getTime() >= viewStartMs && point.ts.getTime() <= viewEndMs && Number.isFinite(point.value));
        const sampled = _sampleChartPoints(inView, 900);
        if (!sampled.length) return;
        const plotted = sampled.map((point) => {
          const value = historyPlotValue(pane.mode, point.value);
          return `${timeToX(point.ts.getTime()).toFixed(1)},${toY(value).toFixed(1)}`;
        }).join(' ');
        const color = _chartSeriesColor(series);
        const polyline = document.createElementNS(svgNamespace, 'polyline');
        polyline.setAttribute('points', plotted);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', color);
        polyline.setAttribute('stroke-width', seriesIndex > 0 ? '2' : '2.6');
        polyline.setAttribute('stroke-linejoin', 'round');
        polyline.setAttribute('stroke-linecap', 'round');
        polyline.setAttribute('opacity', '0.9');
        polyline.setAttribute('data-series-key', series.seriesId);
        group.appendChild(polyline);
      });

      if (hoverTimeMs != null && hoverTimeMs >= viewStartMs && hoverTimeMs <= viewEndMs) {
        const crossX = timeToX(hoverTimeMs);
        const crossEl = document.createElementNS(svgNamespace, 'line');
        crossEl.setAttribute('x1', crossX);
        crossEl.setAttribute('y1', plotTop);
        crossEl.setAttribute('x2', crossX);
        crossEl.setAttribute('y2', plotBottom);
        crossEl.setAttribute('stroke', 'rgba(148,163,184,0.9)');
        crossEl.setAttribute('stroke-width', '1');
        crossEl.setAttribute('stroke-dasharray', '2 2');
        group.appendChild(crossEl);
        visibleSeries.forEach((series) => {
          if (!series.points.length) return;
          const nearestIndex = _nearestPointIndex(series.points, hoverTimeMs);
          const point = series.points[nearestIndex];
          if (!point || Math.abs(point.ts.getTime() - hoverTimeMs) > viewSpanMs() * 0.05) return;
          const value = historyPlotValue(pane.mode, point.value);
          const dot = document.createElementNS(svgNamespace, 'circle');
          dot.setAttribute('cx', timeToX(point.ts.getTime()));
          dot.setAttribute('cy', toY(value));
          dot.setAttribute('r', '3.5');
          dot.setAttribute('fill', _chartSeriesColor(series));
          dot.setAttribute('stroke', '#0f172a');
          dot.setAttribute('stroke-width', '1');
          group.appendChild(dot);
        });
      }

      return group;
    }

    function redraw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      panes.forEach((pane, index) => {
        const groupEl = drawPane(pane, index);
        if (groupEl) svg.appendChild(groupEl);
      });
    }

    function requestRedraw() {
      if (redrawQueued) return;
      redrawQueued = true;
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          redrawQueued = false;
          redraw();
        });
      } else {
        redrawQueued = false;
        redraw();
      }
    }

    function rebuildLegend() {
      if (!legendEl) return;
      legendEl.innerHTML = '';
      // Collect all series across all panes for the legend
      const allLegendSeries = [];
      panes.forEach((pane) => {
        (pane.seriesGroup || []).forEach((series) => {
          if (!allLegendSeries.some((s) => s.seriesId === series.seriesId)) allLegendSeries.push(series);
        });
      });
      allLegendSeries.forEach((series) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'scada-history-legend-chip' + (hidden.has(series.seriesId) ? ' is-hidden' : '');
        chip.style.setProperty('--scada-series-color', _chartSeriesColor(series));
        chip.dataset.seriesKey = series.seriesId;
        chip.textContent = `${series.label} (${series.unit})`;
        chip.title = `Seriyi goster/gizle: ${series.label}`;
        chip.addEventListener('click', () => {
          if (hidden.has(series.seriesId)) hidden.delete(series.seriesId);
          else hidden.add(series.seriesId);
          rebuildLegend();
          redraw();
        });
        legendEl.appendChild(chip);
      });
      // Ref-line toggles for all panes that have refLines
      const panesWithRefs = panes.filter((pane) => pane.refLines && pane.refLines.length);
      panesWithRefs.forEach((pane) => {
        const separator = document.createElement('span');
        separator.className = 'scada-history-legend-sep';
        separator.textContent = pane.unit + ' Ref:';
        legendEl.appendChild(separator);
        pane.refLines.forEach((ref) => {
          const refChip = document.createElement('button');
          refChip.type = 'button';
          refChip.className = 'scada-history-ref-chip' + (ref.enabled === false ? ' is-off' : '');
          refChip.dataset.refKey = ref.refKey || '';
          refChip.textContent = ref.label;
          refChip.title = `Referans cizgisini goster/gizle: ${ref.label}`;
          refChip.addEventListener('click', () => {
            ref.enabled = ref.enabled === false;
            rebuildLegend();
            redraw();
          });
          legendEl.appendChild(refChip);
        });
      });
    }

    function updateCrosshairFromEvent(event) {
      if (dragging) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const scaleX = width / rect.width;
      const svgX = (event.clientX - rect.left) * scaleX;
      hoverTimeMs = viewStartMs + ((svgX - padL) / (width - padL - padR)) * viewSpanMs();
      hoverTimeMs = Math.max(fullStartMs, Math.min(fullEndMs, hoverTimeMs));
      drawCrosshair();
      updateTooltip(event);
    }

    let lastCrosshairX = null;

    function drawCrosshair() {
      if (hoverTimeMs == null) {
        lastCrosshairX = null;
        return;
      }
      const nextX = Math.round(timeToX(hoverTimeMs));
      if (lastCrosshairX === nextX) return;
      lastCrosshairX = nextX;
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(redraw);
      } else {
        redraw();
      }
    }

    function formatTooltipValue(series, point, fallbackUnit) {
      const displayValue = point._rawValue !== undefined ? point._rawValue : point.value;
      const prefix = displayValue >= 0 ? '+' : '';
      return `${prefix}${formatAxisNumber(displayValue)} ${series.unit || fallbackUnit || ''}`.trim();
    }

    function updateTooltip(event) {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const scaleX = width / rect.width;
      const scaleY = totalHeight / rect.height;

      const svgX = (event.clientX - rect.left) * scaleX;
      const svgY = (event.clientY - rect.top) * scaleY;
      
      if (svgX < padL || svgX > width - padR || svgY < padT || svgY > totalHeight - padB) {
         tooltipEl.hidden = true;
         return;
      }
      
      const hoveredTimeMs = hoverTimeMs;
      if (hoveredTimeMs == null) return;
      
      let activePane = null;
      for (let i = 0; i < panes.length; i++) {
        const paneTop = padT + i * (paneHeight + paneGap);
        const paneBottom = paneTop + paneHeight;
        if (svgY >= paneTop && svgY <= paneBottom) {
          activePane = panes[i];
          break;
        }
      }
      
      const rows = [];
      if (activePane) {
        const seriesToRender = activePane.seriesGroup || [];
        seriesToRender.forEach((series) => {
          if (hidden.has(series.seriesId) || !series.points.length) return;
          const nearestIndex = _nearestPointIndex(series.points, hoveredTimeMs);
          const point = series.points[nearestIndex];
          if (!point) return;
          if (Math.abs(point.ts.getTime() - hoveredTimeMs) > viewSpanMs() * 0.05) return;

          let metaHtml = '';
          if (series.metricType === 'current' && point._voltageSource) {
             const vKv = point._usedVoltageKv ? `${formatAxisNumber(point._usedVoltageKv)} kV` : '-';
             const q = point._baraMatchQuality === 'Nominal fallback' ? 'Nominal fallback' : (point._baraMatchQuality || point._voltageSource);
             metaHtml = `<div style="font-size: 9px; color: var(--muted); padding-left: 14px; margin-top: -2px;">Gerilim: ${vKv}<br>Kaynak: ${q}</div>`;
          }

          let seriesLabel = series._displayLabel || series.label || series.elementName || 'Olcum';
          
          if (entityType === 'hat') {
              seriesLabel = buildCanonicalHatHistoryLabel(series, entity);
          }

          rows.push(`<div><div class="scada-chart-tooltip-row" style="--scada-series-color:${_chartSeriesColor(series)};">
            <span class="scada-chart-tooltip-dot"></span>
            <span>${escapeHtml(seriesLabel)}</span>
            <strong>${escapeHtml(formatTooltipValue(series, point, activePane.unit))}</strong>
          </div>${metaHtml}</div>`);
        });
      }
      
      if (!rows.length) {
        tooltipEl.hidden = true;
        return;
      }
      
      const timeHtml = `<div class="scada-chart-tooltip-title">${escapeHtml(_formatHistoryAxisLabel(hoveredTimeMs))}</div>`;
      tooltipEl.innerHTML = `${timeHtml}${rows.join('')}`;
      tooltipEl.hidden = false;
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.zIndex = '99999';
      
      const host = tooltipEl.offsetParent || canvasEl.parentElement || canvasEl;
      const hostRect = host.getBoundingClientRect();
      
      let left = event.clientX - hostRect.left + 14;
      let top = event.clientY - hostRect.top + 12;
      
      const tooltipWidth = tooltipEl.offsetWidth || 220;
      const clampLeft = Math.max(4, Math.min(hostRect.width - tooltipWidth - 4, left));
      const tooltipHeight = tooltipEl.offsetHeight || 120;
      const clampTop = Math.max(4, Math.min(hostRect.height - tooltipHeight - 4, top));
      tooltipEl.style.left = `${clampLeft}px`;
      tooltipEl.style.top = `${clampTop}px`;
    }

    function clampView() {
      const span = viewEndMs - viewStartMs;
      const fullSpan = fullEndMs - fullStartMs || 1;
      if (span >= fullSpan) {
        viewStartMs = fullStartMs;
        viewEndMs = fullEndMs;
        return;
      }
      if (viewStartMs < fullStartMs) {
        viewStartMs = fullStartMs;
        viewEndMs = viewStartMs + span;
      }
      if (viewEndMs > fullEndMs) {
        viewEndMs = fullEndMs;
        viewStartMs = viewEndMs - span;
      }
    }

    const onWheel = (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const scaleX = width / rect.width;
      const svgX = (event.clientX - rect.left) * scaleX;
      const anchorTime = viewStartMs + ((svgX - padL) / (width - padL - padR)) * viewSpanMs();
      const factor = event.deltaY < 0 ? 1 / 1.15 : 1.15;
      const minSpan = Math.min(2 * 60 * 1000, fullEndMs - fullStartMs);
      const newSpan = Math.min(fullEndMs - fullStartMs || 1, Math.max(minSpan, viewSpanMs() * factor));
      const ratio = (anchorTime - viewStartMs) / viewSpanMs();
      viewStartMs = anchorTime - ratio * newSpan;
      viewEndMs = viewStartMs + newSpan;
      clampView();
      requestRedraw();
    };
    svg.addEventListener('wheel', onWheel, { passive: false });

    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      dragStartClientX = event.clientX;
      dragStartViewMs = viewStartMs;
      svg.style.cursor = 'grabbing';
    };
    svg.addEventListener('mousedown', onMouseDown);

    const onWindowMouseMove = (event) => {
      if (activeChartMount?.token !== mountToken || !canvasEl.isConnected) return;
      if (dragging) {
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        const deltaPx = event.clientX - dragStartClientX;
        const deltaMs = (deltaPx / rect.width) * viewSpanMs();
        viewStartMs = dragStartViewMs - deltaMs;
        viewEndMs = viewStartMs + viewSpanMs();
        clampView();
        requestRedraw();
        return;
      }
      updateCrosshairFromEvent(event);
    };
    window.addEventListener('mousemove', onWindowMouseMove);

    const onWindowMouseUp = () => {
      dragging = false;
      svg.style.cursor = 'crosshair';
      if (activeChartMount?.token !== mountToken) return;
    };
    window.addEventListener('mouseup', onWindowMouseUp);

    const onMouseLeave = () => {
      hoverTimeMs = null;
      if (tooltipEl) tooltipEl.hidden = true;
      redraw();
    };
    svg.addEventListener('mouseleave', onMouseLeave);

    const onDoubleClick = () => {
      viewStartMs = fullStartMs;
      viewEndMs = fullEndMs;
      hoverTimeMs = null;
      if (tooltipEl) tooltipEl.hidden = true;
      redraw();
    };
    svg.addEventListener('dblclick', onDoubleClick);

    const cleanup = () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('mousedown', onMouseDown);
      svg.removeEventListener('mouseleave', onMouseLeave);
      svg.removeEventListener('dblclick', onDoubleClick);
      dragging = false;
      if (svg.isConnected) svg.remove();
      tooltipEl.hidden = true;
      tooltipEl.innerHTML = '';
    };

    activeChartMount = {
      token: mountToken,
      cleanup
    };

    rebuildLegend();
    redraw();
    if (typeof window !== 'undefined' && window.__SCADA_V2_TEST_HOOKS__) {
        window.__SCADA_V2_TEST_HOOKS__.lastPanes = panes;
    }
  }

  function buildPanelRows() {
    const filter = rankingState.entityFilter;
    const rows = [];
    const getStatusDotMeta = (record) => {
      if (!record || !Number.isFinite(record.primaryValue)) {
        return {
          tone: 'is-missing',
          tooltip: 'Eslesme veya kullanilabilir veri yok'
        };
      }
      if (record.unresolved
        || record.candidateConflict
        || record.backupUsed
        || record.uncertaintyReason
        || record.uncertaintyTooltip
        || record.valueInvalid
        || record.invalidPct) {
        return {
          tone: 'is-warning',
          tooltip: record.uncertaintyTooltip
            || record.uncertaintyLabel
            || (record.valueInvalid || record.invalidPct
              ? 'Olcum verisinde teknik uyari var'
              : 'Eslesme uyarisi var')
        };
      }
      return {
        tone: 'is-ok',
        tooltip: 'Eslesme sorunu yok'
      };
    };
    const addStatusFields = (row, record) => ({
      ...(() => {
        const meta = getStatusDotMeta(record);
        return {
          statusDotTone: meta.tone,
          statusDotTooltip: meta.tooltip
        };
      })(),
      ...row,
      staleState: record?.primaryStaleState || '',
      timeState: record?.timeState || record?.primaryStaleState || '',
      timeStateLabel: record?.timeStateLabel || record?.primaryStatusText || STATUS_TEXT.dead,
      status: record ? getPrimaryStatusClass(record) : 'is-ambiguous',
      statusLabel: record?.primaryStatusText || 'Eslesmedi',
      ageLabel: getAgeLabel(record?.primaryTimestamp || null),
      resolutionMethod: record?.resolutionMethod || '',
      candidateConflict: Boolean(record?.candidateConflict),
      backupUsed: Boolean(record?.backupUsed),
      invalidPct: Boolean(record?.invalidPct),
      valueInvalid: Boolean(record?.valueInvalid),
      mwInvalid: Boolean(record?.active?.valueInvalid),
      mvarInvalid: Boolean(record?.reactive?.valueInvalid),
      displayPctMode: record?.displayPctMode || 'loading',
      uncertaintyLabel: record?.uncertaintyLabel || '',
      uncertaintyTooltip: record?.uncertaintyTooltip || '',
      uncertaintyDetails: record?.uncertaintyDetails || []
    });
    if (filter === 'hat') {
      (typeof getVisibleHats === 'function' ? getVisibleHats() : []).forEach((hat) => {
        const record = state.scada.entityMetricsByKey.get(`hat:${hat.id}`);
        rows.push(addStatusFields({
          entityKey: `hat:${hat.id}`,
          entityType: 'hat',
          name: hat.name,
          km: hat.lengthKm || 0,
          tmName: `${hat.startTm || '-'} -> ${hat.endTm || '-'}`,
          timestamp: record?.primaryTimestamp || null,
          mw: record?.active?.value,
          mvar: record?.reactive?.value,
          pct: record?.displayPct,
          pctRaw: record?.displayPctRaw,
          invalidPct: Boolean(record?.invalidPct)
        }, record));
      });
    } else if (filter === 'trafo-dist' || filter === 'trafo-trans') {
      const source = filter === 'trafo-dist'
        ? (typeof getVisibleTrafoDist === 'function' ? getVisibleTrafoDist() : [])
        : (typeof getVisibleTrafoTransmission === 'function' ? getVisibleTrafoTransmission() : []);
      source.forEach((trafo) => {
        const record = state.scada.entityMetricsByKey.get(`trafo:${trafo.id}`);
        const capacityMva = getCapacityMva('trafo', trafo);
        const capacityLabel = Number.isFinite(capacityMva) && capacityMva > 0
          ? `${Math.abs(capacityMva - Math.round(capacityMva)) < 0.01
            ? String(Math.round(capacityMva))
            : capacityMva.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MVA`
          : '';
        rows.push(addStatusFields({
          entityKey: `trafo:${trafo.id}`,
          entityType: 'trafo',
          rawName: trafo.name,
          name: trafo.displayName || (capacityLabel ? `${trafo.name} (${capacityLabel})` : trafo.name),
          tmName: trafo.tmName || '-',
          typeLabel: trafo.gerilimTuru || '-',
          timestamp: record?.primaryTimestamp || null,
          mw: record?.active?.value,
          mvar: record?.reactive?.value,
          pct: record?.loadingPct
        }, record));
      });
    } else {
      getVoltagePanelRepresentatives().forEach(({ entity: bara, record }) => {
          const nominal = Number(bara.gerilimKv || bara.kvBucket || 0) || 0;
          rows.push(addStatusFields({
            entityKey: `bara:${bara.id}`,
            entityType: 'bara',
            name: bara.gerilimSeviyesi || bara.name,
            tmName: bara.tmName || '-',
            kvText: bara.gerilimKv || '-',
            timestamp: record?.primaryTimestamp || null,
            kvValue: record?.voltage?.value,
            puValue: nominal > 0 && Number.isFinite(record?.voltage?.value)
              ? record.voltage.value / nominal
              : null
          }, record));
        });
    }

    const search = normalizeText(rankingState.search);
    const filtered = rows.filter((row) => {
      if (!search) return true;
      return normalizeText([row.name, row.tmName, row.typeLabel || '', row.kvText || ''].join(' ')).includes(search);
    });

    filtered.sort((left, right) => {
      let leftValue;
      let rightValue;
      switch (rankingState.sortCol) {
        case 'name':
          leftValue = String(left.name || '').toLowerCase();
          rightValue = String(right.name || '').toLowerCase();
          break;
        case 'timestamp':
          leftValue = Number(left.timestamp?.getTime?.() || 0);
          rightValue = Number(right.timestamp?.getTime?.() || 0);
          break;
        case 'mvar':
          leftValue = Math.abs(Number(left.mvar || 0));
          rightValue = Math.abs(Number(right.mvar || 0));
          break;
        case 'mw':
          leftValue = Math.abs(Number(left.mw || 0));
          rightValue = Math.abs(Number(right.mw || 0));
          break;
        case 'kv':
          leftValue = Number(left.kvValue || left.kvText || 0);
          rightValue = Number(right.kvValue || right.kvText || 0);
          break;
        case 'pu':
          leftValue = Number(left.puValue || 0);
          rightValue = Number(right.puValue || 0);
          break;
        case 'tm':
          leftValue = String(left.tmName || '').toLowerCase();
          rightValue = String(right.tmName || '').toLowerCase();
          break;
        case 'score':
        default:
          leftValue = left.invalidPct ? -1 : Number(left.pct || left.kvValue || left.mw || 0);
          rightValue = right.invalidPct ? -1 : Number(right.pct || right.kvValue || right.mw || 0);
          break;
      }
      if (leftValue < rightValue) return -1 * rankingState.sortDir;
      if (leftValue > rightValue) return 1 * rankingState.sortDir;
      return 0;
    });
    return filtered;
  }

  function getRankingKvSelectionValue() {
    const values = [...state.filters.kv].sort();
    if (values.length === 3) return '';
    if (values.length === 1) return values[0];
    return 'custom';
  }

  function syncRankingKvFilterControl() {
    const select = document.getElementById('rankingKvFilter');
    if (!select) return;
    const value = getRankingKvSelectionValue();
    select.value = value === 'custom' ? 'custom' : value;
  }

  function applyRankingKvPreset(value) {
    if (value === 'custom') return;
    setScadaPanelPage(1);
    if (!value) {
      setKvFilterSelection(['66', '154', '400']);
      return;
    }
    setKvFilterSelection([value]);
  }

  function renderRankingHeader() {
    const filter = rankingState.entityFilter;
    if (filter === 'hat') {
      return `
        <thead><tr>
          <th class="col-idx">#</th>
          <th class="col-name" data-sort="name">Hat Adi</th>
          <th class="col-km" data-sort="score">km</th>
          <th class="col-ts" data-sort="timestamp">Zaman</th>
          <th class="col-mw" data-sort="mw">MW</th>
          <th class="col-mvar" data-sort="mvar">MVAR</th>
          <th class="col-pct" data-sort="score">%</th>
          <th class="col-hist" title="Son 24 saat grafiğini göster"></th>
        </tr></thead>
      `;
    }
    if (filter === 'trafo-dist' || filter === 'trafo-trans') {
      return `
        <thead><tr>
          <th class="col-idx">#</th>
          <th class="col-tm" data-sort="tm">TM</th>
          <th class="col-name" data-sort="name">Trafo</th>
          <th class="col-ts" data-sort="timestamp">Zaman</th>
          <th class="col-mw" data-sort="mw">MW</th>
          <th class="col-mvar" data-sort="mvar">MVAR</th>
          <th class="col-pct" data-sort="score">%</th>
          <th class="col-hist" title="Son 24 saat grafiği göster"></th>
        </tr></thead>
      `;
    }
    return `
      <thead><tr>
        <th class="col-idx">#</th>
        <th class="col-tm" data-sort="tm">TM</th>
        <th class="col-name" data-sort="name">Gerilim</th>
        <th class="col-ts" data-sort="timestamp">Zaman</th>
        <th class="col-kv-value" data-sort="kv">kV</th>
        <th class="col-pu" data-sort="pu">p.u.</th>
        <th class="col-status">Durum</th>
        <th class="col-hist" title="Son 24 saat grafiği göster"></th>
      </tr></thead>
    `;
  }

  function formatPanelTimestampShort(timestamp) {
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(timestamp.getDate())}.${pad(timestamp.getMonth() + 1)}.${String(timestamp.getFullYear()).slice(-2)} ${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}`;
  }

  function getPanelTimeToneClass(row) {
    if (!row?.timestamp) return 'is-missing';
    if (row.timeState === 'dead') return 'is-dead';
    if (row.timeState === 'warn') return 'is-warn';
    const ageMs = getScadaReferenceTimeMs() - row.timestamp.getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0) return 'is-live-fresh';
    const ageSec = ageMs / 1000;
    if (ageSec <= 120) return 'is-live-fresh';
    if (ageSec <= 300) return 'is-live-steady';
    return 'is-live-soft';
  }

  function renderPanelTimeCell(row) {
    const historicalMode = state.scada.timeMode === 'historical';
    const label = row.timeStateLabel || (row.staleState === 'warn' ? 'Gecikmeli' : row.staleState === 'dead' ? (historicalMode ? 'Eski' : 'Bayat') : (historicalMode ? 'Gecerli' : 'Canli'));
    const tooltip = row.timestamp
      ? `${label}${row.ageLabel ? ` - ${row.ageLabel}` : ''}`
      : (row.statusLabel || 'Veri yok');
    const toneClass = getPanelTimeToneClass(row);
    if (!row.timestamp) {
      return `
        <div class="ranking-time-cell" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">
          <span class="ranking-time-main ${toneClass}">&mdash;</span>
          <span class="ranking-time-status ${toneClass}">${escapeHtml(label)}</span>
        </div>
      `;
    }
    return `
      <div class="ranking-time-cell" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">
        <span class="ranking-time-main ${toneClass}">${escapeHtml(formatPanelTimestampShort(row.timestamp))}</span>
        <span class="ranking-time-status ${toneClass}">${escapeHtml(label)}</span>
      </div>
    `;
  }

  function paginateRankingRows(rows) {
    const pageSize = getPanelPageSize();
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(rankingState.page, totalPages);
    setScadaPanelPage(page);
    const start = (page - 1) * pageSize;
    return {
      totalPages,
      page,
      start,
      pageSize,
      rows: rows.slice(start, start + pageSize)
    };
  }

  function renderRankingRows(rows, pageStart = 0) {
    const filter = rankingState.entityFilter;
    if (!rows.length) {
      const colSpan = 8;
      return `<tr class="ranking-empty-row"><td colspan="${colSpan}">Secili filtrede kayit bulunamadi.</td></tr>`;
    }
    return rows.map((row, index) => {
      const activeClass = row.entityKey === rankingState.activeKey ? 'ranking-active' : '';
      const timeClass = row.timeState === 'dead' ? ' ranking-dead-row' : row.timeState === 'warn' ? ' ranking-warn-row' : '';
      const rowNo = pageStart + index + 1;
      if (filter === 'hat') {
        const pctColor = row.timeState === 'dead'
          ? (SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af')
          : row.invalidPct
          ? (SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af')
          : row.displayPctMode === 'reactive-ratio'
            ? getReactiveRatioColor(Number.isFinite(row.pct) ? row.pct : 0)
            : (Number.isFinite(row.pct) ? getFlowColor(row.pct) : '#4b5563');
        const pctTextColor = getReadableTextColor(pctColor);
        const statusDot = `<span class="status-dot ${escapeHtml(row.statusDotTone || 'is-missing')}" title="${escapeHtml(row.statusDotTooltip || 'Durum bilgisi yok')}" aria-label="${escapeHtml(row.statusDotTooltip || 'Durum bilgisi yok')}">&#9679;</span>`;
        const pctText = row.invalidPct ? '!' : Number.isFinite(row.pct) ? row.pct.toFixed(1) : '&mdash;';
        return `
          <tr class="${activeClass}${timeClass}" data-entity-key="${row.entityKey}">
            <td class="col-idx">${rowNo}</td>
            <td class="col-name" title="${escapeHtml(row.name)}"><span class="ranking-name-cell">${statusDot}<span class="ranking-name-text">${escapeHtml(row.name || '-')}</span></span></td>
            <td class="col-km">${Number.isFinite(row.km) ? row.km.toFixed(0) : '&mdash;'}</td>
            <td class="col-ts">${renderPanelTimeCell(row)}</td>
            <td class="col-mw">${row.mwInvalid ? '!' : Number.isFinite(row.mw) ? `${row.mw >= 0 ? '+' : ''}${row.mw.toFixed(1)}` : '&mdash;'}</td>
            <td class="col-mvar">${row.mvarInvalid ? '!' : Number.isFinite(row.mvar) ? `${row.mvar >= 0 ? '+' : ''}${row.mvar.toFixed(1)}` : '-'}</td>
            <td class="col-pct"><span class="ranking-pct-cell${row.invalidPct ? ' is-invalid' : ''}" style="background:${pctColor};color:${pctTextColor}">${pctText}</span></td>
            <td class="col-hist"><button type="button" class="btn-history" data-history-entity="${row.entityKey}" title="Son 24 saat grafiğini göster" aria-label="Son 24 saat grafiğini göster">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            </button></td>
          </tr>
        `;
      }
      if (filter === 'trafo-dist' || filter === 'trafo-trans') {
        const pctColor = row.timeState === 'dead'
          ? (SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af')
          : (Number.isFinite(row.pct) ? getFlowColor(row.pct) : '#4b5563');
        const pctTextColor = getReadableTextColor(pctColor);
        return `
          <tr class="${activeClass}${timeClass}" data-entity-key="${row.entityKey}">
            <td class="col-idx">${rowNo}</td>
            <td class="col-tm">${escapeHtml(row.tmName || '-')}</td>
            <td class="col-name" title="${escapeHtml(row.name)}"><span class="ranking-name-text">${escapeHtml(row.name || '-')}</span></td>
            <td class="col-ts">${renderPanelTimeCell(row)}</td>
            <td class="col-mw">${row.mwInvalid ? '!' : Number.isFinite(row.mw) ? `${row.mw >= 0 ? '+' : ''}${row.mw.toFixed(1)}` : '&mdash;'}</td>
            <td class="col-mvar">${row.mvarInvalid ? '!' : Number.isFinite(row.mvar) ? `${row.mvar >= 0 ? '+' : ''}${row.mvar.toFixed(1)}` : '-'}</td>
            <td class="col-pct"><span class="ranking-pct-cell" style="background:${pctColor};color:${pctTextColor}">${Number.isFinite(row.pct) ? row.pct.toFixed(1) : '&mdash;'}</span></td>
            <td class="col-hist"><button type="button" class="btn-history" data-history-entity="${row.entityKey}" title="Son 24 saat grafiğini göster" aria-label="Son 24 saat grafiğini göster">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            </button></td>
          </tr>
        `;
      }
      return `
        <tr class="${activeClass}${timeClass}" data-entity-key="${row.entityKey}">
          <td class="col-idx">${rowNo}</td>
          <td class="col-tm">${escapeHtml(row.tmName || '-')}</td>
          <td class="col-name" title="${escapeHtml(row.name)}"><span class="ranking-name-text">${escapeHtml(row.name || '-')}</span></td>
          <td class="col-ts">${renderPanelTimeCell(row)}</td>
          <td class="col-kv-value">${Number.isFinite(row.kvValue) ? row.kvValue.toFixed(1) : '&mdash;'}</td>
          <td class="col-pu">${Number.isFinite(row.puValue) ? row.puValue.toFixed(3) : '&mdash;'}</td>
          <td class="col-status"><span class="ranking-status-pill ${row.status}">${escapeHtml(row.statusLabel || '-')}</span></td>
          <td class="col-hist"><button type="button" class="btn-history" data-history-entity="${row.entityKey}" title="Son 24 saat grafiğini göster" aria-label="Son 24 saat grafiğini göster">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
          </button></td>
        </tr>
      `;
    }).join('');
  }

  toggleRankingPanel = function () {
    let panel = document.getElementById('rankingPanel');
    if (panel) {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        if (rankingState.dirty !== false) refreshRankingTable();
      }
      return;
    }
    panel = document.createElement('div');
    panel.id = 'rankingPanel';
    panel.className = 'ranking-panel';
    if (state.map.theme === 'light') panel.classList.add('light-mode');
    panel.innerHTML = `
      <div class="ranking-header">
        <div class="ranking-header-left">
          <span>SCADA Paneli</span>
        </div>
        <button id="btnRankingClose">&times;</button>
      </div>
      <div class="ranking-entity-tabs">
        <button type="button" data-entity-filter="hat">Hatlar</button>
        <button type="button" data-entity-filter="trafo-dist">Trafo (Dagitim)</button>
        <button type="button" data-entity-filter="trafo-trans">Trafo (Iletim)</button>
        <button type="button" data-entity-filter="voltage">Gerilim (kV)</button>
      </div>
      <div class="ranking-filters">
        <input type="text" id="rankingSearch" placeholder="SCADA oge ara...">
        <select id="rankingKvFilter">
          <option value="">Tumu</option>
          <option value="400">400 kV</option>
          <option value="154">154 kV</option>
          <option value="66">66 kV</option>
          <option value="custom" disabled>Ozel</option>
        </select>
      </div>
      <div class="ranking-body">
        <table class="ranking-table" id="rankingTable"></table>
      </div>
      <div class="ranking-footer">
        <span id="rankingCount"></span>
        <div class="ranking-footer-pager">
          <button id="btnRankingPrev" type="button" title="Onceki sayfa">&larr;</button>
          <span id="rankingPageState" class="ranking-page-state">1 / 1</span>
          <button id="btnRankingNext" type="button" title="Sonraki sayfa">&rarr;</button>
        </div>
        <div class="ranking-footer-actions">
          <button id="btnRankingFontDown" type="button" title="Yaziyi kucult">${iconMarkup('fontMinus', 'A-')}</button>
          <button id="btnRankingFontReset" type="button" title="Yaziyi sifirla">${iconMarkup('fontReset', 'A0')}</button>
          <button id="btnRankingFontUp" type="button" title="Yaziyi buyut">${iconMarkup('fontPlus', 'A+')}</button>
          <button id="btnRankingCsv" type="button" title="CSV indir">${iconMarkup('download', 'CSV Indir')}</button>
        </div>
      </div>
    `;
    const mapShell = document.querySelector('.map-shell');
    if (mapShell) mapShell.appendChild(panel);

    const closeButton = document.getElementById('btnRankingClose');
    if (closeButton) {
      closeButton.innerHTML = '&times;';
      closeButton.title = 'Kapat';
    }
    document.getElementById('btnRankingClose').addEventListener('click', closeRankingPanel);
    document.getElementById('btnRankingCsv').addEventListener('click', exportRankingCsv);
    document.getElementById('rankingSearch').addEventListener('input', (event) => {
      rankingState.search = event.target.value;
      setScadaPanelPage(1);
      refreshRankingTable();
    });
    document.getElementById('rankingKvFilter').addEventListener('change', (event) => {
      applyRankingKvPreset(event.target.value);
    });
    document.getElementById('btnRankingPrev').addEventListener('click', () => {
      setScadaPanelPage(rankingState.page - 1);
      refreshRankingTable();
    });
    document.getElementById('btnRankingNext').addEventListener('click', () => {
      setScadaPanelPage(rankingState.page + 1);
      refreshRankingTable();
    });
    document.getElementById('btnRankingFontDown').addEventListener('click', () => {
      setScadaPanelFontScale(rankingState.fontScale === 'large' ? 'normal' : 'compact');
      refreshRankingTable();
    });
    document.getElementById('btnRankingFontReset').addEventListener('click', () => {
      setScadaPanelFontScale('normal');
      refreshRankingTable();
    });
    document.getElementById('btnRankingFontUp').addEventListener('click', () => {
      setScadaPanelFontScale(rankingState.fontScale === 'compact' ? 'normal' : 'large');
      refreshRankingTable();
    });
    panel.querySelector('.ranking-entity-tabs').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-entity-filter]');
      if (!button) return;
      setRankingEntityFilter(button.dataset.entityFilter);
    });
    panel.querySelector('.ranking-body').addEventListener('click', (event) => {
      const btnHist = event.target.closest('.btn-history');
      if (btnHist) {
        event.preventDefault();
        event.stopPropagation();
        openScada24hHistory(btnHist.dataset.historyEntity);
        return;
      }
      const row = event.target.closest('tr[data-entity-key]');
      if (!row) return;
      openPanelEntity(row.dataset.entityKey);
    });
    panel.querySelector('.ranking-body').addEventListener('click', (event) => {
      const th = event.target.closest('th[data-sort]');
      if (!th) return;
      const col = th.dataset.sort;
      if (rankingState.sortCol === col) rankingState.sortDir *= -1;
      else {
        rankingState.sortCol = col;
        rankingState.sortDir = col === 'name' ? 1 : -1;
      }
      refreshRankingTable();
    }, true);

    syncRankingKvFilterControl();
    refreshRankingTable();
  };

  closeRankingPanel = function () {
    const panel = document.getElementById('rankingPanel');
    if (panel) panel.classList.add('hidden');
    rankingState.search = '';
    rankingState.activeKey = '';
    const searchInput = document.getElementById('rankingSearch');
    if (searchInput) searchInput.value = '';
    requestRender();
  };

  function openPanelEntity(entityKey) {
    rankingState.activeKey = entityKey;
    const [entityType, entityId] = String(entityKey || '').split(':');
    if (entityType === 'hat') {
      const hat = state.network.hatById?.get(String(entityId)) || state.network.hatLines.find((entry) => String(entry.id) === String(entityId));
      if (!hat) return;
      const anchor = getHatAnchorCoord(hat);
      state.map.centerLon = anchor.lon;
      state.map.centerLat = anchor.lat;
      state.map.tileState.rangeKey = '';
      openScadaHatDetails(hat, { anchorCoord: anchor, forceTiles: true });
    } else if (entityType === 'trafo') {
      const trafo = state.network.trafos.find((entry) => String(entry.id) === String(entityId));
      const tm = trafo?.tm || getEntityTm(trafo);
      if (!trafo || !tm) return;
      state.map.centerLon = Number(tm.lon);
      state.map.centerLat = Number(tm.lat);
      state.map.tileState.rangeKey = '';
      openTrafoDetails(trafo, { lon: Number(tm.lon), lat: Number(tm.lat) });
      requestRender({ forceTiles: true });
    } else if (entityType === 'bara') {
      const bara = state.network.baraNodes.find((entry) => String(entry.id) === String(entityId));
      const tm = bara?.tm || getEntityTm(bara);
      if (!bara || !tm) return;
      state.map.centerLon = Number(tm.lon);
      state.map.centerLat = Number(tm.lat);
      state.map.tileState.rangeKey = '';
      openBaraNodeDetails(bara, { lon: Number(tm.lon), lat: Number(tm.lat) });
      requestRender({ forceTiles: true });
    }
    refreshRankingTable();
  }

  refreshRankingTable = function () {
    const panel = document.getElementById('rankingPanel');
    const table = document.getElementById('rankingTable');
    if (!table || !panel) return;
    if (panel.classList.contains('hidden')) {
      rankingState.dirty = true;
      return;
    }
    rankingState.dirty = false;
    panel.classList.toggle('light-mode', state.map?.theme === 'light');
    syncRankingKvFilterControl();
    panel.classList.remove('font-compact', 'font-large');
    if (rankingState.fontScale === 'compact') panel.classList.add('font-compact');
    if (rankingState.fontScale === 'large') panel.classList.add('font-large');
    const allRows = buildPanelRows();
    const pageState = paginateRankingRows(allRows);
    const filterButtons = Array.from(document.querySelectorAll('.ranking-entity-tabs button[data-entity-filter]'));
    filterButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.entityFilter === rankingState.entityFilter);
    });
    table.innerHTML = `${renderRankingHeader()}<tbody id="rankingTbody">${renderRankingRows(pageState.rows, pageState.start)}</tbody>`;
    const countEl = document.getElementById('rankingCount');
    if (countEl) countEl.textContent = `${pageState.rows.length} / ${allRows.length} ${ENTITY_LABELS[rankingState.entityFilter] || 'oge'}`;
    const pageLabel = document.getElementById('rankingPageState');
    if (pageLabel) pageLabel.textContent = `${pageState.page} / ${pageState.totalPages}`;
    const prevButton = document.getElementById('btnRankingPrev');
    if (prevButton) prevButton.disabled = pageState.page <= 1;
    const nextButton = document.getElementById('btnRankingNext');
    if (nextButton) nextButton.disabled = pageState.page >= pageState.totalPages;
  };

  function formatCsvDate(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (v) => String(v).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatCsvDecimal(value, digits = 2) {
    if (!Number.isFinite(Number(value))) return '';
    return Number(value).toFixed(digits).replace('.', ',');
  }

  // Selected metric drives every CSV: hat/trafo use the record's P or Q value,
  // voltage uses U. Nothing here ever starts a new SCADA query.
  function getCsvMetricContext(record) {
    const metricType = record?.primaryMetric || getModeConfig().primaryMetric;
    const elementName = metricType === 'active' ? 'P' : metricType === 'reactive' ? 'Q' : 'U';
    const unit = metricType === 'active' ? 'MW' : metricType === 'reactive' ? 'MVar' : 'kV';
    const typeLabel = metricType === 'active'
      ? 'Aktif Güç (P)'
      : metricType === 'reactive'
        ? 'Reaktif Güç (Q)'
        : 'Gerilim (U)';
    return { metricType, elementName, unit, typeLabel, metric: record?.[metricType] || null };
  }

  function getCsvSelectedMeasurementId(metric) {
    const selected = String(metric?.selectedCandidate || '').trim();
    if (selected) return selected.split(',')[0].trim();
    return String(metric?.measurementId || '').split(',')[0].trim();
  }

  function getCsvSourceRow(measurementId, elementName) {
    const measurementIdText = String(measurementId || '').trim();
    if (!measurementIdText) return null;
    const rows = state.scada.measurementRowsById;
    if (!(rows instanceof Map)) return null;
    return rows.get(`${measurementIdText}|${elementName}`) || rows.get(measurementIdText) || null;
  }

  function getCsvSelectedSourceRow(metric, elementName) {
    if (!metric) return null;
    return getCsvSourceRow(getCsvSelectedMeasurementId(metric), elementName);
  }

  function getCsvCandidateSourceName(entity, metricType, measurementId, sourceRow) {
    const candidates = Array.isArray(entity?.scada?.[metricType]?.rows) ? entity.scada[metricType].rows : [];
    const candidate = candidates.find((entry) => String(entry.measurementId || '') === String(measurementId || ''));
    return candidate?.sourceTmName || sourceRow?.tmName || String(measurementId || '');
  }

  function buildCsvFallbackCandidateDetails(entity, metricType) {
    const elementName = metricType === 'active' ? 'P' : metricType === 'reactive' ? 'Q' : 'U';
    const candidates = Array.isArray(entity?.scada?.[metricType]?.rows) ? entity.scada[metricType].rows : [];
    return candidates.map((candidate) => {
      const measurementId = String(candidate.measurementId || '');
      const sourceRow = getCsvSourceRow(measurementId, elementName);
      return {
        measurementId,
        terminalSide: candidate.terminalSide || candidate.sourceSide || '',
        rawValue: Number.isFinite(Number(sourceRow?.value)) ? Number(sourceRow.value) : null,
        timestamp: sourceRow?.timestamp || null,
        sourceName: getCsvCandidateSourceName(entity, metricType, measurementId, sourceRow),
        selected: false
      };
    }).filter((entry) => entry.measurementId);
  }

  // Terminal values stay raw (source row), the final value stays normalized
  // (record.active.value / record.reactive.value). Multiple candidates on the
  // same side follow the existing resolution order: selected first, then the
  // configured candidate order.
  function getCsvHatTerminalData(entity, metric, metricType) {
    const details = Array.isArray(metric?.candidateDetails) && metric.candidateDetails.length
      ? metric.candidateDetails
      : buildCsvFallbackCandidateDetails(entity, metricType);
    const elementName = metricType === 'active' ? 'P' : metricType === 'reactive' ? 'Q' : 'U';
    const buildSide = (side) => {
      const sideEntries = details.filter((entry) => entry.terminalSide === side);
      if (!sideEntries.length) return null;
      const entry = sideEntries.find((candidate) => candidate.selected) || sideEntries[0];
      const sourceRow = getCsvSourceRow(String(entry.measurementId || ''), elementName);
      return {
        value: Number.isFinite(Number(entry.rawValue))
          ? Number(entry.rawValue)
          : Number.isFinite(Number(sourceRow?.value)) ? Number(sourceRow.value) : null,
        time: entry.timestamp || sourceRow?.timestamp || null,
        sourceName: getCsvCandidateSourceName(entity, metricType, entry.measurementId, sourceRow)
      };
    };
    return { start: buildSide('start'), end: buildSide('end') };
  }

  function getCsvTrafoCandidates(entity, metric, metricType) {
    const details = Array.isArray(metric?.candidateDetails) && metric.candidateDetails.length
      ? metric.candidateDetails
      : buildCsvFallbackCandidateDetails(entity, metricType);
    const elementName = metricType === 'active' ? 'P' : 'Q';
    return details.slice(0, 2).map((entry) => {
      const sourceRow = getCsvSourceRow(String(entry.measurementId || ''), elementName);
      return {
        measurementId: String(entry.measurementId || ''),
        sourceName: getCsvCandidateSourceName(entity, metricType, entry.measurementId, sourceRow),
        value: Number.isFinite(Number(entry.rawValue))
          ? Number(entry.rawValue)
          : Number.isFinite(Number(sourceRow?.value)) ? Number(sourceRow.value) : null,
        time: entry.timestamp || sourceRow?.timestamp || null
      };
    });
  }

  function getCsvWarningText(record) {
    const parts = [];
    if (record?.candidateConflict) parts.push('Aday uyuşmazlığı; birincil terminal kullanıldı');
    if (record?.backupUsed) parts.push('Yedek terminal kullanıldı; terminal değerleri uyuşmuyor');
    if (record?.unresolvedReason) {
      parts.push({
        'orientation-unknown': 'Yön belirlenemedi',
        'source-side-unknown': 'Başlangıç/bitiş tarafı doğrulanamadı',
        'polarization-mismatch': 'Terminal polarizasyonu uyumsuz',
        'ambiguous-live': 'Belirsiz canlı aday',
        'missing-source-row': 'Kaynak satır bulunamadı',
        'invalid-pct': 'Yüklenme oranı geçersiz'
      }[record.unresolvedReason] || record.unresolvedReason);
    }
    if (record?.uncertaintyLabel) parts.push(record.uncertaintyLabel);
    if (record?.valueInvalid) parts.push('Ölçüm değeri geçersiz (1,5x kapasite sınırı)');
    if (record?.invalidPct) parts.push('Yüklenme oranı geçersiz');
    if (state.scada.fetchMeta?.error) parts.push(String(state.scada.fetchMeta.error));
    return [...new Set(parts)].join('; ');
  }

  function translateResolutionMethod(method) {
    return ({
      'single-candidate': 'Tek geçerli kaynak',
      'latest-terminal': 'En yeni terminal',
      'tolerance-primary': 'Tolerans içinde birincil terminal',
      'primary-conflict': 'Aday uyuşmazlığı - birincil terminal',
      'same-value': 'Terminaller aynı değerde',
      'invalid-value': 'Geçersiz değer',
      'orientation-unknown': 'Yön belirlenemedi',
      'ambiguous-live': 'Belirsiz canlı aday'
    })[method] || String(method || '');
  }

  function getCsvQueryDurationSeconds() {
    const fetchDurationMs = Number(state.scada.fetchMeta?.durationMs);
    if (Number.isFinite(fetchDurationMs) && fetchDurationMs > 0) {
      return formatCsvDecimal(fetchDurationMs / 1000, 1);
    }
    const op = state.scada.operationMeta;
    if (op?.startedAt && (op.stage === 'done' || op.stage === 'error')) {
      const started = op.startedAt instanceof Date ? op.startedAt.getTime() : Number(op.startedAt);
      const updated = op.updatedAt instanceof Date ? op.updatedAt.getTime() : Number(op.updatedAt);
      if (Number.isFinite(started) && Number.isFinite(updated) && updated - started > 0) {
        return formatCsvDecimal((updated - started) / 1000, 1);
      }
    }
    return '';
  }

  function getCsvFlowDirectionText(entityId, record) {
    const flow = state.scada.lineFlowByLineId?.get?.(entityId);
    if (flow?.direction === 'forward') return 'Başlangıç → Bitiş';
    if (flow?.direction === 'reverse') return 'Bitiş → Başlangıç';
    if (Number.isFinite(record?.directionValue)) {
      return record.directionValue >= 0 ? 'Başlangıç → Bitiş' : 'Bitiş → Başlangıç';
    }
    return 'Belirsiz';
  }

  function getCsvSelectedTerminalText(record) {
    if (record?.terminalSide === 'start') return 'Başlangıç';
    if (record?.terminalSide === 'end') return 'Bitiş';
    return '';
  }

  function buildCsvRows(rows) {
    const filter = rankingState.entityFilter;
    const queryDuration = getCsvQueryDurationSeconds();
    if (filter === 'hat') {
      return {
        header: [
          'Sıra', 'Hat Adı', 'Gerilim (kV)', 'Uzunluk (km)', 'Başlangıç Terminali', 'Bitiş Terminali',
          'Başlangıç SCADA Adı', 'Bitiş SCADA Adı', 'Akış Yönü', 'Ölçüm Türü', 'Element Adı', 'Ölçüm ID',
          'SCADA B1', 'SCADA B2', 'SCADA B3', 'Başlangıç Terminal Değeri', 'Başlangıç Terminal Zamanı',
          'Bitiş Terminal Değeri', 'Bitiş Terminal Zamanı', 'Nihai Değer', 'Birim', 'Nihai Veri Zamanı',
          'Seçilen Terminal', 'Yüklenme (%)', 'Veri Durumu', 'Çözüm Yöntemi', 'Sorgu Süresi (sn)', 'Uyarı / Hata'
        ],
        rows: rows.map((row, index) => {
          const record = state.scada.entityMetricsByKey.get(row.entityKey) || null;
          const entity = record?.entity || null;
          const ctx = getCsvMetricContext(record);
          const sourceRow = getCsvSelectedSourceRow(ctx.metric, ctx.elementName);
          const terminals = entity ? getCsvHatTerminalData(entity, ctx.metric, ctx.metricType) : { start: null, end: null };
          return [
            index + 1,
            row.name || '',
            entity ? String(entity.kvBucket || entity.kv || entity.gerilimKv || '') : '',
            formatCsvDecimal(row.km, 1),
            entity?.startTm || '',
            entity?.endTm || '',
            terminals.start?.sourceName || '',
            terminals.end?.sourceName || '',
            getCsvFlowDirectionText(row.entityKey.split(':')[1], record),
            ctx.typeLabel,
            ctx.elementName,
            getCsvSelectedMeasurementId(ctx.metric),
            sourceRow?.tmName || '',
            sourceRow?.kvText || '',
            sourceRow?.remoteName || '',
            formatCsvDecimal(terminals.start?.value),
            formatCsvDate(terminals.start?.time),
            formatCsvDecimal(terminals.end?.value),
            formatCsvDate(terminals.end?.time),
            formatCsvDecimal(ctx.metric?.value),
            ctx.unit,
            formatCsvDate(ctx.metric?.timestamp),
            getCsvSelectedTerminalText(record),
            Number.isFinite(Number(row.pct)) ? formatCsvDecimal(row.pct) : '',
            row.statusLabel || '',
            translateResolutionMethod(record?.resolutionMethod || ''),
            queryDuration,
            getCsvWarningText(record)
          ];
        })
      };
    }
    if (filter === 'trafo-dist' || filter === 'trafo-trans') {
      return {
        header: [
          'Sıra', 'TM', 'Trafo Adı', 'Gerilim (kV)', 'Kapasite (MVA)', 'Ölçüm Türü', 'Element Adı', 'Ölçüm ID',
          'SCADA B1', 'SCADA B2', 'SCADA B3', 'Birincil SCADA Kaynağı', 'Birincil Kaynak Değeri',
          'Birincil Kaynak Zamanı', 'İkincil SCADA Kaynağı', 'İkincil Kaynak Değeri', 'İkincil Kaynak Zamanı',
          'Nihai Değer', 'Birim', 'Nihai Veri Zamanı', 'Yüklenme (%)', 'Veri Durumu', 'Çözüm Yöntemi',
          'Sorgu Süresi (sn)', 'Uyarı / Hata'
        ],
        rows: rows.map((row, index) => {
          const record = state.scada.entityMetricsByKey.get(row.entityKey) || null;
          const entity = record?.entity || null;
          const ctx = getCsvMetricContext(record);
          const sourceRow = getCsvSelectedSourceRow(ctx.metric, ctx.elementName);
          const candidates = entity ? getCsvTrafoCandidates(entity, ctx.metric, ctx.metricType) : [];
          const primary = candidates[0] || null;
          const secondary = candidates[1] || null;
          const capacityMva = entity ? getCapacityMva('trafo', entity) : null;
          const kvLabel = entity ? [entity.primaryKv, entity.secondaryKv].filter(Boolean).join(' / ') : '';
          return [
            index + 1,
            entity?.tmName || row.tmName || '',
            row.name || '',
            kvLabel,
            formatCsvDecimal(capacityMva, 1),
            ctx.typeLabel,
            ctx.elementName,
            getCsvSelectedMeasurementId(ctx.metric),
            sourceRow?.tmName || '',
            sourceRow?.kvText || '',
            sourceRow?.remoteName || '',
            primary?.sourceName || '',
            formatCsvDecimal(primary?.value),
            formatCsvDate(primary?.time),
            secondary?.sourceName || '',
            formatCsvDecimal(secondary?.value),
            formatCsvDate(secondary?.time),
            formatCsvDecimal(ctx.metric?.value),
            ctx.unit,
            formatCsvDate(ctx.metric?.timestamp),
            Number.isFinite(Number(row.pct)) ? formatCsvDecimal(row.pct) : '',
            row.statusLabel || '',
            translateResolutionMethod(record?.resolutionMethod || ''),
            queryDuration,
            getCsvWarningText(record)
          ];
        })
      };
    }
    return {
      header: [
        'Sıra', 'TM', 'Bara / Gerilim Adı', 'Nominal Gerilim (kV)', 'Element Adı', 'Ölçüm ID',
        'SCADA B1', 'SCADA B2', 'SCADA B3', 'Birincil SCADA Kaynağı', 'Ham Gerilim (kV)',
        'Nihai Gerilim (kV)', 'p.u.', 'Veri Zamanı', 'Veri Durumu', 'Veri Yaşı', 'Sorgu Süresi (sn)',
        'Uyarı / Hata'
      ],
      rows: rows.map((row, index) => {
        const record = state.scada.entityMetricsByKey.get(row.entityKey) || null;
        const entity = record?.entity || null;
        const ctx = getCsvMetricContext(record);
        const sourceRow = getCsvSelectedSourceRow(ctx.metric, ctx.elementName);
        return [
          index + 1,
          row.tmName || '',
          row.name || '',
          entity ? String(entity.gerilimKv || entity.kvBucket || '') : '',
          ctx.elementName,
          getCsvSelectedMeasurementId(ctx.metric),
          sourceRow?.tmName || '',
          sourceRow?.kvText || '',
          sourceRow?.remoteName || '',
          entity ? getCsvCandidateSourceName(entity, 'voltage', getCsvSelectedMeasurementId(ctx.metric), sourceRow) : '',
          formatCsvDecimal(sourceRow?.value),
          formatCsvDecimal(ctx.metric?.value),
          formatCsvDecimal(row.puValue, 3),
          formatCsvDate(ctx.metric?.timestamp),
          row.statusLabel || '',
          row.ageLabel || '',
          queryDuration,
          getCsvWarningText(record)
        ];
      })
    };
  }

  exportRankingCsv = function () {
    const rows = buildPanelRows();
    if (!rows.length) return;
    const csv = buildCsvRows(rows);
    const kind = rankingState.entityFilter === 'hat'
      ? 'hat'
      : rankingState.entityFilter === 'trafo-dist'
        ? 'trafo_dagitim'
        : rankingState.entityFilter === 'trafo-trans'
          ? 'trafo_iletim'
          : 'gerilim';
    const pad = (v) => String(v).padStart(2, '0');
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    let filename = `scada_${kind}_${stamp}.csv`;
    if (state.scada.timeMode === 'historical' && Number.isFinite(Number(state.scada.historicalAt))) {
      const at = new Date(Number(state.scada.historicalAt));
      filename = `scada_${kind}_${stamp}_gecmis_${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}_${pad(at.getHours())}${pad(at.getMinutes())}.csv`;
    }
    if (typeof downloadScadaCsvFile === 'function') {
      downloadScadaCsvFile(filename, csv.header, csv.rows);
    }
    scadaLog('info', `SCADA panel CSV indirildi: ${rows.length} satir, ${csv.header.length} kolon.`);
  };

  function buildScadaAuditReport() {
    const scope = state.scada.currentScope || getCurrentScadaScope();
    const incrementTimeBucket = (timeState) => {
      if (timeState === 'dead') summary.dead += 1;
      else if (timeState === 'warn') summary.delayed += 1;
      else summary.live += 1;
    };
    const summary = {
      visibleTotal: scope.entities.length,
      rawRows: state.scada.totalRows || 0,
      normalizedRows: state.scada.measurementRowsById?.size || 0,
      live: 0,
      delayed: 0,
      dead: 0,
      stale: 0,
      structuralMatches: 0,
      missingConfigId: 0,
      missingSourceRow: 0,
      ambiguousLive: 0,
      ambiguousWarning: 0,
      orientationUnknown: 0,
      resolvedTerminalMismatch: 0,
      resolvedWithWarning: 0,
      transportUnavailable: 0,
      unmatchedTotal: 0,
      filterKey: scope.filterKey,
      queryContract: {
        timeRange: SCADA_CONFIG.QUERY_TIME_RANGE,
        kvFilters: [],
        tearFilters: [],
        rowLimit: Math.max(SCADA_CONFIG.QUERY_ROW_LIMIT, scope.measurementIds.length * 3 || 5000)
      },
      dataTimestamp: state.scada.lastDataTimestamp,
      transportMode: state.scada.lastTransport?.authMode || '-',
      metricMode: scope.modeLabel
    };

    const rows = scope.entities.map((entity) => {
      const entityType = scope.domain === 'bara' ? 'bara' : scope.domain;
      const record = state.scada.entityMetricsByKey.get(`${entityType}:${entity.id}`);
      const ids = entityType === 'bara'
        ? (entity.scada?.voltage?.ids || [])
        : (entity.scada?.[scope.primaryMetric]?.ids || []);
      let status = 'missing-config-id';
      let reason = 'Entity icin ilgili SCADA olcum ID tanimli degil.';
      const primaryMetricRecord = scope.domain === 'bara'
        ? record?.voltage
        : scope.primaryMetric === 'reactive'
          ? record?.reactive
          : record?.active;
      const candidateDetails = Array.isArray(primaryMetricRecord?.candidateDetails)
        ? primaryMetricRecord.candidateDetails
        : [];
      const candidateA = candidateDetails[0] || null;
      const candidateB = candidateDetails[1] || null;
      const resolutionClass = getHatResolutionClass(record);
      if (!ids.length) {
        summary.missingConfigId += 1;
        summary.unmatchedTotal += 1;
      } else if (!record) {
        status = 'missing-source-row';
        reason = 'Olcum ID kaynak sorguda bulunamadi.';
        summary.missingSourceRow += 1;
        summary.unmatchedTotal += 1;
      } else if (['orientation-unknown', 'source-side-unknown', 'polarization-mismatch'].includes(record.unresolvedReason)) {
        status = 'orientation-unknown';
        reason = record.unresolvedReason === 'polarization-mismatch'
          ? 'Terminal tarafi bulundu ancak formul polarizasyonu ile uyusmadi.'
          : record.unresolvedReason === 'source-side-unknown'
            ? 'Baslangic / bitis terminal tarafi dogrulanamadi.'
            : 'Canli aday bulundu ancak hat yonu cozulmedi.';
        summary.structuralMatches += 1;
        summary.orientationUnknown += 1;
        summary.ambiguousLive += 1;
      } else if (record.candidateConflict || record.backupUsed) {
        status = 'ambiguous-warning';
        reason = record.backupUsed
          ? 'Ana aday kullanilamadi veya celisti; yedek adayla cozuldu.'
          : 'Coklu aday tolerans disi; ana aday gosteriliyor ve kayit uyarili isaretlendi.';
        summary.structuralMatches += 1;
        summary.ambiguousWarning += 1;
        incrementTimeBucket(record.primaryStaleState);
      } else if (record.invalidPct || record.uncertaintyReason === 'invalid-pct') {
        status = 'ambiguous-warning';
        reason = 'Oran %300 uzeri oldugu icin gecersiz kabul edildi.';
        summary.structuralMatches += 1;
        summary.ambiguousWarning += 1;
        incrementTimeBucket(record.primaryStaleState);
      } else if (record.valueInvalid) {
        status = 'ambiguous-warning';
        reason = 'Olcum degeri 1.5x kapasite sinirini gectigi icin secim gecersiz kabul edildi.';
        summary.structuralMatches += 1;
        summary.ambiguousWarning += 1;
        incrementTimeBucket(record.primaryStaleState);
      } else if (record.sourceAmbiguous || record.unresolved) {
        status = 'ambiguous-live';
        reason = 'Birden fazla canli aday kayit tutarsiz durumda.';
        summary.structuralMatches += 1;
        summary.ambiguousLive += 1;
      } else if (!Number.isFinite(record.primaryValue)) {
        status = 'missing-source-row';
        reason = 'Olcum ID kaynak sorguda bulunamadi.';
        summary.missingSourceRow += 1;
        summary.unmatchedTotal += 1;
      } else if (record.resolvedTerminalMismatch) {
        status = record.primaryStaleState === 'dead'
          ? 'matched-dead'
          : record.primaryStaleState === 'warn'
            ? 'matched-delayed'
            : 'matched-live';
        reason = 'Formul polarizasyonu farkli; akis yonu terminal-exit modeliyle cozuldu.';
        summary.structuralMatches += 1;
        summary.resolvedTerminalMismatch += 1;
        summary.resolvedWithWarning += 1;
        incrementTimeBucket(record.primaryStaleState);
      } else if (record.primaryStaleState === 'dead') {
        status = 'matched-dead';
        reason = record.resolvedFromMultiple
          ? 'Kaynak satir toleransli coklu olcum birlestirmesiyle secildi ancak veri bayat durumda.'
          : 'Kaynak satir bulundu ancak veri bayat durumda.';
        summary.structuralMatches += 1;
        summary.dead += 1;
      } else if (record.primaryStaleState === 'warn') {
        status = 'matched-delayed';
        reason = record.resolvedFromMultiple
          ? 'Kaynak satir toleransli coklu olcum birlestirmesiyle secildi ancak veri gecikmeli durumda.'
          : 'Kaynak satir bulundu ancak veri gecikmeli durumda.';
        summary.structuralMatches += 1;
        summary.delayed += 1;
      } else {
        status = 'matched-live';
        reason = record.resolvedFromMultiple
          ? 'Kaynak satir toleransli coklu olcum birlestirmesiyle secildi.'
          : 'Kaynak satir tekil olarak eslesti.';
        summary.structuralMatches += 1;
        summary.live += 1;
      }
      return {
        entityType,
        entityId: entity.id,
        entityName: entity.name,
        tmName: entity.tmName || entity.startTm || '-',
        kv: entity.kvBucket || entity.kv || entity.gerilimKv || entity.primaryKv || '-',
        scadaId: record?.primaryMeasurementId || ids.join(','),
        status,
        reason,
        sourceTimestamp: record?.primaryTimestamp || null,
        primaryValue: record?.primaryValue,
        secondaryValue: scope.domain !== 'bara'
          ? (scope.primaryMetric === 'active' ? record?.reactive?.value : record?.active?.value)
          : null,
        loadingPct: record?.loadingPct ?? null,
        staleState: record?.primaryStaleState || '',
        timeState: record?.timeState || record?.primaryStaleState || '',
        timeStateLabel: record?.timeStateLabel || record?.primaryStatusText || '',
        ageLabel: record?.ageLabel || '',
        sourceTm: record?.active?.sourceTm || record?.reactive?.sourceTm || record?.voltage?.sourceTm || '',
        sourceRemote: record?.active?.sourceRemote || record?.reactive?.sourceRemote || record?.voltage?.sourceRemote || '',
        directionMetric: record?.directionMetric || scope.primaryMetric || '',
        directionModel: record?.directionModel || '',
        directionValue: record?.directionValue ?? null,
        directionResolvedBy: record?.directionResolvedBy || '',
        formulaSign: Number.isFinite(Number(record?.formulaSign)) ? Number(record.formulaSign) : null,
        orientationMatch: record?.orientationMatch || '',
        aliasMatchBasis: record?.aliasMatchBasis || '',
        terminalSide: record?.terminalSide || '',
        terminalMatchBasis: record?.terminalMatchBasis || '',
        polarizationSign: Number.isFinite(Number(record?.polarizationSign)) ? Number(record.polarizationSign) : null,
        polarizationConsistent: record?.polarizationConsistent == null ? null : Boolean(record.polarizationConsistent),
        resolutionMethod: record?.resolutionMethod || '',
        uncertaintyReason: record?.uncertaintyReason || '',
        uncertaintyLabel: record?.uncertaintyLabel || '',
        candidateSlot: record?.candidateSlot || '',
        sourceSide: record?.sourceSide || '',
        targetSide: record?.targetSide || '',
        selectedCandidate: record?.selectedCandidate || '',
        selectedCandidateReason: record?.selectedCandidateReason || '',
        backupUsed: Boolean(record?.backupUsed),
        formulaSignApplied: Number.isFinite(Number(record?.formulaSignApplied)) ? Number(record.formulaSignApplied) : null,
        orientationRule: record?.orientationRule || '',
        resolutionClass,
        resolvedTerminalMismatch: Boolean(record?.resolvedTerminalMismatch),
        candidateConflict: Boolean(record?.candidateConflict),
        displayPct: record?.displayPct ?? null,
        displayPctMode: record?.displayPctMode || '',
        invalidPct: Boolean(record?.invalidPct),
        valueInvalid: Boolean(record?.valueInvalid),
        capacityLimit: Number.isFinite(Number(record?.capacityLimit)) ? Number(record.capacityLimit) : null,
        capacityFilterPassed: typeof record?.capacityFilterPassed === 'boolean' ? Boolean(record.capacityFilterPassed) : null,
        candidateARawValue: Number.isFinite(candidateA?.rawValue) ? Number(candidateA.rawValue) : null,
        candidateATimestamp: candidateA?.timestamp || null,
        candidateAFormula: candidateA?.formulaRaw || '',
        candidateATerminal: candidateA?.terminalSide || '',
        candidateBRawValue: Number.isFinite(candidateB?.rawValue) ? Number(candidateB.rawValue) : null,
        candidateBTimestamp: candidateB?.timestamp || null,
        candidateBFormula: candidateB?.formulaRaw || '',
        candidateBTerminal: candidateB?.terminalSide || ''
      };
    });

    summary.stale = summary.delayed + summary.dead;

    return {
      summary,
      rows,
      mismatches: rows.filter((row) => !String(row.status || '').startsWith('matched-')),
      resolvedWarnings: rows.filter((row) => row.resolvedTerminalMismatch || row.resolutionClass === 'resolved-with-warning')
    };
  }

  exportScadaAuditCsv = function () {
    const report = buildScadaAuditReport();
    if (!report.rows.length) return;
    const header = [
      'Tur',
      'ID',
      'Ad',
      'TM',
      'kV',
      'SCADA ID',
      'Durum',
      'Neden',
      'Kaynak Zaman',
      'Birincil',
      'Ikincil',
      'Gosterim Orani (%)',
      'Oran Modu',
      'Gecersiz Oran',
      'Time State',
      'Time State Label',
      'Time Age Label',
      'Direction Metric',
      'Direction Model',
      'Direction Value',
      'Direction Source',
      'Formula Sign',
      'Orientation Match',
      'Alias Match Basis',
      'Resolution Method',
      'Resolution Class',
      'Uncertainty Reason',
      'Uncertainty Label',
      'Candidate Slot',
      'Source Side',
      'Target Side',
      'Terminal Side',
      'Terminal Match Basis',
      'Polarization Sign',
      'Polarization Consistent',
      'Selected Candidate',
      'Selected Candidate Reason',
      'Backup Used',
      'Resolved Terminal Mismatch',
      'Formula Sign Applied',
      'Orientation Rule',
      'Candidate Conflict',
      'Capacity Limit',
      'Capacity Filter Passed',
      'Value Invalid',
      'Candidate A Raw Value',
      'Candidate A Timestamp',
      'Candidate A Formula',
      'Candidate A Terminal',
      'Candidate B Raw Value',
      'Candidate B Timestamp',
      'Candidate B Formula',
      'Candidate B Terminal'
    ];
    const rows = report.rows.map((row) => [
      row.entityType,
      row.entityId,
      row.entityName,
      row.tmName,
      row.kv,
      row.scadaId,
      row.status,
      row.reason,
      row.sourceTimestamp ? `${row.sourceTimestamp.toLocaleDateString('tr-TR')} ${row.sourceTimestamp.toLocaleTimeString('tr-TR')}` : '',
      Number.isFinite(row.primaryValue) ? row.primaryValue.toFixed(2).replace('.', ',') : '',
      Number.isFinite(row.secondaryValue) ? row.secondaryValue.toFixed(2).replace('.', ',') : '',
      row.invalidPct ? '!' : Number.isFinite(row.displayPct) ? row.displayPct.toFixed(2).replace('.', ',') : '',
      row.displayPctMode,
      row.invalidPct ? 'yes' : '',
      row.timeState,
      row.timeStateLabel,
      row.ageLabel,
      row.directionMetric,
      row.directionModel,
      Number.isFinite(row.directionValue) ? row.directionValue.toFixed(2).replace('.', ',') : '',
      row.directionResolvedBy,
      Number.isFinite(row.formulaSign) ? String(row.formulaSign) : '',
      row.orientationMatch,
      row.aliasMatchBasis,
      row.resolutionMethod,
      row.resolutionClass,
      row.uncertaintyReason,
      row.uncertaintyLabel,
      row.candidateSlot,
      row.sourceSide,
      row.targetSide,
      row.terminalSide,
      row.terminalMatchBasis,
      Number.isFinite(row.polarizationSign) ? String(row.polarizationSign) : '',
      row.polarizationConsistent == null ? '' : (row.polarizationConsistent ? 'yes' : 'no'),
      row.selectedCandidate,
      row.selectedCandidateReason,
      row.backupUsed ? 'yes' : '',
      row.resolvedTerminalMismatch ? 'yes' : '',
      Number.isFinite(row.formulaSignApplied) ? String(row.formulaSignApplied) : '',
      row.orientationRule,
      row.candidateConflict ? 'yes' : '',
      Number.isFinite(row.capacityLimit) ? row.capacityLimit.toFixed(2).replace('.', ',') : '',
      row.capacityFilterPassed == null ? '' : (row.capacityFilterPassed ? 'yes' : 'no'),
      row.valueInvalid ? 'yes' : '',
      Number.isFinite(row.candidateARawValue) ? row.candidateARawValue.toFixed(2).replace('.', ',') : '',
      row.candidateATimestamp ? `${row.candidateATimestamp.toLocaleDateString('tr-TR')} ${row.candidateATimestamp.toLocaleTimeString('tr-TR')}` : '',
      row.candidateAFormula,
      row.candidateATerminal,
      Number.isFinite(row.candidateBRawValue) ? row.candidateBRawValue.toFixed(2).replace('.', ',') : '',
      row.candidateBTimestamp ? `${row.candidateBTimestamp.toLocaleDateString('tr-TR')} ${row.candidateBTimestamp.toLocaleTimeString('tr-TR')}` : '',
      row.candidateBFormula,
      row.candidateBTerminal
    ]);
    if (typeof downloadScadaCsvFile === 'function') {
      downloadScadaCsvFile(`scada_eslesme_denetim_${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    }
    setScadaStatusMessage(`Denetim CSV indirildi: ${report.rows.length} oge.`, report.mismatches.length ? 'warn' : 'info');
    scadaLog('info', `Denetim CSV indirildi: ${report.rows.length} oge, ${report.mismatches.length} mismatch.`);
  };

  function getScadaAuditModalRows(report, filter) {
    if (filter === 'resolved-with-warning') return report.resolvedWarnings || [];
    if (filter === 'orientation-unknown') return report.rows.filter((row) => row.status === 'orientation-unknown');
    if (filter === 'missing') return report.rows.filter((row) => ['missing-config-id', 'missing-source-row'].includes(row.status));
    return report.mismatches || [];
  }

  function getScadaAuditModalListTitle(filter) {
    if (filter === 'resolved-with-warning') return 'Terminal yorumlu cozumler';
    if (filter === 'orientation-unknown') return 'Yon belirsiz kayitlar';
    if (filter === 'missing') return 'Eksik kayitlar';
    return 'Ornek problemli kayitlar';
  }

  showScadaMismatchReportModal = function (filter = '') {
    const report = buildScadaAuditReport();
    if (!report.rows.length) {
      setScadaStatusMessage('Mismatch raporu icin henuz SCADA verisi bulunmuyor.', 'warn');
      return;
    }
    const existing = document.getElementById('scadaAuditModalBackdrop');
    if (existing) existing.remove();
    const modalRows = getScadaAuditModalRows(report, filter);
    const listTitle = getScadaAuditModalListTitle(filter);
    const mismatchItems = modalRows.slice(0, 16).map((row) => `
      <div class="scada-audit-item">
        <strong>${escapeHtml(row.entityName || row.entityId || '-')}</strong>
        <span>${escapeHtml(row.status || '-')} | ${escapeHtml(row.reason || '-')}</span>
        <span>${escapeHtml(row.tmName || '-')}</span>
        <span>SCADA ID: ${escapeHtml(row.scadaId || '-')}</span>
      </div>
    `).join('');
    const backdrop = document.createElement('div');
    backdrop.id = 'scadaAuditModalBackdrop';
    backdrop.className = 'scada-chart-backdrop';
    backdrop.innerHTML = `
      <div class="scada-audit-modal" role="dialog" aria-modal="true" aria-label="SCADA mismatch raporu">
        <div class="scada-chart-header">
          <div>
            <p class="info-kicker">SCADA Mismatch Raporu</p>
            <h3>${escapeHtml(report.summary.metricMode || 'SCADA')}</h3>
          </div>
          <div class="info-actions">
            <button id="btnExportAuditFromModal" class="secondary">Denetim CSV</button>
            <button id="btnCloseScadaAudit" class="info-close" title="Kapat">&times;</button>
          </div>
        </div>
        <div class="scada-audit-summary">
          <div class="scada-audit-stat"><span>Gorunen</span><strong>${report.summary.visibleTotal || 0}</strong></div>
          <div class="scada-audit-stat"><span>Canli / Gecikmeli / Bayat</span><strong>${report.summary.live || 0} / ${report.summary.delayed || 0} / ${report.summary.dead || 0}</strong></div>
          <div class="scada-audit-stat"><span>Uyarili cozum</span><strong>${report.summary.ambiguousWarning || 0}</strong></div>
          <div class="scada-audit-stat"><span>Belirsiz</span><strong>${report.summary.ambiguousLive || 0}</strong></div>
          <div class="scada-audit-stat"><span>Yon Belirsiz</span><strong>${report.summary.orientationUnknown || 0}</strong></div>
          <div class="scada-audit-stat"><span>Terminal yorumlu</span><strong>${report.summary.resolvedWithWarning || 0}</strong></div>
          <div class="scada-audit-stat"><span>Eksik</span><strong>${report.summary.unmatchedTotal || 0}</strong></div>
        </div>
        <div class="scada-chart-body">
          <div class="scada-audit-section">
            <h4>Kaynak ve Sorgu Kontrati</h4>
            <div class="scada-audit-grid">
              <div><span>Ham kaynak satiri</span><strong>${report.summary.rawRows || 0}</strong></div>
              <div><span>Tekil olcum</span><strong>${report.summary.normalizedRows || 0}</strong></div>
              <div><span>Son veri zamani</span><strong>${escapeHtml(report.summary.dataTimestamp ? `${report.summary.dataTimestamp.toLocaleDateString('tr-TR')} ${report.summary.dataTimestamp.toLocaleTimeString('tr-TR')}` : '-')}</strong></div>
              <div><span>Tasima</span><strong>${escapeHtml(report.summary.transportMode || '-')}</strong></div>
              <div><span>Zaman araligi</span><strong>${escapeHtml(report.summary.queryContract?.timeRange || '-')}</strong></div>
              <div><span>Row limit</span><strong>${report.summary.queryContract?.rowLimit || 0}</strong></div>
            </div>
          </div>
          <div class="scada-audit-section">
            <h4>Mismatch Dagilimi</h4>
            <div class="scada-audit-grid">
              <div><span>Config ID yok</span><strong>${report.summary.missingConfigId || 0}</strong></div>
              <div><span>Kaynakta yok</span><strong>${report.summary.missingSourceRow || 0}</strong></div>
              <div><span>Belirsiz canli</span><strong>${report.summary.ambiguousLive || 0}</strong></div>
              <div><span>Uyarili cozum</span><strong>${report.summary.ambiguousWarning || 0}</strong></div>
              <div><span>Terminal yorumlu</span><strong>${report.summary.resolvedWithWarning || 0}</strong></div>
              <div><span>Yon belirsiz</span><strong>${report.summary.orientationUnknown || 0}</strong></div>
              <div><span>Gecikmeli</span><strong>${report.summary.delayed || 0}</strong></div>
              <div><span>Bayat</span><strong>${report.summary.dead || 0}</strong></div>
            </div>
          </div>
          <div class="scada-audit-section">
            <h4>${escapeHtml(listTitle)}</h4>
            <div class="scada-audit-list">
              ${mismatchItems || '<div class="scada-audit-item"><strong>Kayit yok</strong><span>Secili sinifta kayit bulunmadi.</span></div>'}
            </div>
          </div>
        </div>
      </div>
    `;
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) backdrop.remove();
    });
    const mapShell = document.querySelector('.map-shell');
    if (mapShell) mapShell.appendChild(backdrop);
    document.getElementById('btnCloseScadaAudit')?.addEventListener('click', () => backdrop.remove());
    document.getElementById('btnExportAuditFromModal')?.addEventListener('click', exportScadaAuditCsv);
  };

  function getFlowRenderNodeCache() {
    if (!(state.scada.flowRenderNodes instanceof Map)) {
      state.scada.flowRenderNodes = new Map();
    }
    return state.scada.flowRenderNodes;
  }

  function clearRenderedFlowLayer(flowLayer) {
    if (flowLayer) flowLayer.innerHTML = '';
    getFlowRenderNodeCache().clear();
  }

  function buildRenderedFlowPath(row, flow, parallelGroups) {
    if (state.filters.hatDisplayMode === 'sade' || state.filters.hatDisplayMode === 'sade-ayrik') {
      const startTm = state.network.tmMap.get(row.startTm);
      const endTm = state.network.tmMap.get(row.endTm);
      const firstCoord = row.coords[0];
      const lastCoord = row.coords[row.coords.length - 1];
      const startPt = startTm ? screenPoint(startTm.lon, startTm.lat) : screenPoint(firstCoord[0], firstCoord[1]);
      const endPt = endTm ? screenPoint(endTm.lon, endTm.lat) : screenPoint(lastCoord[0], lastCoord[1]);
      let fromPt = startPt;
      let toPt = endPt;
      if (state.filters.hatDisplayMode === 'sade-ayrik' && parallelGroups) {
        const groupKey = [row.startTm || '', row.endTm || ''].sort().join('|||');
        const allHats = parallelGroups.get(groupKey) || [];
        const index = Math.max(0, allHats.findIndex((hat) => String(hat.id) === String(row.id)));
        const spacing = 4;
        const offset = -((allHats.length - 1) * spacing) / 2 + index * spacing;
        const shifted = offsetLine(startPt, endPt, offset);
        fromPt = { x: shifted.sx, y: shifted.sy };
        toPt = { x: shifted.ex, y: shifted.ey };
      }
      if (flow.direction === 'reverse') {
        const tmp = fromPt;
        fromPt = toPt;
        toPt = tmp;
      }
      return `M ${round1(fromPt.x)} ${round1(fromPt.y)} L ${round1(toPt.x)} ${round1(toPt.y)}`;
    }
    const coords = flow.direction === 'reverse' ? [...row.coords].reverse() : row.coords;
    return coords.map((coord, index) => {
      const point = screenPoint(coord[0], coord[1]);
      return `${index ? 'L' : 'M'} ${round1(point.x)} ${round1(point.y)}`;
    }).join(' ');
  }

  function createRenderedFlowNode(row) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const motionPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const arrowGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
    const mpath = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');

    group.setAttribute('data-flow-id', String(row.id));
    motionPath.setAttribute('data-role', 'motion-path');
    motionPath.setAttribute('fill', 'none');
    motionPath.setAttribute('stroke', 'none');
    arrowGroup.setAttribute('data-role', 'arrow-group');
    arrowGroup.style.pointerEvents = 'auto';
    arrowGroup.addEventListener('click', (event) => {
      event.stopPropagation();
      openScadaHatDetails(row, { forceTiles: false });
    });
    attachHoverTooltip(arrowGroup, () => typeof buildHatHoverTooltipHtml === 'function'
      ? buildHatHoverTooltipHtml(row)
      : `<strong>${escapeHtml(row.name || '-')}</strong>`, { owner: `hat:${row.id}` });

    arrow.setAttribute('data-role', 'arrow');
    arrow.setAttribute('points', '0,-4 9,0 0,4');
    anim.setAttribute('data-role', 'arrow-motion');
    anim.setAttribute('repeatCount', 'indefinite');
    anim.setAttribute('rotate', 'auto');
    mpath.setAttribute('data-role', 'arrow-motion-path');

    anim.appendChild(mpath);
    arrowGroup.appendChild(arrow);
    arrowGroup.appendChild(anim);
    group.appendChild(motionPath);
    group.appendChild(arrowGroup);
    return group;
  }

  function patchRenderedFlowNode(node, row, flow, pathData) {
    const pathId = `fp-${row.id}`;
    const arrowColor = flow.color || (SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af');
    const duration = `${getArrowSpeed(Number.isFinite(flow.displayPct) ? flow.displayPct : (Number.isFinite(flow.loadingPct) ? flow.loadingPct : 0))}s`;
    const motionPath = node.querySelector('[data-role="motion-path"]');
    const arrow = node.querySelector('[data-role="arrow"]');
    const anim = node.querySelector('[data-role="arrow-motion"]');
    const mpath = node.querySelector('[data-role="arrow-motion-path"]');
    if (!motionPath || !arrow || !anim || !mpath) return;

    motionPath.setAttribute('id', pathId);
    motionPath.setAttribute('d', pathData);
    arrow.setAttribute('fill', arrowColor);
    anim.setAttribute('dur', duration);
    mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${pathId}`);
    mpath.setAttribute('href', `#${pathId}`);
    node.dataset.renderKey = `${pathData}|${arrowColor}|${duration}`;
  }

  renderFlowLayer = function () {
    const flowLayer = document.getElementById('flowLayer');
    if (!flowLayer) return;
    const modeConfig = getModeConfig();
    if (!state.scada.enabled || modeConfig.domain !== 'hat' || !state.scada.lineFlowByLineId.size) {
      clearRenderedFlowLayer(flowLayer);
      return;
    }
    if (state.scada.currentScope?.mode !== state.filters.scadaMetric) {
      clearRenderedFlowLayer(flowLayer);
      return;
    }
    if (normalizeScadaMapDisplayMode(modeConfig, state.filters.scadaMapDisplayMode) !== 'flow') {
      clearRenderedFlowLayer(flowLayer);
      return;
    }
    if (!state.filters.showHat) {
      clearRenderedFlowLayer(flowLayer);
      return;
    }

    const bounds = currentGeoBounds();
    const visibleHats = getVisibleHats().filter((row) => intersects(row.bbox, bounds));
    const activeIds = new Set();
    const cache = getFlowRenderNodeCache();

    // Pre-compute parallel groups for sade-ayrik mode (O(N) instead of O(N²))
    const parallelGroups = state.filters.hatDisplayMode === 'sade-ayrik'
      ? buildParallelGroups(visibleHats)
      : null;

    visibleHats.forEach((row) => {
      const flow = state.scada.lineFlowByLineId.get(row.id);
      if (!flow || flow.direction === 'unknown') return;
      const flowId = String(row.id);
      const pathData = buildRenderedFlowPath(row, flow, parallelGroups);
      let node = cache.get(flowId);
      if (!node || !node.isConnected) {
        node = createRenderedFlowNode(row);
        cache.set(flowId, node);
      }
      patchRenderedFlowNode(node, row, flow, pathData);
      flowLayer.appendChild(node);
      activeIds.add(flowId);
    });

    cache.forEach((node, flowId) => {
      if (activeIds.has(flowId)) return;
      if (node?.remove) node.remove();
      cache.delete(flowId);
    });
  };

  scadaStartPolling = function () {
    startScadaAutoScheduler();
  };

  scadaStopPolling = function () {
    stopScadaAutoScheduler();
  };

  const baseSetCapacitySeason = setCapacitySeason;
  setCapacitySeason = function (season, activeBtn, inactiveBtn) {
    state.scada.capacitySeason = season;
    if (activeBtn?.classList) activeBtn.classList.add('active');
    if (inactiveBtn?.classList) inactiveBtn.classList.remove('active');

    const measurementRowsById = state.scada.measurementRowsById instanceof Map
      ? state.scada.measurementRowsById
      : new Map();
    const scope = state.scada.currentScope;
    if (measurementRowsById.size && scope?.entities?.length) {
      applyGenericScadaSnapshot(measurementRowsById, scope);
      if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
      if (typeof refreshRankingTable === 'function') refreshRankingTable();
      if (typeof requestRender === 'function') requestRender();
    } else if (typeof baseSetCapacitySeason === 'function') {
      baseSetCapacitySeason(season, activeBtn, inactiveBtn);
      return;
    }

    scadaLog('info', `Kapasite modu: ${season === 'summer' ? 'Yaz' : 'Kis'}`);
  };

  if (!window.__TPYS_SCADA_AUTO_RESUME_BOUND__) {
    window.__TPYS_SCADA_AUTO_RESUME_BOUND__ = true;
    if (typeof document?.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (getDocumentVisibilityState() === 'visible') resumeScadaAutoSchedulerIfOverdue('visibility');
      });
    }
    if (typeof window?.addEventListener === 'function') {
      window.addEventListener('focus', () => resumeScadaAutoSchedulerIfOverdue('focus'));
      window.addEventListener('pageshow', () => resumeScadaAutoSchedulerIfOverdue('pageshow'));
    }
    if (typeof chrome !== 'undefined' && typeof chrome.runtime?.onMessage?.addListener === 'function') {
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'DASHBOARD_MAP_SLOT_ACTIVE') {
          handleDashboardMapSlotActive(message.payload || {});
        } else if (message?.type === 'SCADA_DASHBOARD_SNAPSHOT_UPDATED') {
          restoreScadaDashboardSnapshotFromStorage();
        } else if (message?.type === 'SCADA_FETCH_PROGRESS') {
          handleScadaFetchProgressMessage(message.payload || {});
        }
      });
    }
  }

  function _formatTimeBadge(valueMs) {
    const date = new Date(Number(valueMs));
    if (Number.isNaN(date.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // Selected date range defines the slider travel. Missing/invalid edges fall
  // back to the last 24 hours; future ends are clamped to now.
  function resolveHistoricalRangeBounds(startValue, endValue, nowMs) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const parseValue = (value) => {
      if (value == null || value === '') return NaN;
      const parsed = new Date(String(value)).getTime();
      return Number.isFinite(parsed) ? parsed : NaN;
    };
    const rawEnd = Number.isFinite(parseValue(endValue)) ? parseValue(endValue) : now;
    const endMs = Math.min(rawEnd, now);
    const rawStart = Number.isFinite(parseValue(startValue)) ? parseValue(startValue) : endMs - 24 * 3600 * 1000;
    const startMs = Math.min(rawStart, endMs - 60 * 1000);
    if (startMs >= endMs) return { startMs: endMs - 24 * 3600 * 1000, endMs };
    return { startMs, endMs };
  }

  // Slider/date changes only update the selected instant. Historical data is
  // fetched exclusively by the explicit "Haritada Goster" action.
  function scheduleHistoricalSnapshotQuery(atMs, options = {}) {
    const targetMs = Number(atMs);
    if (!Number.isFinite(targetMs)) return;
    state.scada.historicalSelectedAt = targetMs;
    syncHistoricalTimeSlider();
  }

  function syncHistoricalTimeSlider() {
    const slider = document.getElementById('scadaHistoricalTimeSlider');
    if (!slider) return;
    const bounds = resolveHistoricalRangeBounds(
      document.getElementById('scadaHistoryRangeStart')?.value,
      document.getElementById('scadaHistoryRangeEnd')?.value
    );
    const atMs = Number(state.scada.historicalSelectedAt || state.scada.historicalAt) || bounds.endMs;
    const clamped = Math.max(bounds.startMs, Math.min(bounds.endMs, atMs));
    slider.min = String(bounds.startMs);
    slider.max = String(bounds.endMs);
    slider.step = '300';
    slider.value = String(clamped);
    const atInput = document.getElementById('scadaHistoricalAtInput');
    const isFocused = typeof document.activeElement !== 'undefined' && document.activeElement === atInput;
    if (atInput && !isFocused) atInput.value = formatDateTimeLocalInput(clamped);
  }

  function syncScadaTimeControls() {
    const historical = state.scada.timeMode === 'historical' || state.scada.historicalSelectionOpen;
    const modeButtons = Array.from(document.querySelectorAll('[data-scada-time]'));
    modeButtons.forEach((button) => {
      const isSelected = button.dataset.scadaTime === (historical ? 'historical' : 'live');
      button.classList.toggle('active', isSelected);
    });
    const controls = document.getElementById('scadaHistoricalControls');
    if (controls) controls.classList.toggle('hidden', !historical);
    syncHistoricalTimeSlider();
    updateScadaTimeBadge();
  }

  function updateScadaTimeBadge() {
    const badge = document.getElementById('scadaTimeBadge');
    if (!badge) return;
    if (state.scada.timeMode !== 'historical') {
      badge.classList.add('hidden');
      return;
    }
    const atMs = state.scada.historicalAt;
    const available = Number(state.scada.visibleSummary?.available) || 0;
    const total = state.scada.visibleSummary?.total ?? 0;
    badge.classList.remove('hidden');
    badge.textContent = `GECMIS VERI${atMs ? ` - ${_formatTimeBadge(atMs)}` : ''} | ${available}/${total} veri`;
  }

  async function fetchScadaHistoricalSnapshot(atMs, options = {}) {
    const scope = getCurrentScadaScope({ history: true });
    if (!scope.measurementIds.length) {
      return { ok: false, error: 'Secili mod icin olcum ID bulunamadi.' };
    }
    const result = await chrome.runtime.sendMessage({
      type: 'SCADA_HISTORICAL_SNAPSHOT_FETCH',
      payload: {
        at: atMs,
        baseUrl: SCADA_CONFIG.SUPERSET_ORIGIN,
        dashboardId: SCADA_CONFIG.DASHBOARD_ID,
        chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
        datasourceId: SCADA_CONFIG.DATASOURCE_ID,
        scopeKey: String(scope.filterKey || scope.mode || 'default'),
        elementNames: scope.elementNames,
        measurementIds: scope.measurementIds,
        requestId: options?.requestId || null
      }
    });
    if (!result?.ok || !result.data) {
      return { ok: false, error: result?.error || 'Gecmis an verisi alinamadi.' };
    }
    const rowsByMeasurementId = SCADA_COMMON.normalizeMetricRows(result.data, { elementNames: scope.elementNames });
    return { ok: true, rowsByMeasurementId: rowsByMeasurementId || new Map(), meta: result.meta || {} };
  }

  async function setScadaTimeMode(mode, atMs) {
    state.scada.historicalFetchSeq = state.scada.historicalFetchSeq || 0;
    if (mode === 'live') {
      state.scada.historicalSelectionOpen = false;
      if (state.scada.timeMode === 'live' && !state.scada.pendingHistoricalFetch) {
        syncScadaTimeControls();
        return;
      }
      // Cancel any in-flight historical request; a late response must not land.
      state.scada.historicalFetchSeq += 1;
      state.scada.pendingHistoricalFetch = null;
      if (state.scada.timeMode === 'historical') {
        state.scada.timeMode = 'live';
        state.scada.historicalAt = null;
        const lastLive = state.scada.lastLiveSnapshot;
        state.scada.lastLiveSnapshot = null;
        const scope = getCurrentScadaScope();
        if (lastLive && lastLive.size) {
          applyGenericScadaSnapshot(lastLive, scope);
          state.scada.snapshotAt = null;
          state.scada.sourceKind = 'live';
          if (typeof requestScadaOverlayRender === 'function') requestScadaOverlayRender();
          if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
          if (typeof refreshRankingTable === 'function') refreshRankingTable();
          setScadaStatusMessage('Canli moda donuldu; en son canli veri aninda gosteriliyor.', 'info');
        } else {
          setScadaStatusMessage('Canli moda donuldu; canli veri yenileniyor.', 'info');
        }
        syncScadaTimeControls();
        await scadaDoFetch({ trigger: 'live-return' });
        if (state.scada.enabled && state.scada.autoRefresh) startScadaAutoScheduler();
      } else {
        // Entry fetch was cancelled before it ever committed a historical view.
        state.scada.lastLiveSnapshot = null;
        setScadaStatusMessage('Gecmis sorgusu iptal edildi; canli gorunum korundu.', 'info');
        syncScadaTimeControls();
      }
      return;
    }
    if (mode === 'historical') {
      const targetMs = Number(atMs);
      if (!Number.isFinite(targetMs) || (targetMs > Date.now())) {
        setScadaStatusMessage('Gecmis goruntuleme icin gecmiste bir zaman secin.', 'warn');
        syncScadaTimeControls();
        return;
      }
      state.scada.historicalSelectedAt = targetMs;
      state.scada.historicalSelectionOpen = true;
      if (state.scada.lastLiveSnapshot == null) {
        state.scada.lastLiveSnapshot = state.scada.measurementRowsById instanceof Map
          ? new Map(state.scada.measurementRowsById)
          : new Map();
      }
      const seq = state.scada.historicalFetchSeq + 1;
      state.scada.historicalFetchSeq = seq;
      state.scada.pendingHistoricalFetch = { seq, targetMs };
      const histScopeForOp = getCurrentScadaScope({ history: true });
      const histRequestId = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setScadaOperationMeta({
        requestId: histRequestId,
        kind: 'historical',
        stage: 'prepare',
        progressPct: 6,
        message: 'Gecmis veri yukleniyor',
        totalMeasurements: histScopeForOp.measurementIds.length,
        totalEntities: histScopeForOp.entities.length,
        startedAt: new Date()
      });
      setScadaStatusMessage(`Gecmis mod: ${_formatTimeBadge(targetMs)} anindaki SCADA verisi yukleniyor.`, 'info');
      // Transactional: the snapshot is fetched while the map stays LIVE; the
      // historical mode is committed only after a successful, non-empty reply.
      const result = await fetchScadaHistoricalSnapshot(targetMs, { requestId: histRequestId });
      if (state.scada.historicalFetchSeq !== seq) return; // superseded or cancelled
      state.scada.pendingHistoricalFetch = null;
      const historyScope = getCurrentScadaScope({ history: true });
      if (result.ok && result.rowsByMeasurementId.size) {
        setScadaOperationMeta({ stage: 'normalize', progressPct: 92, message: 'Gecmis veri esleniyor' });
        const wasHistorical = state.scada.timeMode === 'historical';
        state.scada.timeMode = 'historical';
        state.scada.historicalAt = targetMs;
        state.scada.historicalSelectionOpen = false;
        if (!wasHistorical) stopScadaAutoScheduler();
        syncScadaTimeControls();
        applyGenericScadaSnapshot(result.rowsByMeasurementId, historyScope);
        state.scada.snapshotAt = targetMs;
        state.scada.lastFetchAt = new Date();
        state.scada.sourceKind = 'historical';
        if (typeof requestScadaOverlayRender === 'function') requestScadaOverlayRender();
        if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
        if (typeof refreshRankingTable === 'function') refreshRankingTable();
        if (state.scada.pollState) state.scada.pollState.pendingAutoRefresh = false;
        updateScadaTimeBadge();
        setScadaOperationMeta({ stage: 'done', progressPct: 100, message: 'Gecmis veri tamamlandi' });
        const recoveredText = result.meta?.recoveredViaFallback ? ' (genis pencere tamamlamasi ile)' : '';
        setScadaStatusMessage(`Gecmis gorunum: ${_formatTimeBadge(targetMs)} anindaki veri gosteriliyor${recoveredText}`, 'info');
        return;
      }
      // Failure or empty snapshot: never lock the app in historical mode.
      const failMessage = !result.ok
        ? (result.error || 'Gecmis veri alinamadi.')
        : 'Secilen an icin veri bulunamadi; daha yakin bir zaman secin.';
      setScadaOperationMeta({ stage: 'error', progressPct: 100, message: failMessage });
      state.scada.timeMode = 'live';
      state.scada.historicalAt = null;
      state.scada.historicalSelectionOpen = false;
      const lastLive = state.scada.lastLiveSnapshot;
      state.scada.lastLiveSnapshot = null;
      if (lastLive && lastLive.size) {
        applyGenericScadaSnapshot(lastLive, getCurrentScadaScope());
        state.scada.snapshotAt = null;
        state.scada.sourceKind = 'live';
        if (typeof requestScadaOverlayRender === 'function') requestScadaOverlayRender();
        if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
        if (typeof refreshRankingTable === 'function') refreshRankingTable();
      }
      syncScadaTimeControls();
      setScadaStatusMessage(`${failMessage} Canli mod korundu.`, 'warn');
      if (state.scada.enabled && state.scada.autoRefresh) startScadaAutoScheduler();
      void scadaDoFetch({ trigger: 'historical-fallback-live' });
      return;
    }
  }

  function bindScadaTimeModeControls() {
    const timeButtons = Array.from(document.querySelectorAll('[data-scada-time]'));
    timeButtons.forEach((button) => {
      if (button.dataset.boundTime) return;
      button.dataset.boundTime = '1';
      button.addEventListener('click', () => {
        const mode = button.dataset.scadaTime;
        if (mode === 'historical') {
          const input = document.getElementById('scadaHistoricalAtInput');
          const atMs = input?.value ? new Date(input.value).getTime() : NaN;
          if (!Number.isFinite(atMs)) {
            setScadaStatusMessage('Gecmis mod icin once zaman secin.', 'warn');
            return;
          }
          state.scada.historicalSelectionOpen = true;
          scheduleHistoricalSnapshotQuery(atMs);
          syncScadaTimeControls();
          setScadaStatusMessage('Gecmis zaman secildi. Sorgu icin Haritada Goster butonuna basin.', 'info');
        } else {
          setScadaTimeMode('live');
        }
      });
    });
    const showBtn = document.getElementById('btnScadaHistoricalShow');
    if (showBtn && !showBtn.dataset.boundTime) {
      showBtn.dataset.boundTime = '1';
      showBtn.addEventListener('click', () => {
        const input = document.getElementById('scadaHistoricalAtInput');
        const atMs = input?.value ? new Date(input.value).getTime() : NaN;
        if (!Number.isFinite(atMs)) {
          setScadaStatusMessage('Once gecmis zaman secin.', 'warn');
          return;
        }
        setScadaTimeMode('historical', atMs);
      });
    }
    const liveBtn = document.getElementById('btnScadaHistoricalLive');
    if (liveBtn && !liveBtn.dataset.boundTime) {
      liveBtn.dataset.boundTime = '1';
      liveBtn.addEventListener('click', () => setScadaTimeMode('live'));
    }
    const atInput = document.getElementById('scadaHistoricalAtInput');
    if (atInput && !atInput.dataset.boundTime) {
      atInput.dataset.boundTime = '1';
      atInput.value = formatDateTimeLocalInput(state.scada.historicalSelectedAt || state.scada.historicalAt || Date.now());
      atInput.addEventListener('change', () => {
        const atMs = atInput.value ? new Date(atInput.value).getTime() : NaN;
        if (!Number.isFinite(atMs)) {
          setScadaStatusMessage('Gecersiz gecmis zaman secimi.', 'warn');
          syncScadaTimeControls();
          return;
        }
        scheduleHistoricalSnapshotQuery(atMs);
        setScadaStatusMessage('Gecmis zaman secildi. Sorgu icin Haritada Goster butonuna basin.', 'info');
      });
    }
    const nowMs = Date.now();
    const rangeStartInput = document.getElementById('scadaHistoryRangeStart');
    if (rangeStartInput && !rangeStartInput.value) {
      rangeStartInput.value = formatDateTimeLocalInput(nowMs - 24 * 3600 * 1000);
    }
    const rangeEndInput = document.getElementById('scadaHistoryRangeEnd');
    if (rangeEndInput && !rangeEndInput.value) {
      rangeEndInput.value = formatDateTimeLocalInput(nowMs);
    }
    const slider = document.getElementById('scadaHistoricalTimeSlider');
    if (slider && !slider.dataset.boundTime) {
      slider.dataset.boundTime = '1';
      const updateAtInputFromSlider = () => {
        if (!atInput) return;
        const valueMs = Number(slider.value);
        if (Number.isFinite(valueMs)) atInput.value = formatDateTimeLocalInput(valueMs);
      };
      slider.addEventListener('input', () => {
        const valueMs = Number(slider.value);
        if (!Number.isFinite(valueMs)) return;
        updateAtInputFromSlider();
        scheduleHistoricalSnapshotQuery(valueMs);
      });
      slider.addEventListener('pointerup', () => {
        const valueMs = Number(slider.value);
        if (!Number.isFinite(valueMs)) return;
        scheduleHistoricalSnapshotQuery(valueMs);
      });
      slider.addEventListener('change', () => {
        const valueMs = Number(slider.value);
        if (!Number.isFinite(valueMs)) return;
        scheduleHistoricalSnapshotQuery(valueMs);
      });
    }
    ['scadaHistoryRangeStart', 'scadaHistoryRangeEnd'].forEach((rangeId) => {
      const rangeInput = document.getElementById(rangeId);
      if (!rangeInput || rangeInput.dataset.boundTime) return;
      rangeInput.dataset.boundTime = '1';
      rangeInput.addEventListener('change', () => {
        syncHistoricalTimeSlider();
      });
    });
    syncScadaTimeControls();
  }

  const baseInitScadaCard = initScadaCard;
  initScadaCard = function () {
    baseInitScadaCard();
    const buttons = Array.from(document.querySelectorAll('[data-scada-metric]'));
    buttons.forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => {
        const value = button.dataset.scadaMetric;
        if (value === 'active' || value === 'reactive') {
          // MW/MVar row: keep the current entity (defaulting to hat) and only
          // swap the metric part of the combined key.
          const modeConfig = getModeConfig();
          const entity = modeConfig.domain === 'bara' ? 'hat' : modeConfig.domain;
          setScadaMetric(`${entity}-${value}`);
        } else {
          setScadaMetric(value);
        }
      });
    });
    const displayButtons = Array.from(document.querySelectorAll('[data-scada-map-display]'));
    displayButtons.forEach((button) => {
      if (button.dataset.boundDisplay) return;
      button.dataset.boundDisplay = '1';
      button.addEventListener('click', () => setScadaMapDisplayMode(button.dataset.scadaMapDisplay));
    });
    syncScadaMetricButtons();
    syncScadaMapDisplayButtons();
    bindScadaTimeModeControls();
    if (state.scada.enabled && state.scada.autoRefresh) startScadaAutoScheduler();
    updateScadaCardUI();
  };

  globalThis.syncScadaMetricButtons = syncScadaMetricButtons;
  globalThis.syncScadaMapDisplayButtons = syncScadaMapDisplayButtons;
  globalThis.setScadaMetric = setScadaMetric;
  globalThis.setScadaMapDisplayMode = setScadaMapDisplayMode;
  globalThis.setScadaTimeMode = setScadaTimeMode;
  globalThis.syncRankingKvFilterControl = syncRankingKvFilterControl;
  globalThis.applyRankingKvPreset = applyRankingKvPreset;
  globalThis.buildEntityMetricVisual = buildEntityMetricVisual;
  globalThis.buildScadaAuditReport = buildScadaAuditReport;
  if (globalThis.__SCADA_V2_TEST_HOOKS__) {
    Object.assign(globalThis.__SCADA_V2_TEST_HOOKS__, {
      resolveHatMetric,
      buildEntityMetricRecord,
      rebuildLineFlowMap,
      buildVisibleSummary,
      buildScadaAuditReport,
      buildRenderedFlowPath,
      buildScadaQualityChips,
      getHatFlowDirection,
      getHatResolutionClass,
      getReadableTextColor,
      handleDashboardMapSlotActive,
      serializeScadaDashboardSnapshot,
      restoreScadaDashboardSnapshot,
      restoreScadaDashboardSnapshotFromStorage,
      resolveHistoryRange,
      resolveHistoryMetricList,
      parseHistorySeriesByElement,
      buildHistoryEmptyReason,
      buildHistoryCacheKey,
      historyPlotValue,
      buildHistoryCapacitySeries,
      prepareSortedHistoryPoints,
      findNearestSortedPoint,
      _nearestVoltageValue,
      pruneHistoryCache,
      getHistoryCacheEntry,
      setHistoryCacheEntry,
      buildVoltageReferenceLines,
      buildPositiveAxisScale,
      getStaleState,
      getDisplayColor,
      updateScadaTimeBadge,
      enrichMissingScadaIds,
      buildCsvRows,
      exportRankingCsv,
      getCsvMetricContext,
      getCsvSelectedMeasurementId,
      getCsvWarningText,
      translateResolutionMethod,
      getCsvQueryDurationSeconds,
      getCsvHatTerminalData,
      getLiveMetricTypes,
      getHistoryMetricTypes,
      getCurrentScadaScope,
      getVoltagePanelRepresentatives,
      getMetricLegendCounts,
      computeReactiveRatioPct,
      buildPanelRows,
      setRankingEntityFilter,
      resolveHistoricalRangeBounds,
      scheduleHistoricalSnapshotQuery: typeof scheduleHistoricalSnapshotQuery === 'function' ? scheduleHistoricalSnapshotQuery : undefined,
      syncHistoricalTimeSlider: typeof syncHistoricalTimeSlider === 'function' ? syncHistoricalTimeSlider : undefined,
      setScadaTimeMode,
      applyScreenDeclutter: typeof applyScreenDeclutter === 'function' ? applyScreenDeclutter : undefined,
      selectActiveVoltagePerTmLevel: typeof selectActiveVoltagePerTmLevel === 'function' ? selectActiveVoltagePerTmLevel : undefined,
      scadaDoFetch
    });
  }
})();
