// DEFAULTS and LANG_TO_DIALECTS provided by shared.js

const ALT_SPELLING_LANGUAGE = 'Amis';

document.addEventListener('DOMContentLoaded', () => {
  // Populate language dropdown
  const langSelect = document.getElementById('language');
  Object.keys(LANG_TO_DIALECTS).forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    langSelect.appendChild(opt);
  });

  // Load settings and reflect them in the UI
  chrome.storage.sync.get(DEFAULTS, (s) => {
    const MIGRATE = { woven: 'paper', forest: 'field' };
    if (s.theme in MIGRATE) { s.theme = MIGRATE[s.theme]; patch({ theme: s.theme }); }
    langSelect.value = s.language;
    activatePill('theme', s.theme);
    activatePill('font', s.fontSize);
    applyTheme(s.theme);
    applyFontSize(s.fontSize);
    setToggle(s.enabled);
    setAltSpellingToggle(s.altSpelling, s.language);
    setHoverToggle(s.triggerHover);
    setAiToolsToggle(s.aiToolsEnabled);
    setDisplayTarget(s.lookupDisplayTarget);
  });

  // Language: save on change
  langSelect.addEventListener('change', () => {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      patch({ language: langSelect.value });
      setAltSpellingToggle(s.altSpelling, langSelect.value);
    });
  });

  // Pills: save on click
  document.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const { group, value } = btn.dataset;
      activatePill(group, value);
      if (group === 'theme') {
        applyTheme(value);
        patch({ theme: value });
      } else if (group === 'font') {
        applyFontSize(value);
        patch({ fontSize: value });
      } else if (group === 'displayTarget') {
        if (value === 'companion' && !canUseSidePanel()) return;
        patch({ lookupDisplayTarget: value });
        setDisplayTarget(value);
      }
    });
  });

  // Enable/disable toggle
  document.getElementById('toggle').addEventListener('click', () => {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      const next = !s.enabled;
      patch({ enabled: next });
      setToggle(next);
    });
  });

  // Alt spelling toggle
  document.getElementById('altSpelling').addEventListener('click', () => {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      if (s.language !== ALT_SPELLING_LANGUAGE) return;
      const next = !s.altSpelling;
      patch({ altSpelling: next });
      setAltSpellingToggle(next, s.language);
    });
  });

  // Hover lookup toggle; hover mode replaces double-click lookup
  document.getElementById('triggerHover').addEventListener('click', () => {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      const next = !s.triggerHover;
      patch({ triggerHover: next, triggerDblclick: !next });
      setHoverToggle(next);
    });
  });

  document.getElementById('aiTools').addEventListener('click', () => {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      const next = !s.aiToolsEnabled;
      patch({ aiToolsEnabled: next });
      setAiToolsToggle(next);
    });
  });

  // Full settings link
  document.getElementById('opts').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('saved').addEventListener('click', () => {
    fdtOpenSavedPage();
  });

});

function setToggle(enabled) {
  document.getElementById('toggle').classList.toggle('off', !enabled);
  const lbl = document.getElementById('toggle-label');
  lbl.textContent = enabled ? '啟用' : '停用';
  lbl.classList.toggle('off', !enabled);
}

function setAltSpellingToggle(enabled, language) {
  const btn = document.getElementById('altSpelling');
  const available = language === ALT_SPELLING_LANGUAGE;
  btn.disabled = !available;
  btn.classList.toggle('disabled', !available);
  btn.classList.toggle('off', !available || !enabled);
  btn.title = available ? '相近拼法搜尋' : '相近拼法搜尋僅適用 Amis';
}

function setHoverToggle(enabled) {
  document.getElementById('triggerHover').classList.toggle('off', !enabled);
}

function setAiToolsToggle(enabled) {
  document.getElementById('aiTools').classList.toggle('off', !enabled);
}

function setDisplayTarget(target) {
  const value = canUseSidePanel() ? (target || 'tooltip') : 'tooltip';
  activatePill('displayTarget', value);
  const companion = document.querySelector('.pill[data-group="displayTarget"][data-value="companion"]');
  if (companion) {
    companion.disabled = !canUseSidePanel();
    companion.classList.toggle('disabled', !canUseSidePanel());
    companion.title = canUseSidePanel() ? '在側欄顯示查詢' : '此 Chrome 不支援 Side Panel';
  }
}

function canUseSidePanel() {
  return !!chrome.sidePanel;
}

function activatePill(group, value) {
  document.querySelectorAll(`.pill[data-group="${group}"]`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function applyTheme(theme) {
  document.body.classList.remove('light', 'paper', 'field');
  if (theme !== 'dark') document.body.classList.add(theme);
}

function applyFontSize(size) {
  document.body.classList.remove('font-small', 'font-large');
  if (size !== 'medium') document.body.classList.add(`font-${size}`);
}

function patch(changes) {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    chrome.storage.sync.set({ ...s, ...changes });
  });
}
