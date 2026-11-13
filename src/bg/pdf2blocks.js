/* pdf2blocks.js: turns one statement PDF into a block tree the page can show as real text.

   Pure layout analysis. Input is what extract() below pulls out of pdf.js: text runs with
   position and font, plus the drawing operations reduced to boxes. Output is a list of blocks
   (headings, paragraphs, lists, samples, tables, figures) with inline tokens for math.

   What cannot be expressed as text (a stacked matrix, a drawing, a table too irregular to rebuild)
   becomes a crop request: the caller renders that rectangle of the page and the block refers to it.
   So a statement always shows everything the PDF shows. */

export const VERSION = 3;

const LIGATURES = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', ' ': ' ',
  /* TeX fonts without a unicode map: OT1 keeps ligatures at 0B-0F, T1 at 1B-1F */
  '\x0b': 'ff', '\x0c': 'fi', '\x0d': 'fl', '\x0e': 'ffi', '\x0f': 'ffl',
  '\x1b': 'ff', '\x1c': 'fi', '\x1d': 'fl', '\x1e': 'ffi', '\x1f': 'ffl',
};
const LIG_RE = /[ﬀ-ﬆ \x0b-\x0f\x1b-\x1f]/g;
const NOT_SLASH = '̸';
const CJK_CLASS = '\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef\\u3000-\\u303f';
const CJK = new RegExp(`[${CJK_CLASS}]`);
const CJK_END = new RegExp(`[${CJK_CLASS}]$`);
const CJK_START = new RegExp(`^[${CJK_CLASS}]`);
const PUA = /[-�]/;

const KEYWORD_HEADING = /^(【.*】|\[.*\]|input( format| data| specification| file)?|output( format| data| specification| file)?|(sample|example)s?( input| output| test| case)?s?( ?#?\d+)?|notes?|explanations?|constraints?|limits?|scoring|subtasks?|interaction|interactor|statement|problem( description)?|description|technical specification|grading|hints?|background|communication|implementation( details)?|输入(格式)?|输出(格式)?|样例.*|数据范围.*|数据规模.*|题目描述|题目背景|题目大意|提示|说明|注意|子任务.*|评分方式|交互方式|入力|出力|制約|入出力例.*|問題文?)[:：.]?$/i;
const META_LINE = /^(time|memory|input|output)(\s*(limit|file|le))?s?\s*[:：]/i;
const META_LINE_CN = /^(时间限制|内存限制|空间限制|输入文件|输出文件)\s*[:：]/;
const PAGE_NO = /^((page|стр\.?)\s*)?\d+(\s*(of|\/|из)\s*\d+)?$|^第\s*\d+\s*页(\s*[,，]?\s*共\s*\d+\s*页)?$/i;
const BULLET = /^(•|·|∙|◦|▪|‣|⋆|∗|\*|–|—|-)(\s+|$)/;
const ORDERED = /^(\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}\))\s+/;

/* ---------------------------------------------------------------------------------------- fonts */

export function classifyFont(rawName = '', obj = {}) {
  const name = String(rawName).replace(/^[A-Z]{6}\+/, '');
  const mono = /mono|cmtt|sftt|lmtt|cmvtt|courier|consolas|menlo|typewriter|inconsolata|nimbusmon|txtt|pcrr|lucidacons|sourcecode|firacode|dejavusansm/i.test(name);
  const mathI = /cmmi|mathitalic|rtxmi|txmi|stixmath|cambriamath|eufm|euler/i.test(name);
  const big = /cmex|mathextension|txex|rtxex/i.test(name);
  const slanted = /msam/i.test(name);
  const negates = /cmsy|mathsymbols|rtxsy|txsy/i.test(name);
  const mathS = big || /cmsy|mathsymbols|txsy|rtxsy|msam|msbm|symbol|mtsy|wasy|stmary/i.test(name);
  const bold = /bold|cmbx|sfbx|sfsx|heavy|black|demi|simhei|黑体|\bhei\b|medi\b|-bd\b|semibold/i.test(name) || !!obj.bold || !!obj.black;
  const italic = !mathI && (/italic|oblique|ital\b|ital$|cmti|sfti|sfit|lmri/i.test(name) || !!obj.italic);
  return { mono, mathI, mathS, big, bold, italic, name, slanted, negates };
}

/* --------------------------------------------------------------------------------- extraction */

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function bboxOf(m, x0, y0, x1, y1) {
  const xs = [], ys = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function parseColor(args) {
  const a = args[0];
  if (typeof a === 'string' && a[0] === '#') {
    return [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  }
  if (args.length >= 3) return [args[0], args[1], args[2]];
  return [0, 0, 0];
}

/* Walks the operator list keeping the transform stack. Everything drawn becomes a box. */
function collectGraphics(ops, OPS) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let fill = [0, 0, 0];
  const stack = [];
  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push({ ctm, fill });
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; } }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, fill });
      if (args[0]) ctm = mul(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; } }
    else if (fn === OPS.setFillRGBColor) fill = parseColor(args);
    else if (fn === OPS.constructPath) {
      const paint = args[0];
      const mm = args[2];
      if (paint === OPS.endPath || !mm || !isFinite(mm[0])) continue;
      const stroked = paint === OPS.stroke || paint === OPS.closeStroke;
      const filled = !stroked;
      const box = bboxOf(ctm, mm[0], mm[1], mm[2], mm[3]);
      const light = filled && fill[0] > 225 && fill[1] > 225 && fill[2] > 225;
      const len = args[1] && args[1][0] ? args[1][0].length : 0;
      out.push({ kind: 'path', ...box, stroked, light, simple: len <= 150, fill });
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      out.push({ kind: 'image', ...bboxOf(ctm, 0, 0, 1, 1), name: typeof args[0] === 'string' ? args[0] : '' });
    }
  }
  return out;
}

export async function extractPage(page, OPS) {
  const vp = page.getViewport({ scale: 1 });
  const [x0, y0, x1, y1] = page.view;
  const ops = await page.getOperatorList();
  const tc = await page.getTextContent({ disableNormalization: true });
  const fontCache = new Map();
  const fontOf = (id) => {
    if (fontCache.has(id)) return fontCache.get(id);
    let raw = '', obj = {};
    try {
      if (page.commonObjs.has(id)) { obj = page.commonObjs.get(id) || {}; raw = obj.name || ''; }
    } catch { /* font not resolved: treated as plain text */ }
    const f = classifyFont(raw, obj);
    fontCache.set(id, f);
    return f;
  };
  const runs = [];
  let rotated = 0;
  for (const it of tc.items) {
    if (!it.str) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.02 * Math.abs(a || 1) || Math.abs(c) > 0.02 * Math.abs(d || 1)) { rotated += it.str.length; continue; }
    if (!it.str.trim()) continue;
    const size = Math.abs(d) || Math.abs(a) || it.height || 10;
    const lead = /^\s/.test(it.str);
    const trail = /\s$/.test(it.str);
    const font = fontOf(it.fontName);
    let str = it.str.replace(LIG_RE, (m) => LIGATURES[m]).trim();
    if (font.slanted) str = str.replace(/6/g, '≤').replace(/>/g, '≥'); // \\leqslant and \\geqslant in MSAM
    if (font.negates) str = str.replace(/6/g, NOT_SLASH); // \\not is its own glyph in the symbol font
    const raw = it.str.length || 1;
    const perChar = (it.width || 0) / raw;
    const leadN = it.str.length - it.str.trimStart().length;
    const trailN = it.str.length - it.str.trimEnd().length;
    runs.push({
      s: str, x: e + leadN * perChar, y: f, w: Math.max(0, (it.width || 0) - (leadN + trailN) * perChar),
      size, lead, trail, font, eol: !!it.hasEOL,
    });
  }
  return { w: vp.width, h: vp.height, ox: x0, oy: y0, x1, y1, runs, rotated, gfx: collectGraphics(ops, OPS) };
}

/* ------------------------------------------------------------------------------------- helpers */

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const overlapX = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const plain = (runs) => runs.map((r) => r.s).join(' ');
const inBox = (r, b, pad = 1) => {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.size * 0.3;
  return cx >= b.x0 - pad && cx <= b.x1 + pad && cy >= b.y0 - pad && cy <= b.y1 + pad;
};

