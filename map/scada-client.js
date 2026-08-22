/*
 * SCADA client state and transport orchestration.
 * Live transport runs in background.js; this file only manages payloads,
 * normalization, duplicate/stale handling and UI-facing state.
 */

if (!window.chrome || !window.chrome.storage) {
  window.chrome = {
    ...(window.chrome || {}),
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: {
      ...(window.chrome?.runtime || {}),
      getURL: (path) => path,
      sendMessage: async () => ({
        ok: false,
        error: 'Chrome runtime mevcut degil.',
        errorType: 'EXTENSION_UNAVAILABLE',
        authMode: 'session',
        usedFallback: false
      })
    }
  };
}

const SCADA_CONFIG = {
  SUPERSET_ORIGIN: 'https://analytics.teias.gov.tr',
  DASHBOARD_ID: 89,
  CHART_SLICE_ID: 454,
  DATASOURCE_ID: 3,
  QUERY_TIME_RANGE: 'DATEADD(DATETIME("now"), -24, hour) : now',
  LIVE_WINDOW_TIME_RANGE: 'DATEADD(DATETIME("now"), -10, minute) : now',
  QUERY_KV_FILTERS: ['400', '380', '420', '154'],
  QUERY_TEAR_FILTERS: ['Golbasi_YTM'],
  QUERY_ELEMENT_NAME: 'P',
  QUERY_ROW_LIMIT: 50000,
  POLL_INTERVAL_MS: 60000,
  STALE_WARN_SEC: 600,
  STALE_DEAD_SEC: 3600,
  HAT_AMBIGUOUS_ABS_TOLERANCE_MW: 12,
  HAT_AMBIGUOUS_REL_TOLERANCE: 0.08,
  MOCK_ENABLED: false,
  MOCK_DATA_PATH: 'data/mock_scada.json',
  LOADING_THRESHOLDS: [
    { max: 55, color: '#22c55e', label: '0-55%' },
    { max: 65, color: '#eab308', label: '55-65%' },
    { max: 75, color: '#f97316', label: '65-75%' },
    { max: 80, color: '#ef4444', label: '75-80%' },
    { max: 90, color: '#dc2626', label: '80-90%' },
    { max: Infinity, color: '#7c3aed', label: '90%+' }
  ],
  NO_MATCH_COLOR: '#9ca3af',
  UNMATCHED_HAT_COLOR: '#9ca3af',
  STALE_COLOR: '#f59e0b',
  FLOW_MIN_WIDTH: 1.5,
  FLOW_MAX_WIDTH: 6,
  FLOW_PCT_SCALE: 100,
  MAX_LOG_ENTRIES: 200,
  HISTORY_MAX: 20
};

const SCADA_ERROR = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  EMPTY_DATA: 'EMPTY_DATA',
  PARSE_ERROR: 'PARSE_ERROR',
  NO_MATCH_FOUND: 'NO_MATCH_FOUND',
  STALE_DATA: 'STALE_DATA',
  DUPLICATE_MAPPING: 'DUPLICATE_MAPPING',
  TRANSPORT_ERROR: 'TRANSPORT_ERROR',
  EXTENSION_UNAVAILABLE: 'EXTENSION_UNAVAILABLE'
};

function pickPositiveCapacity(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
}

function createScadaHistoryBuffer(limit) {
  return {
    data: new Array(limit),
    head: 0,
    size: 0,
    limit
  };
}

