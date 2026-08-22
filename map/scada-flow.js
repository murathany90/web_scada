/**
 * scada-flow.js — SCADA Aktif Güç Görselleştirme Katmanı
 * Flow overlay render, sidebar SCADA kartı, popup zenginleştirme.
 * scada-client.js ve map-modern.js'e bağımlıdır.
 */

/* ───────── FLOW LAYER RENDER (Arrow Animation) ───────── */

/* Speed tiers: loading % → animation duration */
function getArrowSpeed(pct) {
  if (pct >= 80) return 4;    // çok hızlı
  if (pct >= 55) return 6;    // hızlı
  if (pct >= 30) return 8;    // orta
  return 10;                   // yavaş
}

function getArrowCount(lengthKm) {
  if (lengthKm >= 100) return 3;  // uzun hat
  if (lengthKm >= 50)  return 2;  // orta hat
  return 1;                        // kısa hat
}

function renderFlowLayer() {
  const flowLayer = document.getElementById('flowLayer');
  if (!flowLayer) return;
  flowLayer.innerHTML = '';
  if (!state.scada.enabled || !state.scada.lineFlowByLineId.size) return;
  if (state.scada.currentScope?.mode !== state.filters.scadaMetric) return;
  if (!state.filters.showHat) return;

  const bounds = currentGeoBounds();
  const fragment = document.createDocumentFragment();
  const visibleHats = getVisibleHats().filter(row => intersects(row.bbox, bounds));

  /* SVG defs: arrow markers per color */
  const usedColors = new Set();

  visibleHats.forEach(row => {
    const flow = state.scada.lineFlowByLineId.get(row.id);
    if (!flow || flow.direction === 'unknown') return;

    usedColors.add(flow.color);

    /* Build path data */
    let d = '';
    if (state.filters.hatDisplayMode === 'sade' || state.filters.hatDisplayMode === 'sade-ayrik') {
      const startTm = state.network.tmMap.get(row.startTm);
      const endTm = state.network.tmMap.get(row.endTm);
      const firstCoord = row.coords[0];
      const lastCoord = row.coords[row.coords.length - 1];
      const startPt = startTm ? screenPoint(startTm.lon, startTm.lat) : screenPoint(firstCoord[0], firstCoord[1]);
      const endPt = endTm ? screenPoint(endTm.lon, endTm.lat) : screenPoint(lastCoord[0], lastCoord[1]);

      if (state.filters.hatDisplayMode === 'sade-ayrik') {
        const a = row.startTm || '', b = row.endTm || '';
        const key = [a, b].sort().join('|||');
        const allHats = getVisibleHats().filter(h => {
          const ha = h.startTm || '', hb = h.endTm || '';
          return [ha, hb].sort().join('|||') === key;
        });
        const idx = allHats.indexOf(row);
        const count = allHats.length;
        const spacing = 4, totalWidth = (count - 1) * spacing;
        const offset = -totalWidth / 2 + idx * spacing;
        const shifted = offsetLine(startPt, endPt, offset);
        d = `M ${round1(shifted.sx)} ${round1(shifted.sy)} L ${round1(shifted.ex)} ${round1(shifted.ey)}`;
      } else {
        d = `M ${round1(startPt.x)} ${round1(startPt.y)} L ${round1(endPt.x)} ${round1(endPt.y)}`;
      }
    } else {
      const coords = flow.direction === 'reverse' ? [...row.coords].reverse() : row.coords;
      d = coords.map((coord, i) => {
        const p = screenPoint(coord[0], coord[1]);
        return `${i ? 'L' : 'M'} ${round1(p.x)} ${round1(p.y)}`;
      }).join(' ');
    }

    /* For sade modes, reverse path direction if needed */
    let pathD = d;
    if ((state.filters.hatDisplayMode === 'sade' || state.filters.hatDisplayMode === 'sade-ayrik') && flow.direction === 'reverse') {
      const parts = d.match(/[\d.]+/g);
      if (parts && parts.length === 4) {
        pathD = `M ${parts[2]} ${parts[3]} L ${parts[0]} ${parts[1]}`;
      }
    }

    const pathId = `fp-${row.id}`;
    const dur = getArrowSpeed(Number.isFinite(flow.displayPct) ? flow.displayPct : 0);
    const arrowCount = getArrowCount(flow.hatLengthKm || 0);

    /* Invisible path for arrows to follow */
    const motionPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    motionPath.setAttribute('id', pathId);
    motionPath.setAttribute('d', pathD);
    motionPath.setAttribute('fill', 'none');
    motionPath.setAttribute('stroke', 'none');
    fragment.appendChild(motionPath);

    /* Arrow, stroke and percentage chip share the resolved SCADA colour. */
    const arrowSize = Math.max(6, Math.min(10, flow.width * 1.6));
    const arrowColor = flow.color || (SCADA_CONFIG.NO_MATCH_COLOR || '#9ca3af');
    for (let i = 0; i < arrowCount; i++) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      arrow.setAttribute('points', `0,${-arrowSize / 2} ${arrowSize},0 0,${arrowSize / 2}`);
      arrow.setAttribute('fill', arrowColor);
      arrow.setAttribute('opacity', '0.9');

      const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
      anim.setAttribute('dur', `${dur}s`);
      anim.setAttribute('repeatCount', 'indefinite');
      anim.setAttribute('rotate', 'auto');
      anim.setAttribute('begin', `${(i / arrowCount * dur).toFixed(1)}s`);

      const mpath = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');
      mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${pathId}`);
      mpath.setAttribute('href', `#${pathId}`);
      anim.appendChild(mpath);
      g.appendChild(arrow);
      g.appendChild(anim);

      /* Tooltip on arrows */
      const primaryValue = Number.isFinite(flow.primaryValue) ? flow.primaryValue : flow.mw;
      const primaryUnit = flow.primaryUnit || 'MW';
      const metricText = Number.isFinite(primaryValue)
        ? `${primaryValue >= 0 ? '+' : ''}${primaryValue.toFixed(1)} ${primaryUnit}`
        : '-';
      const pctText = Number.isFinite(flow.displayPct) ? `${flow.displayPct.toFixed(0)}%` : '-';
      const tsText = flow.timestamp ? flow.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
      const dirText = flow.direction === 'forward'
        ? `${row.startTm || '?'} → ${row.endTm || '?'}`
        : `${row.endTm || '?'} → ${row.startTm || '?'}`;
      if (i === 0) {
        attachHoverTooltip(g, `<strong>${row.name}</strong><br>${metricText} · <span style="color:${flow.color};font-weight:700">${pctText}</span>${tsText ? ` · ${tsText}` : ''}<br><span class="tt-label">${dirText}</span>`);
      }
      g.style.cursor = 'pointer';
      g.style.pointerEvents = 'auto';
      g.addEventListener('click', (event) => {
        event.stopPropagation();
        openScadaHatDetails(row, { forceTiles: false });
      });
      fragment.appendChild(g);
    }
  });
  flowLayer.appendChild(fragment);
}

/* ───────── POPUP ENRICHMENT ───────── */
function getScadaPopupFields(hatRow) {
  if (!state.scada.enabled) return [];
  if (state.scada.duplicateHatIds?.has(hatRow.id)) {
    return [
      ['SCADA Durumu', 'Duplicate mapping'],
      ['SCADA Notu', 'Ayni aktif olcum ID birden fazla hatta bagli oldugu icin canli renklendirme disi.']
    ];
  }
  const flow = state.scada.lineFlowByLineId.get(hatRow.id);
  if (!flow) {
    return [['SCADA Durumu', 'Eslesmedi']];
  }
  const fields = [];
  const mwText = flow.mw >= 0 ? `+${flow.mw.toFixed(1)} MW` : `${flow.mw.toFixed(1)} MW`;
  fields.push(['Aktif Güç (MW)', mwText]);
  fields.push(['Yüklenme', `${flow.loadingPct.toFixed(1)}% (${flow.capacityMva} MVA ${state.scada.capacitySeason === 'summer' ? 'Yaz' : 'Kış'})`]);
  const dirText = flow.direction === 'forward'
    ? `${hatRow.startTm || '?'} → ${hatRow.endTm || '?'}`
    : `${hatRow.endTm || '?'} → ${hatRow.startTm || '?'}`;
  fields.push(['Akış Yönü', dirText]);
  if (flow.timestamp) {
    const d = flow.timestamp;
    fields.push(['Ölçüm Zamanı', `${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR')}`]);
  }
  const statusMap = { live: 'Canli', warn: 'Gecikmeli', dead: 'Bayat' };
  fields.push(['Veri Durumu', statusMap[flow.staleState] || '?']);
  fields.push(['SCADA Ölçüm ID', flow.sinsid || '-']);
  fields.push(['Kaynak', `Superset D${SCADA_CONFIG.DASHBOARD_ID}/C${SCADA_CONFIG.CHART_SLICE_ID}`]);
  if (state.scada.lastTransport) {
    fields.push(['Auth Modu', `${state.scada.lastTransport.authMode || '-'}${state.scada.lastTransport.usedFallback ? ' (fallback)' : ''}`]);
  }
  return fields;
}

