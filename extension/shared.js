// Shared between popup and content script.
// Builds LinkedIn's *classic* job search URL (/jobs/search/), which supports
// "Most recent" sorting and exact filters, instead of the AI search page
// (/jobs/search-results/).

const DEFAULT_SETTINGS = {
  keywords: '"software engineer" OR "software developer"',
  location: 'United States',
  timeSeconds: 86400, // past 24 hours; 0 = any time
  workTypes: ['2'], // 1 = on-site, 2 = remote, 3 = hybrid
  experience: [], // 1 intern, 2 entry, 3 associate, 4 mid-senior, 5 director, 6 executive
  jobTypes: [], // F full-time, C contract, P part-time, T temporary, I internship
  easyApply: false,
  // Content-script filters
  hidePromoted: true,
  hideApplied: true,
  hideViewed: false,
  excludeWords: '',
  redirectAiSearch: true,
  sortByTime: true, // re-order each results page strictly newest → oldest
};

function buildSearchUrl(s, keywordsOverride) {
  const p = new URLSearchParams();
  const keywords = (keywordsOverride ?? s.keywords ?? '').trim();
  if (keywords) p.set('keywords', keywords);
  if (s.location && s.location.trim()) p.set('location', s.location.trim());
  if (s.workTypes && s.workTypes.length) p.set('f_WT', s.workTypes.join(','));
  if (Number(s.timeSeconds) > 0) p.set('f_TPR', 'r' + Number(s.timeSeconds));
  if (s.experience && s.experience.length) p.set('f_E', s.experience.join(','));
  if (s.jobTypes && s.jobTypes.length) p.set('f_JT', s.jobTypes.join(','));
  if (s.easyApply) p.set('f_AL', 'true');
  p.set('sortBy', 'DD'); // DD = most recent first
  return 'https://www.linkedin.com/jobs/search/?' + p.toString();
}

// Turns LinkedIn's "posted" text ("3 hours ago", "Reposted 1 day ago",
// "Just now") into minutes since posting. Returns null if no age is found.
const AGE_UNITS = {
  second: 1 / 60, sec: 1 / 60,
  minute: 1, min: 1,
  hour: 60, hr: 60,
  day: 1440,
  week: 10080, wk: 10080,
  month: 43200, mo: 43200,
  year: 525600, yr: 525600,
};

function parseAgeMinutes(text) {
  if (!text) return null;
  if (/\b(just now|moments? ago)\b/i.test(text)) return 0;
  const m = text.match(/\b(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\s+ago\b/i);
  if (!m) return null;
  const unit = m[2].toLowerCase().replace(/s$/, '');
  return Number(m[1]) * (AGE_UNITS[unit] ?? AGE_UNITS[unit + 's'] ?? 0);
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => resolve(items));
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => chrome.storage.sync.set(settings, resolve));
}
