(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const app = { entities: [], filtered: [], pageRows: [], page: 1, selected: null, queryRawRows: [], queryRows: [], queryStats: null, queryMeta: null, queryStartedAt: 0, queryPage: 1, querySort: { key: 'timestampMs', direction: -1 }, visibleSeries: new Set() };
  const nameOf = (entity) => entity?.displayName || entity?.name || entity?.id || '-';
  const tmOf = (entity) => entity?.tmName || entity?.tm || entity?.startTm || entity?.name || '-';
  const kvOf = (entity) => String(entity?.kvBucket || entity?.kv || entity?.primaryKv || entity?.gerilimKv || '').replace(/\.0$/, '');
  const ytmOf = (entity) => entity?.ytm || (Array.isArray(entity?.ytmNames) ? entity.ytmNames.join(', ') : '') || '-';
  const typeOf = (entity) => WebSCADAEntityResolver.entityType(entity);
  const typeLabel = (entity) => ({ tm: 'Trafo Merkezi', hat: 'Hat', bara: 'Bara', 'trafo-transmission': 'Trafo - Iletim', 'trafo-distribution': 'Trafo - Dagitim' })[typeOf(entity)] || typeOf(entity);
  const metricList = ['P', 'Q', 'U', 'S', 'I'];
  const currentDescriptors = () => app.selected ? WebSCADAEntityResolver.resolveMeasurementDescriptors(app.selected, metricList, app.entities) : [];
  const selectedMetrics = () => [...document.querySelectorAll('.queryMetric:checked:not(:disabled)')].map((input) => input.value);
  const shortId = (value) => value && String(value).length > 18 ? `${String(value).slice(0, 8)}…${String(value).slice(-6)}` : String(value || '');
  const metricCoverageText = (entity) => metricList.filter((metric) => WebSCADAEntityResolver.metricCoverage(entity)[metric]).map((metric) => `${metric} ${WebSCADAEntityResolver.metricCoverage(entity)[metric]}`).join(' | ') || 'Eslesmemis';

  function switchTab(tab) {
    document.querySelectorAll('.webscada-tab').forEach((button) => button.classList.toggle('active', button.dataset.webscadaTab === tab));
    document.querySelectorAll('.webscada-view').forEach((view) => view.classList.toggle('active', view.id === `webscada${tab[0].toUpperCase()}${tab.slice(1)}`));
    if (tab === 'map') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  function updateStatus() {
    const scada = window.__TPYS_STATE?.scada; const meta = scada?.fetchMeta; const mode = !scada?.enabled ? 'Baglanti yok' : (meta?.triggerType === 'history' ? 'Gecmis' : 'Canli');
    const superset = meta?.error ? 'Hata' : (scada?.fetchInProgress ? 'Sorgulaniyor' : 'Bagli'); const at = scada?.lastDataTimestamp ? new Date(scada.lastDataTimestamp).toLocaleTimeString('tr-TR') : '-';
    $('webscadaStatus').textContent = `SCADA: ${mode} | Superset: ${superset} | Son veri: ${at}`;
  }
  function decorateEntities() {
    app.entities.forEach((entity) => {
      const coverage = WebSCADAEntityResolver.metricCoverage(entity);
      entity.__web = { type: typeOf(entity), ytm: ytmOf(entity), kv: kvOf(entity), coverage, searchText: `${nameOf(entity)} ${tmOf(entity)} ${entity.id || ''} ${ytmOf(entity)}`.toLocaleLowerCase('tr-TR') };
    });
  }
  function renderDataSummary() {
    const source = app.filtered.length === app.entities.length ? app.entities : app.filtered; const count = (predicate) => source.filter(predicate).length;
    const cards = [['Toplam', source.length], ['TM', count((entity) => entity.__web.type === 'tm')], ['Hat', count((entity) => entity.__web.type === 'hat')], ['Trafo', count((entity) => entity.__web.type.startsWith('trafo'))], ['Bara', count((entity) => entity.__web.type === 'bara')], ['SCADA eslesmis', count(WebSCADAEntityResolver.hasScadaMatch)], ['SCADA eslesmemis', count((entity) => !WebSCADAEntityResolver.hasScadaMatch(entity))]];
    $('dataSummary').innerHTML = cards.map(([label, value]) => `<div class="summary-card"><strong>${Number(value).toLocaleString('tr-TR')}</strong>${esc(label)}</div>`).join('');
  }
  function filterData(reset = true) {
    if (reset) app.page = 1;
    const search = $('dataSearch').value.trim().toLocaleLowerCase('tr-TR'); const type = $('dataType').value; const ytm = $('dataYtm').value; const kv = $('dataKv').value; const scada = $('dataScada').value;
    app.filtered = app.entities.filter((entity) => (!type || entity.__web.type === type) && (!ytm || entity.__web.ytm === ytm || entity.__web.ytm.includes(ytm)) && (!kv || entity.__web.kv === kv) && (!scada || (scada === 'matched') === WebSCADAEntityResolver.hasScadaMatch(entity)) && (!search || entity.__web.searchText.includes(search)));
    renderDataSummary(); renderData();
  }
  function renderData() {
    const slice = WebSCADAWorkspaceUtils.pageSlice(app.filtered, app.page, $('dataPageSize').value); app.page = slice.page; app.pageRows = slice.rows;
    $('dataCount').textContent = `${slice.from}–${slice.to} / ${slice.total.toLocaleString('tr-TR')}`; $('dataPageInfo').textContent = `Sayfa ${slice.page}/${slice.pages}`; $('dataPrev').disabled = slice.page <= 1; $('dataNext').disabled = slice.page >= slice.pages;
    $('dataRows').innerHTML = slice.rows.map((entity, index) => `<tr><td>${esc(typeLabel(entity))}</td><td>${esc(nameOf(entity))}</td><td>${esc(tmOf(entity))}</td><td>${esc(ytmOf(entity))}</td><td>${esc(kvOf(entity))}</td><td class="coverage">${esc(metricCoverageText(entity))}</td><td><button class="row-action" data-action="map" data-index="${index}">Haritada Goster</button> <button class="row-action" data-action="query" data-index="${index}">Sorgula</button> <button class="row-action" data-action="detail" data-index="${index}">Detay</button></td></tr>`).join('') || '<tr><td colspan="7">Eslesen veri yok.</td></tr>';
  }
  function updateQueryControls() {
    const descriptors = currentDescriptors(); const available = new Set(descriptors.map((item) => item.metric)); const defaults = app.selected?.kind === 'bara' ? ['U'] : ['P', 'Q'];
    $('queryMetrics').innerHTML = metricList.map((metric) => { const info = WebSCADAQueryNormalizer.metricInfo(metric); const enabled = available.has(metric); return `<label><input class="queryMetric" type="checkbox" value="${metric}" ${enabled && defaults.includes(metric) ? 'checked' : ''} ${enabled ? '' : 'disabled'}> ${esc(info.label)}</label>`; }).join('');
    const terminalMap = new Map(); descriptors.forEach((item) => { if (item.terminalSide !== 'unknown') terminalMap.set(item.terminalSide, WebSCADAQueryNormalizer.terminalLabel(item)); });
    $('queryTerminalWrap').hidden = terminalMap.size < 2; $('queryTerminal').innerHTML = '<option value="">Tumu</option>' + [...terminalMap].map(([side, label]) => `<option value="${esc(side)}">${esc(label)}</option>`).join('');
  }
  function renderQueryEntityCard() {
    if (!app.selected) { $('queryEntityCard').textContent = 'Bir varlik secin.'; return; }
    const descriptors = currentDescriptors(); const coverage = metricCoverageText(app.selected); const terminals = [...new Map(descriptors.filter((item) => item.terminalSide !== 'unknown').map((item) => [item.terminalSide, WebSCADAQueryNormalizer.terminalLabel(item)])).values()];
    $('queryEntityCard').innerHTML = `<strong>${esc(nameOf(app.selected))}</strong> · ${esc(typeLabel(app.selected))}<br>kV: ${esc(kvOf(app.selected) || '—')} · TM: ${esc(tmOf(app.selected))} · YTM: ${esc(ytmOf(app.selected))}<br>Topology ID: <span class="id-short" title="${esc(app.selected.id || '')}">${esc(shortId(app.selected.id))}</span><br>SCADA: ${esc(coverage)}${terminals.length ? `<br>${terminals.map((item) => esc(item)).join('<br>')}` : ''}`;
  }
  function selectEntity(entity) {
    app.selected = entity; WebSCADASelection.select(entity); $('querySelection').textContent = `${typeLabel(entity)}: ${nameOf(entity)} secili.`; renderQueryEntityCard(); updateQueryControls();
  }
  function focusMap(entity) {
    selectEntity(entity); switchTab('map'); const state = window.__TPYS_STATE; if (!state?.network) return;
    const kind = entity.kind === 'hat' ? 'hat' : entity.kind === 'bara' ? 'bara-node' : entity.kind === 'trafo' ? (typeOf(entity) === 'trafo-transmission' ? 'trafo-trans' : 'trafo-dist') : 'tm';
    state.selection = { kind, id: entity.id, measureSourceId: '', measureTargetIds: [] };
    let lon = Number(entity.lon); let lat = Number(entity.lat); let zoom = kvOf(entity) === '400' ? 8 : 9;
    if (entity.kind === 'hat' && Array.isArray(entity.bbox)) { lon = (Number(entity.bbox[0]) + Number(entity.bbox[2])) / 2; lat = (Number(entity.bbox[1]) + Number(entity.bbox[3])) / 2; zoom = kvOf(entity) === '400' ? 7 : 8; }
    if ((entity.kind === 'trafo' || entity.kind === 'bara') && (!Number.isFinite(lon) || !Number.isFinite(lat))) { const tm = state.network.tmPoints.find((row) => String(row.id) === String(entity.tmId)); lon = Number(tm?.lon); lat = Number(tm?.lat); }
    if (Number.isFinite(lon) && Number.isFinite(lat)) { state.map.centerLon = lon; state.map.centerLat = lat; state.map.zoom = zoom; state.map.tileState.rangeKey = ''; }
    window.requestRender?.({ forceTiles: true }); window.dispatchEvent(new Event('resize'));
  }
  function detail(entity) {
    const descriptors = WebSCADAEntityResolver.resolveMeasurementDescriptors(entity, metricList, app.entities); const topology = [['ID', entity.id], ['Tip', typeLabel(entity)], ['Ad', nameOf(entity)], ['TM', tmOf(entity)], ['YTM', ytmOf(entity)], ['kV', kvOf(entity)]];
    const mapping = descriptors.map((item) => `<tr><td>${esc(item.metric)}</td><td title="${esc(item.measurementId)}">${esc(shortId(item.measurementId))}</td><td>${esc(WebSCADAQueryNormalizer.terminalLabel(item))}</td><td>${esc(item.role || '—')}</td><td>${esc(item.polarization ?? '—')}</td></tr>`).join('') || '<tr><td colspan="5">Canonical SCADA ölçümü yok.</td></tr>';
    $('detailBody').innerHTML = `<h2>${esc(nameOf(entity))}</h2><h3>TOPOLOJI</h3><dl>${topology.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value || '—')}</dd>`).join('')}</dl><h3>SCADA MAPPING</h3><table><thead><tr><th>Metric</th><th>Measurement ID</th><th>Terminal</th><th>Rol</th><th>Polarizasyon</th></tr></thead><tbody>${mapping}</tbody></table><p><button class="row-action" id="detailMap">Haritada Goster</button> <button class="row-action" id="detailQuery">Sorgula</button></p>`; $('entityDetail').showModal(); $('detailMap').onclick = () => { $('entityDetail').close(); focusMap(entity); }; $('detailQuery').onclick = () => { $('entityDetail').close(); selectEntity(entity); switchTab('query'); };
  }
  function csv(name, rows) {
    const keys = Object.keys(rows[0] || {}); if (!keys.length) return; const body = [keys.join(';'), ...rows.map((row) => keys.map((key) => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\r\n'); const blob = new Blob([`\ufeff${body}`], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }
  function localTime(ms) { const date = new Date(ms); const pad = (value) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
  function setPreset() { const preset = $('queryPreset').value; if (preset === 'custom') return; const end = Date.now(); const start = end - Number(preset) * 3600000; $('queryStart').value = localTime(start); $('queryEnd').value = localTime(end); $('queryGrain').value = 'auto'; }
  function requestedGrain(start, end) { return $('queryGrain').value === 'auto' ? WebSCADAWorkspaceUtils.autoGrain(start, end) : $('queryGrain').value; }
  function grainLabel(grain) { return ({ PT1M: '1 dk', PT5M: '5 dk', PT10M: '10 dk', PT15M: '15 dk', PT30M: '30 dk', PT1H: '1 saat' })[grain] || grain; }
  function renderQueryTable() {
    const rows = [...app.queryRows].sort((a, b) => { const left = a[app.querySort.key]; const right = b[app.querySort.key]; const order = typeof left === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), 'tr'); return order * app.querySort.direction; });
    const slice = WebSCADAWorkspaceUtils.pageSlice(rows, app.queryPage, $('queryPageSize').value); app.queryPage = slice.page; $('queryPageInfo').textContent = `${slice.from}–${slice.to} / ${slice.total.toLocaleString('tr-TR')}`; $('queryPrev').disabled = slice.page <= 1; $('queryNext').disabled = slice.page >= slice.pages;
    $('queryRows').innerHTML = slice.rows.map((row) => `<tr><td>${esc(row.timestampText)}</td><td>${esc(row.seriesLabel.split(' | ')[0])}</td><td>${esc(row.metricLabel)}</td><td>${esc(row.value)}</td><td>${esc(row.unit)}</td><td>${esc(row.quality ?? '—')}</td><td><span class="id-short" title="${esc(row.sinsid)}">${esc(shortId(row.sinsid))}</span></td><td>${esc(row.entityName)}</td></tr>`).join('') || '<tr><td colspan="8">Veri yok.</td></tr>';
  }
  function drawChart(rows) {
    const chart = $('queryChart'); const series = new Map(); rows.forEach((row) => { if (!series.has(row.seriesKey)) series.set(row.seriesKey, { label: row.seriesLabel, family: WebSCADAQueryNormalizer.metricInfo(row.metric).family, points: [] }); series.get(row.seriesKey).points.push(row); });
    if (!series.size || ![...series.keys()].some((key) => app.visibleSeries.has(key))) { chart.innerHTML = '<div class="empty">Grafik icin gorunur sayisal veri yok.</div>'; return; }
    const colors = ['#0e7490', '#f97316', '#7c3aed', '#16a34a', '#dc2626', '#0891b2']; const groups = new Map(); [...series.entries()].forEach(([key, value], index) => { value.color = colors[index % colors.length]; if (!groups.has(value.family)) groups.set(value.family, []); groups.get(value.family).push(value); });
    chart.innerHTML = [...groups].map(([family, items]) => { const points = items.flatMap((item) => item.points); const minT = Math.min(...points.map((point) => point.timestampMs)); const maxT = Math.max(...points.map((point) => point.timestampMs)); const minV = Math.min(...points.map((point) => point.value)); const maxV = Math.max(...points.map((point) => point.value)); const spanT = maxT - minT || 1; const spanV = maxV - minV || 1;
      const paths = items.filter((item) => app.visibleSeries.has(item.points[0].seriesKey)).map((item) => { const reduced = WebSCADAQueryNormalizer.minMaxDownsample([...item.points].sort((a, b) => a.timestampMs - b.timestampMs), 700); let previous = null; const d = reduced.map((point, index) => { const x = 35 + (point.timestampMs - minT) / spanT * 925; const y = 124 - (point.value - minV) / spanV * 100; const gap = previous && point.timestampMs - previous.timestampMs > Math.max(60000, spanT / Math.max(1, reduced.length) * 3); previous = point; return `${index === 0 || gap ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' '); return `<path d="${d}" fill="none" stroke="${item.color}" stroke-width="2.5"><title>${esc(item.label)} · ${esc(item.points.length)} nokta</title></path>`; }).join('');
      return `<div class="query-chart-group"><strong>${esc(family)}</strong><div class="query-chart-legend">${items.map((item) => `<label class="query-series-toggle"><input type="checkbox" data-series-key="${esc(item.points[0].seriesKey)}" ${app.visibleSeries.has(item.points[0].seriesKey) ? 'checked' : ''}><span style="color:${item.color}">■</span> ${esc(item.label)}</label>`).join('')}</div><svg viewBox="0 0 1000 150"><path d="M35 124H960" stroke="#cbd5e1"/>${paths}<text x="35" y="145">${esc(new Date(minT).toLocaleString('tr-TR'))}</text><text x="760" y="145">${esc(new Date(maxT).toLocaleString('tr-TR'))}</text><text x="2" y="25">${esc(maxV.toFixed(2))}</text><text x="2" y="124">${esc(minV.toFixed(2))}</text></svg></div>`; }).join('');
    chart.querySelectorAll('[data-series-key]').forEach((input) => input.addEventListener('change', () => { if (input.checked) app.visibleSeries.add(input.dataset.seriesKey); else app.visibleSeries.delete(input.dataset.seriesKey); drawChart(rows); }));
  }
  function renderQuerySummary(descriptors, grain, elapsed) {
    const effective = WebSCADAQueryNormalizer.effectiveGrain(app.queryRows); const stats = app.queryStats || {}; const meta = app.queryMeta || {}; const terminals = new Set(descriptors.map((item) => item.terminalSide).filter((item) => item !== 'unknown'));
    const cards = [['Sorgu suresi', `${(elapsed / 1000).toFixed(1)} sn`], ['Entity', nameOf(app.selected)], ['Measurement ID', descriptors.length], ['Terminal', terminals.size], ['Seri', new Set(app.queryRows.map((row) => row.seriesKey)).size], ['Toplam row', stats.totalRows || 0], ['Gecerli row', stats.validRows || 0], ['Gecersiz timestamp', stats.invalidTimestamp || 0], ['Gecersiz value', stats.invalidValue || 0], ['Duplicate logical', stats.duplicateLogicalRow || 0], ['Istenen', grainLabel(grain)], ['Donen', effective.text], ['Batch', `${meta.completedBatches ?? 0}/${meta.totalBatches ?? 0}`]];
    $('querySummary').innerHTML = cards.map(([label, value]) => `<div class="summary-card"><strong>${esc(value)}</strong>${esc(label)}</div>`).join('') + (effective.ms && Math.abs(effective.ms - ({ PT1M: 60000, PT5M: 300000, PT10M: 600000, PT15M: 900000, PT30M: 1800000, PT1H: 3600000 }[grain] || 0)) > 1000 ? `<div class="warning">Superset istenen ${esc(grainLabel(grain))} çözünürlüğü uygulamadı; yaklaşık ${esc(effective.text)} veri döndü.</div>` : '');
  }
  async function runQuery() {
    if (!app.selected) { $('queryStatus').textContent = 'Once Datalar sekmesinden bir varlik secin.'; return; }
    const metrics = selectedMetrics(); const terminal = $('queryTerminal').value; const descriptors = currentDescriptors().filter((item) => metrics.includes(item.metric) && (!terminal || item.terminalSide === terminal)); const ids = [...new Set(descriptors.map((item) => item.measurementId))]; const start = new Date($('queryStart').value).getTime(); const end = new Date($('queryEnd').value).getTime(); const grain = requestedGrain(start, end); const check = WebSCADAWorkspaceUtils.guardrail(ids.length, start, end, grain);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) { $('queryStatus').textContent = 'Baslangic bitisten once olmali; sorgu gonderilmedi.'; return; }
    if (!metrics.length || !ids.length) { $('queryStatus').textContent = 'Secilen varlik ve metric icin canonical SCADA olcumu yok.'; return; }
    if (!check.ok) { $('queryStatus').textContent = `Sorgu limiti asiyor: istenen ${check.requestedEstimate.toLocaleString('tr-TR')}, konservatif 1 dk ${check.conservativeEstimate.toLocaleString('tr-TR')} / ${check.limit.toLocaleString('tr-TR')} nokta.`; return; }
    const button = $('runQuery'); button.disabled = true; button.textContent = 'Sorgulaniyor...'; app.queryStartedAt = Date.now(); const tick = setInterval(() => { $('queryStatus').textContent = `Sorgulaniyor... ${Math.round((Date.now() - app.queryStartedAt) / 1000)} sn`; }, 250);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'WEBSCADA_QUERY', payload: { measurementIds: ids, elementNames: metrics, startTime: start, endTime: end, timeGrain: grain, queryMode: 'timeseries' } }); if (!response?.ok) throw new Error(response?.error || 'Sorgu basarisiz.');
      app.queryRawRows = (response.data?.result || []).flatMap((item) => item.data || []); const normalized = WebSCADAQueryNormalizer.normalizeQueryRows(app.queryRawRows, app.selected, descriptors); app.queryRows = normalized.rows; app.queryStats = normalized.stats; app.queryMeta = response.meta || {}; app.queryPage = 1; app.visibleSeries = new Set(app.queryRows.map((row) => row.seriesKey)); drawChart(app.queryRows); renderQueryTable(); const partial = Number(app.queryMeta.failedBatches) > 0 ? ` Kismi veri: ${Number(app.queryMeta.completedBatches) || 0}/${Number(app.queryMeta.totalBatches) || 0} sorgu grubu basarili.` : ''; $('queryStatus').textContent = app.queryRows.length ? `${app.queryRows.length.toLocaleString('tr-TR')} normalize kayit yuklendi.${partial}` : `Secilen tarih araliginda veri bulunamadi.${partial}`; renderQuerySummary(descriptors, grain, Date.now() - app.queryStartedAt);
    } catch (error) { $('queryStatus').textContent = `Sorgu hatasi: ${error.message}`; } finally { clearInterval(tick); button.disabled = false; button.textContent = 'Sorguyu calistir'; }
  }
  function bind() {
    let searchTimer = null; document.querySelectorAll('.webscada-tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.webscadaTab)));
    ['dataType', 'dataYtm', 'dataKv', 'dataScada', 'dataPageSize'].forEach((id) => $(id).addEventListener('change', () => filterData(true))); $('dataSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => filterData(true), 140); });
    $('dataPrev').addEventListener('click', () => { app.page--; renderData(); }); $('dataNext').addEventListener('click', () => { app.page++; renderData(); }); $('dataRows').addEventListener('click', (event) => { const node = event.target.closest('[data-action]'); if (!node) return; const entity = app.pageRows[Number(node.dataset.index)]; if (node.dataset.action === 'map') focusMap(entity); if (node.dataset.action === 'query') { selectEntity(entity); switchTab('query'); } if (node.dataset.action === 'detail') detail(entity); }); $('detailClose').addEventListener('click', () => $('entityDetail').close());
    $('dataCsv').addEventListener('click', () => csv('webscada-topology.csv', app.filtered.map((entity) => ({ Tip: typeLabel(entity), Ad: nameOf(entity), TM: tmOf(entity), YTM: ytmOf(entity), kV: kvOf(entity), SCADA: metricCoverageText(entity), ID: entity.id || '' })))); $('queryPreset').addEventListener('change', setPreset); ['queryStart', 'queryEnd'].forEach((id) => $(id).addEventListener('change', () => { $('queryPreset').value = 'custom'; })); $('runQuery').addEventListener('click', runQuery); $('queryCsv').addEventListener('click', () => csv('webscada-query.csv', WebSCADAQueryNormalizer.normalizedCsvRows(app.queryRows))); $('queryPageSize').addEventListener('change', () => { app.queryPage = 1; renderQueryTable(); }); $('queryPrev').addEventListener('click', () => { app.queryPage--; renderQueryTable(); }); $('queryNext').addEventListener('click', () => { app.queryPage++; renderQueryTable(); }); document.querySelectorAll('.query-sort').forEach((button) => button.addEventListener('click', () => { const key = button.dataset.sort; app.querySort.direction = app.querySort.key === key ? -app.querySort.direction : 1; app.querySort.key = key; renderQueryTable(); }));
  }
  document.addEventListener('DOMContentLoaded', async () => {
    bind(); setPreset(); try { const { network } = await WebSCADATopology.loadAll(); app.entities = WebSCADATopology.listEntities(network); decorateEntities(); [...new Set(app.entities.map(ytmOf).filter((value) => value && value !== '-'))].sort((a, b) => a.localeCompare(b, 'tr')).forEach((value) => $('dataYtm').insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`)); filterData(); } catch (error) { $('dataCount').textContent = `Topology yuklenemedi: ${error.message}`; } setInterval(updateStatus, 500); updateStatus();
  });
})();
