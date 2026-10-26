const AUDIO_CTX = window.AudioContext || window.webkitAudioContext;

let audioCtx = null;
let soundTimer = null;
let soundMode = null;
let currentIncomingId = null;
let outgoingPending = false;
let outgoingActive = false;
let outgoingPendingTimer = null;
let notificationPromptShown = false;
let soundUnlockPromptShown = false;
let soundGeneration = 0;
const activeTones = new Set();
let silencedIncomingId = null;

function reportAudioError(operation, error) {
  if (String(globalThis.__FRAKTUM_CONFIG__?.VITE_RTC_DEBUG) === 'true') {
    console.debug('[FRAKTUM call audio]', operation, error?.name || 'Error', error?.message || String(error));
  }
}

function getAudioContext() {
  if (!AUDIO_CTX) return null;
  if (!audioCtx) audioCtx = new AUDIO_CTX();
  return audioCtx;
}

async function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') return false;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.025);
    return true;
  } catch (error) {
    reportAudioError('unlock', error);
    return false;
  }
}

function playTone(freq, durationMs, volume = 0.1, type = 'sine', delayMs = 0) {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return false;
  const start = ctx.currentTime + delayMs / 1000;
  const end = start + durationMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.03);
  gain.gain.setValueAtTime(Math.max(0.0002, volume), Math.max(start + 0.04, end - 0.07));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(ctx.destination);
  activeTones.add(osc);
  osc.onended = () => {
    activeTones.delete(osc);
    osc.disconnect();
    gain.disconnect();
  };
  osc.start(start);
  osc.stop(end + 0.03);
  return true;
}

function playIncomingPhrase() {
  // Noticeable melodic FRAKTUM ringtone.
  const notes = [
    [659.25, 0, 230],
    [783.99, 250, 230],
    [987.77, 500, 300],
    [783.99, 850, 230],
    [659.25, 1100, 330]
  ];
  let played = false;
  for (const [freq, delay, length] of notes) {
    played = playTone(freq, length, 0.12, 'triangle', delay) || played;
    playTone(freq / 2, length, 0.035, 'sine', delay);
  }
  return played;
}

function playOutgoingPhrase() {
  // Classic dual-tone ringback, deliberately louder than the previous build.
  const a = playTone(440, 1100, 0.085, 'sine', 0);
  const b = playTone(480, 1100, 0.065, 'sine', 0);
  return a || b;
}

function removeSoundUnlockPrompt() {
  document.querySelector('#fraktumSoundUnlock')?.remove();
  soundUnlockPromptShown = false;
}

function showSoundUnlockPrompt() {
  if (soundUnlockPromptShown || !soundMode) return;
  soundUnlockPromptShown = true;
  const box = document.createElement('div');
  box.id = 'fraktumSoundUnlock';
  Object.assign(box.style, {
    position: 'fixed',
    left: '50%',
    bottom: '20px',
    transform: 'translateX(-50%)',
    zIndex: '100001',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: 'min(430px, calc(100vw - 28px))',
    padding: '12px 14px',
    borderRadius: '15px',
    background: 'rgba(8, 16, 31, .98)',
    border: '1px solid rgba(121, 105, 255, .55)',
    boxShadow: '0 18px 50px rgba(0,0,0,.45)',
    color: '#eef3ff',
    fontFamily: 'inherit'
  });
  box.innerHTML = '<div style="flex:1"><b>Звук звонка заблокирован браузером</b><div style="font-size:12px;opacity:.72;margin-top:2px">Нажмите один раз, чтобы FRAKTUM мог воспроизводить звонки.</div></div><button id="fraktumUnlockSound" style="border:0;border-radius:10px;padding:9px 12px;background:#7567ff;color:white;font-weight:700;cursor:pointer">Включить звук</button>';
  document.body.appendChild(box);
  box.querySelector('#fraktumUnlockSound')?.addEventListener('click', async () => {
    const ok = await unlockAudio();
    if (!ok) return;
    removeSoundUnlockPrompt();
    if (soundMode === 'incoming') playIncomingPhrase();
    if (soundMode === 'outgoing') playOutgoingPhrase();
  });
}

function stopCallSound() {
  soundGeneration += 1;
  if (soundTimer) clearTimeout(soundTimer);
  soundTimer = null;
  soundMode = null;
  for (const tone of activeTones) {
    try { tone.stop(); } catch (error) { reportAudioError('stop tone', error); }
  }
  activeTones.clear();
  removeSoundUnlockPrompt();
}

