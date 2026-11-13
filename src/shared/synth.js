/* synth.js: every default sound, made with WebAudio. Nothing here is a recording.
   Used by the background page (for real pages) and by the Studio's play buttons. */
(() => {
  'use strict';
  let ac = null;
  let bus = null;
  let noiseBuf = null;
  const live = new Map();

  function context() {
    if (!ac) {
      ac = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      comp.attack.value = 0.002;
      comp.release.value = 0.18;
      bus = ac.createGain();
      bus.connect(comp);
      comp.connect(ac.destination);
      const len = ac.sampleRate * 2;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function env(g, t, peak, attack, dur, curve = 3) {
    const steps = 12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      g.gain.linearRampToValueAtTime(Math.max(0.0001, peak * (1 - u) ** curve), t + attack + (dur - attack) * u);
    }
  }

  function tone(out, t, o) {
    const osc = ac.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + (o.glide || o.dur));
    if (o.det) osc.detune.value = o.det;
    const g = ac.createGain();
    env(g, t, o.g === undefined ? 0.3 : o.g, o.a || 0.004, o.dur, o.curve || 3);
    osc.connect(g);
    let last = g;
    if (o.lp) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      g.connect(f);
      last = f;
    }
    last.connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  function noise(out, t, o) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1200, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.glide || o.dur));
    f.Q.value = o.q === undefined ? 0.8 : o.q;
    const g = ac.createGain();
    env(g, t, o.g === undefined ? 0.25 : o.g, o.a || 0.003, o.dur, o.curve || 2.5);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random());
    src.stop(t + o.dur + 0.05);
  }

  /* building blocks */
  const taiko = (out, t, k = 1) => {
    tone(out, t, { f: 118 * k, to: 46 * k, glide: 0.22, dur: 0.75, g: 0.85, a: 0.002, curve: 3.2 });
    tone(out, t, { f: 210 * k, to: 90 * k, glide: 0.08, dur: 0.14, g: 0.35, a: 0.001 });
    noise(out, t, { type: 'lowpass', f: 1500, to: 220, dur: 0.1, g: 0.32 });
  };
  const hit = (out, t, k = 1) => {
    tone(out, t, { f: 72, to: 28, glide: 0.6, dur: 0.9, g: 0.7 * k, a: 0.002 });
    noise(out, t, { type: 'lowpass', f: 2400, to: 90, dur: 0.75, g: 0.42 * k });
    tone(out, t, { type: 'square', f: 160, to: 60, dur: 0.1, g: 0.14 * k, lp: 900 });
  };
  const slash = (out, t, k = 1) => {
    noise(out, t, { type: 'highpass', f: 1600, to: 9500, glide: 0.1, dur: 0.17, g: 0.34 * k, a: 0.008, q: 0.4 });
    tone(out, t + 0.012, { type: 'sawtooth', f: 3200, to: 300, glide: 0.11, dur: 0.14, g: 0.09 * k, lp: 7000 });
    tone(out, t + 0.1, { f: 5200, to: 4300, dur: 0.75, g: 0.05 * k, curve: 4 });
    tone(out, t + 0.1, { f: 7900, to: 7000, dur: 0.5, g: 0.022 * k, curve: 4 });
  };
  const whoosh = (out, t, dur = 0.35, k = 1) => {
    noise(out, t, { type: 'bandpass', f: 300, to: 3400, glide: dur * 0.9, dur, g: 0.22 * k, a: dur * 0.55, q: 0.7, curve: 2 });
  };
  const bell = (out, t, f, k = 1, dur = 1.5) => {
    tone(out, t, { f, dur, g: 0.2 * k, curve: 3.4 });
    tone(out, t, { f: f * 2.01, dur: dur * 0.7, g: 0.08 * k, curve: 3.6 });
    tone(out, t, { f: f * 3.42, dur: dur * 0.35, g: 0.045 * k, curve: 4 });
  };
  const N = (n) => 440 * 2 ** (n / 12);

  const BATTLE = {
    title(o, t) {
      whoosh(o, t, 0.28);
      taiko(o, t + 0.26);
      taiko(o, t + 0.5, 0.82);
      hit(o, t + 0.5, 0.45);
      noise(o, t + 0.5, { type: 'highpass', f: 5200, dur: 0.75, g: 0.05, curve: 2 });
    },
    slash(o, t) { slash(o, t, 1); },
    launch(o, t) {
      whoosh(o, t, 0.22, 1.3);
      taiko(o, t + 0.2);
      slash(o, t + 0.22, 0.6);
    },
    cut(o, t) {
      taiko(o, t, 1.2);
      noise(o, t, { type: 'highpass', f: 3000, to: 8000, dur: 0.07, g: 0.2 });
    },
    standoff(o, t) {
      /* one bar of a slow heartbeat over a drone: the loop re-enters every 2.4 seconds */
      tone(o, t, { f: 55, dur: 2.5, g: 0.11, a: 0.5, curve: 0.6, lp: 300 });
      tone(o, t, { f: 82.4, dur: 2.5, g: 0.05, a: 0.8, curve: 0.6, lp: 300 });
      tone(o, t + 0.12, { f: 62, to: 36, dur: 0.3, g: 0.34 });
      tone(o, t + 0.44, { f: 52, to: 30, dur: 0.34, g: 0.22 });
    },
    ac(o, t) {
      slash(o, t, 1.2);
      hit(o, t + 0.2, 1);
      [0, 7, 12, 16].forEach((n, i) => bell(o, t + 0.62 + i * 0.11, N(n - 2), 0.9, 1.3));
      taiko(o, t + 1.08, 0.8);
      bell(o, t + 1.08, N(22), 0.55, 1.5);
    },
    partial(o, t) {
      taiko(o, t);
      [0, 3, 7].forEach((n, i) => bell(o, t + 0.2 + i * 0.13, N(n - 7), 0.7, 0.9));
      bell(o, t + 0.75, N(-8), 0.5, 1.2);
    },
    wa(o, t) {
      hit(o, t, 0.8);
      tone(o, t + 0.18, { type: 'triangle', f: N(-15), to: N(-22), glide: 0.8, dur: 1.0, g: 0.2 });
      tone(o, t + 0.18, { type: 'triangle', f: N(-11), to: N(-19), glide: 0.8, dur: 1.0, g: 0.14 });
      taiko(o, t + 0.95, 0.72);
    },
    tle(o, t) {
      whoosh(o, t, 0.5, 1.2);
      for (let i = 0; i < 5; i++) tone(o, t + 0.1 + i * (0.13 + i * 0.03), { type: 'square', f: 2200 - i * 180, dur: 0.018, g: 0.11, lp: 5000 });
      tone(o, t + 1.05, { f: 1760, dur: 0.9, g: 0.09, curve: 4 });
      hit(o, t + 1.05, 0.6);
    },
    mle(o, t) {
      tone(o, t, { type: 'sawtooth', f: 90, to: 1300, glide: 1.1, dur: 1.15, g: 0.13, a: 0.1, curve: 0.5, lp: 2600 });
      for (let i = 0; i < 8; i++) tone(o, t + i * 0.13, { type: 'square', f: 900 + i * 130, dur: 0.03, g: 0.05, lp: 4000 });
      hit(o, t + 1.15, 1.1);
      noise(o, t + 1.15, { type: 'highpass', f: 1800, to: 600, dur: 0.8, g: 0.18 });
    },
    re(o, t) {
      tone(o, t, { type: 'square', f: 1000, dur: 0.06, g: 0.1, lp: 3000 });
      noise(o, t + 0.07, { type: 'bandpass', f: 2600, q: 0.3, dur: 0.5, g: 0.2, curve: 0.9 });
      tone(o, t + 0.6, { f: 1000, dur: 1.15, g: 0.11, a: 0.004, curve: 0.3 });
      hit(o, t + 0.05, 0.4);
    },
    ce(o, t) {
      noise(o, t, { type: 'highpass', f: 2600, to: 900, dur: 0.22, g: 0.1, a: 0.04 });
      taiko(o, t + 0.34, 1.05);
      noise(o, t + 0.34, { type: 'lowpass', f: 700, dur: 0.14, g: 0.3 });
      tone(o, t + 0.6, { type: 'triangle', f: N(-9), to: N(-12), dur: 0.5, g: 0.13 });
    },
    levelup(o, t) {
      whoosh(o, t, 0.75, 1.4);
      hit(o, t + 0.72, 1);
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => bell(o, t + 0.78 + i * 0.09, N(n - 5), 0.9, 1.6));
    },
  };

  /* A gentler set for late nights: the same moments, in chimes and soft thuds. */
  const QUIET = {
    title(o, t) { bell(o, t + 0.1, N(-5), 0.8, 1.2); bell(o, t + 0.34, N(2), 0.7, 1.4); },
    slash(o, t) { noise(o, t, { type: 'highpass', f: 3000, to: 7000, dur: 0.12, g: 0.1, a: 0.01 }); },
    launch(o, t) { bell(o, t, N(0), 0.7, 0.7); bell(o, t + 0.1, N(7), 0.6, 0.8); },
    cut(o, t) { bell(o, t, N(12), 0.5, 0.3); },
    standoff(o, t) { tone(o, t, { f: 110, dur: 2.5, g: 0.04, a: 0.8, curve: 0.5 }); },
    ac(o, t) { [0, 4, 7, 12].forEach((n, i) => bell(o, t + i * 0.12, N(n), 0.9, 1.4)); },
    partial(o, t) { [0, 4].forEach((n, i) => bell(o, t + i * 0.16, N(n), 0.8, 1)); },
    wa(o, t) { bell(o, t, N(-3), 0.9, 0.9); bell(o, t + 0.2, N(-7), 0.8, 1); },
    tle(o, t) { for (let i = 0; i < 3; i++) bell(o, t + i * 0.3, N(5), 0.5, 0.4); },
    mle(o, t) { bell(o, t, N(-2), 0.8, 0.5); bell(o, t + 0.2, N(-9), 0.8, 0.9); },
    re(o, t) { bell(o, t, N(-6), 0.9, 1); },
    ce(o, t) { tone(o, t, { f: 220, to: 170, dur: 0.3, g: 0.2 }); },
    levelup(o, t) { [0, 4, 7, 12, 16].forEach((n, i) => bell(o, t + i * 0.1, N(n), 0.9, 1.5)); },
  };

  const PACKS = { battle: BATTLE, quiet: QUIET };

  /* Judging repeats these for as long as it takes, so the built-in versions sit well below the verdicts. */
  const LEVEL = { cut: 0.3, standoff: 0.45, launch: 0.6 };

  function track(tag, handle) {
    if (!tag) return;
    if (!live.has(tag)) live.set(tag, new Set());
    live.get(tag).add(handle);
  }

  function playEvent(ev, volume, opts = {}) {
    context();
    const pack = PACKS[opts.pack] || BATTLE;
    const fn = pack[ev] || BATTLE[ev];
    if (!fn) return;
    const out = ac.createGain();
    out.gain.value = volume * (LEVEL[ev] || 1);
    out.connect(bus);
    const t = ac.currentTime + 0.02;
    fn(out, t);
    if (opts.loop) {
      const every = 2.4;
      const handle = { out, timer: null, stop: null };
      let next = t + every;
      handle.timer = setInterval(() => {
        while (next < ac.currentTime + 0.5) { fn(out, next); next += every; }
      }, 200);
      handle.stop = (fade) => {
        clearInterval(handle.timer);
        out.gain.setTargetAtTime(0, ac.currentTime, Math.max(0.01, fade || 0.05));
        setTimeout(() => out.disconnect(), 1500);
      };
      track(opts.tag, handle);
    }
  }

  function playBuffer(buffer, volume, opts = {}) {
    context();
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = !!opts.loop;
    const g = ac.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(bus);
    src.start();
    const handle = {
      stop: (fade) => {
        g.gain.setTargetAtTime(0, ac.currentTime, Math.max(0.01, fade || 0.05));
        try { src.stop(ac.currentTime + Math.max(0.05, (fade || 0.05) * 4)); } catch { /* already stopped */ }
      },
    };
    track(opts.tag, handle);
    src.addEventListener('ended', () => {
      const set = live.get(opts.tag);
      if (set) set.delete(handle);
    });
  }

  function stop(tag, fade) {
    const tags = tag ? [tag] : [...live.keys()];
    for (const t of tags) {
      const set = live.get(t);
      if (!set) continue;
      for (const h of set) h.stop(fade);
      live.delete(t);
    }
  }

  globalThis.QS_SYNTH = { context, playEvent, playBuffer, stop, packs: Object.keys(PACKS) };
})();
