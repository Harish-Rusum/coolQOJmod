/* moments.js: the cutscenes. A title card when a problem opens, the broadcast while the judge runs, a scene for
   each verdict. All of them are skippable with any key or click, and none of them invent anything: every word
   on screen is a fact from the page or a label set in the Studio. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const { el } = QS;
  const FX = QS.FX;
  const root = document.documentElement;

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speed = () => (QS.S && QS.S.moments.speed) || 1;
  const words = () => QS.S.words;

  QS.sfx = (ev, opts = {}) => {
    try { QS.api.runtime.sendMessage({ qs: 'sfx', ev, ...opts }).catch(() => {}); } catch { /* extension reloaded */ }
  };
  QS.sfxStop = (tag, fade) => {
    try { QS.api.runtime.sendMessage({ qs: 'sfx-stop', tag, fade }).catch(() => {}); } catch { /* extension reloaded */ }
  };

  /* A contest page keeps its clock element after the contest ends, it just stays empty. Only a running clock means live. */
  QS.liveClock = () => {
    if (QS.site.live) return QS.site.live();
    if (!QS.route || !QS.route.contest) return null;
    const clock = document.querySelector('#contest-countdown');
    return clock && /\d/.test(clock.textContent) ? clock : null;
  };

  /* ------------------------------------------------------------------------------------- plumbing */

  let current = null;

  function begin(cls) {
    if (current) current.end();
    const node = el('div', { class: `qs-mo ${cls}${reduced() ? ' is-still' : ''}`, 'aria-hidden': 'true' });
    const state = {
      node,
      done: false,
      onEnd: [],
      resolve: null,
      end() {
        if (state.done) return;
        state.done = true;
        removeEventListener('keydown', state.skip, true);
        node.removeEventListener('click', state.skip);
        node.remove();
        state.onEnd.forEach((f) => f());
        if (current === state) current = null;
        if (state.resolve) state.resolve();
      },
      skip(e) {
        if (e && e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        state.end();
      },
      finished: null,
    };
    state.finished = new Promise((res) => { state.resolve = res; });
    addEventListener('keydown', state.skip, true);
    node.addEventListener('click', state.skip);
    (document.body || root).append(node);
    root.removeAttribute('data-qs-cover');
    current = state;
    /* a hidden tab or a stuck frame must never leave a black screen */
    state.deadline = setTimeout(() => state.end(), 9000 / speed());
    state.onEnd.push(() => clearTimeout(state.deadline));
    return state;
  }

  const wait = (st, ms) => new Promise((res) => {
    if (st.done) return res(false);
    const id = setTimeout(() => res(!st.done), ms / speed());
    st.onEnd.push(() => { clearTimeout(id); res(false); });
    return undefined;
  });

  function kick(node, cls = 'qs-kick') {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    /* a finished flash must leave nothing behind */
    node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
  }

  const easeOut = (u) => 1 - (1 - u) ** 3;

  function loop(st, fn) {
    let raf = 0;
    const start = performance.now();
    const step = (now) => {
      if (st.done) return;
      raf = requestAnimationFrame(step);
      fn((now - start) * speed(), now);
    };
    raf = requestAnimationFrame(step);
    st.onEnd.push(() => cancelAnimationFrame(raf));
    return () => cancelAnimationFrame(raf);
  }

  async function fontsReady() {
    try {
      await Promise.race([
        document.fonts.load(`400 40px ${getComputedStyle(root).getPropertyValue('--qs-display').split(',')[0]}`, '第話編完つづく'),
        new Promise((r) => setTimeout(r, 300)),
      ]);
    } catch { /* falls back to the next font in the stack */ }
  }

  const accent = () => getComputedStyle(root).getPropertyValue('--qs-accent').trim() || '#ffffff';
  const subtitle = (text) => el('div', { class: 'qs-subtitle', text });
  const bars = () => [el('div', { class: 'qs-bar-top' }), el('div', { class: 'qs-bar-bottom' })];

  /* ----------------------------------------------------------------------------------- title card */

  async function titleCard(ep) {
    const st = begin('qs-tc');
    await fontsReady();
    if (st.done) return;
    const W = innerWidth, H = innerHeight;
    const words0 = words();
    const arc = words0.arcs[ep.arc] || words0.arcs.none;
    const img = await FX.loadImage(QS.theme.scene.url);
    if (st.done) return;

    const art = FX.makeCanvas(W, H);
    const mask = FX.makeCanvas(W, H);
    const fx = FX.makeCanvas(W, H);
    art.c.className = 'qs-tc-art';
    fx.c.className = 'qs-tc-fx';
    const no = el('div', { class: 'qs-tc-no', text: ep.label });
    const title = el('div', { class: 'qs-tc-title', text: ep.title });
    const sub = el('div', { class: 'qs-tc-sub' }, el('span', { class: 'qs-tc-arc', text: arc.jp }), [ep.time, ep.memory].filter(Boolean).join('   '));
    const text = el('div', { class: 'qs-tc-text' }, no, title, sub);
    const flash = el('div', { class: 'qs-flash' });
    st.node.append(art.c, text, fx.c, flash);

    const cutFrom = [0, H * 0.84], cutTo = [W, H * 0.14];
    const strokes = [
      FX.makeBrush([-W * 0.08, H * 0.74, W * 0.25, H * 0.82, W * 0.7, H * 0.42, W * 1.1, H * 0.2], H * 0.66, 3),
      FX.makeBrush([W * 1.08, H * 0.74, W * 0.8, H * 0.82, W * 0.45, H * 0.95, -W * 0.05, H * 0.98], H * 0.2, 7),
      FX.makeBrush([-W * 0.05, H * 0.12, W * 0.2, H * 0.02, W * 0.4, H * 0.04, W * 0.62, -H * 0.04], H * 0.16, 11),
    ];
    const spans = [[60, 520], [340, 760], [240, 620]];
    let lastT = strokes.map(() => 0);
    const burst = [];
    let focus = 0;
    let lastDraw = -1;
    const accentColor = accent();
    const reduce = reduced();

    QS.sfx('title');
    if (reduce) {
      strokes.forEach((s) => FX.paintBrush(mask.ctx, s, 0, 1));
      art.ctx.drawImage(mask.c, 0, 0, W, H);
      art.ctx.globalCompositeOperation = 'source-in';
      FX.drawCover(art.ctx, img, W, H, 1.04);
      art.ctx.globalCompositeOperation = 'source-over';
      no.classList.add('in'); title.classList.add('in'); sub.classList.add('in');
      await wait(st, 1300);
      st.end();
      return;
    }

    const stopLoop = loop(st, (ms) => {
      strokes.forEach((s, i) => {
        const [a, b] = spans[i];
        const u = FX.clamp01((ms - a) / (b - a));
        const t = easeOut(u);
        if (t > lastT[i]) {
          FX.paintBrush(mask.ctx, s, lastT[i], t);
          lastT[i] = t;
        }
      });
      const zoom = 1.04 + (ms / 2000) * 0.05;
      art.ctx.globalCompositeOperation = 'source-over';
      art.ctx.clearRect(0, 0, W, H);
      art.ctx.drawImage(mask.c, 0, 0, W, H);
      art.ctx.globalCompositeOperation = 'source-in';
      FX.drawCover(art.ctx, img, W, H, zoom, 0.5 + (ms / 2000) * 0.03, 0.5);
      art.ctx.globalCompositeOperation = 'source-over';

      /* lines redrawn on twos */
      const frame = Math.floor(ms / 83);
      if (frame !== lastDraw || burst.length) {
        lastDraw = frame;
        fx.ctx.clearRect(0, 0, W, H);
        if (focus > 0) {
          FX.focusLines(fx.ctx, W, H, W * 0.28, H * 0.55, Math.min(W, H) * 0.34, '#ffffff', 70, Math.min(1, focus));
          focus -= 0.36;
        }
        FX.drawParticles(fx.ctx, burst);
      }
    });

    if (!(await wait(st, 270))) return;
    no.classList.add('in');
    const noBox = no.getBoundingClientRect();
    FX.inkBurst(burst, noBox.left + noBox.width * 0.6, noBox.top + noBox.height / 2, accentColor, 34, 1);
    focus = 1;
    kick(flash, 'qs-flash-on');
    if (!(await wait(st, 240))) return;
    title.classList.add('in');
    const tBox = title.getBoundingClientRect();
    FX.inkBurst(burst, tBox.left + tBox.width * 0.75, tBox.top + tBox.height / 2, '#ffffff', 46, 1.25);
    focus = 1.2;
    kick(st.node, 'qs-shake');
    if (!(await wait(st, 260))) return;
    sub.classList.add('in');
    if (!(await wait(st, 950))) return;

    /* the cut: one line across the frame, then the frame comes apart along it */
    QS.sfx('slash');
    const line = FX.makeCanvas(W, H);
    line.c.className = 'qs-tc-line';
    st.node.append(line.c);
    const dx = cutTo[0] - cutFrom[0];
    const dy = cutTo[1] - cutFrom[1];
    for (let i = 1; i <= 5; i++) {
      line.ctx.clearRect(0, 0, W, H);
      FX.bladeStroke(line.ctx, cutFrom[0] - dx * 0.02, cutFrom[1] - dy * 0.02, cutTo[0] + dx * 0.02, cutTo[1] + dy * 0.02, 9, '#ffffff', i / 5);
      if (!(await wait(st, 18))) return;
    }
    stopLoop();
    kick(flash, 'qs-flash-on');
    const shot = FX.makeCanvas(W, H);
    shot.ctx.fillStyle = '#000';
    shot.ctx.fillRect(0, 0, W, H);
    shot.ctx.drawImage(art.c, 0, 0, W, H);
    const half = (poly, tx, ty, rot) => {
      const copy = FX.makeCanvas(W, H);
      copy.ctx.drawImage(shot.c, 0, 0, W, H);
      const part = el('div', { class: 'qs-half', style: { clipPath: `polygon(${poly})`, '--tx': `${tx}px`, '--ty': `${ty}px`, '--rot': `${rot}deg` } }, copy.c, text.cloneNode(true));
      return part;
    };
    const nx = -dy / Math.hypot(dx, dy), ny = dx / Math.hypot(dx, dy);
    const far = Math.hypot(W, H) * 0.75;
    const top = half(`0 0, ${W}px 0, ${W}px ${cutTo[1]}px, 0 ${cutFrom[1]}px`, nx * far * -1 + (dx / Math.hypot(dx, dy)) * 60, ny * far * -1, -3);
    const bottom = half(`0 ${cutFrom[1]}px, ${W}px ${cutTo[1]}px, ${W}px ${H}px, 0 ${H}px`, nx * far - (dx / Math.hypot(dx, dy)) * 60, ny * far, 3);
    art.c.remove(); text.remove(); fx.c.remove();
    st.node.classList.add('qs-tc-open');
    st.node.append(top, bottom);
    line.c.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => { top.classList.add('go'); bottom.classList.add('go'); }));
    await wait(st, 520);
    st.end();
  }

  /* ------------------------------------------------------------------------------------ launching */

  /* Press Submit: a cut-in crosses the screen while the browser sends the form. */
  function launch(ctx) {
    if (!QS.S.moments.broadcast) return;
    const st = begin('qs-launch');
    QS.sfx('launch');
    const [top, bottom] = bars();
    bottom.append(subtitle(ctx.title || ''));
    st.node.append(wallArt('qs-dim-art'), el('div', { class: 'qs-launch-band' }, el('span', { class: 'qs-launch-jp', text: words().cut.launch })), top, bottom);
    /* the next page picks this up; this overlay simply stays until the page goes away */
    st.onEnd.push(() => {});
  }

  /* ------------------------------------------------------------------------------------ broadcast */

  const Broadcast = {
    active: false,
    open: false,
    ctx: null,
    tests: 0,

    start(ctx, opts = {}) {
      this.ctx = ctx;
      this.active = true;
      this.tests = 0;
      this.ensureStrip();
      this.setText('Waiting for the judge');
      const wantShow = QS.S.moments.broadcast && !opts.stripOnly && !reduced();
      if (wantShow) this.show();
      if (!opts.silent) QS.sfx('standoff', { loop: true, tag: 'standoff' });
    },

    ensureStrip() {
      if (this.strip) return;
      this.stripText = el('span', { class: 'qs-strip-text' });
      this.stripTicks = el('span', { class: 'qs-ticks' });
      this.strip = el('div', { class: 'qs-strip qs-added', role: 'status', onclick: () => this.show() },
        el('span', { class: 'qs-strip-jp', text: words().cut.judging }),
        this.stripText,
        this.stripTicks,
        el('span', { class: 'qs-strip-run', 'aria-hidden': 'true' }, el('i')));
      document.body.append(this.strip);
    },

    show() {
      if (this.open || !this.active) return;
      const st = begin('qs-br');
      /* the broadcast may wait for a long time: it has no deadline of its own */
      clearTimeout(st.deadline);
      this.st = st;
      this.open = true;
      this.strip.classList.add('qs-hide');
      const W = innerWidth, H = innerHeight;
      const fx = FX.makeCanvas(W, H, 1);
      fx.c.className = 'qs-br-fx';
      this.subline = subtitle(this.text || '');
      this.count = el('div', { class: 'qs-br-count' }, el('span', { class: 'qs-br-word', text: 'TEST' }), this.num = el('span', { class: 'qs-br-num', text: this.tests ? String(this.tests) : '0' }));
      this.ticks = el('div', { class: 'qs-ticks qs-br-ticks' });
      this.syncTicks();
      const [top, bottom] = bars();
      top.append(el('span', { class: 'qs-br-jp', text: words().cut.judging }), el('span', { class: 'qs-br-no', text: this.ctx.label || '' }), el('span', { class: 'qs-br-ep', text: this.ctx.title || '' }));
      bottom.append(this.ticks, this.subline);
      const art = el('div', { class: 'qs-br-art' });
      st.node.append(art, fx.c, this.count, top, bottom);
      st.onEnd.push(() => {
        this.open = false;
        if (this.strip) this.strip.classList.remove('qs-hide');
      });
      /* the lines hold still and only change when a test does, so nothing flickers while you wait */
      this.drawLines = () => {
        const heat = Math.min(1, this.tests / 30);
        fx.ctx.clearRect(0, 0, W, H);
        FX.focusLines(fx.ctx, W, H, W / 2, H * 0.47, Math.min(W, H) * (0.36 - heat * 0.08), '#ffffff', 26 + Math.round(heat * 70), 0.14 + heat * 0.22);
        FX.speedLines(fx.ctx, W, H, '#ffffff', 4 + Math.round(heat * 12), 0.08 + heat * 0.1);
      };
      this.drawLines();
      st.node.style.setProperty('--qs-heat', String(Math.min(1, this.tests / 30)));
    },

    syncTicks() {
      const fill = (host) => {
        if (!host) return;
        while (host.children.length < this.tests) host.append(el('i'));
      };
      fill(this.ticks);
      fill(this.stripTicks);
    },

    setText(text) {
      this.text = text;
      if (this.stripText) this.stripText.textContent = text;
      if (this.subline) this.subline.textContent = text;
    },

    /* What QOJ says about the run, as plain text: "Compiling", "Judging Test #5", ... */
    update(text) {
      const clean = (text || '').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      this.setText(clean);
      const m = /(?:test|测试点|テスト)\s*#?\s*(\d+)/i.exec(clean);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n !== this.tests) this.cut(n);
      }
    },

    cut(n) {
      this.tests = n;
      this.syncTicks();
      QS.sfx('cut');
      if (!this.open) return;
      this.num.textContent = String(n);
      kick(this.count, 'qs-stamp');
      this.st.node.style.setProperty('--qs-heat', String(Math.min(1, n / 30)));
      this.drawLines();
    },

    stop() {
      this.active = false;
      QS.sfxStop('standoff', 0.12);
      if (this.st) { this.st.end(); this.st = null; }
      if (this.strip) { this.strip.remove(); this.strip = null; }
      this.ticks = null; this.subline = null;
    },
  };

  /* --------------------------------------------------------------------------------- verdict scenes */

  const facts = (d) => [d.time, d.memory, d.lang].filter(Boolean).join('   ');
  const onTest = (d) => (d.test ? ` on test ${d.test}` : '');

  function wallArt(cls = '') {
    return el('div', { class: `qs-wall ${cls}` });
  }

  async function sceneAccepted(d) {
    const hard = d.arc === 'hard';
    const st = begin('qs-ac');
    await fontsReady();
    QS.sfx('ac');
    const W = innerWidth, H = innerHeight;
    const lines = FX.makeCanvas(W, H);
    lines.c.className = 'qs-mo-fx';
    const fx = FX.makeCanvas(W, H);
    fx.c.className = 'qs-mo-fx';
    const kan = el('div', { class: 'qs-lv-kan', text: words().cut.ac });
    const info = el('div', { class: 'qs-ac-info' }, el('div', { class: 'qs-ac-title', text: d.title || '' }), el('div', { class: 'qs-ac-facts', text: facts(d) }));
    const [top, bottom] = bars();
    bottom.append(subtitle(`${words().cutEn.ac}.`));
    st.node.append(wallArt('qs-win-art'), lines.c, fx.c, kan, info, top, bottom);
    if (reduced()) {
      kan.classList.add('in');
      info.classList.add('in');
      await wait(st, 1800);
      st.end();
      return;
    }
    for (let i = 1; i <= 6; i++) {
      fx.ctx.clearRect(0, 0, W, H);
      FX.bladeStroke(fx.ctx, -40, H * 0.44, W + 40, H * 0.44, 8, '#fff', i / 6);
      if (!(await wait(st, 26))) return;
    }
    if (!(await wait(st, 80))) return;
    const col = accent();
    const burst = [];
    let lastFrame = -1;
    const stop = loop(st, (ms) => {
      fx.ctx.clearRect(0, 0, W, H);
      FX.drawParticles(fx.ctx, burst);
      const frame = Math.floor(ms / 83);
      if (frame === lastFrame) return;
      lastFrame = frame;
      lines.ctx.clearRect(0, 0, W, H);
      FX.focusLines(lines.ctx, W, H, W / 2, H * 0.44, Math.min(W, H) * 0.28, col, hard ? 110 : 70, hard ? 0.6 : 0.42);
    });
    kan.classList.add('in');
    info.classList.add('in');
    kick(st.node, 'qs-shake');
    FX.inkBurst(burst, W / 2, H * 0.44, col, hard ? 110 : 70, 1.8);
    await wait(st, 2300);
    stop();
    st.end();
  }

  async function scenePartial(d) {
    const st = begin('qs-partial');
    await fontsReady();
    QS.sfx('partial');
    const score = d.score || 0;
    const max = d.max || 100;
    const num = el('span', { class: 'qs-partial-num', text: '0' });
    const gauge = el('div', { class: 'qs-gauge' }, el('i', { style: { width: '0%' } }));
    const [top, bottom] = bars();
    bottom.append(subtitle(`${words().cutEn.partial}: ${score} of ${max}`));
    const kan = el('div', { class: 'qs-partial-kan', text: words().cut.partial });
    st.node.append(wallArt('qs-dim-art'), el('div', { class: 'qs-partial-box' }, el('div', { class: 'qs-partial-score' }, num, el('small', { text: ` / ${max}` })), gauge), kan, top, bottom);
    const bar = gauge.firstChild;
    const stop = loop(st, (ms) => {
      const u = FX.clamp01(ms / 900);
      const v = Math.round(score * easeOut(u));
      num.textContent = String(v);
      bar.style.width = `${(100 * v) / max}%`;
    });
    if (!(await wait(st, 920))) return;
    kan.classList.add('in');
    kick(st.node, 'qs-shake');
    await wait(st, 1600);
    stop();
    st.end();
  }

  async function sceneWrong(d) {
    const st = begin('qs-wa');
    await fontsReady();
    QS.sfx('wa');
    const [top, bottom] = bars();
    bottom.append(subtitle(`Wrong answer${onTest(d)}`));
    const arrow = el('div', { class: 'qs-arrow' }, el('span', { class: 'qs-arrow-jp', text: words().cut.wa }), el('span', { class: 'qs-arrow-en', text: words().cutEn.wa }));
    const next = d.test ? el('div', { class: 'qs-next-ep', text: `Next time: test ${d.test}` }) : null;
    st.node.append(wallArt('qs-sepia-art'), wallArt('qs-sepia-art qs-split-r'), wallArt('qs-sepia-art qs-split-c'), arrow, next, top, bottom);
    await wait(st, 2700);
    st.end();
  }

  async function sceneTime(d) {
    const st = begin('qs-tle');
    await fontsReady();
    QS.sfx('tle');
    const W = innerWidth, H = innerHeight;
    const cv = FX.makeCanvas(W, H);
    cv.c.className = 'qs-mo-fx';
    const kan = el('div', { class: 'qs-tle-kan', text: words().cut.tle });
    const [top, bottom] = bars();
    bottom.append(subtitle(`${words().cutEn.tle}${onTest(d)}`));
    st.node.append(wallArt('qs-gray-art'), cv.c, kan, top, bottom);
    const r = Math.min(W, H) * 0.3;
    const cx = W / 2, cy = H * 0.46;
    const draw = (angle, cracks) => {
      const c = cv.ctx;
      c.clearRect(0, 0, W, H);
      c.strokeStyle = '#fff';
      c.fillStyle = '#fff';
      c.lineWidth = 3;
      c.beginPath(); c.arc(cx, cy, r, 0, FX.TAU); c.stroke();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * FX.TAU;
        const inner = i % 5 === 0 ? r * 0.87 : r * 0.94;
        c.lineWidth = i % 5 === 0 ? 4 : 1.2;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        c.stroke();
      }
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(cx - Math.cos(angle) * r * 0.14, cy - Math.sin(angle) * r * 0.14);
      c.lineTo(cx + Math.cos(angle) * r * 0.86, cy + Math.sin(angle) * r * 0.86);
      c.stroke();
      c.beginPath(); c.arc(cx, cy, 8, 0, FX.TAU); c.fill();
      if (cracks) {
        c.lineWidth = 2;
        cracks.forEach((pts) => {
          c.beginPath();
          pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
          c.stroke();
        });
      }
    };
    const cracks = [];
    for (let i = 0; i < 9; i++) {
      let a = FX.rnd(0, FX.TAU);
      let d0 = r * 0.1;
      const pts = [[cx + Math.cos(a) * d0, cy + Math.sin(a) * d0]];
      for (let k = 0; k < 4; k++) {
        a += FX.rnd(-0.3, 0.3);
        d0 += FX.rnd(r * 0.2, r * 0.5);
        pts.push([cx + Math.cos(a) * d0, cy + Math.sin(a) * d0]);
      }
      cracks.push(pts);
    }
    if (reduced()) {
      draw(-Math.PI / 2, cracks);
      kan.classList.add('in');
      await wait(st, 1800);
      st.end();
      return;
    }
    const stop = loop(st, (ms) => {
      const u = FX.clamp01(ms / 1050);
      draw(-Math.PI / 2 + FX.TAU * 5 * easeOut(u), null);
    });
    if (!(await wait(st, 1060))) return;
    stop();
    draw(-Math.PI / 2, cracks);
    kan.classList.add('in');
    kick(st.node, 'qs-shake');
    await wait(st, 1500);
    st.end();
  }

  async function sceneMemory(d) {
    const st = begin('qs-mle');
    await fontsReady();
    QS.sfx('mle');
    const limit = parseFloat(d.limitMemory) || 256;
    const unit = (/[a-z]+/i.exec(d.limitMemory || '') || ['MB'])[0];
    const fill = el('i');
    const reading = el('div', { class: 'qs-mle-read', text: `0 ${unit}` });
    const kan = el('div', { class: 'qs-mle-kan', text: words().cut.mle });
    const [top, bottom] = bars();
    bottom.append(subtitle(`${words().cutEn.mle}${onTest(d)}`));
    const W = innerWidth, H = innerHeight;
    const fx = FX.makeCanvas(W, H);
    fx.c.className = 'qs-mo-fx';
    st.node.append(wallArt('qs-red-art'), el('div', { class: 'qs-mle-box' }, reading, el('div', { class: 'qs-mle-meter' }, fill, el('b', { text: `${limit} ${unit}` }))), kan, fx.c, top, bottom);
    const burst = [];
    const stop = loop(st, (ms) => {
      const u = FX.clamp01(ms / 1150);
      const v = limit * 1.5 * u * u;
      reading.textContent = `${Math.round(v)} ${unit}`;
      fill.style.width = `${Math.min(100, (v / (limit * 1.5)) * 100)}%`;
      st.node.style.setProperty('--qs-jit', `${u * u * 7 * (Math.random() - 0.5)}px`);
      fx.ctx.clearRect(0, 0, W, H);
      FX.drawParticles(fx.ctx, burst);
    });
    if (!(await wait(st, 1160))) return;
    kan.classList.add('in');
    kick(st.node, 'qs-shake');
    st.node.classList.add('qs-over-limit');
    FX.inkBurst(burst, W * 0.72, H * 0.5, '#ff5a4d', 90, 1.9);
    await wait(st, 1500);
    stop();
    st.end();
  }

  async function sceneRuntime(d) {
    const st = begin('qs-re');
    await fontsReady();
    QS.sfx('re');
    const [top, bottom] = bars();
    bottom.append(subtitle(`${words().cutEn.re}${onTest(d)}`));
    /* the scene itself tears along nine bands */
    const slices = [];
    for (let i = 0; i < 9; i++) {
      const slice = wallArt('qs-re-slice');
      slice.style.clipPath = `inset(${i * 11.2}% 0 ${Math.max(0, 99.8 - (i + 1) * 11.2)}% 0)`;
      slices.push(slice);
    }
    st.node.append(el('div', { class: 'qs-re-tear qs-cold-art' }, slices),
      el('div', { class: 'qs-re-text' }, el('div', { class: 'qs-re-kan', text: words().cut.re }), el('div', { class: 'qs-re-wait', text: 'しばらくお待ちください' })),
      top, bottom);
    let lastFrame = -1;
    const stop = reduced() ? () => {} : loop(st, (ms) => {
      const frame = Math.floor(ms / 166);
      if (frame === lastFrame) return;
      lastFrame = frame;
      slices.forEach((s) => s.style.setProperty('--x', `${Math.random() < 0.35 ? (Math.random() - 0.5) * 90 : 0}px`));
    });
    await wait(st, 2500);
    stop();
    st.end();
  }

  async function sceneCompile(d) {
    const st = begin('qs-ce');
    await fontsReady();
    QS.sfx('ce');
    const [top, bottom] = bars();
    top.append(el('span', { class: 'qs-br-ep', text: d.title || '' }));
    bottom.append(subtitle(words().cutEn.ce));
    const stamp = el('div', { class: 'qs-stamp-red', text: words().cut.ce });
    st.node.append(wallArt('qs-term-art'), stamp, top, bottom);
    if (!(await wait(st, 340))) return;
    stamp.classList.add('in');
    kick(st.node, 'qs-shake');
    await wait(st, 2100);
    st.end();
  }

  async function sceneLevelUp(d) {
    const st = begin('qs-lv');
    await fontsReady();
    QS.sfx('levelup');
    const W = innerWidth, H = innerHeight;
    const fx = FX.makeCanvas(W, H);
    fx.c.className = 'qs-mo-fx';
    const kan = el('div', { class: 'qs-lv-kan', text: words().cut.levelup });
    const num = el('div', { class: 'qs-lv-num', text: String(d.from) });
    const [top, bottom] = bars();
    bottom.append(subtitle(`${words().cutEn.levelup}: ${d.from} to ${d.to}`));
    st.node.append(wallArt('qs-dim-art'), fx.c, kan, num, top, bottom);
    const col = accent();
    let lastFrame = -1;
    const stop = loop(st, (ms) => {
      const u = FX.clamp01((ms - 500) / 900);
      num.textContent = String(Math.round(d.from + (d.to - d.from) * easeOut(u)));
      const frame = Math.floor(ms / 83);
      if (frame === lastFrame) return;
      lastFrame = frame;
      fx.ctx.clearRect(0, 0, W, H);
      FX.focusLines(fx.ctx, W, H, W / 2, H * 0.44, Math.min(W, H) * 0.26, col, 90, 0.5);
    });
    if (!(await wait(st, 720))) return;
    kan.classList.add('in');
    kick(st.node, 'qs-shake');
    await wait(st, 2300);
    stop();
    st.end();
  }

  const SCENES = { ac: sceneAccepted, partial: scenePartial, wa: sceneWrong, tle: sceneTime, mle: sceneMemory, re: sceneRuntime, ce: sceneCompile };

  /* -------------------------------------------------------------------------------------- the API */

  QS.Moments = {
    Broadcast,
    titleCard,
    launch,
    levelUp: sceneLevelUp,
    verdict(data) {
      const on = QS.S.moments.verdicts[data.v];
      if (!on) { QS.sfx(data.v); return Promise.resolve(); }
      const fn = SCENES[data.v];
      return fn ? fn(data) : Promise.resolve();
    },
    /* The Studio's play buttons, and anything else that wants a moment on demand. */
    demo(name, data = {}) {
      const base = { title: 'Paper Lanterns', label: (words().episode || '第{n}話').replace('{n}', '3'), arc: (QS.theme && QS.theme.arc) || 'mid', time: '46 ms', memory: '3.4 MB', lang: 'C++17', test: 12, score: 70, max: 100, limitMemory: '256 MB', ...data };
      if (name === 'title') return titleCard({ ...base, time: '1 s', memory: '256 MB' });
      if (name === 'levelup') return sceneLevelUp({ from: 1742, to: 1806 });
      if (name === 'launch') {
        launch(base);
        setTimeout(() => { if (current) current.end(); }, 1300);
        return Promise.resolve();
      }
      if (name === 'run') return QS.Moments.demoRun(base);
      return (SCENES[name] || sceneAccepted)(base);
    },
    async demoRun(base) {
      Broadcast.start(base);
      const lines = ['Compiling', 'Judging Test #1', 'Judging Test #2', 'Judging Test #3', 'Judging Test #4', 'Judging Test #5', 'Judging Test #6', 'Judging Test #7'];
      for (const line of lines) {
        await new Promise((r) => setTimeout(r, 620));
        if (!Broadcast.active) return;
        Broadcast.update(line);
      }
      await new Promise((r) => setTimeout(r, 620));
      Broadcast.stop();
      await new Promise((r) => setTimeout(r, 180));
      await sceneAccepted({ ...base, test: 0 });
    },

    async pageReady(S, route, episode) {
      const finishCover = () => root.removeAttribute('data-qs-cover');
      if (QS.liveClock() && !S.moments.live) { finishCover(); return; }
      if (QS.Watch && QS.Watch.resuming) return; // the watcher's scene takes the cover off when it starts
      if (route.name === 'problem' && episode && S.moments.title && S.moments.titleWhen !== 'never') {
        const always = S.moments.titleWhen === 'always';
        const key = `qs:t:${route.id}`;
        let seen = false;
        try { seen = !always && !!sessionStorage.getItem(key); } catch { seen = false; }
        const solved = !always && ((await QS.get(QS.key('history'))) || []).some((h) => h.id === route.id && h.v === 'ac');
        if (!seen && !solved) {
          /* A problem opened in a background tab gets its card when you first look at it. */
          if (document.hidden) {
            finishCover();
            await new Promise((res) => {
              const look = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', look); res(); } };
              document.addEventListener('visibilitychange', look);
            });
          }
          try { sessionStorage.setItem(key, '1'); } catch { /* it just plays again next time */ }
          await titleCard(episode);
          finishCover();
          return;
        }
      }
      finishCover();
      /* rating changes are shown once, on the next page after they happen */
      if (S.moments.levelUp && QS.me && QS.me.rating) {
        const last = await QS.get(QS.key('rating'));
        if (last && last.name === QS.me.name && QS.me.rating > last.rating) sceneLevelUp({ from: last.rating, to: QS.me.rating });
        if (!last || last.rating !== QS.me.rating || last.name !== QS.me.name) QS.set(QS.key('rating'), { name: QS.me.name, rating: QS.me.rating });
      }
    },
  };
})();

