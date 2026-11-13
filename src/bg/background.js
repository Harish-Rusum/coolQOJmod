/* background.js: work a content script should not do itself.

   1. Turns statement PDFs into blocks. pdf.js needs a real worker and a canvas with embedded fonts,
      and the page's main thread should not pay for that.
   2. Plays sounds. An extension page is not held back by the browser's autoplay rules, so a title
      card can have its sound on a page the user has not clicked yet. */

import { analyzeDocument, extractPage, needsPageImages, VERSION } from './pdf2blocks.js';
import { renderCrops, renderPages } from './pdf-crops.js';
import '../shared/synth.js';

const api = globalThis.browser || globalThis.chrome;

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../vendor/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = api.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
      return lib;
    });
  }
  return pdfjsPromise;
}

async function openDoc(data) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data,
    isEvalSupported: false,
    fontExtraProperties: true,
    useSystemFonts: false,
    cMapUrl: api.runtime.getURL('vendor/pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: api.runtime.getURL('vendor/pdfjs/standard_fonts/'),
    wasmUrl: api.runtime.getURL('vendor/pdfjs/wasm/'),
    verbosity: 0,
  });
  return { lib, task, doc: await task.promise };
}

async function convert(data) {
  const { lib, task, doc } = await openDoc(new Uint8Array(data));
  try {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push(await extractPage(await doc.getPage(p), lib.OPS));
    const res = analyzeDocument(pages);
    if (needsPageImages(res, doc.numPages)) {
      return { v: VERSION, mode: 'pages', meta: res.meta, pages: await renderPages(doc) };
    }
    const art = await renderCrops(doc, res.crops);
    return { v: VERSION, mode: 'text', meta: res.meta, bodySize: res.bodySize, blocks: res.blocks, art };
  } finally {
    task.destroy();
  }
}

async function pageImages(data) {
  const { task, doc } = await openDoc(new Uint8Array(data));
  try {
    return { pages: await renderPages(doc) };
  } finally {
    task.destroy();
  }
}

/* ------------------------------------------------------------------------------------- sound */

const synth = globalThis.QS_SYNTH;
let settings = null;
let settingsAt = 0;
const buffers = new Map();

async function loadSoundSettings() {
  const now = Date.now();
  if (settings && now - settingsAt < 2000) return settings;
  const got = await api.storage.local.get('qs.settings');
  settings = (got['qs.settings'] || {}).sound || {};
  settingsAt = now;
  return settings;
}

api.storage.onChanged.addListener((changes) => {
  if (changes['qs.settings']) { settings = null; }
  for (const key of Object.keys(changes)) {
    if (key.startsWith('qs.snd.')) buffers.delete(key.slice(7));
  }
});

async function customBuffer(ev) {
  if (buffers.has(ev)) return buffers.get(ev);
  const key = `qs.snd.${ev}`;
  const got = await api.storage.local.get(key);
  const rec = got[key];
  if (!rec || !rec.data) { buffers.set(ev, null); return null; }
  try {
    const bin = atob(rec.data.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const buf = await synth.context().decodeAudioData(bytes.buffer);
    buffers.set(ev, buf);
    return buf;
  } catch {
    buffers.set(ev, null);
    return null;
  }
}

async function play(msg) {
  const s = await loadSoundSettings();
  if (s.on === false && !msg.force) return;
  const master = (s.volume === undefined ? 70 : s.volume) / 100;
  const ev = (s.events || {})[msg.ev] || {};
  if (ev.off && !msg.force) return;
  const vol = master * ((ev.vol === undefined ? 100 : ev.vol) / 100);
  const buf = await customBuffer(msg.ev);
  if (buf) return synth.playBuffer(buf, vol, { loop: !!msg.loop, tag: msg.ev });
  return synth.playEvent(msg.ev, vol, { pack: s.pack, loop: !!msg.loop, tag: msg.ev });
}

/* Only oj.uz's own file host, and only PDFs: this is the one request the background page makes for a page. */
async function fetchStatement(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'static.oj.uz' || !/\.pdf$/i.test(u.pathname)) throw new Error('Not a statement file');
  const res = await fetch(u.href);
  if (!res.ok) throw new Error(`The file host answered ${res.status}`);
  return { data: await res.arrayBuffer() };
}

api.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.qs) return undefined;
  switch (msg.qs) {
    case 'pdf':
      return convert(msg.data).catch((e) => ({ error: String(e && e.message || e) }));
    case 'pdf-pages':
      return pageImages(msg.data).catch((e) => ({ error: String(e && e.message || e) }));
    case 'fetch-statement':
      return fetchStatement(msg.url).catch((e) => ({ error: String(e && e.message || e) }));
    case 'sfx':
      return play(msg).then(() => true).catch(() => false);
    case 'sfx-stop':
      synth.stop(msg.tag, msg.fade);
      return Promise.resolve(true);
    case 'sfx-warm':
      return Promise.all((msg.evs || []).map(customBuffer)).then(() => true).catch(() => false);
    default:
      return undefined;
  }
});