/* ------------------------------------------------------------------------ rules, grids, figures */

function splitGraphics(pg) {
  const H = [], V = [], shapes = [], frames = [];
  const area = pg.w * pg.h;
  for (const g of pg.gfx) {
    const w = g.x1 - g.x0, h = g.y1 - g.y0;
    if (g.kind === 'image') {
      if (w > 3 && h > 3) shapes.push(g);
      continue;
    }
    if (g.light && !g.stroked) { // a page tint or sample background: nothing to read in it
      if (w > 40 && h > 12 && w * h < area * 0.8) shapes.push({ ...g, kind: 'tint' });
      continue;
    }
    if (w * h > area * 0.85) continue;
    if (h <= 2.4 && w >= 2) { H.push({ y: (g.y0 + g.y1) / 2, x0: g.x0, x1: g.x1 }); continue; }
    if (w <= 2.4 && h >= 2) { V.push({ x: (g.x0 + g.x1) / 2, y0: g.y0, y1: g.y1 }); continue; }
    if (g.simple && w > 30 && h > 10) { // an axis aligned frame, rounded or not
      frames.push({ x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1 });
      continue;
    }
    shapes.push(g);
  }
  return { H, V, shapes, frames };
}

class DSU {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(a) { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a]; } return a; }
  union(a, b) { this.p[this.find(a)] = this.find(b); }
}

function clusterValues(vals, tol) {
  const s = [...vals].sort((a, b) => a - b);
  const out = [];
  for (const v of s) {
    if (out.length && v - out[out.length - 1].max <= tol) {
      const c = out[out.length - 1];
      c.max = v; c.sum += v; c.n++;
    } else out.push({ max: v, sum: v, n: 1 });
  }
  return out.map((c) => c.sum / c.n);
}

/* Groups rule segments into candidate tables. Segments that touch form a table. Horizontal rules
   with nothing joining them only count as one (booktabs style) when they share their extent. */
function findGridClusters(H, V) {
  const segs = [...H.map((s) => ({ ...s, t: 'h' })), ...V.map((s) => ({ ...s, t: 'v' }))];
  const d = new DSU(segs.length);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.t === 'v' && b.t === 'v') {
        if (Math.abs(a.x - b.x) < 2 && a.y0 <= b.y1 + 2 && b.y0 <= a.y1 + 2) d.union(i, j);
      } else if (a.t === 'h' && b.t === 'h') {
        if (Math.abs(a.y - b.y) < 1.5 && a.x0 <= b.x1 + 1.5 && b.x0 <= a.x1 + 1.5) d.union(i, j);
      } else if (a.t !== b.t) {
        const h = a.t === 'h' ? a : b, v = a.t === 'h' ? b : a;
        if (v.x >= h.x0 - 2.5 && v.x <= h.x1 + 2.5 && h.y >= v.y0 - 2.5 && h.y <= v.y1 + 2.5) d.union(i, j);
      }
    }
  }
  const hasV = new Set();
  segs.forEach((s, i) => { if (s.t === 'v') hasV.add(d.find(i)); });
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.t !== 'h' || b.t !== 'h' || hasV.has(d.find(i)) || hasV.has(d.find(j))) continue;
      const sameExtent = Math.abs(a.x0 - b.x0) < 5 && Math.abs(a.x1 - b.x1) < 5;
      const overlap = overlapX(a.x0, a.x1, b.x0, b.x1);
      const shorter = Math.min(a.x1 - a.x0, b.x1 - b.x0);
      const gap = Math.abs(a.y - b.y);
      if (Math.max(a.x1 - a.x0, b.x1 - b.x0) > 40 && gap < 150 && (sameExtent || (overlap > shorter * 0.8 && gap < 30))) d.union(i, j);
    }
  }
  const groups = new Map();
  segs.forEach((s, i) => {
    const r = d.find(i);
    if (!groups.has(r)) groups.set(r, { H: [], V: [] });
    groups.get(r)[s.t === 'h' ? 'H' : 'V'].push(s);
  });
  const out = [];
  for (const g of groups.values()) {
    if (g.H.length < 2) continue;
    const x0 = Math.min(...g.H.map((s) => s.x0), ...g.V.map((s) => s.x));
    const x1 = Math.max(...g.H.map((s) => s.x1), ...g.V.map((s) => s.x));
    const y0 = Math.min(...g.H.map((s) => s.y), ...g.V.map((s) => s.y0));
    const y1 = Math.max(...g.H.map((s) => s.y), ...g.V.map((s) => s.y1));
    if (x1 - x0 < 30 || y1 - y0 < 9) continue;
    out.push({ ...g, x0, x1, y0, y1 });
  }
  return out;
}

const covers = (from, to, segs, get0, get1) => {
  // how much of [from, to] the segments cover
  const span = to - from;
  if (span <= 0) return 1;
  let got = 0;
  const parts = segs.map((s) => [Math.max(from, get0(s)), Math.min(to, get1(s))]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let end = from;
  for (const [a, b] of parts) { if (b > end) { got += b - Math.max(a, end); end = b; } }
  return got / span;
};

/* Builds cells for one cluster, merging cells where no rule separates them. Returns null when the
   result would not read as a table; the caller crops the region instead. */
function buildGrid(g, runs) {
  const inner = runs.filter((r) => inBox(r, g, 1.5));
  if (!inner.length) return null;
  const hasV = g.V.length > 0;
  let xs = hasV ? clusterValues(g.V.map((s) => s.x), 2) : [];
  if (!xs.length || xs[0] - g.x0 > 3) xs.unshift(g.x0);
  if (g.x1 - xs[xs.length - 1] > 3) xs.push(g.x1);
  let inferredCols = false;
  const innerV = g.V.filter((s) => s.x > g.x0 + 3 && s.x < g.x1 - 3);
  if (!innerV.length) {
    const iv = inner.map((r) => [r.x, r.x + r.w]).sort((a, b) => a[0] - b[0]);
    const sep = [];
    let end = iv[0][1];
    for (const [a, b] of iv) {
      if (a - end >= 10) sep.push((a + end) / 2);
      end = Math.max(end, b);
    }
    const mono = inner.filter((r) => r.font.mono).reduce((n, r) => n + r.s.length, 0) / inner.reduce((n, r) => n + r.s.length, 0);
    if (sep.length && sep.length <= 10 && mono < 0.7) {
      xs = [g.x0, ...sep, g.x1];
      inferredCols = true;
    }
  }
  const ys = clusterValues(g.H.map((s) => s.y), 2).sort((a, b) => b - a);
  if (g.y1 - ys[0] > 3) ys.unshift(g.y1);
  if (ys[ys.length - 1] - g.y0 > 3) ys.push(g.y0);
  const rows = ys.length - 1, cols = xs.length - 1;
  if (rows < 1 || cols < 1 || cols > 14 || rows > 80) return null;

  const dsu = new DSU(rows * cols);
  const id = (r, c) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      if (inferredCols) continue;
      const cover = covers(ys[r + 1], ys[r], g.V.filter((s) => Math.abs(s.x - xs[c + 1]) < 2.5), (s) => s.y0, (s) => s.y1);
      if (cover < 0.6) dsu.union(id(r, c), id(r, c + 1));
    }
  }
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cover = covers(xs[c], xs[c + 1], g.H.filter((s) => Math.abs(s.y - ys[r + 1]) < 2.5), (s) => s.x0, (s) => s.x1);
      if (cover < 0.6) dsu.union(id(r, c), id(r + 1, c));
    }
  }
  const merged = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = dsu.find(id(r, c));
      if (!merged.has(k)) merged.set(k, { r0: r, r1: r, c0: c, c1: c, n: 0 });
      const m = merged.get(k);
      m.r0 = Math.min(m.r0, r); m.r1 = Math.max(m.r1, r);
      m.c0 = Math.min(m.c0, c); m.c1 = Math.max(m.c1, c);
      m.n++;
    }
  }
  const cells = [];
  for (const m of merged.values()) {
    if (m.n !== (m.r1 - m.r0 + 1) * (m.c1 - m.c0 + 1)) return null; // not a rectangle
    const box = { x0: xs[m.c0], x1: xs[m.c1 + 1], y1: ys[m.r0], y0: ys[m.r1 + 1] };
    cells.push({ ...m, ...box, runs: inner.filter((r) => inBox(r, box, 0.5)) });
  }
  cells.sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
  return { rows, cols, cells, inner };
}

