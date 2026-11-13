/* cses.js: the adapter for cses.fi. Its pages are plain server-rendered HTML, so everything is rebuilt once at load. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const { el } = QS;
  const { $, $$, textOf, buildShell, tabs, statement, problemPage, sheet, makeWatcher, classifyText } = QS.Site;
  const DANGER = [20000, 5000, 1500, 300];
  const DAY = 24 * 3600e3;

  /* A course or a contest has its own first path segment, and may be running against a clock. */
  QS.routeOf = (p) => {
    const parts = p.split('/').filter(Boolean);
    if (!parts.length) return { name: 'home' };
    const [section, kind, id] = parts;
    const base = { section };
    if (kind === 'task' && id) return { ...base, name: 'problem', id };
    if (kind === 'submit' && id) return { ...base, name: 'submit', id };
    if (kind === 'result' && id) return { ...base, name: 'submission', id };
    if ((kind === 'list' || !kind) && section === 'problemset') return { ...base, name: 'problems' };
    return { ...base, name: 'other' };
  };

  QS.site = {
    id: 'cses',
    ready: () => !!$('.skeleton .content'),
    /* outside the problem set a task can belong to a running contest: cutscenes wait for the setting that allows them */
    live: () => (QS.route.section && QS.route.section !== 'problemset' && QS.route.name !== 'home' ? document.documentElement : null),
  };

  let page = null;

  QS.Shell = {
    init() {
      const path = (QS.env && QS.env.path) || location.pathname;
      const controls = $('.header .controls');
      const account = controls && $('a.account', controls);
      const signedIn = account && !/login/.test(account.getAttribute('href') || '');
      if (signedIn) QS.me = { name: textOf(account), rating: null };
      const user = controls ? $$('a', controls).filter((a) => !/darkmode/.test(a.getAttribute('href') || '')).map((a) => ({ href: a.getAttribute('href'), text: textOf(a) })) : [];
      page = buildShell({
        brand: 'CSES',
        links: [
          { href: '/problemset/', text: 'Problem Set', active: /^\/problemset(\/(list|task|submit|result|hack|view)|\/?$)/.test(path) },
          { href: '/problemset/stats/', text: 'Statistics', active: /^\/problemset\/stats/.test(path) },
          { href: '/', text: 'Courses and contests', active: path === '/' },
        ],
        user,
      });
      $$('.skeleton table, .content table').forEach((t) => t.classList.add('table'));
    },
  };

  const pageTabs = () => {
    const ul = $('.title-block ul.nav');
    return ul && ul.children.length ? tabs(ul, (a) => a.classList.contains('current')) : null;
  };
  const pageHeading = () => textOf($('.title-block h1'));
  const contentEl = () => $('.skeleton .content');
  const moveKids = (from, to) => { while (from.firstChild) to.append(from.firstChild); };

  /* The sidebar: a heading then links, sometimes several times over. Each run becomes a card. */
  function sideCards() {
    const bar = $('.skeleton .sidebar');
    if (!bar) return [];
    const cards = [];
    let list = null;
    for (const n of [...bar.childNodes]) {
      if (n.nodeType === 1 && n.tagName === 'H4') {
        list = el('div', { class: 'qs-card-list' });
        cards.push(el('section', { class: 'qs-card' }, el('h2', { text: textOf(n) }), list));
      } else if (n.nodeType === 1 && n.tagName === 'HR') {
        continue;
      } else if (list && (n.nodeType === 1 || n.textContent.trim())) {
        list.append(n);
      }
    }
    return cards.filter((c) => textOf($('.qs-card-list', c)));
  }

  /* Each sample is an "Input:" paragraph and a block, then "Output:" and a block. */
  function samples(md) {
    const blocks = $$(':scope > pre', md);
    for (let i = 0; i < blocks.length; i++) {
      const pre = blocks[i];
      const label = pre.previousElementSibling;
      if (!label || label.tagName !== 'P' || !/^input:?$/i.test(textOf(label))) continue;
      const next = pre.nextElementSibling;
      const out = next && next.tagName === 'P' && /^output:?$/i.test(textOf(next)) ? next.nextElementSibling : null;
      if (!out || out.tagName !== 'PRE') continue;
      const cell = (name, node) => {
        node.classList.add('qs-sample-pre');
        return el('div', { class: 'qs-sample-cell' }, el('div', { class: 'qs-sample-head' }, el('span', { text: name })), node);
      };
      const row = el('div', { class: 'qs-sample-row' });
      const wrap = el('div', { class: 'qs-samples' }, row);
      label.before(wrap);
      row.append(cell('Input', pre), cell('Output', out));
      label.remove();
      next.remove();
      i++;
    }
  }

  /* What the problem list says about every task, kept for a day so a task page can show its danger right away. */
  function readList(doc) {
    const out = {};
    $$('li.task', doc).forEach((li) => {
      const a = $('a', li);
      const m = a && /\/task\/(\d+)/.exec(a.getAttribute('href') || '');
      const d = /(\d+)\s*\/\s*(\d+)/.exec(textOf($('.detail', li)));
      if (m && d) out[m[1]] = +d[1];
    });
    return out;
  }
  async function solvedCount(id, lookup) {
    const rec = await QS.get(QS.key('problems'));
    if (rec && Date.now() - rec.at < DAY && rec.solved[id] !== undefined) return rec.solved[id];
    if (!lookup) return rec ? rec.solved[id] : undefined;
    try {
      const res = await fetch('/problemset/list/', { credentials: 'include' });
      if (!res.ok) return rec ? rec.solved[id] : undefined;
      const solved = readList(new DOMParser().parseFromString(await res.text(), 'text/html'));
      await QS.set(QS.key('problems'), { at: Date.now(), solved });
      return solved[id];
    } catch {
      return rec ? rec.solved[id] : undefined;
    }
  }

  /* The form lives on its own page, as plain HTML, so Split view can show it beside the statement. */
  async function splitForm(route) {
    const url = `/${route.section}/submit/${route.id}/`;
    try {
      const res = await fetch(url, { credentials: 'include' });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const form = res.ok && $('.content form', doc);
      if (form) {
        form.setAttribute('action', new URL(form.getAttribute('action') || url, new URL(url, location.href)).href);
        return document.adoptNode(form);
      }
    } catch { /* falls through to the link */ }
    return el('a', { class: 'qs-submit', href: url, text: 'Open the submit page' });
  }

  QS.Pages = {
    async problem(S, route) {
      const content = contentEl();
      const md = $('.md', content);
      const title = pageHeading();
      if (!md || !title) { QS.Pages.other(S); return null; }
      const limits = {};
      $$('.task-constraints li', content).forEach((li) => {
        const b = textOf($('b', li));
        limits[b.replace(/:$/, '').toLowerCase()] = textOf(li).slice(b.length).trim();
      });
      const time = limits['time limit'] || '';
      samples(md);
      statement(md);

      const sidebar = $('.skeleton .sidebar');
      const section = textOf(sidebar && $('h4', sidebar));
      const siblings = sidebar ? $$('a[href*="/task/"]', sidebar) : [];
      const index = siblings.findIndex((a) => a.classList.contains('current'));
      const side = sideCards();
      if (side[0]) side[0].classList.add('qs-card-scroll');
      const ul = $('.title-block ul.nav');
      const link = (re) => { const a = ul && $$('a', ul).find((x) => re.test(x.getAttribute('href') || '')); return a ? a.getAttribute('href') : ''; };
      const lookup = route.section === 'problemset' && S.arcRule.lookup;
      const solved = await Promise.race([solvedCount(route.id, lookup), new Promise((r) => setTimeout(() => r(undefined), 450))]);
      const stats = link(/\/stats\//);
      const editorial = ul && $$('a', ul).filter((a) => !/\/(task|stats|submit)\//.test(a.getAttribute('href') || '')).map((a) => el('a', { href: a.getAttribute('href'), text: textOf(a) }));
      const subnav = pageTabs();
      const ep = await problemPage(S, route, {
        page, tabs: subnav, title, no: index >= 0 ? String(index + 1) : route.id, source: section, time: time.replace(/^(\d+)\.00 s/, '$1 s'), memory: limits['memory limit'] || '',
        solved, dangerSteps: DANGER, submit: link(/\/submit\//), secondary: stats ? [{ href: stats, icon: 'stats', text: 'Statistics' }] : [], tertiary: editorial,
        body: [md], side, splitForm: () => splitForm(route),
      });
      QS.set(QS.key('history'), [{ id: route.id, title, opened: Date.now() }, ...((await QS.get(QS.key('history'))) || []).filter((h) => h.id !== route.id)].slice(0, 40));
      return ep;
    },

    problems(S) {
      const content = contentEl();
      const solved = readList(document);
      if (Object.keys(solved).length) QS.set(QS.key('problems'), { at: Date.now(), solved });
      $$(':scope > h2', content).forEach((h) => h.classList.add('qs-section-title'));
      QS.Pages.other(S);
    },

    other(S) {
      const content = sheet(S, page, { tabs: pageTabs(), side: sideCards(), heading: pageHeading() });
      moveKids(contentEl(), content);
    },
  };
  QS.Pages.home = QS.Pages.other;
  QS.Pages.submit = QS.Pages.other;
  QS.Pages.submission = QS.Pages.other;

  /* --------------------------------------------------------------------------------------- results */

  /* A table row whose first cell is a label, like "Status:", gives the cell beside it. */
  function rowValue(doc, re) {
    for (const tr of $$('tr', doc)) {
      const cells = $$('td, th', tr);
      if (cells.length >= 2 && re.test(textOf(cells[0]))) return textOf(cells[1]);
    }
    return '';
  }

  function readResult(doc) {
    const root = $('.uoj-content', doc) || $('.content', doc) || doc.body;
    if (!root) return null;
    const status = rowValue(root, /^status/i) || textOf($('#status', root));
    const result = rowValue(root, /^result/i);
    const task = $('a[href*="/task/"]', root);
    const base = { title: textOf(task), problemId: task ? (/\/task\/(\d+)/.exec(task.getAttribute('href') || '') || [])[1] : '' };
    if (/pending|queue|testing|compiling|judging|waiting/i.test(status)) return { ...base, state: 'run', text: status };
    if (!status && !result) return null;

    let failed = 0;
    let longest = 0;
    let verdict = '';
    $$('tr', root).forEach((tr) => {
      const cells = $$('td', tr).map(textOf);
      const no = cells[0] && /^#?(\d+)$/.exec(cells[0]);
      if (!no || cells.length < 2) return;
      const v = classifyText(cells.slice(1).join(' '));
      const t = cells.map((c) => /^(\d+(\.\d+)?)\s*s$/.exec(c)).find(Boolean);
      if (t) longest = Math.max(longest, parseFloat(t[1]));
      if (v && v !== 'ac' && !failed) { failed = +no[1]; verdict = v; }
    });
    const v = classifyText(status) === 'ce' ? 'ce' : classifyText(result) || verdict || null;
    return {
      ...base, state: 'done', v, test: failed, text: result || status,
      time: longest ? `${longest.toFixed(2)} s` : '', lang: rowValue(root, /^language/i).replace(/\s*\(.*\)$/, ''),
    };
  }

  QS.Watch = makeWatcher({
    submitForm: (form) => !!$('input[type="file"]', form),
    titleOnSubmit: () => pageHeading(),
    readResult,
    network: 2000,
  });
})();
