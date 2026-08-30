(() => {
  if (!globalThis.chrome?.runtime || !document.getElementById('webscadaSettings')) return;
  const defaults = globalThis.WebSCADAReactive?.DEFAULT_REFERENCES || { kv154: 120, kv400: 300 };
  const $ = id => document.getElementById(id);

  function ensureCard() {
    if ($('settingsReactiveReference154')) return;
    const card = document.createElement('section');
    card.className = 'settings-card';
    card.innerHTML = `
      <h2>Reaktif Referans</h2>
      <label>154 kV <input id="settingsReactiveReference154" type="number" min="1" max="10000" step="1" inputmode="decimal"> MVar</label>
      <label>400 kV <input id="settingsReactiveReference400" type="number" min="1" max="10000" step="1" inputmode="decimal"> MVar</label>
      <p class="workspace-note">Hat (MVar) rengi max(|Q başlangıç|, |Q bitiş|) / referans ile hesaplanır.</p>
    `;
    document.querySelector('#webscadaSettings .settings-grid')?.insertBefore(card, document.querySelector('#webscadaSettings .settings-grid .settings-card:nth-child(3)') || null);
  }

  function apply(settings) {
    const references = globalThis.WebSCADAReactive?.normalizeReferences(settings) || defaults;
    $('settingsReactiveReference154').value = String(references.kv154);
    $('settingsReactiveReference400').value = String(references.kv400);
    globalThis.applyReactiveReferenceSettings?.(settings || {});
  }

  async function hydrate() {
    const response = await chrome.runtime.sendMessage({ type: 'WEBSCADA_SETTINGS_GET' });
    if (response?.ok) apply(response.settings);
  }

  async function save() {
    const payload = {
      reactiveReference154Mvar: Number($('settingsReactiveReference154').value),
      reactiveReference400Mvar: Number($('settingsReactiveReference400').value)
    };
    const response = await chrome.runtime.sendMessage({ type: 'WEBSCADA_SETTINGS_SAVE', payload });
    if (!response?.ok) throw new Error(response?.error || 'Reaktif referans kaydedilemedi.');
    apply(response.settings);
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureCard();
    ['settingsReactiveReference154', 'settingsReactiveReference400'].forEach((id) => {
      $(id).addEventListener('change', () => save().catch(() => hydrate()));
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.webscadaSettings) apply(changes.webscadaSettings.newValue || {});
    });
    hydrate().catch(() => apply({}));
  });
})();
