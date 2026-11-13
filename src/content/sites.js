/* sites.js: what the CSES and oj.uz adapters share. Each adapter rebuilds its site's pages out of the same classes
   QOJ's pages use, so the styles, views and glass in the stylesheets apply to them unchanged. Nothing here runs on QOJ. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const { el, icon } = QS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const textOf = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');

  /* The same top bar, sheet and tabs on every site: links are { href, text, active }, user is a list of { href, text }. */
  function buildShell({ brand, links, user }) {
    const nav = el('nav', { class: 'navbar' },
      el('a', { class: 'navbar-brand', href: '/' }, el('span', { class: 'qs-brand-mark', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), brand),
      el('ul', { class: 'navbar-nav' }, links.map((l) => el('li', { class: `nav-item${l.active ? ' qs-active' : ''}` }, el('a', { class: 'nav-link', href: l.href, text: l.text })))),
      el('ul', { class: 'nav-pills qs-user' }, user.map((u) => el('li', { class: 'nav-item' }, el('a', { class: 'nav-link', href: u.href, text: u.text })))));
    const page = el('div', { class: 'container qs-page' });
    document.body.append(nav, page);
    return page;
  }

  /* Any list of links becomes the row of tabs above a page. */
  function tabs(ul, isActive) {
    ul.className = 'nav nav-tabs';
    $$('li', ul).forEach((li) => {
      const a = $('a', li);
      li.classList.add('nav-item');
      if (!a) return;
      a.classList.add('nav-link');
      if (isActive(a, li)) a.classList.add('active');
    });
    return el('nav', { class: 'qs-subnav', 'aria-label': 'Sections' }, ul);
  }

  /* Statement headings take the label look of each style, and sample blocks get Copy buttons. */
  function statement(root) {
    $$('h1, h2, h3, h4, h5', root).forEach((h) => h.classList.add('qs-h'));
    QS.Statement.decorateHtml(root);
  }

  const pill = (children, cls = '') => el('span', { class: `qs-pill ${cls}` }, children);

  function meter(level) {
    const bars = [];
    for (let i = 1; i <= 5; i++) bars.push(el('i', { class: i <= level ? 'on' : '' }));
    return el('span', { class: `qs-meter qs-meter-${level}`, title: `Danger ${level} of 5` }, bars);
  }

  /* Danger comes from how many solved, measured against four thresholds that suit the site. */
  const dangerFrom = (solved, steps) => {
    if (solved === undefined || solved === null) return 0;
    const i = steps.findIndex((s) => solved >= s);
    return i < 0 ? 5 : i + 1;
  };
  const arcFrom = (level) => (!level ? 'none' : level === 1 ? 'easy' : level === 5 ? 'hard' : 'mid');

  /* Builds the problem page: subnav, episode header, facts and actions, the statement, and the side column. */
  async function problemPage(S, route, o) {
    const label = o.no ? (S.words.episode || '第{n}話').replace('{n}', o.no) : '';
    const level = dangerFrom(o.solved, o.dangerSteps);
    const arc = arcFrom(level);
    const words = S.words.arcs[arc] || S.words.arcs.none;
    const episode = { route, no: o.no || '', label, title: o.title, plainTitle: o.title, arc, time: o.time || '', memory: o.memory || '', source: () => o.source || '' };
    QS.episode = episode;
    const content = el('div', { class: 'uoj-content' });
    o.page.append(content);
    const runs = ((await QS.get(QS.key('runs'))) || {})[route.id] || [];
    const sideOn = (S.layout.side || S.look.view === 'split') && S.look.view !== 'reader';

    if (S.look.view === 'classic') {
      document.documentElement.setAttribute('data-qs-page', 'other');
      content.append(el('h1', { class: 'page-header', text: o.title }));
      if (o.tabs) content.append(o.tabs);
      if (o.facts) content.append(el('div', { class: 'qs-ep-facts' }, o.facts.map((f) => pill(f))));
      content.append(...o.body);
      await QS.applyTheme(S, arc);
      return episode;
    }

    const dangerPill = level ? pill([el('span', { class: 'qs-danger-word', text: S.words.danger }), meter(level), el('span', { text: `${level}/5` })], 'qs-pill-danger') : null;
    const facts = el('div', { class: 'qs-ep-facts' }, dangerPill,
      o.solved !== undefined && o.solved !== null ? pill(`Solved by ${o.solved}`) : null,
      o.time ? pill([icon('clock', 13), `${o.time} per test`]) : null,
      o.memory ? pill([icon('box', 13), o.memory]) : null,
      (o.facts || []).map((f) => pill(f)));
    const actions = el('div', { class: 'qs-ep-actions' });
    if (o.submit) actions.append(el('a', { class: 'qs-submit', href: o.submit }, icon('send', 15), 'Submit'));
    if (o.secondary && o.secondary.length) actions.append(el('div', { class: 'qs-ep-secondary' }, o.secondary.map((b) => el('a', { class: 'qs-outline', href: b.href }, icon(b.icon, 14), b.text))));
    if (o.tertiary && o.tertiary.length) actions.append(el('div', { class: 'qs-ep-tertiary' }, o.tertiary));

    const panel = el('main', { class: 'qs-panel' },
      el('header', { class: 'qs-ep' },
        el('div', { class: 'qs-ep-kicker' }, label ? el('span', { class: 'qs-ep-no', text: label }) : null, el('span', { class: 'qs-ep-source', text: o.source || '' }), el('span', { class: 'qs-ep-arc', title: words.en, text: words.jp })),
        el('h1', { class: 'qs-ep-title', text: o.title })),
      el('section', { class: 'qs-ep-meta' }, el('div', { class: 'qs-ep-left' }, facts, o.tags && o.tags.length ? el('div', { class: 'qs-ep-tags' }, o.tags.map((t) => el('span', { class: 'qs-tag', text: t }))) : null), actions),
      el('div', { class: 'qs-tabbody' }, o.body));

    const side = el('aside', { class: 'qs-side' });
    if (sideOn) {
      if (S.look.view === 'split' && o.splitForm) side.append(el('section', { class: 'qs-card qs-split-submit' }, el('h2', { text: 'Submit' }), await o.splitForm()));
      if (runs.length) {
        side.append(el('section', { class: 'qs-card' }, el('h2', { text: 'Your runs' }),
          el('div', { class: 'qs-runs' }, runs.slice(0, 6).map((r) => el('a', { class: `qs-run qs-v-${r.v}`, href: r.href }, el('span', { class: 'qs-run-v', text: QS.Watch.short(r) }), el('span', { class: 'qs-run-id', text: `#${r.sub}` }))))));
      }
      side.append(...(o.side || []));
    }
    const grid = el('div', { class: `qs-problem${sideOn && side.children.length ? '' : ' qs-no-side'}` }, o.tabs, panel, sideOn && side.children.length ? side : null);
    content.append(grid);
    await QS.applyTheme(S, arc);
    return episode;
  }

  /* The sheet of glass for every other page, with the side cards beside it when there are any. */
  function sheet(S, page, { tabs: subnav, side = [], heading }) {
    const content = el('div', { class: 'uoj-content' });
    if (heading) content.append(el('h1', { class: 'page-header', text: heading }));
    const showSide = side.length && S.layout.side && S.look.view !== 'reader';
    page.append(el('div', { class: `qs-problem${showSide ? '' : ' qs-no-side'}` }, subnav, content, showSide ? el('aside', { class: 'qs-side' }, side) : null));
    return content;
  }

  /* ---------------------------------------------------------------------------------- the watcher */

  const PENDING = 'qs:pending';
  const WATCHING = 'qs:watching';
  const read = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };
  const write = (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } };

  const LONG = { ac: 'Accepted', partial: 'Partial score', wa: 'Wrong answer', tle: 'Time limit', mle: 'Memory limit', re: 'Runtime error', ce: 'Compile error', run: 'Judging' };
  const SHORT = { ac: 'AC', partial: 'Partial', wa: 'WA', tle: 'TLE', mle: 'MLE', re: 'RE', ce: 'CE', run: '...' };

  /* What a judge's message means. Written in the words CSES and oj.uz use, and those used by CMS, which oj.uz grew from. */
  function classifyText(text) {
    const t = (text || '').toLowerCase();
    if (/compil\w*\s*(error|failed|failure)/.test(t)) return 'ce';
    if (/time limit|timed out|\btle\b/.test(t)) return 'tle';
    if (/memory limit|\bmle\b/.test(t)) return 'mle';
    if (/wrong answer|isn't correct|not correct|output limit|\bwa\b/.test(t)) return 'wa';
    if (/runtime error|killed|signal|non-zero|\bre\b/.test(t)) return 're';
    if (/accepted|\bcorrect\b|\bac\b/.test(t)) return 'ac';
    return null;
  }

  /* cfg: submitForm(form), latestRun() for a list page, readResult(doc), network (ms between refetches of the page) */
  function makeWatcher(cfg) {
    const DEADLINE = 10 * 60e3;
    const UNREADABLE = 15e3;
    async function record(data) {
      const seen = (await QS.get(QS.key('seen'))) || [];
      await QS.set(QS.key('seen'), [data.id, ...seen.filter((x) => x !== data.id)].slice(0, 300));
      if (!data.problemId) return;
      const runs = (await QS.get(QS.key('runs'))) || {};
      runs[data.problemId] = [{ sub: data.id, href: location.pathname, v: data.v, score: data.score, at: Date.now() }, ...(runs[data.problemId] || []).filter((r) => r.sub !== data.id)].slice(0, 8);
      await QS.set(QS.key('runs'), runs);
      const h = (await QS.get(QS.key('history'))) || [];
      await QS.set(QS.key('history'), [{ id: data.problemId, title: data.title, v: data.v, sub: data.id, at: Date.now() }, ...h.filter((e) => e.id !== data.problemId)].slice(0, 40));
    }

    return {
      short: (r) => (r.v === 'partial' && r.score !== undefined ? String(r.score) : SHORT[r.v] || r.v),
      long: (v) => LONG[v] || v,
      resuming: false,
      readResult: cfg.readResult,

      start(S) {
        this.S = S;
        document.addEventListener('submit', (e) => {
          const form = e.target;
          if (!form || !cfg.submitForm(form)) return;
          setTimeout(() => {
            if (e.defaultPrevented) return;
            const title = textOf($('.qs-ep-title')) || cfg.titleOnSubmit();
            write(PENDING, {
              at: Date.now(), problemId: QS.route.id, title, label: textOf($('.qs-ep-no')), arc: QS.theme ? QS.theme.arc : 'none',
              limitMemory: (textOf($('.qs-ep-facts')).match(/\d+(\.\d+)?\s*(MB|GB|MiB|GiB)/i) || [''])[0],
            });
            QS.Moments.launch({ title });
          }, 0);
        }, false);

        const pending = read(PENDING);
        const fresh = pending && Date.now() - pending.at < 90e3 ? pending : null;
        /* a site that lands on the list after submitting: go on to the run itself */
        if (QS.route.name === 'submissions' && fresh && cfg.latestRun) {
          const href = cfg.latestRun();
          if (href) { this.resuming = true; location.replace(href); return; }
        }
        if (QS.route.name !== 'submission') return;
        this.follow(S, fresh).catch((e) => console.error('[Sakugo Studio]', e)).finally(() => {
          if (!QS.Moments.Broadcast.active) document.documentElement.removeAttribute('data-qs-cover');
        });
      },

      async follow(S, fresh) {
        const id = QS.route.id;
        const stored = read(WATCHING);
        const watching = stored && stored.id === id ? stored : null;
        const ctx = watching || fresh;
        const r = cfg.readResult(document);
        const live = QS.liveClock();
        this.resuming = !!ctx;
        if (r && r.state === 'done') {
          write(WATCHING, null);
          write(PENDING, null);
          if (!ctx || !r.v) return;
          const seen = (await QS.get(QS.key('seen'))) || [];
          if (seen.includes(id)) return;
          const data = { ...r, id, title: ctx.title || r.title || '', label: ctx.label || '', arc: ctx.arc || 'none', limitMemory: ctx.limitMemory || '', problemId: ctx.problemId || r.problemId || '' };
          await record(data);
          if (!live || S.moments.live) await QS.Moments.verdict(data);
          return;
        }
        if (!r || r.state !== 'run') { write(PENDING, null); return; }
        /* A run you just sent gets the full broadcast. Opening someone's run that is still going gets only the strip. */
        const quiet = !!(live && !S.moments.live);
        const next = { ...(ctx || {}), id, title: (ctx && ctx.title) || r.title || '', label: (ctx && ctx.label) || '' };
        if (ctx) { write(WATCHING, next); write(PENDING, null); }
        QS.Moments.Broadcast.start(next, { stripOnly: !ctx || quiet, silent: !ctx || quiet });
        QS.Moments.Broadcast.update(r.text);
        this.poll();
      },

      poll() {
        const began = Date.now();
        let lastRead = began;
        let failures = 0;
        const stop = () => { QS.Moments.Broadcast.stop(); write(WATCHING, null); };
        const finished = () => {
          /* the finished page is what holds the verdict; the screen stays black while it loads */
          QS.Moments.Broadcast.stop();
          document.documentElement.setAttribute('data-qs-cover', '1');
          location.reload();
        };
        const look = (r) => {
          if (r) lastRead = Date.now();
          if (r && r.state === 'done') { finished(); return true; }
          if (r && r.text) QS.Moments.Broadcast.update(r.text);
          return false;
        };
        const tick = async () => {
          if (Date.now() - began > DEADLINE || Date.now() - lastRead > UNREADABLE) { stop(); return; }
          /* oj.uz updates its page by itself, so the page in front of us is checked first */
          if (look(cfg.readResult(document))) return;
          if (cfg.network) {
            try {
              const res = await fetch(location.href, { credentials: 'include', headers: { Accept: 'text/html' } });
              if (!res.ok) throw new Error(String(res.status));
              failures = 0;
              if (look(cfg.readResult(new DOMParser().parseFromString(await res.text(), 'text/html')))) return;
            } catch {
              if (++failures > 8) { stop(); return; }
            }
          }
          setTimeout(tick, cfg.network || 1000);
        };
        setTimeout(tick, 800);
      },
    };
  }

  QS.Site = { $, $$, textOf, buildShell, tabs, statement, problemPage, sheet, makeWatcher, classifyText, dangerFrom };
})();