/* --------------------------------------------------------------------------------------- bands */

/* A band is one visual line: runs whose vertical extents overlap. Scripts and stacked math fall in
   the band of the line they belong to, because they overlap it and not the lines around it. */
function toBands(runs) {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const bands = [];
  for (const r of sorted) {
    const top = r.y + 0.72 * r.size, bot = r.y - 0.2 * r.size;
    let placed = false;
    for (let i = bands.length - 1; i >= Math.max(0, bands.length - 3); i--) {
      const b = bands[i];
      const ov = Math.min(b.top, top) - Math.max(b.bot, bot);
      if (ov > 0.35 * Math.min(b.top - b.bot, top - bot)) {
        b.runs.push(r);
        b.top = Math.max(b.top, top);
        b.bot = Math.min(b.bot, bot);
        placed = true;
        break;
      }
    }
    if (!placed) bands.push({ runs: [r], top, bot });
  }
  for (const b of bands) finishBand(b);
  return bands;
}

function finishBand(b) {
  const weight = new Map();
  for (const r of b.runs) {
    if (r.font.big) continue;
    const key = Math.round(r.y * 2) / 2;
    weight.set(key, (weight.get(key) || 0) + r.s.length * r.size * r.size);
  }
  let y0 = b.runs[0].y, best = -1;
  for (const [k, v] of weight) if (v > best) { best = v; y0 = k; }
  b.y0 = y0;
  const mains = b.runs.filter((r) => Math.abs(r.y - y0) <= 0.14 * r.size && !r.font.big);
  b.size = median(mains.length ? mains.map((r) => r.size) : b.runs.map((r) => r.size));
  b.x0 = Math.min(...b.runs.map((r) => r.x));
  b.x1 = Math.max(...b.runs.map((r) => r.x + r.w));
  const chars = b.runs.reduce((n, r) => n + r.s.length, 0) || 1;
  b.chars = chars;
  b.monoShare = b.runs.filter((r) => r.font.mono && !CJK.test(r.s)).reduce((n, r) => n + r.s.length, 0) / chars;
  b.boldShare = b.runs.filter((r) => r.font.bold).reduce((n, r) => n + r.s.length, 0) / chars;
  b.text = lineText(b);
}

const lineText = (b) => {
  const rs = [...b.runs].sort((p, q) => p.x - q.x);
  let out = '';
  let end = null;
  for (const r of rs) {
    if (end !== null && (r.x - end > 0.16 * r.size || r.lead)) out += ' ';
    out += r.s;
    end = r.x + r.w;
  }
  return out;
};

/* ------------------------------------------------------------------------------ inline tokens */

const styleOf = (r) => {
  const f = r.font;
  const t = {};
  if (f.bold && !f.mathS && !f.mathI) t.b = 1;
  if (f.italic) t.i = 1;
  if (f.mono) t.c = 1;
  if (f.mathI) { t.m = 1; t.i = 1; }
  if (f.mathS) t.m = 1;
  return t;
};

function pushText(out, s, style) {
  const last = out[out.length - 1];
  if (last && last.t === 'text' && !!last.b === !!style.b && !!last.i === !!style.i && !!last.c === !!style.c && !!last.m === !!style.m) {
    last.s += s;
    return;
  }
  out.push({ t: 'text', s, ...style });
}

const scriptTol = (r, sz) => (r.size < sz * 0.85 ? 0.08 : 0.14) * sz;

function tokenize(list, y0, sz, depth = 0, crops = null, page = 0) {
  const runs = [...list].sort((a, b) => a.x - b.x);
  const out = [];
  let end = null, prevTrail = false, prevStr = '';
  const spaceWanted = (r) => {
    if (end === null) return false;
    const gap = r.x - end;
    if (prevTrail || r.lead) return gap > -0.1 * sz || r.lead;
    const cjk = CJK_END.test(prevStr) || CJK_START.test(r.s || '');
    return gap > (cjk ? 0.3 : 0.14) * sz;
  };
  let i = 0;
  while (i < runs.length) {
    const r = runs[i];
    if (r.token) {
      if (spaceWanted(r)) pushText(out, ' ', {});
      out.push(r.token);
      end = r.x + r.w; prevStr = ''; prevTrail = false; i++;
      continue;
    }
    const d = r.y - y0;
    const isScript = depth < 2 && Math.abs(d) > scriptTol(r, sz) && r.size < sz * 0.98;
    if (!isScript) {
      if (spaceWanted(r)) pushText(out, ' ', {});
      pushText(out, r.s, styleOf(r));
      end = r.x + r.w; prevStr = r.s; prevTrail = r.trail; i++;
      continue;
    }
    const group = [];
    let j = i;
    let gEnd = r.x;
    while (j < runs.length && !runs[j].token && Math.abs(runs[j].y - y0) > scriptTol(runs[j], sz) && runs[j].size < sz * 0.98 && runs[j].x - gEnd < 0.7 * sz) {
      group.push(runs[j]);
      gEnd = Math.max(gEnd, runs[j].x + runs[j].w);
      j++;
    }
    if (end !== null && r.x - end > 0.34 * sz && !(/^[′'`*]/.test(r.s))) pushText(out, ' ', {});
    const ups = group.filter((g) => g.y > y0), downs = group.filter((g) => g.y < y0);
    const mk = (g) => {
      const big = g.reduce((m, x) => (x.size > m.size ? x : m), g[0]);
      return tokenize(g, big.y, big.size, depth + 1, crops, page);
    };
    const onlyPrime = ups.length && ups.every((g) => /^[′″‴'*∗◦]+$/.test(g.s));
    if (ups.length && downs.length) {
      const ux0 = Math.min(...ups.map((g) => g.x)), ux1 = Math.max(...ups.map((g) => g.x + g.w));
      const dx0 = Math.min(...downs.map((g) => g.x)), dx1 = Math.max(...downs.map((g) => g.x + g.w));
      if (overlapX(ux0, ux1, dx0, dx1) > 0) out.push({ t: 'ss', sup: mk(ups), sub: mk(downs) });
      else if (ux0 < dx0) out.push({ t: 'sup', k: mk(ups) }, { t: 'sub', k: mk(downs) });
      else out.push({ t: 'sub', k: mk(downs) }, { t: 'sup', k: mk(ups) });
    } else if (onlyPrime) {
      const s = ups.map((g) => g.s).join('').replace(/◦/g, '°').replace(/∗/g, '*');
      pushText(out, s, { m: 1 });
    } else if (ups.length) out.push({ t: 'sup', k: mk(ups) });
    else out.push({ t: 'sub', k: mk(downs) });
    end = gEnd; prevStr = ''; prevTrail = false;
    i = j;
  }
  return out;
}

/* Digits and brackets set in the text font next to math read as part of the formula. */
function fixNegation(tokens) {
  const NEG = { '=': '≠', '∈': '∉', '≡': '≢', '<': '≮', '>': '≯', '≤': '≰', '≥': '≱', '|': '∤', '∣': '∤', '⊂': '⊄', '∼': '≁' };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t !== 'text' || !t.s.includes(NOT_SLASH)) continue;
    t.s = t.s.replace(new RegExp(`${NOT_SLASH}\\s*(.)`, 'gu'), (m, c) => NEG[c] || `${c}${NOT_SLASH}`);
    if (t.s.endsWith(NOT_SLASH)) {
      const n = tokens[i + 1];
      const body = n && n.t === 'text' ? n.s.replace(/^\s+/, '') : '';
      if (body && NEG[body[0]]) {
        t.s = t.s.slice(0, -1) + NEG[body[0]];
        n.s = body.slice(1);
      } else t.s = t.s.slice(0, -1);
    }
  }
  return tokens;
}

function tidyTokens(rawTokens) {
  const tokens = fixNegation(rawTokens);
  const NUMERIC = /^[\s0-9()[\]{}+\-−=,.:;|/×·<>≤≥!%^~]+$/;
  const isMathy = (t) => t && ((t.t === 'text' && t.m) || t.t === 'sup' || t.t === 'sub' || t.t === 'ss' || t.t === 'frac' || t.t === 'ink');
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.t !== 'text' || t.m || t.c || t.b || !NUMERIC.test(t.s) || !t.s.trim()) continue;
      if (isMathy(tokens[i - 1]) || isMathy(tokens[i + 1])) t.m = 1;
    }
  }
  const out = [];
  for (const t of tokens) {
    if (t.t === 'sup' || t.t === 'sub') t.k = tidyTokens(t.k);
    if (t.t === 'ss') { t.sup = tidyTokens(t.sup); t.sub = tidyTokens(t.sub); }
    if (t.t === 'frac') { t.n = tidyTokens(t.n); t.d = tidyTokens(t.d); }
    if (t.t === 'text') t.s = t.s.replace(/\. ?\. ?\./g, '…');
    const last = out[out.length - 1];
    if (t.t === 'text' && last && last.t === 'text' && !!last.b === !!t.b && !!last.i === !!t.i && !!last.c === !!t.c && !!last.m === !!t.m) last.s += t.s;
    else out.push(t);
  }
  return out;
}

