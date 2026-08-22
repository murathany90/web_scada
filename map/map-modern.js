const HAT_TM_COLORS = { '400': '#dc2626', '154': 'var(--line-154-color)', '66': '#7c3aed', '': '#64748b' };
const BARA_COLORS = { '400': '#2563eb', '154': '#f97316', '66': '#f97316', '': '#6b7280' };
// MOCK CHROME API FOR LOCAL SERVER TESTING
if (!window.chrome || !window.chrome.storage) {
  window.chrome = { 
    ...(window.chrome || {}),
    storage: { local: { get: async () => ({}), set: async () => {} } }, 
    runtime: { getURL: (p) => p } 
  };
}

const TILE_SIZE = 256;
const MAP_PREFS_KEY = 'tpysMapPrefs';
const BARA_SET_CACHE_KEY = 'tpysBaraSetCache';
const TILE_PROVIDERS = {
  light: [
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png'
  ],
  dark: [
    'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
  ]
};
const BARA_YTM_CODE_MAP = {
  OA_YTM: 'Orta Anadolu YTM',
  BA_YTM: 'Bati Anadolu YTM',
  BKA_YTM: 'Bati Akdeniz YTM',
  DA_YTM: 'Dogu Anadolu YTM',
  DAK_YTM: 'Dogu Akdeniz YTM',
  GDA_YTM: 'Guney Dogu Anadolu YTM',
  KBA_YTM: 'Kuzey Bati Anadolu YTM',
  OKA_YTM: 'Orta Karadeniz YTM',
  TRA_YTM: 'Trakya YTM',
  MILLI_YTM: 'Milli YTM'
};

const state = {
  mappingRows: [],
  mappingIndex: { byAlias: new Map(), byId: new Map(), byName: new Map(), byYksName: new Map() },
  network: { tmPoints: [], hatLines: [], ytmNames: [], defaultYtm: 'Orta Anadolu YTM', tmMap: new Map() },
  filters: {
    showBaras: false,
    showTm: true,
    showHat: true,
    showBaraSet: false,
    hatDisplayMode: 'detayli',
    scadaMapDisplayMode: 'flow',
    kv: new Set(['66', '154', '400']),
    networkYtm: new Set(),
    searchKvPins: new Set(),
    searchYtmPins: new Set(),
    effectiveKv: null,
    effectiveYtm: null
  },
  baraSet: {
    loaded: false,
    dateText: '',
    rows: [],
    hour: 0,
    displayMode: 'kv',
    unmatchedNames: [],
    ambiguousNames: []
  },
  selection: { kind: '', id: '', measureSourceId: '', measureTargetIds: [] },
  scadaPanel: {
    page: 1,
    pageSize: 50,
    fontScale: 'normal'
  },
  ui: {
    activeHatPopup: null,
    activeEntityPopup: null,
    clearedSelectionAt: null,
    hoverTooltipTimer: null,
    hoverTooltipOwner: ''
  },
  map: {
    centerLon: 35.2,
    centerLat: 39.0,
    zoom: 6,
    theme: 'light',
    drag: null,
    renderFrame: 0,
    pendingForceTiles: false,
    tileState: {
      rangeKey: '',
      tiles: new Map(),
      darkProviderFailed: false,
      overlayOnly: false
    },
    status: { text: '', level: 'info' }
  },
  scada: {
    enabled: false,
    autoRefresh: true,
    lastFetchAt: null,
    lastDataTimestamp: null,
    totalRows: 0,
    matchedLines: 0,
    unmatchedRows: 0,
    staleCount: 0,
    error: null,
    errorType: null,
    rowsBySinsid: new Map(),
    lineFlowByLineId: new Map(),
    hatsBySinsid: new Map(),
    duplicateMappings: new Map(),
    duplicateHatIds: new Set(),
    ambiguousRows: [],
    lastTransport: null,
    authState: 'idle',
    dataQualitySummary: { total: 0, matched: 0, unmatched: 0, stale: 0, duplicates: 0 },
    visibleSummary: {
      total: 0,
      matched: 0,
      unmatched: 0,
      stale: 0,
      duplicateMapped: 0,
      updatedAt: null,
      filterKey: ''
    },
    fetchMeta: {
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
    },
    hatBySinsid: new Map(),
    capacitySeason: 'winter',
    logs: [],
    pollTimer: null,
    fetchInProgress: false,
    history: new Map()
  }
};

if (typeof window !== 'undefined') {
  window.__TPYS_STATE = state;
}

const el = {
  showBaras: document.getElementById('showBaras'),
  showTm: document.getElementById('showTm'),
  showHat: document.getElementById('showHat'),
  showBaraSet: document.getElementById('showBaraSet'),
  kvFilters: Array.from(document.querySelectorAll('.kv-filter')),
  ytmFilters: document.getElementById('ytmFilters'),
  btnYtmSelectAll: document.getElementById('btnYtmSelectAll'),
  btnYtmSelectNone: document.getElementById('btnYtmSelectNone'),
  btnLoadBaraSet: document.getElementById('btnLoadBaraSet'),
  baraSetFileInput: document.getElementById('baraSetFileInput'),
  baraSetInfo: document.getElementById('baraSetInfo'),
  hourSlider: document.getElementById('hourSlider'),
  hourLabel: document.getElementById('hourLabel'),
  btnHourMinus: document.getElementById('btnHourMinus'),
  btnHourPlus: document.getElementById('btnHourPlus'),
  btnModeKv: document.getElementById('btnModeKv'),
  btnModePu: document.getElementById('btnModePu'),
  searchInput: document.getElementById('searchInput'),
  btnSearch: document.getElementById('btnSearch'),
  btnResetView: document.getElementById('btnResetView'),
  btnFitFilters: document.getElementById('btnFitFilters'),
  baraCount: document.getElementById('baraCount'),
  tmCount: document.getElementById('tmCount'),
  hatCount: document.getElementById('hatCount'),
  mapViewport: document.getElementById('mapViewport'),
  overlaySvg: document.getElementById('overlaySvg'),
  tileLayer: document.getElementById('tileLayer'),
  hatLayer: document.getElementById('hatLayer'),
  measureLayer: document.getElementById('measureLayer'),
  tmLayer: document.getElementById('tmLayer'),
  baraLayer: document.getElementById('baraLayer'),
  baraSetLayer: document.getElementById('baraSetLayer'),
  infoCard: document.getElementById('infoCard'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  btnThemeToggle: document.getElementById('btnThemeToggle'),
  sidebar: document.getElementById('sidebar'),
  btnToggleSidebar: document.getElementById('btnToggleSidebar'),
  kvFilterAll: document.getElementById('kvFilterAll'),
  btnHatModeDetayli: document.getElementById('btnHatModeDetayli'),
  btnHatModeSade: document.getElementById('btnHatModeSade'),
  btnHatModeSadeAyrik: document.getElementById('btnHatModeSadeAyrik'),
  hoverTooltip: document.getElementById('hoverTooltip'),
  mapStatus: document.getElementById('mapStatus'),
  mapShell: document.querySelector('.map-shell')
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const [mappingRows, network, savedBaraSet, savedMapPrefs] = await Promise.all([
      fetchJson('data/mapping.json'),
      fetchJson('data/kml_layers.json'),
      chrome.storage.local.get(BARA_SET_CACHE_KEY),
      chrome.storage.local.get(MAP_PREFS_KEY)
    ]);

    state.mappingRows = (mappingRows || []).filter((row) => Number.isFinite(Number(row.enlem)) && Number.isFinite(Number(row.boylam)));
    state.mappingRows.forEach((row) => { row.fullYtm = resolveBaraYtm(row); });
    state.mappingIndex = buildMappingIndex(state.mappingRows);
    state.network = network || { tmPoints: [], hatLines: [], ytmNames: [], defaultYtm: 'Orta Anadolu YTM' };
    state.network.tmMap = new Map();
    if (state.network.tmPoints) state.network.tmPoints.forEach(tm => state.network.tmMap.set(tm.name, tm));
    restoreMapPrefs(savedMapPrefs?.[MAP_PREFS_KEY]);

    initializeFilters();
    if (savedBaraSet?.[BARA_SET_CACHE_KEY]?.rows?.length) restoreBaraSet(savedBaraSet[BARA_SET_CACHE_KEY]);
    bindEvents();
    applyToolbarIcons();
    applyTheme(state.map.theme, false);
    resetView();
    updateBaraSetInfoText();
    setStatus(`${state.network.defaultYtm || 'Orta Anadolu YTM'} varsayilan filtre olarak acik.`);
    requestRender({ forceTiles: true });
    if (typeof scadaBoot === 'function') scadaBoot();
    if (typeof initScadaCard === 'function') initScadaCard();
  } catch (error) {
    console.error(error);
    setStatus(`Harita yuklenemedi: ${error.message}`, 'error');
  }
}

async function fetchJson(path) {
  if (window.WebSCADATopology && (path === 'data/kml_layers_v2.json' || path === 'data/mapping.json')) {
    return path === 'data/mapping.json'
      ? window.WebSCADATopology.loadMapping()
      : window.WebSCADATopology.loadTopology();
  }
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(`${path} yuklenemedi`);
  return response.json();
}

const ICON_SVGS = {
  themeLight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v2.5M12 18v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M3.5 12H6M18 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8M12 7a5 5 0 1 1 0 10a5 5 0 0 1 0-10Z"/></svg>',
  themeDark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A7.8 7.8 0 0 1 8.8 4A8.5 8.5 0 1 0 20 15.2Z"/></svg>',
  focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.3-5.7M20 4v6h-6"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5v12M5 11h12M20 20l-4.2-4.2"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h12M20 20l-4.2-4.2"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L6 13h4l-1 9l9-12h-5l3-8Z"/></svg>',
  panel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.3-5.7M20 4v6h-6"/></svg>',
  log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h6M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/></svg>',
  source: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 12h10M7 17h6M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M8 10l4 4l4-4M5 19h14"/></svg>',
  fontMinus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h10M9 7h8l3 10"/></svg>',
  fontReset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h6M8 6l4 12M11 12h7"/></svg>',
  fontPlus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h10M9 7h8l3 10M18 6v6M15 9h6"/></svg>'
};

function renderIcon(name) {
  return ICON_SVGS[name] || '';
}

function setIconButtonContent(button, iconName, label, options = {}) {
  if (!button) return;
  const { keepLabelVisible = false } = options;
  button.classList.add('icon-btn');
  const icon = renderIcon(iconName);
  if (!icon) return;
  button.innerHTML = keepLabelVisible
    ? `${icon}<span>${escapeHtml(label || '')}</span>`
    : `${icon}<span class="sr-only">${escapeHtml(label || '')}</span>`;
}

function persistMapPrefs() {
  void chrome.storage.local.set({
    [MAP_PREFS_KEY]: {
      theme: state.map.theme,
      scadaMapDisplayMode: state.filters.scadaMapDisplayMode,
      savedAt: new Date().toISOString()
    }
  });
}

function applyToolbarIcons() {
  setIconButtonContent(el.btnThemeToggle, state.map.theme === 'dark' ? 'themeLight' : 'themeDark', 'Tema');
  setIconButtonContent(el.btnFitFilters, 'focus', 'Filtreye odakla');
  setIconButtonContent(el.btnResetView, 'reset', 'Sifirla');
  setIconButtonContent(el.zoomOutBtn, 'zoomOut', 'Uzaklastir');
  setIconButtonContent(el.zoomInBtn, 'zoomIn', 'Yakinlastir');
  setIconButtonContent(document.querySelector('[data-scada-btn="refresh"]'), 'refresh', 'Yenile', { keepLabelVisible: true });
  setIconButtonContent(document.querySelector('[data-scada-btn="log"]'), 'log', 'Log', { keepLabelVisible: true });
  setIconButtonContent(document.querySelector('[data-scada-btn="mock"]'), 'source', 'Kaynak', { keepLabelVisible: true });
  const boltButton = document.getElementById('btnScadaRanking');
  if (boltButton) {
    boltButton.innerHTML = renderIcon('bolt');
    boltButton.setAttribute('aria-label', 'SCADA Paneli');
  }
}

