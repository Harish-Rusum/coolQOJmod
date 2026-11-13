/* popup.js: the quick switches. Everything else lives in the Studio. */
(async () => {
  'use strict';
  const QS = globalThis.QS;
  const { el } = QS;
  let S = await QS.load();

  const save = () => QS.save(S);
  const bind = (id, get, set) => {
    const box = document.getElementById(id);
    box.checked = get();
    box.addEventListener('change', () => { set(box.checked); save(); });
  };

  bind('on', () => S.on, (v) => { S.on = v; });
  bind('title', () => S.moments.title, (v) => { S.moments.title = v; });
  bind('broadcast', () => S.moments.broadcast, (v) => { S.moments.broadcast = v; });
  bind('sound', () => S.sound.on, (v) => { S.sound.on = v; });
  bind('motion', () => S.motion.ambient !== 'none', (v) => { S.motion.ambient = v ? 'auto' : 'none'; });
  bind('pdf', () => S.pdf.convert, (v) => { S.pdf.convert = v; });

  const styles = document.getElementById('styles');
  const drawStyles = () => {
    styles.replaceChildren(...Object.entries(QS.STYLES).map(([id, st]) => el('button', {
      type: 'button', class: S.look.style === id ? 'on' : '', role: 'radio', 'aria-checked': String(S.look.style === id), title: st.note, text: st.label,
      onclick: () => { S = QS.applyStyle(S, id); save(); drawStyles(); },
    })));
  };
  drawStyles();

  const grid = document.getElementById('scenes');
  const draw = () => {
    grid.replaceChildren(...Object.entries(QS.SCENES).map(([id, sc]) => el('button', {
      type: 'button',
      class: `scene${S.scene.every === id ? ' on' : ''}`,
      role: 'radio',
      'aria-checked': String(S.scene.every === id),
      title: sc.blurb,
      style: { backgroundImage: `url("${QS.api.runtime.getURL(`scenes/${id}-thumb.webp`)}")` },
      onclick: () => { S.scene.every = id; save(); draw(); },
    }, el('span', { text: sc.name }))));
  };
  draw();

  document.getElementById('studio').addEventListener('click', () => {
    QS.api.runtime.openOptionsPage();
    window.close();
  });
})();
