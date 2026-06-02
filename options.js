// DEFAULTS, SOURCES, and LANG_TO_DIALECTS are provided by shared.js

document.addEventListener('DOMContentLoaded', () => {
  // Populate language dropdown
  const langSelect = document.getElementById('language');
  Object.keys(LANG_TO_DIALECTS).forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    langSelect.appendChild(opt);
  });

  // Populate sources checkboxes from shared.js SOURCES
  const sourcesList = document.getElementById('sources-list');
  SOURCES.forEach(src => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'source-cb';
    cb.value = src.id;
    cb.disabled = !src.available;
    if (src.language) cb.dataset.language = src.language;
    label.append(cb, document.createTextNode(' ' + src.label));
    sourcesList.appendChild(label);
  });

  // Load saved settings
  chrome.storage.sync.get(DEFAULTS, (s) => {
    langSelect.value = s.language;

    const validIds = new Set(SOURCES.map(src => src.id));
    const activeSources = (s.sources || [])
      .map(id => ({ ILRDF: 'EPARK', WIKI: 'ILRDF' }[id] || id))
      .filter(id => validIds.has(id));
    const effectiveSources = activeSources.length > 0 ? activeSources : DEFAULTS.sources;
    document.querySelectorAll('.source-cb').forEach(cb => {
      cb.checked = effectiveSources.includes(cb.value) || (cb.value === 'KILANG' && s.moeKilangInsights);
    });

    document.getElementById('showDialect').checked = s.showDialect;
    document.getElementById('boldText').checked = s.boldText;
    document.getElementById('maxResults').value = String(s.maxResults);
    const themeVal = { woven: 'paper', forest: 'field' }[s.theme] ?? s.theme;
    (document.querySelector(`input[name="theme"][value="${themeVal}"]`) ??
     document.querySelector('input[name="theme"][value="dark"]')).checked = true;
    document.querySelector(`input[name="fontSize"][value="${s.fontSize}"]`).checked = true;
    document.getElementById('enabled').checked = s.enabled;
    document.getElementById('triggerDblclick').checked = s.triggerHover ? false : s.triggerDblclick;
    document.getElementById('triggerHover').checked = s.triggerHover;
    document.getElementById('triggerCtrlSelect').checked = s.triggerCtrlSelect;
    updateSourceAvailability(langSelect.value);
  });

  langSelect.addEventListener('change', () => updateSourceAvailability(langSelect.value));

  document.getElementById('triggerDblclick').addEventListener('change', (e) => {
    if (e.target.checked) document.getElementById('triggerHover').checked = false;
  });

  document.getElementById('triggerHover').addEventListener('change', (e) => {
    if (e.target.checked) document.getElementById('triggerDblclick').checked = false;
  });

  document.getElementById('save').addEventListener('click', () => {
    const hover = document.getElementById('triggerHover').checked;
    const dblclick = !hover && document.getElementById('triggerDblclick').checked;
    const ctrlSel  = document.getElementById('triggerCtrlSelect').checked;
    const sources = Array.from(document.querySelectorAll('.source-cb:not([disabled])'))
                        .filter(cb => cb.checked)
                        .map(cb => cb.value);

    if (!hover && !dblclick && !ctrlSel) {
      showStatus('至少需啟用一種觸發方式。', true);
      return;
    }

    const settings = {
      language:          langSelect.value,
      sources,
      showDialect:       document.getElementById('showDialect').checked,
      boldText:          document.getElementById('boldText').checked,
      maxResults:        Number.parseInt(document.getElementById('maxResults').value, 10),
      theme:             document.querySelector('input[name="theme"]:checked').value,
      fontSize:          document.querySelector('input[name="fontSize"]:checked').value,
      enabled:           document.getElementById('enabled').checked,
      triggerDblclick:   dblclick,
      triggerHover:      hover,
      triggerCtrlSelect: ctrlSel,
      moeKilangInsights: langSelect.value === 'Amis' && sources.includes('KILANG'),
    };

    chrome.storage.sync.set(settings, () => showStatus('已儲存！', false));
  });
});

function updateSourceAvailability(language) {
  document.querySelectorAll('.source-cb').forEach(cb => {
    const source = SOURCES.find(src => src.id === cb.value);
    const available = Boolean(source?.available) && (!source.language || source.language === language);
    cb.disabled = !available;
    if (!available) cb.checked = false;
    cb.parentElement?.classList.toggle('disabled', !available);
  });
}

function showStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  setTimeout(() => { el.textContent = ''; el.className = ''; }, 2000);
}