const plainTokens = (toks) => toks.map((t) => {
  if (t.t === 'text') return t.s;
  if (t.t === 'sup') return `^(${plainTokens(t.k)})`;
  if (t.t === 'sub') return `_(${plainTokens(t.k)})`;
  if (t.t === 'ss') return `_(${plainTokens(t.sub)})^(${plainTokens(t.sup)})`;
  if (t.t === 'frac') return `(${plainTokens(t.n)})/(${plainTokens(t.d)})`;
  if (t.t === 'ink') return t.alt || '';
  return '';
}).join('');

/* Fractions, radicals and anything stacked. Replaced in the band by a single pseudo run. */
function resolveStacks(b, rules, page, crops) {
  const sz = b.size || 10;
  let runs = b.runs.map((r) => {
    if (r.font.big && /^[∑∏∫∮⋃⋂⨁⨂⋁⋀]+$/.test(r.s)) return { ...r, y: b.y0, wasBig: true };
    if (r.font.big && r.s.length === 1 && /[()[\]{}|⟨⟩⌊⌋⌈⌉]/.test(r.s)) return { ...r, y: b.y0, wasBig: true };
    return r;
  });
  const tokens = [];
  /* Chinese emphasis marks are dots under single characters */
  const dots = runs.filter((r) => /^[.·．]$/.test(r.s) && r.y < b.y0 - 0.05 * sz && runs.some((o) => o !== r && CJK.test(o.s) && r.x + r.w / 2 >= o.x - 0.5 && r.x + r.w / 2 <= o.x + o.w + 0.5));
  if (dots.length) {
    const dotSet = new Set(dots);
    runs = runs.filter((r) => !dotSet.has(r)).map((o) => {
      if (!CJK.test(o.s)) return o;
      const hit = dots.some((d) => d.x + d.w / 2 >= o.x - 0.5 && d.x + d.w / 2 <= o.x + o.w + 0.5);
      return hit ? { ...o, font: { ...o.font, bold: true } } : o;
    });
  }

  for (const rule of rules) {
    const ry = rule.y;
    if (ry < b.bot - 2 || ry > b.top + 2) continue;
    const span = (r) => overlapX(r.x, r.x + r.w, rule.x0 - 0.5, rule.x1 + 0.5) > 0.5 * Math.max(r.w, 1);
    const above = runs.filter((r) => span(r) && r.y > ry);
    const below = runs.filter((r) => span(r) && r.y + 0.65 * r.size < ry + 0.5 * sz && r.y < ry);
    const belowReal = below.filter((r) => r.y + 0.5 * r.size < ry + 0.2);
    if (above.length && belowReal.length && rule.x1 - rule.x0 < 240) {
      const nb = above.reduce((m, r) => (r.size > m.size ? r : m), above[0]);
      const db = belowReal.reduce((m, r) => (r.size > m.size ? r : m), belowReal[0]);
      const set = new Set([...above, ...belowReal]);
      runs = runs.filter((r) => !set.has(r));
      tokens.push({
        x: rule.x0, w: rule.x1 - rule.x0, y: b.y0, size: sz, s: '', font: {},
        token: { t: 'frac', n: tokenize(above, nb.y, nb.size, 1), d: tokenize(belowReal, db.y, db.size, 1) },
      });
    } else if (below.length && !above.length && ry > b.y0 + 0.4 * sz) {
      // an overline or a radical: keep its exact look
      const rad = runs.filter((r) => r.x + r.w <= rule.x0 + 1 && r.x + r.w >= rule.x0 - 0.9 * sz && r.font.mathS);
      const set = new Set([...below, ...rad]);
      const all = [...set];
      const x0 = Math.min(rule.x0, ...all.map((r) => r.x));
      const x1 = Math.max(rule.x1, ...all.map((r) => r.x + r.w));
      const id = addCrop(crops, page, x0, x1, b, 'ink', plain(all));
      runs = runs.filter((r) => !set.has(r));
      tokens.push({ x: x0, w: x1 - x0, y: b.y0, size: sz, s: '', font: {}, token: { t: 'ink', id, alt: plain(all) } });
    }
  }

  /* Anything still sitting right above or below another run, or marked with glyphs no font maps. */
  const offs = runs.filter((r) => Math.abs(r.y - b.y0) > scriptTol(r, sz));
  const mains = runs.filter((r) => Math.abs(r.y - b.y0) <= scriptTol(r, sz));
  const stacked = [];
  for (const o of offs) {
    const sameSize = o.size >= sz * 0.98;
    const covers1 = mains.some((m) => overlapX(o.x, o.x + o.w, m.x, m.x + m.w) > 0.3 * Math.min(Math.max(o.w, 1), Math.max(m.w, 1)));
    const covers2 = offs.some((m) => m !== o && Math.sign(m.y - b.y0) === Math.sign(o.y - b.y0) && Math.abs(m.y - o.y) > 0.5 * o.size && overlapX(o.x, o.x + o.w, m.x, m.x + m.w) > 0.3 * Math.min(Math.max(o.w, 1), Math.max(m.w, 1)));
    if (sameSize || covers1 || covers2) stacked.push(o);
  }
  const weird = runs.filter((r) => PUA.test(r.s));
  stacked.push(...weird.filter((r) => !stacked.includes(r)));
  if (stacked.length) {
    const spans = [];
    for (const s of stacked.sort((p, q) => p.x - q.x)) {
      const last = spans[spans.length - 1];
      if (last && s.x <= last.x1 + 0.4 * sz) last.x1 = Math.max(last.x1, s.x + s.w);
      else spans.push({ x0: s.x, x1: s.x + s.w });
    }
    for (const sp of spans) {
      const inside = (r) => overlapX(r.x, r.x + r.w, sp.x0, sp.x1) > 0.3 * Math.max(r.w, 0.5);
      const members = runs.filter(inside);
      const x0 = Math.min(sp.x0, ...members.map((r) => r.x));
      const x1 = Math.max(sp.x1, ...members.map((r) => r.x + r.w));
      const id = addCrop(crops, page, x0, x1, b, 'ink', plain(members));
      runs = runs.filter((r) => !inside(r));
      tokens.push({ x: x0, w: x1 - x0, y: b.y0, size: sz, s: '', font: {}, token: { t: 'ink', id, alt: plain(members) } });
    }
  }
  return [...runs, ...tokens];
}

function addCrop(crops, page, x0, x1, b, kind, alt) {
  const id = crops.length;
  const pad = 1.2;
  crops.push({
    id, page, kind, alt,
    x0: x0 - pad, x1: x1 + pad, y0: b.bot - pad, y1: b.top + pad,
    base: b.y0, size: b.size || 10,
  });
  return id;
}

