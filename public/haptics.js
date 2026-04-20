// Vanilla port of lochie/web-haptics.
// Two back-ends, picked at runtime:
//   1. navigator.vibrate (Android, desktop Chrome on vibration-capable devices)
//      Intensity is simulated via PWM of duration+delay segments.
//   2. iOS 17.4+ <input type="checkbox" switch> trick. Toggling the switch
//      element fires the Taptic Engine; we rAF-loop .click() calls at an
//      interval derived from intensity (16ms @ 1.0 ... 200ms @ ~0) for the
//      requested duration.
// Critical constraints for the iOS path:
//   - The switch element must already be in the DOM when trigger() runs
//     (we create it eagerly, not lazily).
//   - The first click must happen synchronously inside a user-gesture
//     callback. Callers invoke haptics.trigger from touchstart / click, so
//     that holds.
(function () {
  'use strict';

  const DEFAULT_PATTERNS = {
    success: [{ duration: 30, intensity: 0.5 }, { delay: 60, duration: 40, intensity: 1 }],
    warning: [{ duration: 40, intensity: 0.8 }, { delay: 100, duration: 40, intensity: 0.6 }],
    error: [
      { duration: 40, intensity: 0.7 },
      { delay: 40, duration: 40, intensity: 0.7 },
      { delay: 40, duration: 40, intensity: 0.9 },
      { delay: 40, duration: 50, intensity: 0.6 },
    ],
    light: [{ duration: 15, intensity: 0.4 }],
    medium: [{ duration: 25, intensity: 0.7 }],
    heavy: [{ duration: 35, intensity: 1 }],
    soft: [{ duration: 40, intensity: 0.5 }],
    rigid: [{ duration: 10, intensity: 1 }],
    selection: [{ duration: 8, intensity: 0.3 }],
    nudge: [{ duration: 80, intensity: 0.8 }, { delay: 80, duration: 50, intensity: 0.3 }],
    buzz: [{ duration: 1000, intensity: 1 }],
  };

  const TOGGLE_MIN = 16;
  const TOGGLE_MAX = 184;
  const MAX_PHASE_MS = 1000;
  const PWM_CYCLE = 20;
  const DEFAULT_INTENSITY = 0.5;

  const canVibrate =
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  let enabled = true;
  let showSwitch = false;
  let hapticLabel = null;
  let hapticCheckbox = null;
  let domInitialized = false;
  let rafId = null;

  function normalizeInput(input) {
    if (typeof input === 'number') return [{ duration: input }];
    if (typeof input === 'string') {
      const preset = DEFAULT_PATTERNS[input];
      if (!preset) {
        console.warn('[web-haptics] unknown preset:', input);
        return null;
      }
      return preset.map(v => ({ ...v }));
    }
    if (Array.isArray(input)) {
      if (input.length === 0) return [];
      if (typeof input[0] === 'number') {
        const out = [];
        for (let i = 0; i < input.length; i += 2) {
          const delay = i > 0 ? input[i - 1] : 0;
          const entry = { duration: input[i] };
          if (delay > 0) entry.delay = delay;
          out.push(entry);
        }
        return out;
      }
      return input.map(v => ({ ...v }));
    }
    return null;
  }

  function modulateVibration(duration, intensity) {
    if (intensity >= 1) return [duration];
    if (intensity <= 0) return [];
    const onTime = Math.max(1, Math.round(PWM_CYCLE * intensity));
    const offTime = PWM_CYCLE - onTime;
    const out = [];
    let remaining = duration;
    while (remaining >= PWM_CYCLE) {
      out.push(onTime);
      out.push(offTime);
      remaining -= PWM_CYCLE;
    }
    if (remaining > 0) {
      const remOn = Math.max(1, Math.round(remaining * intensity));
      out.push(remOn);
      const remOff = remaining - remOn;
      if (remOff > 0) out.push(remOff);
    }
    return out;
  }

  function toVibratePattern(vibrations, defaultIntensity) {
    const result = [];
    for (let i = 0; i < vibrations.length; i++) {
      const vib = vibrations[i];
      const intensity = Math.max(
        0,
        Math.min(1, vib.intensity != null ? vib.intensity : defaultIntensity)
      );
      const delay = vib.delay || 0;
      if (delay > 0) {
        if (result.length > 0 && result.length % 2 === 0) {
          result[result.length - 1] += delay;
        } else {
          if (result.length === 0) result.push(0);
          result.push(delay);
        }
      }
      const modulated = modulateVibration(vib.duration, intensity);
      if (modulated.length === 0) {
        if (result.length > 0 && result.length % 2 === 0) {
          result[result.length - 1] += vib.duration;
        } else if (vib.duration > 0) {
          result.push(0);
          result.push(vib.duration);
        }
        continue;
      }
      for (let j = 0; j < modulated.length; j++) result.push(modulated[j]);
    }
    return result;
  }

  function applySwitchVisibility() {
    if (!hapticLabel || !hapticCheckbox) return;
    if (showSwitch) {
      hapticLabel.style.display = '';
      hapticCheckbox.style.display = '';
    } else {
      hapticLabel.style.display = 'none';
      hapticCheckbox.style.display = 'none';
    }
  }

  function ensureDOM() {
    if (domInitialized) return;
    if (typeof document === 'undefined' || !document.body) return;
    const id = 'web-haptics-switch';
    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = 'Haptic feedback';
    label.style.position = 'fixed';
    label.style.bottom = '10px';
    label.style.left = '10px';
    label.style.padding = '5px 10px';
    label.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    label.style.color = 'white';
    label.style.fontFamily = 'sans-serif';
    label.style.fontSize = '14px';
    label.style.borderRadius = '4px';
    label.style.zIndex = '9999';
    label.style.userSelect = 'none';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    // Apple-specific toggle attribute — renders as iOS switch and fires the
    // Taptic Engine on state change in Safari 17.4+.
    cb.setAttribute('switch', '');
    cb.id = id;
    cb.style.all = 'initial';
    cb.style.appearance = 'auto';

    label.appendChild(cb);
    document.body.appendChild(label);
    hapticLabel = label;
    hapticCheckbox = cb;
    domInitialized = true;
    applySwitchVisibility();
  }

  function initDOMWhenReady() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensureDOM, { once: true });
    } else {
      ensureDOM();
    }
  }
  initDOMWhenReady();

  function fireSwitchClick() {
    if (!hapticCheckbox || !hapticLabel) return;
    // Click the label (dispatches to associated input in most browsers) AND
    // the input directly (some WebKit builds only fire Taptic on a direct
    // click of the <input switch>, not via label forwarding).
    try { hapticLabel.click(); } catch (_) {}
    try { hapticCheckbox.click(); } catch (_) {}
  }

  function stopPattern() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function runSwitchPattern(vibrations, defaultIntensity, firstClickFired) {
    if (!hapticLabel) return;
    const phases = [];
    let cumulative = 0;
    for (let i = 0; i < vibrations.length; i++) {
      const vib = vibrations[i];
      const intensity = Math.max(
        0,
        Math.min(1, vib.intensity != null ? vib.intensity : defaultIntensity)
      );
      const delay = vib.delay || 0;
      if (delay > 0) {
        cumulative += delay;
        phases.push({ end: cumulative, isOn: false, intensity: 0 });
      }
      cumulative += vib.duration;
      phases.push({ end: cumulative, isOn: true, intensity });
    }
    const total = cumulative;
    let startTime = 0;
    let lastToggle = -1;
    let didFirst = firstClickFired;
    const loop = time => {
      if (startTime === 0) startTime = time;
      const elapsed = time - startTime;
      if (elapsed >= total) { rafId = null; return; }
      let phase = phases[0];
      for (let i = 0; i < phases.length; i++) {
        if (elapsed < phases[i].end) { phase = phases[i]; break; }
      }
      if (phase.isOn) {
        const toggleInterval = TOGGLE_MIN + (1 - phase.intensity) * TOGGLE_MAX;
        if (lastToggle === -1) {
          lastToggle = time;
          if (!didFirst) { fireSwitchClick(); didFirst = true; }
        } else if (time - lastToggle >= toggleInterval) {
          fireSwitchClick();
          lastToggle = time;
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function trigger(input, options) {
    if (!enabled) return;
    const vibrations = normalizeInput(input);
    if (!vibrations || vibrations.length === 0) return;
    const defaultIntensity = Math.max(
      0,
      Math.min(1, (options && options.intensity) != null ? options.intensity : DEFAULT_INTENSITY)
    );
    for (let i = 0; i < vibrations.length; i++) {
      const v = vibrations[i];
      if (v.duration > MAX_PHASE_MS) v.duration = MAX_PHASE_MS;
      if (!Number.isFinite(v.duration) || v.duration < 0) return;
      if (v.delay != null && (!Number.isFinite(v.delay) || v.delay < 0)) return;
    }

    if (canVibrate) {
      try { navigator.vibrate(toVibratePattern(vibrations, defaultIntensity)); }
      catch (_) {}
      return;
    }

    ensureDOM();
    if (!hapticLabel) return;
    stopPattern();
    const firstDelay = vibrations[0].delay || 0;
    let firstClickFired = false;
    if (firstDelay === 0) {
      fireSwitchClick();
      firstClickFired = true;
    }
    runSwitchPattern(vibrations, defaultIntensity, firstClickFired);
  }

  function stop() {
    stopPattern();
    if (canVibrate) {
      try { navigator.vibrate(0); } catch (_) {}
    }
  }

  window.haptics = {
    trigger,
    stop,
    isSupported: () => canVibrate || typeof document !== 'undefined',
    setEnabled: v => { enabled = !!v; if (!v) stop(); },
    isEnabled: () => enabled,
    setShowSwitch: v => { showSwitch = !!v; applySwitchVisibility(); },
    patterns: DEFAULT_PATTERNS,
  };
})();