function restoreMapPrefs(prefs) {
  if (!prefs) return;
  if (prefs.theme === 'dark' || prefs.theme === 'light') state.map.theme = prefs.theme;
  if (['flow', 'heatmap', 'current', 'point', 'point-label', 'box'].includes(prefs.scadaMapDisplayMode)) {
    state.filters.scadaMapDisplayMode = prefs.scadaMapDisplayMode;
  }
}

function buildMappingIndex(rows) {
  if (typeof MAP_COMMON?.buildMappingIndex === 'function') {
    return MAP_COMMON.buildMappingIndex(rows);
  }
  const byAlias = new Map();
  const byId = new Map();
  const byName = new Map();
  const byYksName = new Map();
  rows.forEach((row) => {
    byId.set(String(row.tpysBaraId), row);
    const tpysKey = normalizeText(row.tpysBaraAdi);
    const yksKey = normalizeText(row.yksBaraAdi);
    if (tpysKey) byName.set(tpysKey, [row]);
    if (yksKey) byYksName.set(yksKey, [row]);
    const aliases = new Set([...(row.aliases || []), row.tpysBaraAdi, row.yksBaraAdi, row.oysBaraId]);
    aliases.forEach((alias) => {
      const key = normalizeText(alias);
      if (key) byAlias.set(key, [row]);
    });
  });
  return { byAlias, byId, byName, byYksName };
}

function resolveBaraYtm(row) {
  const raw = String(row.bytm || '').trim().toUpperCase();
  if (!raw) return '';
  return BARA_YTM_CODE_MAP[raw] || raw.replace(/_/g, ' ');
}

function initializeFilters() {
  state.filters.showBaras = false;
  state.filters.showTm = true;
  state.filters.showHat = true;
  state.filters.showBaraSet = false;
  state.filters.kv = new Set(['66', '154', '400']);

  const allYtms = (state.network.ytmNames || []).filter(Boolean);
  const defaultYtm = allYtms.includes('Orta Anadolu YTM') ? 'Orta Anadolu YTM' : (state.network.defaultYtm || allYtms[0] || '');
  state.filters.networkYtm = new Set(defaultYtm ? [defaultYtm] : []);

  el.ytmFilters.innerHTML = '';
  allYtms.forEach((ytm) => {
    const label = document.createElement('label');
    label.className = 'toggle-row';
    label.innerHTML = `<input type="checkbox" data-ytm="${escapeHtml(ytm)}" ${state.filters.networkYtm.has(ytm) ? 'checked' : ''}><span>${escapeHtml(ytm)}</span>`;
    const input = label.querySelector('input');
    input.addEventListener('change', () => {
      clearSearchPins();
      if (input.checked) state.filters.networkYtm.add(ytm);
      else state.filters.networkYtm.delete(ytm);
      invalidateFilterCache();
      handleVisibilityFiltersChanged();
    });
    el.ytmFilters.appendChild(label);
  });
  syncLayerFilterInputs();
  syncKvFilterInputs();
  syncYtmFilterInputs();
}

function bindEvents() {
  el.showBaras.addEventListener('change', () => { clearSearchPins(); state.filters.showBaras = el.showBaras.checked; handleVisibilityFiltersChanged(); });
  el.showTm.addEventListener('change', () => { clearSearchPins(); state.filters.showTm = el.showTm.checked; handleVisibilityFiltersChanged(); });
  el.showHat.addEventListener('change', () => { clearSearchPins(); state.filters.showHat = el.showHat.checked; handleVisibilityFiltersChanged(); });
  el.showBaraSet.addEventListener('change', () => { clearSearchPins(); state.filters.showBaraSet = el.showBaraSet.checked; handleVisibilityFiltersChanged(); });
  if (el.kvFilterAll) {
    el.kvFilterAll.addEventListener('change', (e) => {
      clearSearchPins();
      setKvFilterSelection(checkedKvValues(checkedFromEvent(e.target.checked)));
      invalidateFilterCache();
    });
  }
  el.kvFilters.forEach((input) => input.addEventListener('change', () => {
    clearSearchPins();
    if (input.checked) state.filters.kv.add(input.value);
    else state.filters.kv.delete(input.value);
    syncKvFilterInputs();
    invalidateFilterCache();
    handleVisibilityFiltersChanged();
  }));
  if (el.btnYtmSelectAll) {
    el.btnYtmSelectAll.addEventListener('click', () => {
      clearSearchPins();
      setYtmFilterSelection((state.network.ytmNames || []).filter(Boolean));
    });
  }
  if (el.btnYtmSelectNone) {
    el.btnYtmSelectNone.addEventListener('click', () => {
      clearSearchPins();
      setYtmFilterSelection([]);
    });
  }
  el.btnLoadBaraSet.addEventListener('click', () => el.baraSetFileInput.click());
  el.baraSetFileInput.addEventListener('change', onBaraSetFileChange);
  el.hourSlider.addEventListener('input', () => setHour(Number(el.hourSlider.value || 0)));
  el.btnHourMinus.addEventListener('click', () => setHour(Math.max(0, state.baraSet.hour - 1)));
  el.btnHourPlus.addEventListener('click', () => setHour(Math.min(23, state.baraSet.hour + 1)));
  el.btnModeKv.addEventListener('click', () => setDisplayMode('kv'));
  el.btnModePu.addEventListener('click', () => setDisplayMode('pu'));
  el.btnSearch.addEventListener('click', doSearch);
  el.searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') doSearch(); });
  el.btnResetView.addEventListener('click', () => {
    hideInfo();
    resetView();
    requestRender({ forceTiles: true });
  });
  if (el.btnFitFilters) {
    el.btnFitFilters.addEventListener('click', () => {
      hideInfo();
      fitFiltersView();
    });
  }
  el.zoomInBtn.addEventListener('click', () => changeZoom(1));
  el.zoomOutBtn.addEventListener('click', () => changeZoom(-1));
  el.btnThemeToggle.addEventListener('click', toggleTheme);
  el.mapViewport.addEventListener('mousedown', startDrag);
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', endDrag);
  el.mapViewport.addEventListener('mouseleave', endDrag);
  el.mapViewport.addEventListener('wheel', onWheel, { passive: false });
  el.mapViewport.addEventListener('click', (event) => {
    if (isBlankMapClickTarget(event.target)) clearMapSelection({ keepPanelOpen: true });
  });
  window.addEventListener('resize', () => requestRender({ forceTiles: true }));
  document.addEventListener('keydown', handleDashboardEscapeKey, true);

  if (el.btnToggleSidebar && el.sidebar) {
    el.btnToggleSidebar.addEventListener('click', () => {
      el.sidebar.classList.toggle('collapsed');
      setTimeout(() => requestRender({ forceTiles: true }), 310);
    });
  }

  if (el.btnHatModeDetayli && el.btnHatModeSade) {
    const hatModeBtns = [el.btnHatModeDetayli, el.btnHatModeSade, el.btnHatModeSadeAyrik].filter(Boolean);
    function setHatMode(mode) {
      state.filters.hatDisplayMode = mode;
      invalidateVisibleEntityCache();
      hatModeBtns.forEach(b => b.classList.remove('active'));
      if (mode === 'detayli') el.btnHatModeDetayli.classList.add('active');
      else if (mode === 'sade') el.btnHatModeSade.classList.add('active');
      else if (mode === 'sade-ayrik' && el.btnHatModeSadeAyrik) el.btnHatModeSadeAyrik.classList.add('active');
      requestRender();
    }
    el.btnHatModeDetayli.addEventListener('click', () => setHatMode('detayli'));
    el.btnHatModeSade.addEventListener('click', () => setHatMode('sade'));
    if (el.btnHatModeSadeAyrik) el.btnHatModeSadeAyrik.addEventListener('click', () => setHatMode('sade-ayrik'));
  }
}

function checkedFromEvent(checked) {
  return Boolean(checked);
}

function handleDashboardEscapeKey(event) {
  if (event.key !== 'Escape') return;
  try {
    if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'DASHBOARD_STOP', reason: 'esc-map' });
    }
  } catch {
  }
}

function checkedKvValues(checked) {
  return checked ? el.kvFilters.map((cb) => cb.value) : [];
}

function syncLayerFilterInputs() {
  if (el.showBaras) el.showBaras.checked = state.filters.showBaras;
  if (el.showTm) el.showTm.checked = state.filters.showTm;
  if (el.showHat) el.showHat.checked = state.filters.showHat;
  if (el.showBaraSet) el.showBaraSet.checked = state.filters.showBaraSet;
}

function syncKvFilterInputs() {
  el.kvFilters.forEach((cb) => {
    cb.checked = state.filters.kv.has(cb.value);
  });
  if (el.kvFilterAll) el.kvFilterAll.checked = el.kvFilters.length > 0 && el.kvFilters.every((cb) => cb.checked);
  if (typeof syncRankingKvFilterControl === 'function') syncRankingKvFilterControl();
}

function syncYtmFilterInputs() {
  const inputs = Array.from(el.ytmFilters.querySelectorAll('input[data-ytm]'));
  inputs.forEach((input) => {
    input.checked = state.filters.networkYtm.has(input.dataset.ytm || '');
  });
}

function setKvFilterSelection(values) {
  state.filters.kv = new Set((values || []).map((value) => String(value).trim()).filter(Boolean));
  syncKvFilterInputs();
  invalidateFilterCache();
  handleVisibilityFiltersChanged();
}

function setYtmFilterSelection(values) {
  state.filters.networkYtm = new Set((values || []).map((value) => String(value).trim()).filter(Boolean));
  syncYtmFilterInputs();
  invalidateFilterCache();
  handleVisibilityFiltersChanged();
}

function handleVisibilityFiltersChanged() {
  invalidateVisibleEntityCache();
  if (typeof refreshScadaVisibleSummary === 'function') refreshScadaVisibleSummary();
  if (typeof refreshRankingTable === 'function') refreshRankingTable();
  if (typeof updateScadaCardUI === 'function') updateScadaCardUI();
  requestRender();
}

function applyTheme(theme, persist = true) {
  state.map.theme = theme === 'dark' ? 'dark' : 'light';
  state.map.tileState.darkProviderFailed = false;
  state.map.tileState.overlayOnly = false;
  state.map.tileState.rangeKey = '';
  document.documentElement.dataset.theme = state.map.theme;
  applyToolbarIcons();
  const rankingPanel = document.getElementById('rankingPanel');
  if (rankingPanel) rankingPanel.classList.toggle('light-mode', state.map.theme === 'light');
  if (persist) void chrome.storage.local.set({ [MAP_PREFS_KEY]: { theme: state.map.theme, savedAt: new Date().toISOString() } });
  applyToolbarIcons();
  if (persist) persistMapPrefs();
}

function toggleTheme() {
  applyTheme(state.map.theme === 'dark' ? 'light' : 'dark');
  requestRender({ forceTiles: true });
}

