const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const config = { enabled: true, baseUrl: 'https://analytics.teias.gov.tr', username: 'u', password: 'p' };
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const promiseSink = { catch() {} };
const authRequired = (mode = 'session') => ({ ok: false, error: 'Superset yetkilendirmesi gerekli.', errorType: 'AUTH_REQUIRED', shouldRetryAuth: true, authMode: mode });
const chartSuccess = (mode = 'session') => ({ ok: true, authMode: mode, data: { result: [{ data: [] }] }, httpStatus: 200 });

function loadAuth() {
  const context = { URL, URLSearchParams, setTimeout, clearTimeout, Promise, Date, fetch: () => { throw new Error('unmocked'); }, chrome: {} };
  vm.createContext(context);
  vm.runInContext(`${source('background/superset-auth.js')}\nglobalThis.__auth = WebSCADAAuth;`, context);
  return context.__auth;
}

function loadQuery(auth, api) {
  const context = { Date, Promise, WebSCADAAuth: auth, WebSCADAApi: api, chrome: { runtime: { sendMessage: () => promiseSink } } };
  vm.createContext(context);
  vm.runInContext(`${source('background/query-service.js')}\nglobalThis.__query = WebSCADAQuery;`, context);
  return context.__query;
}

function loadApi(auth) {
  const context = { Date, URL, AbortController, setTimeout, clearTimeout, WebSCADAAuth: auth };
  vm.createContext(context);
  vm.runInContext(`${source('background/superset-api.js')}\nglobalThis.__api = WebSCADAApi;`, context);
  return context.__api;
}

