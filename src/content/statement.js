/* statement.js: QOJ's PDF statements as text on glass.

   The PDF is fetched here, with the page's own login, and handed to the background page. What comes back
   is a block tree which is built into the page and cached, so a statement converts once. Three views stay
   one click away: the text, the inked pages of the PDF on glass, and the original PDF. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const { el, icon } = QS;

  const CACHE_INDEX = 'qs.pdf.index';
  const CACHE_LIMIT = 150;
  const FORMAT = 3;

  /* ------------------------------------------------------------------------------- block to DOM */

  function inlineTokens(tokens, art) {
    const out = [];
    for (const t of tokens || []) {
      if (t.t === 'text') {
        let node = document.createTextNode(t.s);
        const math = t.m;
        if (t.c) node = el('code', null, node);
        if (t.i) node = el('i', null, node);
        if (t.b) node = el('b', null, node);
        if (math) node = el('span', { class: 'qs-m' }, node);
        out.push(node);
      } else if (t.t === 'sup') out.push(el('sup', { class: 'qs-m' }, inlineTokens(t.k, art)));
      else if (t.t === 'sub') out.push(el('sub', { class: 'qs-m' }, inlineTokens(t.k, art)));
      else if (t.t === 'ss') {
        out.push(el('span', { class: 'qs-ss qs-m' }, el('sup', null, inlineTokens(t.sup, art)), el('sub', null, inlineTokens(t.sub, art))));
      } else if (t.t === 'frac') {
        out.push(el('span', { class: 'qs-frac qs-m' }, el('span', { class: 'qs-num' }, inlineTokens(t.n, art)), el('span', { class: 'qs-den' }, inlineTokens(t.d, art))));
      } else if (t.t === 'ink') {
        out.push(inkNode(art && art[t.id], t.alt));
      } else if (t.t === 'br') out.push(el('br'));
    }
    return out;
  }

  /* A formula crop takes the colour of the text around it and scales with the statement's size. */
  function inkNode(a, alt) {
    if (!a) return document.createTextNode(alt || '');
    const em = a.sizePt || 10;
    return el('span', {
      class: 'qs-ink',
      role: 'img',
      'aria-label': alt || '',
      title: alt || '',
      style: {
        width: `${(a.wPt / em).toFixed(3)}em`,
        height: `${(a.hPt / em).toFixed(3)}em`,
        verticalAlign: `${(-a.basePt / em).toFixed(3)}em`,
        maskImage: `url("${a.url}")`,
      },
    });
  }

  function copyButton(getText) {
    const label = el('span', { text: 'Copy' });
    const btn = el('button', { class: 'qs-copy', type: 'button', title: 'Copy to clipboard' }, icon('copy', 14), label);
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getText());
        label.textContent = 'Copied';
      } catch {
        label.textContent = 'Press Ctrl+C';
      }
      setTimeout(() => { label.textContent = 'Copy'; }, 1400);
    });
    return btn;
  }

  function sampleCell(cell, art, labelText) {
    const isText = cell.s !== undefined;
    const head = el('div', { class: 'qs-sample-head' }, el('span', { text: labelText || '' }), isText && cell.s ? copyButton(() => cell.s) : null);
    const body = isText ? el('pre', { class: 'qs-sample-pre' }, cell.s) : el('div', { class: 'qs-sample-text' }, inlineTokens(cell.k, art));
    return el('div', { class: 'qs-sample-cell' }, head, body);
  }

  function renderBlocks(data) {
    const art = data.art || {};
    const root = el('div', { class: 'qs-statement-text' });
    const blocks = data.blocks || [];
    let list = null;
    for (const b of blocks) {
      if (b.t !== 'li') list = null;
      switch (b.t) {
        case 'h': {
          const tag = b.l === 2 ? 'h3' : b.l === 3 ? 'h3' : 'h4';
          root.append(el(tag, { class: 'qs-h' }, inlineTokens(b.k, art)));
          break;
        }
        case 'p':
          root.append(el('p', null, inlineTokens(b.k, art)));
          break;
        case 'display':
          root.append(el('div', { class: 'qs-display' }, inlineTokens(b.k, art)));
          break;
        case 'li':
          if (!list) { list = el('ul', { class: 'qs-list' }); root.append(list); }
          list.append(el('li', { class: `qs-li qs-li-${Math.min(3, b.lvl || 0)}` }, el('span', { class: 'qs-mark', text: /^[•·∙◦▪‣⋆∗*–—-]$/.test(b.mark) ? '' : b.mark }), el('span', { class: 'qs-li-body' }, inlineTokens(b.k, art))));
          break;
        case 'pre':
          root.append(el('div', { class: 'qs-pre-wrap' }, copyButton(() => b.s), el('pre', null, b.s)));
          break;
        case 'box':
          root.append(el('div', { class: 'qs-box' }, inlineTokens(b.k, art)));
          break;
        case 'samples': {
          const wrap = el('div', { class: 'qs-samples' });
          b.rows.forEach((row, ri) => {
            const line = el('div', { class: 'qs-sample-row' });
            row.forEach((cell, ci) => {
              const fallback = ci === 0 ? 'Input' : ci === 1 ? 'Output' : 'Note';
              const label = (b.head && b.head[ci]) || `${fallback}${b.rows.length > 1 ? ` ${ri + 1}` : ''}`;
              line.append(sampleCell(cell, art, label));
            });
            wrap.append(line);
          });
          root.append(wrap);
          break;
        }
        case 'table': {
          const tbody = el('tbody');
          b.rows.forEach((row) => {
            tbody.append(el('tr', null, row.map((c) => el('td', { rowSpan: c.rs || 1, colSpan: c.cs || 1 }, inlineTokens(c.k, art)))));
          });
          root.append(el('div', { class: 'qs-table-wrap' }, el('table', { class: 'qs-table' }, tbody)));
          break;
        }
        case 'fig': {
          const a = art[b.id];
          if (a) {
            root.append(el('figure', { class: `qs-fig${a.photo ? ' qs-photo' : ''}` }, el('img', {
              src: a.url, alt: a.alt || 'Figure from the statement',
              style: { width: `${(a.wPt / (data.bodySize || 10)).toFixed(2)}em` },
            })));
          }
          break;
        }
        default:
      }
    }
    return root;
  }

  function renderPages(data) {
    return el('div', { class: 'qs-statement-pages' }, (data.pages || []).map((p, i) => el('img', {
      class: `qs-page-img${p.photo ? ' qs-photo' : ''}`, src: p.url, alt: `Statement page ${i + 1}`, loading: 'lazy',
    })));
  }

  /* --------------------------------------------------------------------------------------- cache */

  async function readCache(key) {
    const rec = await QS.get(`qs.pdf.${key}`);
    if (rec && rec.format === FORMAT) return rec.data;
    return null;
  }

  async function writeCache(key, data) {
    const index = (await QS.get(CACHE_INDEX)) || [];
    const next = [key, ...index.filter((k) => k !== key)];
    const drop = next.splice(CACHE_LIMIT);
    await QS.api.storage.local.set({ [`qs.pdf.${key}`]: { format: FORMAT, at: Date.now(), data }, [CACHE_INDEX]: next });
    if (drop.length) await QS.api.storage.local.remove(drop.map((k) => `qs.pdf.${k}`));
  }

  async function fetchPdf(url) {
    const href = new URL(url, location.href);
    /* oj.uz keeps its files on another host, which the background page may read */
    if (href.origin !== location.origin) {
      const got = await QS.api.runtime.sendMessage({ qs: 'fetch-statement', url: href.href });
      if (!got || got.error) throw new Error(got ? got.error : 'The converter did not answer');
      return got.data;
    }
    const res = await fetch(href.href, { credentials: 'include' });
    if (!res.ok) {
      const mitigated = res.headers.get('cf-mitigated');
      const err = new Error(`The site answered ${res.status}`);
      err.browserCheck = mitigated === 'challenge';
      throw err;
    }
    const buf = await res.arrayBuffer();
    const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 8)));
    /* a rate limiter answers with a normal HTML page */
    if (!head.startsWith('%PDF')) throw new Error('The site did not send a PDF, it may be rate limiting. Try again in a moment.');
    return buf;
  }

  /* --------------------------------------------------------------------------------------- views */

  QS.Statement = {
    /* Called as early as the iframe exists: stops the browser loading the PDF twice. */
    intercept(frame) {
      if (frame.dataset.qsSrc) return;
      const src = frame.getAttribute('src');
      if (!src || !/download\.php/.test(src)) return;
      frame.dataset.qsSrc = src;
      frame.setAttribute('src', 'about:blank');
    },

    /* opts.pdf: where the file itself is, when the frame shows it through a viewer page instead of directly */
    async mount(S, frame, onMeta, opts = {}) {
      const src = frame.dataset.qsSrc || frame.getAttribute('src');
      if (!src) return;
      const file = opts.pdf || src;
      const key = QS.hash(file).toString(36);
      const body = el('div', { class: 'qs-statement-body' });
      const seg = {};
      const bar = el('div', { class: 'qs-statement-bar' });
      const addSeg = (id, label) => {
        seg[id] = el('button', { type: 'button', class: 'qs-seg', text: label, onclick: () => show(id, true) });
        bar.append(seg[id]);
      };
      addSeg('text', 'Text');
      addSeg('pages', 'Pages');
      addSeg('pdf', 'PDF');
      const redo = el('button', {
        type: 'button', class: 'qs-seg qs-seg-icon', title: 'Convert this statement again',
        onclick: async () => {
          await QS.api.storage.local.remove(`qs.pdf.${key}`);
          textData = null;
          show('text', false);
        },
      }, icon('refresh', 14));
      bar.append(redo);
      const wrap = el('div', { class: 'qs-statement' }, bar, body);
      frame.before(wrap);
      frame.style.display = 'none';

      let textData = null;
      let pagesData = null;
      let current = null;
      let checked = false;

      const busy = (msg) => {
        body.replaceChildren(el('div', { class: 'qs-busy' }, el('span', { class: 'qs-busy-bar' }), el('span', { text: msg })));
      };
      const failed = (e) => {
        if (e.browserCheck && !checked) {
          /* Cloudflare wants to look at this browser first. It does that in a normal page load, so the
             statement loads in its frame as QOJ intended, and once that is done the text is tried again. */
          checked = true;
          body.replaceChildren(el('div', { class: 'qs-busy' }, el('span', { text: 'Cloudflare is checking this browser. The text version will follow once the PDF below has loaded.' })));
          frame.addEventListener('load', () => { if (current === 'text') setTimeout(() => show('text', false), 800); }, { once: true });
          frame.setAttribute('src', src);
          frame.style.display = '';
          return;
        }
        body.replaceChildren(el('div', { class: 'qs-busy qs-busy-err' }, el('span', { text: `Could not convert this statement. ${e.message || e}` }), el('button', { type: 'button', class: 'qs-seg', text: 'Show the PDF', onclick: () => show('pdf', true) })));
      };
      const typeset = () => {
        /* Statements with $...$ inside the PDF never happen, but figures need their ink filter after theme changes */
        document.dispatchEvent(new CustomEvent('qs:statement'));
      };

      const loadText = async () => {
        textData = await readCache(key);
        if (textData) return textData;
        busy('Turning the PDF into text');
        const buf = await fetchPdf(file);
        const res = await QS.api.runtime.sendMessage({ qs: 'pdf', data: buf });
        if (!res || res.error) throw new Error(res ? res.error : 'The converter did not answer');
        textData = res;
        await writeCache(key, res);
        return res;
      };

      const loadPages = async () => {
        if (pagesData) return pagesData;
        if (textData && textData.mode === 'pages') { pagesData = textData; return pagesData; }
        busy('Inking the pages');
        const buf = await fetchPdf(file);
        const res = await QS.api.runtime.sendMessage({ qs: 'pdf-pages', data: buf });
        if (!res || res.error) throw new Error(res ? res.error : 'The converter did not answer');
        pagesData = res;
        return res;
      };

      const show = async (view, remember) => {
        current = view;
        for (const [k, b] of Object.entries(seg)) b.classList.toggle('on', k === view);
        if (remember) {
          const next = QS.merge(S, { pdf: { view } });
          QS.S = next;
          QS.save(next);
        }
        frame.style.display = 'none';
        try {
          if (view === 'pdf') {
            frame.setAttribute('src', src);
            frame.style.display = '';
            body.replaceChildren();
            return;
          }
          if (view === 'pages') {
            const d = await loadPages();
            if (current === 'pages') body.replaceChildren(renderPages(d));
            return;
          }
          const d = await loadText();
          if (onMeta && d.meta) onMeta(d.meta);
          if (current !== 'text') return;
          if (d.mode === 'pages') {
            seg.text.disabled = true;
            pagesData = d;
            current = 'pages';
            seg.text.classList.remove('on');
            seg.pages.classList.add('on');
            body.replaceChildren(el('p', { class: 'qs-note', text: 'This PDF is a scan with no text inside it, so its pages are shown on glass.' }), renderPages(d));
          } else {
            body.replaceChildren(renderBlocks(d));
          }
          typeset();
        } catch (e) {
          failed(e);
        }
      };

      const initial = S.pdf.view === 'pages' || S.pdf.view === 'pdf' ? S.pdf.view : 'text';
      if (initial !== 'text') {
        /* still read the cached meta so the header can show the contest name */
        readCache(key).then((d) => { if (d && d.meta && onMeta) onMeta(d.meta); });
      }
      show(initial, false);
    },

    /* Statements QOJ already has as HTML: same typography, plus copy buttons on samples. */
    decorateHtml(article) {
      article.classList.add('qs-statement-text');
      article.querySelectorAll('pre').forEach((pre) => {
        if (pre.parentElement.classList.contains('qs-pre-wrap')) return;
        const cell = pre.closest('.qs-sample-cell');
        if (cell) {
          cell.querySelector('.qs-sample-head').append(copyButton(() => pre.textContent));
          return;
        }
        const wrap = el('div', { class: 'qs-pre-wrap' }, copyButton(() => pre.textContent));
        pre.before(wrap);
        wrap.append(pre);
      });
    },
  };
})();
