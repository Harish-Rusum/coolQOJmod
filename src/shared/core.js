/* core.js: settings, storage and small helpers. Loaded first everywhere: content scripts, popup, Studio. */
(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const QS = (globalThis.QS = globalThis.QS || {});
  QS.api = api;

  /* Every sound the extension can make. Each one can be switched off, given its own volume, or replaced by a file. */
  QS.SOUND_EVENTS = [
    { id: 'title', label: 'Title card', note: 'when a problem opens' },
    { id: 'slash', label: 'Title card ends', note: 'the cut back to the page' },
    { id: 'launch', label: 'Submit', note: 'the moment you press it' },
    { id: 'cut', label: 'Test passed', note: 'every test during judging' },
    { id: 'standoff', label: 'Judging loop', note: 'plays while you wait' },
    { id: 'ac', label: 'Accepted', note: '' },
    { id: 'partial', label: 'Partial score', note: '' },
    { id: 'wa', label: 'Wrong answer', note: '' },
    { id: 'tle', label: 'Time limit', note: '' },
    { id: 'mle', label: 'Memory limit', note: '' },
    { id: 're', label: 'Runtime error', note: '' },
    { id: 'ce', label: 'Compile error', note: '' },
    { id: 'levelup', label: 'Rating up', note: '' },
  ];

  QS.VERDICTS = ['ac', 'partial', 'wa', 'tle', 'mle', 're', 'ce'];


  QS.DEFAULTS = {
    on: true,
    look: { style: 'glass', view: 'cinema' },
    scene: {
      every: 'sakura-valley',
      byArc: true,
      arcs: { easy: 'blossom-road', mid: 'jade-dragon', hard: 'shrine-steps' },
      tune: {}, // per scene: { x, y, zoom, bright, sat }
    },
    arcRule: { easyMin: 400, hardMax: 40, lookup: true },
    glass: { mode: 'dark', visibility: 90, frost: 14, radius: 14, accent: '', accent2: '', scrim: '' },
    type: { display: 'dela', body: 'mona', mono: 'jetbrains', size: 15.5, width: 76 },
    motion: { ambient: 'auto', density: 50, speed: 50, front: false },
    moments: {
      title: true,
      titleWhen: 'always', // always | session | never
      broadcast: true,
      verdicts: { ac: true, partial: true, wa: true, tle: true, mle: true, re: true, ce: true },
      live: false,
      speed: 1,
      levelUp: true,
      shake: true,
    },
    sound: { on: true, volume: 70, pack: 'battle', events: {} },
    layout: { hero: true, next: true, cont: true, news: true, side: true, topSolved: true },
    pdf: { convert: true, view: 'text' },
    words: {
      series: 'QOJ',
      heroTitle: 'Welcome back,',
      heroSub: 'Your series is on air. Pick up the next episode.',
      guestTitle: 'Welcome to',
      guestSub: 'A new series is about to air. Sign in and pick your first episode.',
      heroCta: 'Next episode',
      heroCta2: 'Schedule',
      episode: '第{n}話',
      next: '次回予告',
      news: 'お知らせ',
      newsEn: 'News',
      cont: 'Continue watching',
      schedule: '番組表',
      danger: '危険度',
      arcs: {
        easy: { jp: '日常編', en: 'Daily life' },
        mid: { jp: '修行編', en: 'Training' },
        hard: { jp: '最終決戦', en: 'Final battle' },
        none: { jp: '本編', en: 'Main story' },
      },
      cut: {
        launch: '出撃',
        judging: '判定中',
        ac: '完',
        partial: '惜敗',
        wa: 'つづく',
        tle: '時間切れ',
        mle: '限界突破',
        re: '放送事故',
        ce: 'リテイク',
        levelup: '覚醒',
      },
      cutEn: {
        ac: 'Accepted',
        partial: 'Partial score',
        wa: 'To be continued',
        tle: 'Time limit exceeded',
        mle: 'Memory limit exceeded',
        re: 'Runtime error',
        ce: 'Compile error',
        levelup: 'Rating up',
      },
    },
    customCss: '',
  };

  /* The looks. Picking one writes these values into the settings, so every slider still works afterwards. */
  QS.STYLES = {
    glass: { label: 'Glass', jp: '硝子', note: 'Frosted panels over the scene', scene: 'sakura-valley', set: { glass: { mode: 'dark', visibility: 90, frost: 14, radius: 14, accent: '', accent2: '', scrim: '' }, type: { display: 'dela', body: 'mona' }, motion: { ambient: 'auto' } } },
    manga: { label: 'Manga', jp: '漫画', note: 'One spot colour on tinted paper, panels and screentone', scene: 'moon-vigil', set: { glass: { mode: 'light', visibility: 0, frost: 0, radius: 0, accent: '', accent2: '', scrim: '#f1e8d6' }, type: { display: 'dela', body: 'mona' }, motion: { ambient: 'none' } } },
    shonen: { label: 'Battle Poster', jp: '熱血', note: 'Everything on the diagonal, one loud colour', scene: 'ember-sun', set: { glass: { mode: 'dark', visibility: 45, frost: 14, radius: 0, accent: '', accent2: '', scrim: '#08050c' }, type: { display: 'dela', body: 'mona' }, motion: { ambient: 'embers' } } },
  };

  QS.VIEWS = {
    cinema: { label: 'Cinema', note: 'Big header, side column' },
    reader: { label: 'Reader', note: 'One column, only the statement' },
    split: { label: 'Split', note: 'Statement beside the submit form' },
    classic: { label: 'Classic', note: "QOJ's own arrangement, themed" },
  };

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  QS.merge = function merge(base, extra) {
    if (!isObj(extra)) return extra === undefined ? base : extra;
    const out = isObj(base) ? { ...base } : {};
    for (const k of Object.keys(extra)) out[k] = isObj(extra[k]) ? merge(out[k], extra[k]) : extra[k];
    return out;
  };

  QS.load = async () => {
    const got = await api.storage.local.get('qs.settings');
    const saved = got['qs.settings'] || {};
    /* a theme file can name a style this version does not have */
    if (saved.look && !QS.STYLES[saved.look.style]) saved.look.style = 'glass';
    const S = QS.merge(QS.DEFAULTS, saved);
    /* a saved scene that is no longer in the package falls back to the default for its slot */
    if (QS.SCENES) {
      const missing = (id) => !String(id).startsWith('custom:') && !QS.SCENES[id];
      if (missing(S.scene.every)) S.scene.every = QS.DEFAULTS.scene.every;
      for (const arc of Object.keys(S.scene.arcs)) if (missing(S.scene.arcs[arc])) S.scene.arcs[arc] = QS.DEFAULTS.scene.arcs[arc];
    }
    return S;
  };

  QS.save = (settings) => api.storage.local.set({ 'qs.settings': settings });

  QS.get = async (key, fallback) => {
    const got = await api.storage.local.get(key);
    return got[key] === undefined ? fallback : got[key];
  };

  QS.set = (key, value) => api.storage.local.set({ [key]: value });

  /* Small DOM builder: every string goes in as text, never as markup. */
  QS.el = function el(tag, props, ...kids) {
    const SVG = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'rect' || tag === 'g' || tag === 'line';
    const n = SVG ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') n.setAttribute('class', v);
        else if (k === 'text') n.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [p, val] of Object.entries(v)) {
            if (p.startsWith('--')) n.style.setProperty(p, val);
            else n.style[p] = val;
          }
        } else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k in n && !SVG && k !== 'list') n[k] = v;
        else n.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.append(kid);
    }
    return n;
  };

  /* Line icons drawn with the same 16 unit grid, stroke only. */
  const ICONS = {
    send: 'M2.5 8 13.5 2.5 10 13.5 7.5 8.8 2.5 8Z M7.5 8.8 13.5 2.5',
    stats: 'M3 13V7 M8 13V3 M13 13V9',
    chat: 'M2.5 3.5h11v7.5H7l-3 2.5V11H2.5Z',
    clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z M8 5v3.2l2 1.3',
    box: 'M8 2 13.5 5v6L8 14 2.5 11V5Z M2.5 5 8 8l5.5-3 M8 8v6',
    file: 'M4 2h5l3 3v9H4Z M9 2v3h3',
    test: 'M3 3.5h10v9H3Z M5.5 6.5 7.5 8.5 5.5 10.5 M8.5 10.5h2.5',
    copy: 'M6 2.5h7.5V10H11 M2.5 6H10v7.5H2.5Z',
    check: 'M3 8.5 6.5 12 13 4.5',
    download: 'M8 2.5v8 M4.5 7.5 8 11l3.5-3.5 M3 13.5h10',
    arrow: 'M3 8h10 M9 4l4 4-4 4',
    refresh: 'M13 8a5 5 0 1 1-1.5-3.5 M13 2.5v3h-3',
    play: 'M5 3.5v9l7-4.5Z',
    x: 'M4 4l8 8 M12 4l-8 8',
    star: 'M8 2.5l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 10.8l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5Z',
    up: 'M8 13V3 M4 7l4-4 4 4',
    upload: 'M8 13V5 M4.5 8 8 4.5 11.5 8 M3 2.5h10',
    trash: 'M3 4.5h10 M6 4.5V2.5h4v2 M4.5 4.5l.7 9h5.6l.7-9',
    volume: 'M2.5 6v4H5l3.5 3V3L5 6Z M11 5.5a3.5 3.5 0 0 1 0 5',
  };
  QS.icon = (name, size = 16) => QS.el('svg', {
    viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'qs-ico', 'aria-hidden': 'true',
  }, QS.el('path', { d: ICONS[name] || '' }));

  /* Which page is this? Worked out from the address alone so it can run before the page exists. */
  QS.routeOf = (path) => {
    const p = path.replace(/\/+$/, '') || '/';
    let m;
    if (p === '/') return { name: 'home' };
    if ((m = p.match(/^\/problem\/(\d+)(?:\/statement\/([\w-]+))?$/))) return { name: 'problem', id: m[1], lang: m[2] || '' };
    if ((m = p.match(/^\/contest\/(\d+)\/problem\/(\d+)(?:\/statement\/([\w-]+))?$/))) return { name: 'problem', contest: m[1], id: m[2], lang: m[3] || '' };
    if (p === '/problems' || /^\/problems\//.test(p)) return { name: 'problems' };
    if (p === '/contests') return { name: 'contests' };
    if ((m = p.match(/^\/contest\/(\d+)\/standings/))) return { name: 'standings', contest: m[1] };
    if ((m = p.match(/^\/contest\/(\d+)\/submissions/))) return { name: 'submissions', contest: m[1] };
    if ((m = p.match(/^\/contest\/(\d+)/))) return { name: 'contest', contest: m[1] };
    if (p === '/submissions') return { name: 'submissions' };
    if ((m = p.match(/^\/submission\/(\d+)/))) return { name: 'submission', id: m[1] };
    if ((m = p.match(/^\/user\/profile\/([^/]+)/))) return { name: 'user', user: decodeURIComponent(m[1]) };
    if (p === '/blogs' || p === '/announcements') return { name: 'blogs' };
    if (/^\/blog\//.test(p) || /^\/blogs\/\d+/.test(p)) return { name: 'blog' };
    if (p === '/hacks' || /^\/hack\//.test(p)) return { name: 'hacks' };
    if (/^\/category/.test(p)) return { name: 'category' };
    if (/^\/ranklist/.test(p)) return { name: 'ranklist' };
    if (/^\/(login|register|forgot-password|reset-password)/.test(p)) return { name: 'auth' };
    return { name: 'other' };
  };

  /* Which site this page is on. The CSES and oj.uz adapters replace this, along with QS.routeOf. */
  QS.site = { id: 'qoj', ready: () => !!document.querySelector('.uoj-content') };
  /* Records about problems and runs are per site: ids mean different problems on different sites. */
  QS.key = (name) => (QS.site.id === 'qoj' ? `qs.${name}` : `qs.${QS.site.id}.${name}`);

  QS.hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  QS.applyStyle = (S, id) => {
    const st = QS.STYLES[id];
    const next = QS.merge(S, { ...st.set, look: { ...S.look, style: id } });
    /* each style comes with a scene that suits it, once that scene is in the package */
    if (st.scene && QS.SCENES && QS.SCENES[st.scene]) next.scene.every = st.scene;
    return next;
  };
})();