/* -------------------------------------------------------------------------------- page analysis */

function detectRepeating(pages) {
  /* Header and footer text repeats across pages at the same height; digits may change. */
  const seen = new Map();
  pages.forEach((pg, idx) => {
    for (const b of pg.bands) {
      const zone = b.y0 > pg.h * 0.88 || b.y0 < pg.h * 0.12;
      if (!zone) continue;
      const key = b.text.replace(/\d+/g, '#').replace(/\s+/g, '').slice(0, 80);
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(idx);
    }
  });
  const rep = new Set();
  for (const [k, v] of seen) if (v.size >= 2) rep.add(k);
  return rep;
}

function analyzePage(pg, idx, crops) {
  const { H, V, shapes, frames } = splitGraphics(pg);
  let flow = pg.runs;
  const regions = [];

  /* tables and frames */
  const grids = findGridClusters(H, V);
  const uniqFrames = frames.filter((f, i) => !frames.some((o, j) => j < i && Math.abs(o.x0 - f.x0) < 2 && Math.abs(o.x1 - f.x1) < 2 && Math.abs(o.y0 - f.y0) < 2 && Math.abs(o.y1 - f.y1) < 2));
  for (const f of uniqFrames) {
    if (grids.some((g) => f.x0 >= g.x0 - 2 && f.x1 <= g.x1 + 2 && f.y0 >= g.y0 - 2 && f.y1 <= g.y1 + 2)) continue;
    grids.push({
      x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1, framed: true,
      H: [{ y: f.y0, x0: f.x0, x1: f.x1 }, { y: f.y1, x0: f.x0, x1: f.x1 }],
      V: [{ x: f.x0, y0: f.y0, y1: f.y1 }, { x: f.x1, y0: f.y0, y1: f.y1 }],
    });
  }
  for (const g of grids) {
    const inner = flow.filter((r) => inBox(r, g, 1.5));
    if (!inner.length) continue;
    const lines = toBands(inner);
    const monoShare = inner.filter((r) => r.font.mono).reduce((n, r) => n + r.s.length, 0) / Math.max(1, inner.reduce((n, r) => n + r.s.length, 0));
    if (!g.V.length && lines.length <= 1 && monoShare < 0.5) continue; // header rule pair around a title
    if (g.y1 > pg.h * 0.9 && lines.length <= 2 && monoShare < 0.5) continue;
    if (lines.length === 1 && g.y1 - g.y0 > 40 && monoShare < 0.5 && !g.V.length) continue;
    const grid = buildGrid(g, flow);
    if (grid) regions.push({ kind: 'grid', box: g, grid, top: g.y1, bottom: g.y0, runs: grid.inner });
    else {
      const id = crops.length;
      crops.push({ id, page: idx, kind: 'fig', alt: plain(inner), x0: g.x0 - 3, x1: g.x1 + 3, y0: g.y0 - 3, y1: g.y1 + 3, base: g.y0, size: 10 });
      regions.push({ kind: 'fig', id, box: g, top: g.y1, bottom: g.y0, runs: inner, w: g.x1 - g.x0 + 6, h: g.y1 - g.y0 + 6 });
    }
    const set = new Set(regions[regions.length - 1].runs);
    flow = flow.filter((r) => !set.has(r));
    /* line numbers printed just left of a frame */
    if (g.V.length) {
      flow = flow.filter((r) => !(/^\d+$/.test(r.s) && r.x + r.w <= g.x0 + 1 && r.x + r.w > g.x0 - 34 && r.y < g.y1 + 2 && r.y > g.y0 - 2));
    }
  }

  /* figures: drawn things, plus rules that form a drawing rather than a fraction bar */
  const marks = shapes.filter((s) => s.kind !== 'tint' && !regions.some((r) => s.x0 >= r.box.x0 - 2 && s.x1 <= r.box.x1 + 2 && s.y0 >= r.box.y0 - 2 && s.y1 <= r.box.y1 + 2));
  const inGrid = (x0, x1, y0, y1) => regions.some((r) => x0 >= r.box.x0 - 3 && x1 <= r.box.x1 + 3 && y0 >= r.box.y0 - 3 && y1 <= r.box.y1 + 3);
  const leftoverRules = H.filter((h) => !inGrid(h.x0, h.x1, h.y, h.y));
  const leftoverV = V.filter((v) => !inGrid(v.x, v.x, v.y0, v.y1));
  const boxes = [
    ...marks.map((m) => ({ ...m, o: 'm' })),
    ...leftoverRules.filter((r) => r.x1 - r.x0 < pg.w * 0.6).map((r) => ({ kind: 'rule', x0: r.x0, x1: r.x1, y0: r.y, y1: r.y, o: 'h', src: r })),
    ...leftoverV.filter((r) => r.y1 - r.y0 < pg.h * 0.5).map((r) => ({ kind: 'rule', x0: r.x, x1: r.x, y0: r.y0, y1: r.y1, o: 'v', src: r })),
  ];
  const dsu = new DSU(boxes.length);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const gapX = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
      const gapY = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
      if (gapX < 16 && gapY < 16) dsu.union(i, j);
    }
  }
  const figs = new Map();
  boxes.forEach((m, i) => {
    const k = dsu.find(i);
    if (!figs.has(k)) figs.set(k, { x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1, marks: 0, h: 0, v: 0, image: false, rules: [] });
    const f = figs.get(k);
    f.x0 = Math.min(f.x0, m.x0); f.x1 = Math.max(f.x1, m.x1);
    f.y0 = Math.min(f.y0, m.y0); f.y1 = Math.max(f.y1, m.y1);
    if (m.o === 'm') f.marks++; else if (m.o === 'h') { f.h++; f.rules.push(m.src); } else { f.v++; f.rules.push(m.src); }
    if (m.kind === 'image') f.image = true;
  });
  const figures = [];
  const figRules = new Set();
  for (const f of figs.values()) {
    const w = f.x1 - f.x0, h = f.y1 - f.y0;
    if (w * h < 220 || w < 12 || h < 12) continue;
    if (!f.marks && !(f.h >= 2 && f.v >= 2)) continue;
    figures.push(f);
    f.rules.forEach((r) => figRules.add(r));
  }

  /* bands from whatever text is left */
  const fractionRules = leftoverRules.filter((r) => !figRules.has(r) && !figures.some((f) => r.y >= f.y0 - 1 && r.y <= f.y1 + 1 && r.x0 >= f.x0 - 1 && r.x1 <= f.x1 + 1));
  let bands = toBands(flow);
  const textW = pct(bands.map((b) => b.x1 - b.x0), 0.8) || pg.w * 0.7;
  for (const f of figures) {
    const absorbed = bands.filter((b) => (b.x1 - b.x0) < textW * 0.55 && b.top <= f.y1 + 16 && b.bot >= f.y0 - 16 && b.x0 >= f.x0 - 26 && b.x1 <= f.x1 + 26);
    for (const b of absorbed) {
      f.x0 = Math.min(f.x0, b.x0); f.x1 = Math.max(f.x1, b.x1);
      f.y0 = Math.min(f.y0, b.bot); f.y1 = Math.max(f.y1, b.top);
    }
    const set = new Set(absorbed);
    bands = bands.filter((b) => !set.has(b));
    bands = bands.flatMap((b) => {
      // a run inside the figure but in a band stretching outside it
      const keep = b.runs.filter((r) => !inBox(r, f, 0));
      if (keep.length === b.runs.length) return [b];
      if (!keep.length) return [];
      const nb = { runs: keep, top: Math.max(...keep.map((r) => r.y + 0.72 * r.size)), bot: Math.min(...keep.map((r) => r.y - 0.2 * r.size)) };
      finishBand(nb);
      return [nb];
    });
    f.alt = '';
  }

  pg.bands = bands;
  pg.regions = regions;
  pg.figures = figures;
  pg.fractionRules = fractionRules;
  return pg;
}

/* ---------------------------------------------------------------------------- document assembly */

