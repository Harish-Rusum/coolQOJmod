/* watch.js: follows your own submissions.

   QOJ's form posts and moves to the submissions list. So the moment you press Submit is remembered, and the list
   page picks the story up: it follows the run through QOJ's status endpoint and, when the judge is done, reads
   the verdict off the row QOJ prints. Only runs of yours are followed, and only while they are running. */
(() => {
  'use strict';
  const QS = globalThis.QS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const PENDING = 'qs:pending';
  const WATCHING = 'qs:watching';
  const POLL_MS = 2000;

  const read = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };
  const write = (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } };

  /* One function decides what a result cell means. QOJ prints words, short codes or a score. */
  function classify(cell) {
    if (!cell) return null;
    const link = $('a[href*="/submission/"]', cell) || cell;
    const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/^(waiting|pending|judging|compiling|running|in queue|queue)/.test(lower) || /等待|评测中|编译中/.test(text)) return { v: 'run', text };
    const testM = /(?:test|测试点|テスト)\s*#?\s*(\d+)/i.exec(text) || /\b(?:wa|tl|tle|ml|mle|re|rte)\s*#?\s*(\d+)\b/i.exec(text);
    const test = testM ? parseInt(testM[1], 10) : 0;
    const base = { text, test };
    if (/accepted|^ac\b|✓|通过|答案正确/.test(lower)) return { ...base, v: 'ac' };
    if (/compil|^ce\b|编译错误/.test(lower)) return { ...base, v: 'ce' };
    if (/time limit|^tl|^tle\b|超时|运行超时/.test(lower)) return { ...base, v: 'tle' };
    if (/memory limit|^ml|^mle\b|内存/.test(lower)) return { ...base, v: 'mle' };
    if (/wrong|^wa\b|答案错误|output limit|presentation/.test(lower)) return { ...base, v: 'wa' };
    if (/runtime|^re\b|^rte\b|运行错误|dangerous|judg(e)?ment failed|system error|security/.test(lower)) return { ...base, v: 're' };
    const scoreEl = cell.matches && cell.matches('.uoj-score') ? cell : $('.uoj-score', cell);
    const numeric = /^-?\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/.test(text);
    if (scoreEl || numeric) {
      const score = parseFloat(text);
      const parts = text.split('/');
      const max = parts[1] ? parseFloat(parts[1]) : parseFloat((scoreEl && scoreEl.dataset.max) || '') || 100;
      if (isNaN(score)) return null;
      if (score >= max) return { ...base, v: 'ac', score, max };
      if (score <= 0) return { ...base, v: 'wa', score, max };
      return { ...base, v: 'partial', score, max };
    }
    return null;
  }

  /* Which column holds the result, going by the table's own header. */
  function resultColumn(table) {
    const ths = table ? $$('thead th', table) : [];
    return ths.findIndex((th) => /result|score|verdict|结果|結果|得分|判定/i.test(th.textContent));
  }

  /* Reads a row of QOJ's submission table by what its cells are. */
  function readRow(tr, resultCol = -1) {
    const idA = $('a[href^="/submission/"]', tr);
    if (!idA) return null;
    const idM = /\/submission\/(\d+)/.exec(idA.getAttribute('href'));
    if (!idM) return null;
    const cells = $$('td', tr);
    const links = $$('a[href^="/submission/"]', tr);
    /* QOJ links the id, then the result, then the language to the same submission */
    const resultCell = resultCol >= 0 && cells[resultCol] ? cells[resultCol] : (links[1] ? links[1].closest('td') : null);
    const problemA = $('a[href*="/problem/"]', tr);
    const userEl = $('.uoj-username', tr);
    const text = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const time = cells.map(text).find((t) => /^\d+(\.\d+)?\s*(ms|s)$/i.test(t)) || '';
    const memory = cells.map(text).find((t) => /^\d+(\.\d+)?\s*(kb|mb|gb|kib|mib|gib)$/i.test(t)) || '';
    const langCell = cells.find((c) => /c\+\+|python|java|rust|pypy|pascal|kotlin|haskell|go$|\bc\d\d\b|ruby|\bd\b|fortran|lean/i.test(text(c)) && !$('.uoj-username', c) && c !== resultCell && !$('a[href*="/problem/"]', c));
    return {
      tr, id: idM[1], resultCell,
      problemId: problemA ? (/\/problem\/(\d+)/.exec(problemA.getAttribute('href')) || [])[1] : '',
      problemText: text(problemA),
      user: text(userEl),
      time, memory,
      lang: langCell ? text(langCell).replace(/\s*\/.*$/, '') : '',
      result: classify(resultCell),
    };
  }

  function allRows() {
    return $$('.uoj-content table').flatMap((table) => {
      const col = resultColumn(table);
      return $$('tbody tr', table).map((tr) => readRow(tr, col)).filter(Boolean);
    });
  }

  const LONG = { ac: 'Accepted', partial: 'Partial score', wa: 'Wrong answer', tle: 'Time limit', mle: 'Memory limit', re: 'Runtime error', ce: 'Compile error', run: 'Judging' };
  const SHORT = { ac: 'AC', partial: 'Partial', wa: 'WA', tle: 'TLE', mle: 'MLE', re: 'RE', ce: 'CE', run: '...' };

  async function statusOf(id) {
    const res = await fetch(`/submission-status-details?get%5B%5D=${encodeURIComponent(id)}`, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return Array.isArray(data) ? data[0] : null;
  }

  const textOfHtml = (html) => {
    const doc = new DOMParser().parseFromString(`<table><tr>${html || ''}</tr></table>`, 'text/html');
    const tip = $('.uoj-status-details-text-div', doc) || doc.body;
    return tip.textContent.replace(/\s+/g, ' ').trim();
  };

  async function record(run, data) {
    const seen = (await QS.get('qs.seen')) || [];
    await QS.set('qs.seen', [run.id, ...seen.filter((x) => x !== run.id)].slice(0, 300));
    if (run.problemId) {
      const runs = (await QS.get('qs.runs')) || {};
      runs[run.problemId] = [{ sub: run.id, v: data.v, score: data.score, at: Date.now() }, ...(runs[run.problemId] || []).filter((r) => r.sub !== run.id)].slice(0, 8);
      await QS.set('qs.runs', runs);
      await QS.Data.remember({ id: run.problemId, title: data.title || run.problemText.replace(/^#\d+\.\s*/, ''), v: data.v, sub: run.id });
    }
  }

  QS.Watch = {
    classify,
    readRow,
    short: (r) => (r.v === 'partial' && r.score !== undefined ? String(r.score) : SHORT[r.v] || r.v),
    long: (v) => LONG[v] || v,
    resuming: false,

    start(S) {
      this.S = S;
      this.hookForms();
      const route = QS.route;
      if (route.name === 'submissions' || route.name === 'submission') {
        this.resuming = !!(read(PENDING) || read(WATCHING));
        this.followPage(S).catch((e) => console.error('[Sakugo Studio]', e)).finally(() => {
          if (!QS.Moments.Broadcast.active) document.documentElement.removeAttribute('data-qs-cover');
        });
      }
    },

    /* Pressing Submit: remember what was submitted, play the cut-in, let the form go. */
    hookForms() {
      document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!form || form.id !== 'form-answer') return;
        setTimeout(() => {
          if (e.defaultPrevented) return; // QOJ's own check refused the form
          const title = (document.querySelector('.qs-ep-title') || {}).textContent || document.title.split(' - ')[0];
          const label = (document.querySelector('.qs-ep-no') || {}).textContent || '';
          write(PENDING, {
            at: Date.now(), problemId: QS.route.id, title, label, arc: QS.theme ? QS.theme.arc : 'none',
            limitMemory: (document.querySelector('.qs-ep-facts') || { textContent: '' }).textContent.match(/\d+(\.\d+)?\s*(MB|GB|MiB|GiB)/i)?.[0] || '',
          });
          QS.Moments.launch({ title });
        }, 0);
      }, false);
    },

    pillify() {
      for (const run of allRows()) {
        if (!run.result || !run.resultCell) continue;
        const a = $('a[href*="/submission/"]', run.resultCell);
        if (a && !a.classList.contains('qs-verdict')) a.classList.add('qs-verdict', `qs-v-${run.result.v}`);
      }
    },

    async followPage(S) {
      const pending = read(PENDING);
      const fresh = pending && Date.now() - pending.at < 90e3 ? pending : null;
      const watching = read(WATCHING);
      this.pillify();
      const me = QS.me && QS.me.name;
      const rows = allRows();
      const seen = (await QS.get('qs.seen')) || [];
      /* QOJ prints a details row only under your own running submissions */
      const runningId = (() => {
        const details = $('[id^="status_details_"]');
        if (details) return /status_details_(\d+)/.exec(details.id)[1];
        const r = rows.find((x) => x.result && x.result.v === 'run' && (!me || x.user === me));
        return r ? r.id : null;
      })();

      const mine = (r) => !me || !r.user || r.user === me;
      let target = null;
      if (watching) target = rows.find((r) => r.id === watching.id);
      if (!target && fresh) target = rows.find((r) => mine(r) && (!fresh.problemId || r.problemId === fresh.problemId) && !seen.includes(r.id));

      if (target && target.result && target.result.v !== 'run') {
        /* the judge finished: what QOJ printed is the verdict */
        write(WATCHING, null);
        write(PENDING, null);
        if (seen.includes(target.id)) return;
        const ctx = watching || fresh || {};
        const data = {
          ...target.result, title: ctx.title || target.problemText.replace(/^#\d+\.\s*/, ''), label: ctx.label || '', arc: ctx.arc || 'none',
          time: target.time, memory: target.memory, lang: target.lang, limitMemory: ctx.limitMemory || '',
        };
        await record(target, data);
        const live = QS.liveClock();
        if (!live || S.moments.live) {
          this.resuming = true;
          await QS.Moments.verdict(data);
        }
        return;
      }

      const id = runningId || (target && target.id);
      if (!id) { write(PENDING, null); return; }
      const ctx = watching && watching.id === id ? watching : { ...(fresh || {}), id };
      write(WATCHING, ctx);
      write(PENDING, null);
      this.resuming = true;
      const live = QS.liveClock();
      QS.Moments.Broadcast.start(ctx, { stripOnly: !fresh && !watching ? true : !!(live && !S.moments.live), silent: !!(live && !S.moments.live) });
      this.poll(id);
    },

    async poll(id) {
      let failures = 0;
      const tick = async () => {
        try {
          const st = await statusOf(id);
          failures = 0;
          if (st) {
            const text = textOfHtml(st.html);
            if (text) QS.Moments.Broadcast.update(text);
            if (st.judged) {
              /* the row with the verdict only exists after a reload; the page stays black meanwhile */
              QS.Moments.Broadcast.stop();
              document.documentElement.setAttribute('data-qs-cover', '1');
              location.reload();
              return;
            }
          }
        } catch {
          failures++;
          if (failures > 8) { QS.Moments.Broadcast.stop(); write(WATCHING, null); return; }
        }
        setTimeout(tick, POLL_MS * (failures ? 2 : 1));
      };
      setTimeout(tick, 500);
    },
  };
})();