function appendScadaHistoryBuffer(historyValue, entry, limit = SCADA_CONFIG.HISTORY_MAX) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : 1;
  const sourceLimit = Number.isInteger(Number(historyValue?.limit)) && Number(historyValue.limit) > 0
    ? Number(historyValue.limit)
    : max;
  const seed = Array.isArray(historyValue)
    ? historyValue.slice(-max)
    : (historyValue && Array.isArray(historyValue.data))
      ? Array.from({ length: Math.min(Number(historyValue.size) || 0, max) }, (_, index) => {
          const sourceIndex = (Number(historyValue.head) + index) % sourceLimit;
          return historyValue.data[sourceIndex];
        }).filter(Boolean)
      : [];
  const buffer = createScadaHistoryBuffer(max);
  seed.forEach((item) => {
    const insertAt = (buffer.head + buffer.size) % buffer.limit;
    buffer.data[insertAt] = item;
    buffer.size += 1;
  });
  if (buffer.size < buffer.limit) {
    const insertAt = (buffer.head + buffer.size) % buffer.limit;
    buffer.data[insertAt] = entry;
    buffer.size += 1;
  } else {
    buffer.data[buffer.head] = entry;
    buffer.head = (buffer.head + 1) % buffer.limit;
  }
  return buffer;
}

function scadaLog(level, message, detail) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    detail: detail != null ? String(detail).slice(0, 400) : undefined
  };
  if (!state.scada) return;
  state.scada.logs.push(entry);
  if (state.scada.logs.length > SCADA_CONFIG.MAX_LOG_ENTRIES) {
    state.scada.logs.splice(0, state.scada.logs.length - SCADA_CONFIG.MAX_LOG_ENTRIES);
  }
  const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[consoleMethod](`[SCADA ${level.toUpperCase()}]`, message, detail || '');
}

function buildChartPayload() {
  if (typeof SCADA_COMMON?.buildChartPayload === 'function') {
    return SCADA_COMMON.buildChartPayload({
      chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
      datasourceId: SCADA_CONFIG.DATASOURCE_ID,
      timeRange: SCADA_CONFIG.QUERY_TIME_RANGE,
      kvFilters: SCADA_CONFIG.QUERY_KV_FILTERS,
      tearFilters: SCADA_CONFIG.QUERY_TEAR_FILTERS,
      elementName: SCADA_CONFIG.QUERY_ELEMENT_NAME,
      rowLimit: SCADA_CONFIG.QUERY_ROW_LIMIT
    });
  }
  return {
    datasource: { id: SCADA_CONFIG.DATASOURCE_ID, type: 'table' },
    force: true,
    form_data: {
      slice_id: SCADA_CONFIG.CHART_SLICE_ID,
      viz_type: 'table',
      datasource: `${SCADA_CONFIG.DATASOURCE_ID}__table`,
      time_range: SCADA_CONFIG.QUERY_TIME_RANGE,
      row_limit: SCADA_CONFIG.QUERY_ROW_LIMIT
    },
    queries: [{
      time_range: SCADA_CONFIG.QUERY_TIME_RANGE,
      granularity: '__time',
      columns: ['sinsid', 'b1Name', 'b2Name', 'b3Name', 'elementName'],
      metrics: [
        { label: 'MAX(__time)', expressionType: 'SQL', sqlExpression: 'MAX(__time)' },
        { label: 'AVG(maxValue)', expressionType: 'SQL', sqlExpression: 'AVG(maxValue)' }
      ],
      filters: [
        { col: 'elementName', op: '==', val: SCADA_CONFIG.QUERY_ELEMENT_NAME },
        { col: 'b2Name', op: 'IN', val: SCADA_CONFIG.QUERY_KV_FILTERS.slice() },
        { col: 'tear', op: 'IN', val: SCADA_CONFIG.QUERY_TEAR_FILTERS.slice() }
      ],
      orderby: [['MAX(__time)', false]],
      row_limit: SCADA_CONFIG.QUERY_ROW_LIMIT
    }],
    result_format: 'json',
    result_type: 'full'
  };
}

function normalizeScadaRows(rawJson) {
  if (typeof SCADA_COMMON?.normalizeScadaRows === 'function') {
    return SCADA_COMMON.normalizeScadaRows(rawJson);
  }
  return new Map();
}

