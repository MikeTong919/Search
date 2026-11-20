// Shared between popup and content script.
//
// LinkedIn redirects /jobs/search/ to its AI search (/jobs/search-results/),
// which has no "Most recent" sort and ignores most filters. Adding
// skipRedirect=true keeps the classic search, which still honours keywords,
// location and any posted-within window (f_TPR=r3600 = past hour). rules.json
// adds skipRedirect=true to every job-search navigation, like the
// "LinkedIn Skip Redirect" extension. The classic page still mixes up the
// order and ignores the remote filter, so "remote" goes into the keywords and
// content.js does the sorting.

const DEFAULT_SETTINGS = {
  keywords: 'software engineer',
  location: 'United States',
  timeSeconds: 86400, // 0 = any time
  workTypes: ['2'], // 1 = on-site, 2 = remote, 3 = hybrid
  easyApply: false,
  // Content-script behaviour
  sortByTime: true,
  hidePromoted: true,
  hideApplied: true,
  hideViewed: false,
  excludeWords: '',
};

const WORK_TYPE_WORDS = { 1: 'on-site', 2: 'remote', 3: 'hybrid' };

function buildSearchUrl(s) {
  const p = new URLSearchParams();
  let keywords = (s.keywords || '').trim();
  const types = s.workTypes || [];
  const typeWord = types.length === 1 ? WORK_TYPE_WORDS[types[0]] : '';
  if (typeWord && !keywords.toLowerCase().includes(typeWord)) keywords = `${typeWord} ${keywords}`.trim();
  if (keywords) p.set('keywords', keywords);
  const where = (s.location || '').trim();
  if (where) p.set('location', where);
  if (types.length) p.set('f_WT', types.join(','));
  if (Number(s.timeSeconds) > 0) p.set('f_TPR', 'r' + Number(s.timeSeconds));
  if (s.easyApply) p.set('f_AL', 'true');
  p.set('sortBy', 'DD');
  p.set('skipRedirect', 'true');
  return 'https://www.linkedin.com/jobs/search/?' + p.toString();
}

// "Posted 3 hours ago" → the time range the job was posted in, as
// { lo, hi } epoch ms. LinkedIn rounds down, so "3 hours ago" means 3–4 h ago.
const AGE_UNITS_MS = {
  second: 1e3, sec: 1e3,
  minute: 6e4, min: 6e4,
  hour: 36e5, hr: 36e5,
  day: 864e5,
  week: 6048e5, wk: 6048e5,
  month: 2592e6, mo: 2592e6,
  year: 31536e6, yr: 31536e6,
};

function parsePostedWindow(text, now = Date.now()) {
  if (!text) return null;
  if (/\b(just now|moments? ago)\b/i.test(text)) return { lo: now - 6e4, hi: now };
  const m = text.match(/\b(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\s+ago\b/i);
  if (!m) return null;
  const unit = AGE_UNITS_MS[m[2].toLowerCase().replace(/s$/, '')];
  if (!unit) return null;
  const n = Number(m[1]);
  return { lo: now - (n + 1) * unit, hi: now - n * unit };
}

function formatAge(ms, now = Date.now()) {
  const min = Math.max(0, Math.round((now - ms) / 6e4));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => resolve(items));
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => chrome.storage.sync.set(settings, resolve));
}
