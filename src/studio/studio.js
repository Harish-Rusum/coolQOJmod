/* studio.js: the editor. Every control writes to storage straight away; the preview and any open QOJ tab read
   the same storage, so they update on their own. */
(async () => {
  'use strict';
  const QS = globalThis.QS;
  const { el } = QS;
  const api = QS.api;
  let S = await QS.load();

  const frame = document.getElementById('frame');
  const post = (m) => { if (frame.contentWindow) frame.contentWindow.postMessage(m, location.origin); };

  let saveTimer = 0;
  const commit = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => QS.save(S), 80);
    refreshTheme();
  };

  const getPath = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), S);
  const setPath = (path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    let o = S;
    for (const k of keys) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    o[last] = value;
    commit();
  };

  /* -------------------------------------------------------------------------------- small controls */

  let uid = 0;
  const nextId = () => `c${++uid}`;

  function toggle(label, path, onChange, note) {
    const input = el('input', { type: 'checkbox', checked: !!getPath(path) });
    input.addEventListener('change', () => { setPath(path, input.checked); if (onChange) onChange(input.checked); });
    return el('label', { class: 'switch' }, input, el('span', { class: 'track' }), el('span', null, label, note ? el('span', { class: 'note', style: { display: 'block', marginTop: '0' }, text: note }) : null));
  }

  function slider(label, path, min, max, step, fmt = (v) => v, fallback) {
    const id = nextId();
    const cur = getPath(path);
    const input = el('input', { id, type: 'range', min, max, step, value: cur === undefined ? fallback : cur });
    const out = el('output', { text: String(fmt(+input.value)) });
    input.addEventListener('input', () => {
      setPath(path, +input.value);
      out.textContent = fmt(+input.value);
    });
    return el('div', { class: 'row' }, el('label', { for: id, text: label }), input, out);
  }

  function select(label, path, options, onChange) {
    const id = nextId();
    const input = el('select', { id }, options.map(([v, t]) => el('option', { value: v, text: t })));
    input.value = getPath(path);
    input.addEventListener('change', () => { setPath(path, input.value); if (onChange) onChange(input.value); });
    return el('div', { class: 'row' }, el('label', { for: id, text: label }), input);
  }

  function text(label, path) {
    const input = el('input', { type: 'text', value: getPath(path) === undefined ? '' : getPath(path) });
    input.addEventListener('input', () => setPath(path, input.value));
    return el('label', null, label, input);
  }

  function segmented(path, options, onChange) {
    const box = el('div', { class: 'segmented', role: 'radiogroup' });
    const draw = () => {
      box.replaceChildren(...options.map(([v, t]) => el('button', {
        type: 'button', class: getPath(path) === v ? 'on' : '', role: 'radio', 'aria-checked': String(getPath(path) === v), text: t,
        onclick: () => { setPath(path, v); draw(); if (onChange) onChange(v); },
      })));
    };
    draw();
    return box;
  }

  const group = (title, ...kids) => el('section', { class: 'group' }, el('h2', { text: title }), kids);
  const note = (t) => el('p', { class: 'note', text: t });

  /* ---------------------------------------------------------------------------------------- scenes */

  let customs = {};
  async function loadCustoms() {
    const index = (await QS.get('qs.art.index')) || [];
    const got = index.length ? await api.storage.local.get(index.map((i) => `qs.art.${i}`)) : {};
    customs = {};
    for (const i of index) if (got[`qs.art.${i}`]) customs[`custom:${i}`] = got[`qs.art.${i}`];
  }
  await loadCustoms();

  const sceneThumb = (id) => (id.startsWith('custom:') ? (customs[id] && customs[id].thumb) : api.runtime.getURL(`scenes/${id}-thumb.webp`));
  const sceneName = (id) => (id.startsWith('custom:') ? (customs[id] ? customs[id].name : 'Missing picture') : (QS.SCENES[id] ? QS.SCENES[id].name : id));
  const sceneStats = (id) => (id.startsWith('custom:') ? (customs[id] && customs[id].stats) : (QS.SCENES[id] && QS.SCENES[id].stats));

  let slot = 'every';
  const slotScene = () => (slot === 'every' ? S.scene.every : S.scene.arcs[slot]);
  const slotArc = () => (slot === 'every' ? 'none' : slot);

  const slotsBox = el('div', { class: 'slots', role: 'radiogroup', 'aria-label': 'Where the scene shows' });
  const gallery = el('div', { class: 'gallery', role: 'radiogroup', 'aria-label': 'Scene' });
  const tuneBox = el('div');
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/avif,image/gif', hidden: true });

  function drawSlots() {
    const arcs = S.words.arcs;
    const entries = [
      ['every', 'Every page', 'other pages too'],
      ['easy', arcs.easy.jp, `${S.arcRule.easyMin}+ solved`],
      ['mid', arcs.mid.jp, 'in between'],
      ['hard', arcs.hard.jp, `${S.arcRule.hardMax} or fewer`],
    ];
    slotsBox.style.display = S.scene.byArc ? '' : 'none';
    slotsBox.replaceChildren(...entries.map(([id, name, sub]) => {
      const sid = id === 'every' ? S.scene.every : S.scene.arcs[id];
      return el('button', {
        type: 'button', class: `slot${slot === id ? ' on' : ''}`, role: 'radio', 'aria-checked': String(slot === id),
        style: { backgroundImage: `url("${sceneThumb(sid) || ''}")` },
        onclick: () => { slot = id; drawScenes(); post({ arc: slotArc() }); },
      }, el('span', null, name, el('small', { text: sub })));
    }));
  }

  function drawGallery() {
    const current = slotScene();
    const ids = [...Object.keys(customs), ...Object.keys(QS.SCENES)];
    const add = el('button', { type: 'button', class: 'scene add-scene', onclick: () => fileInput.click() }, 'Use your own picture');
    gallery.replaceChildren(add, ...ids.map((id) => {
      const card = el('div', {
        class: `scene${id === current ? ' on' : ''}`, role: 'radio', tabIndex: 0, 'aria-checked': String(id === current),
        title: id.startsWith('custom:') ? 'Your picture' : QS.SCENES[id].blurb,
        style: { backgroundImage: `url("${sceneThumb(id) || ''}")` },
        onclick: () => pickScene(id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickScene(id); } },
      }, el('span', { text: sceneName(id) }));
      if (id.startsWith('custom:')) {
        card.append(el('button', {
          type: 'button', class: 'del', title: 'Delete this picture', 'aria-label': 'Delete this picture', text: '×',
          onclick: (e) => { e.stopPropagation(); removePicture(id); },
        }));
      }
      return card;
    }));
  }

  function drawTune() {
    const id = slotScene();
    const key = `scene.tune.${id}`;
    tuneBox.replaceChildren(
      el('details', { class: 'more' }, el('summary', { text: `Adjust ${sceneName(id)}` }),
        slider('Focus, left to right', `${key}.x`, 0, 100, 1, (v) => `${v}%`, 50),
        slider('Focus, top to bottom', `${key}.y`, 0, 100, 1, (v) => `${v}%`, 50),
        slider('Zoom', `${key}.zoom`, 100, 200, 1, (v) => `${v}%`, 100),
        slider('Brightness', `${key}.bright`, 40, 150, 1, (v) => `${v}%`, 100),
        slider('Saturation', `${key}.sat`, 0, 180, 1, (v) => `${v}%`, 100)),
    );
  }

  function drawScenes() {
    drawSlots();
    drawGallery();
    drawTune();
    refreshTheme();
  }

  function pickScene(id) {
    if (slot === 'every') S.scene.every = id;
    else S.scene.arcs[slot] = id;
    commit();
    drawScenes();
    post({ arc: slotArc() });
  }

  async function removePicture(id) {
    const key = id.slice(7);
    const index = ((await QS.get('qs.art.index')) || []).filter((i) => i !== key);
    await api.storage.local.remove(`qs.art.${key}`);
    await QS.set('qs.art.index', index);
    delete customs[id];
    const fallback = QS.DEFAULTS.scene;
    if (S.scene.every === id) S.scene.every = fallback.every;
    for (const a of Object.keys(S.scene.arcs)) if (S.scene.arcs[a] === id) S.scene.arcs[a] = fallback.arcs[a];
    commit();
    drawScenes();
    post({ arc: slotArc() });
  }

  /* A picture is prepared once, here: resized, and measured so the glass can be solved for it. */
  async function addPicture(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / bmp.width);
    const wall = document.createElement('canvas');
    wall.width = Math.round(bmp.width * scale);
    wall.height = Math.round(bmp.height * scale);
    wall.getContext('2d').drawImage(bmp, 0, 0, wall.width, wall.height);

    const cover = (w, h, filter) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (filter) ctx.filter = filter;
      const s = Math.max(w / bmp.width, h / bmp.height);
      ctx.drawImage(bmp, (w - bmp.width * s) / 2, (h - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
      return c;
    };
    const sample = cover(320, 180).getContext('2d').getImageData(0, 0, 320, 180).data;
    const blurred = cover(320, 180, 'blur(1.1px)').getContext('2d').getImageData(0, 0, 320, 180).data;
    const key = Date.now().toString(36);
    const rec = {
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 40),
      wall: wall.toDataURL('image/webp', 0.86),
      thumb: cover(480, 270).toDataURL('image/webp', 0.78),
      /* the frosted copies panels sit on, one for each step of the frost slider */
      frost: {
        a: cover(640, 360, 'blur(2.2px)').toDataURL('image/webp', 0.74),
        b: cover(320, 180, 'blur(2.5px)').toDataURL('image/webp', 0.74),
        c: cover(160, 90, 'blur(2.5px)').toDataURL('image/webp', 0.74),
      },
      stats: QS.analyzePixels(sample, blurred),
      ambient: 'motes',
    };
    const index = (await QS.get('qs.art.index')) || [];
    await api.storage.local.set({ [`qs.art.${key}`]: rec, 'qs.art.index': [...index, key] });
    customs[`custom:${key}`] = rec;
    pickScene(`custom:${key}`);
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) addPicture(f).catch((e) => alert(`Could not read that picture: ${e.message}`));
  });

  /* -------------------------------------------------------------------------------- solved numbers */

  const reportBox = el('div', { class: 'report', 'aria-live': 'polite' });
  function refreshTheme() {
    const stats = sceneStats(slotScene());
    if (!stats) return;
    const solved = QS.solveTheme(stats, S.glass);
    const r = solved.report;
    reportBox.replaceChildren(
      el('span', null, 'Text ', el('b', { text: `${r.text}:1` })),
      el('span', null, 'Red handle ', el('b', { text: `${r.red}:1` })),
      el('span', null, 'Accent ', el('b', { text: `${r.accent}:1` })),
      el('span', null, 'Glass ', el('b', { text: `${Math.round(r.panel * 100)}%` })),
    );
    const root = document.documentElement.style;
    root.setProperty('--accent', solved.mode === 'dark' ? solved.vars['--qs-accent'] : '#f98dc1');
    root.setProperty('--accent-ink', solved.mode === 'dark' ? solved.vars['--qs-accent-ink'] : '#14101c');
  }

  /* ---------------------------------------------------------------------------------------- sounds */

  const soundRows = {};
  async function drawSoundRow(ev) {
    const row = soundRows[ev.id];
    const key = `qs.snd.${ev.id}`;
    const rec = await QS.get(key);
    const pick = el('input', { type: 'file', accept: 'audio/*', hidden: true });
    pick.addEventListener('change', async () => {
      const f = pick.files[0];
      if (!f) return;
      if (f.size > 12 * 1024 * 1024) { alert('Please keep sounds under 12 MB.'); return; }
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      });
      await QS.set(key, { name: f.name, data });
      drawSoundRow(ev);
    });
    const volPath = `sound.events.${ev.id}.vol`;
    const offPath = `sound.events.${ev.id}.off`;
    const vol = el('input', { type: 'range', min: 0, max: 150, step: 1, value: getPath(volPath) === undefined ? 100 : getPath(volPath), 'aria-label': `${ev.label} volume` });
    const volOut = el('output', { text: `${vol.value}%` });
    vol.addEventListener('input', () => { setPath(volPath, +vol.value); volOut.textContent = `${vol.value}%`; });
    const enabled = el('input', { type: 'checkbox', checked: !getPath(offPath) });
    enabled.addEventListener('change', () => setPath(offPath, !enabled.checked));
    row.replaceChildren(
      el('div', { class: 'sound-name' }, ev.label, el('small', { text: rec ? rec.name : (ev.note || 'built in') })),
      el('div', { class: 'sound-actions' },
        el('button', { type: 'button', class: 'btn small', text: 'Play', onclick: () => api.runtime.sendMessage({ qs: 'sfx', ev: ev.id, force: true }) }),
        el('button', { type: 'button', class: 'btn small', text: rec ? 'Replace' : 'Use a file', onclick: () => pick.click() }),
        rec ? el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: async () => { await api.storage.local.remove(key); drawSoundRow(ev); } }) : null,
        el('label', { class: 'switch', style: { margin: '0 0 0 4px' }, title: 'Sound on or off' }, enabled, el('span', { class: 'track' })),
        pick),
      el('div', { class: 'sound-vol' }, vol, volOut),
    );
  }

  /* -------------------------------------------------------------------------------------- the panel */

  const fonts = (kind) => {
    const names = {
      display: [['dela', 'Dela Gothic (poster)'], ['shippori', 'Shippori Mincho (title card serif)'], ['yuji', 'Yuji Boku (brush)'], ['rocknroll', 'RocknRoll (manga)'], ['marublack', 'Zen Maru Gothic (round)'], ['mochiy', 'Mochiy Pop (bubbly)'], ['dot', 'DotGothic16 (pixel)'], ['kurenaido', 'Zen Kurenaido (pencil)'], ['klee', 'Klee One (pen)']],
      body: [['mona', 'Mona Sans'], ['maru', 'Zen Maru Gothic (round)'], ['klee', 'Klee One (pen)'], ['dot', 'DotGothic16 (pixel)'], ['kurenaido', 'Zen Kurenaido (pencil)'], ['stix', 'STIX Two (serif)'], ['system', 'System font']],
      mono: [['jetbrains', 'JetBrains Mono'], ['system', 'System mono']],
    };
    return names[kind];
  };

  const controls = document.getElementById('controls');
  const stylesBox = el('div', { class: 'looks', role: 'radiogroup', 'aria-label': 'Style' });
  const drawStyles = () => {
    stylesBox.replaceChildren(...Object.entries(QS.STYLES).map(([id, st]) => el('button', {
      type: 'button', class: `look look-${id}${S.look.style === id ? ' on' : ''}`, role: 'radio', 'aria-checked': String(S.look.style === id), title: st.note,
      onclick: () => {
        S = QS.applyStyle(S, id);
        commit();
        /* every control shows the style's values */
        QS.save(S).then(() => location.reload());
      },
    }, el('span', { class: 'look-jp', text: st.jp }), el('span', { class: 'look-name', text: st.label }))));
  };
  drawStyles();
  const viewNote = el('p', { class: 'note' });
  const showViewNote = () => { viewNote.textContent = QS.VIEWS[S.look.view].note; };
  showViewNote();

  controls.append(
    group('Style', stylesBox, note('Picking a style sets the scene, glass, colours and fonts below. Change any of them afterwards.')),

    group('View',
      segmented('look.view', Object.entries(QS.VIEWS).map(([k, v]) => [k, v.label]), () => { showViewNote(); clearTimeout(saveTimer); QS.save(S); }),
      viewNote),

    group('Scene',
      toggle('A scene for each problem difficulty', 'scene.byArc', () => { if (!S.scene.byArc) slot = 'every'; drawScenes(); post({ arc: slotArc() }); }),
      slotsBox,
      gallery,
      fileInput,
      tuneBox,
      note('Your pictures are prepared once and stay in this browser.')),

    group('Glass',
      segmented('glass.mode', [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']]),
      slider('Scene visibility', 'glass.visibility', 0, 200, 1, (v) => `${v}%`),
      slider('Frost', 'glass.frost', 0, 40, 1, (v) => `${v}px`),
      slider('Corners', 'glass.radius', 0, 28, 1, (v) => `${v}px`),
      reportBox,
      note('Glass opacity is solved from the picture, so up to 100% every rating colour keeps at least 4.5:1. Past 100% the glass goes thinner than that and text may get harder to read: watch the numbers above. This slider only changes the glass, never the colours.')),

    group('Colours', colourRow('Accent', 'glass.accent'), colourRow('Second accent', 'glass.accent2'),
      note('Left on auto they come from the scene. Whatever you pick is nudged just enough to stay readable.')),

    group('Type',
      select('Titles', 'type.display', fonts('display')),
      select('Text', 'type.body', fonts('body')),
      select('Code', 'type.mono', fonts('mono')),
      slider('Statement size', 'type.size', 13, 20, 0.5, (v) => `${v}px`),
      slider('Statement width', 'type.width', 56, 110, 1, (v) => `${v}ch`)),

    group('Statements',
      toggle('Turn PDF statements into text', 'pdf.convert'),
      select('Show first', 'pdf.view', [['text', 'Text'], ['pages', 'PDF pages on glass'], ['pdf', 'Original PDF']]),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Forget converted statements', onclick: clearStatements })),
      note('Each statement is converted once on your machine and kept. Formulas that cannot be text are cut from the PDF and tinted to match.')),

    group('Moments',
      toggle('Title card when a problem opens', 'moments.title'),
      select('Play it', 'moments.titleWhen', [['always', 'Every time'], ['session', 'First time in each tab, skip solved problems'], ['never', 'Never']]),
      toggle('The broadcast while the judge runs', 'moments.broadcast'),
      toggle('Rating up scene', 'moments.levelUp'),
      toggle('Allow moments during a live contest', 'moments.live'),
      slider('Speed', 'moments.speed', 0.5, 2, 0.1, (v) => `${v}x`),
      el('details', { class: 'more' }, el('summary', { text: 'A scene for each verdict' }),
        ...QS.VERDICTS.map((v) => toggle(S.words.cutEn[v] || v, `moments.verdicts.${v}`))),
      note('Any key or click skips a moment. Reduced motion turns them into still frames.')),

    soundGroup(),

    group('Motion',
      select('Particles', 'motion.ambient', [['auto', 'Chosen by the scene'], ['petals', 'Petals'], ['stars', 'Stars'], ['leaves', 'Autumn leaves'], ['snow', 'Snow'], ['rain', 'Rain'], ['embers', 'Embers'], ['fireflies', 'Fireflies'], ['motes', 'Dust in the light'], ['none', 'None']]),
      slider('Amount', 'motion.density', 5, 150, 1, (v) => `${v}`),
      slider('Speed', 'motion.speed', 10, 150, 1, (v) => `${v}`),
      toggle('Drift in front of the page', 'motion.front')),

    group('Layout',
      toggle('Home banner', 'layout.hero'),
      toggle('Next contest card', 'layout.next'),
      toggle('Continue watching', 'layout.cont'),
      toggle('News with posters', 'layout.news'),
      toggle('Side column on problems', 'layout.side'),
      toggle('Top solved in the side column', 'layout.topSolved')),

    group('Difficulty',
      slider('Easy from', 'arcRule.easyMin', 50, 2000, 10, (v) => `${v}`),
      slider('Final at or under', 'arcRule.hardMax', 1, 300, 1, (v) => `${v}`),
      toggle('Look up how many solved a new problem', 'arcRule.lookup', null, 'One small request to QOJ the first time you open a problem. Off leaves unknown problems on the every page scene.'),
      note('QOJ rarely gives a difficulty, so the arc comes from how many people solved the problem.')),

    group('Words',
      el('div', { class: 'word-grid' },
        text('Site name', 'words.series'), text('Episode format', 'words.episode'),
        text('Banner title', 'words.heroTitle'), text('Banner line', 'words.heroSub'),
        text('Banner button', 'words.heroCta'), text('Second button', 'words.heroCta2'),
        text('Next contest', 'words.next'), text('Continue row', 'words.cont'),
        text('News, Japanese', 'words.news'), text('News, English', 'words.newsEn'),
        text('Danger label', 'words.danger')),
      el('details', { class: 'more' }, el('summary', { text: 'Arc names' }),
        el('div', { class: 'word-grid' }, ['easy', 'mid', 'hard', 'none'].flatMap((a) => [text(`${{ easy: 'Easy', mid: 'Middle', hard: 'Final', none: 'Unknown' }[a]} arc`, `words.arcs.${a}.jp`), text('In English', `words.arcs.${a}.en`)]))),
      el('details', { class: 'more' }, el('summary', { text: 'Words in the cutscenes' }),
        el('div', { class: 'word-grid' },
          text('Submit', 'words.cut.launch'), text('Judging', 'words.cut.judging'),
          ...['ac', 'partial', 'wa', 'tle', 'mle', 're', 'ce', 'levelup'].flatMap((v) => [text(S.words.cutEn[v], `words.cut.${v}`), text('Subtitle', `words.cutEn.${v}`)])))),

    group('Your CSS', customCss(), note('Applied last, on every site and in the preview. The page root has data-qs="on".')),

    group('Themes',
      el('div', { class: 'row', style: { flexWrap: 'wrap' } },
        el('button', { type: 'button', class: 'btn', text: 'Save theme to a file', onclick: exportTheme }),
        el('button', { type: 'button', class: 'btn', text: 'Load a theme file', onclick: () => importInput.click() }),
        el('button', { type: 'button', class: 'btn danger', text: 'Reset everything', onclick: resetAll })),
      note('A theme file holds your settings, pictures and sounds, ready to share.')),
  );

  function colourRow(label, path) {
    const id = nextId();
    const color = el('input', { id, type: 'color', value: getPath(path) || '#f98dc1', disabled: !getPath(path) });
    const auto = el('input', { type: 'checkbox', checked: !getPath(path) });
    color.addEventListener('input', () => setPath(path, color.value));
    auto.addEventListener('change', () => {
      color.disabled = auto.checked;
      setPath(path, auto.checked ? '' : color.value);
    });
    return el('div', { class: 'row' }, el('label', { for: id, text: label }), color, el('label', { class: 'switch', style: { margin: 0 } }, auto, el('span', { class: 'track' }), 'Auto'));
  }

  function soundGroup() {
    const list = el('div');
    for (const ev of QS.SOUND_EVENTS) {
      soundRows[ev.id] = el('div', { class: 'sound' });
      list.append(soundRows[ev.id]);
      drawSoundRow(ev);
    }
    return group('Sounds',
      toggle('Sound effects', 'sound.on'),
      slider('Volume', 'sound.volume', 0, 100, 1, (v) => `${v}%`),
      select('Built-in set', 'sound.pack', [['battle', 'Battle: taiko and steel'], ['quiet', 'Quiet: soft chimes']]),
      list,
      note('Any audio file your browser can play works for any moment: a theme song for Accepted, a loop while you wait. Files stay in this browser.'));
  }

  function customCss() {
    const area = el('textarea', { spellcheck: false, value: S.customCss || '', 'aria-label': 'Custom CSS' });
    area.addEventListener('input', () => setPath('customCss', area.value));
    return area;
  }

  async function clearStatements() {
    const index = (await QS.get('qs.pdf.index')) || [];
    await api.storage.local.remove([...index.map((k) => `qs.pdf.${k}`), 'qs.pdf.index']);
    alert(index.length ? `Forgot ${index.length} converted statements.` : 'Nothing was stored.');
  }

  /* ------------------------------------------------------------------------------ themes as files */

  const importInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  document.body.append(importInput);

  async function exportTheme() {
    const everything = await api.storage.local.get(null);
    const art = {};
    const sounds = {};
    for (const [k, v] of Object.entries(everything)) {
      if (k.startsWith('qs.art.') && k !== 'qs.art.index') art[k.slice(7)] = v;
      if (k.startsWith('qs.snd.')) sounds[k.slice(7)] = v;
    }
    const blob = new Blob([JSON.stringify({ format: 'sakugo-theme', version: 1, settings: S, art, sounds })], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'sakugo-theme.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    importInput.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.format !== 'sakugo-theme') throw new Error('This is not a Sakugo Studio theme file.');
      const store = { 'qs.settings': data.settings };
      const index = Object.keys(data.art || {});
      for (const k of index) {
        const r = data.art[k];
        if (r && typeof r.wall === 'string' && r.wall.startsWith('data:image/') && r.stats) store[`qs.art.${k}`] = r;
      }
      store['qs.art.index'] = index.filter((k) => store[`qs.art.${k}`]);
      for (const [k, r] of Object.entries(data.sounds || {})) {
        if (r && typeof r.data === 'string' && r.data.startsWith('data:audio/')) store[`qs.snd.${k}`] = r;
      }
      await api.storage.local.set(store);
      location.reload();
    } catch (e) {
      alert(`Could not load that file. ${e.message}`);
    }
  });

  async function resetAll() {
    if (!confirm('Reset all settings, and delete your pictures and sounds from this browser?')) return;
    const everything = await api.storage.local.get(null);
    await api.storage.local.remove(Object.keys(everything).filter((k) => k === 'qs.settings' || k.startsWith('qs.art.') || k.startsWith('qs.snd.')));
    location.reload();
  }

  /* -------------------------------------------------------------------------------- play buttons */

  const plays = document.getElementById('plays');
  plays.append(...[
    ['title', 'Title card'], ['run', 'Full run'], ['launch', 'Submit'], ['ac', 'Accepted'], ['partial', 'Partial'], ['wa', 'Wrong answer'],
    ['tle', 'Time limit'], ['mle', 'Memory limit'], ['re', 'Runtime error'], ['ce', 'Compile error'], ['levelup', 'Rating up'],
  ].map(([k, t]) => el('button', { type: 'button', class: 'btn small', 'data-play': k, text: t, onclick: () => post({ demo: k }) })));

  /* -------------------------------------------------------------------------------------- on and off */

  const onBox = document.getElementById('on');
  const onLabel = document.getElementById('onLabel');
  onBox.checked = S.on;
  onLabel.textContent = S.on ? 'On' : 'Off';
  onBox.addEventListener('change', () => {
    S.on = onBox.checked;
    onLabel.textContent = S.on ? 'On' : 'Off';
    commit();
  });

  api.storage.onChanged.addListener((changes) => {
    /* the popup changed something while this page is open */
    if (changes['qs.settings'] && !saveTimer) S = QS.merge(QS.DEFAULTS, changes['qs.settings'].newValue || {});
  });

  drawScenes();
})();