/* ───────── SIDEBAR SCADA CARD ───────── */
function initScadaCard() {
  const card = document.getElementById('scadaCard');
  if (!card) return;

  const switchEnabled = card.querySelector('[data-scada-switch="enabled"]');
  const switchAuto = card.querySelector('[data-scada-switch="autoRefresh"]');
  const btnRefresh = card.querySelector('[data-scada-btn="refresh"]');
  const btnLog = card.querySelector('[data-scada-btn="log"]');
  const btnAudit = card.querySelector('[data-scada-btn="audit"]');
  const btnReport = card.querySelector('[data-scada-btn="report"]');

  if (switchEnabled) {
    switchEnabled.checked = state.scada.enabled;
    switchEnabled.addEventListener('change', () => {
      state.scada.enabled = switchEnabled.checked;
      if (state.scada.enabled) {
        scadaDoFetch({ trigger: 'layer-enable' });
        scadaStartPolling();
      } else {
        scadaStopPolling();
        state.scada.lineFlowByLineId.clear();
        requestRender();
        if (typeof refreshRankingTable === 'function') refreshRankingTable();
      }
      updateScadaCardUI();
    });
  }

  if (switchAuto) {
    switchAuto.checked = state.scada.autoRefresh;
    switchAuto.addEventListener('change', () => {
      state.scada.autoRefresh = switchAuto.checked;
      if (state.scada.autoRefresh && state.scada.enabled) scadaStartPolling();
      else scadaStopPolling();
      updateScadaCardUI();
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      if (!state.scada.enabled) {
        state.scada.enabled = true;
        if (switchEnabled) switchEnabled.checked = true;
      }
      scadaDoFetch({ trigger: 'manual' });
    });
  }

  if (btnLog) {
    btnLog.addEventListener('click', toggleScadaLogPanel);
  }

  if (btnAudit) {
    btnAudit.addEventListener('click', exportScadaAuditCsv);
  }

  if (btnReport) {
    btnReport.addEventListener('click', showScadaMismatchReportModal);
  }

  const btnMock = card.querySelector('[data-scada-btn="mock"]');
  if (btnMock) {
    updateMockBtnUI(btnMock);
    btnMock.addEventListener('click', () => {
      SCADA_CONFIG.MOCK_ENABLED = !SCADA_CONFIG.MOCK_ENABLED;
      updateMockBtnUI(btnMock);
      scadaLog('info', `Veri kaynağı: ${SCADA_CONFIG.MOCK_ENABLED ? 'MOCK' : 'CANLI (Superset)'}`);
      state.scada.lineFlowByLineId.clear();
      requestRender();
      if (typeof refreshRankingTable === 'function') refreshRankingTable();
      if (state.scada.enabled) scadaDoFetch({ trigger: 'manual' });
    });
  }

  /* Season toggle */
  const btnWinter = document.getElementById('btnSeasonWinter');
  const btnSummer = document.getElementById('btnSeasonSummer');
  if (btnWinter && btnSummer) {
    btnWinter.addEventListener('click', () => setCapacitySeason('winter', btnWinter, btnSummer));
    btnSummer.addEventListener('click', () => setCapacitySeason('summer', btnSummer, btnWinter));
  }

  /* Floating bolt */
  const btnBolt = document.getElementById('btnScadaRanking');
  if (btnBolt) {
    btnBolt.addEventListener('click', toggleRankingPanel);
  }
  updateScadaCardUI();
}

function setCapacitySeason(season, activeBtn, inactiveBtn) {
  state.scada.capacitySeason = season;
  activeBtn.classList.add('active');
  inactiveBtn.classList.remove('active');
  if (state.scada.rowsBySinsid.size) {
    applyScadaSnapshot(state.scada.rowsBySinsid);
    updateScadaCardUI();
  }
  scadaLog('info', `Kapasite modu: ${season === 'summer' ? 'Yaz' : 'Kış'}`);
}

function legacyUpdateScadaCardUI_v1() {
  const elSonVeri = document.getElementById('scadaSonVeri');
  const elToplam = document.getElementById('scadaToplam');
  const elEslesen = document.getElementById('scadaEslesen');
  const elEslesmeyen = document.getElementById('scadaEslesmeyen');
  const elStale = document.getElementById('scadaStale');
  const elHata = document.getElementById('scadaHata');
  const elLejant = document.getElementById('scadaLejant');
  const elKalite = document.getElementById('scadaKalite');

  if (elSonVeri) {
    elSonVeri.textContent = state.scada.lastDataTimestamp
      ? state.scada.lastDataTimestamp.toLocaleTimeString('tr-TR')
      : '—';
  }
  if (elToplam) elToplam.textContent = String(state.scada.totalRows);
  if (elEslesen) elEslesen.textContent = String(state.scada.matchedLines);
  if (elEslesmeyen) elEslesmeyen.textContent = String(state.scada.unmatchedRows);
  if (elStale) elStale.textContent = String(state.scada.staleCount);
  if (elHata) elHata.textContent = state.scada.error || '—';

  if (elLejant) {
    const counts = {};
    SCADA_CONFIG.LOADING_THRESHOLDS.forEach(t => counts[t.label] = { color: t.color, n: 0 });
    state.scada.lineFlowByLineId.forEach(f => {
      if (f.staleState !== 'live') return;
      for (const t of SCADA_CONFIG.LOADING_THRESHOLDS) {
        if (f.loadingPct <= t.max) { counts[t.label].n++; break; }
      }
    });
    elLejant.innerHTML = Object.entries(counts).map(([label, { color, n }]) =>
      `<span style="color:${color}" title="${label}">&#9679;${n}</span>`
    ).join(' ');
  }

  if (elKalite) {
    const quality = state.scada.dataQualitySummary || {};
    const transport = state.scada.lastTransport;
    const parts = [
      `Auth: ${state.scada.authState || 'idle'}`,
      transport?.authMode ? `Tasima: ${transport.authMode}${transport.usedFallback ? ' (fallback)' : ''}` : null,
      `Duplicate mapping: ${state.scada.duplicateMappings?.size || 0}`,
      `Dislanan satir: ${state.scada.ambiguousRows?.length || 0}`,
      `Kalite: ${quality.matched || 0}/${quality.total || 0}`
    ].filter(Boolean);
    elKalite.textContent = parts.join(' | ');
  }

  /* Show/hide floating bolt */
  const btnBolt = document.getElementById('btnScadaRanking');
  if (btnBolt) {
    btnBolt.classList.toggle('hidden', !state.scada.enabled || !state.scada.lineFlowByLineId.size);
  }

  requestRender();
}

/* ───────── LOG PANEL ───────── */
function toggleScadaLogPanel() {
  let panel = document.getElementById('scadaLogPanel');
  if (panel) {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) refreshLogPanel();
    return;
  }
  panel = document.createElement('div');
  panel.id = 'scadaLogPanel';
  panel.className = 'scada-log-panel';
  panel.innerHTML = `
    <div class="scada-log-header">
      <strong>SCADA Log</strong>
      <button id="btnLogClose" class="tiny">✕</button>
    </div>
    <div id="scadaLogContent" class="scada-log-content"></div>
  `;
  const mapShell = document.querySelector('.map-shell');
  if (mapShell) mapShell.appendChild(panel);
  document.getElementById('btnLogClose').addEventListener('click', () => { panel.classList.add('hidden'); });
  refreshLogPanel();
}

function refreshLogPanel() {
  const logContent = document.getElementById('scadaLogContent');
  if (!logContent) return;
  const logs = state.scada.logs || [];
  logContent.innerHTML = logs.slice(-50).reverse().map(e => {
    const cls = e.level === 'error' ? 'log-error' : e.level === 'warn' ? 'log-warn' : 'log-info';
    const time = WebSCADALogTime.formatScadaLogTime(e.ts);
    return `<div class="log-entry ${cls}"><span class="log-time">${time}</span> ${e.message}${e.detail ? ` <span class="log-detail">${e.detail}</span>` : ''}</div>`;
  }).join('');
}

/* ───────── MOCK BUTTON ───────── */
function updateMockBtnUI(btn) {
  if (!btn) return;
  btn.style.background = SCADA_CONFIG.MOCK_ENABLED ? '#f59e0b' : '#22c55e';
  btn.style.color = '#fff';
  btn.title = SCADA_CONFIG.MOCK_ENABLED ? 'Mock Veri Aktif — Tıkla: Canlıya Geç' : 'Canlı Veri Aktif — Tıkla: Mock\'a Geç';
}

/* ───────── RANKING PANEL (⚡) ───────── */
let _rankingSearch = '';
let _rankingKvFilter = '';
let _rankingActiveHatId = null;
let _rankingSortCol = 'pct';
let _rankingSortDir = -1;