function restoreBaraSet(cache) {
  const unmatchedNames = [];
  const ambiguousNames = [];
  const rows = Array.isArray(cache.rows) ? cache.rows.map((row) => {
    const match = MAP_COMMON?.resolveBaraSetMatch
      ? MAP_COMMON.resolveBaraSetMatch(row, state.mappingIndex)
      : { status: 'matched', row: state.mappingIndex.byId.get(String(row.tpysBaraId || '')) || null };
    if (match.status === 'ambiguous') {
      ambiguousNames.push(row.sourceName || row.tpysBaraAdi || row.tpysBaraId || '-');
      return null;
    }
    const mapping = match.row;
    if (!mapping) {
      unmatchedNames.push(row.sourceName || row.tpysBaraAdi || row.tpysBaraId || '-');
      return null;
    }
    return {
      ...row,
      tpysBaraId: mapping.tpysBaraId,
      tpysBaraAdi: mapping.tpysBaraAdi,
      gerilim: String(mapping.gerilim || row.gerilim || '').trim(),
      ytm: mapping.fullYtm || row.ytm || '',
      enlem: Number(mapping.enlem),
      boylam: Number(mapping.boylam),
      mapping
    };
  }).filter(Boolean) : [];

  if (!rows.length) return;
  state.baraSet.loaded = true;
  state.baraSet.dateText = cache.dateText || '';
  state.baraSet.rows = rows;
  state.baraSet.hour = Number.isFinite(Number(cache.hour)) ? Number(cache.hour) : 0;
  state.baraSet.displayMode = cache.displayMode === 'pu' ? 'pu' : 'kv';
  state.baraSet.unmatchedNames = cache.unmatchedNames || unmatchedNames;
  state.baraSet.ambiguousNames = cache.ambiguousNames || ambiguousNames;
  state.filters.showBaraSet = true;
  el.showBaraSet.checked = true;
  el.hourSlider.value = String(state.baraSet.hour);
  syncHourLabel();
  syncModeButtons();
}

async function onBaraSetFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const parsed = parseBaraSetWorkbook(arrayBuffer);
    const unmatchedNames = [];
    const ambiguousNames = [];
    const rows = parsed.rows.map((row) => {
      const match = MAP_COMMON?.resolveBaraSetMatch
        ? MAP_COMMON.resolveBaraSetMatch(row, state.mappingIndex)
        : { status: 'matched', row: state.mappingIndex.byId.get(String(row.tpysBaraId || '')) || null };
      if (match.status === 'ambiguous') {
        ambiguousNames.push(row.sourceName || row.tpysBaraAdi || row.tpysBaraId || '-');
        return null;
      }
      const mapping = match.row;
      if (!mapping) {
        unmatchedNames.push(row.sourceName || row.tpysBaraAdi || row.tpysBaraId || '-');
        return null;
      }
      return {
        sourceName: row.sourceName,
        tpysBaraId: mapping.tpysBaraId,
        tpysBaraAdi: mapping.tpysBaraAdi,
        gerilim: String(mapping.gerilim || row.gerilim || '').trim(),
        ytm: mapping.fullYtm || '',
        il: mapping.il || row.il || '',
        enlem: Number(mapping.enlem),
        boylam: Number(mapping.boylam),
        values: row.values,
        drops: row.drops,
        mapping
      };
    }).filter(Boolean);

    state.baraSet.loaded = rows.length > 0;
    state.baraSet.dateText = parsed.dateText;
    state.baraSet.rows = rows;
    state.baraSet.unmatchedNames = unmatchedNames;
    state.baraSet.ambiguousNames = ambiguousNames;
    state.filters.showBaraSet = rows.length > 0;
    el.showBaraSet.checked = rows.length > 0;
    syncHourLabel();
    syncModeButtons();
    updateBaraSetInfoText();
    await persistBaraSetCache();
    setStatus(`Bara Set yuklendi. Eslesen: ${rows.length}, eslesmeyen: ${state.baraSet.unmatchedNames.length}, belirsiz: ${state.baraSet.ambiguousNames.length}.`, ambiguousNames.length || unmatchedNames.length ? 'warn' : 'info');
    requestRender();
  } catch (error) {
    console.error(error);
    setStatus(`Bara Set yuklenemedi: ${error.message}`, 'error');
  } finally {
    event.target.value = '';
  }
}

async function persistBaraSetCache() {
  if (!state.baraSet.loaded) return;
  await chrome.storage.local.set({
    [BARA_SET_CACHE_KEY]: {
      dateText: state.baraSet.dateText,
      rows: state.baraSet.rows.map((row) => ({
        sourceName: row.sourceName,
        tpysBaraId: row.tpysBaraId,
        tpysBaraAdi: row.tpysBaraAdi,
        gerilim: row.gerilim,
        ytm: row.ytm,
        il: row.il,
        values: row.values,
        drops: row.drops
      })),
      unmatchedNames: state.baraSet.unmatchedNames,
      ambiguousNames: state.baraSet.ambiguousNames,
      hour: state.baraSet.hour,
      displayMode: state.baraSet.displayMode,
      loadedAt: new Date().toISOString()
    }
  });
}

function parseBaraSetWorkbook(arrayBuffer) {
  if (typeof XLSX === 'undefined') throw new Error('XLSX kutuphanesi yuklenemedi.');
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const dateText = String(rows?.[0]?.[0] || '').trim();
  const dataRows = [];
  for (let i = 2; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const sourceName = String(row[0] || '').trim();
    if (!sourceName) continue;
    const values = [];
    const drops = [];
    for (let hour = 0; hour < 24; hour += 1) {
      values.push(parseMaybeNumber(row[4 + hour]));
      drops.push(parseMaybeNumber(row[28 + hour]));
    }
    dataRows.push({
      sourceName,
      gerilim: String(row[1] || '').trim(),
      bytm: String(row[2] || '').trim(),
      il: String(row[3] || '').trim(),
      values,
      drops
    });
  }
  return { dateText, rows: dataRows };
}

function setHour(hour) {
  state.baraSet.hour = Math.max(0, Math.min(23, hour));
  el.hourSlider.value = String(state.baraSet.hour);
  syncHourLabel();
  if (state.baraSet.loaded) void persistBaraSetCache();
  requestRender();
}

function setDisplayMode(mode) {
  state.baraSet.displayMode = mode === 'pu' ? 'pu' : 'kv';
  syncModeButtons();
  if (state.baraSet.loaded) void persistBaraSetCache();
  requestRender();
}

function syncModeButtons() {
  el.btnModeKv.classList.toggle('active', state.baraSet.displayMode === 'kv');
  el.btnModePu.classList.toggle('active', state.baraSet.displayMode === 'pu');
}

function syncHourLabel() {
  el.hourLabel.textContent = hourLabel(state.baraSet.hour);
}

function updateBaraSetInfoText() {
  if (!state.baraSet.loaded) {
    el.baraSetInfo.textContent = 'Henuz yuklenmedi.';
    return;
  }
  const text = `${state.baraSet.dateText || 'Bara Set'} | Eslesen: ${state.baraSet.rows.length}${state.baraSet.unmatchedNames.length ? ` | Eslesmeyen: ${state.baraSet.unmatchedNames.length}` : ''}${state.baraSet.ambiguousNames.length ? ` | Belirsiz: ${state.baraSet.ambiguousNames.length}` : ''}`;
  el.baraSetInfo.textContent = text;
}

function getEffectiveKvFilter() {
  if (state.filters.effectiveKv) return state.filters.effectiveKv;
  const set = new Set([...state.filters.kv, ...state.filters.searchKvPins]);
  state.filters.effectiveKv = set;
  return set;
}

function getEffectiveYtmFilter() {
  if (state.filters.effectiveYtm) return state.filters.effectiveYtm;
  const set = new Set([...state.filters.networkYtm, ...state.filters.searchYtmPins]);
  state.filters.effectiveYtm = set;
  return set;
}

function invalidateFilterCache() {
  state.filters.effectiveKv = null;
  state.filters.effectiveYtm = null;
  invalidateVisibleEntityCache();
}

function invalidateVisibleEntityCache() {
  if (!state.network) return;
  const cache = state.network.visibleEntityCache || { revision: 0 };
  cache.revision = Number(cache.revision || 0) + 1;
  cache.hats = null;
  cache.tms = null;
  cache.baras = null;
  cache.trafos = null;
  state.network.visibleEntityCache = cache;
}

function getVisibleEntityList(kind, compute) {
  const cache = state.network.visibleEntityCache || (state.network.visibleEntityCache = { revision: 0 });
  if (Array.isArray(cache[kind])) return cache[kind];
  const list = compute();
  cache[kind] = list;
  return list;
}

function clearSearchPins() {
  if (!state.filters.searchKvPins.size && !state.filters.searchYtmPins.size) return;
  state.filters.searchKvPins.clear();
  state.filters.searchYtmPins.clear();
  invalidateFilterCache();
}

function ensureSearchVisibility(target) {
  const changes = [];
  const kv = String(target?.kv || '').trim();
  if (kv && !state.filters.kv.has(kv)) {
    state.filters.searchKvPins.add(kv);
    changes.push(`${kv} kV`);
  }
  const ytmCandidates = (Array.isArray(target?.ytmNames) ? target.ytmNames : [target?.ytm])
    .filter(Boolean)
    .map((value) => String(value).trim());
  const effectiveYtm = getEffectiveYtmFilter();
  if (ytmCandidates.length && !ytmCandidates.some((value) => effectiveYtm.has(value))) {
    ytmCandidates.forEach((value) => state.filters.searchYtmPins.add(value));
    changes.push(ytmCandidates.join(' / '));
  }
  invalidateFilterCache();
  return changes;
}

function isSelectionForceVisible(kind) {
  return state.selection.kind === kind && String(state.selection.id || '').trim() !== '';
}

function isBlankMapClickTarget(target) {
  if (!target) return true;
  if (target.closest('.sidebar, #infoCard, #rankingPanel, .hover-tooltip, #scadaChartModalBackdrop, .scada-audit-modal, .floating-bolt')) {
    return false;
  }
  if (target.closest('path.hat-line, #flowLayer g, .tm-point, .bara-point, .bara-set-group, .trafo-marker, .bara-node-marker, .hover-hit-target, .voltage-overlay-item, .trafo-overlay-item, .voltage-overlay-group, .trafo-overlay-group, .voltage-heatmap-group, .trafo-heatmap-group')) {
    return false;
  }
  return true;
}

function clearMapSelection(options = {}) {
  const keepPanelOpen = options.keepPanelOpen !== false;
  state.ui.clearedSelectionAt = new Date().toISOString();
  state.ui.activeEntityPopup = null;
  state.ui.activeHatPopup = null;
  state.selection = { kind: '', id: '', measureSourceId: '', measureTargetIds: [] };
  if (el.infoCard) {
    el.infoCard.className = 'info-card hidden';
    el.infoCard.innerHTML = '';
    el.infoCard.style.left = '';
    el.infoCard.style.top = '';
  }
  if (typeof refreshRankingTable === 'function' && keepPanelOpen) refreshRankingTable();
  requestRender();
}

function setStatus(text, level = 'info') {
  state.map.status = { text: String(text || '').trim(), level };
  if (el.mapStatus) {
    el.mapStatus.textContent = state.map.status.text || 'Hazir.';
    el.mapStatus.className = `status-pill status-${level} top-gap`;
  }
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log']('Map Status:', state.map.status.text);
}

function cancelHoverTooltipHide() {
  if (state.ui.hoverTooltipTimer) {
    clearTimeout(state.ui.hoverTooltipTimer);
    state.ui.hoverTooltipTimer = null;
  }
}

function hideHoverTooltipNow() {
  cancelHoverTooltipHide();
  state.ui.hoverTooltipOwner = '';
  if (!el.hoverTooltip) return;
  el.hoverTooltip.classList.add('hidden');
}

function scheduleHoverTooltipHide(owner, delayMs = 1200) {
  if (!el.hoverTooltip) return;
  cancelHoverTooltipHide();
  state.ui.hoverTooltipTimer = setTimeout(() => {
    if (state.ui.hoverTooltipOwner !== owner) return;
    hideHoverTooltipNow();
  }, delayMs);
}

function resolveHoverTooltipHtml(htmlOrResolver, event, element) {
  if (typeof htmlOrResolver === 'function') {
    return htmlOrResolver(event, element);
  }
  return htmlOrResolver;
}

