/* boot.js: runs at document_start. Puts the theme on before the site paints anything, then wires the pages up. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const root = document.documentElement;
  const env = QS.env || {};
  const path = env.path || location.pathname;
  const route = QS.routeOf(path);
  QS.route = route;

  /* first paint: a synchronous mirror of the last solved theme */
  let mirror = null;
  if (!env.preview) {
    try { mirror = JSON.parse(localStorage.getItem('qs:mirror') || 'null'); } catch { mirror = null; }
  }
  const on = !mirror || mirror.on !== false;
  if (on) {
    root.setAttribute('data-qs', 'on');
    root.setAttribute('data-qs-page', route.name);
    if (mirror) {
      for (const [k, v] of Object.entries(mirror.vars || {})) root.style.setProperty(k, v);
      if (mirror.mode) root.setAttribute('data-qs-mode', mirror.mode);
      if (mirror.style) root.setAttribute('data-qs-style', mirror.style);
      if (mirror.view) root.setAttribute('data-qs-view', mirror.view);
    }
    /* A title card is due: keep the page black until it starts, so the statement never flashes first. */
    if (route.name === 'problem' && mirror && mirror.title && !env.preview) {
      let seen = false;
      try { seen = mirror.when !== 'always' && !!sessionStorage.getItem(`qs:t:${route.id}`); } catch { seen = true; }
      if (!seen) root.setAttribute('data-qs-cover', '1');
    }
    /* The judge just finished and the page reloaded to show the verdict: same idea. */
    if ((route.name === 'submissions' || route.name === 'submission') && !env.preview) {
      try { if (sessionStorage.getItem('qs:watching') || sessionStorage.getItem('qs:pending')) root.setAttribute('data-qs-cover', '1'); } catch { /* fine */ }
    }
  }

  /* stops the browser downloading the statement PDF a second time */
  const catchFrame = () => {
    const frame = document.querySelector('iframe#statements-pdf');
    if (frame) QS.Statement.intercept(frame);
    return frame;
  };
  let frameWatch = null;
  if (on && route.name === 'problem' && !env.preview) {
    frameWatch = new MutationObserver(() => { if (catchFrame()) frameWatch.disconnect(); });
    frameWatch.observe(root, { childList: true, subtree: true });
  }

  const domReady = new Promise((res) => {
    if (document.readyState !== 'loading') res();
    else document.addEventListener('DOMContentLoaded', () => res(), { once: true });
  });

  let structured = false;

  async function start() {
    const S = await QS.load();
    QS.S = S;
    if (!S.on) {
      root.removeAttribute('data-qs');
      root.removeAttribute('data-qs-page');
      root.removeAttribute('data-qs-cover');
      root.removeAttribute('data-qs-style');
      root.removeAttribute('data-qs-view');
      if (frameWatch) frameWatch.disconnect();
      const frame = document.querySelector('iframe#statements-pdf');
      if (frame && frame.dataset.qsSrc) frame.setAttribute('src', frame.dataset.qsSrc);
      if (!env.preview) { try { localStorage.setItem('qs:mirror', JSON.stringify({ on: false })); } catch { /* fine */ } }
      domReady.then(() => {
        const f = document.querySelector('iframe#statements-pdf');
        if (f && f.dataset.qsSrc) f.setAttribute('src', f.dataset.qsSrc);
      });
      return;
    }
    root.setAttribute('data-qs', 'on');
    root.setAttribute('data-qs-page', route.name);
    await QS.applyTheme(S, 'none');
    await domReady;
    /* Cloudflare's check page and anything else that is not the site's normal layout stays exactly as it is */
    if (!QS.site.ready() && !env.preview) {
      root.removeAttribute('data-qs');
      root.removeAttribute('data-qs-page');
      root.removeAttribute('data-qs-cover');
      root.removeAttribute('data-qs-style');
      root.removeAttribute('data-qs-view');
      if (frameWatch) frameWatch.disconnect();
      return;
    }
    if (frameWatch) { frameWatch.disconnect(); catchFrame(); }
    structured = true;
    QS.Shell.init();
    QS.Inks.start();
    QS.Ambient.start(S);
    if (QS.Watch) QS.Watch.start(S);

    let episode = null;
    try {
      const page = QS.Pages[route.name];
      if (page) episode = await page(S, route);
    } catch (e) {
      console.error('[Sakugo Studio]', e);
      episode = QS.episode || null; // a problem in the page build must not cost the title card
    }
    root.setAttribute('data-qs-built', '1');
    QS.Inks.scan(document);
    /* QOJ's own script recolours names on ready and on load */
    setTimeout(() => QS.Inks.scan(document), 250);
    addEventListener('load', () => QS.Inks.scan(document), { once: true });
    QS.Ambient.start(S);

    if (QS.Moments) QS.Moments.pageReady(S, route, episode);
    else root.removeAttribute('data-qs-cover');
  }

  start().catch((e) => {
    /* the rebuilt sites hide their pages until they are ready, so a failure hands the page back */
    if (QS.site.id !== 'qoj') root.removeAttribute('data-qs');
    root.setAttribute('data-qs-built', '1');
    root.removeAttribute('data-qs-cover');
    console.error('[Sakugo Studio]', e);
  });

  /* live updates from the popup and Studio */
  QS.api.storage.onChanged.addListener(async (changes) => {
    const ch = changes['qs.settings'];
    if (!ch) return;
    const before = QS.S;
    const next = QS.merge(QS.DEFAULTS, ch.newValue || {});
    QS.S = next;
    if (before && before.on !== next.on) {
      if (env.preview) return;
      /* pages were rebuilt: only a reload brings back the exact stock page */
      if (structured || next.on) { try { localStorage.setItem('qs:mirror', JSON.stringify({ on: next.on })); } catch { /* fine */ } location.reload(); }
      return;
    }
    if (!next.on) return;
    /* classic and split move parts of the page, so changing to or from them needs a fresh page */
    if (before && before.look.view !== next.look.view && [before.look.view, next.look.view].some((v) => v === 'classic' || v === 'split')) { location.reload(); return; }
    await QS.applyTheme(next, QS.theme ? QS.theme.arc : 'none');
    QS.Ambient.start(next);
  });
})();