function cellBlocks(runs, crops, page) {
  const lines = toBands(runs);
  const toks = [];
  lines.forEach((b, i) => {
    if (i) toks.push({ t: 'br' });
    const merged = resolveStacks(b, [], page, crops);
    toks.push(...tidyTokens(tokenize(merged, b.y0, b.size, 0, crops, page)));
  });
  return toks;
}

function monoText(runs) {
  const lines = toBands(runs);
  const widths = runs.filter((r) => r.s.length).map((r) => r.w / r.s.length).filter((w) => w > 0);
  const cw = median(widths) || 5.2;
  const minX = Math.min(...runs.map((r) => r.x));
  return lines.map((b) => {
    let s = '';
    for (const r of [...b.runs].sort((p, q) => p.x - q.x)) {
      const col = Math.max(0, Math.round((r.x - minX) / cw));
      if (s.length < col) s += ' '.repeat(col - s.length);
      else if (s.length && r.lead) s += ' ';
      s += r.s;
    }
    return s.replace(/\s+$/, '');
  }).join('\n');
}

const looksLikeSampleHead = (s) => /(^|\b)(standard\s+)?(input|output|stdin|stdout)\b|\.in\b|\.out\b|\.ans\b|输入|输出|入力|出力|sample|example|ввод|вывод/i.test(s);

function gridToBlocks(region, crops, page) {
  const { grid } = region;
  const { cells, rows, cols } = grid;
  const chars = (rs) => rs.reduce((n, r) => n + r.s.length, 0);
  const monoShare = (rs) => { const c = chars(rs); return c ? rs.filter((r) => r.font.mono).reduce((n, r) => n + r.s.length, 0) / c : 0; };
  if (cells.length === 1) {
    const rs = cells[0].runs;
    if (!rs.length) return [];
    if (monoShare(rs) > 0.6) return [{ t: 'pre', s: monoText(rs), top: region.top }];
    return [{ t: 'box', k: cellBlocks(rs, crops, page), top: region.top }];
  }
  /* samples: a header row naming input and output, or cells of mono text */
  const byRow = new Map();
  for (const c of cells) { if (!byRow.has(c.r0)) byRow.set(c.r0, []); byRow.get(c.r0).push(c); }
  const rowIds = [...byRow.keys()].sort((a, b) => a - b);
  const first = (byRow.get(rowIds[0]) || []).map((c) => plain(c.runs));
  const headNamed = first.length >= 2 && first.some(looksLikeSampleHead);
  const body = cells.filter((c) => !headNamed || c.r0 !== rowIds[0]);
  const bodyMono = monoShare(body.flatMap((c) => c.runs));
  if (cols >= 2 && cols <= 3 && (headNamed || bodyMono > 0.75) && cells.every((c) => c.r0 === c.r1)) {
    const rowsOut = [];
    for (const r of rowIds) {
      if (headNamed && r === rowIds[0]) continue;
      const row = byRow.get(r).sort((a, b) => a.c0 - b.c0);
      rowsOut.push(row.map((c) => (c.runs.length ? (monoShare(c.runs) > 0.5 ? { s: monoText(c.runs) } : { k: cellBlocks(c.runs, crops, page) }) : { s: '' })));
    }
    return [{ t: 'samples', head: headNamed ? first : null, rows: rowsOut, top: region.top }];
  }
  const tableRows = [];
  for (const r of rowIds) {
    const row = byRow.get(r).sort((a, b) => a.c0 - b.c0);
    tableRows.push(row.map((c) => ({
      k: c.runs.length ? cellBlocks(c.runs, crops, page) : [],
      rs: c.r1 - c.r0 + 1, cs: c.c1 - c.c0 + 1,
    })));
  }
  return [{ t: 'table', rows: tableRows, nrows: rows, ncols: cols, top: region.top }];
}

const endsSentence = (s) => /[.。;；:：!?！？]\s*$/.test(s);

function bandTokens(b, page, crops, rules) {
  const merged = resolveStacks(b, rules, page, crops);
  return tidyTokens(tokenize(merged, b.y0, b.size, 0, crops, page));
}

function joinLines(prevTokens, nextTokens) {
  /* Line break inside a paragraph: a space, nothing between CJK, a removed hyphen in a split word. */
  const last = prevTokens[prevTokens.length - 1];
  const first = nextTokens[0];
  if (last && last.t === 'text' && first && first.t === 'text') {
    if (CJK_END.test(last.s) && CJK_START.test(first.s)) return [...prevTokens, ...nextTokens];
    if (!last.m && !last.c && /[a-zа-я]-$/i.test(last.s) && /^[a-zа-я]/.test(first.s)) {
      last.s = last.s.slice(0, -1);
      return [...prevTokens, ...nextTokens];
    }
  }
  return [...prevTokens, { t: 'text', s: ' ' }, ...nextTokens];
}