function positionHoverTooltip(event) {
  if (!el.hoverTooltip || !event) return;
  const tooltip = el.hoverTooltip;
  const margin = 14;
  const tooltipWidth = tooltip.offsetWidth || 260;
  const tooltipHeight = tooltip.offsetHeight || 80;
  let left = event.clientX + 14;
  let top = event.clientY - 10;
  if (left + tooltipWidth > window.innerWidth - margin) {
    left = Math.max(margin, event.clientX - tooltipWidth - 14);
  }
  if (top + tooltipHeight > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - tooltipHeight - margin);
  }
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function showHoverTooltip(owner, htmlOrResolver, event, element) {
  if (!el.hoverTooltip) return;
  const html = resolveHoverTooltipHtml(htmlOrResolver, event, element);
  if (!String(html || '').trim()) {
    hideHoverTooltipNow();
    return;
  }
  cancelHoverTooltipHide();
  state.ui.hoverTooltipOwner = owner;
  el.hoverTooltip.innerHTML = html;
  el.hoverTooltip.classList.remove('hidden');
  positionHoverTooltip(event);
}

function attachHoverTooltip(element, html, options = {}) {
  if (!el.hoverTooltip) return;
  const owner = String(options.owner || element.id || element.dataset.hoverOwner || `hover-${Math.random().toString(36).slice(2)}`);
  const hideDelayMs = Number.isFinite(Number(options.hideDelayMs)) ? Number(options.hideDelayMs) : 1200;
  element.addEventListener('mouseenter', (event) => {
    showHoverTooltip(owner, html, event, element);
  });
  element.addEventListener('mousemove', (e) => {
    if (state.ui.hoverTooltipOwner === owner && !el.hoverTooltip.classList.contains('hidden')) {
      positionHoverTooltip(e);
    }
  });
  element.addEventListener('mouseleave', () => {
    scheduleHoverTooltipHide(owner, hideDelayMs);
  });
}

function requestRender({ forceTiles = false } = {}) {
  if (forceTiles) state.map.pendingForceTiles = true;
  if (state.map.renderFrame) return;
  state.map.renderFrame = requestAnimationFrame(() => {
    const mustForceTiles = state.map.pendingForceTiles;
    state.map.pendingForceTiles = false;
    state.map.renderFrame = 0;
    renderAll(mustForceTiles);
  });
}

function resetView() {
  const points = [];
  state.mappingRows.forEach((row) => points.push([Number(row.boylam), Number(row.enlem)]));
  state.network.tmPoints.forEach((row) => points.push([Number(row.lon), Number(row.lat)]));
  state.network.hatLines.forEach((row) => {
    if (row.bbox?.length === 4) points.push([row.bbox[0], row.bbox[1]], [row.bbox[2], row.bbox[3]]);
  });
  if (!points.length) return;
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  state.map.centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  state.map.centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  state.map.zoom = fitZoom(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats));
  state.map.tileState.rangeKey = '';
}

function fitFiltersView() {
  const points = [];
  getVisibleBaras().forEach((row) => points.push([Number(row.boylam), Number(row.enlem)]));
  getVisibleTms().forEach((row) => points.push([Number(row.lon), Number(row.lat)]));
  getVisibleHats().forEach((row) => {
    if (row.bbox?.length === 4) points.push([row.bbox[0], row.bbox[1]], [row.bbox[2], row.bbox[3]]);
  });
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
}

function fitZoom(minLon, minLat, maxLon, maxLat) {
  const width = el.mapViewport.clientWidth || 1200;
  const height = el.mapViewport.clientHeight || 800;
  for (let zoom = 11; zoom >= 5; zoom -= 1) {
    const a = project(minLon, maxLat, zoom);
    const b = project(maxLon, minLat, zoom);
    if (Math.abs(b.x - a.x) <= width * 0.88 && Math.abs(b.y - a.y) <= height * 0.82) return zoom;
  }
  return 6;
}

function changeZoom(delta) {
  state.map.zoom = Math.max(5, Math.min(13, +(state.map.zoom + delta).toFixed(2)));
  state.map.tileState.rangeKey = '';
  requestRender({ forceTiles: true });
}

function startDrag(event) {
  if (event.button !== 0) return;
  state.map.drag = {
    startX: event.clientX,
    startY: event.clientY,
    startCenter: project(state.map.centerLon, state.map.centerLat, state.map.zoom)
  };
  el.mapViewport.classList.add('dragging');
}

function onDrag(event) {
  if (!state.map.drag) return;
  const dx = event.clientX - state.map.drag.startX;
  const dy = event.clientY - state.map.drag.startY;
  const world = { x: state.map.drag.startCenter.x - dx, y: state.map.drag.startCenter.y - dy };
  const point = unproject(world.x, world.y, state.map.zoom);
  state.map.centerLon = point.lon;
  state.map.centerLat = point.lat;
  requestRender();
}

function endDrag() {
  if (!state.map.drag) return;
  state.map.drag = null;
  el.mapViewport.classList.remove('dragging');
  requestRender({ forceTiles: true });
}

function onWheel(event) {
  event.preventDefault();
  changeZoom(event.deltaY < 0 ? 0.35 : -0.35);
}

function renderAll(forceTiles = false) {
  renderTiles(forceTiles);
  renderHatLayer();
  if (typeof renderFlowLayer === 'function') renderFlowLayer();
  renderTmLayer();
  renderBaraLayer();
  renderBaraSetLayer();
  renderMeasureLayer();
  updateSummary();
  syncInfoCardPosition();
}

function getActiveProviderKey() {
  if (state.map.tileState.overlayOnly) return '';
  return state.map.theme === 'dark' && !state.map.tileState.darkProviderFailed ? 'dark' : 'light';
}

function computeTileMetrics() {
  const width = el.mapViewport.clientWidth || 1200;
  const height = el.mapViewport.clientHeight || 800;
  const zoomParts = typeof MAP_COMMON?.splitZoom === 'function'
    ? MAP_COMMON.splitZoom(state.map.zoom)
    : { tileZoom: Math.max(0, Math.floor(state.map.zoom)), scale: 2 ** (state.map.zoom - Math.floor(state.map.zoom)) };
  const centerBase = project(state.map.centerLon, state.map.centerLat, zoomParts.tileZoom);
  const topLeftX = centerBase.x - width / (2 * zoomParts.scale);
  const topLeftY = centerBase.y - height / (2 * zoomParts.scale);
  return {
    width,
    height,
    zoom: state.map.zoom,
    tileZoom: zoomParts.tileZoom,
    scale: zoomParts.scale,
    centerBase,
    limit: 2 ** zoomParts.tileZoom,
    topLeftX,
    topLeftY,
    tileMinX: Math.floor(topLeftX / TILE_SIZE),
    tileMinY: Math.floor(topLeftY / TILE_SIZE),
    tileMaxX: Math.floor((topLeftX + width) / TILE_SIZE),
    tileMaxY: Math.floor((topLeftY + height) / TILE_SIZE)
  };
}

