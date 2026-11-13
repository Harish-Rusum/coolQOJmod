/* solve.js: makes any picture usable as a theme.

   The art decides the look, and a little arithmetic decides whether you can read on top of it. Glass is a
   colour laid over the picture. Text contrast depends on how opaque that colour is and on the worst pixel
   under it, so the opacity is solved rather than guessed: the thinnest glass where the hardest rating colour
   still clears 4.5:1 over the picture's extreme pixels. The visibility slider only moves the glass opacity:
   solid at 0, that floor at 100, thinner than it past 100. Colours are always solved against the floor, so
   they stay the same at every setting. */
(() => {
  'use strict';
  const QS = (globalThis.QS = globalThis.QS || {});

  const linear = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (rgb) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (top, alpha, under) => top.map((c, i) => c * alpha + under[i] * (1 - alpha));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function rgbToHsl([r, g, b]) {
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    return [h * 60, s, l];
  }

  function hslToRgb([h, s, l]) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return [f(0), f(8), f(4)];
  }

  const hex = (rgb) => `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
  const fromHex = (s) => {
    const m = /^#?([0-9a-f]{6})$/i.exec((s || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const triple = (rgb) => rgb.map((c) => Math.round(c)).join(' ');

  /* Thinnest glass over `pixel` at which `ink` clears `target`. */
  function floorAlpha(scrim, pixel, ink, target) {
    let lo = 0, hi = 1;
    if (contrast(ink, mix(scrim, 1, pixel)) < target) return 1;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2;
      if (contrast(ink, mix(scrim, m, pixel)) >= target) hi = m; else lo = m;
    }
    return hi;
  }

  /* Same hue, only lightness moves, until it clears `target` against `bg`. */
  function readable(rgb, bg, target, dark) {
    if (contrast(rgb, bg) >= target) return rgb;
    const [h, s, l] = rgbToHsl(rgb);
    const sat = Math.max(s, 0);
    let lo = dark ? l : 0, hi = dark ? 1 : l;
    let best = dark ? [255, 255, 255] : [0, 0, 0];
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2;
      const c = hslToRgb([h, sat, m]);
      if (contrast(c, bg) >= target) {
        best = c;
        if (dark) hi = m; else lo = m;
      } else if (dark) lo = m; else hi = m;
    }
    return best;
  }

  const HARD_INK = { dark: [255, 106, 106], light: [214, 112, 0] };

  QS.solveTheme = function solveTheme(stats, opts = {}) {
    const meanLum = stats.meanLum === undefined ? lum(stats.mean) : stats.meanLum;
    const mode = opts.mode === 'auto' || !opts.mode ? (meanLum >= 0.42 ? 'light' : 'dark') : opts.mode;
    const dark = mode === 'dark';
    const hue = rgbToHsl(stats.accent || stats.mean)[0];
    const base = rgbToHsl(stats.tone || stats.mean);
    const scrim = dark
      ? hslToRgb([base[0], Math.min(0.42, base[1] * 0.7 + 0.08), 0.06])
      : hslToRgb([base[0], Math.min(0.3, base[1] * 0.5 + 0.06), 0.96]);

    const fixedScrim = fromHex(opts.scrim);
    const scrimFinal = fixedScrim || scrim;
    const frosted = (opts.frost === undefined ? 14 : opts.frost) >= 4;
    const worst = dark ? (frosted && stats.hiBlur ? stats.hiBlur : stats.hi) : (frosted && stats.loBlur ? stats.loBlur : stats.lo);
    const sharpWorst = dark ? stats.hi : stats.lo;
    const inkHard = HARD_INK[mode];
    const textMain = dark ? [243, 240, 247] : [28, 22, 36];

    const floor = Math.max(floorAlpha(scrimFinal, worst, inkHard, 4.5), floorAlpha(scrimFinal, worst, textMain, 7));
    const raw = clamp(opts.visibility === undefined ? 80 : opts.visibility, 0, 200) / 100;
    const vis = Math.min(1, raw);
    /* Past 100 the glass thins below the solved floor on request, down to 15% of it at 200. */
    const beyond = Math.max(0, raw - 1);
    const panel = (floor + (0.98 - floor) * (1 - vis)) * (1 - 0.85 * beyond);
    const statement = Math.min(0.98, panel + (0.98 - panel) * 0.06);
    const card = Math.min(0.98, panel + (0.98 - panel) * 0.2);
    const navFloor = floorAlpha(scrimFinal, sharpWorst, textMain, 4.5);
    const nav = Math.min(0.97, Math.max(navFloor, 0.9));
    const heroFloor = floorAlpha(scrimFinal, sharpWorst, textMain, 3.2);
    const hero = Math.max(heroFloor * 0.92, 0.18 + (0.8 - 0.18) * (1 - vis)) * (1 - 0.85 * beyond);

    const under = mix(scrimFinal, panel, worst);
    const raised = mix(scrimFinal, floor, sharpWorst);
    const floorUnder = mix(scrimFinal, floor, worst);
    const bgForText = dark ? (lum(floorUnder) > lum(raised) ? floorUnder : raised) : (lum(floorUnder) < lum(raised) ? floorUnder : raised);

    const text2 = readable(dark ? [203, 197, 214] : [68, 60, 80], bgForText, 5.5, dark);
    const text3 = readable(dark ? [165, 158, 180] : [100, 92, 112], bgForText, 4.5, dark);

    const accentIn = fromHex(opts.accent) || stats.accent || hslToRgb([hue, 0.8, 0.7]);
    const accent2In = fromHex(opts.accent2) || stats.accent2 || hslToRgb([(hue + 40) % 360, 0.7, 0.7]);
    const accent = readable(accentIn, bgForText, 4.6, dark);
    const accent2 = readable(accent2In, bgForText, 4.6, dark);
    const accentInk = contrast([255, 255, 255], accent) > contrast([14, 10, 20], accent) ? [255, 255, 255] : [14, 10, 20];
    const ok = readable([74, 222, 128], bgForText, 4.5, dark);
    const bad = readable([255, 106, 106], bgForText, 4.5, dark);
    const warn = readable([250, 190, 80], bgForText, 4.5, dark);
    const info = readable([125, 180, 255], bgForText, 4.5, dark);

    const lineBase = dark ? '255 255 255' : '20 12 30';
    const desk = hex(hslToRgb([base[0], Math.min(0.42, base[1] * 0.7 + 0.08), dark ? 0.04 : 0.93]));

    return {
      mode,
      bgForText,
      vars: {
        '--qs-desk': desk,
        '--qs-scrim': triple(scrimFinal),
        '--qs-a-panel': panel.toFixed(3),
        '--qs-a-statement': statement.toFixed(3),
        '--qs-a-card': card.toFixed(3),
        '--qs-a-nav': nav.toFixed(3),
        '--qs-a-hero': hero.toFixed(3),
        '--qs-text': hex(textMain),
        '--qs-text2': hex(text2),
        '--qs-text3': hex(text3),
        '--qs-accent': hex(accent),
        '--qs-accent-rgb': triple(accent),
        '--qs-accent-ink': hex(accentInk),
        '--qs-accent2': hex(accent2),
        '--qs-ok': hex(ok),
        '--qs-ok-rgb': triple(ok),
        '--qs-bad': hex(bad),
        '--qs-bad-rgb': triple(bad),
        '--qs-warn': hex(warn),
        '--qs-warn-rgb': triple(warn),
        '--qs-info': hex(info),
        '--qs-info-rgb': triple(info),
        '--qs-line-rgb': lineBase,
        '--qs-frost': `${Math.round(opts.frost === undefined ? 14 : opts.frost)}px`,
        '--qs-radius': `${Math.round(opts.radius === undefined ? 14 : opts.radius)}px`,
        '--qs-ink-filter': dark ? 'invert(1) hue-rotate(180deg)' : 'none',
      },
      report: {
        floor: +floor.toFixed(3),
        panel: +panel.toFixed(3),
        text: +contrast(textMain, under).toFixed(2),
        red: +contrast(inkHard, under).toFixed(2),
        accent: +contrast(accent, under).toFixed(2),
      },
    };
  };

  /* Reads a rating or score colour against the solved glass and returns one that stays readable. */
  QS.inkFor = function inkFor(rgb, bg, dark, target = 4.5) {
    return hex(readable(rgb, bg, target, dark));
  };

  /* Picture analysis for the Studio: percentiles of luminance plus a few candidate accents. */
  QS.analyzePixels = function analyzePixels(data, blurData) {
    const lums = [];
    let r = 0, g = 0, b = 0, n = 0;
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      r += R; g += G; b += B; n++;
      lums.push({ l: 0.2126 * R + 0.7152 * G + 0.0722 * B, R, G, B });
      const [h, s, l] = rgbToHsl([R, G, B]);
      if (s > 0.32 && l > 0.22 && l < 0.86) {
        const k = Math.round(h / 20);
        const e = buckets.get(k) || { w: 0, R: 0, G: 0, B: 0, s: 0 };
        const w = s * s * (1 - Math.abs(l - 0.58));
        e.w += w; e.R += R * w; e.G += G * w; e.B += B * w; e.s += s * w;
        buckets.set(k, e);
      }
    }
    lums.sort((p, q) => p.l - q.l);
    const at = (p) => { const e = lums[Math.min(lums.length - 1, Math.floor(p * lums.length))]; return [e.R, e.G, e.B]; };
    const mean = [r / n, g / n, b / n];
    const ranked = [...buckets.entries()].sort((p, q) => q[1].w - p[1].w).map(([k, e]) => ({ k, c: [e.R / e.w, e.G / e.w, e.B / e.w] }));
    const vivid = (c) => {
      const [h, s] = rgbToHsl(c);
      return hslToRgb([h, Math.max(0.72, s), 0.7]);
    };
    const accent = ranked.length ? vivid(ranked[0].c) : hslToRgb([rgbToHsl(mean)[0], 0.75, 0.72]);
    const second = ranked.find((e) => Math.min(Math.abs(e.k - ranked[0].k), 18 - Math.abs(e.k - ranked[0].k)) >= 3);
    const accent2 = second ? vivid(second.c) : hslToRgb([(rgbToHsl(accent)[0] + 45) % 360, 0.72, 0.72]);
    const out = {
      mean: mean.map(Math.round),
      meanLum: +lum(mean).toFixed(4),
      hi: at(0.999),
      lo: at(0.001),
      tone: mean.map(Math.round),
      accent: accent.map(Math.round),
      accent2: accent2.map(Math.round),
    };
    if (blurData) {
      const bl = [];
      for (let i = 0; i < blurData.length; i += 4) bl.push({ l: 0.2126 * blurData[i] + 0.7152 * blurData[i + 1] + 0.0722 * blurData[i + 2], R: blurData[i], G: blurData[i + 1], B: blurData[i + 2] });
      bl.sort((p, q) => p.l - q.l);
      const pick = (p) => { const e = bl[Math.min(bl.length - 1, Math.floor(p * bl.length))]; return [e.R, e.G, e.B]; };
      out.hiBlur = pick(0.999);
      out.loBlur = pick(0.001);
    }
    return out;
  };

  QS.color = { lum, contrast, mix, rgbToHsl, hslToRgb, hex, fromHex, readable };
})();
