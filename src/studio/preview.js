/* preview.js: the Studio's live preview. Same scripts as a real page, with its network calls answered locally
   and a small channel so the Studio can pick the arc and play moments. */
(() => {
  'use strict';
  const QS = globalThis.QS;

  const FIXTURE = { easy: 950, mid: 180, hard: 12, none: undefined };
  let arc = 'none';

  QS.Data.problemInfo = async () => (arc === 'none' ? { tags: ['Harbor Open', 'Greedy'] } : { ac: FIXTURE[arc], sub: FIXTURE[arc] * 3, rate: 33, tags: ['Harbor Open', 'Greedy'] });
  QS.Data.remember = async () => [];
  QS.Data.topSolved = async () => [
    ['kitsune', 'rgb(255, 80, 80)', 3412], ['aurora', 'rgb(255, 80, 80)', 2650], ['lanternfish', 'rgb(255, 180, 90)', 2380],
    ['mochi', 'rgb(200, 120, 255)', 1987], ['tidepool', 'rgb(130, 150, 255)', 1720], ['ferrywind', 'rgb(60, 200, 170)', 1488], ['pebble', 'rgb(90, 200, 90)', 1250],
  ].map(([name, color, solved]) => ({ name, nick: name, color, solved: String(solved) }));
  QS.Data.nextContests = async () => [];
  QS.Moments.pageReady = () => document.documentElement.removeAttribute('data-qs-cover');
  QS.Watch = { start() {}, short: (r) => r.v, long: (v) => v };

  addEventListener('message', async (e) => {
    const m = e.data || {};
    if (m.demo && QS.S) QS.Moments.demo(m.demo);
    if (m.arc && QS.S) {
      arc = m.arc;
      await QS.applyTheme(QS.S, arc);
      const words = QS.S.words.arcs[arc] || QS.S.words.arcs.none;
      const tag = document.querySelector('.qs-ep-arc');
      if (tag) tag.textContent = words.jp;
      QS.Ambient.start(QS.S);
    }
  });
})();
