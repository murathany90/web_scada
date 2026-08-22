(() => {
  const warning = new Set(['warning_01_pulse.wav', 'warning_02_double_beep.wav', 'warning_03_chime.wav']); const critical = new Set(['critical_01_dualtone.wav', 'critical_02_siren.wav', 'critical_03_triple_burst.wav']); let active = null;
  function stop() { if (active) { active.pause(); active.currentTime = 0; active = null; } }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== 'offscreen-audio') return;
    if (message.type === 'STOP_ALARM_SOUND') { stop(); sendResponse({ ok: true }); return; }
    if (message.type !== 'PLAY_ALARM_SOUND') return;
    const allowed = message.severity === 'warning' ? warning : critical; const soundName = allowed.has(message.soundName) ? message.soundName : message.severity === 'warning' ? 'warning_02_double_beep.wav' : 'critical_01_dualtone.wav';
    try { if (active && message.severity === 'critical') stop(); else stop(); const audio = new Audio(chrome.runtime.getURL(`sounds/alarm/${soundName}`)); audio.volume = Math.max(0, Math.min(1, Number(message.volume) / 100)); active = audio; audio.onended = () => { if (active === audio) active = null; }; audio.play().then(() => sendResponse({ ok: true, soundName })).catch(error => sendResponse({ ok: false, error: error.message || String(error) })); return true; } catch (error) { sendResponse({ ok: false, error: error.message || String(error) }); }
  });
})();
