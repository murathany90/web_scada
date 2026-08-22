((root, factory) => { const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.WebSCADASettings = api; })(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const KEY = 'webscadaSettings';
  const WARNING_SOUNDS = ['warning_01_pulse.wav', 'warning_02_double_beep.wav', 'warning_03_chime.wav'];
  const CRITICAL_SOUNDS = ['critical_01_dualtone.wav', 'critical_02_siren.wav', 'critical_03_triple_burst.wav'];
  const DEFAULTS = Object.freeze({ autoRefreshEnabled: true, autoRefreshMinutes: 2, capacitySeason: 'winter', alarmNotificationsEnabled: true, alarmSoundEnabled: true, warningSound: 'warning_02_double_beep.wav', criticalSound: 'critical_01_dualtone.wav', alarmVolume: 100 });
  const minutes = value => [1, 2, 5, 10, 15].includes(Number(value)) ? Number(value) : DEFAULTS.autoRefreshMinutes;
  function normalize(input = {}, legacy = {}) {
    const source = { ...DEFAULTS, ...legacy, ...input };
    return { ...source, autoRefreshEnabled: source.autoRefreshEnabled !== false, autoRefreshMinutes: minutes(source.autoRefreshMinutes), capacitySeason: source.capacitySeason === 'summer' ? 'summer' : 'winter', alarmNotificationsEnabled: source.alarmNotificationsEnabled !== false, alarmSoundEnabled: source.alarmSoundEnabled !== false, warningSound: WARNING_SOUNDS.includes(source.warningSound) ? source.warningSound : DEFAULTS.warningSound, criticalSound: CRITICAL_SOUNDS.includes(source.criticalSound) ? source.criticalSound : DEFAULTS.criticalSound, alarmVolume: Math.max(0, Math.min(100, Number.isFinite(Number(source.alarmVolume)) ? Number(source.alarmVolume) : DEFAULTS.alarmVolume)) };
  }
  async function load() { const stored = await chrome.storage.local.get([KEY, 'mapPrefs']); const legacy = { capacitySeason: stored.mapPrefs?.scadaSeason, autoRefreshEnabled: stored.mapPrefs?.scadaAutoRefresh }; const next = normalize(stored[KEY], legacy); if (JSON.stringify(stored[KEY] || {}) !== JSON.stringify(next)) await chrome.storage.local.set({ [KEY]: next }); return next; }
  async function save(patch) { const next = normalize({ ...(await load()), ...(patch || {}) }); await chrome.storage.local.set({ [KEY]: next }); return next; }
  return { KEY, DEFAULTS, WARNING_SOUNDS, CRITICAL_SOUNDS, normalize, load, save };
});