async function scadaFetchMock() {
  const response = await fetch(chrome.runtime.getURL(SCADA_CONFIG.MOCK_DATA_PATH));
  if (!response.ok) throw new Error('Mock veri dosyasi yuklenemedi.');
  const json = await response.json();
  const mockRows = (json.mockRows || []).map((row) => ({
    sinsid: row.sinsid,
    b1Name: row.b1Name || '',
    b2Name: row.b2Name || '',
    b3Name: row.b3Name || '',
    elementName: row.elementName || 'P',
    'MAX(__time)': new Date().toISOString(),
    'AVG(maxValue)': Number(row.avgMaxValue || row['AVG(maxValue)'] || 0)
  }));
  return {
    ok: true,
    data: { data: mockRows },
    authMode: 'mock',
    usedFallback: false,
    httpStatus: 200
  };
}

function updateScadaTransportState(result) {
  state.scada.lastTransport = {
    at: new Date(),
    authMode: result?.authMode || 'session',
    usedFallback: Boolean(result?.usedFallback),
    httpStatus: result?.httpStatus ?? null
  };
  state.scada.authState = result?.ok ? (result?.authMode || 'session') : 'error';
}

function setScadaStatusMessage(message, level) {
  if (typeof setStatus === 'function' && message) {
    setStatus(message, level || 'info');
  }
}

function getScadaVisibilityFilterKey() {
  const kv = state?.filters?.kv ? [...state.filters.kv].sort().join(',') : '';
  const ytm = state?.filters?.networkYtm ? [...state.filters.networkYtm].sort().join(',') : '';
  return `kv:${kv}|ytm:${ytm}`;
}

function isScadaV2RuntimeActive() {
  return Boolean(state?.scada?.v2RuntimeActive || window.__TPYS_SCADA_V2_RUNTIME_ACTIVE__);
}

function refreshScadaVisibleSummary() {
  const visibleHats = typeof getVisibleHats === 'function' ? getVisibleHats() : [];
  const computed = typeof SCADA_COMMON?.computeVisibleSummary === 'function'
    ? SCADA_COMMON.computeVisibleSummary({
      visibleHats,
      lineFlowByLineId: state.scada.lineFlowByLineId,
      duplicateHatIds: state.scada.duplicateHatIds,
      updatedAt: state.scada.lastDataTimestamp,
      filterKey: getScadaVisibilityFilterKey()
    })
    : {
      total: visibleHats.length,
      matched: 0,
      unmatched: visibleHats.length,
      stale: 0,
      duplicateMapped: 0,
      updatedAt: state.scada.lastDataTimestamp,
      filterKey: getScadaVisibilityFilterKey()
    };
  state.scada.visibleSummary = computed;
  return computed;
}

function getScadaFetchMetaDefaults() {
  return {
    status: 'idle',
    stage: 'idle',
    progressPct: 0,
    triggerType: 'none',
    triggerLabel: '-',
    phaseLabel: 'Hazir',
    phaseMessage: 'Henuz sorgu yapilmadi.',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    rawRows: 0,
    normalizedRows: 0,
    visibleTotal: 0,
    visibleMatched: 0,
    visibleStale: 0,
    visibleUnmatched: 0,
    authMode: '-',
    usedFallback: false,
    httpStatus: null,
    error: null
  };
}

function ensureScadaFetchMeta() {
  if (!state.scada.fetchMeta) {
    state.scada.fetchMeta = getScadaFetchMetaDefaults();
    return state.scada.fetchMeta;
  }
  state.scada.fetchMeta = {
    ...getScadaFetchMetaDefaults(),
    ...state.scada.fetchMeta
  };
  return state.scada.fetchMeta;
}

function updateScadaFetchMeta(patch, refreshUi = true) {
  state.scada.fetchMeta = {
    ...ensureScadaFetchMeta(),
    ...(patch || {})
  };
  if (refreshUi && typeof updateScadaCardUI === 'function') updateScadaCardUI();
  return state.scada.fetchMeta;
}

