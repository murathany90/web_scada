(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SCADA_COMMON = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const CONFIG = {
    LIVE_BATCH_SIZE: 200,
    LIVE_MAX_CONCURRENCY: 3,
    LIVE_FETCH_TIMEOUT_MS: 15000,
    HISTORY_FETCH_TIMEOUT_MS: 30000,
    HISTORY_ROW_LIMIT: 50000,
    SNAPSHOT_INTERVAL_MS: 5 * 60 * 1000
  };

  function stripTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function resolveQueryContract(config) {
    const kvFilters = Array.isArray(config?.kvFilters)
      ? config.kvFilters.map((value) => String(value))
      : ['400', '380', '420', '154'];
    const tearFilters = Array.isArray(config?.tearFilters)
      ? config.tearFilters.map((value) => String(value))
      : ['Golbasi_YTM'];
    const elementNames = Array.isArray(config?.elementNames) && config.elementNames.length
      ? config.elementNames.map((value) => String(value).trim()).filter(Boolean)
      : [String(config?.elementName || 'P')];
    const measurementIds = Array.isArray(config?.measurementIds) && config.measurementIds.length
      ? config.measurementIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const rowLimit = Number(config?.rowLimit || 50000);
    const timeRange = String(config?.timeRange || 'DATEADD(DATETIME("now"), -10, minute) : now');
    return {
      kvFilters,
      tearFilters,
      elementName: elementNames[0] || 'P',
      elementNames,
      measurementIds,
      rowLimit: Number.isFinite(rowLimit) && rowLimit > 0 ? rowLimit : 50000,
      timeRange
    };
  }

  function buildSimpleAdhocFilter(subject, operator, comparator) {
    return {
      clause: 'WHERE',
      expressionType: 'SIMPLE',
      subject,
      operator,
      comparator
    };
  }

  function buildChartPayload(config) {
    const chartSliceId = Number(config?.chartSliceId || 454);
    const datasourceId = Number(config?.datasourceId || 3);
    const contract = resolveQueryContract(config);
    const metrics = [];
    const columns = ['__time', 'sinsid', 'b1Name', 'b2Name', 'b3Name', 'elementName', 'maxValue'];
    const filters = [];
    const adhocFilters = [];
    if (contract.elementNames.length === 1) {
      filters.push({ col: 'elementName', op: '==', val: contract.elementNames[0] });
      adhocFilters.push(buildSimpleAdhocFilter('elementName', '==', contract.elementNames[0]));
    } else if (contract.elementNames.length > 1) {
      filters.push({ col: 'elementName', op: 'IN', val: contract.elementNames.slice() });
      adhocFilters.push(buildSimpleAdhocFilter('elementName', 'IN', contract.elementNames.slice()));
    }
    if (contract.measurementIds.length) {
      filters.push({ col: 'sinsid', op: 'IN', val: contract.measurementIds.slice() });
      adhocFilters.push(buildSimpleAdhocFilter('sinsid', 'IN', contract.measurementIds.slice()));
    }
    if (contract.kvFilters.length) {
      filters.push({ col: 'b2Name', op: 'IN', val: contract.kvFilters.slice() });
      adhocFilters.push(buildSimpleAdhocFilter('b2Name', 'IN', contract.kvFilters.slice()));
    }
    if (contract.tearFilters.length) {
      filters.push({ col: 'tear', op: 'IN', val: contract.tearFilters.slice() });
      adhocFilters.push(buildSimpleAdhocFilter('tear', 'IN', contract.tearFilters.slice()));
    }
    const formData = {
      slice_id: chartSliceId,
      viz_type: 'table',
      datasource: `${datasourceId}__table`,
      granularity_sqla: '__time',
      time_range: contract.timeRange,
      query_mode: 'raw',
      columns: columns.slice(),
      groupby: [],
      metrics: [],
      adhoc_filters: adhocFilters,
      row_limit: contract.rowLimit,
      order_by_cols: ['__time DESC']
    };
    return {
      datasource: { id: datasourceId, type: 'table' },
      force: true,
      form_data: formData,
      queries: [{
        time_range: contract.timeRange,
        granularity: '__time',
        columns: columns.slice(),
        metrics: [],
        filters,
        orderby: [['__time', false]],
        row_limit: contract.rowLimit
      }],
      result_format: 'json',
      result_type: 'full'
    };
  }

  function buildHistoryPayload(config) {
    const chartSliceId = Number(config?.chartSliceId || 454);
    const datasourceId = Number(config?.datasourceId || 3);
    const contract = resolveQueryContract(config);
    const defaultTimeRange = 'DATEADD(DATETIME("now"), -24, hour) : now';
    const resolvedTimeRange = (config?.startTime != null && config?.endTime != null)
      ? (formatSupersetTimeRange(config.startTime, config.endTime) || config?.timeRange || defaultTimeRange)
      : (config?.timeRange || defaultTimeRange);
    const queryMode = config?.queryMode === 'timeseries' ? 'aggregate' : 'raw';
    const requestedGrain = queryMode === 'aggregate'
      ? (config?.timeGrain || 'PT1M')
      : undefined;
    const columns = ['__time', 'sinsid', 'elementName', 'maxValue', 'b1Name', 'b2Name', 'b3Name'];
    const filters = [];
    const adhocFilters = [];

    if (contract.elementNames.length === 1) {
      filters.push({ col: 'elementName', op: '==', val: contract.elementNames[0] });
      adhocFilters.push(buildSimpleAdhocFilter('elementName', '==', contract.elementNames[0]));
    } else if (contract.elementNames.length > 1) {
      filters.push({ col: 'elementName', op: 'IN', val: contract.elementNames.slice() });
      adhocFilters.push(buildSimpleAdhocFilter('elementName', 'IN', contract.elementNames.slice()));
    }
    if (contract.measurementIds.length) {
      filters.push({ col: 'sinsid', op: 'IN', val: contract.measurementIds.slice() });
      adhocFilters.push(buildSimpleAdhocFilter('sinsid', 'IN', contract.measurementIds.slice()));
    }

    const formData = {
      slice_id: chartSliceId,
      viz_type: queryMode === 'aggregate' ? 'echarts_timeseries_line' : 'table',
      datasource: `${datasourceId}__table`,
      granularity_sqla: '__time',
      time_range: resolvedTimeRange,
      query_mode: queryMode,
      columns: queryMode === 'raw' ? columns.slice() : undefined,
      groupby: queryMode === 'aggregate' ? ['sinsid'] : [],
      metrics: queryMode === 'aggregate' ? [{ aggregate: 'AVG', column: { column_name: 'maxValue' }, expressionType: 'SIMPLE', label: 'AVG(maxValue)' }] : [],
      adhoc_filters: adhocFilters,
      row_limit: contract.rowLimit || CONFIG.HISTORY_ROW_LIMIT || 50000,
      order_by_cols: queryMode === 'raw' ? ['__time DESC'] : undefined,
      time_grain_sqla: queryMode === 'aggregate' ? requestedGrain : undefined
    };

    return {
      datasource: { id: datasourceId, type: 'table' },
      force: true,
      form_data: formData,
      queries: [{
        time_range: resolvedTimeRange,
        granularity: '__time',
        time_grain_sqla: queryMode === 'aggregate' ? requestedGrain : undefined,
        is_timeseries: queryMode === 'aggregate' ? true : undefined,
        groupby: queryMode === 'aggregate' ? ['sinsid'] : undefined,
        metrics: queryMode === 'aggregate' ? [{ aggregate: 'AVG', column: { column_name: 'maxValue' }, expressionType: 'SIMPLE', label: 'AVG(maxValue)' }] : undefined,
        columns: queryMode === 'raw' ? columns.slice() : ['sinsid'],
        filters,
        orderby: queryMode === 'raw' ? [['__time', false]] : [],
        row_limit: contract.rowLimit || CONFIG.HISTORY_ROW_LIMIT || 50000,
        series_limit: queryMode === 'aggregate' ? 0 : undefined,
        order_desc: queryMode === 'aggregate' ? true : undefined
      }],
      result_format: 'json',
      result_type: 'full'
    };
  }

  function buildChartUrl(config) {
    const baseUrl = stripTrailingSlash(config?.baseUrl || 'https://analytics.teias.gov.tr');
    const dashboardId = Number(config?.dashboardId || 89);
    return `${baseUrl}/api/v1/chart/data?dashboard_id=${dashboardId}&force=true`;
  }

  function findDataArray(obj, seen) {
    if (!obj || typeof obj !== 'object') return null;
    // Deterministic path: prefer Superset standard response schema result[0].data
    if (Array.isArray(obj.result) && obj.result.length > 0) {
      const firstResult = obj.result[0];
      if (firstResult && Array.isArray(firstResult.data) && firstResult.data.length && typeof firstResult.data[0] === 'object') {
        const row = firstResult.data[0];
        if ('sinsid' in row || 'elementName' in row) return firstResult.data;
      }
    }
    // Fallback: recursive search for backward compatibility
    seen = seen || new WeakSet();
    if (seen.has(obj)) return null;
    seen.add(obj);
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findDataArray(item, seen);
        if (found) return found;
      }
      return null;
    }
    if (Array.isArray(obj.data) && obj.data.length && typeof obj.data[0] === 'object') {
      const row = obj.data[0];
      if ('sinsid' in row || 'elementName' in row) return obj.data;
    }
    for (const value of Object.values(obj)) {
      const found = findDataArray(value, seen);
      if (found) return found;
    }
    return null;
  }

  // Superset numeric epochs describe the same "Turkey wall-clock" convention as
  // the string rows (which carry a nominal 'Z' for local time). Rebuilding a
  // naive-local Date from the UTC fields preserves that wall-clock on screen:
  // ISO-Z "2026-08-20T11:15:00Z", zone-less "2026-08-20T11:15:00" and a numeric
  // epoch of the same 11:15 all render as 11:15 - never 14:15 on a +03:00 host.
  function supersetEpochToLocalNaive(ms) {
    const utc = new Date(Number(ms));
    if (Number.isNaN(utc.getTime())) return utc;
    return new Date(
      utc.getUTCFullYear(),
      utc.getUTCMonth(),
      utc.getUTCDate(),
      utc.getUTCHours(),
      utc.getUTCMinutes(),
      utc.getUTCSeconds(),
      utc.getUTCMilliseconds()
    );
  }

  function parseSupersetScadaTimestamp(rawValue) {
    if (rawValue == null || rawValue === '') return null;
    // Epoch seconds (< 1e12) or milliseconds (>= 1e12) from legacy/raw transports.
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      const ms = Math.abs(rawValue) >= 1e12 ? rawValue : rawValue * 1000;
      const timestamp = supersetEpochToLocalNaive(ms);
      return Number.isNaN(timestamp.getTime()) ? null : timestamp;
    }
    const numeric = Number(rawValue);
    if (Number.isFinite(numeric) && String(rawValue).trim() !== '') {
      const ms = Math.abs(numeric) >= 1e12 ? numeric : numeric * 1000;
      const timestamp = supersetEpochToLocalNaive(ms);
      if (!Number.isNaN(timestamp.getTime())) return timestamp;
    }
    // Superset returns '...T...Z' but the time is actually local time in Turkey.
    // By stripping 'Z', new Date() parses it as local time, preventing the +3h shift.
    const localString = String(rawValue).replace(/Z$/, '');
    const timestamp = new Date(localString);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  }

  function normalizeTimestamp(rawValue, nowMs) {
    return parseSupersetScadaTimestamp(rawValue);
  }

  const HISTORY_TIME_KEYS = ['__timestamp', '__time', 'MAX(__time)', 'maxTime', 'timestamp', 'datetime', 'dt', 'time'];
  const HISTORY_VALUE_KEYS = ['maxValue', 'AVG(maxValue)', 'avgMaxValue', 'value', 'val', 'AVG'];
  const HISTORY_MEASUREMENT_KEYS = ['sinsid', 'measurementId', 'measurement_id', 'mId', 'id'];

  function resolveFieldByKeyList(row, keys) {
    if (!row || typeof row !== 'object') return undefined;
    for (const key of keys) {
      if (key in row && row[key] !== undefined && row[key] !== null) return row[key];
    }
    return undefined;
  }

  // Response-shape independent extraction helpers for SCADA history rows.
  function resolveHistoryTimestamp(row) {
    return parseSupersetScadaTimestamp(resolveFieldByKeyList(row, HISTORY_TIME_KEYS));
  }

  function resolveHistoryValue(row) {
    const raw = resolveFieldByKeyList(row, HISTORY_VALUE_KEYS);
    if (raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function resolveHistoryMeasurementId(row) {
    const raw = resolveFieldByKeyList(row, HISTORY_MEASUREMENT_KEYS);
    const id = String(raw || '').trim();
    return id || null;
  }

  // Groups raw history rows per measurement id; only requested ids count
  // toward the '>= 2 distinct timestamps' success criterion.
  function collectHistoryRowsByMid(rawRows, requestedIds) {
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const requested = new Set((requestedIds || []).map(String));
    const byMid = new Map();
    const stats = {
      total: rows.length,
      missingMeasurementIdField: 0,
      missingValueField: 0,
      invalidTimestamp: 0,
      nonRequested: 0,
      parsed: 0
    };
    for (const row of rows) {
      const mId = resolveHistoryMeasurementId(row);
      if (!mId) {
        stats.missingMeasurementIdField += 1;
        continue;
      }
      if (requested.size && !requested.has(mId)) {
        stats.nonRequested += 1;
        continue;
      }
      const value = resolveHistoryValue(row);
      if (value === null) {
        stats.missingValueField += 1;
        continue;
      }
      const timestamp = resolveHistoryTimestamp(row);
      if (!timestamp) {
        stats.invalidTimestamp += 1;
        continue;
      }
      if (!byMid.has(mId)) byMid.set(mId, []);
      byMid.get(mId).push({ ts: timestamp, value, measurementId: mId });
      stats.parsed += 1;
    }
    let maxPoints = 0;
    let maxPointsMid = null;
    const perMidStats = new Map();
    byMid.forEach((points, mId) => {
      const uniqueTimes = new Set(points.map((point) => point.ts.getTime())).size;
      perMidStats.set(mId, { points: points.length, uniqueTimes });
      if (uniqueTimes > maxPoints) {
        maxPoints = uniqueTimes;
        maxPointsMid = mId;
      }
    });
    return { byMid, perMidStats, maxPoints, maxPointsMid, stats };
  }

  // Resolves both active (P/MW) and reactive (Q/MVar) histories for hat/trafo,
  // and voltage (U/kV) for bara. Never mixes measurement ids across metric types.
  function resolveHistoryMetricsByEntity(entityType, entity) {
    const pickIds = (metricType) => {
      const config = Array.isArray(entity?.scada?.[metricType]?.rows)
        ? entity.scada[metricType].rows
        : [];
      const ids = [...new Set(
        config.map((row) => String(row?.measurementId || '').trim()).filter(Boolean)
      )];
      if (!ids.length) {
        const configuredIds = Array.isArray(entity?.scada?.[metricType]?.ids) ? entity.scada[metricType].ids : [];
        configuredIds.forEach((id) => ids.push(String(id)));
      }
      return ids;
    };
    if (entityType === 'bara') {
      return {
        voltage: { metricType: 'voltage', elementName: 'U', unit: 'kV', measurementIds: pickIds('voltage') }
      };
    }
    return {
      active: { metricType: 'active', elementName: 'P', unit: 'MW', measurementIds: pickIds('active') },
      reactive: { metricType: 'reactive', elementName: 'Q', unit: 'MVar', measurementIds: pickIds('reactive') }
    };
  }

  // Metric selection for the 24h history chart, never hard-coded to 'P'.
  // hat/trafo-active -> P/MW, hat/trafo-reactive -> Q/MVar, voltage -> U/kV.
  function resolveHistoryMetricByEntity(mode, entityType, entity) {
    const metrics = resolveHistoryMetricsByEntity(entityType, entity);
    const fallbackEmpty = (metricType, elementName, unit) => ({ metricType, elementName, unit, measurementIds: [] });
    if (entityType === 'bara') {
      return metrics.voltage || fallbackEmpty('voltage', 'U', 'kV');
    }
    const reactive = mode === 'hat-reactive' || mode === 'trafo-reactive';
    return reactive
      ? (metrics.reactive || fallbackEmpty('reactive', 'Q', 'MVar'))
      : (metrics.active || fallbackEmpty('active', 'P', 'MW'));
  }

  // TR local naive ISO formatting, same convention as Superset's local-time rows.
  // Never appends a timezone suffix (strip-Z behavior) and never shifts +3h.
  function formatSupersetDateTime(valueMs) {
    const date = valueMs instanceof Date ? valueMs : new Date(Number(valueMs));
    if (Number.isNaN(date.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatSupersetTimeRange(startMs, endMs) {
    const startText = typeof startMs === 'string' ? startMs : formatSupersetDateTime(startMs);
    const endText = typeof endMs === 'string' ? endMs : formatSupersetDateTime(endMs);
    if (!startText || !endText) return '';
    return `${startText} : ${endText}`;
  }

  // Adaptive resolution for history queries: keep raw queries short so huge
  // 24h/50k-row raw downloads are never the default path.
  function resolveHistoryAdaptiveStrategy(startMs, endMs) {
    const start = Number(startMs);
    const end = Number(endMs);
    const spanHours = Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 3600000 : 24;
    if (spanHours <= 2) return { queryMode: 'raw', timeGrain: null, label: 'Ham' };
    if (spanHours <= 48) return { queryMode: 'timeseries', timeGrain: 'PT1M', label: '1 dk ozet' };
    return { queryMode: 'timeseries', timeGrain: 'PT5M', label: '5 dk ozet' };
  }

  // Composite key that never mixes P and Q rows of the same measurement id.
  function historySeriesId(measurementId, elementName) {
    return `${String(measurementId)}|${String(elementName || '')}`;
  }

  function formatHistoryAxisLabel(timestampMs) {
    const date = timestampMs instanceof Date ? timestampMs : new Date(Number(timestampMs));
    if (Number.isNaN(date.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function normalizeScadaEntries(rawRows, options) {
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const result = new Map();
    const nowMs = options?.nowMs;
    for (const row of rows) {
      if (String(row.elementName || '').trim() !== 'P') continue;
      const sinsid = String(row.sinsid || '').trim();
      if (!sinsid) continue;
      const mw = parseFloat(row['AVG(maxValue)'] ?? row.avgMaxValue);
      if (!Number.isFinite(mw)) continue;
      const timestamp = normalizeTimestamp(row['__timestamp'] ?? row['MAX(__time)'] ?? row.maxTime, nowMs);
      const existing = result.get(sinsid);
      if (existing && existing.timestamp && timestamp && existing.timestamp >= timestamp) continue;
      result.set(sinsid, {
        sinsid,
        tmName: row.b1Name || row['TM (b1Name)'] || '',
        kvText: row.b2Name || '',
        remoteName: row.b3Name || '',
        elementName: 'P',
        timestamp,
        activePowerMw: mw
      });
    }
    return result;
  }

  function normalizeMetricEntries(rawRows, options) {
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const result = new Map();
    const nowMs = options?.nowMs;
    const allowElements = Array.isArray(options?.elementNames) && options.elementNames.length
      ? new Set(options.elementNames.map((value) => String(value).trim()))
      : null;
    for (const row of rows) {
      const elementName = String(row.elementName || '').trim();
      if (allowElements && !allowElements.has(elementName)) continue;
      const measurementId = String(row.sinsid || row.measurementId || '').trim();
      if (!measurementId) continue;
      const value = parseFloat(row.maxValue ?? row['AVG(maxValue)'] ?? row.avgMaxValue);
      if (!Number.isFinite(value)) continue;
      const timestamp = normalizeTimestamp(row['__timestamp'] ?? row.__time ?? row['MAX(__time)'] ?? row.maxTime, nowMs);
      const compositeKey = `${measurementId}|${elementName}`;
      const existing = result.get(compositeKey);
      if (existing && existing.timestamp && timestamp && existing.timestamp >= timestamp) continue;
      const rowData = {
        measurementId,
        sinsid: measurementId,
        elementName,
        tmName: row.b1Name || row['TM (b1Name)'] || '',
        kvText: row.b2Name || '',
        remoteName: row.b3Name || '',
        timestamp,
        value
      };
      result.set(compositeKey, rowData);
      // For backward compatibility, update the default if it doesn't exist, OR if it's the same element name being updated
      const defaultExisting = result.get(measurementId);
      if (!defaultExisting || defaultExisting.elementName === elementName) {
        result.set(measurementId, rowData);
      }
    }
    return result;
  }

  function normalizeScadaRows(rawJson, options) {
    return normalizeScadaEntries(findDataArray(rawJson) || [], options);
  }

  function normalizeMetricRows(rawJson, options) {
    return normalizeMetricEntries(findDataArray(rawJson) || [], options);
  }

  function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let insideQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }
      if (char === ',' && !insideQuotes) {
        cells.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    cells.push(current);
    return cells;
  }

  function parseScadaCsvSnapshot(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) return [];
    const lines = normalized.split('\n');
    const header = parseCsvLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      if (!lines[i]) continue;
      const values = parseCsvLine(lines[i]);
      const row = {};
      header.forEach((key, index) => {
        row[key] = values[index] ?? '';
      });
      rows.push(row);
    }
    return rows;
  }

  function normalizeScadaCsvSnapshot(text, options) {
    return normalizeScadaEntries(parseScadaCsvSnapshot(text), options);
  }

  function computeVisibleSummary(options) {
    const visibleHats = Array.isArray(options?.visibleHats) ? options.visibleHats : [];
    const flowMap = options?.lineFlowByLineId instanceof Map
      ? options.lineFlowByLineId
      : new Map(Object.entries(options?.lineFlowByLineId || {}));
    const duplicateHatIds = options?.duplicateHatIds instanceof Set
      ? options.duplicateHatIds
      : new Set(options?.duplicateHatIds || []);
    let matched = 0;
    let unmatched = 0;
    let stale = 0;
    let duplicateMapped = 0;

    visibleHats.forEach((hat) => {
      const hatId = hat?.id;
      const flow = flowMap.get(hatId);
      const isDuplicate = duplicateHatIds.has(hatId);
      if (isDuplicate) duplicateMapped += 1;

      if (!flow || flow.unavailable || isDuplicate) {
        unmatched += 1;
        return;
      }
      if (flow.staleState && flow.staleState !== 'live') {
        stale += 1;
        return;
      }
      matched += 1;
    });

    return {
      total: visibleHats.length,
      matched,
      unmatched,
      stale,
      duplicateMapped,
      updatedAt: options?.updatedAt || null,
      filterKey: String(options?.filterKey || '')
    };
  }

  function computeAuditReport(options) {
    const visibleHats = Array.isArray(options?.visibleHats) ? options.visibleHats : [];
    const rowMap = options?.rowsBySinsid instanceof Map
      ? options.rowsBySinsid
      : new Map(Object.entries(options?.rowsBySinsid || {}));
    const flowMap = options?.lineFlowByLineId instanceof Map
      ? options.lineFlowByLineId
      : new Map(Object.entries(options?.lineFlowByLineId || {}));
    const duplicateHatIds = options?.duplicateHatIds instanceof Set
      ? options.duplicateHatIds
      : new Set(options?.duplicateHatIds || []);

    const rows = [];
    const summary = {
      visibleTotal: visibleHats.length,
      rawRows: Number(options?.rawRows || rowMap.size || 0),
      normalizedRows: rowMap.size,
      live: 0,
      stale: 0,
      structuralMatches: 0,
      missingActiveId: 0,
      missingSourceRow: 0,
      duplicateMapping: 0,
      transportUnavailable: 0,
      unmatchedTotal: 0,
      filterKey: String(options?.filterKey || ''),
      queryContract: options?.queryContract || null
    };

    visibleHats.forEach((hat) => {
      const scadaId = String(hat?.olcumNoktasiIdAktif || '').trim();
      const flow = flowMap.get(hat?.id);
      const row = scadaId ? rowMap.get(scadaId) : null;
      let status = 'missing-active-id';
      let reason = 'Hat icin aktif SCADA ID tanimli degil.';

      if (!scadaId) {
        summary.missingActiveId += 1;
        summary.unmatchedTotal += 1;
      } else if (duplicateHatIds.has(hat?.id)) {
        status = 'duplicate-mapping';
        reason = 'Ayni aktif SCADA ID birden fazla hatta bagli.';
        summary.duplicateMapping += 1;
        summary.unmatchedTotal += 1;
      } else if (!row) {
        status = 'missing-source-row';
        reason = 'Aktif SCADA ID kaynak sorguda bulunmadi.';
        summary.missingSourceRow += 1;
        summary.unmatchedTotal += 1;
      } else if (flow?.unavailable) {
        status = 'transport-unavailable';
        reason = 'Kaynak satir bulundu ancak transport veya snapshot uygulamasi disinda kaldi.';
        summary.structuralMatches += 1;
        summary.transportUnavailable += 1;
        summary.unmatchedTotal += 1;
      } else if (flow?.staleState && flow.staleState !== 'live') {
        status = 'matched-stale';
        reason = 'Kaynak satir bulundu ancak veri stale durumunda.';
        summary.structuralMatches += 1;
        summary.stale += 1;
      } else if (row) {
        status = 'matched-live';
        reason = 'Kaynak satir tekil olarak hatta eslesti.';
        summary.structuralMatches += 1;
        summary.live += 1;
      }

      rows.push({
        hatId: String(hat?.id || ''),
        hatName: String(hat?.name || ''),
        kv: String(hat?.kv || ''),
        ytm: Array.isArray(hat?.ytmNames) ? hat.ytmNames.join(' / ') : '',
        startTm: String(hat?.startTm || ''),
        endTm: String(hat?.endTm || ''),
        scadaId,
        status,
        reason,
        sourceTimestamp: row?.timestamp || null,
        activePowerMw: Number.isFinite(flow?.mw) ? flow.mw : (Number.isFinite(row?.activePowerMw) ? row.activePowerMw : null),
        loadingPct: Number.isFinite(flow?.loadingPct) ? flow.loadingPct : null,
        capacityMva: Number.isFinite(flow?.capacityMva) ? flow.capacityMva : null,
        staleState: flow?.staleState || '',
        sourceTm: String(row?.tmName || ''),
        sourceRemote: String(row?.remoteName || '')
      });
    });

    return {
      summary,
      rows,
      mismatches: rows.filter((row) => row.status !== 'matched-live' && row.status !== 'matched-stale')
    };
  }

  return {
    CONFIG,
    buildHistoryPayload,
    buildChartPayload,
    buildChartUrl,
    collectHistoryRowsByMid,
    computeAuditReport,
    computeVisibleSummary,
    findDataArray,
    formatHistoryAxisLabel,
    formatSupersetDateTime,
    formatSupersetTimeRange,
    historySeriesId,
    normalizeMetricEntries,
    normalizeMetricRows,
    resolveHistoryAdaptiveStrategy,
    resolveHistoryMeasurementId,
    resolveHistoryMetricByEntity,
    resolveHistoryMetricsByEntity,
    resolveHistoryTimestamp,
    resolveHistoryValue,
    resolveQueryContract,
    normalizeTimestamp,
    normalizeScadaEntries,
    normalizeScadaRows,
    parseScadaCsvSnapshot,
    normalizeScadaCsvSnapshot,
    parseSupersetScadaTimestamp,
    supersetEpochToLocalNaive
  };
});
