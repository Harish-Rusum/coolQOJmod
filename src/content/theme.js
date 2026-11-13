/* theme.js: turns settings plus a scene into CSS variables on the page. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const api = QS.api;
  const root = document.documentElement;

  QS.FONTS = {
    display: {
      dela: { label: 'Dela Gothic (poster)', family: 'QS Dela Gothic', file: 'dela-gothic.woff2', weight: '400' },
      shippori: { label: 'Shippori Mincho (title card serif)', family: 'QS Shippori', file: 'shippori-mincho.woff2', weight: '400 800' },
      yuji: { label: 'Yuji Boku (brush)', family: 'QS Yuji', file: 'yuji-boku.woff2', weight: '400' },
      rocknroll: { label: 'RocknRoll (manga)', family: 'QS RocknRoll', file: 'rocknroll.woff2', weight: '400' },
      marublack: { label: 'Zen Maru Gothic (round)', family: 'QS Maru Black', file: 'zen-maru-black.woff2', weight: '400' },
      mochiy: { label: 'Mochiy Pop (bubbly)', family: 'QS Mochiy', file: 'mochiy-pop.woff2', weight: '400' },
      dot: { label: 'DotGothic16 (pixel)', family: 'QS Dot', file: 'dotgothic.woff2', weight: '400' },
      kurenaido: { label: 'Zen Kurenaido (pencil)', family: 'QS Kurenaido', file: 'zen-kurenaido.woff2', weight: '400' },
      klee: { label: 'Klee One (pen)', family: 'QS Klee', file: 'klee-one.woff2', weight: '400 900' },
    },
    body: {
      mona: { label: 'Mona Sans', family: 'QS Mona', file: 'mona-sans.woff2', weight: '200 900', stretch: '75% 125%' },
      stix: { label: 'STIX Two (serif)', family: 'QS Stix', file: 'stix-two.woff2', weight: '400 700' },
      maru: { label: 'Zen Maru Gothic (round)', family: 'QS Maru', file: 'zen-maru.woff2', weight: '400 900' },
      klee: { label: 'Klee One (pen)', family: 'QS Klee', file: 'klee-one.woff2', weight: '400 900' },
      dot: { label: 'DotGothic16 (pixel)', family: 'QS Dot', file: 'dotgothic.woff2', weight: '400 900' },
      kurenaido: { label: 'Zen Kurenaido (pencil)', family: 'QS Kurenaido', file: 'zen-kurenaido.woff2', weight: '400 900' },
      system: { label: 'System font', family: '' },
    },
    mono: {
      jetbrains: { label: 'JetBrains Mono', family: 'QS JetBrains', file: 'jetbrains-mono.woff2', weight: '100 800' },
      system: { label: 'System mono', family: '' },
    },
  };

  const CJK_SANS = '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK JP", "Hiragino Sans", sans-serif';
  const CJK_DISPLAY = '"Noto Sans CJK JP", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK SC", sans-serif';

  function fontFaces(S) {
    const rules = [];
    const face = (f) => {
      if (!f || !f.file) return;
      rules.push(`@font-face{font-family:"${f.family}";src:url("${api.runtime.getURL(`fonts/${f.file}`)}") format("woff2");font-weight:${f.weight || '400'};${f.stretch ? `font-stretch:${f.stretch};` : ''}font-display:swap;}`);
    };
    const display = QS.FONTS.display[S.type.display] || QS.FONTS.display.dela;
    const body = QS.FONTS.body[S.type.body] || QS.FONTS.body.mona;
    const mono = QS.FONTS.mono[S.type.mono] || QS.FONTS.mono.jetbrains;
    face(display);
    if (!display.file || body.file !== display.file) face(body); // a font used for both is declared once
    face(mono);
    /* math is always set in STIX, like a typeset statement */
    rules.push(`@font-face{font-family:"QS Math";src:url("${api.runtime.getURL('fonts/stix-two.woff2')}") format("woff2");font-weight:400 700;font-style:normal;font-display:swap;}`);
    rules.push(`@font-face{font-family:"QS Math";src:url("${api.runtime.getURL('fonts/stix-two-italic.woff2')}") format("woff2");font-weight:400 700;font-style:italic;font-display:swap;}`);
    return {
      css: rules.join('\n'),
      vars: {
        '--qs-display': `"${display.family}", ${CJK_DISPLAY}`,
        '--qs-body': body.family ? `"${body.family}", ${CJK_SANS}` : `system-ui, ${CJK_SANS}`,
        '--qs-mono': mono.family ? `"${mono.family}", ui-monospace, Menlo, Consolas, monospace` : 'ui-monospace, Menlo, Consolas, monospace',
      },
    };
  }

  function ensureStyle(id) {
    let n = document.getElementById(id);
    if (!n) {
      n = document.createElement('style');
      n.id = id;
      (document.head || root).append(n);
    }
    return n;
  }

  QS.sceneIdFor = (S, arc) => {
    if (S.scene.byArc && arc && arc !== 'none' && S.scene.arcs[arc]) return S.scene.arcs[arc];
    return S.scene.every;
  };

  QS.resolveScene = async (id) => {
    if (id && id.startsWith('custom:')) {
      const rec = await QS.get(`qs.art.${id.slice(7)}`);
      if (rec && rec.wall) return { id, url: rec.wall, small: rec.thumb, frost: rec.frost || {}, stats: rec.stats, ambient: rec.ambient || 'motes', name: rec.name || 'Your picture', custom: true };
    }
    const s = QS.SCENES[id] || QS.SCENES[QS.DEFAULTS.scene.every];
    const realId = QS.SCENES[id] ? id : QS.DEFAULTS.scene.every;
    const frost = {};
    for (const level of ['a', 'b', 'c']) frost[level] = api.runtime.getURL(`scenes/${realId}-frost-${level}.webp`);
    return { id: realId, url: api.runtime.getURL(`scenes/${realId}.webp`), small: api.runtime.getURL(`scenes/${realId}-thumb.webp`), frost, stats: s.stats, ambient: s.ambient, name: s.name };
  };

  let applySeq = 0;
  QS.applyTheme = async (S, arc) => {
    const seq = ++applySeq;
    const id = QS.sceneIdFor(S, arc);
    const scene = await QS.resolveScene(id);
    if (seq !== applySeq) return QS.theme;
    const solved = QS.solveTheme(scene.stats, S.glass);
    const fonts = fontFaces(S);
    ensureStyle('qs-fonts').textContent = fonts.css;
    const tune = S.scene.tune[scene.id] || {};
    const frostPx = S.glass.frost === undefined ? 14 : S.glass.frost;
    const frostLevel = frostPx < 4 ? null : frostPx <= 12 ? 'a' : frostPx <= 26 ? 'b' : 'c';
    const frostUrl = frostLevel && scene.frost ? scene.frost[frostLevel] : null;
    const vars = {
      ...solved.vars,
      ...fonts.vars,
      '--qs-wall': `url("${scene.url}")`,
      '--qs-wall-small': scene.small ? `url("${scene.small}")` : `url("${scene.url}")`,
      '--qs-wall-frost': frostUrl ? `url("${frostUrl}")` : (frostPx < 4 ? 'var(--qs-wall)' : 'none'),
      '--qs-scene-x': `${tune.x === undefined ? 50 : tune.x}%`,
      '--qs-scene-y': `${tune.y === undefined ? 50 : tune.y}%`,
      '--qs-scene-zoom': String((tune.zoom === undefined ? 100 : tune.zoom) / 100),
      '--qs-scene-filter': `brightness(${(tune.bright === undefined ? 100 : tune.bright) / 100}) saturate(${(tune.sat === undefined ? 100 : tune.sat) / 100})`,
      '--qs-statement-size': `${S.type.size}px`,
      '--qs-statement-width': `${S.type.width}ch`,
      '--qs-speed': String(S.moments.speed || 1),
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.setAttribute('data-qs-mode', solved.mode);
    root.setAttribute('data-qs-style', S.look.style);
    root.setAttribute('data-qs-view', S.look.view);
    root.style.colorScheme = solved.mode;
    ensureStyle('qs-custom').textContent = S.customCss || '';
    const previous = QS.theme;
    QS.theme = { solved, scene, arc: arc || 'none' };
    if (!QS.env || !QS.env.preview) QS.writeMirror(S, vars);
    document.dispatchEvent(new CustomEvent('qs:theme', { detail: { previous } }));
    return QS.theme;
  };

  /* A synchronous copy of what the first paint needs, because the extension's storage is asynchronous. */
  QS.writeMirror = (S, vars) => {
    try {
      const small = {};
      for (const [k, v] of Object.entries(vars)) {
        if (k.startsWith('--qs-wall') && v.length > 400) continue;
        small[k] = v;
      }
      localStorage.setItem('qs:mirror', JSON.stringify({
        on: S.on, vars: small, mode: QS.theme && QS.theme.solved.mode, style: S.look.style, view: S.look.view,
        title: S.moments.title && S.moments.titleWhen !== 'never', when: S.moments.titleWhen,
      }));
    } catch { /* private mode: first paint simply waits for storage */ }
  };

  /* ---------------------------------------------------------------------- readable rating colours */

  const CACHE = new Map();
  let cacheKey = '';
  const parseRgb = (s) => {
    const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s || '');
    if (m) return [+m[1], +m[2], +m[3]];
    return QS.color.fromHex(s);
  };

  QS.Inks = {
    selector: '.uoj-username, .uoj-score, .uoj-status, .uoj-honor',
    fixOne(el) {
      if (!QS.theme) return;
      const key = el.dataset.qsInk || el.style.color;
      if (!key) return;
      const rgb = parseRgb(key);
      if (!rgb) return;
      const dark = QS.theme.solved.mode === 'dark';
      const bg = QS.theme.solved.bgForText;
      const tag = `${cacheKey}|${key}`;
      let out = CACHE.get(tag);
      if (!out) {
        out = QS.inkFor(rgb, bg, dark, 4.5);
        CACHE.set(tag, out);
      }
      if (!el.dataset.qsInk) el.dataset.qsInk = key;
      el.style.setProperty('color', out, 'important');
    },
    scan(rootNode) {
      const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;
      scope.querySelectorAll(this.selector).forEach((n) => this.fixOne(n));
      if (rootNode && rootNode.matches && rootNode.matches(this.selector)) this.fixOne(rootNode);
    },
    start() {
      cacheKey = QS.theme ? `${QS.theme.solved.vars['--qs-scrim']}|${QS.theme.solved.report.panel}` : '';
      this.scan(document);
      if (this.observer) return;
      let queued = false;
      this.observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; this.scan(document); });
      });
      const target = document.querySelector('.uoj-content') || document.body;
      if (target) this.observer.observe(target, { childList: true, subtree: true });
      document.addEventListener('qs:theme', () => {
        cacheKey = QS.theme ? `${QS.theme.solved.vars['--qs-scrim']}|${QS.theme.solved.report.panel}` : '';
        this.scan(document);
      });
    },
  };

  /* ---------------------------------------------------------------------------- ambient particles */

  const KINDS = {
    petals: { n: 26, size: [5, 13], fall: [0.25, 0.7], sway: 1, spin: 1, colors: ['#ffc4dc', '#ff9fc6', '#ffe0ec'] },
    embers: { n: 30, size: [1.2, 3.2], fall: [-0.7, -0.25], sway: 0.6, spin: 0, colors: ['#ff9d4d', '#ff6a3d', '#ffd27a'], glow: true },
    motes: { n: 26, size: [1, 2.6], fall: [-0.14, 0.14], sway: 0.5, spin: 0, colors: ['#ffffff', '#ffeeba', '#d7e8ff'], glow: true },
    snow: { n: 60, size: [1.4, 3.6], fall: [0.4, 1.1], sway: 0.7, spin: 0, colors: ['#ffffff', '#e6f0ff'] },
    rain: { n: 90, size: [10, 22], fall: [7, 11], sway: 0, spin: 0, colors: ['#bcd4ff'], streak: true },
    leaves: { n: 18, size: [6, 13], fall: [0.35, 0.85], sway: 1.2, spin: 1, colors: ['#e8703a', '#d8452e', '#f2a23c'] },
    stars: { n: 34, size: [3, 8], fall: [0.1, 0.4], sway: 0.6, spin: 0, colors: ['#ffffff', '#ffd6ec', '#fff3a8', '#d6ccff'], star: true },
    fireflies: { n: 22, size: [1.4, 2.8], fall: [-0.1, 0.1], sway: 0.8, spin: 0, colors: ['#e9ff8a', '#c9ff6b'], glow: true, blink: true },
  };

  QS.Ambient = {
    canvas: null, raf: 0, parts: [], kind: null, last: 0,
    stop() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.canvas) { this.canvas.remove(); this.canvas = null; }
    },
    start(S) {
      this.S = S;
      const scene = QS.theme && QS.theme.scene;
      const wanted = S.motion.ambient === 'auto' ? (scene && scene.ambient) || 'motes' : S.motion.ambient;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (wanted === 'none' || reduced || !KINDS[wanted]) { this.stop(); return; }
      this.kind = wanted;
      if (!this.canvas) {
        this.canvas = QS.el('canvas', { id: 'qs-ambient', 'aria-hidden': 'true' });
        document.body.append(this.canvas);
        addEventListener('resize', () => this.size());
        document.addEventListener('visibilitychange', () => this.loop());
      }
      this.canvas.classList.toggle('qs-front', !!S.motion.front);
      this.size();
      this.seed();
      this.loop();
    },
    size() {
      if (!this.canvas) return;
      const r = Math.min(devicePixelRatio || 1, 1.5);
      this.canvas.width = innerWidth * r;
      this.canvas.height = innerHeight * r;
      this.r = r;
    },
    seed() {
      const k = KINDS[this.kind];
      const count = Math.round(k.n * (this.S.motion.density / 50));
      const rnd = (a, b) => a + Math.random() * (b - a);
      this.parts = Array.from({ length: count }, () => ({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        s: rnd(k.size[0], k.size[1]), v: rnd(k.fall[0], k.fall[1]),
        p: Math.random() * 6.28, q: rnd(0.3, 1.2), r: Math.random() * 6.28,
        c: k.colors[Math.floor(Math.random() * k.colors.length)], d: rnd(0.45, 1),
      }));
    },
    loop() {
      cancelAnimationFrame(this.raf);
      if (!this.canvas || document.hidden) return;
      const k = KINDS[this.kind];
      const ctx = this.canvas.getContext('2d');
      const step = (now) => {
        this.raf = requestAnimationFrame(step);
        if (now - this.last < 30) return;
        const dt = Math.min(3, (now - this.last) / 16.7);
        this.last = now;
        const speed = this.S.motion.speed / 50;
        ctx.setTransform(this.r, 0, 0, this.r, 0, 0);
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of this.parts) {
          p.p += 0.012 * dt * p.q * speed;
          p.y += p.v * dt * speed * p.d;
          p.x += Math.sin(p.p) * k.sway * dt * speed * 0.5 + (k.streak ? -1.1 * dt * speed : 0.1 * k.sway * dt * speed);
          p.r += 0.02 * k.spin * dt * p.q * speed;
          if (p.y > innerHeight + 30) { p.y = -30; p.x = Math.random() * innerWidth; }
          if (p.y < -30) { p.y = innerHeight + 30; p.x = Math.random() * innerWidth; }
          if (p.x < -30) p.x = innerWidth + 30;
          if (p.x > innerWidth + 30) p.x = -30;
          ctx.globalAlpha = (k.blink ? 0.25 + 0.75 * Math.abs(Math.sin(p.p * 3)) : 0.85) * p.d;
          ctx.fillStyle = p.c;
          ctx.strokeStyle = p.c;
          if (k.star) {
            const size = p.s * (0.7 + 0.3 * Math.abs(Math.sin(p.p * 2)));
            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
              const a = (i * Math.PI) / 4;
              const r = i % 2 ? size * 0.28 : size;
              ctx[i ? 'lineTo' : 'moveTo'](p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
            }
            ctx.closePath();
            ctx.fill();
          } else if (k.streak) {
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.28 * p.d;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.s * 0.14, p.y + p.s);
            ctx.stroke();
          } else if (k.spin) {
            const scaleY = 0.35 + 0.65 * Math.abs(Math.cos(p.r * 1.4));
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.r);
            ctx.scale(1, scaleY);
            ctx.beginPath();
            ctx.moveTo(0, -p.s * 0.55);
            ctx.bezierCurveTo(p.s * 0.55, -p.s * 0.45, p.s * 0.5, p.s * 0.35, 0, p.s * 0.55);
            ctx.bezierCurveTo(-p.s * 0.5, p.s * 0.35, -p.s * 0.55, -p.s * 0.45, 0, -p.s * 0.55);
            ctx.fill();
            ctx.restore();
          } else {
            if (k.glow) {
              ctx.globalAlpha *= 0.28;
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.s * 2.6, 0, 6.29);
              ctx.fill();
              ctx.globalAlpha /= 0.28;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.s, 0, 6.29);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      };
      this.raf = requestAnimationFrame(step);
    },
  };
})();