export function analyzeDocument(pagesRaw, opts = {}) {
  const crops = [];
  const pages = pagesRaw.map((pg, i) => analyzePage(pg, i, crops));

  /* logos and page decoration: the same image in the same place on several pages */
  const figCount = new Map();
  const figKey = (f) => `${Math.round(f.x0 / 4)},${Math.round(f.y0 / 4)},${Math.round(f.x1 / 4)},${Math.round(f.y1 / 4)}`;
  pages.forEach((pg) => pg.figures.forEach((f) => figCount.set(figKey(f), (figCount.get(figKey(f)) || 0) + 1)));
  pages.forEach((pg) => {
    pg.figures = pg.figures.filter((f) => {
      if ((figCount.get(figKey(f)) || 0) >= 2) return false;
      if (f.y0 > pg.h * 0.78 && (f.image || f.x1 - f.x0 < 130)) return false;
      if (f.y1 < pg.h * 0.06) return false;
      return true;
    });
  });

  const allBands = pages.flatMap((p) => p.bands);
  const sizeWeight = new Map();
  for (const b of allBands) {
    const k = Math.round(b.size * 2) / 2;
    sizeWeight.set(k, (sizeWeight.get(k) || 0) + b.chars);
  }
  let body = 10, bw = -1;
  for (const [k, v] of sizeWeight) if (v > bw) { bw = v; body = k; }

  const repeating = detectRepeating(pages);
  const meta = { source: '', title: '', limits: {}, pages: pages.length };
  const totalChars = allBands.reduce((n, b) => n + b.chars, 0) + pages.flatMap((p) => p.regions).reduce((n, r) => n + (r.runs || []).reduce((m, x) => m + x.s.length, 0), 0);
  const garbled = allBands.flatMap((b) => b.runs).filter((r) => PUA.test(r.s)).reduce((n, r) => n + r.s.length, 0);

  const blocks = [];
  const push = (blk) => { blocks.push(blk); };

  const markTitleBlock = (pg) => {
    /* The title is the first big line near the top. Lines above it name the contest, lines right
       under it give the limits. The page header already shows all of that. */
    const bands = pg.bands;
    let t = -1;
    for (let i = 0; i < Math.min(bands.length, 8); i++) {
      if (bands[i].y0 < pg.h * 0.55) break;
      if (bands[i].size >= body * 1.28 && !META_LINE.test(bands[i].text.trim())) { t = i; break; }
    }
    if (t < 0) {
      /* no big title: still take a run of limit lines from the top */
      for (let i = 0; i < Math.min(bands.length, 6); i++) {
        const txt = bands[i].text.trim();
        if (META_LINE.test(txt) || META_LINE_CN.test(txt)) {
          const m = txt.match(/^(.+?)\s*[:：]\s*(.+)$/);
          if (m) meta.limits[m[1].toLowerCase().replace(/\s+/g, ' ')] = m[2];
          bands[i].consumed = true;
        }
      }
      return;
    }
    const src = [];
    for (let i = 0; i < t; i++) {
      if (bands[i].chars > 140) return;
      src.push(bands[i].text.trim());
      bands[i].consumed = true;
    }
    if (src.length && !meta.source) meta.source = src.join(' · ');
    let i = t;
    const title = [];
    while (i < bands.length && bands[i].size >= body * 1.28 && !META_LINE.test(bands[i].text.trim())) {
      title.push(bands[i].text.trim());
      bands[i].consumed = true;
      i++;
    }
    meta.title = title.join(' ');
    /* limit lines and short one-liners between the title and the first real sentence */
    for (let n = 0; n < 8 && i < bands.length; n++, i++) {
      const b = bands[i];
      const txt = b.text.trim();
      if (META_LINE.test(txt) || META_LINE_CN.test(txt)) {
        const m = txt.match(/^(.+?)\s*[:：]\s*(.+)$/);
        if (m) meta.limits[m[1].toLowerCase().replace(/\s+/g, ' ').replace(/\ble$/, 'file')] = m[2];
        b.consumed = true;
        continue;
      }
      if (b.boldShare > 0.45 && !KEYWORD_HEADING.test(txt) && !/[。]$/.test(txt) && txt.length < 110) {
        if (/memory|limit|source|time|stage|round|day/i.test(txt) || n === 0) {
          if (!meta.source) meta.source = txt.replace(/\s{2,}/g, ' ');
          b.consumed = true;
          continue;
        }
      }
      break;
    }
  };

  pages.forEach((pg, pi) => {
    /* strip header and footer */
    pg.bands = pg.bands.filter((b, idx) => {
      const key = b.text.replace(/\d+/g, '#').replace(/\s+/g, '').slice(0, 80);
      const zoneTop = b.y0 > pg.h * 0.88, zoneBot = b.y0 < pg.h * 0.12;
      if (!zoneTop && !zoneBot) return true;
      if (repeating.has(key)) {
        if (pi === 0 && zoneTop && !meta.source) meta.source = b.text;
        return false;
      }
      if (PAGE_NO.test(b.text.trim())) return false;
      if (pages.length === 1 || pi === 0) {
        if (zoneTop && idx === 0 && b.size <= body * 1.1) {
          const next = pg.bands[idx + 1];
          if (next && b.y0 - next.y0 > body * 1.9) { if (!meta.source) meta.source = b.text; return false; }
        }
        if (zoneBot && idx === pg.bands.length - 1) {
          const prev = pg.bands[idx - 1];
          if (prev && prev.y0 - b.y0 > body * 2.4 && b.chars < 90) return false;
        }
      }
      return true;
    });

    if (pi === 0) markTitleBlock(pg);
    const xs = pg.bands.filter((b) => b.chars > 30 && b.monoShare < 0.5 && !b.consumed).map((b) => b.x0);
    const margin = xs.length ? pct(xs, 0.2) : (pg.bands.length ? Math.min(...pg.bands.map((b) => b.x0)) : 60);
    const rights = pg.bands.filter((b) => b.chars > 30 && !b.consumed).map((b) => b.x1);
    const rightMargin = rights.length ? pct(rights, 0.85) : pg.w - margin;
    const leadDiffs = [];
    for (let i = 1; i < pg.bands.length; i++) {
      const a = pg.bands[i - 1], b = pg.bands[i];
      if (Math.abs(a.size - b.size) < 0.6 && a.size > body * 0.9 && a.monoShare < 0.5 && b.monoShare < 0.5) leadDiffs.push(a.y0 - b.y0);
    }
    /* the low mode is the line spacing; the higher values are paragraph gaps */
    const leading = pct(leadDiffs.filter((d) => d > 0), 0.3) || body * 1.25;

    /* merge flow lines and regions by height */
    const elems = [
      ...pg.bands.map((b) => ({ kind: 'band', b, top: b.top, bottom: b.bot })),
      ...pg.regions,
      ...pg.figures.map((f) => ({ kind: 'figure', f, top: f.y1, bottom: f.y0 })),
    ].sort((a, b) => b.top - a.top);

    let para = null;
    let listItem = null;
    const flushPara = () => { para = null; listItem = null; };

    let monoRun = [];
    let monoLabels = null;
    const flushMono = () => {
      if (!monoRun.length) return;
      const runs = monoRun.flatMap((b) => b.runs);
      if (monoLabels) {
        const at = monoLabels.at - body;
        const left = runs.filter((r) => r.x < at), right = runs.filter((r) => r.x >= at);
        push({ t: 'samples', head: monoLabels.labels, rows: [[{ s: left.length ? monoText(left) : '' }, { s: right.length ? monoText(right) : '' }]] });
        monoLabels = null;
        monoRun = [];
        return;
      }
      /* two columns of mono text: an input and an output printed side by side */
      const gaps = monoRun.map((b) => {
        const rs = [...b.runs].sort((p, q) => p.x - q.x);
        let best = 0, at = 0;
        for (let i = 1; i < rs.length; i++) {
          const g = rs[i].x - (rs[i - 1].x + rs[i - 1].w);
          if (g > best) { best = g; at = rs[i].x; }
        }
        return { best, at };
      });
      const cols = gaps.filter((g) => g.best > body * 4).map((g) => g.at);
      const split = cols.length >= Math.max(1, monoRun.length * 0.4) ? median(cols) - 1 : null;
      if (split !== null && runs.some((r) => r.x + r.w < split) && runs.some((r) => r.x >= split)) {
        const left = runs.filter((r) => r.x < split), right = runs.filter((r) => r.x >= split);
        push({ t: 'samples', head: null, rows: [[{ s: monoText(left) }, { s: monoText(right) }]], top: 0 });
      } else push({ t: 'pre', s: monoText(runs), top: monoRun[0].top });
      monoRun = [];
    };

    for (let ei = 0; ei < elems.length; ei++) {
      const el = elems[ei];
      if (el.kind !== 'band') {
        flushMono();
        flushPara();
        if (el.kind === 'grid') {
          /* frames side by side are one sample: gather them */
          const same = [el];
          while (elems[ei + 1] && elems[ei + 1].kind === 'grid' && elems[ei + 1].bottom < el.top && elems[ei + 1].top > el.bottom
            && Math.min(el.top, elems[ei + 1].top) - Math.max(el.bottom, elems[ei + 1].bottom) > 0.5 * Math.min(el.top - el.bottom, elems[ei + 1].top - elems[ei + 1].bottom)) {
            same.push(elems[++ei]);
          }
          same.sort((p, q) => p.box.x0 - q.box.x0);
          const outs = same.flatMap((r) => gridToBlocks(r, crops, pi));
          if (outs.length >= 2 && outs.every((o) => o.t === 'pre')) {
            const prev = blocks[blocks.length - 1];
            const head = prev && prev.t === 'heads' ? prev.labels : null;
            if (head) blocks.pop();
            push({ t: 'samples', head, rows: [outs.map((o) => ({ s: o.s }))] });
          } else if (outs.length >= 2 && outs.every((o) => o.t === 'box' && plainTokens(o.k).length < 30)) {
            push({ t: 'heads', labels: outs.map((o) => plainTokens(o.k)) });
          } else outs.forEach((x) => push(x));
        } else if (el.kind === 'fig') {
          push({ t: 'fig', id: el.id, w: el.w, h: el.h });
        } else if (el.kind === 'figure') {
          const f = el.f;
          const id = crops.length;
          crops.push({ id, page: pi, kind: 'fig', alt: '', x0: f.x0 - 3, x1: f.x1 + 3, y0: f.y0 - 3, y1: f.y1 + 3, base: f.y0, size: 10 });
          push({ t: 'fig', id, w: f.x1 - f.x0 + 6, h: f.y1 - f.y0 + 6 });
        }
        continue;
      }
      const b = el.b;
      const txt = b.text.trim();
      if (!txt) continue;

      /* the title block on the first page: handled before the loop, see markTitleBlock() */
      if (b.consumed) continue;

      /* code and sample lines */
      if (b.monoShare > 0.9) {
        const prevB = blocks[blocks.length - 1];
        if (!monoRun.length && prevB && prevB.t === 'p' && prevB.labelGap && Math.abs(prevB.lastY - b.y0) < body * 3.2) {
          monoLabels = prevB.labelGap;
          blocks.pop();
        }
        flushPara();
        monoRun.push({ runs: b.runs, top: b.top });
        continue;
      }
      flushMono();

      /* headings */
      const sentenceEnd = /[.。;；,，]\s*$/.test(txt);
      const kw = KEYWORD_HEADING.test(txt);
      const bold = b.boldShare > 0.8;
      const bigger = b.size >= body * 1.12;
      if (txt.length <= 90 && !sentenceEnd && ((bold || bigger) && !/^[a-zа-я]/.test(txt) || (kw && txt.length < 40))) {
        flushPara();
        const level = kw ? 3 : (b.size >= body * 1.35 ? 2 : 4);
        const clean = bandTokens(b, pi, crops, pg.fractionRules).map((t) => (t.t === 'text' ? { ...t, b: 0 } : t));
        if (clean[0] && clean[0].t === 'text') clean[0].s = clean[0].s.replace(/^\s*【\s*/, '');
        const lastT = clean[clean.length - 1];
        if (lastT && lastT.t === 'text') lastT.s = lastT.s.replace(/\s*】\s*$/, '').replace(/[:：]\s*$/, '');
        push({ t: 'h', l: level, k: clean });
        continue;
      }

      /* centred lines: display formulas */
      const leftGap = b.x0 - margin;
      const rightGap = rightMargin - b.x1;
      const centred = leftGap > body * 2.5 && Math.abs(leftGap - rightGap) < body * 1.6 && b.x1 - b.x0 < (rightMargin - margin) * 0.82;
      const tokens = bandTokens(b, pi, crops, pg.fractionRules);
      if (centred) {
        flushPara();
        push({ t: 'display', k: tokens });
        continue;
      }

      /* lists */
      const first = tokens[0];
      const firstText = first && first.t === 'text' ? first.s : '';
      const bulletMatch = firstText.match(BULLET);
      const orderedMatch = firstText.match(ORDERED);
      if (bulletMatch || (orderedMatch && (b.x0 > margin + 2 || !para))) {
        flushPara();
        const m = bulletMatch || orderedMatch;
        const rest = firstText.slice(m[0].length);
        const k = rest ? [{ ...first, s: rest }, ...tokens.slice(1)] : tokens.slice(1);
        const textStart = (() => {
          const rs = [...b.runs].sort((p, q) => p.x - q.x);
          return rs.length > 1 && m[0].trim() === rs[0].s ? rs[1].x : b.x0 + body * 1.2;
        })();
        listItem = { t: 'li', mark: m[0].trim(), k, lvl: Math.max(0, Math.round((b.x0 - margin) / (body * 2.2))), left: textStart, lastY: b.y0, lastRight: b.x1 };
        push(listItem);
        continue;
      }
      if (listItem) {
        const gap = listItem.lastY - b.y0;
        if (gap < leading * 1.5 && b.x0 > listItem.left - body * 1.1 && b.x0 > margin + 2) {
          listItem.k = joinLines(listItem.k, tokens);
          listItem.lastY = b.y0;
          listItem.lastRight = b.x1;
          continue;
        }
        listItem = null;
      }

      /* paragraphs */
      if (para) {
        const gap = para.lastY - b.y0;
        const indented = b.x0 - para.lastLeft > body * 0.9;
        /* a line ends early on purpose when the next word would have fit on it */
        const rs = [...b.runs].sort((p, q) => p.x - q.x);
        const r0 = rs[0];
        const word = (r0.s.match(CJK_START) ? r0.s.slice(0, 1) : r0.s.split(/\s+/)[0]) || '';
        const wordW = r0.s.length ? (r0.w / r0.s.length) * word.length : 0;
        const room = rightMargin - para.lastRight;
        const shortPrev = room > wordW + 0.5 * body && room > body * 1.2;
        const continues = /^[a-zа-я(,]/.test(txt) && !shortPrev;
        const bigGap = gap > leading * (continues ? 1.65 : 1.18);
        if (!bigGap && !indented && !shortPrev) {
          para.k = joinLines(para.k, tokens);
          para.lastY = b.y0; para.lastLeft = b.x0; para.lastRight = b.x1;
          continue;
        }
      }
      para = { t: 'p', k: tokens, lastY: b.y0, lastLeft: b.x0, lastRight: b.x1, firstOnPage: !blocks.some((x) => x.page === pi), page: pi, rightMargin, margin };
      /* "For the input data:      the correct result is:" sits over two columns of mono text */
      {
        const rs = [...b.runs].sort((p, q) => p.x - q.x);
        let best = 0, at = 0, cut = 0;
        for (let i = 1; i < rs.length; i++) {
          const g = rs[i].x - (rs[i - 1].x + rs[i - 1].w);
          if (g > best) { best = g; at = rs[i].x; cut = i; }
        }
        if (best > body * 4 && txt.length < 90) {
          para.labelGap = { at, labels: [lineText({ runs: rs.slice(0, cut) }).replace(/[:：]\s*$/, ''), lineText({ runs: rs.slice(cut) }).replace(/[:：]\s*$/, '')] };
        }
      }
      push(para);
    }
    flushMono();
    flushPara();
  });

  /* a paragraph split by a page break */
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1], b = blocks[i];
    if (a.t === 'p' && b.t === 'p' && a.page !== b.page && b.firstOnPage && a.lastRight >= a.rightMargin - body * 2.6 && Math.abs(b.lastLeft - b.margin) < body && !endsSentence(plainTokens(a.k))) {
      a.k = joinLines(a.k, b.k);
      blocks.splice(i, 1);
      i--;
    }
  }

  const clean = blocks.map((blk) => {
    const { lastY, lastLeft, lastRight, firstOnPage, page, rightMargin, margin, left, top, labelGap, ...rest } = blk;
    return rest;
  }).filter((blk) => blk.t !== 'heads' && !(blk.t === 'p' && !plainTokens(blk.k).trim()));

  /* Sample Input / pre / Sample Output / pre reads as one sample. A frame cut by a page break is one frame. */
  for (let i = 0; i + 1 < clean.length; i++) {
    if (clean[i].t === 'pre' && clean[i + 1].t === 'pre') {
      clean[i].s += `\n${clean[i + 1].s}`;
      clean.splice(i + 1, 1);
      i--;
    }
  }
  const INPUT_HEAD = /(sample|example|样例|输入|input|入力)/i;
  const isIn = (b) => b && b.t === 'h' && /input|输入|入力/i.test(plainTokens(b.k)) && INPUT_HEAD.test(plainTokens(b.k));
  const isOut = (b) => b && b.t === 'h' && /output|输出|出力/i.test(plainTokens(b.k));
  for (let i = 0; i + 3 < clean.length; i++) {
    if (isIn(clean[i]) && clean[i + 1].t === 'pre' && isOut(clean[i + 2]) && clean[i + 3].t === 'pre') {
      clean.splice(i, 4, {
        t: 'samples',
        head: [plainTokens(clean[i].k), plainTokens(clean[i + 2].k)],
        rows: [[{ s: clean[i + 1].s }, { s: clean[i + 3].s }]],
      });
    }
  }

  const usedInk = new Set();
  const walk = (tks) => tks && tks.forEach((t) => {
    if (t.t === 'ink') usedInk.add(t.id);
    if (t.k) walk(t.k);
    if (t.sup) walk(t.sup);
    if (t.sub) walk(t.sub);
    if (t.n) walk(t.n);
    if (t.d) walk(t.d);
  });
  for (const blk of clean) {
    if (blk.k) walk(blk.k);
    if (blk.t === 'fig') usedInk.add(blk.id);
    if (blk.rows) blk.rows.forEach((row) => row.forEach((c) => c.k && walk(c.k)));
  }

  return {
    v: VERSION,
    meta,
    bodySize: body,
    chars: totalChars,
    garbledShare: totalChars ? garbled / totalChars : 0,
    blocks: clean,
    crops: crops.filter((c) => usedInk.has(c.id)),
    text: opts.includeText ? clean.map((b) => (b.k ? plainTokens(b.k) : '')).join('\n') : undefined,
  };
}

/* A page of scanned images or outlined glyphs has no usable text. */
export function needsPageImages(doc, pageCount) {
  if (doc.chars < 60 * pageCount && doc.blocks.length < 5) return true;
  if (doc.garbledShare > 0.08) return true;
  return false;
}

export { plainTokens };