function response({ ok = true, status = ok ? 200 : 401, body = { result: 'csrf' }, url = 'https://analytics.teias.gov.tr/api/v1/chart/data', contentType = 'application/json' } = {}) {
  return { ok, status, url, headers: { get: () => contentType }, json: async () => body, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
}

test('existing chart session succeeds without direct-login or hidden-tab', async () => {
  let direct = 0; let hidden = 0; let me = 0;
  const query = loadQuery({ sessionValid: async () => { me++; return false; }, invalidateCsrf() {}, directLogin: async () => { direct++; return { ok: true }; }, hiddenTabLogin: async () => { hidden++; return { ok: true }; } }, { fetchChart: async () => chartSuccess() });
  const result = await query.chartFirst(config, {}, {});
  assert.equal(result.ok, true); assert.equal(direct, 0); assert.equal(hidden, 0); assert.equal(me, 0);
});

test('/api/v1/me is nonstandard but chart JSON success remains authoritative', async () => {
  let hidden = 0; let me = 0;
  const query = loadQuery({ sessionValid: async () => { me++; return false; }, invalidateCsrf() {}, directLogin: async () => ({ ok: true }), hiddenTabLogin: async () => { hidden++; return { ok: true }; } }, { fetchChart: async () => chartSuccess() });
  const result = await query.chartFirst(config, {}, {});
  assert.equal(result.ok, true); assert.equal(me, 0); assert.equal(hidden, 0);
});

test('chart 401 runs direct login then retried chart succeeds without hidden tab', async () => {
  const answers = [authRequired(), authRequired('session-recovery'), chartSuccess('direct-login')]; let direct = 0; let hidden = 0;
  const query = loadQuery({ sessionValid: async () => false, invalidateCsrf() {}, directLogin: async () => { direct++; return { ok: true }; }, hiddenTabLogin: async () => { hidden++; return { ok: true }; } }, { fetchChart: async () => answers.shift() });
  const result = await query.chartFirst(config, {}, {});
  assert.equal(result.ok, true); assert.equal(result.authMode, 'direct-login'); assert.equal(direct, 1); assert.equal(hidden, 0);
});

test('direct POST success but chart retry 401 opens hidden tab as last resort', async () => {
  const answers = [authRequired(), authRequired('session-recovery'), authRequired('direct-login'), chartSuccess('hidden-tab')]; let hidden = 0;
  const query = loadQuery({ sessionValid: async () => false, invalidateCsrf() {}, directLogin: async () => ({ ok: true }), hiddenTabLogin: async () => { hidden++; return { ok: true }; } }, { fetchChart: async () => answers.shift() });
  const result = await query.chartFirst(config, {}, {});
  assert.equal(result.ok, true); assert.equal(result.authMode, 'hidden-tab'); assert.equal(hidden, 1);
});

test('hidden-tab chart success is accepted even when /me validation is false', async () => {
  const answers = [authRequired(), authRequired(), authRequired(), chartSuccess('hidden-tab')]; let me = 0;
  const query = loadQuery({ sessionValid: async () => { me++; return false; }, invalidateCsrf() {}, directLogin: async () => ({ ok: true }), hiddenTabLogin: async () => ({ ok: true }) }, { fetchChart: async () => answers.shift() });
  const result = await query.chartFirst(config, {}, {});
  assert.equal(result.ok, true); assert.equal(result.authMode, 'hidden-tab'); assert.equal(me, 0);
});

test('all auth paths failing return an understandable AUTH_REQUIRED error', async () => {
  const query = loadQuery({ sessionValid: async () => false, invalidateCsrf() {}, directLogin: async () => ({ ok: false, error: 'Direct login basarisiz.' }), hiddenTabLogin: async () => ({ ok: false, error: 'Hidden tab login basarisiz.' }) }, { fetchChart: async () => authRequired() });
  const result = await query.chartFirst(config, {}, {});
  assert.equal(result.ok, false); assert.equal(result.errorType, 'AUTH_REQUIRED'); assert.match(result.error, /Hidden tab login basarisiz/);
});

test('chart HTTP 200 HTML login response is AUTH_REQUIRED, not a JSON network error', async () => {
  const api = loadApi({ baseUrl: (value) => value, csrfToken: async () => '', request: async () => response({ body: '<html>login</html>', contentType: 'text/html; charset=utf-8', url: 'https://analytics.teias.gov.tr/login/' }) });
  const result = await api.fetchChart(config, { measurementIds: [] }, 'session');
  assert.equal(result.errorType, 'AUTH_REQUIRED'); assert.equal(result.shouldRetryAuth, true);
});

test('direct login preserves form action, hidden fields and accepts POST for chart retry', async () => {
  const auth = loadAuth(); const calls = [];
  auth.__setTestDeps({ fetch: async (url, options = {}) => { calls.push({ url, options }); if (options.method === 'POST') return response({ body: '<html>ok</html>', url: 'https://analytics.teias.gov.tr/' }); return response({ body: '<form action="/custom-login"><input type="hidden" name="csrf_token" value="x"><input name="email"><input type="password" name="password"></form>', contentType: 'text/html', url: 'https://analytics.teias.gov.tr/login/' }); } });
  const result = await auth.directLogin(config);
  assert.equal(result.ok, true); assert.match(calls[1].url, /custom-login$/); assert.match(calls[1].options.body, /csrf_token=x/); assert.equal(calls[1].options.headers.Origin, config.baseUrl); assert.equal(calls.length, 2);
});

test('session validation keeps rejecting HTML or unauthenticated /me payloads as advisory diagnostics', async () => {
  const auth = loadAuth(); auth.__setTestDeps({ fetch: async () => response({ body: '<html>login</html>', contentType: 'text/html', url: 'https://analytics.teias.gov.tr/api/v1/me' }) }); assert.equal(await auth.sessionValid(config), false);
  auth.__setTestDeps({ fetch: async () => response({ body: { result: {} } }) }); assert.equal(await auth.sessionValid(config), false);
});

test('hidden-tab redirect diagnostic records only an origin and credentials are never logged', () => {
  const authSource = source('background/superset-auth.js');
  assert.match(authSource, /Hidden-tab redirect origin/); assert.ok(!/console\.(log|warn).*username|console\.(log|warn).*password/.test(authSource)); assert.ok(!authSource.includes('<all_urls>'));
});

test('hidden-tab fallback waits for post-submit navigation instead of a fixed sleep', () => {
  const authSource = source('background/superset-auth.js'); const querySource = source('background/query-service.js');
  assert.match(authSource, /waitForPostSubmitNavigation/); assert.ok(!authSource.includes('sleep(800)')); assert.ok(!querySource.includes('await WebSCADAAuth.sessionValid(config)'));
});

test('SCADA log display uses Europe/Istanbul instead of raw UTC clock time', () => {
  const { formatScadaLogTime } = require('../core/log-time.js');
  assert.equal(formatScadaLogTime('2026-08-22T16:00:00Z'), '19:00:00');
  assert.match(source('map/scada-flow.js'), /WebSCADALogTime\.formatScadaLogTime/);
});

test('history payload preserves exact start, end and grain', () => {
  const api = loadApi({}); const payload = api.historyPayload({}, { startTime: Date.parse('2026-08-22T08:00:00'), endTime: Date.parse('2026-08-22T16:00:00'), timeGrain: 'PT5M', queryMode: 'timeseries', elementNames: ['P'] }, ['m1']);
  assert.match(payload.queries[0].time_range, /2026-08-22T08:00:00 : 2026-08-22T16:00:00/); assert.equal(payload.queries[0].time_grain_sqla, 'PT5M');
});

test('P and Q aggregate grouping preserves separate series for the same measurement and timestamp', () => {
  const api = loadApi({}); const payload = api.historyPayload({}, { queryMode: 'timeseries', elementNames: ['P', 'Q'], timeGrain: 'PT5M' }, ['same-id']);
  assert.deepEqual([...payload.form_data.groupby], ['sinsid', 'elementName']); assert.deepEqual([...payload.queries[0].groupby], ['sinsid', 'elementName']);
  const returned = [{ sinsid: 'same-id', elementName: 'P', __time: '2026-08-22T16:00:00', 'AVG(maxValue)': 100 }, { sinsid: 'same-id', elementName: 'Q', __time: '2026-08-22T16:00:00', 'AVG(maxValue)': 20 }];
  assert.deepEqual(returned.map((row) => row.elementName), ['P', 'Q']); assert.notEqual(returned[0]['AVG(maxValue)'], 60);
});

test('canonical resolver keeps multi-terminal line IDs and never uses topology ID', () => { const r = require('../core/entity-resolver.js'); const line = { kind: 'hat', id: 'topology-id', scada: { active: { ids: ['p1', 'p2'] }, reactive: { ids: ['q1', 'q2'] } } }; assert.deepEqual(r.resolveMeasurementIds(line, ['P', 'Q'], []), ['p1', 'p2', 'q1', 'q2']); });
test('pagination and query guardrail bound workspace loads', () => { const u = require('../core/workspace-utils.js'); assert.equal(u.pageSlice(Array.from({ length: 120 }), 2, 50).rows.length, 50); assert.equal(u.autoGrain(0, 24 * 3600000), 'PT5M'); assert.equal(u.guardrail(300, 0, 7 * 86400000, 'PT1M').ok, false); });
test('worker keeps live, history, snapshot and workspace message semantics separate', () => { const worker = source('background/service-worker.js'); assert.match(worker, /SCADA_FETCH: WebSCADAQuery\.executeLiveScada/); assert.match(worker, /SCADA_HISTORY_FETCH: WebSCADAQuery\.executeHistorySeries/); assert.match(worker, /SCADA_HISTORICAL_SNAPSHOT_FETCH: WebSCADAQuery\.executeHistoricalSnapshot/); assert.match(worker, /WEBSCADA_QUERY: WebSCADAQuery\.executeWorkspaceQuery/); });
test('snapshot helper selects the newest row at or before selected instant', () => { const query = loadQuery({}, {}); const at = Date.parse('2026-08-22T16:00:00Z'); const rows = [{ sinsid: 'a', elementName: 'P', __time: '2026-08-22T15:59:00Z' }, { sinsid: 'a', elementName: 'P', __time: '2026-08-22T16:01:00Z' }, { sinsid: 'a', elementName: 'Q', __time: '2026-08-22T15:58:00Z' }]; const picked = query.pickSnapshot(rows, at, ['a']); assert.equal(picked.length, 2); assert.equal(picked[0].__time, '2026-08-22T15:59:00Z'); });
test('partial workspace results keep successful rows and expose an explicit UI warning', () => { assert.match(source('background/query-service.js'), /results\.push\(await chartFirst/); assert.match(source('app.js'), /Kismi veri:/); assert.match(source('app.js'), /failedBatches/); });