function legacyToggleRankingPanel_v1() {
  let panel = document.getElementById('rankingPanel');
  if (panel) {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) refreshRankingTable();
    return;
  }
  panel = document.createElement('div');
  panel.id = 'rankingPanel';
  panel.className = 'ranking-panel';
  /* Light/dark theme sync */
  if (state.map.theme === 'light') panel.classList.add('light-mode');
  panel.innerHTML = `
    <div class="ranking-header">
      <div class="ranking-header-left">
        <span>⚡ En Çok Yüklenen Hatlar</span>
      </div>
      <button id="btnRankingClose">✕</button>
    </div>
    <div class="ranking-filters">
      <input type="text" id="rankingSearch" placeholder="🔍 Hat ara...">
      <select id="rankingKvFilter">
        <option value="">Tümü</option>
        <option value="400">400 kV</option>
        <option value="154">154 kV</option>
        <option value="66">66 kV</option>
      </select>
    </div>
    <div class="ranking-body">
      <table class="ranking-table">
        <thead><tr>
          <th class="col-idx">#</th>
          <th class="col-name" data-sort="name" style="cursor:pointer" title="İsme göre sırala">Hat Adı ↑↓</th>
          <th class="col-km" data-sort="km" style="cursor:pointer" title="Uzunluğa göre sırala">km ↑↓</th>
          <th class="col-ts" data-sort="ts" style="cursor:pointer" title="Zamana göre sırala">Zaman ↑↓</th>
          <th class="col-mw" data-sort="mw" style="cursor:pointer" title="Güce göre sırala">MW ↑↓</th>
          <th class="col-pct" data-sort="pct" style="cursor:pointer" title="Yüklenmeye göre sırala">% ↑↓</th>
        </tr></thead>
        <tbody id="rankingTbody"></tbody>
      </table>
    </div>
    <div class="ranking-footer">
      <span id="rankingCount"></span>
      <button id="btnRankingCsv">📥 CSV İndir</button>
    </div>
  `;
  const mapShell = document.querySelector('.map-shell');
  if (mapShell) mapShell.appendChild(panel);

  document.getElementById('btnRankingClose').addEventListener('click', closeRankingPanel);
  document.getElementById('btnRankingCsv').addEventListener('click', exportRankingCsv);
  document.getElementById('rankingSearch').addEventListener('input', (e) => {
    _rankingSearch = normalizeText(e.target.value);
    refreshRankingTable();
    requestRender();
  });
  document.getElementById('rankingKvFilter').addEventListener('change', (e) => {
    _rankingKvFilter = e.target.value;
    refreshRankingTable();
    requestRender();
  });
  /* Event delegation for table headers (sorting) */
  document.getElementById('rankingPanel').querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const col = th.dataset.sort;
      if (_rankingSortCol === col) _rankingSortDir *= -1;
      else { _rankingSortCol = col; _rankingSortDir = col === 'name' ? 1 : -1; }
      refreshRankingTable();
    }
  });

  /* Event delegation for table rows */
  document.getElementById('rankingTbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-hat-id]');
    if (tr) onRankingRowClick(tr.dataset.hatId);
  });

  refreshRankingTable();
}

function legacyCloseRankingPanel_v1() {
  const panel = document.getElementById('rankingPanel');
  if (panel) panel.classList.add('hidden');
  _rankingSearch = '';
  _rankingKvFilter = '';
  _rankingActiveHatId = null;
  requestRender();
}

function legacyGetFilteredFlows_v1() {
  let flows = [];
  state.scada.lineFlowByLineId.forEach(flow => flows.push(flow));
  if (_rankingKvFilter) flows = flows.filter(f => f.hatKv === _rankingKvFilter);
  if (_rankingSearch) flows = flows.filter(f => normalizeText(f.hatName).includes(_rankingSearch));
  flows.sort((a, b) => {
    let valA, valB;
    switch (_rankingSortCol) {
      case 'name': valA = a.hatName.toLowerCase(); valB = b.hatName.toLowerCase(); break;
      case 'km': valA = a.hatLengthKm || 0; valB = b.hatLengthKm || 0; break;
      case 'ts': valA = a.timestamp ? a.timestamp.getTime() : 0; valB = b.timestamp ? b.timestamp.getTime() : 0; break;
      case 'mw': valA = Math.abs(a.mw); valB = Math.abs(b.mw); break;
      case 'pct': default: valA = a.loadingPct; valB = b.loadingPct; break;
    }
    if (valA < valB) return -1 * _rankingSortDir;
    if (valA > valB) return 1 * _rankingSortDir;
    return 0;
  });
  return flows;
}

