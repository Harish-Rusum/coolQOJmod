/* pages.js: rebuilds QOJ's pages from what the page itself shows.

   The theme's look is plain CSS over QOJ's markup, so every page gets it. This file adds the parts CSS
   cannot: the episode header on problems, the home front page, the next contest card. QOJ's own controls
   are moved, never copied, so their handlers keep working. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const { el, icon } = QS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  QS.Pages = {};

  /* --------------------------------------------------------------------------------------- data */

  const HOUR = 3600e3;

  function parseDuration(text) {
    const t = (text || '').toLowerCase();
    const m = /([\d.]+)/.exec(t);
    if (!m) return 5;
    const v = parseFloat(m[1]);
    if (/min|分/.test(t)) return v / 60;
    if (/day|天/.test(t)) return v * 24;
    return v;
  }

  function contestsFromTable(table) {
    if (!table) return [];
    return $$('tbody tr', table).map((tr) => {
      const a = $('td a[href*="/contest/"]', tr);
      const time = $('time[datetime]', tr);
      const tds = $$('td', tr);
      if (!a || !time) return null;
      return {
        name: a.textContent.trim(),
        href: a.getAttribute('href'),
        start: Date.parse(time.getAttribute('datetime')),
        hours: parseDuration(tds[2] && tds[2].textContent),
      };
    }).filter(Boolean);
  }

  QS.Data = {
    /* Only the top of /contests holds upcoming rounds. The full page is huge, so reading stops there. */
    async nextContests() {
      const rec = await QS.get('qs.next');
      if (rec && Date.now() - rec.at < 30 * 60e3) return rec.list;
      const res = await fetch('/contests', { credentials: 'include' });
      if (!res.ok || !res.body) return (rec && rec.list) || [];
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let html = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
        if (html.includes('id="rulesetFilter"') || html.length > 300000) { reader.cancel(); break; }
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const list = contestsFromTable($('.uoj-content table', doc));
      await QS.set('qs.next', { at: Date.now(), list });
      return list;
    },

    parseTopSolved(doc) {
      const link = $('a[href*="ranklist?type=ac_num"]', doc);
      const block = link && link.closest('.text-center');
      const table = block && block.previousElementSibling && $('table', block.previousElementSibling);
      if (!table) return null;
      return $$('tbody tr', table).slice(0, 7).map((tr) => {
        const u = $('.uoj-username', tr);
        const tds = $$('td', tr);
        if (!u) return null;
        return {
          name: u.textContent.trim(),
          nick: u.dataset.nickname || u.textContent.trim(),
          color: u.dataset.userColor || '',
          solved: tds[tds.length - 1].textContent.trim(),
        };
      }).filter(Boolean);
    },

    async topSolved() {
      const rec = await QS.get('qs.top');
      if (rec && Date.now() - rec.at < 12 * HOUR) return rec.rows;
      const res = await fetch('/', { credentials: 'include' });
      if (!res.ok) return (rec && rec.rows) || [];
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const rows = QS.Data.parseTopSolved(doc) || [];
      await QS.set('qs.top', { at: Date.now(), rows });
      return rows;
    },

    readProblemRows(doc) {
      const out = {};
      $$('table tbody tr', doc).forEach((tr) => {
        const a = $('td a[href^="/problem/"]', tr);
        if (!a) return;
        const m = /\/problem\/(\d+)/.exec(a.getAttribute('href'));
        if (!m) return;
        const rec = { title: a.textContent.trim(), tags: $$('.uoj-problem-tag', tr).map((t) => t.textContent.trim()).filter(Boolean) };
        const acLink = $('a[href*="min_score"]', tr);
        const subLink = $('a[href^="/submissions?problem_id"]:not([href*="min_score"])', tr);
        if (acLink) rec.ac = parseInt(acLink.textContent.replace(/\D/g, ''), 10) || 0;
        if (subLink) rec.sub = parseInt(subLink.textContent.replace(/\D/g, ''), 10) || 0;
        const bar = $('.progress-bar[aria-valuenow]', tr);
        if (bar) rec.rate = parseInt(bar.getAttribute('aria-valuenow'), 10);
        out[m[1]] = rec;
      });
      return out;
    },

    async mergeProblems(rows) {
      if (!Object.keys(rows).length) return;
      const all = (await QS.get('qs.problems')) || {};
      for (const [id, rec] of Object.entries(rows)) {
        all[id] = { ...(all[id] || {}), ...rec, at: Date.now() };
      }
      const ids = Object.keys(all);
      if (ids.length > 6000) {
        ids.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, ids.length - 6000).forEach((id) => delete all[id]);
      }
      await QS.set('qs.problems', all);
    },

    /* How many people solved a problem is on the problem list only, behind a cookie of QOJ's own.
       One small search per new problem, and the answer is kept. */
    async problemInfo(id, title, lookup) {
      const all = (await QS.get('qs.problems')) || {};
      const known = all[id];
      if (known && known.ac !== undefined && Date.now() - (known.at || 0) < 7 * 24 * HOUR) return known;
      if (!lookup) return known || null;
      const hadStats = await QS.get('qs.statsOn', false);
      if (!hadStats) document.cookie = 'show_submit_mode=; path=/problems; SameSite=Lax; Secure';
      try {
        const res = await fetch(`/problems?search=${encodeURIComponent(title)}`, { credentials: 'include' });
        if (!res.ok) return known || null;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const rows = QS.Data.readProblemRows(doc);
        await QS.Data.mergeProblems(rows);
        return rows[id] || known || null;
      } catch {
        return known || null;
      } finally {
        if (!hadStats) document.cookie = 'show_submit_mode=; path=/problems; SameSite=Lax; Secure; Max-Age=0';
      }
    },

    async remember(entry) {
      const h = (await QS.get('qs.history')) || [];
      const next = [{ ...(h.find((e) => e.id === entry.id) || {}), ...entry, at: Date.now() }, ...h.filter((e) => e.id !== entry.id)].slice(0, 40);
      await QS.set('qs.history', next);
      return next;
    },

    arcOf(S, info, difficulty) {
      if (difficulty > 0) return difficulty <= 3 ? 'easy' : difficulty >= 8 ? 'hard' : 'mid';
      if (!info || info.ac === undefined) return 'none';
      if (info.ac >= S.arcRule.easyMin) return 'easy';
      if (info.ac <= S.arcRule.hardMax) return 'hard';
      return 'mid';
    },

    danger(info, difficulty) {
      if (difficulty > 0) return Math.max(1, Math.min(5, Math.ceil(difficulty / 2)));
      if (!info || info.ac === undefined) return 0;
      const a = info.ac;
      return a >= 1000 ? 1 : a >= 400 ? 2 : a >= 120 ? 3 : a >= 40 ? 4 : 5;
    },
  };

  /* -------------------------------------------------------------------------------------- shell */

  const NAV_MATCH = [
    [/^\/contests?(\/|$)/, '/contests'],
    [/^\/category/, '/category'],
    [/^\/problems?(\/|$)/, '/problems'],
    [/^\/submissions?(\/|$)/, '/submissions'],
    [/^\/hacks?(\/|$)/, '/hacks'],
    [/^\/(blogs?|announcements)(\/|$)/, '/blogs'],
  ];

  QS.Shell = {
    init() {
      const nav = $('.navbar');
      if (!nav) return;
      const path = (QS.env && QS.env.path) || location.pathname;
      const hit = NAV_MATCH.find(([re]) => re.test(path));
      if (hit) {
        $$('.navbar-nav .nav-link', nav).forEach((a) => {
          if ((a.getAttribute('href') || '').replace(/^\/\/[^/]+/, '') === hit[1]) a.closest('.nav-item').classList.add('qs-active');
        });
      }
      const brand = $('.navbar-brand', nav);
      if (brand && !$('.qs-brand-mark', brand)) {
        brand.prepend(el('span', { class: 'qs-brand-mark', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')));
      }
      const pills = $('ul.nav-pills.float-right');
      if (pills) {
        const me = $('.uoj-username', pills);
        if (me) {
          QS.me = { name: me.textContent.trim(), rating: parseInt(me.dataset.rating, 10) || null, color: me.dataset.userColor || '' };
        }
        const logout = $('a[href*="logout"]', pills);
        const menu = $('.dropdown-menu', pills);
        if (logout && menu) {
          const li = logout.closest('li');
          logout.classList.remove('nav-link');
          logout.classList.add('dropdown-item');
          menu.append(logout);
          if (li) li.remove();
        }
        nav.append(pills);
        pills.classList.add('qs-user');
      }
    },
  };

  /* -------------------------------------------------------------------------------- small pieces */

  const pill = (children, cls = '') => el('span', { class: `qs-pill ${cls}` }, children);

  function meter(level) {
    const bars = [];
    for (let i = 1; i <= 5; i++) bars.push(el('i', { class: i <= level ? 'on' : '' }));
    return el('span', { class: `qs-meter qs-meter-${level}`, title: `Danger ${level} of 5` }, bars);
  }

  const KANJI = ['告', '新', '報', '知', '更', '録', '記', '伝', '話', '章', '節', '幕'];
  const firstKanji = (text) => {
    const m = /[一-鿿]/.exec(text || '');
    return m ? m[0] : KANJI[QS.hash(text || '') % KANJI.length];
  };

  /* A thumbnail cut from the scene itself: a diagonal panel, one big character. */
  function poster(seed, wide) {
    const h = QS.hash(seed);
    return el('span', {
      class: `qs-poster${wide ? ' qs-poster-wide' : ''}`,
      'aria-hidden': 'true',
      style: { '--px': `${h % 100}%`, '--py': `${(h >> 8) % 100}%`, '--tilt': `${8 + ((h >> 16) % 14)}deg` },
    }, el('span', { class: 'qs-poster-art' }), el('span', { class: 'qs-poster-block' }), el('span', { class: 'qs-poster-kanji', text: firstKanji(seed) }));
  }

  function countdownText(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const pad = (n) => String(n).padStart(2, '0');
    const t = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    return d ? `${d}d ${t}` : t;
  }

  /* The next round: name, big clock, one button. */
  function nextCard(S, contest) {
    const w = S.words;
    const clock = el('div', { class: 'qs-next-clock' });
    const status = el('div', { class: 'qs-next-status' });
    const tick = () => {
      const now = Date.now();
      const end = contest.start + contest.hours * HOUR;
      if (now < contest.start) {
        status.textContent = '';
        clock.textContent = countdownText(contest.start - now);
      } else if (now < end) {
        status.textContent = 'On air, time left';
        clock.textContent = countdownText(end - now);
      } else {
        status.textContent = 'Finished';
        clock.textContent = '00:00:00';
        clearInterval(timer);
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return el('aside', { class: 'qs-next' },
      el('div', { class: 'qs-next-kicker', text: w.next }),
      el('a', { class: 'qs-next-name', href: contest.href, text: contest.name }),
      status,
      clock,
      el('a', { class: 'qs-slant qs-slant-primary qs-slant-sm', href: contest.href, text: Date.now() < contest.start ? 'Register' : 'Enter' }));
  }

  /* ------------------------------------------------------------------------------------- problem */

  function parseBadges(content) {
    const out = { time: '', memory: '', points: '', difficulty: 0, extra: [] };
    const row = $$('.row', content).find((r) => $('.badge', r) && !$('h1', r) && !$('.tab-content', r));
    if (!row) return { ...out, row: null };
    $$('.badge', row).forEach((b) => {
      if (b.id === 'difficulty-badge') {
        const bar = $('.progress-bar[aria-valuenow]', b);
        out.difficulty = bar ? parseInt(bar.getAttribute('aria-valuenow'), 10) || 0 : 0;
        return;
      }
      if (b.closest('#difficulty-badge')) return;
      const text = b.textContent.replace(/\s+/g, ' ').trim();
      const value = text.includes(':') ? text.split(':').slice(1).join(':').trim() : text;
      if (/\d\s*(s|ms)\b/i.test(value) && !out.time) out.time = value;
      else if (/\d\s*(mb|gb|kb|mib|gib|kib)\b/i.test(value) && !out.memory) out.memory = value;
      else if (/^\d+(\.\d+)?$/.test(value) && !out.points) out.points = value;
      else if (text) out.extra.push(text); // anything else QOJ says about the problem stays visible
    });
    return { ...out, row };
  }

  function parseTitle(h1, route) {
    const raw = h1.textContent.replace(/\s+/g, ' ').trim();
    let m = /^#\s*(\d+)\s*[.．]\s*(.*)$/.exec(raw);
    if (m) return { no: m[1], title: m[2], full: m[2] };
    m = /^([A-Z][0-9]?)\s*[.．]\s*(.*)$/.exec(raw);
    if (m) {
      const idx = m[1].charCodeAt(0) - 64;
      return { no: String(idx), letter: m[1], title: m[2], full: `${m[1]}. ${m[2]}` };
    }
    return { no: route.id || '', title: raw, full: raw };
  }

  function episodeLabel(S, no) {
    return (S.words.episode || '第{n}話').replace('{n}', no);
  }

  QS.Pages.problem = async (S, route) => {
    const content = $('.uoj-content');
    /* On a contest's problem QOJ's header row holds three things: the contest name, the problem, the clock. */
    const headerRow = content && $('.page-header.row', content);
    const h1 = content && ((headerRow && ($('h1.text-center', headerRow) || $$('h1', headerRow).pop())) || $('h1.page-header', content) || $('h1', content));
    const contestH1 = headerRow && $$('h1', headerRow).find((n) => n !== h1);
    const tabs = content && $('ul.nav-tabs', content);
    const tabBody = content && $('.tab-content', content);
    if (!h1 || !tabBody) {
      document.documentElement.setAttribute('data-qs-page', 'other');
      return null;
    }
    {
      const t = parseTitle(h1, route);
      const b = parseBadges(content);
      QS.episode = { route, no: t.no, label: episodeLabel(S, t.no), title: t.full, plainTitle: t.title, arc: 'none', time: b.time, memory: b.memory };
    }
    if (S.look.view === 'classic') {
      /* classic: QOJ's arrangement, only the statement is still converted */
      const compactFrame = $('iframe#statements-pdf, iframe[src*="download.php"]', content);
      if (S.pdf.convert && compactFrame) QS.Statement.mount(S, compactFrame, null);
      const art = $('article.uoj-article', content);
      if (art && art.textContent.trim()) QS.Statement.decorateHtml(art);
      document.documentElement.setAttribute('data-qs-page', 'other');
      return QS.episode;
    }

    const badges = parseBadges(content);
    const titleInfo = parseTitle(h1, route);
    const voteBlock = $$('.float-right', content).find((n) => $('.uoj-click-zan-block', n) || $('.uoj-favourite-block', n));
    const buttons = $$(':scope > a.btn, :scope > .btn', content);
    const contestAlert = $$('.alert', content).find((a) => $('a[href*="/contest/"]', a) && !a.closest('.tab-content'));
    const contests = contestAlert ? $$('a[href*="/contest/"]', contestAlert).map((a) => ({ name: a.textContent.trim(), href: a.getAttribute('href') })) : [];
    if (route.contest && contestH1 && contestH1.textContent.trim()) contests.unshift({ name: contestH1.textContent.trim(), href: `/contest/${route.contest}` });
    const countdown = QS.liveClock();

    const linkFor = (id) => tabs && $(`a[href="#${id}"]`, tabs);
    const openTab = (id) => (e) => {
      if (e) e.preventDefault();
      const a = linkFor(id);
      if (a) {
        a.click();
        const top = $('.qs-tabbody');
        if (top) window.scrollTo({ top: top.getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' });
      }
    };

    /* header */
    const kickerSource = el('span', { class: 'qs-ep-source', text: contests[0] ? contests[0].name : '' });
    const kickerArc = el('span', { class: 'qs-ep-arc' });
    const title = el('h1', { class: 'qs-ep-title', text: titleInfo.full });
    const header = el('header', { class: 'qs-ep' },
      el('div', { class: 'qs-ep-kicker' }, el('span', { class: 'qs-ep-no', text: episodeLabel(S, titleInfo.no) }), kickerSource, kickerArc),
      title);

    /* facts */
    const dangerPill = pill([], 'qs-pill-danger');
    dangerPill.hidden = true;
    const facts = el('div', { class: 'qs-ep-facts' }, dangerPill,
      badges.time ? pill([icon('clock', 13), `${badges.time} per test`]) : null,
      badges.memory ? pill([icon('box', 13), badges.memory]) : null,
      badges.points ? pill(`${badges.points} points`) : null,
      badges.extra.map((t) => pill(t)));
    const ioPill = el('span', { class: 'qs-ep-io' });
    facts.append(ioPill);
    const tagsRow = el('div', { class: 'qs-ep-tags' });

    /* actions */
    const actions = el('div', { class: 'qs-ep-actions' });
    if (linkFor('tab-submit-answer')) {
      actions.append(el('button', { type: 'button', class: 'qs-submit', onclick: openTab('tab-submit-answer') }, icon('send', 15), 'Submit'));
    }
    const secondary = el('div', { class: 'qs-ep-secondary' });
    const stats = buttons.find((b) => /statistics/.test(b.getAttribute('href') || ''));
    if (stats) secondary.append(el('a', { class: 'qs-outline', href: stats.getAttribute('href') }, icon('stats', 14), 'Statistics'));
    if (linkFor('tab-discussions-issues')) secondary.append(el('button', { type: 'button', class: 'qs-outline', onclick: openTab('tab-discussions-issues') }, icon('chat', 14), 'Discussions'));
    if (secondary.children.length) actions.append(secondary);
    const tertiary = el('div', { class: 'qs-ep-tertiary' });
    if (linkFor('tab-custom-test')) tertiary.append(el('a', { href: '#tab-custom-test', onclick: openTab('tab-custom-test'), text: 'Custom test' }));
    const attach = tabs && $('a[href*="type=problem"]', tabs);
    if (attach) tertiary.append(el('a', { href: attach.getAttribute('href'), text: 'Attachments' }));
    if (tertiary.children.length) actions.append(tertiary);

    const left = el('div', { class: 'qs-ep-left' }, facts, tagsRow);
    if (voteBlock) { voteBlock.classList.remove('float-right'); voteBlock.classList.add('qs-votes'); left.append(voteBlock); }
    const meta = el('section', { class: 'qs-ep-meta' }, left, actions);

    /* body */
    const body = el('div', { class: 'qs-tabbody' });
    const panel = el('main', { class: 'qs-panel' }, header, meta, body);

    /* side column */
    const side = el('aside', { class: 'qs-side' });
    const sideOn = S.layout.side || S.look.view === 'split';
    if (sideOn) {
      if (contests.length || countdown) {
        const card = el('section', { class: 'qs-card' }, el('h2', { text: contests.length > 1 ? 'Contests' : 'Contest' }));
        contests.forEach((c) => card.append(el('a', { class: 'qs-card-title', href: c.href, text: c.name })));
        if (countdown) {
          const box = countdown.closest('.text-center') || countdown;
          box.classList.add('qs-countdown');
          card.append(box);
        }
        side.append(card);
      }
    }

    const grid = el('div', { class: `qs-problem${sideOn ? '' : ' qs-no-side'}` });
    if (tabs) {
      const sub = el('nav', { class: 'qs-subnav', 'aria-label': 'Problem sections' }, tabs);
      grid.append(sub);
    }
    grid.append(panel);
    if (sideOn) grid.append(side);

    h1.classList.add('qs-gone');
    if (headerRow) headerRow.classList.add('qs-gone');
    if (badges.row) badges.row.classList.add('qs-gone');
    buttons.forEach((b) => { if (b === stats) b.classList.add('qs-gone'); });
    if (contestAlert) contestAlert.classList.add('qs-gone');
    content.prepend(grid);
    body.append(tabBody);
    if (S.look.view === 'split') {
      const pane = $('#tab-submit-answer', tabBody);
      if (pane) {
        side.prepend(el('section', { class: 'qs-card qs-split-submit' }, el('h2', { text: 'Submit' }), pane));
      }
    }

    /* statement */
    const onMeta = (m) => {
      if (m.source && !contests.length) kickerSource.textContent = m.source;
      const lim = m.limits || {};
      const inF = lim['input file'] || lim['input'] || '';
      const outF = lim['output file'] || lim['output'] || '';
      if (inF && outF) {
        ioPill.textContent = /^standard/i.test(inF) && /^standard/i.test(outF) ? 'standard input / output' : `${inF} / ${outF}`;
      }
    };
    const frame = $('iframe#statements-pdf, iframe[src*="download.php"]', tabBody);
    const article = $('article.uoj-article', tabBody);
    if (frame && S.pdf.convert) QS.Statement.mount(S, frame, onMeta);
    else if (frame) { QS.Statement.restore(frame); }
    if (article && article.textContent.trim()) QS.Statement.decorateHtml(article);
    else if (article) article.classList.add('qs-gone');
    $$('#tab-submit-answer, #tab-custom-test', tabBody).forEach((n) => n.classList.add('qs-form-pane'));

    /* what we know about it */
    const applyInfo = (info) => {
      const arc = QS.Data.arcOf(S, info, badges.difficulty);
      const words = S.words.arcs[arc] || S.words.arcs.none;
      kickerArc.textContent = words.jp;
      kickerArc.title = words.en;
      const level = QS.Data.danger(info, badges.difficulty);
      if (level) {
        dangerPill.hidden = false;
        dangerPill.replaceChildren(el('span', { class: 'qs-danger-word', text: S.words.danger }), meter(level), el('span', { text: `${level}/5` }));
        if (info && info.ac !== undefined) dangerPill.title = `${info.ac} solved of ${info.sub || '?'} submissions`;
      }
      if (info && info.ac !== undefined) {
        const old = $('.qs-solved-pill', facts);
        if (old) old.remove();
        facts.insertBefore(pill(`Solved by ${info.ac}`, 'qs-solved-pill'), dangerPill.nextSibling);
      }
      if (info && info.tags && info.tags.length) {
        tagsRow.replaceChildren(...info.tags.map((t) => el('a', { class: 'qs-tag', href: `/problems?tag=${encodeURIComponent(t)}`, text: t })));
        if (!contests.length && !kickerSource.textContent) kickerSource.textContent = info.tags[0];
      }
      return arc;
    };

    const lookup = QS.Data.problemInfo(route.id, titleInfo.title, S.arcRule.lookup && !route.contest);
    /* a short wait so the first visit can pick the right arc; a slow answer only updates the pills */
    const early = await Promise.race([lookup, new Promise((r) => setTimeout(() => r(undefined), 450))]);
    const arc = applyInfo(early === undefined ? null : early);
    if (early === undefined) lookup.then((info) => applyInfo(info));
    await QS.applyTheme(S, arc);

    /* side cards that need data */
    if (sideOn) {
      const runs = ((await QS.get('qs.runs')) || {})[route.id] || [];
      if (runs.length) {
        side.append(el('section', { class: 'qs-card' }, el('h2', { text: 'Your runs' }),
          el('div', { class: 'qs-runs' }, runs.slice(0, 6).map((r) => el('a', { class: `qs-run qs-v-${r.v}`, href: `/submission/${r.sub}` }, el('span', { class: 'qs-run-v', text: QS.Watch ? QS.Watch.short(r) : r.v }), el('span', { class: 'qs-run-id', text: `#${r.sub}` }))))));
      }
      if (S.layout.topSolved) {
        QS.Data.topSolved().then((rows) => {
          if (!rows || !rows.length) return;
          const table = el('table', { class: 'qs-mini-table' },
            el('thead', null, el('tr', null, el('th', { text: '#' }), el('th', { text: 'User' }), el('th', { text: 'Solved' }))),
            el('tbody', null, rows.map((r, i) => el('tr', null,
              el('td', { text: String(i + 1) }),
              el('td', null, el('a', { class: 'uoj-username', href: `/user/profile/${encodeURIComponent(r.name)}`, style: r.color ? { color: r.color } : null, text: r.nick })),
              el('td', { text: r.solved })))));
          side.append(el('section', { class: 'qs-card' }, el('h2', { text: 'Top solved' }), table));
          QS.Inks.scan(side);
        }).catch(() => {});
      }
      if (!side.children.length) grid.classList.add('qs-no-side');
    }

    QS.Data.remember({ id: route.id, contest: route.contest || '', title: titleInfo.full, opened: Date.now() });
    return {
      route, no: titleInfo.no, label: episodeLabel(S, titleInfo.no), title: titleInfo.full, plainTitle: titleInfo.title, arc,
      time: badges.time, memory: badges.memory, source: () => kickerSource.textContent,
    };
  };

  /* ---------------------------------------------------------------------------------------- home */

  QS.Pages.home = async (S) => {
    const content = $('.uoj-content');
    if (!content) return;
    const container = content.parentElement;
    const w = S.words;
    const top = QS.Data.parseTopSolved(document);
    if (top && top.length) QS.set('qs.top', { at: Date.now(), rows: top });

    const history = (await QS.get('qs.history')) || [];
    const unfinished = history.filter((h) => h.v !== 'ac');

    /* front banner */
    if (S.look.view !== 'classic' && S.layout.hero) {
      const me = QS.me;
      const firstEpisode = unfinished[0] ? (unfinished[0].contest ? `/contest/${unfinished[0].contest}/problem/${unfinished[0].id}` : `/problem/${unfinished[0].id}`) : '/problems';
      const hero = el('section', { id: 'qs-hero', class: 'qs-added' },
        el('div', { class: 'qs-hero-copy' },
          el('h1', { class: 'qs-hero-title' }, me ? w.heroTitle : w.guestTitle, el('br'), el('b', { text: me ? me.name : w.series })),
          el('p', { class: 'qs-hero-sub', text: me ? w.heroSub : w.guestSub }),
          el('div', { class: 'qs-hero-cta' },
            el('a', { class: 'qs-slant qs-slant-primary', href: firstEpisode, text: w.heroCta }),
            el('a', { class: 'qs-slant qs-slant-ghost', href: '/contests', text: w.heroCta2 }))),
        el('div', { class: 'qs-hero-side' }));
      container.insertBefore(hero, content);
      if (S.layout.next) {
        QS.Data.nextContests().then((list) => {
          const now = Date.now();
          const c = list.find((x) => x.start + x.hours * HOUR > now);
          if (c) $('.qs-hero-side', hero).append(nextCard(S, c));
        }).catch(() => {});
      }
    }

    const added = el('div', { class: 'qs-home qs-added' });
    /* continue watching */
    if (S.look.view !== 'classic' && S.layout.cont && unfinished.length) {
      const rail = el('div', { class: 'qs-rail' }, unfinished.slice(0, 4).map((h) => el('a', {
        class: 'qs-watch', href: h.contest ? `/contest/${h.contest}/problem/${h.id}` : `/problem/${h.id}`,
      }, poster(`${h.id}:${h.title}`), el('span', { class: 'qs-watch-text' }, el('b', { text: h.title }), el('small', { text: h.v ? (QS.Watch ? QS.Watch.long(h.v) : h.v) : 'Opened, not submitted' })))));
      added.append(el('section', { class: 'qs-section' }, el('h2', { class: 'qs-section-title', text: w.cont }), rail));
    }
    /* news */
    const card = $(':scope > .card', content);
    if (S.look.view !== 'classic' && S.layout.news && card) {
      const rows = $$('tbody tr', card).map((tr) => {
        const a = $('td a', tr);
        if (!a) return null;
        const user = $('.uoj-username', tr);
        const time = $('time', tr);
        return { a, user, time, title: a.textContent.trim() };
      }).filter(Boolean);
      if (rows.length) {
        const feed = el('div', { class: 'qs-feed' }, rows.map((r) => el('article', { class: 'qs-news' },
          el('a', { href: r.a.getAttribute('href'), tabIndex: -1, 'aria-hidden': 'true' }, poster(r.title, true)),
          el('div', { class: 'qs-news-text' },
            el('a', { class: 'qs-news-title', href: r.a.getAttribute('href'), text: r.title }),
            el('div', { class: 'qs-news-by' }, r.user ? r.user.cloneNode(true) : null, r.time ? el('span', { class: 'qs-news-time', text: r.time.textContent.trim() }) : null)))));
        const more = $('a[href="/announcements"]', card);
        added.append(el('section', { class: 'qs-section' },
          el('h2', { class: 'qs-section-title' }, el('span', { class: 'qs-kanji', text: w.news }), ' ', w.newsEn),
          feed,
          more ? el('a', { class: 'qs-more', href: '/announcements' }, 'All announcements', icon('arrow', 14)) : null));
        card.classList.add('qs-gone');
      }
    }
    content.prepend(added);
  };

  /* ------------------------------------------------------------------------------------ contests */

  QS.Pages.contests = (S) => {
    const content = $('.uoj-content');
    if (!content) return;
    const firstHeading = $('h4', content);
    const firstTable = firstHeading && firstHeading.nextElementSibling && $('table', firstHeading.nextElementSibling);
    const countdown = $('#contest-countdown', content);
    const list = countdown && firstTable ? contestsFromTable(firstTable) : [];
    if (list.length) {
      QS.set('qs.next', { at: Date.now(), list });
      if (S.look.view !== 'classic' && S.layout.next) {
        const now = Date.now();
        const c = list.find((x) => x.start + x.hours * HOUR > now);
        if (c) {
          content.parentElement.insertBefore(el('section', { id: 'qs-next-banner', class: 'qs-added' }, nextCard(S, c)), content);
          const box = countdown.closest('.text-center');
          if (box) box.classList.add('qs-gone');
        }
      }
    }
  };

  /* ------------------------------------------------------------------------------------ problems */

  QS.Pages.problems = (S) => {
    const stats = $('#input-show_submit_mode');
    if (stats) QS.set('qs.statsOn', !!stats.checked);
    QS.Data.mergeProblems(QS.Data.readProblemRows(document));
  };

  QS.Statement.restore = (frame) => {
    if (frame.dataset.qsSrc) frame.setAttribute('src', frame.dataset.qsSrc);
    frame.style.display = '';
  };
})();
