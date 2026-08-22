importScripts('superset-auth.js', 'superset-api.js', 'query-service.js');

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = { SCADA_FETCH: WebSCADAQuery.executeLiveScada, SCADA_HISTORY_FETCH: WebSCADAQuery.executeHistorySeries, SCADA_HISTORICAL_SNAPSHOT_FETCH: WebSCADAQuery.executeHistoricalSnapshot, WEBSCADA_QUERY: WebSCADAQuery.executeWorkspaceQuery };
  if (handlers[message?.type]) {
    handlers[message.type](message.payload || {}).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || String(error), errorType: 'BACKGROUND_ERROR', authMode: 'none', usedFallback: false }));
    return true;
  }
  if (message?.type === 'WEBSCADA_STATUS') {
    WebSCADAAuth.loadConfig().then(async (config) => sendResponse({ ok: true, session: await WebSCADAAuth.ensureSession(config), baseUrl: config.baseUrl })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  return false;
});