async function startCallSound(mode) {
  if (soundMode === mode) return;
  stopCallSound();
  soundMode = mode;
  const generation = ++soundGeneration;

  const repeat = async () => {
    if (generation !== soundGeneration || soundMode !== mode) return;
    const unlocked = await unlockAudio();
    if (generation !== soundGeneration || soundMode !== mode) return;

    if (!unlocked) {
      showSoundUnlockPrompt();
      soundTimer = setTimeout(repeat, 1200);
      return;
    }

    removeSoundUnlockPrompt();
    const played = mode === 'incoming' ? playIncomingPhrase() : playOutgoingPhrase();
    if (!played) showSoundUnlockPrompt();
    soundTimer = setTimeout(repeat, mode === 'incoming' ? 3400 : 3900);
  };

  repeat();
}

// Unlock as early as possible after any real user interaction.
const prime = () => { void unlockAudio(); };
document.addEventListener('pointerdown', prime, { capture: true });
document.addEventListener('touchstart', prime, { capture: true, passive: true });
document.addEventListener('keydown', prime, { capture: true });

function showNotificationOptIn() {
  if (notificationPromptShown || !('Notification' in window) || window.Notification.permission !== 'default') return;
  if (document.querySelector('#fraktumCallNotificationOptIn')) return;
  notificationPromptShown = true;

  const box = document.createElement('div');
  box.id = 'fraktumCallNotificationOptIn';
  Object.assign(box.style, {
    position: 'fixed', right: '18px', bottom: '18px', zIndex: '100000',
    width: 'min(360px, calc(100vw - 36px))', padding: '14px', borderRadius: '16px',
    background: 'rgba(9, 18, 34, .97)', border: '1px solid rgba(125, 112, 255, .42)',
    boxShadow: '0 18px 50px rgba(0,0,0,.35)', color: '#eef3ff', fontFamily: 'inherit'
  });
  box.innerHTML = '<div style="font-weight:700;margin-bottom:5px">Уведомления о звонках</div><div style="font-size:13px;line-height:1.4;opacity:.78;margin-bottom:11px">Разрешите FRAKTUM показывать входящие звонки вне активной вкладки.</div><div style="display:flex;gap:8px;justify-content:flex-end"><button id="fraktumCallNotifyLater" style="border:0;border-radius:10px;padding:8px 11px;background:#17233a;color:#dbe7ff;cursor:pointer">Позже</button><button id="fraktumCallNotifyEnable" style="border:0;border-radius:10px;padding:8px 11px;background:#7667ff;color:white;font-weight:700;cursor:pointer">Включить</button></div>';
  document.body.appendChild(box);
  box.querySelector('#fraktumCallNotifyLater')?.addEventListener('click', () => box.remove());
  box.querySelector('#fraktumCallNotifyEnable')?.addEventListener('click', async () => {
    try {
      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') {
        box.querySelector('div').textContent = 'Уведомления не разрешены. Входящие звонки доступны в открытой вкладке.';
        box.querySelector('#fraktumCallNotifyEnable').disabled = true;
        return;
      }
    } catch (error) {
      reportAudioError('notification permission', error);
      box.querySelector('div').textContent = 'Не удалось разрешить уведомления. Проверьте настройки браузера.';
      return;
    }
    await unlockAudio();
    box.remove();
  });
}

