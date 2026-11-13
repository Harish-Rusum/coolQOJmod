/* fx.js: the drawing the cutscenes share. Plain canvas calls.
   Lines are redrawn on twos, the way hand animation holds a frame for two beats, which is what makes them
   read as drawn rather than computed. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function makeCanvas(w = innerWidth, h = innerHeight, scale) {
    const c = document.createElement('canvas');
    const r = scale || Math.min(devicePixelRatio || 1, 1.5);
    c.width = Math.round(w * r);
    c.height = Math.round(h * r);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(r, 0, 0, r, 0, 0);
    return { c, ctx, w, h, r };
  }

  /* manga focus lines: long thin wedges aimed at a point */
  function focusLines(ctx, w, h, cx, cy, inner, color, count, alpha = 1) {
    const reach = Math.hypot(w, h);
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const r0 = inner * rnd(0.82, 1.5);
      const spread = rnd(0.002, 0.011);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a + spread) * reach, cy + Math.sin(a + spread) * reach);
      ctx.lineTo(cx + Math.cos(a - spread) * reach, cy + Math.sin(a - spread) * reach);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function speedLines(ctx, w, h, color, count, alpha = 1, slope = 0) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (let i = 0; i < count; i++) {
      const y = Math.random() * h;
      const x = Math.random() * w;
      const len = rnd(w * 0.06, w * 0.45);
      const t = rnd(0.6, 2.4);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + slope * len - t / 2);
      ctx.lineTo(x + len, y + slope * len + t / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* a blade stroke: thin at both ends, widest near the middle */
  function bladeStroke(ctx, x0, y0, x1, y1, width, color, t = 1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const ex = x0 + dx * t, ey = y0 + dy * t;
    const mx = x0 + dx * t * 0.62, my = y0 + dy * t * 0.62;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx + nx * width, my + ny * width, ex, ey);
    ctx.quadraticCurveTo(mx - nx * width, my - ny * width, x0, y0);
    ctx.fill();
    ctx.restore();
  }

  /* A loaded image once, for all cutscenes */
  const images = new Map();
  function loadImage(url) {
    if (images.has(url)) return images.get(url);
    const p = new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    });
    images.set(url, p);
    return p;
  }

  function drawCover(ctx, img, w, h, zoom = 1, fx = 0.5, fy = 0.5) {
    if (!img) return;
    const s = Math.max(w / img.width, h / img.height) * zoom;
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (w - dw) * fx, (h - dh) * fy, dw, dh);
  }

  /* -------------------------------------------------------------------------------- dry brush */

  /* One stroke of a loaded brush: many bristles, each with its own wobble, gaps and start offset. */
  function makeBrush(path, width, seed = 1) {
    let n = seed * 9301 + 49297;
    const r = () => { n = (n * 9301 + 49297) % 233280; return n / 233280; };
    const bristles = [];
    const count = Math.round(width / 1.7);
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const edge = Math.abs(u - 0.5) * 2;
      bristles.push({
        off: (u - 0.5) * width,
        phase: r() * TAU,
        wob: 1 + r() * 3,
        lag: r() * 0.08 + edge * 0.05,
        end: 0.86 + r() * 0.14 - edge * edge * 0.12,
        thick: 1.3 + r() * 2.2,
        gapAt: r(),
        gapLen: edge > 0.55 ? r() * 0.3 : r() * 0.06,
      });
    }
    return { path, bristles };
  }

  const samplePath = (p, u) => {
    /* p: cubic bezier as [x0,y0,x1,y1,x2,y2,x3,y3] */
    const v = 1 - u;
    const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    const x = a * p[0] + b * p[2] + c * p[4] + d * p[6];
    const y = a * p[1] + b * p[3] + c * p[5] + d * p[7];
    const tx = -3 * v * v * p[0] + (3 * v * v - 6 * u * v) * p[2] + (6 * u * v - 3 * u * u) * p[4] + 3 * u * u * p[6];
    const ty = -3 * v * v * p[1] + (3 * v * v - 6 * u * v) * p[3] + (6 * u * v - 3 * u * u) * p[5] + 3 * u * u * p[7];
    const l = Math.hypot(tx, ty) || 1;
    return { x, y, nx: -ty / l, ny: tx / l };
  };

  /* Draws the part of the stroke between progress t0 and t1 into a mask canvas. */
  function paintBrush(ctx, brush, t0, t1, color = '#fff') {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    const steps = 14;
    for (const b of brush.bristles) {
      const from = clamp01((t0 - b.lag) / (1 - b.lag)) * b.end;
      const to = clamp01((t1 - b.lag) / (1 - b.lag)) * b.end;
      if (to <= from) continue;
      ctx.lineWidth = b.thick;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const u = from + (to - from) * (s / steps);
        if (u > b.gapAt && u < b.gapAt + b.gapLen) { ctx.stroke(); ctx.beginPath(); continue; }
        const q = samplePath(brush.path, u);
        const off = b.off + Math.sin(u * 7 * b.wob + b.phase) * 1.8;
        if (s === 0) ctx.moveTo(q.x + q.nx * off, q.y + q.ny * off);
        else ctx.lineTo(q.x + q.nx * off, q.y + q.ny * off);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------------------------- particles */

  function inkBurst(list, x, y, color, count = 34, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const v = rnd(2, 15) * power;
      list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, r: rnd(0.7, 5.5) * (Math.random() < 0.1 ? 2.2 : 1), life: rnd(16, 40), age: 0, color, drag: rnd(0.86, 0.94) });
    }
  }

  function drawParticles(ctx, list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age++;
      if (p.age > p.life) { list.splice(i, 1); continue; }
      p.x += p.vx; p.y += p.vy;
      p.vx *= p.drag; p.vy = p.vy * p.drag + 0.22;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 1 - (p.age / p.life) ** 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.72, Math.atan2(p.vy, p.vx), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  QS.FX = { makeCanvas, focusLines, speedLines, bladeStroke, loadImage, drawCover, makeBrush, paintBrush, inkBurst, drawParticles, rnd, clamp01, TAU };
})();
