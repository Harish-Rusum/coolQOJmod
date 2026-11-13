/* ojuz.js: the adapter for oj.uz. Bootstrap 3 and jQuery, pages rendered on the server. Its scripts find things by id,
   so moving elements is safe. Statements are Markdown with KaTeX, or a PDF shown through a viewer page. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const { el } = QS;
  const { $, $$, textOf, buildShell, tabs, statement, problemPage, sheet, makeWatcher, classifyText } = QS.Site;
  const DANGER = [500, 150, 60, 20];

  QS.routeOf = (p) => {
    let m;
    if (p === '/') return { name: 'home' };
    if ((m = /^\/problem\/view\/([^/]+)/.exec(p))) return { name: 'problem', id: m[1] };
    if ((m = /^\/problem\/submit\/([^/]+)/.exec(p))) return { name: 'submit', id: m[1] };
    if (/^\/problems(\/|$)/.test(p)) return { name: 'problems' };
    if ((m = /^\/submission\/(\d+)/.exec(p))) return { name: 'submission', id: m[1] };
    if (/^\/submissions(\/|$)/.test(p)) return { name: 'submissions' };
    return { name: 'other' };
  };

  QS.site = { id: 'ojuz', ready: () => !!$('#content') };

  let page = null;

  QS.Shell = {
    init() {
      const path = (QS.env && QS.env.path) || location.pathname;
      const me = $('.login-bar a[href*="/profile/"]');
      if (me) QS.me = { name: textOf(me), rating: null };
      const langs = $$('.search-side .dropdown-menu a');
      const user = [...langs, ...$$('.login-bar a')].map((a) => ({ href: a.getAttribute('href'), text: textOf(a) })).filter((u) => u.href && u.text);
      page = buildShell({
        brand: 'oj.uz',
        links: [
          { href: '/problems', text: 'Problems', active: /^\/problems?(\/|$)/.test(path) },
          { href: '/submissions', text: 'Submissions', active: /^\/submissions?(\/|$)/.test(path) },
        ],
        user,
      });
      const footer = $('body > footer');
      if (footer) { footer.classList.add('uoj-footer'); page.append(footer); }
    },
  };

  const pageTabs = (root) => {
    const ul = $(':scope > ul.nav-tabs', root);
    return ul ? tabs(ul, (a, li) => li.classList.contains('active')) : null;
  };

  /* A Bootstrap panel becomes a side card, keeping whatever is inside it. */
  function cardFrom(panel) {
    const head = $('.panel-heading', panel);
    const card = el('section', { class: 'qs-card' }, el('h2', { text: textOf(head) }));
    if (head) head.remove();
    while (panel.firstChild) card.append(panel.firstChild);
    return card;
  }

  QS.Pages = {
    async problem(S, route) {
      const col = $('#content .col-lg-9');
      const h1 = col && $('.problem-title h1', col);
      const box = col && $('#statement', col);
      if (!h1 || !box) { QS.Pages.other(S); return null; }

      const small = $('small', h1);
      const labels = small ? $$('.label', small).map(textOf) : [];
      const compile = small ? $('button', small) : null;
      if (small) small.remove();
      const title = textOf(h1);

      /* the facts row: headers and values */
      const stats = {};
      const table = $$('.table-responsive table', col).find((t) => !t.closest('.modal'));
      if (table) {
        const ths = $$('thead th', table).map(textOf);
        $$('tbody tr:first-child td', table).forEach((td, i) => { stats[(ths[i] || '').toLowerCase()] = textOf(td); });
        table.closest('.table-responsive').classList.add('qs-gone');
      }
      const solved = parseInt(stats['solved #'], 10);

      const side = $$('#content .col-lg-3 .panel').map(cardFrom);
      const sourceText = side[0] && /source/i.test(textOf($('h2', side[0]))) ? textOf($('.panel-body', side[0])) : '';
      const number = /problem\s+(\d+)/i.exec(sourceText);
      const modal = $('#view_compilation_commands', col);
      if (modal) page.append(modal);

      const pdfFrame = $('iframe.problem-pdf-web-viewer', box);
      const md = $('[id^="markdown-"]', box);
      if (md) statement(md);

      const ep = await problemPage(S, route, {
        page, tabs: pageTabs(col), title, no: number ? number[1] : '', source: sourceText || route.id, time: stats['time limit'] || '', memory: stats['memory limit'] || '',
        solved: Number.isNaN(solved) ? undefined : solved, dangerSteps: DANGER, facts: labels,
        submit: `/problem/submit/${route.id}`, secondary: [{ href: `/problem/statistics/${route.id}`, icon: 'stats', text: 'Statistics' }],
        tertiary: compile ? [compile] : [], body: [box], side,
        splitForm: () => Promise.resolve(el('a', { class: 'qs-submit', href: `/problem/submit/${route.id}`, text: 'Open the submit page' })),
      });

      if (pdfFrame && S.pdf.convert) {
        const viewer = pdfFrame.getAttribute('src') || '';
        const file = new URL(viewer, location.href).searchParams.get('file');
        if (file) {
          pdfFrame.dataset.qsSrc = viewer;
          pdfFrame.setAttribute('src', 'about:blank');
          QS.Statement.mount(S, pdfFrame, null, { pdf: file });
        }
      }
      const h = (await QS.get(QS.key('history'))) || [];
      QS.set(QS.key('history'), [{ id: route.id, title, opened: Date.now() }, ...h.filter((e) => e.id !== route.id)].slice(0, 40));
      return ep;
    },

    other(S) {
      const old = $('#content > .container');
      if (!old) return;
      const content = sheet(S, page, { tabs: pageTabs(old), heading: textOf($('.page-banner-title')) });
      while (old.firstChild) content.append(old.firstChild);
    },
  };
  for (const name of ['home', 'problems', 'submit', 'submission', 'submissions']) QS.Pages[name] = QS.Pages.other;

  /* --------------------------------------------------------------------------------------- results */

  const RUNNING = /\b(compiling|evaluating|scoring|in queue|in the queue|waiting|pending|judging)\b/i;
  const FAILURE = /isn't correct|not correct|wrong answer|timed out|time limit|memory limit|killed|signal|runtime error|non-zero/i;

  /* The page's words, without the problem's own name, which could be a word like "Waiting". */
  function plainCopy(root) {
    const copy = root.cloneNode(true);
    $$('a[href*="/problem/"], .modal, script, .qs-subnav', copy).forEach((n) => n.remove());
    return copy;
  }

  function readResult(doc) {
    const root = $('.uoj-content', doc) || $('#content', doc);
    if (!root) return null;
    const copy = plainCopy(root);
    const task = $('a[href*="/problem/view/"]', root);
    const base = {
      title: textOf(task),
      problemId: task ? decodeURIComponent((/\/problem\/view\/([^/?#]+)/.exec(task.getAttribute('href') || '') || [])[1] || '') : '',
    };
    /* cell by cell: run together, "#123" and "Evaluating" would hide the word */
    const words = $$('*', copy).filter((n) => !n.children.length).map(textOf).join(' ');
    const running = RUNNING.exec(words);
    if (running) {
      const cell = $$('td, span, div', copy).filter((n) => !n.children.length && RUNNING.test(n.textContent)).map(textOf).find((t) => t.length < 80);
      return { ...base, state: 'run', text: cell || running[0] };
    }
    if (/compil\w*\s*(failed|error)/i.test(words)) return { ...base, state: 'done', v: 'ce', text: 'Compilation failed' };

    const scored = $$('.text, td, span', copy).map(textOf).map((t) => /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t)).find(Boolean);
    if (!scored) return null;
    const score = parseFloat(scored[1]);
    const max = parseFloat(scored[2]);

    /* the first test that went wrong, its number and how long the slowest test ran */
    let test = 0;
    let why = null;
    let slowest = 0;
    let largest = 0;
    $$('tr', copy).forEach((tr) => {
      const cells = $$('td', tr).map(textOf);
      if (!cells.length) return;
      for (const c of cells) {
        const ms = /^(\d+)\s*ms$/.exec(c);
        const mem = /^(\d+(?:\.\d+)?)\s*(KB|KiB|MB|MiB)$/i.exec(c);
        if (ms) slowest = Math.max(slowest, +ms[1]);
        if (mem) largest = Math.max(largest, parseFloat(mem[1]) * (/k/i.test(mem[2]) ? 1 / 1024 : 1));
      }
      if (why) return;
      const bad = cells.find((c) => FAILURE.test(c));
      if (bad) {
        why = classifyText(bad);
        const no = cells.find((c) => /^\d+$/.test(c));
        test = no ? +no : 0;
      }
    });
    const v = score >= max ? 'ac' : score > 0 ? 'partial' : why || 'wa';
    return {
      ...base, state: 'done', v, score, max, test, text: `${score} / ${max}`,
      time: slowest ? `${slowest} ms` : '', memory: largest ? `${largest.toFixed(1)} MB` : '',
    };
  }

  QS.Watch = makeWatcher({
    submitForm: () => QS.route.name === 'submit',
    titleOnSubmit: () => textOf($('.page-banner-title')) || document.title.split(' :: ')[0],
    /* right after a submit: the newest run on the list that is yours */
    latestRun() {
      const links = $$('a[href^="/submission/"]');
      const mine = QS.me && links.find((a) => { const tr = a.closest('tr'); return tr && tr.textContent.includes(QS.me.name); });
      const a = mine || links[0];
      return a ? a.getAttribute('href') : null;
    },
    readResult,
    /* the page updates by itself, and the host is behind Cloudflare, so refetching is only a slow backup */
    network: 6000,
  });
})();
