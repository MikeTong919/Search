// Runs on linkedin.com job searches: the classic search (/jobs/search/, kept by
// rules.json's skipRedirect=true) and the AI search (/jobs/search-results/).
// Neither keeps jobs in time order: each page of ~25 comes mixed. This script:
//  1. Re-orders every page newest → oldest by its "Posted … ago" time.
//  2. Remembers each job's posting time and narrows it down every time the job
//     is seen, so jobs you've viewed (LinkedIn hides their time) still sort.
//  3. Shows a panel merging all pages of the current search, newest first,
//     with a "Scan all pages" button.
//  4. Hides promoted / applied / viewed / excluded-word / too-old jobs.
(() => {
  const CARD_SEL = 'div[role="button"][componentkey^="job-card-component-ref-"], li[data-occludable-job-id]';
  const STORE_KEY = 'rrjJobs';
  const KEEP_MS = 30 * 864e5;

  let settings = { ...DEFAULT_SETTINGS };
  let jobs = {}; // id -> { lo, hi, title, company, place, search, seen, promoted, applied, viewed, text }
  let dirty = false;
  let panelOpen = false;
  let showHidden = false;
  let scanning = '';
  let lastHref = '';
  let ui; // { root, pill, panel, list, status }

  const isSearchPage = () => location.pathname.startsWith('/jobs/');

  // The parts of the URL that define "this search" (not the page or selected job).
  function searchKey() {
    const p = new URLSearchParams(location.search);
    return [...p.entries()]
      .filter(([k]) => k === 'keywords' || k === 'location' || k === 'geoId' || k.startsWith('f_'))
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  }

  // ---------- reading cards ----------
  function cardId(el) {
    return el.dataset.occludableJobId || el.getAttribute('componentkey').replace('job-card-component-ref-', '');
  }

  function getCards() {
    const seen = new Set();
    const out = [];
    for (const el of document.querySelectorAll(CARD_SEL)) {
      const id = cardId(el);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ el, id });
    }
    return out;
  }

  function readCard(el, now) {
    const lines = (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    // First line is the title, sometimes with "Selected, " / "(Verified job)"
    // and repeated on the next line.
    const head = lines[0].replace(/^Selected,\s*/, '').replace(/\s*\(Verified job\)\s*$/, '');
    const i = lines[1] === head ? 1 : 0;
    const posted = lines.find((l) => /^(posted|reposted)\b/i.test(l)) || lines.find((l) => /^(\d+\s+\w+\s+ago|just now)$/i.test(l));
    return {
      title: i ? lines[1] : head,
      company: lines[i + 1] || '',
      place: lines[i + 2] || '',
      window: parsePostedWindow(posted, now),
      promoted: lines.some((l) => /^promoted(\s+by\b.*)?$/i.test(l)),
      applied: lines.some((l) => /^applied(\s+(on\b|\d).*)?$/i.test(l)),
      viewed: lines.some((l) => /^viewed$/i.test(l)),
      text: lines.join(' ').toLowerCase(),
    };
  }

  function remember(id, card, now, key) {
    const j = jobs[id] || (jobs[id] = {});
    const before = JSON.stringify(j);
    Object.assign(j, {
      title: card.title, company: card.company, place: card.place, search: key,
      promoted: card.promoted, applied: card.applied, viewed: card.viewed, text: card.text,
    });
    if (card.window) mergeWindow(j, card.window);
    if (JSON.stringify(j) !== before) dirty = true;
    j.seen = now;
  }

  function mergeWindow(j, w) {
    // Intersect with what we knew. If they don't overlap, it was reposted.
    const lo = j.lo == null ? w.lo : Math.max(j.lo, w.lo);
    const hi = j.hi == null ? w.hi : Math.min(j.hi, w.hi);
    if (lo <= hi) { j.lo = lo; j.hi = hi; } else { j.lo = w.lo; j.hi = w.hi; }
  }

  // Cards of jobs you've viewed hide the posted time, but the details pane of
  // the selected job (?currentJobId=…) still shows it.
  const AGE_LINE = /^((posted|reposted)\s+)?(\d+\s+\w+\s+ago|just now)$/i;
  function readDetailsPane(now) {
    const id = new URLSearchParams(location.search).get('currentJobId');
    if (!id || !jobs[id]) return;
    const link = [...document.querySelectorAll(`a[href*="/jobs/view/${id}"]`)].find((a) => !a.closest(CARD_SEL));
    let box = link;
    // Climb from the job's title link until we reach text like
    // "Yonkers, NY · Reposted 19 hours ago · Over 100 people clicked apply".
    for (let i = 0; box && i < 12; i++) {
      box = box.parentElement;
      if (!box || box.querySelector(CARD_SEL)) return; // climbed into the job list
      const seg = (box.innerText || '').split(/\n|·/).map((s) => s.trim()).find((s) => AGE_LINE.test(s));
      const w = seg && parsePostedWindow(seg, now);
      if (w) {
        const before = JSON.stringify(jobs[id]);
        mergeWindow(jobs[id], w);
        if (JSON.stringify(jobs[id]) !== before) dirty = true;
        return;
      }
    }
  }

  const postedAt = (j) => (j && j.lo != null ? (j.lo + j.hi) / 2 : null);

  function hideReason(j, words, now) {
    if (!j) return null;
    if (settings.hidePromoted && j.promoted) return 'promoted';
    if (settings.hideApplied && j.applied) return 'applied';
    if (settings.hideViewed && j.viewed) return 'viewed';
    if (words.some((w) => (j.text || '').includes(w))) return 'keyword';
    // "United States (Remote)" → only keep the workplace types you picked.
    const tag = ((j.place || '').match(/\((remote|hybrid|on-site)\)/i) || [])[1];
    const allowed = (settings.workTypes || []).map((t) => WORK_TYPE_WORDS[t]);
    if (tag && allowed.length && !allowed.includes(tag.toLowerCase())) return tag.toLowerCase();
    const limit = Number(settings.timeSeconds) || 0;
    const t = postedAt(j);
    if (limit > 0 && t != null && t < now - limit * 1000) return 'too old';
    return null;
  }

  const excludeList = () =>
    (settings.excludeWords || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

  // Newest first; unknown times go last; ties keep LinkedIn's order.
  function byNewest(a, b) {
    const ta = postedAt(a.job), tb = postedAt(b.job);
    if (ta == null && tb == null) return a.index - b.index;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return tb - ta || a.index - b.index;
  }

  // ---------- re-ordering the page ----------
  // We use CSS `order` instead of moving nodes, so LinkedIn's own code keeps working.
  function setOrder(el, v) {
    if (getComputedStyle(el).display === 'contents') {
      for (const c of el.children) setOrder(c, v);
    } else if (el.style.order !== v) {
      el.style.order = v;
    }
  }

  function setHidden(el, hide) {
    if (hide) {
      if (el.style.display !== 'none') { el.dataset.rrjHidden = '1'; el.style.display = 'none'; }
    } else if (el.dataset.rrjHidden) {
      delete el.dataset.rrjHidden;
      el.style.display = '';
    }
  }

  function lowestCommonParent(els) {
    let p = els[0].parentElement;
    while (p && !els.every((e) => p.contains(e))) p = p.parentElement;
    return p;
  }

  // Remember the order we chose for this page. Re-sorting on every LinkedIn
  // update made cards with similar times swap places while you clicked around.
  let frozen = { sig: '', rank: new Map() };

  function arrangePage(cards, now, words) {
    if (cards.length < 2) return;
    const list = lowestCommonParent(cards.map((c) => c.el));
    if (!list) return;
    const kids = [...list.children];
    const kidOf = (el) => { while (el.parentElement !== list) el = el.parentElement; return el; };
    const cardByKid = new Map(cards.map((c) => [kidOf(c.el), c]));
    const lastCard = Math.max(...kids.map((k, i) => (cardByKid.has(k) ? i : -1)));

    // A card plus the divider(s) after it move together.
    const lead = [], tail = [], groups = [];
    kids.forEach((k, i) => {
      const c = cardByKid.get(k);
      if (c) groups.push({ id: c.id, job: jobs[c.id], index: groups.length, els: [k] });
      else if (!groups.length) lead.push(k);
      else if (i > lastCard) tail.push(k);
      else groups[groups.length - 1].els.push(k);
    });

    const sorted = settings.sortByTime;
    if (sorted && !/^(flex|inline-flex|grid|inline-grid)$/.test(getComputedStyle(list).display)) {
      list.style.display = 'flex';
      list.style.flexDirection = 'column';
    }
    const sig = groups.map((g) => g.id + (postedAt(g.job) == null ? '?' : '')).join(',');
    if (sig !== frozen.sig) {
      frozen = { sig, rank: new Map(groups.slice().sort(byNewest).map((g, r) => [g.id, r])) };
    }
    lead.forEach((k) => setOrder(k, sorted ? '-1' : ''));
    groups.forEach((g) => {
      const hide = !showHidden && !!hideReason(g.job, words, now);
      const rank = sorted ? String(frozen.rank.get(g.id)) : '';
      g.els.forEach((k) => { setHidden(k, hide); setOrder(k, rank); });
    });
    tail.forEach((k) => setOrder(k, sorted ? '100000' : ''));
  }

  // ---------- classic page: fill in every card ----------
  // The classic list only renders the cards near the screen; the rest are empty
  // <li>s with no time. Scroll through them once per page so every job has its
  // time before we sort, instead of re-sorting as you scroll.
  let prerendering = false;
  let prerenderedSig = '';
  const isEmpty = (c) => !(c.el.innerText || '').trim();

  async function prerender(cards) {
    const empty = cards.filter(isEmpty);
    const sig = cards.map((c) => c.id).join(',');
    if (!empty.length || prerendering || sig === prerenderedSig) return;
    prerendering = true;
    prerenderedSig = sig;
    let scroller = cards[0].el.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
      scroller = scroller.parentElement;
    }
    const top = scroller ? scroller.scrollTop : window.scrollY;
    for (const c of empty) {
      c.el.scrollIntoView({ block: 'nearest' });
      await sleep(80);
    }
    if (scroller) scroller.scrollTop = top; else window.scrollTo(0, top);
    await sleep(300);
    prerendering = false;
  }

  async function ensureRendered() {
    while (prerendering) await sleep(100);
    await prerender(getCards());
  }

  // ---------- AI search → classic search ----------
  // rules.json catches full page loads; this catches LinkedIn switching to the
  // AI search inside the page (no reload).
  function maybeSwitchToClassic() {
    if (!location.pathname.startsWith('/jobs/search-results')) return;
    const KEY = 'rrj-classic-switch';
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch (_) {}
    if (Date.now() - last < 15000) return; // LinkedIn bounced us back; don't loop
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (_) {}
    const url = new URL(location.href);
    url.pathname = '/jobs/search/';
    url.searchParams.set('skipRedirect', 'true');
    url.searchParams.set('sortBy', 'DD');
    location.replace(url.href);
  }

  // ---------- main loop ----------
  function update() {
    if (!isSearchPage()) { if (ui) ui.root.style.display = 'none'; return; }
    const now = Date.now();
    const key = searchKey();
    const cards = getCards();
    if (prerendering) return;
    if (cards.length && cards.some(isEmpty) && cards.map((c) => c.id).join(',') !== prerenderedSig) {
      prerender(cards).then(schedule);
      return;
    }
    for (const c of cards) {
      const card = readCard(c.el, now);
      if (card) remember(c.id, card, now, key);
    }
    if (!cards.length) { if (ui) ui.root.style.display = 'none'; return; }
    readDetailsPane(now);
    arrangePage(cards, now, excludeList());
    renderUi(now, key);
    if (dirty) scheduleSave();
  }

  // ---------- floating pill + merged list ----------
  function el(tag, style, text) {
    const e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (text != null) e.textContent = text;
    return e;
  }

  const BTN = {
    border: '0', borderRadius: '999px', padding: '6px 12px', cursor: 'pointer',
    font: '600 12px -apple-system, BlinkMacSystemFont, sans-serif',
  };

  function buildUi() {
    const root = el('div', {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
      font: '13px/1.35 -apple-system, BlinkMacSystemFont, sans-serif',
    });
    const panel = el('div', {
      width: '420px', maxWidth: 'calc(100vw - 32px)', height: 'calc(100vh - 110px)', display: 'none', flexDirection: 'column',
      background: '#fff', color: '#1d2226', borderRadius: '12px',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', overflow: 'hidden',
    });
    const head = el('div', { padding: '10px 12px', borderBottom: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', gap: '6px' });
    const title = el('div', { fontWeight: '700', fontSize: '14px' }, 'All jobs in this search, newest first');
    const status = el('div', { color: '#5e6a75', fontSize: '12px' });
    const row = el('div', { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' });
    const scanBtn = el('button', { ...BTN, background: '#0a66c2', color: '#fff' }, 'Scan all pages');
    scanBtn.type = 'button';
    scanBtn.addEventListener('click', scanAllPages);
    const hiddenLbl = el('label', { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' });
    const hiddenBox = el('input');
    hiddenBox.type = 'checkbox';
    hiddenBox.addEventListener('change', () => { showHidden = hiddenBox.checked; update(); });
    hiddenLbl.append(hiddenBox, document.createTextNode('Show hidden jobs'));
    row.append(scanBtn, hiddenLbl);
    head.append(title, status, row);
    const list = el('ol', { listStyle: 'none', margin: '0', padding: '0', overflowY: 'auto', flex: '1' });
    panel.append(head, list);

    const pill = el('button', { ...BTN, padding: '8px 14px', fontSize: '13px', background: '#0a66c2', color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.25)' });
    pill.type = 'button';
    pill.title = 'Recent Remote Jobs extension';
    pill.addEventListener('click', () => { panelOpen = !panelOpen; ui.sig = ''; update(); });

    root.append(panel, pill);
    document.body.appendChild(root);
    ui = { root, panel, list, status, pill, scanBtn, sig: '', rows: new Map() };
  }

  function renderUi(now, key) {
    if (!ui) buildUi();
    ui.root.style.display = 'flex';
    const words = excludeList();
    const all = Object.entries(jobs)
      .filter(([, j]) => j.search === key)
      .map(([id, job], index) => ({ id, job, index, why: hideReason(job, words, now) }));
    const visible = all.filter((x) => showHidden || !x.why);
    const hidden = all.length - all.filter((x) => !x.why).length;

    setText(ui.pill, panelOpen ? 'Close list' : `Newest-first list (${visible.length})${hidden ? ` · ${hidden} hidden` : ''}`);
    ui.panel.style.display = panelOpen ? 'flex' : 'none';
    if (!panelOpen) return;

    setText(ui.status, scanning ||
      `${all.length} jobs collected` +
      (hidden ? `, ${hidden} hidden` : '') + '. LinkedIn mixes new jobs into every page, so scan all pages for the true order.');
    setText(ui.scanBtn, scanning ? 'Stop' : 'Scan all pages');

    // Rebuild (and re-sort) only when jobs are added/removed or a time becomes
    // known; otherwise just refresh the "x min ago" labels so nothing jumps.
    const sig = visible.map((x) => x.id + (postedAt(x.job) == null ? '?' : '') + (x.why || '')).sort().join('|');
    if (sig !== ui.sig) {
      ui.sig = sig;
      visible.sort(byNewest);
      ui.rows = new Map();
      ui.list.replaceChildren(...visible.map((x) => {
        const row = renderRow(x, now);
        ui.rows.set(x.id, row);
        return row;
      }));
    } else {
      for (const x of visible) {
        const row = ui.rows.get(x.id);
        if (row) setText(row.firstChild, whenLabel(x, now));
      }
    }
  }

  function whenLabel({ job, why }, now) {
    const t = postedAt(job);
    return (t == null ? 'posted time unknown (you viewed it; click it once to read the time)' : formatAge(job.hi, now)) +
      (why ? ` · hidden: ${why}` : '');
  }

  function renderRow({ id, job, why }, now) {
    const li = el('li', { padding: '8px 12px', borderBottom: '1px solid #eee', opacity: why ? '0.45' : '' });
    const t = postedAt(job);
    const when = el('div', { fontSize: '11px', fontWeight: '600', color: t == null ? '#b24020' : '#057642' },
      whenLabel({ job, why }, now));
    const a = el('a', { color: '#0a66c2', fontWeight: '600', textDecoration: 'none' }, job.title || `Job ${id}`);
    a.href = `https://www.linkedin.com/jobs/view/${id}/`;
    a.target = '_blank';
    a.rel = 'noopener';
    const sub = el('div', { color: '#5e6a75', fontSize: '12px' }, [job.company, job.place].filter(Boolean).join(' · '));
    li.append(when, a, sub);
    return li;
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  // ---------- scanning every page ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findNextButton() {
    return [...document.querySelectorAll('button, a[role="button"]')].find(
      (b) => (b.innerText || '').trim() === 'Next' || b.getAttribute('aria-label') === 'View next page'
    );
  }

  async function waitForNewPage(firstIdBefore, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(300);
      const first = getCards()[0];
      if (first && first.id !== firstIdBefore) return true;
    }
    return false;
  }

  // ---------- classic search: paging by URL ----------
  // On the classic page, LinkedIn's own page buttons load "No matching jobs
  // found". Loading the same page by its URL works, so page changes (yours and
  // the scan's) are done as normal page loads.
  const PAGE_SIZE = 25;
  const SCAN_KEY = 'rrj-scan';
  const OPEN_KEY = 'rrj-open-list';
  const isClassic = () => /^\/jobs\/search\/?$/.test(location.pathname);
  const currentPage = () => Math.floor((Number(new URLSearchParams(location.search).get('start')) || 0) / PAGE_SIZE) + 1;
  const session = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (_) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    remove(k) { try { sessionStorage.removeItem(k); } catch (_) {} },
  };

  function classicPageUrl(page) {
    const url = new URL(location.href);
    url.searchParams.delete('currentJobId');
    if (page > 1) url.searchParams.set('start', String((page - 1) * PAGE_SIZE));
    else url.searchParams.delete('start');
    url.searchParams.set('skipRedirect', 'true');
    return url.href;
  }

  document.addEventListener('click', (e) => {
    if (!isClassic() || !e.target.closest) return;
    const b = e.target.closest('button');
    const label = (b && b.getAttribute('aria-label')) || '';
    const m = label.match(/^Page (\d+)$/);
    const page = m ? Number(m[1])
      : label === 'View next page' ? currentPage() + 1
      : label === 'View previous page' ? currentPage() - 1
      : 0;
    if (page < 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.assign(classicPageUrl(page));
  }, true);

  const noResultsShown = () => /no matching jobs found/i.test((document.querySelector('main') || document.body).innerText || '');

  async function saveNow() {
    clearTimeout(saveTimer);
    await chrome.storage.local.set({ [STORE_KEY]: jobs });
    dirty = false;
  }

  // Runs on every page load while a classic scan is in progress.
  async function continueClassicScan() {
    const st = session.get(SCAN_KEY);
    if (!st || st.key !== searchKey()) { session.remove(SCAN_KEY); return; }
    panelOpen = true;
    scanning = `Scanning page ${currentPage()}… (click Stop to finish early)`;
    const t0 = Date.now();
    while (!getCards().length && !noResultsShown() && Date.now() - t0 < 15000) await sleep(400);
    await sleep(800);
    await ensureRendered();
    update();
    await saveNow();
    const full = getCards().length >= PAGE_SIZE;
    const more = full && !!document.querySelector(`button[aria-label="Page ${currentPage() + 1}"], button[aria-label="View next page"]`);
    if (session.get(SCAN_KEY) && more && currentPage() < 40) {
      await sleep(600 + Math.random() * 600); // go easy on LinkedIn
      location.assign(classicPageUrl(currentPage() + 1));
      return;
    }
    // Done: back to page 1 with the sorted list open.
    session.remove(SCAN_KEY);
    scanning = '';
    if (currentPage() !== 1) {
      session.set(OPEN_KEY, true);
      location.assign(classicPageUrl(1));
      return;
    }
    if (ui) ui.sig = '';
    update();
    if (ui) ui.list.scrollTop = 0;
  }

  let stopScan = false;
  async function scanAllPages() {
    if (scanning) { // button doubles as "Stop"
      stopScan = true;
      session.remove(SCAN_KEY);
      return;
    }
    stopScan = false;
    if (isClassic()) {
      session.set(SCAN_KEY, { key: searchKey() });
      if (currentPage() === 1) continueClassicScan();
      else location.assign(classicPageUrl(1));
      return;
    }
    // AI search: its own Next button works in-page.
    for (let page = 1; page <= 40 && !stopScan; page++) { // LinkedIn shows at most ~1000 results
      scanning = `Scanning page ${page}… (click Stop to finish early)`;
      await ensureRendered();
      update();
      const next = findNextButton();
      if (!next || next.disabled || next.getAttribute('aria-disabled') === 'true') break;
      const before = (getCards()[0] || {}).id;
      next.click();
      if (!(await waitForNewPage(before, 10000))) break;
      await sleep(1200 + Math.random() * 800); // let the cards finish rendering; go easy on LinkedIn
      await ensureRendered();
      update();
    }
    scanning = '';
    ui.sig = '';
    update();
    ui.list.scrollTop = 0;
  }

  // The popup sets this flag when you click "Search newest jobs": open the
  // list and scan every page automatically.
  let autoScanStarted = false;
  async function checkAutoScan() {
    const { rrjAutoScan } = await chrome.storage.local.get({ rrjAutoScan: 0 });
    if (!rrjAutoScan || Date.now() - rrjAutoScan > 60000 || !isSearchPage()) return;
    if (autoScanStarted) return; // URL changes several times while the page loads
    autoScanStarted = true;
    await chrome.storage.local.remove('rrjAutoScan');
    const start = Date.now();
    while (!getCards().length && Date.now() - start < 20000) await sleep(500);
    if (!getCards().length) return;
    await sleep(1500);
    panelOpen = true;
    if (ui) ui.sig = '';
    scanAllPages();
  }

  // ---------- storage ----------
  let saveTimer;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const cutoff = Date.now() - KEEP_MS;
      for (const [id, j] of Object.entries(jobs)) if (!(j.seen > cutoff)) delete jobs[id];
      chrome.storage.local.set({ [STORE_KEY]: jobs });
      dirty = false;
    }, 1000);
  }

  // ---------- wiring ----------
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; update(); }, 250);
  }

  function onUrlMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    maybeSwitchToClassic();
    schedule();
    checkAutoScan();
  }

  Promise.all([
    loadSettings(),
    new Promise((r) => chrome.storage.local.get({ [STORE_KEY]: {} }, (x) => r(x[STORE_KEY]))),
  ]).then(([s, saved]) => {
    settings = s;
    jobs = saved || {};
    if (session.get(OPEN_KEY)) { session.remove(OPEN_KEY); panelOpen = true; }
    onUrlMaybeChanged();
    if (session.get(SCAN_KEY)) continueClassicScan();
    new MutationObserver((muts) => {
      // Ignore changes to our own panel, or we'd re-render forever.
      if (ui && muts.every((m) => ui.root.contains(m.target))) return;
      schedule();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(onUrlMaybeChanged, 700); // LinkedIn is a single-page app
    setInterval(schedule, 60000); // keep "x min ago" fresh
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    if (ui) ui.sig = '';
    schedule();
  });
})();