function renderTiles(force = false) {
  const metrics = computeTileMetrics();
  const providerKey = getActiveProviderKey();
  if (!providerKey) {
    if (force || state.map.tileState.rangeKey !== 'overlay-only') {
      el.tileLayer.innerHTML = '';
      state.map.tileState.tiles.clear();
      state.map.tileState.rangeKey = 'overlay-only';
    }
    el.tileLayer.style.transform = 'translate(0px, 0px)';
    return;
  }
  const nextRangeKey = `${providerKey}:${metrics.tileZoom}:${metrics.tileMinX}:${metrics.tileMinY}:${metrics.tileMaxX}:${metrics.tileMaxY}`;
  if (force || nextRangeKey !== state.map.tileState.rangeKey) {
    reconcileTiles(metrics, providerKey);
    state.map.tileState.rangeKey = nextRangeKey;
  }
  const translateX = metrics.width / 2 - metrics.centerBase.x * metrics.scale;
  const translateY = metrics.height / 2 - metrics.centerBase.y * metrics.scale;
  el.tileLayer.style.transformOrigin = '0 0';
  el.tileLayer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${metrics.scale})`;
}

function reconcileTiles(metrics, providerKey) {
  const desiredIds = new Set();
  const fragment = document.createDocumentFragment();

  for (let tx = metrics.tileMinX; tx <= metrics.tileMaxX; tx += 1) {
    for (let ty = metrics.tileMinY; ty <= metrics.tileMaxY; ty += 1) {
      if (ty < 0 || ty >= metrics.limit) continue;
      const tileId = `${providerKey}:${metrics.tileZoom}:${tx}:${ty}`;
      desiredIds.add(tileId);
      if (state.map.tileState.tiles.has(tileId)) continue;
      const image = document.createElement('img');
      const wrappedX = ((tx % metrics.limit) + metrics.limit) % metrics.limit;
      image.style.left = `${tx * TILE_SIZE}px`;
      image.style.top = `${ty * TILE_SIZE}px`;
      image.src = tileUrl(providerKey, metrics.tileZoom, wrappedX, ty);
      image.onerror = () => {
        image.remove();
        state.map.tileState.tiles.delete(tileId);
        handleTileError(providerKey);
      };
      state.map.tileState.tiles.set(tileId, image);
      fragment.appendChild(image);
    }
  }

  state.map.tileState.tiles.forEach((image, tileId) => {
    if (desiredIds.has(tileId)) return;
    image.remove();
    state.map.tileState.tiles.delete(tileId);
  });

  if (fragment.childNodes.length) el.tileLayer.appendChild(fragment);
}

function tileUrl(providerKey, zoom, x, y) {
  const urls = TILE_PROVIDERS[providerKey] || TILE_PROVIDERS.light;
  if (!urls.length) return '';
  const template = urls[(Math.abs(x) + Math.abs(y)) % urls.length];
  return template.replace('{z}', Math.floor(zoom)).replace('{x}', x).replace('{y}', y);
}

function handleTileError(providerKey) {
  if (providerKey === 'dark' && !state.map.tileState.darkProviderFailed) {
    state.map.tileState.darkProviderFailed = true;
    state.map.tileState.rangeKey = '';
    setStatus('Dark altlik yuklenemedi, acik altliga gecildi.', 'warn');
    requestRender({ forceTiles: true });
    return;
  }
  if (providerKey === 'light' && !state.map.tileState.overlayOnly) {
    state.map.tileState.overlayOnly = true;
    state.map.tileState.rangeKey = '';
    setStatus('Harita altligi yuklenemedi, overlay modu aktif.', 'warn');
    requestRender({ forceTiles: true });
  }
}

function screenPoint(lon, lat) {
  const width = el.mapViewport.clientWidth || 1200;
  const height = el.mapViewport.clientHeight || 800;
  const center = project(state.map.centerLon, state.map.centerLat, state.map.zoom);
  const world = project(lon, lat, state.map.zoom);
  return { x: world.x - center.x + width / 2, y: world.y - center.y + height / 2 };
}

function currentGeoBounds() {
  const width = el.mapViewport.clientWidth || 1200;
  const height = el.mapViewport.clientHeight || 800;
  const center = project(state.map.centerLon, state.map.centerLat, state.map.zoom);
  const tl = unproject(center.x - width / 2, center.y - height / 2, state.map.zoom);
  const br = unproject(center.x + width / 2, center.y + height / 2, state.map.zoom);
  return { minLon: tl.lon, maxLon: br.lon, minLat: br.lat, maxLat: tl.lat };
}

function screenToGeoPoint(clientX, clientY) {
  const rect = el.mapViewport.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const width = el.mapViewport.clientWidth || 1200;
  const height = el.mapViewport.clientHeight || 800;
  const center = project(state.map.centerLon, state.map.centerLat, state.map.zoom);
  return unproject(center.x - width / 2 + localX, center.y - height / 2 + localY, state.map.zoom);
}

function getHatAnchorCoord(hatRow, event) {
  if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    return screenToGeoPoint(event.clientX, event.clientY);
  }
  if (Array.isArray(hatRow?.coords) && hatRow.coords.length) {
    const midCoord = hatRow.coords[Math.floor(hatRow.coords.length / 2)];
    return { lon: Number(midCoord[0]), lat: Number(midCoord[1]) };
  }
  if (Array.isArray(hatRow?.bbox) && hatRow.bbox.length === 4) {
    return {
      lon: (Number(hatRow.bbox[0]) + Number(hatRow.bbox[2])) / 2,
      lat: (Number(hatRow.bbox[1]) + Number(hatRow.bbox[3])) / 2
    };
  }
  return { lon: state.map.centerLon, lat: state.map.centerLat };
}

function computeAnchoredInfoPosition(anchorPoint, cardWidth, cardHeight) {
  const width = el.mapViewport.clientWidth || 1200;
  const height = el.mapViewport.clientHeight || 800;
  const gap = 16;
  const margin = 12;
  const rightLeft = anchorPoint.x + gap;
  const leftLeft = anchorPoint.x - cardWidth - gap;
  const rightFits = rightLeft + cardWidth <= width - margin;
  const leftFits = leftLeft >= margin;
  let left = rightLeft;
  if (!rightFits && leftFits) left = leftLeft;
  else if (!rightFits) left = Math.max(margin, width - cardWidth - margin);
  if (left < margin) left = margin;
  if (left + cardWidth > width - margin) left = Math.max(margin, width - cardWidth - margin);
  let top = anchorPoint.y - cardHeight / 2;
  if (top < margin) top = margin;
  if (top + cardHeight > height - margin) top = Math.max(margin, height - cardHeight - margin);
  return { x: round1(left), y: round1(top) };
}

function syncInfoCardPosition() {
  if (!el.infoCard || el.infoCard.classList.contains('hidden')) return;
  if (!el.infoCard.classList.contains('info-card-anchored')) {
    el.infoCard.style.left = '';
    el.infoCard.style.top = '';
    return;
  }
  const popup = state.ui.activeEntityPopup || state.ui.activeHatPopup;
  if (!popup?.anchorCoord) return;
  const anchorPoint = screenPoint(popup.anchorCoord.lon, popup.anchorCoord.lat);
  const pos = computeAnchoredInfoPosition(anchorPoint, el.infoCard.offsetWidth || 256, el.infoCard.offsetHeight || 180);
  if (state.ui.activeEntityPopup) state.ui.activeEntityPopup.screenPosition = pos;
  if (state.ui.activeHatPopup) state.ui.activeHatPopup.screenPosition = pos;
  el.infoCard.style.left = `${pos.x}px`;
  el.infoCard.style.top = `${pos.y}px`;
}

function matchesYtm(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  const effective = getEffectiveYtmFilter();
  if (!effective.size) return false;
  return effective.has(v);
}

function matchesAnyYtm(values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return false;
  const effective = getEffectiveYtmFilter();
  if (!effective.size) return false;
  return list.some((value) => effective.has(value));
}

function getVisibleBaras() {
  return getVisibleEntityList('baras', () => {
    const effectiveKv = getEffectiveKvFilter();
    return state.mappingRows.filter((row) => effectiveKv.has(String(row.gerilim || '')) && matchesYtm(row.fullYtm));
  });
}

function getVisibleTms() {
  return getVisibleEntityList('tms', () => {
    const effectiveKv = getEffectiveKvFilter();
    const baseTms = state.network.tmPoints.filter((row) => effectiveKv.has(String(row.kv || '')) && matchesYtm(row.ytm));
    if (state.filters.hatDisplayMode === 'sade-ayrik' || state.filters.hatDisplayMode === 'sade') {
      const visibleNames = new Set(baseTms.map(t => t.name));
      const connectedNames = new Set();
      getVisibleHats().forEach(hat => {
        if (hat.startTm) connectedNames.add(hat.startTm);
        if (hat.endTm) connectedNames.add(hat.endTm);
      });
      const extras = state.network.tmPoints.filter(tm => !visibleNames.has(tm.name) && connectedNames.has(tm.name) && effectiveKv.has(String(tm.kv || '')));
      return [...baseTms, ...extras];
    }
    return baseTms;
  });
}

function getVisibleHats() {
  return getVisibleEntityList('hats', () => {
    const effectiveKv = getEffectiveKvFilter();
    return state.network.hatLines.filter((row) => effectiveKv.has(String(row.kv || '')) && matchesAnyYtm(row.ytmNames));
  });
}

function buildParallelGroups(hats) {
  const groups = new Map();
  hats.forEach(row => {
    const a = row.startTm || '';
    const b = row.endTm || '';
    const key = [a, b].sort().join('|||');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

function offsetLine(startPt, endPt, offset) {
  const dx = endPt.x - startPt.x;
  const dy = endPt.y - startPt.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return {
    sx: startPt.x + nx * offset,
    sy: startPt.y + ny * offset,
    ex: endPt.x + nx * offset,
    ey: endPt.y + ny * offset
  };
}

function formatHatHoverLength(lengthKm) {
  const numeric = Number(lengthKm);
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function buildHatHoverDirection(startTm, endTm, directionValue) {
  if (!Number.isFinite(directionValue)) return `${startTm || '?'} >> ${endTm || '?'}`;
  if (directionValue >= 0) return `${startTm || '?'} >> ${endTm || '?'}`;
  return `${endTm || '?'} >> ${startTm || '?'}`;
}

function buildHatHoverMetricLine(row, metricRecord, unit, pctText) {
  if (!metricRecord || !Number.isFinite(metricRecord.value)) return '';
  const directionText = buildHatHoverDirection(row.startTm, row.endTm, metricRecord.directionValue);
  return `${escapeHtml(directionText)} ${metricRecord.value >= 0 ? '+' : ''}${metricRecord.value.toFixed(1)} ${unit}${pctText ? ` - ${escapeHtml(pctText)}` : ''}`;
}

function buildHatHoverTooltipHtml(row) {
  const record = state.scada?.entityMetricsByKey?.get(`hat:${row.id}`) || null;
  const lines = [
    `<strong>${escapeHtml(row.name || '-')} (${escapeHtml(formatHatHoverLength(row.lengthKm))} km)</strong>`
  ];
  if (record?.active && Number.isFinite(record.active.value)) {
    const mwPct = record.active.valueInvalid
      ? '!'
      : Number.isFinite(record.loadingPct)
        ? `%${record.loadingPct.toFixed(1)}`
        : '';
    lines.push(buildHatHoverMetricLine(row, record.active, 'MW', mwPct));
  }
  if (record?.reactive && Number.isFinite(record.reactive.value)) {
    const reactiveRatio = Number.isFinite(record.active?.loadingHintValue) && Math.abs(record.active.loadingHintValue) >= 1
      ? (Math.abs(record.reactive.loadingHintValue || 0) / Math.max(Math.abs(record.active.loadingHintValue), 1)) * 100
      : null;
    const mvarPct = record.reactive.valueInvalid
      ? '!'
      : Number.isFinite(reactiveRatio)
        ? `%${reactiveRatio.toFixed(1)}`
        : '';
    lines.push(buildHatHoverMetricLine(row, record.reactive, 'MVAr', mvarPct));
  }
  if (lines.length === 1) {
    lines.push(`<span class="tt-label">${escapeHtml(`${row.startTm || '?'} >> ${row.endTm || '?'}`)}</span>`);
  }
  if (record && Number.isFinite(record.directionValue)) {
    const resolutionLabel = record.resolvedTerminalMismatch
      ? 'Terminal yorumlu'
      : record.unresolved || record.sourceAmbiguous || record.candidateConflict || record.backupUsed
        ? 'Yön belirsiz'
        : record.invalidPct || record.valueInvalid
          ? 'Uyarili'
          : 'Cozulmus';
    const terminalLabel = record.terminalSide || '-';
    const modelLabel = record.directionResolvedBy || record.directionModel || '-';
    lines.push(`<span class="tt-label">Model: ${escapeHtml(modelLabel)} · Terminal: ${escapeHtml(terminalLabel)} · Guven: ${escapeHtml(resolutionLabel)}</span>`);
  }
  return lines.join('<br>');
}

function partitionSelectedHats(hats) {
  const normalHats = [];
  const selectedHats = [];
  (hats || []).forEach((row) => {
    (isSelected('hat', row.id) ? selectedHats : normalHats).push(row);
  });
  return normalHats.concat(selectedHats);
}

function getHatStrokeStyle(row) {
  const baseWidth = row.kv === '400' ? 2.8 : row.kv === '154' ? 2.1 : 1.7;
  const baseColor = HAT_TM_COLORS[row.kv] || HAT_TM_COLORS[''];
  const hatMetricActive = String(state.filters.scadaMetric || '').startsWith('hat');
  const displayMode = state.filters.scadaMapDisplayMode || 'flow';
  const useScadaHatColors = Boolean(state.scada.enabled)
    && hatMetricActive
    && (displayMode === 'flow' || displayMode === 'heatmap');
  if (!useScadaHatColors) return { color: baseColor, width: baseWidth, opacity: 1, flow: null, record: null };

  const noDataColor = SCADA_CONFIG?.NO_MATCH_COLOR || '#9ca3af';
  // A mode transition must not colour the new mode from the previous mode's
  // snapshot. A same-mode snapshot remains visible until its atomic refresh.
  if (state.scada.currentScope?.mode !== state.filters.scadaMetric) {
    return { color: noDataColor, width: row.kv === '400' ? 2.2 : 1.5, opacity: 0.92, flow: null, record: null };
  }
  const flow = state.scada.lineFlowByLineId?.get(row.id) || null;
  const record = state.scada.entityMetricsByKey?.get(`hat:${row.id}`) || null;
  if (!flow || flow.unavailable || flow.invalidPct || !Number.isFinite(flow.displayPct)) {
    return { color: noDataColor, width: row.kv === '400' ? 2.2 : 1.5, opacity: 0.92, flow, record };
  }

  const color = flow.displayPctMode === 'reactive-ratio'
    ? (flow.color || noDataColor)
    : getFlowColor(flow.displayPct);
  let width = Math.max(flow.width, row.kv === '400' ? 2.8 : 2);
  let opacity = 1;
  if (displayMode === 'heatmap') {
    width += row.kv === '400' ? 1.2 : 0.9;
    opacity = 0.96;
  }
  return { color, width, opacity, flow, record };
}

function renderHatLayer() {
  el.hatLayer.innerHTML = '';
  if (!state.filters.showHat && !isSelectionForceVisible('hat')) return;
  const bounds = currentGeoBounds();
  const fragment = document.createDocumentFragment();
  const visibleHats = getVisibleHats().slice();
  if (isSelectionForceVisible('hat')) {
    const selectedHat = state.network.hatLines.find((row) => String(row.id) === String(state.selection.id));
    if (selectedHat && !visibleHats.some((row) => String(row.id) === String(selectedHat.id))) visibleHats.push(selectedHat);
  }
  const filteredHats = partitionSelectedHats(visibleHats.filter((row) => intersects(row.bbox, bounds)));

  let parallelGroups = null;
  if (state.filters.hatDisplayMode === 'sade-ayrik') {
    parallelGroups = buildParallelGroups(filteredHats);
  }

  filteredHats.forEach((row) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('data-hat-id', String(row.id));
    let d = '';

    if (state.filters.hatDisplayMode === 'sade' || state.filters.hatDisplayMode === 'sade-ayrik') {
      const startTm = state.network.tmMap.get(row.startTm);
      const endTm = state.network.tmMap.get(row.endTm);
      const firstCoord = row.coords[0];
      const lastCoord = row.coords[row.coords.length - 1];
      const startPt = startTm ? screenPoint(startTm.lon, startTm.lat) : screenPoint(firstCoord[0], firstCoord[1]);
      const endPt = endTm ? screenPoint(endTm.lon, endTm.lat) : screenPoint(lastCoord[0], lastCoord[1]);

      if (state.filters.hatDisplayMode === 'sade-ayrik' && parallelGroups) {
        const a = row.startTm || '';
        const b = row.endTm || '';
        const key = [a, b].sort().join('|||');
        const group = parallelGroups.get(key) || [row];
        const idx = group.indexOf(row);
        const count = group.length;
        const spacing = 4;
        const totalWidth = (count - 1) * spacing;
        const offset = -totalWidth / 2 + idx * spacing;
        const shifted = offsetLine(startPt, endPt, offset);
        d = `M ${round1(shifted.sx)} ${round1(shifted.sy)} L ${round1(shifted.ex)} ${round1(shifted.ey)}`;
      } else {
        d = `M ${round1(startPt.x)} ${round1(startPt.y)} L ${round1(endPt.x)} ${round1(endPt.y)}`;
      }
    } else {
      d = row.coords.map((coord, index) => {
        const point = screenPoint(coord[0], coord[1]);
        return `${index ? 'L' : 'M'} ${round1(point.x)} ${round1(point.y)}`;
      }).join(' ');
    }

    path.setAttribute('d', d);
    path.removeAttribute('stroke-dasharray');
    path.setAttribute('opacity', '1');
    const strokeStyle = getHatStrokeStyle(row);
    const { flow, record } = strokeStyle;
    let strokeWidth = strokeStyle.width;
    const strokeColor = strokeStyle.color;
    const strokeOpacity = strokeStyle.opacity;

    path.setAttribute('stroke', strokeColor);
    path.removeAttribute('stroke-dasharray');
    path.setAttribute('opacity', String(strokeOpacity));
    if (isSelected('hat', row.id)) strokeWidth += 0.9;
    path.setAttribute('stroke-width', String(strokeWidth));
    path.setAttribute('class', `hat-line${isSelected('hat', row.id) ? ' feature-selected-hat' : ''}`);
    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.setAttribute('d', d);
    hitPath.setAttribute('fill', 'none');
    hitPath.setAttribute('stroke', 'transparent');
    hitPath.setAttribute('stroke-width', String(Math.max(12, strokeWidth + 10)));
    hitPath.setAttribute('class', 'hover-hit-target hat-hover-hit');
    hitPath.addEventListener('click', (event) => {
      event.stopPropagation();
      path.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY }));
    });
    path.addEventListener('click', (event) => {
      event.stopPropagation();
      state.selection = { kind: 'hat', id: row.id, measureSourceId: '', measureTargetIds: [] };
      if (typeof openScadaHatDetails === 'function') {
        openScadaHatDetails(row, { anchorCoord: getHatAnchorCoord(row, event) });
        requestRender();
        return;
      }
      const fields = [
        ['Hat ID', row.kmlDescriptionId || '-'],
        ['Güzergah', `${row.startTm || '-'} ➔ ${row.endTm || '-'}`],
        ['Uzunluk', formatNumber(row.lengthKm, ' km')],
        ['YTM', (row.ytmNames || []).join(' / ') || '-'],
        ['Kapasite (K/Y)', `${formatNumber(row.winterCapacityMva, '')} / ${formatNumber(row.summerCapacityMva, ' MVA')}`],
        ['Hat Kesit', formatKesit(row.characteristic)]
      ];
      if (row.olcumNoktasiIdAktif) fields.push(['Ölçüm Noktası (Aktif)', row.olcumNoktasiIdAktif]);
      if (row.olcumNoktasiIdReaktif) fields.push(['Ölçüm Noktası (Reaktif)', row.olcumNoktasiIdReaktif]);
      if (typeof getScadaPopupFields === 'function') {
        getScadaPopupFields(row).forEach(f => fields.push(f));
      }

      showInfo({
        title: row.name,
        subtitle: row.kv ? `${row.kv} kV Hat` : 'Hat',
        tags: [(row.ytmNames || []).join(' / ') || '-'],
        fields: fields,
        actions: [{ id: 'btnShowScadaChart', label: '📊 Grafik Göster' }]
      });
      const chartBtn = document.getElementById('btnShowScadaChart');
      if (chartBtn) chartBtn.addEventListener('click', () => {
        if (typeof showScadaChartModal === 'function') showScadaChartModal(row.id, row.name);
      });
      requestRender();
    });
    /* Tooltip with MW + time when SCADA is active */
    const safeName = escapeHtml(row.name || '-');
    const safeStartTm = escapeHtml(row.startTm || '?');
    const safeEndTm = escapeHtml(row.endTm || '?');
    const safeKv = escapeHtml(row.kv || '?');
    let tooltipHtml = `<strong>${safeName}</strong><br><span class="tt-label">${safeStartTm} ➔ ${safeEndTm}</span> · ${safeKv} kV · ${formatNumber(row.lengthKm, ' km')}`;
    if (flow) {
      const primaryValue = Number.isFinite(flow.primaryValue) ? flow.primaryValue : flow.mw;
      const primaryUnit = flow.primaryUnit || 'MW';
      const primaryText = Number.isFinite(primaryValue)
        ? `${primaryValue >= 0 ? '+' : ''}${primaryValue.toFixed(1)} ${primaryUnit}`
        : '-';
      const tsT = flow.timestamp ? flow.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
      const pctText = flow.invalidPct ? '!' : (Number.isFinite(flow.displayPct) ? `${flow.displayPct.toFixed(0)}%` : '-');
      tooltipHtml += `<br><span style="color:${flow.color};font-weight:700">${primaryText} · ${pctText}</span>${tsT ? ` · <span class="tt-label">${escapeHtml(tsT)}</span>` : ''}`;
      if (flow.direction === 'unknown' || record?.uncertaintyTooltip) {
        tooltipHtml += `<br><span class="tt-label">${escapeHtml(flow.direction === 'unknown' ? 'Yön belirsiz' : record.uncertaintyTooltip)}</span>`;
      }
    } else if (record && (Number.isFinite(record.primaryValue) || Number.isFinite(record.displayPct) || record.invalidPct || record.valueInvalid)) {
      const primaryUnit = record.primaryMetric === 'reactive' ? 'MVar' : 'MW';
      const primaryText = record.valueInvalid
        ? `! ${primaryUnit}`
        : Number.isFinite(record.primaryValue)
          ? `${record.primaryValue >= 0 ? '+' : ''}${record.primaryValue.toFixed(1)} ${primaryUnit}`
          : 'Belirsiz';
      const pctText = record.invalidPct ? '!' : Number.isFinite(record.displayPct) ? `${record.displayPct.toFixed(0)}%` : '-';
      const tsT = record.primaryTimestamp ? record.primaryTimestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
      tooltipHtml += `<br><span style="color:${record.displayColor || strokeColor};font-weight:700">${primaryText} · ${pctText}</span>${tsT ? ` · <span class="tt-label">${escapeHtml(tsT)}</span>` : ''}`;
      if (record.uncertaintyTooltip) tooltipHtml += `<br><span class="tt-label">${escapeHtml(record.uncertaintyTooltip)}</span>`;
    }
    attachHoverTooltip(path, tooltipHtml);
    attachHoverTooltip(hitPath, () => buildHatHoverTooltipHtml(row), { owner: `hat:${row.id}` });
    fragment.appendChild(path);
    fragment.appendChild(hitPath);
  });
  el.hatLayer.appendChild(fragment);
}

function renderTmLayer() {
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
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', round1(point.x));
    circle.setAttribute('cy', round1(point.y));
    circle.setAttribute('r', row.kv === '400' ? '2.8' : row.kv === '154' ? '2.35' : '2.05');
    circle.setAttribute('fill', HAT_TM_COLORS[row.kv] || HAT_TM_COLORS['']);
    circle.setAttribute('class', `tm-point${isSelected('tm', row.id) ? ' feature-selected' : ''}`);
    circle.addEventListener('click', (event) => {
      event.stopPropagation();
      state.selection = { kind: 'tm', id: row.id, measureSourceId: '', measureTargetIds: [] };
      showInfo({
        title: row.name,
        subtitle: row.kv ? `${row.kv} kV TM` : 'TM',
        tags: [row.ytm || '-'],
        fields: [
          ['TM ID', row.kmlDescriptionId || '-'],
          ['YTM', row.ytm || '-'],
          ['Il', row.il || '-'],
          ['BM', row.bm || row.bolgeMudurlugu || '-'],
          ['TM Tipi', row.ozelTeiasTm || row.mulk || '-'],
          ['Salt Turu', row.saltTuru || '-']
        ]
      });
      requestRender();
    });
    attachHoverTooltip(circle, `<strong>${escapeHtml(row.name || '-')}</strong><br><span class="tt-label">${escapeHtml(row.kv || '?')} kV TM</span> · ${escapeHtml(row.ytm || '?')}`);
    fragment.appendChild(circle);
  });
  el.tmLayer.appendChild(fragment);
}

function renderBaraLayer() {
  el.baraLayer.innerHTML = '';
  if (!state.filters.showBaras && !isSelectionForceVisible('bara')) return;
  const bounds = currentGeoBounds();
  const fragment = document.createDocumentFragment();
  const visibleBaras = getVisibleBaras().slice();
  if (isSelectionForceVisible('bara')) {
    const selectedBara = state.mappingRows.find((row) => String(row.tpysBaraId) === String(state.selection.id));
    if (selectedBara && !visibleBaras.some((row) => String(row.tpysBaraId) === String(selectedBara.tpysBaraId))) visibleBaras.push(selectedBara);
  }
  visibleBaras.filter((row) => insideBounds(Number(row.boylam), Number(row.enlem), bounds)).forEach((row) => {
    const point = screenPoint(Number(row.boylam), Number(row.enlem));
    const size = String(row.gerilim) === '400' ? 9 : 7.4;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', round1(point.x - size / 2));
    rect.setAttribute('y', round1(point.y - size / 2));
    rect.setAttribute('width', size);
    rect.setAttribute('height', size);
    rect.setAttribute('fill', BARA_COLORS[row.gerilim] || BARA_COLORS['']);
    rect.setAttribute('class', `bara-point${isSelected('bara', row.tpysBaraId) ? ' feature-selected' : ''}${isMeasureTarget(row.tpysBaraId) ? ' measure-target' : ''}`);
    rect.addEventListener('click', (event) => {
      event.stopPropagation();
      state.selection = { kind: 'bara', id: row.tpysBaraId, measureSourceId: '', measureTargetIds: [] };
      showBaraInfo(row, false);
      requestRender();
    });
    attachHoverTooltip(rect, `<strong>${escapeHtml(row.tpysBaraAdi || '-')}</strong><br><span class="tt-label">${escapeHtml(row.gerilim || '?')} kV Bara</span> · ${escapeHtml(row.fullYtm || '?')}`);
    fragment.appendChild(rect);
  });
  el.baraLayer.appendChild(fragment);
}

function renderBaraSetLayer() {
  el.baraSetLayer.innerHTML = '';
  if (!state.filters.showBaraSet || !state.baraSet.loaded) return;
  const bounds = currentGeoBounds();
  const fragment = document.createDocumentFragment();
  const effectiveKv = getEffectiveKvFilter();
  state.baraSet.rows.filter((row) => effectiveKv.has(String(row.gerilim || '')) && matchesYtm(row.ytm) && insideBounds(Number(row.boylam), Number(row.enlem), bounds)).forEach((row) => {
    const current = getBaraSetDisplay(row);
    const point = screenPoint(Number(row.boylam), Number(row.enlem));
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', `bara-set-group${isSelected('baraset', row.tpysBaraId) ? ' feature-selected' : ''}`);
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('cx', round1(point.x));
    marker.setAttribute('cy', round1(point.y));
    marker.setAttribute('r', '4.2');
    marker.setAttribute('fill', current.color);
    marker.setAttribute('class', 'bara-set-point');
    group.appendChild(marker);
    if (state.map.zoom >= 7) {
      const labelWidth = Math.max(44, Math.min(82, 26 + current.text.length * 6.2));
      const labelX = point.x + 8;
      const labelY = point.y - 20;
      const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      box.setAttribute('x', round1(labelX));
      box.setAttribute('y', round1(labelY));
      box.setAttribute('width', round1(labelWidth));
      box.setAttribute('height', '18');
      box.setAttribute('rx', '9');
      box.setAttribute('class', 'bara-set-label-box');
      group.appendChild(box);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', round1(labelX + 8));
      text.setAttribute('y', round1(labelY + 12));
      text.textContent = current.text;
      group.appendChild(text);
    }
    group.addEventListener('click', (event) => {
      event.stopPropagation();
      state.selection = { kind: 'baraset', id: row.tpysBaraId, measureSourceId: '', measureTargetIds: [] };
      showBaraSetInfo(row, false);
      requestRender();
    });
    fragment.appendChild(group);
  });
  el.baraSetLayer.appendChild(fragment);
}

function renderMeasureLayer() {
  el.measureLayer.innerHTML = '';
  if (!state.selection.measureSourceId || !state.selection.measureTargetIds.length) return;
  const source = state.mappingIndex.byId.get(String(state.selection.measureSourceId));
  if (!source) return;
  const fragment = document.createDocumentFragment();
  const from = screenPoint(Number(source.boylam), Number(source.enlem));
  state.selection.measureTargetIds.forEach((id) => {
    const target = state.mappingIndex.byId.get(String(id));
    if (!target) return;
    const to = screenPoint(Number(target.boylam), Number(target.enlem));
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', round1(from.x));
    line.setAttribute('y1', round1(from.y));
    line.setAttribute('x2', round1(to.x));
    line.setAttribute('y2', round1(to.y));
    line.setAttribute('class', 'measure-line');
    fragment.appendChild(line);
  });
  el.measureLayer.appendChild(fragment);
}

function updateSummary() {
  el.baraCount.textContent = String(getVisibleBaras().length);
  el.tmCount.textContent = String(getVisibleTms().length);
  el.hatCount.textContent = String(getVisibleHats().length);
}

function doSearch() {
  const query = normalizeText(el.searchInput.value);
  if (!query) return;
  clearSearchPins();
  const bara = state.mappingRows.find((row) => normalizeText([row.tpysBaraAdi, row.yksBaraAdi, row.tpysBaraId].join(' ')).includes(query));
  if (bara) {
    const visibilityChanges = ensureSearchVisibility({ kv: bara.gerilim, ytm: bara.fullYtm });
    focusOn(Number(bara.boylam), Number(bara.enlem), String(bara.gerilim) === '400' ? 8 : 9);
    state.selection = { kind: 'bara', id: bara.tpysBaraId, measureSourceId: '', measureTargetIds: [] };
    const baraSetRow = state.baraSet.rows.find((row) => row.tpysBaraId === bara.tpysBaraId);
    if (baraSetRow && state.filters.showBaraSet) showBaraSetInfo(baraSetRow, false);
    else showBaraInfo(bara, false);
    setStatus(`${bara.tpysBaraAdi} vurgulandi.${visibilityChanges.length ? ` Filtreler gecici genisletildi: ${visibilityChanges.join(', ')}.` : ''}`, visibilityChanges.length ? 'warn' : 'info');
    requestRender({ forceTiles: true });
    return;
  }
  const tm = state.network.tmPoints.find((row) => normalizeText([row.name, row.ytm, row.il, row.kmlDescriptionId].join(' ')).includes(query));
  if (tm) {
    const visibilityChanges = ensureSearchVisibility({ kv: tm.kv, ytm: tm.ytm });
    focusOn(Number(tm.lon), Number(tm.lat), tm.kv === '400' ? 8 : 9);
    state.selection = { kind: 'tm', id: tm.id, measureSourceId: '', measureTargetIds: [] };
    showInfo({ title: tm.name, subtitle: tm.kv ? `${tm.kv} kV TM` : 'TM', tags: [tm.ytm || '-'], fields: [['TM ID', tm.kmlDescriptionId || '-'], ['YTM', tm.ytm || '-'], ['Il', tm.il || '-'], ['BM', tm.bm || '-'], ['TM Tipi', tm.ozelTeiasTm || tm.mulk || '-'], ['Salt Turu', tm.saltTuru || '-']] });
    setStatus(`${tm.name} vurgulandi.${visibilityChanges.length ? ` Filtreler gecici genisletildi: ${visibilityChanges.join(', ')}.` : ''}`, visibilityChanges.length ? 'warn' : 'info');
    requestRender({ forceTiles: true });
    return;
  }
  const hat = state.network.hatLines.find((row) => normalizeText([row.name, row.kmlDescriptionId, row.startTm, row.endTm, (row.ytmNames || []).join(' ')].join(' ')).includes(query));
  if (hat) {
    const visibilityChanges = ensureSearchVisibility({ kv: hat.kv, ytmNames: hat.ytmNames });
    focusOn((hat.bbox[0] + hat.bbox[2]) / 2, (hat.bbox[1] + hat.bbox[3]) / 2, hat.kv === '400' ? 7 : 8);
    state.selection = { kind: 'hat', id: hat.id, measureSourceId: '', measureTargetIds: [] };
    const fields = [['Hat ID', hat.kmlDescriptionId || '-'], ['Güzergah', `${hat.startTm || '-'} ➔ ${hat.endTm || '-'}`], ['Uzunluk', formatNumber(hat.lengthKm, ' km')], ['YTM', (hat.ytmNames || []).join(' / ') || '-'], ['Kapasite (K/Y)', `${formatNumber(hat.winterCapacityMva, '')} / ${formatNumber(hat.summerCapacityMva, ' MVA')}`], ['Hat Kesit', formatKesit(hat.characteristic || '-')]];
    if (hat.olcumNoktasiIdAktif) fields.push(['Ölçüm Noktası (Aktif)', hat.olcumNoktasiIdAktif]);
    if (hat.olcumNoktasiIdReaktif) fields.push(['Ölçüm Noktası (Reaktif)', hat.olcumNoktasiIdReaktif]);
    if (typeof openScadaHatDetails === 'function') {
      openScadaHatDetails(hat, { anchorCoord: getHatAnchorCoord(hat), forceTiles: true });
    } else {
      showInfo({ title: hat.name, subtitle: hat.kv ? `${hat.kv} kV Hat` : 'Hat', tags: [(hat.ytmNames || []).join(' / ') || '-'], fields: fields });
    }
    setStatus(`${hat.name} vurgulandi.${visibilityChanges.length ? ` Filtreler gecici genisletildi: ${visibilityChanges.join(', ')}.` : ''}`, visibilityChanges.length ? 'warn' : 'info');
    requestRender({ forceTiles: true });
    return;
  }
  setStatus('Arama sonucu bulunamadi.', 'warn');
}

function focusOn(lon, lat, zoom = state.map.zoom) {
  state.map.centerLon = lon;
  state.map.centerLat = lat;
  state.map.zoom = Math.max(5, Math.min(13, zoom));
  state.map.tileState.rangeKey = '';
}

function showBaraInfo(row, withDistances) {
  const fields = [
    ['Bara Adi', row.tpysBaraAdi || '-'],
    ['Gerilim', row.gerilim ? `${row.gerilim} kV` : '-'],
    ['RGK Tipi', row.rgkTipiAciklama || row.rgkTipiKod || '-'],
    ['Pnom Toplam', formatNumber(row.pNomToplamMw, ' MW')],
    ['Asiri Dusuk Ikaz', formatNumber(row.nominalIkazDusukToplam, ' Mvar')],
    ['Asiri Yuksek Ikaz', formatNumber(row.nominalIkazAsiriToplam, ' Mvar')],
    ['TPYS Santral MKUD', formatNumber(row.tpysSantralMkudMw, ' MW')]
  ];
  let distanceHtml = '';
  if (withDistances) {
    const nearest = computeNearestBaras(row);
    state.selection.measureSourceId = row.tpysBaraId;
    state.selection.measureTargetIds = nearest.map((item) => item.row.tpysBaraId);
    distanceHtml = `<div class="info-section"><strong>En yakin 5 bara (kus ucusu)</strong>${nearest.map((item) => `<div class="distance-row"><span>${escapeHtml(item.row.tpysBaraAdi)} (${escapeHtml(item.row.gerilim)} kV)</span><strong>${item.km.toFixed(2)} km</strong></div>`).join('')}</div>`;
    setStatus(`${row.tpysBaraAdi} icin en yakin 5 bara cizildi.`);
  } else {
    state.selection.measureSourceId = '';
    state.selection.measureTargetIds = [];
  }
  const showDistanceButton = String(row.gerilim) === '154' || String(row.gerilim) === '400';
  showInfo({
    title: row.tpysBaraAdi,
    subtitle: row.gerilim ? `${row.gerilim} kV Bara` : 'Bara',
    tags: [row.baraTipi || '-', row.fullYtm || '-'],
    fields,
    actions: showDistanceButton ? [{ id: 'btnNearest5', label: withDistances ? 'Mesafeleri yenile' : 'En yakin 5 bara' }] : [],
    extraHtml: `${distanceHtml}${renderUnitTable(row.unitDetails || [])}`
  });
  if (showDistanceButton) {
    const button = document.getElementById('btnNearest5');
    if (button) button.addEventListener('click', () => { showBaraInfo(row, true); requestRender(); });
  }
}

function showBaraSetInfo(item, withDistances) {
  const mapping = item.mapping || state.mappingIndex.byId.get(String(item.tpysBaraId));
  const current = getBaraSetDisplay(item);
  const fields = [
    ['Bara Adi', item.tpysBaraAdi || item.sourceName || '-'],
    ['Gerilim', item.gerilim ? `${item.gerilim} kV` : '-'],
    ['RGK Tipi', mapping?.rgkTipiAciklama || mapping?.rgkTipiKod || '-'],
    ['Saat', hourLabel(state.baraSet.hour)],
    ['Bara Set', current.text],
    ['Gerilim Dusumu', formatNumber(item.drops?.[state.baraSet.hour], '')],
    ['Pnom Toplam', formatNumber(mapping?.pNomToplamMw, ' MW')],
    ['TPYS Santral MKUD', formatNumber(mapping?.tpysSantralMkudMw, ' MW')],
    ['Asiri Dusuk Ikaz', formatNumber(mapping?.nominalIkazDusukToplam, ' Mvar')],
    ['Asiri Yuksek Ikaz', formatNumber(mapping?.nominalIkazAsiriToplam, ' Mvar')]
  ];
  let distanceHtml = '';
  if (withDistances && mapping) {
    const nearest = computeNearestBaras(mapping);
    state.selection.measureSourceId = mapping.tpysBaraId;
    state.selection.measureTargetIds = nearest.map((entry) => entry.row.tpysBaraId);
    distanceHtml = `<div class="info-section"><strong>En yakin 5 bara (kus ucusu)</strong>${nearest.map((entry) => `<div class="distance-row"><span>${escapeHtml(entry.row.tpysBaraAdi)} (${escapeHtml(entry.row.gerilim)} kV)</span><strong>${entry.km.toFixed(2)} km</strong></div>`).join('')}</div>`;
    setStatus(`${item.tpysBaraAdi} icin en yakin 5 bara cizildi.`);
  } else {
    state.selection.measureSourceId = '';
    state.selection.measureTargetIds = [];
  }
  showInfo({
    title: item.tpysBaraAdi || item.sourceName,
    subtitle: item.gerilim ? `${item.gerilim} kV Bara` : 'Bara',
    tags: [mapping?.baraTipi || '-', item.ytm || '-'],
    fields,
    actions: (String(item.gerilim) === '154' || String(item.gerilim) === '400') ? [{ id: 'btnNearest5', label: withDistances ? 'Mesafeleri yenile' : 'En yakin 5 bara' }] : [],
    extraHtml: `${renderBaraSetCharts(item, mapping)}${distanceHtml}${renderUnitTable(mapping?.unitDetails || [])}`
  });
  const button = document.getElementById('btnNearest5');
  if (button) button.addEventListener('click', () => { showBaraSetInfo(item, true); requestRender(); });
}

function renderBaraSetCharts(item, mapping) {
  const nominal = Number(item.gerilim) || Number(mapping?.gerilim) || null;
  const chartValues = state.baraSet.displayMode === 'pu' && nominal ? item.values.map((value) => (Number.isFinite(value) ? value / nominal : null)) : item.values;
  const mainChart = buildLineChartSvg(chartValues, '#2563eb');
  const dropChart = buildLineChartSvg(item.drops, '#f97316');
  const chips = [`Dosya tarihi: ${escapeHtml(state.baraSet.dateText || '-')}`, `Nominal: ${escapeHtml(String(nominal || '-'))} kV`];
  return `<div class="info-section"><div class="chart-wrap"><strong>${escapeHtml(state.baraSet.displayMode === 'pu' ? '24 saatlik bara seti (p.u.)' : '24 saatlik bara seti (kV)')}</strong>${mainChart}<div class="chart-legend"><span class="chart-main">Bara set degeri</span></div></div><div class="chart-wrap top-gap"><strong>24 saatlik gerilim dusumu</strong>${dropChart}<div class="chart-legend"><span class="chart-drop">Gerilim dusumu</span></div></div><div class="value-chip-row">${chips.map((chip) => `<span class="value-chip">${chip}</span>`).join('')}</div></div>`;
}

function buildLineChartSvg(values, color) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return '<div class="muted small top-gap">Grafik verisi yok.</div>';
  const width = 430;
  const height = 210;
  const padL = 38;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  let min = Math.min(...valid);
  let max = Math.max(...valid);
  if (Math.abs(max - min) < 1e-9) { max += 1; min -= 1; }
  const xFor = (index) => padL + (index / 23) * (width - padL - padR);
  const yFor = (value) => padT + ((max - value) / (max - min)) * (height - padT - padB);
  const polyline = values.map((value, index) => Number.isFinite(value) ? `${round1(xFor(index))},${round1(yFor(value))}` : '').filter(Boolean).join(' ');
  const hours = [0, 6, 12, 18, 23];
  const grid = hours.map((hour) => `<line x1="${round1(xFor(hour))}" y1="${padT}" x2="${round1(xFor(hour))}" y2="${height - padB}" stroke="var(--chart-grid)" stroke-width="1" />`).join('');
  const labels = hours.map((hour) => `<text x="${round1(xFor(hour))}" y="${height - 8}" font-size="10" text-anchor="middle" fill="var(--muted)">${hourShortLabel(hour)}</text>`).join('');
  const yLines = [min, (min + max) / 2, max].map((value) => `<g><line x1="${padL}" y1="${round1(yFor(value))}" x2="${width - padR}" y2="${round1(yFor(value))}" stroke="var(--chart-grid-soft)" stroke-width="1" /><text x="${padL - 6}" y="${round1(yFor(value) + 4)}" font-size="10" text-anchor="end" fill="var(--muted)">${formatAxisNumber(value)}</text></g>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-label="grafik">${grid}${yLines}<polyline fill="none" stroke="${color}" stroke-width="2.4" points="${polyline}" />${values.map((value, index) => Number.isFinite(value) ? `<circle cx="${round1(xFor(index))}" cy="${round1(yFor(value))}" r="2.5" fill="${color}" />` : '').join('')}${labels}</svg>`;
}

function renderUnitTable(unitDetails) {
  const rows = (unitDetails || []).filter((row) => row && row.unitName);
  if (!rows.length) return '';
  return `<div class="info-section"><strong>Unite bazli reaktif guc kontrol verileri</strong><table class="unit-table"><thead><tr><th>Unite</th><th>Nominal</th><th>MKUD</th><th>PMKUD</th><th>Dusuk</th><th>Asiri</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.unitName || '-')}</td><td>${escapeHtml(formatNumber(row.unitNominalGucMw, ''))}</td><td>${escapeHtml(formatNumber(row.tpysUniteMkudMw ?? row.tpysSantralMkudMw, ''))}</td><td>${escapeHtml(formatNumber(row.unitPmkudMw, ''))}</td><td>${escapeHtml(formatNumber(row.nominalIkazDusuk, ''))}</td><td>${escapeHtml(formatNumber(row.nominalIkazAsiri, ''))}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderInfoFields(fields) {
  return (fields || []).map(([label, value]) => (
    `<div class="info-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? '-'))}</strong></div>`
  )).join('');
}

