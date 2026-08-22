/* Superset authentication: deliberately mirrors the frozen parent flow. */
const WebSCADAAuth = (() => {
  const AUTH_PATH = 'data/scada_auth.json';
  const DEFAULT_BASE_URL = 'https://analytics.teias.gov.tr';
  let csrf = { token: '', baseUrl: '', at: 0 };
  let deps = {};
  const call = (name, ...args) => deps[name] ? deps[name](...args) : null;
  const apiFetch = (...args) => call('fetch', ...args) || fetch(...args);
  const apiChrome = () => deps.chrome || chrome;
  const sleep = (ms) => call('sleep', ms) || new Promise((resolve) => setTimeout(resolve, ms));
  function baseUrl(value) { return String(value || DEFAULT_BASE_URL).replace(/\/+$/, ''); }
  function sanitizeError(error, fallback) { return error?.message ? String(error.message) : fallback; }

  async function loadConfig() {
    const response = await apiFetch(apiChrome().runtime.getURL(AUTH_PATH));
    if (!response.ok) throw new Error('Yerel SCADA kimlik dosyasi bulunamadi.');
    const config = await response.json();
    if (!config?.enabled || !String(config?.baseUrl || '').trim() || !String(config?.username || '').trim() || !String(config?.password || '').trim()) {
      throw new Error('Yerel SCADA kimlik dosyasi etkin ve eksiksiz olmali.');
    }
    return { ...config, baseUrl: baseUrl(config.baseUrl) };
  }
  async function sessionValid(config) {
    try {
      const response = await apiFetch(`${baseUrl(config.baseUrl)}/api/v1/me`, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, redirect: 'follow' });
      if (!response.ok || /\/login\/?$/i.test(String(response.url || ''))) return false;
      const json = await response.json(); const user = json?.result;
      return Boolean(user && typeof user === 'object' && (user.id != null || user.username || user.email));
    } catch { return false; }
  }
  function invalidateCsrf(config) { if (!config || csrf.baseUrl === baseUrl(config.baseUrl)) csrf = { token: '', baseUrl: '', at: 0 }; }
  async function csrfToken(config) {
    const normalized = baseUrl(config.baseUrl);
    if (csrf.token && csrf.baseUrl === normalized && Date.now() - csrf.at < 300000) return csrf.token;
    try {
      const response = await apiFetch(`${normalized}/api/v1/security/csrf_token/`, { credentials: 'include', headers: { Accept: 'application/json' }, redirect: 'follow' });
      if (!response.ok || /\/login\/?$/i.test(String(response.url || ''))) return '';
      const json = await response.json(); csrf = { token: String(json?.result || ''), baseUrl: normalized, at: Date.now() }; return csrf.token;
    } catch { return ''; }
  }
  async function fetchLoginPage(config) {
    const loginUrl = `${baseUrl(config.baseUrl)}/login/`;
    const response = await apiFetch(loginUrl, { method: 'GET', credentials: 'include', headers: { Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`Login sayfasi alinamadi (${response.status}).`);
    return { loginUrl, html: await response.text() };
  }
  function findFieldName(html, patterns) { for (const pattern of patterns) { const match = String(html || '').match(pattern); if (match?.[1]) return match[1]; } return ''; }
  function extractLoginMeta(html, origin) {
    const action = String(html || '').match(/<form[^>]+action=["']([^"']+)["']/i)?.[1] || '/login/';
    const hiddenInputs = {};
    (String(html || '').match(/<input[^>]+type=["']hidden["'][^>]*>/gi) || []).forEach((node) => { const key = node.match(/\sname=["']([^"']+)["']/i)?.[1]; if (key) hiddenInputs[key] = node.match(/\svalue=["']([^"']*)["']/i)?.[1] || ''; });
    return { actionUrl: new URL(action, `${baseUrl(origin)}/login/`).toString(), hiddenInputs,
      csrfField: Object.keys(hiddenInputs).find((key) => /csrf/i.test(key)) || 'csrf_token', csrfValue: hiddenInputs.csrf_token || hiddenInputs.csrfmiddlewaretoken || '',
      usernameField: findFieldName(html, [/<input[^>]+name=["']([^"']*(?:user|email|login)[^"']*)["'][^>]*>/i, /<input[^>]+type=["'](?:text|email)["'][^>]+name=["']([^"']+)["']/i]) || 'username',
      passwordField: findFieldName(html, [/<input[^>]+name=["']([^"']*pass[^"']*)["'][^>]*>/i, /<input[^>]+type=["']password["'][^>]+name=["']([^"']+)["']/i]) || 'password' };
  }
  async function directLogin(config) {
    try {
      const page = await fetchLoginPage(config); const meta = extractLoginMeta(page.html, config.baseUrl); const form = new URLSearchParams();
      Object.entries(meta.hiddenInputs).forEach(([key, value]) => form.set(key, value)); form.set(meta.usernameField, String(config.username)); form.set(meta.passwordField, String(config.password)); if (meta.csrfValue && !form.has(meta.csrfField)) form.set(meta.csrfField, meta.csrfValue);
      const response = await apiFetch(meta.actionUrl, { method: 'POST', credentials: 'include', headers: { Accept: 'text/html,application/xhtml+xml', 'Content-Type': 'application/x-www-form-urlencoded', Origin: baseUrl(config.baseUrl), Referer: page.loginUrl }, body: form.toString(), redirect: 'follow' });
      // Login response alone is never authoritative; the retried chart request decides.
      if (!response.ok) return { ok: false, error: `Direct login basarisiz (${response.status}).`, errorType: 'LOGIN_FAILED' };
      return { ok: true, authMode: 'direct-login' };
    } catch (error) { return { ok: false, error: sanitizeError(error, 'Direct login basarisiz.'), errorType: 'LOGIN_FAILED' }; }
  }
  async function waitForTabComplete(tabId, timeoutMs = 20000) {
    const c = apiChrome();
    return new Promise((resolve, reject) => {
      let done = false; const finish = (fn, value) => { if (done) return; done = true; c.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); fn(value); };
      const onUpdated = (id, change) => { if (id === tabId && change.status === 'complete') finish(resolve, true); };
      const timer = setTimeout(async () => { try { const tab = await c.tabs.get(tabId); tab?.status === 'complete' ? finish(resolve, true) : finish(reject, new Error('Login sekmesi zaman asimina ugradi.')); } catch (error) { finish(reject, error); } }, timeoutMs);
      c.tabs.onUpdated.addListener(onUpdated);
    });
  }
  async function waitForPostSubmitNavigation(tabId, timeoutMs = 15000) {
    const c = apiChrome();
    return new Promise((resolve) => {
      let sawLoading = false; let done = false;
      const finish = (value) => { if (done) return; done = true; c.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); resolve(value); };
      const onUpdated = (id, change) => { if (id !== tabId) return; if (change.status === 'loading') sawLoading = true; if (sawLoading && change.status === 'complete') finish(true); };
      const timer = setTimeout(() => finish(false), timeoutMs);
      c.tabs.onUpdated.addListener(onUpdated);
    });
  }
  async function hiddenTabLogin(config) {
    let tabId = null; const c = apiChrome();
    try {
      const tab = await c.tabs.create({ url: `${baseUrl(config.baseUrl)}/login/`, active: false }); tabId = tab.id; await waitForTabComplete(tabId);
      const postSubmitNavigation = waitForPostSubmitNavigation(tabId);
      await c.scripting.executeScript({ target: { tabId }, func: (username, password) => {
        const input = (terms, type) => Array.from(document.querySelectorAll('input')).find((node) => type && node.type === type || terms.some((term) => `${node.name} ${node.id} ${node.placeholder}`.toLowerCase().includes(term))) || null;
        const user = input(['user', 'email', 'login'], 'email') || input(['user', 'email', 'login'], 'text'); const pass = input(['pass'], 'password'); const form = pass?.form || user?.form || document.querySelector('form');
        if (!user || !pass || !form) throw new Error('Login form alanlari bulunamadi.');
        [[user, username], [pass, password]].forEach(([node, value]) => { node.focus(); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }); form.submit();
      }, args: [String(config.username), String(config.password)] });
      await postSubmitNavigation;
      const finalTab = await c.tabs.get(tabId).catch(() => null); const origin = (() => { try { return new URL(String(finalTab?.url || '')).origin; } catch { return ''; } })();
      if (origin) {
        console.info(`[WebSCADA] Hidden-tab redirect origin: ${origin}`);
        if (origin !== new URL(baseUrl(config.baseUrl)).origin) console.warn(`[WebSCADA] Hidden-tab login redirected to a different origin: ${origin}`);
      }
      return { ok: true, authMode: 'hidden-tab' };
    } catch (error) { return { ok: false, error: sanitizeError(error, 'Hidden tab login basarisiz.'), errorType: 'LOGIN_FAILED' }; }
    finally { if (typeof tabId === 'number') await c.tabs.remove(tabId).catch(() => {}); }
  }
  async function ensureSession(config, onStatus) { if (await sessionValid(config)) return { ok: true, authMode: 'session' }; onStatus?.('Superset oturumu aciliyor...'); return directLogin(config); }
  function __setTestDeps(next) { deps = next || {}; csrf = { token: '', baseUrl: '', at: 0 }; }
  return { loadConfig, ensureSession, sessionValid, directLogin, hiddenTabLogin, csrfToken, invalidateCsrf, baseUrl, extractLoginMeta, request: apiFetch, __setTestDeps };
})();
