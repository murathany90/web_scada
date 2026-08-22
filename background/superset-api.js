const WebSCADAApi = (() => {
  const DEFAULTS = { dashboardId: 89, chartSliceId: 454, datasourceId: 3, rowLimit: 50000, timeRange: 'DATEADD(DATETIME("now"), -24, hour) : now' };
  function chartPayload(config, ids) {
    const elementNames = Array.isArray(config.elementNames) && config.elementNames.length ? config.elementNames.map(String) : [String(config.elementName || 'P')];
    const filters = [];
    const adhoc = [];
    const add = (col, op, val) => { filters.push({ col, op, val }); adhoc.push({ clause: 'WHERE', expressionType: 'SIMPLE', subject: col, operator: op, comparator: val }); };
    add('elementName', elementNames.length === 1 ? '==' : 'IN', elementNames.length === 1 ? elementNames[0] : elementNames);
    if (ids.length) add('sinsid', 'IN', ids);
    if (config.kvFilters?.length) add('b2Name', 'IN', config.kvFilters.map(String));
    if (config.tearFilters?.length) add('tear', 'IN', config.tearFilters.map(String));
    const columns = ['sinsid', 'b1Name', 'b2Name', 'b3Name', 'elementName'];
    const metrics = [{ label: 'MAX(__time)', expressionType: 'SQL', sqlExpression: 'MAX(__time)' }, { label: 'AVG(maxValue)', expressionType: 'SQL', sqlExpression: 'AVG(maxValue)' }];
    const timeRange = String(config.timeRange || DEFAULTS.timeRange);
    const limit = Number(config.rowLimit || DEFAULTS.rowLimit);
    return { datasource: { id: Number(config.datasourceId || DEFAULTS.datasourceId), type: 'table' }, force: true,
      form_data: { slice_id: Number(config.chartSliceId || DEFAULTS.chartSliceId), viz_type: 'table', datasource: `${Number(config.datasourceId || DEFAULTS.datasourceId)}__table`, granularity_sqla: '__time', time_range: timeRange, groupby: columns, metrics, adhoc_filters: adhoc, row_limit: limit, order_desc: true },
      queries: [{ time_range: timeRange, granularity: '__time', columns, metrics, filters, orderby: [['MAX(__time)', false]], row_limit: limit }], result_format: 'json', result_type: 'full' };
  }
  function formatSupersetTime(value) {
    const date = new Date(value); if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  function historyTimeRange(payload) {
    if (payload?.startTime != null && payload?.endTime != null) {
      const start = formatSupersetTime(payload.startTime); const end = formatSupersetTime(payload.endTime);
      if (start && end) return `${start} : ${end}`;
    }
    return String(payload?.timeRange || DEFAULTS.timeRange);
  }
  function historyPayload(config, payload, ids) {
    const elementNames = Array.isArray(payload.elementNames) && payload.elementNames.length ? payload.elementNames.map(String) : [String(payload.elementName || 'P')];
    const filters = []; const adhoc = []; const add = (col, op, val) => { filters.push({ col, op, val }); adhoc.push({ clause: 'WHERE', expressionType: 'SIMPLE', subject: col, operator: op, comparator: val }); };
    add('elementName', elementNames.length === 1 ? '==' : 'IN', elementNames.length === 1 ? elementNames[0] : elementNames); if (ids.length) add('sinsid', 'IN', ids);
    const aggregate = payload.queryMode === 'timeseries' || payload.queryMode === 'aggregate'; const range = historyTimeRange(payload); const datasourceId = Number(config.datasourceId || DEFAULTS.datasourceId); const limit = Number(payload.rowLimit || config.rowLimit || DEFAULTS.rowLimit);
    const columns = ['__time', 'sinsid', 'elementName', 'maxValue', 'b1Name', 'b2Name', 'b3Name']; const metric = { aggregate: 'AVG', column: { column_name: 'maxValue' }, expressionType: 'SIMPLE', label: 'AVG(maxValue)' };
    return { datasource: { id: datasourceId, type: 'table' }, force: true,
      form_data: { slice_id: Number(config.chartSliceId || DEFAULTS.chartSliceId), viz_type: aggregate ? 'echarts_timeseries_line' : 'table', datasource: `${datasourceId}__table`, granularity_sqla: '__time', time_range: range, query_mode: aggregate ? 'aggregate' : 'raw', columns: aggregate ? undefined : columns, groupby: aggregate ? ['sinsid', 'elementName'] : [], metrics: aggregate ? [metric] : [], adhoc_filters: adhoc, row_limit: limit, order_by_cols: aggregate ? undefined : ['__time DESC'], time_grain_sqla: aggregate ? String(payload.timeGrain || 'PT5M') : undefined },
      queries: [{ time_range: range, granularity: '__time', time_grain_sqla: aggregate ? String(payload.timeGrain || 'PT5M') : undefined, is_timeseries: aggregate || undefined, groupby: aggregate ? ['sinsid', 'elementName'] : undefined, metrics: aggregate ? [metric] : undefined, columns: aggregate ? ['sinsid', 'elementName'] : columns, filters, orderby: aggregate ? [] : [['__time', false]], row_limit: limit, series_limit: aggregate ? 0 : undefined, order_desc: aggregate || undefined }], result_format: 'json', result_type: 'full' };
  }
  async function fetchChart(config, payload, authMode) {
    const ids = Array.isArray(payload.measurementIds) ? payload.measurementIds.map(String) : [];
    const body = payload.chartPayload || chartPayload({ ...config, ...payload }, ids);
    const token = await WebSCADAAuth.csrfToken(config);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await WebSCADAAuth.request(`${WebSCADAAuth.baseUrl(config.baseUrl)}/api/v1/chart/data?dashboard_id=${Number(config.dashboardId || DEFAULTS.dashboardId)}&force=true`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { 'X-CSRFToken': token } : {}) }, body: JSON.stringify(body), signal: controller.signal, redirect: 'follow' });
      const finalUrl = String(response.url || ''); const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase(); const loginResponse = /\/login\/?(?:[?#]|$)/i.test(finalUrl) || /text\/html|application\/xhtml\+xml/.test(contentType);
      if (response.status === 401 || response.status === 403 || loginResponse) return { ok: false, error: 'Superset yetkilendirmesi gerekli.', errorType: 'AUTH_REQUIRED', httpStatus: response.status, authMode, shouldRetryAuth: true };
      if (!response.ok) return { ok: false, error: `Superset sorgusu basarisiz (${response.status}).`, errorType: 'UPSTREAM_ERROR', httpStatus: response.status, authMode, shouldRetryAuth: false };
      try { return { ok: true, data: await response.json(), httpStatus: response.status, authMode, shouldRetryAuth: false }; } catch { return { ok: false, error: 'Superset chart yaniti JSON degil.', errorType: 'NETWORK_ERROR', httpStatus: response.status, authMode, shouldRetryAuth: false }; }
    } catch (error) { return { ok: false, error: error?.name === 'AbortError' ? 'Superset sorgusu zaman asimina ugradi.' : (error.message || String(error)), errorType: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', authMode }; }
    finally { clearTimeout(timer); }
  }
  return { DEFAULTS, chartPayload, historyPayload, historyTimeRange, formatSupersetTime, fetchChart };
})();