function showInfo({
  title,
  subtitle = '',
  tags = [],
  fields = [],
  compactFields = null,
  detailFields = [],
  detailExtraHtml = '',
  actions = [],
  extraHtml = '',
  anchor = null,
  expanded = false,
  classes = []
}) {
  const compact = Array.isArray(compactFields) && compactFields.length ? compactFields : fields;
  const renderedActions = [...actions];
  if (detailFields.length) {
    renderedActions.push({
      id: 'btnToggleInfoDetails',
      label: expanded ? 'Ayrintiyi Gizle' : 'Ayrintiyi Goster',
      className: 'secondary'
    });
  }

  el.infoCard.className = 'info-card';
  if (anchor?.coord) {
    el.infoCard.classList.add('info-card-anchored');
    state.ui.activeEntityPopup = {
      entityType: state.selection.kind || '',
      entityId: state.selection.id || anchor.hatId || '',
      anchorCoord: anchor.coord,
      expanded: Boolean(expanded),
      screenPosition: null
    };
    state.ui.activeHatPopup = {
      hatId: anchor.hatId || state.selection.id || '',
      anchorCoord: anchor.coord,
      expanded: Boolean(expanded),
      screenPosition: null
    };
  } else {
    state.ui.activeEntityPopup = null;
    state.ui.activeHatPopup = null;
    // Clear any leftover anchored positioning from previous call
    el.infoCard.style.left = '';
    el.infoCard.style.top = '';
  }
  (classes || []).forEach((className) => {
    if (className) el.infoCard.classList.add(className);
  });

  const tagsHtml = tags.length ? `<div class="info-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  const detailHtml = detailFields.length
    ? `<div id="infoDetailSection" class="info-section info-detail-section${expanded ? '' : ' hidden'}"><div class="info-grid info-grid-detail">${renderInfoFields(detailFields)}</div>${detailExtraHtml}</div>`
    : '';

  el.infoCard.innerHTML = `
    <div class="info-head">
      <div>
        <p class="info-kicker">${escapeHtml(subtitle || 'TPYS detay')}</p>
        <h3>${escapeHtml(title || '-')}</h3>
      </div>
      <button id="btnInfoClose" class="info-close" title="Kapat">×</button>
    </div>
    ${tagsHtml}
    <div class="info-grid">${renderInfoFields(compact)}</div>
    <div class="info-actions">
      ${renderedActions.map((action) => `<button id="${escapeHtml(action.id)}" class="${escapeHtml(action.className || '')}">${escapeHtml(action.label)}</button>`).join('')}
    </div>
    ${detailHtml}
    ${extraHtml}
  `;
  el.infoCard.classList.remove('hidden');
  syncInfoCardPosition();

  const closeButton = document.getElementById('btnInfoClose');
  if (closeButton) closeButton.addEventListener('click', () => hideInfo(false));
}

function hideInfo(clearSelection = true) {
  el.infoCard.className = 'info-card hidden';
  el.infoCard.innerHTML = '';
  el.infoCard.style.left = '';
  el.infoCard.style.top = '';
  state.ui.activeEntityPopup = null;
  state.ui.activeHatPopup = null;
  if (clearSelection) state.selection = { kind: '', id: '', measureSourceId: '', measureTargetIds: [] };
  else state.selection.measureSourceId = '';
  state.selection.measureTargetIds = [];
  requestRender();
}

function getBaraSetDisplay(item) {
  const hour = state.baraSet.hour;
  const value = Number(item.values?.[hour]);
  const nominal = Number(item.gerilim) || null;
  const pu = nominal && Number.isFinite(value) ? value / nominal : null;
  if (state.baraSet.displayMode === 'pu' && Number.isFinite(pu)) return { text: pu.toFixed(3), color: colorForPu(pu) };
  return { text: Number.isFinite(value) ? formatShortNumber(value) : '-', color: BARA_COLORS[item.gerilim] || BARA_COLORS[''] };
}

function formatKesit(characteristic) {
  if (!characteristic || characteristic === '-') return '-';
  const regex = /(\d+(?:\.\d+)?\s*km\s+\d+kV.*?MCM\))/g;
  const matches = [...characteristic.matchAll(regex)];
  if (matches.length > 0) {
    return matches.map(m => m[1]).join(' | ');
  }
  return characteristic;
}


function getVoltagePuColor(pu) {
  if (!Number.isFinite(pu) || pu < 0) return '#6b7280';
  if (pu < 0.8) return '#6b7280';
  if (pu < 0.95) return '#7c3aed';
  if (pu < 0.97) return '#1d4ed8';
  if (pu < 0.99) return '#7dd3fc';
  if (pu <= 1.01) return '#22c55e';
  if (pu <= 1.03) return '#fb923c';
  if (pu <= 1.05) return '#ea580c';
  if (pu <= 1.2) return '#7c3aed';
  return '#6b7280';
}

function colorForPu(pu) {
  return getVoltagePuColor(pu);
}

function computeNearestBaras(source) {
  return state.mappingRows.filter((row) => row.tpysBaraId !== source.tpysBaraId && (String(row.gerilim) === '154' || String(row.gerilim) === '400')).map((row) => ({ row, km: haversineKm(Number(source.enlem), Number(source.boylam), Number(row.enlem), Number(row.boylam)) })).sort((a, b) => a.km - b.km).slice(0, 5);
}

function project(lon, lat, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const x = (lon + 180) / 360 * scale;
  const sin = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function unproject(x, y, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lon = x / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / scale;
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function insideBounds(lon, lat, bounds) { return lon >= bounds.minLon && lon <= bounds.maxLon && lat >= bounds.minLat && lat <= bounds.maxLat; }
function intersects(bbox, bounds) { if (!bbox || bbox.length !== 4) return true; return !(bbox[0] > bounds.maxLon || bbox[2] < bounds.minLon || bbox[1] > bounds.maxLat || bbox[3] < bounds.minLat); }
function isSelected(kind, id) { return state.selection.kind === kind && String(state.selection.id) === String(id); }
function isMeasureTarget(id) { return state.selection.measureTargetIds.includes(id); }
function round1(value) { return Math.round(Number(value) * 10) / 10; }
function normalizeText(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ç/g, 'c').replace(/Ç/g, 'c').replace(/ğ/g, 'g').replace(/Ğ/g, 'g').replace(/ö/g, 'o').replace(/Ö/g, 'o').replace(/ş/g, 's').replace(/Ş/g, 's').replace(/ü/g, 'u').replace(/Ü/g, 'u').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function parseMaybeNumber(value) { const raw = String(value ?? '').trim(); if (!raw || raw === '-') return null; const normalized = raw.replace(/\./g, '').replace(/,/g, '.'); const num = Number(normalized); return Number.isFinite(num) ? num : null; }
function formatNumber(value, suffix = '') { if (!Number.isFinite(Number(value))) return '-'; return `${Number(value).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}${suffix}`; }
function formatShortNumber(value) { if (!Number.isFinite(Number(value))) return '-'; return Number(value).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); }
function formatAxisNumber(value) { return Number(value).toLocaleString('tr-TR', { maximumFractionDigits: 2 }); }
function hourLabel(hour) { const h1 = String(hour).padStart(2, '0'); const h2 = String((hour + 1) % 24).padStart(2, '0'); return `${h1}-${h2}`; }
function hourShortLabel(hour) { return String(hour).padStart(2, '0'); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match])); }

if (typeof globalThis !== 'undefined' && globalThis.__MAP_MODERN_TEST_HOOKS__) {
  Object.assign(globalThis.__MAP_MODERN_TEST_HOOKS__, {
    getVoltagePuColor,
    isBlankMapClickTarget,
    attachHoverTooltip,
    getVisibleEntityList,
    invalidateVisibleEntityCache,
    getVisibleHats,
    getVisibleTms,
    getVisibleBaras,
    partitionSelectedHats,
    getHatStrokeStyle,
    getMapState: () => state,
    getMapElements: () => el
  });
}

if (typeof globalThis !== 'undefined') {
  globalThis.renderIcon = renderIcon;
}