function getScadaTriggerLabel(triggerType) {
  switch (triggerType) {
    case 'manual':
      return 'Manuel';
    case 'auto':
      return 'Otomatik';
    case 'layer-enable':
      return 'Katman';
    default:
      return 'Sistem';
  }
}

function countScadaTransportRows(rawJson) {
  if (typeof SCADA_COMMON?.findDataArray === 'function') {
    const rows = SCADA_COMMON.findDataArray(rawJson);
    return Array.isArray(rows) ? rows.length : 0;
  }
  return 0;
}

function markScadaFlowsUnavailable(reason, errorType) {
  state.scada.error = reason || 'SCADA verisi alinamadi.';
  state.scada.errorType = errorType || SCADA_ERROR.TRANSPORT_ERROR;

  const nextFlows = new Map();
  state.scada.lineFlowByLineId.forEach((flow, hatId) => {
    nextFlows.set(hatId, {
      ...flow,
      staleState: 'dead',
      color: SCADA_CONFIG.STALE_COLOR,
      unavailable: true
    });
  });
  state.scada.lineFlowByLineId = nextFlows;
  state.scada.staleCount = nextFlows.size;

  if (state.scada.dataQualitySummary) {
    state.scada.dataQualitySummary = {
      ...state.scada.dataQualitySummary,
      stale: nextFlows.size
    };
  }

  refreshScadaVisibleSummary();

  setScadaStatusMessage(state.scada.error, errorType === SCADA_ERROR.AUTH_REQUIRED ? 'warn' : 'error');
}

