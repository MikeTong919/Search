const $ = (id) => document.getElementById(id);
const TEXT_FIELDS = ['keywords', 'location', 'excludeWords'];
const BOOL_FIELDS = ['easyApply', 'hidePromoted', 'hideApplied', 'hideViewed', 'redirectAiSearch'];
const MULTI_FIELDS = ['workTypes', 'experience', 'jobTypes'];

let settings = { ...DEFAULT_SETTINGS };

function render() {
  TEXT_FIELDS.forEach((f) => ($(f).value = settings[f] || ''));
  BOOL_FIELDS.forEach((f) => ($(f).checked = !!settings[f]));
  MULTI_FIELDS.forEach((name) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
      el.checked = (settings[name] || []).includes(el.value);
    });
  });
  document.querySelectorAll('#time button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.v) === Number(settings.timeSeconds));
  });
}

function collect() {
  TEXT_FIELDS.forEach((f) => (settings[f] = $(f).value));
  BOOL_FIELDS.forEach((f) => (settings[f] = $(f).checked));
  MULTI_FIELDS.forEach((name) => {
    settings[name] = [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
  });
  return settings;
}

let saveTimer;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSettings(collect()).then(() => {
      $('status').textContent = 'Saved — open LinkedIn tabs update automatically.';
    });
  }, 300);
}

document.addEventListener('input', autosave);
document.addEventListener('change', autosave);

$('time').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  settings.timeSeconds = Number(b.dataset.v);
  render();
  autosave();
});

$('search').addEventListener('click', async () => {
  collect();
  await saveSettings(settings);
  chrome.tabs.create({ url: buildSearchUrl(settings) });
  window.close();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') $('search').click();
});

loadSettings().then((s) => {
  settings = s;
  render();
});