function legacyRefreshRankingTable_v1() {
  const tbody = document.getElementById('rankingTbody');
  if (!tbody) return;

  const allFiltered = getFilteredFlows();
  const top = allFiltered.slice(0, 50);

  /* Update footer count */
  const countEl = document.getElementById('rankingCount');
  if (countEl) countEl.textContent = `${Math.min(50, allFiltered.length)} / ${allFiltered.length} hat`;

  tbody.innerHTML = top.map((f, i) => {
    const ts = f.timestamp
      ? `${f.timestamp.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${f.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
      : '—';
    const pct = f.loadingPct.toFixed(1);
    const pctColor = getFlowColor(f.loadingPct);
    const activeClass = f.hatId === _rankingActiveHatId ? 'ranking-active' : '';
    return `<tr class="${activeClass}" data-hat-id="${f.hatId}">
      <td class="col-idx">${i + 1}</td>
      <td class="col-name" title="${f.hatName}">${f.hatName}${f.isMock ? ' <i style="opacity:0.6;font-size:0.9em">(m)</i>' : ''}</td>
      <td class="col-km">${typeof f.hatLengthKm === 'number' ? f.hatLengthKm.toFixed(0) : '—'}</td>
      <td class="col-ts">${ts}</td>
      <td class="col-mw">${f.mw >= 0 ? '+' : ''}${f.mw.toFixed(1)}</td>
      <td class="col-pct"><span class="ranking-pct-cell" style="background:${pctColor};color:#fff">${pct}</span></td>
    </tr>`;
  }).join('');
}

function legacyOpenScadaHatDetails_v1(hat, options = {}) {
  if (!hat) return;
  state.selection = { kind: 'hat', id: hat.id, measureSourceId: '', measureTargetIds: [] };
  const fields = [
    ['Hat ID', hat.kmlDescriptionId || '-'],
    ['Guzergah', `${hat.startTm || '-'} -> ${hat.endTm || '-'}`],
    ['Uzunluk', formatNumber(hat.lengthKm, ' km')],
    ['YTM', (hat.ytmNames || []).join(' / ') || '-'],
    ['Kapasite (K/Y)', `${formatNumber(hat.winterCapacityMva, '')} / ${formatNumber(hat.summerCapacityMva, ' MVA')}`],
    ['Hat Kesit', formatKesit(hat.characteristic)]
  ];
  if (hat.olcumNoktasiIdAktif) fields.push(['Olcum Noktasi (Aktif)', hat.olcumNoktasiIdAktif]);
  if (typeof getScadaPopupFields === 'function') {
    getScadaPopupFields(hat).forEach((field) => fields.push(field));
  }
  showInfo({
    title: hat.name,
    subtitle: hat.kv ? `${hat.kv} kV Hat` : 'Hat',
    tags: [(hat.ytmNames || []).join(' / ') || '-'],
    fields,
    actions: [{ id: 'btnShowScadaChart', label: 'Grafik Goster' }]
  });
  const chartBtn = document.getElementById('btnShowScadaChart');
  if (chartBtn) chartBtn.addEventListener('click', () => showScadaChartModal(hat.id, hat.name));
  requestRender({ forceTiles: Boolean(options.forceTiles) });
}

function legacyOnRankingRowClick_v1(hatId) {
  _rankingActiveHatId = hatId;
  if (!state.network?.hatLines) return;
  const hat = state.network.hatLines.find(h => h.id === hatId);
  if (!hat) return;

  /* Center without changing zoom */
  let lon, lat;
  if (hat.coords && hat.coords.length) {
    const mid = hat.coords[Math.floor(hat.coords.length / 2)];
    lon = mid[0]; lat = mid[1];
  } else if (hat.bbox && hat.bbox.length === 4) {
    lon = (hat.bbox[0] + hat.bbox[2]) / 2;
    lat = (hat.bbox[1] + hat.bbox[3]) / 2;
  }
  if (lon && lat) {
    state.map.centerLon = lon;
    state.map.centerLat = lat;
    state.map.tileState.rangeKey = '';
  }

  /* Select hat */
  state.selection = { kind: 'hat', id: hat.id, measureSourceId: '', measureTargetIds: [] };
  const fields = [
    ['Hat ID', hat.kmlDescriptionId || '-'],
    ['Güzergah', `${hat.startTm || '-'} ➔ ${hat.endTm || '-'}`],
    ['Uzunluk', formatNumber(hat.lengthKm, ' km')],
    ['YTM', (hat.ytmNames || []).join(' / ') || '-'],
    ['Kapasite (K/Y)', `${formatNumber(hat.winterCapacityMva, '')} / ${formatNumber(hat.summerCapacityMva, ' MVA')}`],
    ['Hat Kesit', formatKesit(hat.characteristic)]
  ];
  if (hat.olcumNoktasiIdAktif) fields.push(['Ölçüm Noktası (Aktif)', hat.olcumNoktasiIdAktif]);
  if (typeof getScadaPopupFields === 'function') {
    getScadaPopupFields(hat).forEach(f => fields.push(f));
  }
  showInfo({
    title: hat.name,
    subtitle: hat.kv ? `${hat.kv} kV Hat` : 'Hat',
    tags: [(hat.ytmNames || []).join(' / ') || '-'],
    fields,
    actions: [{ id: 'btnShowScadaChart', label: '📊 Grafik Göster' }]
  });
  const chartBtn = document.getElementById('btnShowScadaChart');
  if (chartBtn) chartBtn.addEventListener('click', () => showScadaChartModal(hat.id, hat.name));
  requestRender({ forceTiles: true });
  refreshRankingTable();
}

/* ───────── CSV EXPORT ───────── */
function legacyExportRankingCsv_v1() {
  const flows = getFilteredFlows();
  if (!flows.length) return;

  const season = state.scada.capacitySeason === 'summer' ? 'Yaz' : 'Kış';
  const header = ['Sıra', 'Hat Adı', 'kV', 'km', 'Başlangıç TM', 'Bitiş TM', 'Aktif Güç (MW)', `Yüklenme (%) [${season}]`, 'Kapasite (MVA)', 'Son Veri Zamanı', 'SCADA ID'];
  const rows = flows.map((f, i) => {
    const hat = state.network?.hatLines?.find(h => h.id === f.hatId);
    const ts = f.timestamp ? `${f.timestamp.toLocaleDateString('tr-TR')} ${f.timestamp.toLocaleTimeString('tr-TR')}` : '';
    return [
      i + 1,
      f.hatName,
      f.hatKv,
      typeof f.hatLengthKm === 'number' ? f.hatLengthKm.toFixed(1).replace('.', ',') : '',
      hat?.startTm || '',
      hat?.endTm || '',
      f.mw.toFixed(2).replace('.', ','),
      f.loadingPct.toFixed(2).replace('.', ','),
      f.capacityMva,
      ts,
      f.sinsid
    ];
  });

  const csvContent = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scada_hat_yukleme_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  scadaLog('info', `CSV indirildi: ${flows.length} satır.`);
}

/* ───────── HISTORY CHART ───────── */
function legacyBuildHistoryChartHtml_v1(hatId, hat) {
  if (!state.scada.history) return '';
  const hist = state.scada.history.get(hatId);
  if (!hist || hist.length < 2) return '';

  const w = 320, h = 100, pad = 28;
  const winterCap = hat?.winterCapacityMva || 0;
  const summerCap = hat?.summerCapacityMva || 0;
  const mwValues = hist.map(p => Math.abs(p.mw));
  const maxVal = Math.max(...mwValues, winterCap, summerCap, 1);
  const minTime = hist[0].ts.getTime();
  const maxTime = hist[hist.length - 1].ts.getTime();
  const timeSpan = maxTime - minTime || 1;

  const toX = t => pad + ((t - minTime) / timeSpan) * (w - pad * 2);
  const toY = v => h - pad - ((v / maxVal) * (h - pad * 2));

  let svg = `<div class="scada-history-chart"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;

  /* Capacity lines */
  if (winterCap > 0) {
    const y = toY(winterCap);
    svg += `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="#38bdf8" stroke-width="1" stroke-dasharray="4 2" opacity="0.6"/>`;
    svg += `<text x="${w - pad + 2}" y="${y + 3}" fill="#38bdf8" font-size="7">Kış ${winterCap}</text>`;
  }
  if (summerCap > 0 && summerCap !== winterCap) {
    const y = toY(summerCap);
    svg += `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="#f97316" stroke-width="1" stroke-dasharray="4 2" opacity="0.6"/>`;
    svg += `<text x="${w - pad + 2}" y="${y + 3}" fill="#f97316" font-size="7">Yaz ${summerCap}</text>`;
  }

  /* MW line */
  const points = hist.map(p => `${toX(p.ts.getTime())},${toY(Math.abs(p.mw))}`).join(' ');
  svg += `<polyline points="${points}" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linejoin="round"/>`;

  /* Dots */
  hist.forEach(p => {
    const x = toX(p.ts.getTime()), y = toY(Math.abs(p.mw));
    const col = getFlowColor(p.pct);
    svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="${col}" stroke="#0f172a" stroke-width="0.5"/>`;
  });

  /* Axes labels */
  svg += `<text x="${pad}" y="${h - 4}" fill="#64748b" font-size="7">${hist[0].ts.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</text>`;
  svg += `<text x="${w - pad}" y="${h - 4}" fill="#64748b" font-size="7" text-anchor="end">${hist[hist.length - 1].ts.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</text>`;
  svg += `<text x="2" y="${toY(maxVal) + 3}" fill="#64748b" font-size="7">${maxVal.toFixed(0)}</text>`;
  svg += `<text x="2" y="${h - pad + 3}" fill="#64748b" font-size="7">0</text>`;

  svg += `</svg><div style="font-size:9px;color:#64748b;margin-top:2px">Son ${hist.length} ölçüm · MW grafiği</div></div>`;
  return svg;
}

function legacyShowScadaChartModal_v1(hatId, hatName) {
  let modal = document.getElementById('scadaChartModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'scadaChartModal';
    modal.className = 'info-card scada-chart-modal'; /* Use info-card theme styling as base */
    document.querySelector('.map-shell').appendChild(modal);
  }
  
  const hat = state.network?.hatLines?.find(h => h.id === hatId);
  const chartHtml = buildHistoryChartHtml(hatId, hat);
  
  if (!chartHtml) {
    scadaLog('warn', 'Grafik oluşturulacak yeterli geçmiş veri yok.');
    return;
  }
  
  modal.innerHTML = `
    <div class="info-head">
      <div>
        <p class="info-kicker">Yüklenme Grafiği</p>
        <h3>${escapeHtml(hatName || 'Hat')}</h3>
      </div>
      <button class="info-close">×</button>
    </div>
    <div style="padding: 10px; display:flex; justify-content:center; align-items:center;">
      ${chartHtml}
    </div>
  `;
  const closeBtn = modal.querySelector('.info-close');
  if (closeBtn) {
    closeBtn.removeAttribute('onclick');
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  }
  modal.classList.remove('hidden');
}

function getVisibleFlowEntries(options = {}) {
  const visibleHats = typeof getVisibleHats === 'function' ? getVisibleHats() : [];
  const visibleHatIds = new Set(visibleHats.map((hat) => hat.id));
  const applySearch = Boolean(options.applySearch);
  const flows = [];
  state.scada.lineFlowByLineId.forEach((flow) => {
    if (!visibleHatIds.has(flow.hatId)) return;
    if (applySearch && _rankingSearch && !normalizeText(flow.hatName).includes(_rankingSearch)) return;
    flows.push(flow);
  });
  return flows;
}

function getRankingKvSelectionValue() {
  const selected = state?.filters?.kv ? [...state.filters.kv].sort() : [];
  if (selected.length === 3 && ['154', '400', '66'].every((value) => state.filters.kv.has(value))) return '';
  if (selected.length === 1) return selected[0];
  return 'custom';
}

function syncRankingKvFilterControl() {
  _rankingKvFilter = getRankingKvSelectionValue();
  const select = document.getElementById('rankingKvFilter');
  if (!select) return;
  if (!select.querySelector('option[value="custom"]')) {
    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = 'Ozel';
    customOption.disabled = true;
    select.appendChild(customOption);
  }
  select.value = _rankingKvFilter;
}

function applyRankingKvPreset(value) {
  if (value === 'custom') {
    syncRankingKvFilterControl();
    return;
  }
  const nextValues = value ? [value] : ['400', '154', '66'];
  if (typeof setKvFilterSelection === 'function') setKvFilterSelection(nextValues);
}

function getVisibleLegendCounts() {
  const counts = {};
  SCADA_CONFIG.LOADING_THRESHOLDS.forEach((threshold) => {
    counts[threshold.label] = { color: threshold.color, n: 0 };
  });
  getVisibleFlowEntries().forEach((flow) => {
    if (flow.staleState !== 'live' || flow.unavailable) return;
    for (const threshold of SCADA_CONFIG.LOADING_THRESHOLDS) {
      if (flow.loadingPct <= threshold.max) {
        counts[threshold.label].n += 1;
        break;
      }
    }
  });
  return counts;
}

function buildHatPopupModel(hat) {
  const tags = [hat.kv ? `${hat.kv} kV Hat` : 'Hat', (hat.ytmNames || []).join(' / ') || '-'];
  const flow = state.scada.lineFlowByLineId.get(hat.id);
  const isDuplicate = state.scada.duplicateHatIds?.has(hat.id);
  const routeText = `${hat.startTm || '-'} -> ${hat.endTm || '-'}`;
  const seasonLabel = state.scada.capacitySeason === 'summer' ? 'Yaz' : 'Kis';
  const selectedCapacity = state.scada.capacitySeason === 'summer'
    ? (hat.summerCapacityMva || hat.winterCapacityMva)
    : (hat.winterCapacityMva || hat.summerCapacityMva);

  let loadingText = 'Eslesmedi';
  let directionText = routeText;
  let measureTimeText = 'Veri yok';
  let detailFields = [
    ['Hat ID', hat.kmlDescriptionId || '-'],
    ['Guzergah', routeText],
    ['YTM', (hat.ytmNames || []).join(' / ') || '-'],
    ['Hat Kesit', formatKesit(hat.characteristic)]
  ];

  if (hat.olcumNoktasiIdAktif) detailFields.push(['Olcum Noktasi (Aktif)', hat.olcumNoktasiIdAktif]);
  if (hat.olcumNoktasiIdReaktif) detailFields.push(['Olcum Noktasi (Reaktif)', hat.olcumNoktasiIdReaktif]);

  if (isDuplicate) {
    loadingText = 'Duplicate mapping';
    measureTimeText = 'Kullanilamiyor';
    detailFields = detailFields.concat([
      ['SCADA Durumu', 'Duplicate mapping'],
      ['SCADA Notu', 'Ayni aktif olcum ID birden fazla hatta bagli oldugu icin canli renklendirme disi.']
    ]);
  } else if (flow) {
    const mwText = flow.mw >= 0 ? `+${flow.mw.toFixed(1)} MW` : `${flow.mw.toFixed(1)} MW`;
    const statusMap = { live: 'Canli', warn: 'Gecikmeli', dead: 'Bayat' };
    loadingText = `${flow.loadingPct.toFixed(1)}% · ${mwText}`;
    directionText = flow.direction === 'forward'
      ? `${hat.startTm || '?'} -> ${hat.endTm || '?'}`
      : `${hat.endTm || '?'} -> ${hat.startTm || '?'}`;
    measureTimeText = flow.timestamp
      ? `${flow.timestamp.toLocaleDateString('tr-TR')} ${flow.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
      : 'Veri yok';
    detailFields = detailFields.concat([
      ['Aktif Guc (MW)', mwText],
      ['Secili Kapasite', `${formatNumber(flow.capacityMva, ' MVA')} (${seasonLabel})`],
      ['Kapasite (Kis/Yaz)', `${formatNumber(flow.winterCapacity, '')} / ${formatNumber(flow.summerCapacity, ' MVA')}`],
      ['Veri Durumu', statusMap[flow.staleState] || '-'],
      ['SCADA Olcum ID', flow.sinsid || '-'],
      ['Kaynak', `Superset D${SCADA_CONFIG.DASHBOARD_ID}/C${SCADA_CONFIG.CHART_SLICE_ID}`]
    ]);
    if (state.scada.lastTransport) {
      detailFields.push(['Auth Modu', `${state.scada.lastTransport.authMode || '-'}${state.scada.lastTransport.usedFallback ? ' (fallback)' : ''}`]);
    }
  } else if (state.scada.enabled) {
    detailFields.push(['SCADA Durumu', 'Eslesmedi']);
  }

  return {
    title: hat.name,
    subtitle: 'Hat Detayi',
    tags,
    compactFields: [
      ['Uzunluk', formatNumber(hat.lengthKm, ' km')],
      ['Kapasite', `${formatNumber(selectedCapacity, ' MVA')} (${seasonLabel})`],
      ['Yuklenme', loadingText],
      ['Akis Yonu', directionText],
      ['Olcum Zamani', measureTimeText]
    ],
    detailFields
  };
}

let _scadaChartEscHandler = null;

function closeScadaChartModal() {
  const backdrop = document.getElementById('scadaChartModalBackdrop');
  if (backdrop) backdrop.remove();
  if (_scadaChartEscHandler) {
    window.removeEventListener('keydown', _scadaChartEscHandler);
    _scadaChartEscHandler = null;
  }
}

function legacyUpdateScadaCardUI_v2() {
  const elSonVeri = document.getElementById('scadaSonVeri');
  const elToplam = document.getElementById('scadaToplam');
  const elEslesen = document.getElementById('scadaEslesen');
  const elEslesmeyen = document.getElementById('scadaEslesmeyen');
  const elStale = document.getElementById('scadaStale');
  const elHata = document.getElementById('scadaHata');
  const elLejant = document.getElementById('scadaLejant');
  const elKalite = document.getElementById('scadaKalite');
  const visibleSummary = typeof refreshScadaVisibleSummary === 'function'
    ? refreshScadaVisibleSummary()
    : (state.scada.visibleSummary || {});

  if (elSonVeri) {
    elSonVeri.textContent = state.scada.lastDataTimestamp
      ? state.scada.lastDataTimestamp.toLocaleTimeString('tr-TR')
      : '—';
  }
  if (elToplam) elToplam.textContent = String(visibleSummary.total || 0);
  if (elEslesen) elEslesen.textContent = String(visibleSummary.matched || 0);
  if (elEslesmeyen) elEslesmeyen.textContent = String(visibleSummary.unmatched || 0);
  if (elStale) elStale.textContent = String(visibleSummary.stale || 0);
  if (elHata) elHata.textContent = state.scada.error || '—';

  if (elLejant) {
    const counts = getVisibleLegendCounts();
    elLejant.innerHTML = Object.entries(counts).map(([label, { color, n }]) => (
      `<span style="color:${color}" title="${label}">●${n}</span>`
    )).join(' ');
  }

  if (elKalite) {
    const quality = state.scada.dataQualitySummary || {};
    const transport = state.scada.lastTransport;
    const parts = [
      `Auth: ${state.scada.authState || 'idle'}`,
      transport?.authMode ? `Tasima: ${transport.authMode}${transport.usedFallback ? ' (fallback)' : ''}` : null,
      `Gorunen kalite: ${visibleSummary.matched || 0}/${visibleSummary.total || 0}`,
      `Gorunen duplicate: ${visibleSummary.duplicateMapped || 0}`,
      `Ham duplicate: ${state.scada.duplicateMappings?.size || 0}`,
      `Dislanan satir: ${state.scada.ambiguousRows?.length || 0}`,
      `Ham satir kalite: ${quality.matched || 0}/${quality.total || 0}`
    ].filter(Boolean);
    elKalite.textContent = parts.join(' | ');
  }

  const btnBolt = document.getElementById('btnScadaRanking');
  if (btnBolt) {
    btnBolt.classList.toggle('hidden', !state.scada.enabled || !getVisibleFlowEntries().length);
  }

  syncRankingKvFilterControl();
  requestRender();
}

let _scadaAuditEscHandler = null;

function getScadaQueryContract() {
  if (typeof SCADA_COMMON?.resolveQueryContract === 'function') {
    return SCADA_COMMON.resolveQueryContract({
      timeRange: SCADA_CONFIG.QUERY_TIME_RANGE,
      kvFilters: SCADA_CONFIG.QUERY_KV_FILTERS,
      tearFilters: SCADA_CONFIG.QUERY_TEAR_FILTERS,
      elementName: SCADA_CONFIG.QUERY_ELEMENT_NAME,
      rowLimit: SCADA_CONFIG.QUERY_ROW_LIMIT
    });
  }
  return {
    timeRange: SCADA_CONFIG.QUERY_TIME_RANGE,
    kvFilters: SCADA_CONFIG.QUERY_KV_FILTERS.slice(),
    tearFilters: SCADA_CONFIG.QUERY_TEAR_FILTERS.slice(),
    elementName: SCADA_CONFIG.QUERY_ELEMENT_NAME,
    rowLimit: SCADA_CONFIG.QUERY_ROW_LIMIT
  };
}

function buildScadaAuditReport() {
  const visibleHats = typeof getVisibleHats === 'function' ? getVisibleHats() : [];
  const contract = getScadaQueryContract();
  const report = typeof SCADA_COMMON?.computeAuditReport === 'function'
    ? SCADA_COMMON.computeAuditReport({
      visibleHats,
      rowsBySinsid: state.scada.rowsBySinsid,
      lineFlowByLineId: state.scada.lineFlowByLineId,
      duplicateHatIds: state.scada.duplicateHatIds,
      rawRows: state.scada.fetchMeta?.rawRows || state.scada.totalRows,
      filterKey: typeof getScadaVisibilityFilterKey === 'function' ? getScadaVisibilityFilterKey() : '',
      queryContract: contract
    })
    : { summary: { visibleTotal: visibleHats.length }, rows: [], mismatches: [] };

  const statusCounts = new Map();
  (report.rows || []).forEach((row) => {
    statusCounts.set(row.status, (statusCounts.get(row.status) || 0) + 1);
  });
  report.statusCounts = statusCounts;
  report.summary = {
    ...report.summary,
    matchedAny: Number(report.summary.live || 0) + Number(report.summary.stale || 0),
    issuesTotal: Number(report.summary.unmatchedTotal || 0),
    generatedAt: new Date(),
    transportMode: state.scada.lastTransport?.authMode || '-',
    transportFallback: Boolean(state.scada.lastTransport?.usedFallback),
    dataTimestamp: state.scada.lastDataTimestamp || null
  };
  return report;
}

function formatAuditClock(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.toLocaleDateString('tr-TR')} ${date.toLocaleTimeString('tr-TR')}`;
}

function downloadScadaCsvFile(filename, header, rows) {
  const csvContent = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function exportScadaAuditCsv() {
  const report = buildScadaAuditReport();
  if (!report.rows?.length) {
    setScadaStatusMessage('Denetim CSV icin henuz SCADA verisi bulunmuyor.', 'warn');
    scadaLog('warn', 'Denetim CSV istenildi ancak export edilecek audit verisi yok.');
    return;
  }

  const header = [
    'Hat ID',
    'Hat Adi',
    'YTM',
    'kV',
    'Baslangic TM',
    'Bitis TM',
    'SCADA ID',
    'Durum',
    'Neden',
    'Kaynak Zaman',
    'Aktif Guc (MW)',
    'Yuklenme (%)',
    'Kapasite (MVA)',
    'Stale Durumu',
    'Kaynak TM',
    'Kaynak Uzak Uc'
  ];

  const rows = report.rows.map((row) => [
    row.hatId,
    row.hatName,
    row.ytm,
    row.kv,
    row.startTm,
    row.endTm,
    row.scadaId,
    row.status,
    row.reason,
    formatAuditClock(row.sourceTimestamp),
    Number.isFinite(row.activePowerMw) ? row.activePowerMw.toFixed(2).replace('.', ',') : '',
    Number.isFinite(row.loadingPct) ? row.loadingPct.toFixed(2).replace('.', ',') : '',
    Number.isFinite(row.capacityMva) ? String(row.capacityMva) : '',
    row.staleState || '',
    row.sourceTm,
    row.sourceRemote
  ]);

  const filename = `scada_eslesme_denetim_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadScadaCsvFile(filename, header, rows);
  setScadaStatusMessage(
    `Denetim CSV indirildi: ${report.rows.length} hat, ${report.summary.issuesTotal || 0} mismatch.`,
    report.summary.issuesTotal ? 'warn' : 'info'
  );
  scadaLog(
    'info',
    `Denetim CSV indirildi: ${report.rows.length} hat, ${report.summary.live || 0} live, ${report.summary.stale || 0} stale, ${report.summary.issuesTotal || 0} mismatch.`
  );
}

function closeScadaMismatchReportModal() {
  const backdrop = document.getElementById('scadaAuditModalBackdrop');
  if (backdrop) backdrop.remove();
  if (_scadaAuditEscHandler) {
    window.removeEventListener('keydown', _scadaAuditEscHandler);
    _scadaAuditEscHandler = null;
  }
}

function showScadaMismatchReportModal() {
  const report = buildScadaAuditReport();
  if (!report.rows?.length) {
    setScadaStatusMessage('Mismatch raporu icin henuz SCADA verisi bulunmuyor.', 'warn');
    scadaLog('warn', 'Mismatch raporu istendi ancak audit verisi yok.');
    return;
  }

  closeScadaMismatchReportModal();

  const mismatchItems = (report.mismatches || []).slice(0, 16).map((row) => `
    <div class="scada-audit-item">
      <strong>${escapeHtml(row.hatName || row.hatId || '-')}</strong>
      <span>${escapeHtml(row.status || '-')} | ${escapeHtml(row.reason || '-')}</span>
      <span>${escapeHtml((row.startTm || '-') + ' -> ' + (row.endTm || '-'))}</span>
      <span>SCADA ID: ${escapeHtml(row.scadaId || '-')}</span>
    </div>
  `).join('');

  const queryKv = (report.summary.queryContract?.kvFilters || []).join(', ') || '-';
  const queryTear = (report.summary.queryContract?.tearFilters || []).join(', ') || '-';
  const backdrop = document.createElement('div');
  backdrop.id = 'scadaAuditModalBackdrop';
  backdrop.className = 'scada-chart-backdrop';
  backdrop.innerHTML = `
    <div class="scada-audit-modal" role="dialog" aria-modal="true" aria-label="SCADA mismatch raporu">
      <div class="scada-chart-header">
        <div>
          <p class="info-kicker">SCADA Mismatch Raporu</p>
          <h3>Gorunen hatlar icin audit ozeti</h3>
        </div>
        <div class="info-actions">
          <button id="btnExportAuditFromModal" class="secondary">Denetim CSV</button>
          <button id="btnCloseScadaAudit" class="info-close" title="Kapat">×</button>
        </div>
      </div>
      <div class="scada-audit-summary">
        <div class="scada-audit-stat"><span>Gorunen Hat</span><strong>${report.summary.visibleTotal || 0}</strong></div>
        <div class="scada-audit-stat"><span>Yapisal Eslesme</span><strong>${report.summary.structuralMatches || 0}</strong></div>
        <div class="scada-audit-stat"><span>Canli / Stale</span><strong>${report.summary.live || 0} / ${report.summary.stale || 0}</strong></div>
        <div class="scada-audit-stat"><span>Mismatch</span><strong>${report.summary.issuesTotal || 0}</strong></div>
      </div>
      <div class="scada-chart-body">
        <div class="scada-audit-section">
          <h4>Kaynak ve Sorgu Kontrati</h4>
          <div class="scada-audit-grid">
            <div><span>Ham kaynak satiri</span><strong>${report.summary.rawRows || 0}</strong></div>
            <div><span>Tekil olcum</span><strong>${report.summary.normalizedRows || 0}</strong></div>
            <div><span>Son veri zamani</span><strong>${escapeHtml(formatAuditClock(report.summary.dataTimestamp))}</strong></div>
            <div><span>Tasima</span><strong>${escapeHtml(report.summary.transportMode || '-')}</strong></div>
            <div><span>Zaman araligi</span><strong>${escapeHtml(report.summary.queryContract?.timeRange || '-')}</strong></div>
            <div><span>KV filtreleri</span><strong>${escapeHtml(queryKv)}</strong></div>
            <div><span>tear filtreleri</span><strong>${escapeHtml(queryTear)}</strong></div>
            <div><span>Row limit</span><strong>${report.summary.queryContract?.rowLimit || 0}</strong></div>
          </div>
        </div>
        <div class="scada-audit-section">
          <h4>Mismatch Dagilimi</h4>
          <div class="scada-audit-grid">
            <div><span>Aktif ID bos</span><strong>${report.summary.missingActiveId || 0}</strong></div>
            <div><span>Kaynakta yok</span><strong>${report.summary.missingSourceRow || 0}</strong></div>
            <div><span>Duplicate mapping</span><strong>${report.summary.duplicateMapping || 0}</strong></div>
            <div><span>Transport unavailable</span><strong>${report.summary.transportUnavailable || 0}</strong></div>
          </div>
        </div>
        <div class="scada-audit-section">
          <h4>Ornek problemli hatlar</h4>
          <div class="scada-audit-list">
            ${mismatchItems || '<div class="scada-audit-item"><strong>Mismatch yok</strong><span>Gorunen hatlar icin problemli kayit bulunmadi.</span></div>'}
          </div>
        </div>
      </div>
    </div>
  `;

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeScadaMismatchReportModal();
  });
  const mapShell = document.querySelector('.map-shell');
  if (mapShell) mapShell.appendChild(backdrop);

  const closeBtn = document.getElementById('btnCloseScadaAudit');
  if (closeBtn) closeBtn.addEventListener('click', closeScadaMismatchReportModal);
  const exportBtn = document.getElementById('btnExportAuditFromModal');
  if (exportBtn) exportBtn.addEventListener('click', exportScadaAuditCsv);

  _scadaAuditEscHandler = (event) => {
    if (event.key === 'Escape') closeScadaMismatchReportModal();
  };
  window.addEventListener('keydown', _scadaAuditEscHandler);
}

function legacyExportRankingCsv_v2() {
  const flows = getFilteredFlows();
  if (!flows.length) return;

  const season = state.scada.capacitySeason === 'summer' ? 'Yaz' : 'Kis';
  const header = ['Sira', 'Hat Adi', 'kV', 'km', 'Baslangic TM', 'Bitis TM', 'Aktif Guc (MW)', `Yuklenme (%) [${season}]`, 'Kapasite (MVA)', 'Son Veri Zamani', 'SCADA ID'];
  const rows = flows.map((flow, index) => {
    const hat = state.network?.hatLines?.find((entry) => entry.id === flow.hatId);
    const timestamp = flow.timestamp ? `${flow.timestamp.toLocaleDateString('tr-TR')} ${flow.timestamp.toLocaleTimeString('tr-TR')}` : '';
    return [
      index + 1,
      flow.hatName,
      flow.hatKv,
      typeof flow.hatLengthKm === 'number' ? flow.hatLengthKm.toFixed(1).replace('.', ',') : '',
      hat?.startTm || '',
      hat?.endTm || '',
      flow.mw.toFixed(2).replace('.', ','),
      flow.loadingPct.toFixed(2).replace('.', ','),
      flow.capacityMva,
      timestamp,
      flow.sinsid
    ];
  });

  const filename = `scada_ranking_hat_yukleme_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadScadaCsvFile(filename, header, rows);
  scadaLog('info', `Ranking CSV indirildi: ${flows.length} satir.`);
}

function legacyToggleRankingPanel_v2() {
  let panel = document.getElementById('rankingPanel');
  if (panel) {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      syncRankingKvFilterControl();
      refreshRankingTable();
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
        <span>⚡ En Cok Yuklenen Hatlar</span>
      </div>
      <button id="btnRankingClose">✕</button>
    </div>
    <div class="ranking-filters">
      <input type="text" id="rankingSearch" placeholder="Hat ara...">
      <select id="rankingKvFilter">
        <option value="">Tumu</option>
        <option value="400">400 kV</option>
        <option value="154">154 kV</option>
        <option value="66">66 kV</option>
        <option value="custom" disabled>Ozel</option>
      </select>
    </div>
    <div class="ranking-body">
      <table class="ranking-table">
        <thead><tr>
          <th class="col-idx">#</th>
          <th class="col-name" data-sort="name" style="cursor:pointer" title="Isme gore sirala">Hat Adi ↑↓</th>
          <th class="col-km" data-sort="km" style="cursor:pointer" title="Uzunluga gore sirala">km ↑↓</th>
          <th class="col-ts" data-sort="ts" style="cursor:pointer" title="Zamana gore sirala">Zaman ↑↓</th>
          <th class="col-mw" data-sort="mw" style="cursor:pointer" title="Guce gore sirala">MW ↑↓</th>
          <th class="col-pct" data-sort="pct" style="cursor:pointer" title="Yuklenmeye gore sirala">% ↑↓</th>
        </tr></thead>
        <tbody id="rankingTbody"></tbody>
      </table>
    </div>
    <div class="ranking-footer">
      <span id="rankingCount"></span>
      <button id="btnRankingCsv">CSV Indir</button>
    </div>
  `;
  const mapShell = document.querySelector('.map-shell');
  if (mapShell) mapShell.appendChild(panel);

  document.getElementById('btnRankingClose').addEventListener('click', closeRankingPanel);
  document.getElementById('btnRankingCsv').addEventListener('click', exportRankingCsv);
  document.getElementById('rankingSearch').addEventListener('input', (event) => {
    _rankingSearch = normalizeText(event.target.value);
    refreshRankingTable();
  });
  document.getElementById('rankingKvFilter').addEventListener('change', (event) => {
    applyRankingKvPreset(event.target.value);
  });
  document.getElementById('rankingPanel').querySelector('thead').addEventListener('click', (event) => {
    const th = event.target.closest('th[data-sort]');
    if (!th) return;
    const col = th.dataset.sort;
    if (_rankingSortCol === col) _rankingSortDir *= -1;
    else {
      _rankingSortCol = col;
      _rankingSortDir = col === 'name' ? 1 : -1;
    }
    refreshRankingTable();
  });
  document.getElementById('rankingTbody').addEventListener('click', (event) => {
    const tr = event.target.closest('tr[data-hat-id]');
    if (tr) onRankingRowClick(tr.dataset.hatId);
  });

  syncRankingKvFilterControl();
  refreshRankingTable();
}

function legacyCloseRankingPanel_v2() {
  const panel = document.getElementById('rankingPanel');
  if (panel) panel.classList.add('hidden');
  _rankingSearch = '';
  _rankingActiveHatId = null;
  const searchInput = document.getElementById('rankingSearch');
  if (searchInput) searchInput.value = '';
  requestRender();
}

function legacyGetFilteredFlows_v2() {
  const flows = getVisibleFlowEntries({ applySearch: true });
  flows.sort((a, b) => {
    let valA;
    let valB;
    switch (_rankingSortCol) {
      case 'name':
        valA = a.hatName.toLowerCase();
        valB = b.hatName.toLowerCase();
        break;
      case 'km':
        valA = a.hatLengthKm || 0;
        valB = b.hatLengthKm || 0;
        break;
      case 'ts':
        valA = a.timestamp ? a.timestamp.getTime() : 0;
        valB = b.timestamp ? b.timestamp.getTime() : 0;
        break;
      case 'mw':
        valA = Math.abs(a.mw);
        valB = Math.abs(b.mw);
        break;
      case 'pct':
      default:
        valA = a.loadingPct;
        valB = b.loadingPct;
        break;
    }
    if (valA < valB) return -1 * _rankingSortDir;
    if (valA > valB) return 1 * _rankingSortDir;
    return 0;
  });
  return flows;
}

function legacyRefreshRankingTable_v2() {
  const tbody = document.getElementById('rankingTbody');
  if (!tbody) return;

  syncRankingKvFilterControl();
  const allFiltered = getFilteredFlows();
  const top = allFiltered.slice(0, 50);
  const countEl = document.getElementById('rankingCount');
  if (countEl) countEl.textContent = `${Math.min(50, allFiltered.length)} / ${allFiltered.length} hat`;

  tbody.innerHTML = top.map((flow, index) => {
    const ts = flow.timestamp
      ? `${flow.timestamp.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${flow.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
      : '—';
    const pctColor = getFlowColor(flow.loadingPct);
    const activeClass = flow.hatId === _rankingActiveHatId ? 'ranking-active' : '';
    return `<tr class="${activeClass}" data-hat-id="${flow.hatId}">
      <td class="col-idx">${index + 1}</td>
      <td class="col-name" title="${flow.hatName}">${flow.hatName}${flow.isMock ? ' <i style="opacity:0.6;font-size:0.9em">(m)</i>' : ''}</td>
      <td class="col-km">${typeof flow.hatLengthKm === 'number' ? flow.hatLengthKm.toFixed(0) : '—'}</td>
      <td class="col-ts">${ts}</td>
      <td class="col-mw">${flow.mw >= 0 ? '+' : ''}${flow.mw.toFixed(1)}</td>
      <td class="col-pct"><span class="ranking-pct-cell" style="background:${pctColor};color:#fff">${flow.loadingPct.toFixed(1)}</span></td>
    </tr>`;
  }).join('');
}

function legacyOpenScadaHatDetails_v2(hat, options = {}) {
  if (!hat) return;
  state.selection = { kind: 'hat', id: hat.id, measureSourceId: '', measureTargetIds: [] };
  const model = buildHatPopupModel(hat);
  const anchorCoord = options.anchorCoord || getHatAnchorCoord(hat);
  const expanded = typeof options.expanded === 'boolean'
    ? options.expanded
    : Boolean(state.ui.activeHatPopup?.expanded && state.ui.activeHatPopup?.hatId === hat.id);

  showInfo({
    title: model.title,
    subtitle: model.subtitle,
    tags: model.tags,
    compactFields: model.compactFields,
    detailFields: model.detailFields,
    actions: [{ id: 'btnShowScadaChart', label: 'Grafik Goster' }],
    anchor: { hatId: hat.id, coord: anchorCoord },
    expanded,
    classes: ['hat-popup']
  });

  const chartBtn = document.getElementById('btnShowScadaChart');
  if (chartBtn) chartBtn.addEventListener('click', () => showScadaChartModal(hat.id, hat.name));

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
}

function legacyOnRankingRowClick_v2(hatId) {
  _rankingActiveHatId = hatId;
  if (!state.network?.hatLines) return;
  const hat = state.network.hatLines.find((entry) => entry.id === hatId);
  if (!hat) return;
  const anchorCoord = getHatAnchorCoord(hat);
  state.map.centerLon = anchorCoord.lon;
  state.map.centerLat = anchorCoord.lat;
  state.map.tileState.rangeKey = '';
  openScadaHatDetails(hat, { anchorCoord, forceTiles: true });
  refreshRankingTable();
}

function legacyBuildHistoryChartHtml_v2(hatId, hat, options = {}) {
  if (!state.scada.history) return '';
  const hist = state.scada.history.get(hatId);
  if (!hist || hist.length < 2) return '';

  const width = options.width || 960;
  const height = options.height || 360;
  const padL = 52;
  const padR = 30;
  const padT = 22;
  const padB = 42;
  const winterCap = Number(hat?.winterCapacityMva || 0);
  const summerCap = Number(hat?.summerCapacityMva || 0);
  const mwValues = hist.map((point) => Math.abs(point.mw));
  const maxVal = Math.max(...mwValues, winterCap, summerCap, 1);
  const minTime = hist[0].ts.getTime();
  const maxTime = hist[hist.length - 1].ts.getTime();
  const timeSpan = maxTime - minTime || 1;
  const toX = (timeMs) => padL + ((timeMs - minTime) / timeSpan) * (width - padL - padR);
  const toY = (value) => height - padB - ((value / maxVal) * (height - padT - padB));

  const points = hist.map((point) => `${round1(toX(point.ts.getTime()))},${round1(toY(Math.abs(point.mw)))}`).join(' ');
  const guideValues = [0, maxVal / 2, maxVal];
  const yGuides = guideValues.map((value) => {
    const y = round1(toY(value));
    return `<g><line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--chart-grid-soft)" stroke-width="1" /><text x="${padL - 8}" y="${y + 4}" font-size="12" text-anchor="end" fill="var(--muted)">${formatAxisNumber(value)}</text></g>`;
  }).join('');

  let capacityLines = '';
  if (winterCap > 0) {
    const y = round1(toY(winterCap));
    capacityLines += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.7"/>`;
    capacityLines += `<text x="${width - padR}" y="${y - 6}" fill="#38bdf8" font-size="12" text-anchor="end">Kis ${winterCap} MVA</text>`;
  }
  if (summerCap > 0 && summerCap !== winterCap) {
    const y = round1(toY(summerCap));
    capacityLines += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.7"/>`;
    capacityLines += `<text x="${width - padR}" y="${y - 6}" fill="#f97316" font-size="12" text-anchor="end">Yaz ${summerCap} MVA</text>`;
  }

  const dots = hist.map((point) => {
    const x = round1(toX(point.ts.getTime()));
    const y = round1(toY(Math.abs(point.mw)));
    return `<circle cx="${x}" cy="${y}" r="4" fill="${getFlowColor(point.pct)}" stroke="rgba(15,23,42,0.5)" stroke-width="1"/>`;
  }).join('');

  return `
    <div class="scada-history-chart scada-history-chart-large">
      <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-label="yuklenme-grafigi">
        ${yGuides}
        ${capacityLines}
        <polyline points="${points}" fill="none" stroke="#22c55e" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        <text x="${padL}" y="${height - 12}" fill="var(--muted)" font-size="12">${hist[0].ts.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</text>
        <text x="${width - padR}" y="${height - 12}" fill="var(--muted)" font-size="12" text-anchor="end">${hist[hist.length - 1].ts.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</text>
      </svg>
      <div class="scada-chart-footnote">Son ${hist.length} olcumun MW degisim grafigi</div>
    </div>
  `;
}

function legacyShowScadaChartModal_v2(hatId, hatName) {
  closeScadaChartModal();
  const hat = state.network?.hatLines?.find((entry) => entry.id === hatId);
  const chartHtml = buildHistoryChartHtml(hatId, hat, { width: 960, height: 360 });
  const flow = state.scada.lineFlowByLineId.get(hatId);
  const statusMap = { live: 'Canli', warn: 'Gecikmeli', dead: 'Bayat' };

  const backdrop = document.createElement('div');
  backdrop.id = 'scadaChartModalBackdrop';
  backdrop.className = 'scada-chart-backdrop';
  backdrop.innerHTML = `
    <div id="scadaChartModal" class="scada-chart-modal" role="dialog" aria-modal="true" aria-label="Yuklenme grafigi">
      <div class="scada-chart-header">
        <div>
          <p class="info-kicker">Yuklenme Grafigi</p>
          <h3>${escapeHtml(hatName || 'Hat')}</h3>
        </div>
        <button id="btnCloseScadaChart" class="info-close" title="Kapat">×</button>
      </div>
      <div class="scada-chart-summary">
        <span class="value-chip">Durum: ${escapeHtml(statusMap[flow?.staleState] || 'Veri yok')}</span>
        <span class="value-chip">Yuklenme: ${flow ? `${flow.loadingPct.toFixed(1)}%` : 'Veri yok'}</span>
        <span class="value-chip">Kapasite: ${flow ? `${flow.capacityMva} MVA` : '-'}</span>
      </div>
      <div class="scada-chart-body">
        ${chartHtml || '<div class="scada-chart-empty">Bu hat icin yeterli gecmis veri yok.</div>'}
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

  _scadaChartEscHandler = (event) => {
    if (event.key === 'Escape') closeScadaChartModal();
  };
  window.addEventListener('keydown', _scadaChartEscHandler);
}

function legacyUpdateScadaCardUI_v3() {
  const elSonVeri = document.getElementById('scadaSonVeri');
  const elToplam = document.getElementById('scadaToplam');
  const elEslesen = document.getElementById('scadaEslesen');
  const elEslesmeyen = document.getElementById('scadaEslesmeyen');
  const elStale = document.getElementById('scadaStale');
  const elHata = document.getElementById('scadaHata');
  const elLejant = document.getElementById('scadaLejant');
  const elKalite = document.getElementById('scadaKalite');
  const elFetchBadge = document.getElementById('scadaFetchBadge');
  const elFetchMessage = document.getElementById('scadaFetchMessage');
  const elFetchTrigger = document.getElementById('scadaFetchTrigger');
  const elFetchStart = document.getElementById('scadaFetchStart');
  const elFetchEnd = document.getElementById('scadaFetchEnd');
  const elFetchDuration = document.getElementById('scadaFetchDuration');
  const elFetchRawRows = document.getElementById('scadaFetchRawRows');
  const elFetchNormalizedRows = document.getElementById('scadaFetchNormalizedRows');
  const elFetchVisibleRows = document.getElementById('scadaFetchVisibleRows');
  const elFetchTransport = document.getElementById('scadaFetchTransport');
  const btnRefresh = document.querySelector('[data-scada-btn="refresh"]');
  const btnRefreshLabel = document.getElementById('scadaRefreshBtnLabel');
  const visibleSummary = typeof refreshScadaVisibleSummary === 'function'
    ? refreshScadaVisibleSummary()
    : (state.scada.visibleSummary || {});
  const fetchMeta = state.scada.fetchMeta || {};

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
  const fetchStatusClass = fetchMeta.status === 'loading'
    ? 'is-loading'
    : fetchMeta.status === 'error'
      ? 'is-error'
      : fetchMeta.status === 'success'
        ? 'is-success'
        : 'is-idle';

  if (elSonVeri) {
    elSonVeri.textContent = state.scada.lastDataTimestamp
      ? state.scada.lastDataTimestamp.toLocaleTimeString('tr-TR')
      : '-';
  }
  if (elToplam) elToplam.textContent = String(visibleSummary.total || 0);
  if (elEslesen) elEslesen.textContent = String(visibleSummary.matched || 0);
  if (elEslesmeyen) elEslesmeyen.textContent = String(visibleSummary.unmatched || 0);
  if (elStale) elStale.textContent = String(visibleSummary.stale || 0);
  if (elHata) elHata.textContent = state.scada.error || '-';

  if (elLejant) {
    const counts = getVisibleLegendCounts();
    elLejant.innerHTML = Object.entries(counts).map(([label, { color, n }]) => (
      `<span style="color:${color}" title="${label}">●${n}</span>`
    )).join(' ');
  }

  if (elKalite) {
    const quality = state.scada.dataQualitySummary || {};
    const transport = state.scada.lastTransport;
    const parts = [
      `Auth: ${state.scada.authState || 'idle'}`,
      transport?.authMode ? `Tasima: ${transport.authMode}${transport.usedFallback ? ' (fallback)' : ''}` : null,
      `Gorunen kalite: ${visibleSummary.matched || 0}/${visibleSummary.total || 0}`,
      `Gorunen duplicate: ${visibleSummary.duplicateMapped || 0}`,
      `Ham duplicate: ${state.scada.duplicateMappings?.size || 0}`,
      `Dislanan satir: ${state.scada.ambiguousRows?.length || 0}`,
      `Ham satir kalite: ${quality.matched || 0}/${quality.total || 0}`
    ].filter(Boolean);
    elKalite.textContent = parts.join(' | ');
  }

  if (elFetchBadge) {
    elFetchBadge.className = `scada-fetch-badge ${fetchStatusClass}`;
    elFetchBadge.textContent = fetchMeta.status === 'loading'
      ? `${fetchMeta.phaseLabel || 'Sorgu'} ${Math.max(1, Number(fetchMeta.progressPct) || 0)}%`
      : fetchMeta.status === 'error'
        ? 'Hata'
        : fetchMeta.status === 'success'
          ? 'Tamam'
          : 'Hazir';
  }
  if (elFetchMessage) elFetchMessage.textContent = fetchMeta.phaseMessage || 'Henuz sorgu yapilmadi.';
  if (elFetchTrigger) elFetchTrigger.textContent = fetchMeta.triggerLabel || '-';
  if (elFetchStart) elFetchStart.textContent = formatClock(fetchMeta.startedAt);
  if (elFetchEnd) elFetchEnd.textContent = formatClock(fetchMeta.finishedAt);
  if (elFetchDuration) elFetchDuration.textContent = formatDuration(fetchMeta.durationMs);
  if (elFetchRawRows) elFetchRawRows.textContent = String(fetchMeta.rawRows || 0);
  if (elFetchNormalizedRows) elFetchNormalizedRows.textContent = String(fetchMeta.normalizedRows || 0);
  if (elFetchVisibleRows) {
    elFetchVisibleRows.textContent = `${fetchMeta.visibleMatched || 0}/${fetchMeta.visibleTotal || 0}`;
    elFetchVisibleRows.title = `Stale: ${fetchMeta.visibleStale || 0} | Eslesmeyen: ${fetchMeta.visibleUnmatched || 0}`;
  }
  if (elFetchTransport) {
    const parts = [
      fetchMeta.authMode || '-',
      fetchMeta.usedFallback ? 'fallback' : null,
      Number.isFinite(fetchMeta.httpStatus) ? String(fetchMeta.httpStatus) : null
    ].filter(Boolean);
    elFetchTransport.textContent = parts.join(' / ') || '-';
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
    btnRefreshLabel.textContent = state.scada.fetchInProgress
      ? `${Math.max(1, Number(fetchMeta.progressPct) || 0)}%`
      : fetchMeta.status === 'error'
        ? 'Hata'
        : 'Yenile';
  }

  const btnBolt = document.getElementById('btnScadaRanking');
  if (btnBolt) {
    btnBolt.classList.toggle('hidden', !state.scada.enabled || !getVisibleFlowEntries().length);
  }

  syncRankingKvFilterControl();
  requestRender();
}