function notifyIncomingCall({ id, caller, mode }) {
  if (!('Notification' in window) || window.Notification.permission !== 'granted') return;
  try {
    const n = new window.Notification(mode === 'video' ? 'Входящий видеозвонок · FRAKTUM' : 'Входящий звонок · FRAKTUM', {
      body: `${caller} звонит вам`,
      icon: '/assets/home/brand.png',
      badge: '/assets/home/brand.png',
      tag: `fraktum-call-${id || 'incoming'}`,
      renotify: true,
      requireInteraction: true,
      silent: false
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (error) {
    reportAudioError('incoming notification', error);
  }
}

function detectIncomingCall() {
  const modal = document.querySelector('.incoming-call');
  if (!modal) {
    if (currentIncomingId && soundMode === 'incoming') stopCallSound();
    currentIncomingId = null;
    silencedIncomingId = null;
    return;
  }
  const actionButton = modal.querySelector('[data-action="accept-cloud-call"], [data-action="decline-cloud-call"]');
  const id = actionButton?.dataset.id || 'incoming';
  if (silencedIncomingId === id) return;
  if (currentIncomingId === id) return;
  currentIncomingId = id;
  const caller = modal.querySelector('h2')?.textContent?.trim() || 'Пользователь';
  const eyebrow = modal.querySelector('.eyebrow')?.textContent || '';
  const mode = /видео/i.test(eyebrow) ? 'video' : 'audio';
  startCallSound('incoming');
  notifyIncomingCall({ id, caller, mode });
}

function detectOutgoingCall() {
  const overlay = document.querySelector('#realCallOverlay');
  const status = document.querySelector('#realCallStatus')?.textContent?.trim() || '';
  const state = overlay?.dataset.callState;
  const stopped = ['connected', 'failed', 'ended', 'declined'].includes(state)
    || ['Подключено', 'Нет соединения', 'Завершён', 'Соединено', 'Звонок отклонён', 'Звонок завершён', 'Связь прервана'].includes(status);
  if (stopped || (!overlay && outgoingActive)) {
    outgoingPending = false;
    outgoingActive = false;
    if (outgoingPendingTimer) clearTimeout(outgoingPendingTimer);
    outgoingPendingTimer = null;
    if (soundMode === 'outgoing') stopCallSound();
    return;
  }
  if (outgoingPending && overlay && !outgoingActive) {
    outgoingPending = false;
    outgoingActive = true;
    if (outgoingPendingTimer) clearTimeout(outgoingPendingTimer);
    outgoingPendingTimer = null;
    startCallSound('outgoing');
  }
}

function scanCallUi() {
  detectIncomingCall();
  detectOutgoingCall();
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest?.('[data-action], #realCallHangup');
  if (!target) return;
  const action = target.dataset?.action;

  if (action === 'start-call') {
    outgoingPending = true;
    outgoingActive = false;
    if (outgoingPendingTimer) clearTimeout(outgoingPendingTimer);
    outgoingPendingTimer = setTimeout(() => {
      if (outgoingPending && !document.querySelector('#realCallOverlay')) outgoingPending = false;
    }, 12000);
    showNotificationOptIn();
    await unlockAudio();
    scanCallUi();
  }

  if (action === 'accept-cloud-call' || action === 'decline-cloud-call') {
    silencedIncomingId = target.dataset.id || currentIncomingId;
    if (soundMode === 'incoming') stopCallSound();
  }

  if (action === 'toggle-chat-panel' || (action === 'navigate' && target.dataset?.page === 'messages')) {
    await unlockAudio();
    showNotificationOptIn();
  }

  if (action === 'end-call' || target.id === 'realCallHangup') {
    outgoingPending = false;
    outgoingActive = false;
    currentIncomingId = null;
    if (outgoingPendingTimer) clearTimeout(outgoingPendingTimer);
    outgoingPendingTimer = null;
    stopCallSound();
  }
}, true);

window.addEventListener('fraktum:callstate', event => {
  const state = event.detail?.state;
  if (['connected', 'failed', 'ended', 'declined'].includes(state)) {
    outgoingPending = false;
    outgoingActive = false;
    if (outgoingPendingTimer) clearTimeout(outgoingPendingTimer);
    outgoingPendingTimer = null;
    stopCallSound();
  }
});

const observer = new window.MutationObserver(scanCallUi);
const observeOptions = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-call-state'] };
observer.observe(document.documentElement, observeOptions);
let scanTimer = setInterval(scanCallUi, 400);

window.addEventListener('pagehide', () => {
  outgoingPending = false;
  outgoingActive = false;
  clearTimeout(outgoingPendingTimer);
  outgoingPendingTimer = null;
  clearInterval(scanTimer);
  scanTimer = null;
  observer.disconnect();
  stopCallSound();
});
window.addEventListener('pageshow', () => {
  if (scanTimer === null) scanTimer = setInterval(scanCallUi, 400);
  observer.observe(document.documentElement, observeOptions);
  scanCallUi();
});
window.addEventListener('beforeunload', stopCallSound);

// Small debug API: useful in DevTools and harmless in production.
window.FraktumCallAudio = {
  unlock: unlockAudio,
  testIncoming: async () => { await unlockAudio(); stopCallSound(); soundMode = 'incoming'; playIncomingPhrase(); },
  testOutgoing: async () => { await unlockAudio(); stopCallSound(); soundMode = 'outgoing'; playOutgoingPhrase(); },
  stop: stopCallSound,
  state: () => ({ audioState: audioCtx?.state || 'not-created', soundMode })
};

scanCallUi();
