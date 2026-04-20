// Haptics wrapper:
// - Android and other Vibration API browsers use navigator.vibrate().
// - iOS Safari uses the real ios-haptics package loaded in index.html.
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

  const PWM_CYCLE = 20;
  const MAX_PHASE_MS = 1000;
  const DEFAULT_INTENSITY = 0.5;

  const canVibrate =
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  let enabled = true;

  function iosLib() {
    return typeof window !== 'undefined' ? window.iosHapticsLib : null;
  }

  function supportsIosHaptics() {
    const lib = iosLib();
    return !!(lib && lib.supportsHaptics && typeof lib.haptic === 'function');
  }

  function normalizeInput(input) {
    if (typeof input === 'number') return [{ duration: input }];
    if (typeof input === 'string') {
      const preset = DEFAULT_PATTERNS[input];
      if (!preset) return null;
      return preset.map(v => ({ ...v }));
    }
    if (Array.isArray(input)) {
      if (input.length === 0) return [];
      if (typeof input[0] === 'number') {
        const out = [];
        for (let i = 0; i < input.length; i += 2) {
          const entry = { duration: input[i] };
          const delay = i > 0 ? input[i - 1] : 0;
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
        if (result.length > 0 && result.length % 2 === 0) result[result.length - 1] += delay;
        else {
          if (result.length === 0) result.push(0);
          result.push(delay);
        }
      }

      const modulated = modulateVibration(vib.duration, intensity);
      if (modulated.length === 0) continue;
      for (let j = 0; j < modulated.length; j++) result.push(modulated[j]);
    }

    return result;
  }

  function toIosHapticKind(vibrations, defaultIntensity) {
    let activeCount = 0;
    let strongest = 0;
    let totalDuration = 0;

    for (let i = 0; i < vibrations.length; i++) {
      const vib = vibrations[i];
      const intensity = Math.max(
        0,
        Math.min(1, vib.intensity != null ? vib.intensity : defaultIntensity)
      );
      if (vib.duration <= 0 || intensity <= 0) continue;
      activeCount += 1;
      strongest = Math.max(strongest, intensity);
      totalDuration += vib.duration;
    }

    if (activeCount >= 3 || strongest >= 0.85 || totalDuration >= 120) return 'error';
    if (activeCount >= 2 || strongest >= 0.6 || totalDuration >= 40) return 'confirm';
    return 'single';
  }

  function triggerIosHaptics(vibrations, defaultIntensity) {
    const lib = iosLib();
    if (!lib || typeof lib.haptic !== 'function' || !lib.supportsHaptics) return false;

    const kind = toIosHapticKind(vibrations, defaultIntensity);
    if (kind === 'error' && typeof lib.haptic.error === 'function') {
      lib.haptic.error();
      return true;
    }
    if (kind === 'confirm' && typeof lib.haptic.confirm === 'function') {
      lib.haptic.confirm();
      return true;
    }

    lib.haptic();
    return true;
  }

  function trigger(input, options) {
    if (!enabled) return false;

    const vibrations = normalizeInput(input);
    if (!vibrations || vibrations.length === 0) return false;

    const defaultIntensity = Math.max(
      0,
      Math.min(1, (options && options.intensity) != null ? options.intensity : DEFAULT_INTENSITY)
    );

    for (let i = 0; i < vibrations.length; i++) {
      const vib = vibrations[i];
      if (vib.duration > MAX_PHASE_MS) vib.duration = MAX_PHASE_MS;
      if (!Number.isFinite(vib.duration) || vib.duration < 0) return false;
      if (vib.delay != null && (!Number.isFinite(vib.delay) || vib.delay < 0)) return false;
    }

    if (canVibrate) {
      try {
        return navigator.vibrate(toVibratePattern(vibrations, defaultIntensity));
      } catch (_) {
        return false;
      }
    }

    return triggerIosHaptics(vibrations, defaultIntensity);
  }

  function stop() {
    if (!canVibrate) return;
    try { navigator.vibrate(0); } catch (_) {}
  }

  window.haptics = {
    trigger,
    stop,
    isSupported: () => canVibrate || supportsIosHaptics(),
    setEnabled: value => {
      enabled = !!value;
      if (!enabled) stop();
    },
    isEnabled: () => enabled,
    patterns: DEFAULT_PATTERNS,
  };
})();