async function scadaDoFetch(options = {}) {
  const triggerType = options?.trigger || 'manual';
  const triggerLabel = getScadaTriggerLabel(triggerType);

  if (state.scada.fetchInProgress) {
    scadaLog('warn', `SCADA ${triggerLabel.toLowerCase()} yenileme istegi atlandi; mevcut sorgu suruyor.`);
    if (triggerType === 'manual') {
      setScadaStatusMessage('SCADA sorgusu zaten suruyor.', 'warn');
    }
    if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
    return;
  }

  if (triggerType === 'manual' && document.visibilityState === 'hidden') {
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
    if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
    if (typeof refreshRankingTable === 'function') refreshRankingTable();
    return;
  }

  const startedAt = new Date();
  const perfStart = performance.now();
  state.scada.fetchInProgress = true;
  state.scada.error = null;
  state.scada.errorType = null;

  updateScadaFetchMeta({
    status: 'loading',
    stage: 'queued',
    progressPct: 8,
    triggerType,
    triggerLabel,
    phaseLabel: 'Sorgu',
    phaseMessage: `${triggerLabel} yenileme ${startedAt.toLocaleTimeString('tr-TR')} icin baslatildi.`,
    startedAt,
    finishedAt: null,
    durationMs: null,
    rawRows: 0,
    normalizedRows: 0,
    visibleTotal: 0,
    visibleMatched: 0,
    visibleStale: 0,
    visibleUnmatched: 0,
    authMode: state.scada.lastTransport?.authMode || '-',
    usedFallback: false,
    httpStatus: null,
    error: null
  });

  scadaLog('info', `SCADA ${triggerLabel.toLowerCase()} yenileme tetiklendi.`, startedAt.toLocaleTimeString('tr-TR'));
  setScadaStatusMessage(
    triggerType === 'manual'
      ? 'SCADA sorgusu gonderildi, veri bekleniyor.'
      : `SCADA ${triggerLabel.toLowerCase()} yenileme basladi.`,
    'info'
  );

  try {
    updateScadaFetchMeta({
      stage: 'auth',
      progressPct: 24,
      phaseLabel: 'Auth',
      phaseMessage: `${triggerLabel} sorgu icin oturum kontrol ediliyor.`
    });

    const legacyScope = (typeof getCurrentScadaScope === 'function')
      ? (getCurrentScadaScope() || {})
      : {};
    const scope = {
      elementNames: (Array.isArray(legacyScope.elementNames) && legacyScope.elementNames.length)
        ? legacyScope.elementNames
        : [SCADA_CONFIG.QUERY_ELEMENT_NAME],
      measurementIds: Array.isArray(legacyScope.measurementIds) ? legacyScope.measurementIds : []
    };
    const result = SCADA_CONFIG.MOCK_ENABLED
      ? await scadaFetchMock()
      : await chrome.runtime.sendMessage({
        type: 'SCADA_FETCH',
        payload: {
          baseUrl: SCADA_CONFIG.SUPERSET_ORIGIN,
          dashboardId: SCADA_CONFIG.DASHBOARD_ID,
          chartSliceId: SCADA_CONFIG.CHART_SLICE_ID,
          datasourceId: SCADA_CONFIG.DATASOURCE_ID,
          timeRange: SCADA_CONFIG.QUERY_TIME_RANGE,
          kvFilters: SCADA_CONFIG.QUERY_KV_FILTERS,
          tearFilters: SCADA_CONFIG.QUERY_TEAR_FILTERS,
          elementNames: scope.elementNames,
          measurementIds: scope.measurementIds
        }
      });

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
      markScadaFlowsUnavailable(errorMessage, result?.errorType || SCADA_ERROR.NETWORK_ERROR);
      scadaLog('error', 'SCADA fetch hatasi', result?.error || result?.errorType || 'bilinmeyen hata');
      return;
    }

    const rawRows = countScadaTransportRows(result.data);
    updateScadaFetchMeta({
      stage: 'fetch',
      progressPct: 64,
      phaseLabel: 'Veri',
      phaseMessage: `${rawRows} ham satir alindi, normalizasyon basliyor.`,
      rawRows
    });

    const rows = normalizeScadaRows(result.data);
    if (!rows.size) {
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
      scadaLog('warn', 'SCADA verisi bos dondu.');
      return;
    }

    updateScadaFetchMeta({
      stage: 'process',
      progressPct: 86,
      phaseLabel: 'Esleme',
      phaseMessage: `${rows.size} tekil olcum satiri esleniyor.`,
      rawRows,
      normalizedRows: rows.size
    });

    applyScadaSnapshot(rows);
    state.scada.lastFetchAt = new Date();

    const visibleSummary = state.scada.visibleSummary || refreshScadaVisibleSummary();
    const finishedAt = new Date();
    const duplicateCount = state.scada.ambiguousRows.length;
    const fallbackMessage = result.usedFallback
      ? `SCADA auth yedek akis ile yenilendi (${result.authMode}).`
      : `SCADA verisi guncellendi (${result.authMode}).`;
    const qualitySuffix = duplicateCount
      ? ` ${duplicateCount} satir duplicate mapping nedeniyle dislandi.`
      : '';

    updateScadaFetchMeta({
      status: 'success',
      stage: 'done',
      progressPct: 100,
      phaseLabel: 'Tamamlandi',
      phaseMessage: `${triggerLabel} yenileme tamamlandi. ${rows.size} tekil olcum islendi.`,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      rawRows,
      normalizedRows: rows.size,
      visibleTotal: visibleSummary.total || 0,
      visibleMatched: visibleSummary.matched || 0,
      visibleStale: visibleSummary.stale || 0,
      visibleUnmatched: visibleSummary.unmatched || 0,
      error: null
    });

    setScadaStatusMessage(`${fallbackMessage}${qualitySuffix}`, duplicateCount || result.usedFallback ? 'warn' : 'info');

    scadaLog(
      'info',
      `SCADA ${triggerLabel.toLowerCase()} yenileme tamamlandi: ${rawRows} ham, ${rows.size} tekil, gorunen ${visibleSummary.matched || 0}/${visibleSummary.total || 0} canli.`,
      `${result.authMode}${result.usedFallback ? ' fallback' : ''}`
    );
  } catch (error) {
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
    markScadaFlowsUnavailable(errorMessage, SCADA_ERROR.NETWORK_ERROR);
    scadaLog('error', 'SCADA fetch istisnasi', errorMessage);
  } finally {
    state.scada.fetchInProgress = false;
    if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
    if (typeof refreshRankingTable === 'function') refreshRankingTable();
  }
}

