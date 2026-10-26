// Browser TURN credentials must be short-lived. They are supplied at deployment,
// never embedded in source, and intentionally absent from diagnostics.
export function buildRtcConfiguration(runtime = globalThis.__FRAKTUM_CONFIG__ || {}) {
  const urls = String(runtime.VITE_TURN_URL || '').split(/[\s,]+/).filter(Boolean);
  const iceServers = [{urls: 'stun:stun.l.google.com:19302'}, {urls: 'stun:stun1.l.google.com:19302'}];
  if (urls.length) {
    if (urls.some(url => !/^turns?:[^\s/?]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/i.test(url))) {
      throw new Error('VITE_TURN_URL must contain turn: or turns: URLs');
    }
    if (!runtime.VITE_TURN_USERNAME || !runtime.VITE_TURN_CREDENTIAL) {
      throw new Error('TURN requires VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL');
    }
    iceServers.push({urls, username: runtime.VITE_TURN_USERNAME, credential: runtime.VITE_TURN_CREDENTIAL});
  }
  return {iceServers, iceCandidatePoolSize: 2};
}

export function rtcDebugEnabled(runtime = globalThis.__FRAKTUM_CONFIG__ || {}) {
  return String(runtime.VITE_RTC_DEBUG).toLowerCase() === 'true';
}
