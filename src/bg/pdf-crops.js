/* pdf-crops.js: renders the rectangles a statement could not express as text.

   Runs in the background page, where pdf.js can use a real worker and a canvas. Paper becomes
   transparent: each pixel is split into ink colour plus coverage, so the crop sits on glass the way
   the text around it does. Formula crops keep only the coverage and take the text colour in the page.
   Pictures that are really photographs stay as they are. */

const RENDER_SCALE = 3;

function inkify(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let mid = 0, colored = 0, marked = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const min = Math.min(r, g, b), max = Math.max(r, g, b);
    if (min < 245) marked++;
    if (min > 60 && min < 215) mid++;
    if (max - min > 40) colored++;
    const a = 1 - min / 255;
    if (a <= 0.004) { d[i + 3] = 0; continue; }
    d[i] = Math.round((r - (1 - a) * 255) / a);
    d[i + 1] = Math.round((g - (1 - a) * 255) / a);
    d[i + 2] = Math.round((b - (1 - a) * 255) / a);
    d[i + 3] = Math.round(a * 255);
  }
  const total = (w * h) || 1;
  const photo = mid / total > 0.35;
  return { img, photo, marked: marked / total, colored: colored / total };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export async function renderCrops(doc, crops) {
  const byPage = new Map();
  for (const c of crops) {
    if (!byPage.has(c.page)) byPage.set(c.page, []);
    byPage.get(c.page).push(c);
  }
  const out = {};
  for (const [pageIdx, list] of byPage) {
    const page = await doc.getPage(pageIdx + 1);
    const vp = page.getViewport({ scale: RENDER_SCALE });
    const canvas = makeCanvas(vp.width, vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport: vp, background: '#ffffff' }).promise;
    for (const c of list) {
      const [ax, ay] = vp.convertToViewportPoint(c.x0, c.y1);
      const [bx, by] = vp.convertToViewportPoint(c.x1, c.y0);
      const sx = Math.max(0, Math.floor(Math.min(ax, bx)));
      const sy = Math.max(0, Math.floor(Math.min(ay, by)));
      const sw = Math.min(canvas.width - sx, Math.ceil(Math.abs(bx - ax)));
      const sh = Math.min(canvas.height - sy, Math.ceil(Math.abs(by - ay)));
      if (sw <= 0 || sh <= 0) continue;
      const part = makeCanvas(sw, sh);
      const pctx = part.getContext('2d', { willReadFrequently: true });
      pctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const res = inkify(pctx, sw, sh);
      if (!res.photo) pctx.putImageData(res.img, 0, 0);
      const url = part.toDataURL(res.photo ? 'image/jpeg' : 'image/png', 0.86);
      out[c.id] = {
        url,
        kind: c.kind,
        photo: res.photo,
        colored: res.colored > 0.01,
        wPt: c.x1 - c.x0,
        hPt: c.y1 - c.y0,
        basePt: c.base - c.y0,
        sizePt: c.size,
        alt: c.alt || '',
      };
    }
    page.cleanup();
  }
  return out;
}

/* The whole statement as inked pages: for scans, and for anyone who prefers the original layout. */
export async function renderPages(doc, maxPages = 24) {
  const pages = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const canvas = makeCanvas(vp.width, vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport: vp, background: '#ffffff' }).promise;
    const res = inkify(ctx, canvas.width, canvas.height);
    if (!res.photo) ctx.putImageData(res.img, 0, 0);
    pages.push({ url: canvas.toDataURL('image/webp', 0.82), photo: res.photo, w: vp.width / 2, h: vp.height / 2 });
    page.cleanup();
  }
  return pages;
}