function applyScadaSnapshot(rowsBySinsid) {
  if (isScadaV2RuntimeActive()) {
    return refreshScadaVisibleSummary();
  }

  state.scada.rowsBySinsid = rowsBySinsid;
  state.scada.totalRows = rowsBySinsid.size;

  const season = state.scada.capacitySeason || 'winter';
  const nowMs = Date.now();
  const previousFlows = state.scada.lineFlowByLineId;
  const nextFlows = new Map();
  const ambiguousRows = [];

  let matched = 0;
  let unmatched = 0;
  let staleCount = 0;
  let newestTimestamp = null;

  rowsBySinsid.forEach((row, sinsid) => {
    if (row.timestamp && (!newestTimestamp || row.timestamp > newestTimestamp)) {
      newestTimestamp = row.timestamp;
    }

    const hats = state.scada.hatsBySinsid.get(sinsid) || [];
    if (!hats.length) {
      unmatched += 1;
      return;
    }

    if (hats.length > 1) {
      ambiguousRows.push({
        type: 'duplicate-mapping',
        sinsid,
        hatIds: hats.map((hat) => hat.id),
        hatNames: hats.map((hat) => hat.name || hat.id)
      });
      return;
    }

    const hat = hats[0];
    matched += 1;

    const ageSec = row.timestamp ? (nowMs - row.timestamp.getTime()) / 1000 : Infinity;
    let staleState = 'live';
    if (ageSec > SCADA_CONFIG.STALE_DEAD_SEC) {
      staleState = 'dead';
      staleCount += 1;
    } else if (ageSec > SCADA_CONFIG.STALE_WARN_SEC) {
      staleState = 'warn';
      staleCount += 1;
    }

    const absMw = Math.abs(row.activePowerMw);
    const winterCapacity = pickPositiveCapacity(hat.winterCapacityMva);
    const summerCapacity = pickPositiveCapacity(hat.summerCapacityMva);
    const capacityMva = season === 'summer'
      ? pickPositiveCapacity(summerCapacity, winterCapacity)
      : pickPositiveCapacity(winterCapacity, summerCapacity);
    const loadingPct = Number.isFinite(capacityMva) && capacityMva > 0
      ? (absMw / capacityMva) * 100
      : null;
    const flowColor = staleState === 'live'
      ? (Number.isFinite(loadingPct) ? getFlowColor(loadingPct) : (SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af'))
      : SCADA_CONFIG.STALE_COLOR;

    nextFlows.set(hat.id, {
      mw: row.activePowerMw,
      absMw,
      loadingPct,
      capacityMva,
      winterCapacity,
      summerCapacity,
      direction: row.activePowerMw >= 0 ? 'forward' : 'reverse',
      staleState,
      color: flowColor,
      width: getFlowWidth(Number.isFinite(loadingPct) ? loadingPct : 0),
      timestamp: row.timestamp,
      sinsid,
      tmName: row.tmName,
      remoteName: row.remoteName,
      hatName: hat.name || '',
      hatKv: hat.kv || '',
      hatLengthKm: hat.lengthKm || 0,
      hatId: hat.id,
      isMock: SCADA_CONFIG.MOCK_ENABLED,
      unavailable: false
    });

    pushFlowHistory(hat.id, row.activePowerMw, loadingPct, row.timestamp || new Date());
  });

  previousFlows.forEach((flow, hatId) => {
    if (nextFlows.has(hatId)) return;
    nextFlows.set(hatId, {
      ...flow,
      staleState: 'dead',
      color: SCADA_CONFIG.STALE_COLOR,
      unavailable: true
    });
  });

  state.scada.lineFlowByLineId = nextFlows;
  state.scada.matchedLines = matched;
  state.scada.unmatchedRows = unmatched;
  state.scada.staleCount = staleCount;
  state.scada.lastDataTimestamp = newestTimestamp;
  state.scada.ambiguousRows = ambiguousRows;
  state.scada.dataQualitySummary = {
    total: rowsBySinsid.size,
    matched,
    unmatched,
    stale: staleCount,
    duplicates: state.scada.duplicateMappings.size
  };
  refreshScadaVisibleSummary();
}

function pushFlowHistory(hatId, mw, pct, timestamp) {
  if (!state.scada.history) state.scada.history = new Map();
  const history = appendScadaHistoryBuffer(
    state.scada.history.get(hatId),
    { mw, pct, ts: timestamp },
    SCADA_CONFIG.HISTORY_MAX
  );
  state.scada.history.set(hatId, history);
}

function getFlowColor(loadingPct) {
  if (!Number.isFinite(Number(loadingPct))) return SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af';
  for (const threshold of SCADA_CONFIG.LOADING_THRESHOLDS) {
    if (loadingPct <= threshold.max) return threshold.color;
  }
  return SCADA_CONFIG.LOADING_THRESHOLDS[SCADA_CONFIG.LOADING_THRESHOLDS.length - 1].color;
}

function getFlowWidth(loadingPct) {
  const ratio = Math.min(Math.max(loadingPct / SCADA_CONFIG.FLOW_PCT_SCALE, 0), 1);
  return SCADA_CONFIG.FLOW_MIN_WIDTH + ratio * (SCADA_CONFIG.FLOW_MAX_WIDTH - SCADA_CONFIG.FLOW_MIN_WIDTH);
}

function scadaStartPolling() {
  scadaStopPolling();
  scadaLog('info', 'Legacy SCADA polling devre disi; sahiplik scada-v2-runtime.js tarafinda.');
}

function scadaStopPolling() {
  if (!state.scada.pollTimer) return;
  clearInterval(state.scada.pollTimer);
  state.scada.pollTimer = null;
}

function scadaBuildIndex() {
  const hatsBySinsid = new Map();
  const singleMappings = new Map();
  const duplicateMappings = new Map();
  const duplicateHatIds = new Set();

  (state.network?.hatLines || []).forEach((hat) => {
    const sinsid = String(hat.olcumNoktasiIdAktif || '').trim();
    if (!sinsid) return;
    const list = hatsBySinsid.get(sinsid) || [];
    list.push(hat);
    hatsBySinsid.set(sinsid, list);
  });

  hatsBySinsid.forEach((hats, sinsid) => {
    if (hats.length === 1) {
      singleMappings.set(sinsid, hats[0]);
      return;
    }
    duplicateMappings.set(sinsid, hats.slice());
    hats.forEach((hat) => duplicateHatIds.add(hat.id));
  });

  state.scada.hatsBySinsid = hatsBySinsid;
  state.scada.hatBySinsid = singleMappings;
  state.scada.duplicateMappings = duplicateMappings;
  state.scada.duplicateHatIds = duplicateHatIds;
  state.scada.dataQualitySummary = {
    total: 0,
    matched: 0,
    unmatched: 0,
    stale: 0,
    duplicates: duplicateMappings.size
  };
  refreshScadaVisibleSummary();

  if (duplicateMappings.size) {
    scadaLog('warn', `${duplicateMappings.size} duplicate SCADA aktif olcum ID eslemesi bulundu.`);
    setScadaStatusMessage(`${duplicateMappings.size} duplicate SCADA aktif olcum ID eslemesi bulundu. Bu hatlar canli renklendirmeden dislanacak.`, 'warn');
  } else {
    scadaLog('info', `SCADA index olusturuldu: ${singleMappings.size} tekil eslesme.`);
  }
}

async function scadaBoot() {
  scadaBuildIndex();
  scadaLog('info', `SCADA modulu hazir. Mock: ${SCADA_CONFIG.MOCK_ENABLED ? 'acik' : 'kapali'}`);
}
