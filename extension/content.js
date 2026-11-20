// Runs on linkedin.com. Two jobs:
//  1. If LinkedIn sends you to its AI job search (/jobs/search-results/),
//     switch to the classic search (/jobs/search/) with your saved filters.
//  2. On job lists, hide Promoted / Applied / Viewed jobs and jobs that
//     contain words you excluded.
(() => {
  let settings = { ...DEFAULT_SETTINGS };
  let showAll = false;
  let lastHref = '';
  let pill;

  // ---------- 1. AI search -> classic search ----------
  const REDIRECT_KEY = 'rrj-last-redirect';

  function maybeRedirect() {
    if (!settings.redirectAiSearch) return;
    if (!location.pathname.startsWith('/jobs/search-results')) return;

    // Loop guard: if LinkedIn bounced us back within 15s, don't fight it.
    let last = 0;
    try { last = Number(sessionStorage.getItem(REDIRECT_KEY)) || 0; } catch (_) {}
    if (Date.now() - last < 15000) return;
    try { sessionStorage.setItem(REDIRECT_KEY, String(Date.now())); } catch (_) {}

    const q = new URLSearchParams(location.search).get('keywords');
    location.replace(buildSearchUrl(settings, q || undefined));
  }

  // ---------- 2. Clean up job cards ----------
  const CARD_SELECTOR = [
    'li[data-occludable-job-id]',
    'li.jobs-search-results__list-item',
    'li.scaffold-layout__list-item',
    'div.job-card-container',
    'div[data-job-id]',
  ].join(',');

  function excludeList() {
    return (settings.excludeWords || '')
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
  }

  function cardRoots() {
    const roots = new Set();
    document.querySelectorAll(CARD_SELECTOR).forEach((el) => {
      // Use the outermost list item so the whole row disappears.
      roots.add(el.closest('li') || el);
    });
    return [...roots];
  }

  function reasonToHide(card, words) {
    const text = card.innerText || '';
    if (!text.trim()) return null; // not rendered yet (LinkedIn lazy-loads)
    const lines = text.split('\n').map((l) => l.trim());
    if (settings.hidePromoted && lines.some((l) => /^promoted(\s+by\b.*)?$/i.test(l))) return 'promoted';
    if (settings.hideApplied && lines.some((l) => /^applied(\s+(on\b|\d).*)?$/i.test(l))) return 'applied';
    if (settings.hideViewed && lines.some((l) => /^viewed$/i.test(l))) return 'viewed';
    const lower = text.toLowerCase();
    const hit = words.find((w) => lower.includes(w));
    if (hit) return 'word: ' + hit;
    return null;
  }

  function clean() {
    if (!location.pathname.startsWith('/jobs')) {
      if (pill) pill.style.display = 'none';
      return;
    }
    const words = excludeList();
    const counts = {};
    let hidden = 0;

    for (const card of cardRoots()) {
      const reason = reasonToHide(card, words);
      if (reason) {
        hidden++;
        const key = reason.startsWith('word') ? 'keyword' : reason;
        counts[key] = (counts[key] || 0) + 1;
        card.dataset.rrjHidden = reason;
        card.style.display = showAll ? '' : 'none';
        card.style.opacity = showAll ? '0.4' : '';
      } else if (card.dataset.rrjHidden) {
        delete card.dataset.rrjHidden;
        card.style.display = '';
        card.style.opacity = '';
      }
    }
    updatePill(hidden, counts);
  }

  function updatePill(hidden, counts) {
    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.title = 'Recent Remote Jobs extension — click to show/hide filtered jobs';
      Object.assign(pill.style, {
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        zIndex: '2147483647',
        padding: '8px 14px',
        borderRadius: '999px',
        border: '0',
        background: '#0a66c2',
        color: '#fff',
        font: '600 13px -apple-system, BlinkMacSystemFont, sans-serif',
        boxShadow: '0 2px 8px rgba(0,0,0,.25)',
        cursor: 'pointer',
      });
      pill.addEventListener('click', () => {
        showAll = !showAll;
        clean();
      });
      document.body.appendChild(pill);
    }
    if (!hidden) {
      pill.style.display = 'none';
      return;
    }
    const detail = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
    const label = showAll
      ? `Showing ${hidden} filtered jobs (dimmed) · hide`
      : `Hid ${hidden} jobs (${detail}) · show`;
    // Only touch the DOM when needed, or our own MutationObserver re-fires forever.
    if (pill.textContent !== label) pill.textContent = label;
    pill.style.display = '';
  }

  // ---------- wiring ----------
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      clean();
    }, 250);
  }

  function onUrlMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    maybeRedirect();
    schedule();
  }

  loadSettings().then((s) => {
    settings = s;
    onUrlMaybeChanged();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    // LinkedIn is a single-page app: watch for in-app navigation.
    setInterval(onUrlMaybeChanged, 700);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    clean();
  });
})();
