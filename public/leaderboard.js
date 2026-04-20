// Leaderboard I/O. DreamLo is fetched via same-origin proxy on https (CORS). On http
// origins we call dreamlo directly.
// the /api/dreamlo Vercel proxy, otherwise we call the origin directly.
//
// Extracted from game.js so the menu closure doesn't own XHR. All state (cache,
// loading flag) lives on the `menu` object passed in; this module just reads/writes.
//
// Usage:
//   const lb = window.LeaderboardSystem({ public: '...', private: '...' });
//   lb.fetch(menu);          // populates menu.leaderboard, menu.lbLoading, menu.lbError
//   lb.submit(menu, name, score, timeSeconds);
//   lb.formatTime(120) // => "02:00"
window.LeaderboardSystem = function (config) {
  const DREAMLO_PUBLIC = config.public || '';
  const DREAMLO_PRIVATE = config.private || '';
  const MIN_FETCH_INTERVAL_MS = 15000;

  function dreamloUrl(path) {
    if (location.protocol === 'https:') {
      // PartyKit only exposes per-room HTTP at /parties/<party>/<room>, so we
      // route the proxy through a dedicated "dreamlo" room there. On Vercel
      // (and any other host that serves this static bundle) we keep using the
      // serverless `/api/dreamlo` endpoint.
      if (/\.partykit\.dev$/i.test(location.hostname)) {
        return '/parties/main/dreamlo?path=' + encodeURIComponent(path);
      }
      return '/api/dreamlo?path=' + encodeURIComponent(path);
    }
    return 'http://dreamlo.com/lb/' + path;
  }

  function formatTime(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    const minStr = m < 100 ? String(m).padStart(2, '0') : String(m);
    return minStr + ':' + String(r).padStart(2, '0');
  }

  function fetch(menu) {
    if (!DREAMLO_PUBLIC || menu.lbLoading) return;
    const now = Date.now();
    if (now - menu.lbLastFetch < MIN_FETCH_INTERVAL_MS) return;
    menu.lbLoading = true;
    menu.lbError = false;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', dreamloUrl(DREAMLO_PUBLIC + '/pipe'));
    xhr.onload = function () {
      const lines = xhr.responseText.trim().split('\n').filter(Boolean);
      menu.leaderboard = lines.slice(0, 10).map(function (line) {
        const parts = line.split('|');
        const timeRaw = parts[2];
        const timeSec = timeRaw !== undefined && timeRaw !== '' ? parseInt(timeRaw, 10) : NaN;
        return {
          name: parts[0] || '???',
          score: parseInt(parts[1], 10) || 0,
          timeSec: Number.isFinite(timeSec) ? timeSec : null,
        };
      });
      menu.lbLastFetch = Date.now();
      menu.lbLoading = false;
    };
    xhr.onerror = function () { menu.lbError = true; menu.lbLoading = false; };
    xhr.send();
  }

  function submit(menu, name, score, timeSeconds) {
    if (!DREAMLO_PRIVATE || !name || score <= 0) return;
    const t = Math.max(0, Math.floor(timeSeconds || 0));
    const path = DREAMLO_PRIVATE + '/add/' + encodeURIComponent(name) + '/' + score + '/' + t;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', dreamloUrl(path));
    xhr.onload = function () { menu.lbLastFetch = 0; fetch(menu); };
    xhr.onerror = function () {};
    xhr.send();
  }

  return {
    enabled: !!DREAMLO_PUBLIC,
    fetch: fetch,
    submit: submit,
    formatTime: formatTime,
  };
};
