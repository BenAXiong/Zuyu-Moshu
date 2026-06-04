let savedItems = [];

// ── ILRDF AI — direct Gradio 5 calls (no proxy) ──────────────────────────────
const ILRDF_MT_BASE  = 'https://ai-labs.ilrdf.org.tw/kari-seejiq-tnpusu-ai-hmjil';
const ILRDF_TTS_BASE = 'https://ai-labs.ilrdf.org.tw/hnang-kari-ai-asi-sluhay';
const ILRDF_TIMEOUT  = 20000;
const ANALYSIS_MAX_TOKENS = 200;
const ANALYSIS_CONCURRENCY = 6;
const ANALYSIS_PLACEHOLDER_LINE = '一';

const AMI_DIALECTS = [
  { label: 'Coastal 海岸',      code: 'ami_Coas', speaker: '阿美_海岸_男聲'   },
  { label: 'Hengchun 恆春',    code: 'ami_Heng', speaker: '阿美_恆春_女聲'   },
  { label: 'Malan 馬蘭',       code: 'ami_Mala', speaker: '阿美_馬蘭_女聲'   },
  { label: 'Southern 南部',    code: 'ami_Sout', speaker: '阿美_南勢_女聲'   },
  { label: 'Xiuguluan 秀姑巒', code: 'ami_Xiug', speaker: '阿美_秀姑巒_女聲1' },
];

const INDIHUNT_IMPORT_URL = 'https://indilog.vercel.app/import';
const INDIHUNT_MAX_ITEMS = 200;
const INDIHUNT_LANG_CODE = {
  Amis: 'ami',
  Atayal: 'tay',
  Paiwan: 'pwn',
  Bunun: 'bnn',
  Puyuma: 'pyu',
  Rukai: 'dru',
  Tsou: 'tsu',
  Saisiyat: 'xsy',
  Tao: 'tao',
  Thao: 'ssf',
  Kavalan: 'ckv',
  Truku: 'trv',
  Sakizaya: 'szy',
  Sediq: 'see',
  Kanakanavu: 'xnb',
  Saaroa: 'sxr',
};

const els = {};
const analysisState = {
  results: [],
  segments: [],
  filters: {
    ab: false,
    roots: false,
    zh: false,
    duplicates: false,
    saved: false,
  },
};

document.addEventListener('DOMContentLoaded', () => {
  els.summary = document.getElementById('summary');
  els.search = document.getElementById('search');
  els.typeFilter = document.getElementById('typeFilter');
  els.languageFilter = document.getElementById('languageFilter');
  els.showSenseExamples = document.getElementById('showSenseExamples');
  els.list = document.getElementById('list');
  els.empty = document.getElementById('empty');
  els.copySelected = document.getElementById('copySelected');
  els.deleteSelected = document.getElementById('deleteSelected');
  els.exportIndiHunt = document.getElementById('exportIndiHunt');
  els.tabs = [...document.querySelectorAll('.tab[data-tab]')];
  els.panels = [...document.querySelectorAll('.workspace-panel[data-panel]')];
  els.directionOptions = [...document.querySelectorAll('.direction-option[data-direction]')];

  els.search.addEventListener('input', render);
  els.typeFilter.addEventListener('change', render);
  els.languageFilter.addEventListener('change', render);
  els.showSenseExamples.addEventListener('change', render);
  els.copySelected.addEventListener('click', () => copyItems(getSelectedItems(), els.copySelected));
  els.deleteSelected.addEventListener('click', deleteSelectedItems);
  els.exportIndiHunt.addEventListener('click', () => exportItemsToIndiHunt(getSelectedItems(), els.exportIndiHunt));
  els.tabs.forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
  els.directionOptions.forEach(option => {
    option.addEventListener('click', () => activateDirection(option.dataset.direction));
  });

  // AI MT & TTS
  els.aiLanguage  = document.getElementById('aiLanguage');
  els.aiDialect   = document.getElementById('aiDialect');
  els.aiInput     = document.getElementById('aiInput');
  els.aiOutput    = document.getElementById('aiOutput');
  els.aiTranslate = document.getElementById('aiTranslate');
  els.aiListen    = document.getElementById('aiListen');
  els.analysisInput = document.getElementById('analysisInput');
  els.analysisList = document.getElementById('analysisList');
  els.analysisFilterButtons = [...document.querySelectorAll('.analysis-filter[data-analysis-filter]')];
  els.analysisWordCount = document.getElementById('analysisWordCount');
  els.analyzeText = document.getElementById('analyzeText');

  els.aiLanguage.addEventListener('change', updateAiSelectors);
  els.aiInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) aiTranslate(); });
  els.aiTranslate.addEventListener('click', aiTranslate);
  els.aiListen.addEventListener('click', aiListen);
  els.analyzeText.addEventListener('click', renderAnalysisShell);
  els.analysisFilterButtons.forEach(button => {
    button.addEventListener('click', () => toggleAnalysisFilter(button.dataset.analysisFilter));
  });
  updateAiSelectors();

  loadItems();
});

function activateTab(tabId) {
  const panelId = tabId === 'paragraph-star' ? 'paragraph' : tabId;
  document.body.dataset.activeTab = panelId;
  els.tabs.forEach(tab => {
    const active = tab.dataset.tab === tabId;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  els.panels.forEach(panel => {
    const active = panel.dataset.panel === panelId;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
}

function activateDirection(direction) {
  els.directionOptions.forEach(option => {
    option.classList.toggle('is-active', option.dataset.direction === direction);
  });
}

function toggleAnalysisFilter(filter) {
  if (!Object.hasOwn(analysisState.filters, filter)) return;
  analysisState.filters[filter] = !analysisState.filters[filter];
  updateAnalysisFilterButtons();
  if (filter !== 'saved' && analysisState.segments.length > 0) renderAnalysisTable();
}

function updateAnalysisFilterButtons() {
  els.analysisFilterButtons.forEach(button => {
    const active = !!analysisState.filters[button.dataset.analysisFilter];
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function splitAnalysisTokens(text) {
  return String(text || '')
    .split(/[\s,.;:!?()[\]{}"“”、，。！？；：「」『』\n\r\t]+/)
    .map(token => token.trim())
    .filter(token => token.length > 2);
}

function getAnalysisTokens(text, limit = ANALYSIS_MAX_TOKENS, unique = true) {
  const tokens = splitAnalysisTokens(text);
  return (unique ? [...new Set(tokens)] : tokens).slice(0, limit);
}

function getAnalysisSegments(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/[\n\t]+/)
    .flatMap(chunk => chunk.match(/[^.!?。！？]+[.!?。！？]?/g) || [])
    .map(segment => cleanAnalysisText(segment))
    .filter(segment => segment !== ANALYSIS_PLACEHOLDER_LINE)
    .filter(Boolean)
    .map((text, index) => ({
      index,
      text,
      tokens: getAnalysisTokens(text, Number.POSITIVE_INFINITY, false),
    }));
}

async function renderAnalysisShell() {
  const segments = getAnalysisSegments(els.analysisInput.value);
  const tokens = getAnalysisTokens(els.analysisInput.value);
  const tokenSet = new Set(tokens);
  analysisState.segments = segments.map(segment => ({
    ...segment,
    tokens: segment.tokens.filter(token => tokenSet.has(token)),
  }));
  analysisState.results = [];
  els.analysisInput.value = formatAnalysisInputSegments(segments);
  updateAnalysisSummary(tokens.length, 0);

  if (tokens.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'analysis-empty';
    empty.textContent = 'Paste text and run Analyze.';
    els.analysisList.replaceChildren();
    els.analysisList.appendChild(empty);
    return;
  }

  setAnalysisLoading(true);
  analysisState.results = tokens.map(token => ({
    key: token,
    token,
    zh: 'Looking up...',
    root: '',
  }));
  renderAnalysisTable();

  const source = document.getElementById('analysisSource').value;
  const results = await mapWithConcurrency(tokens, ANALYSIS_CONCURRENCY, token => lookupAnalysisToken(token, source));
  analysisState.results = results;
  renderAnalysisTable();
  setAnalysisLoading(false);
}

function formatAnalysisInputSegments(segments) {
  return segments.map(segment => `${segment.text}\n${ANALYSIS_PLACEHOLDER_LINE}`).join('\n');
}

function renderAnalysisTable() {
  els.analysisList.replaceChildren();
  const resultMap = new Map(analysisState.results.map(result => [result.key, result]));
  const seenTokens = new Set();
  let shownCount = 0;
  const visibleSegments = analysisState.segments.map(segment => {
    const tokens = segment.tokens.filter(token => analysisTokenPassesFilters(token, seenTokens));
    shownCount += tokens.length;
    return { ...segment, tokens };
  });
  updateAnalysisSummary(analysisState.results.length, shownCount);
  if (!visibleSegments.length) {
    const empty = document.createElement('div');
    empty.className = 'analysis-empty';
    empty.textContent = 'No analyzed words.';
    els.analysisList.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'analysis-table';
  const tbody = document.createElement('tbody');
  visibleSegments.forEach(segment => {
    const row = document.createElement('tr');
    segment.tokens.forEach(token => {
      appendAnalysisTableCells(row, resultMap.get(token) || { key: token, token, zh: 'Looking up...', root: '' });
    });
    if (row.children.length === 0) {
      const empty = document.createElement('td');
      empty.className = 'analysis-cell analysis-cell-empty';
      empty.textContent = '—';
      row.appendChild(empty);
    }
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  els.analysisList.appendChild(table);
}

function updateAnalysisSummary(total, shown) {
  els.analysisWordCount.textContent = `${total} token analyzed / ${shown} shown`;
}

function analysisTokenPassesFilters(token, seenTokens) {
  if (analysisState.filters.duplicates && seenTokens.has(token)) return false;
  seenTokens.add(token);
  return true;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function setAnalysisLoading(on) {
  els.analyzeText.disabled = on;
  els.analyzeText.textContent = on ? 'Analyzing...' : 'Analyze';
}

function sendRuntimeMessage(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

async function lookupAnalysisToken(token, source) {
  if (source === 'EPARK') return lookupAnalysisEpark(token);
  return lookupAnalysisKilang(token);
}

async function lookupAnalysisEpark(token) {
  const dialects = typeof LANG_TO_DIALECTS === 'object'
    ? LANG_TO_DIALECTS[document.getElementById('analysisLanguage').value] || ''
    : '';
  const response = await sendRuntimeMessage({ type: 'lookup', word: token, dialects });
  const entries = Array.isArray(response?.results) ? response.results : [];
  const definitions = uniqueAnalysisValues(entries.map(entry => entry.zh || entry.word_ch || entry.definition));
  return {
    key: token,
    token,
    zh: definitions.slice(0, 3).join('；') || '—',
    root: '',
  };
}

async function lookupAnalysisKilang(token) {
  const response = await sendRuntimeMessage({ type: 'moeInsights', word: token });
  const insights = response?.insights;
  const rows = Array.isArray(insights?.rows) ? insights.rows : [];
  const displayRows = getAnalysisKilangDisplayRows(rows);
  const definitions = uniqueAnalysisValues(displayRows.map(row => cleanAnalysisDefinition(row.definition)));
  const primary = displayRows[0] || rows[0] || {};
  const matched = cleanAnalysisText(insights?.match || primary.word_ab || token);
  const root = cleanAnalysisText(primary.ultimate_root || primary.stem || '');
  return {
    key: token,
    token: matched && matched !== token ? `${token} → ${matched}` : token,
    zh: definitions.slice(0, 3).join('；') || '—',
    root,
  };
}

function appendAnalysisTableCells(row, result) {
  if (!analysisState.filters.ab) {
    const ab = document.createElement('td');
    ab.className = 'analysis-cell analysis-cell-ab';
    ab.textContent = result.token || result.key || '—';
    ab.title = result.token || result.key || '';
    row.appendChild(ab);
  }

  if (!analysisState.filters.roots) {
    const root = document.createElement('td');
    root.className = 'analysis-cell analysis-cell-root';
    root.textContent = result.root || '—';
    root.title = result.root || '';
    row.appendChild(root);
  }

  if (!analysisState.filters.zh) {
    const zh = document.createElement('td');
    zh.className = 'analysis-cell analysis-cell-zh';
    zh.textContent = result.zh || '—';
    zh.title = result.zh || '';
    row.appendChild(zh);
  }
}

function cleanAnalysisText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cleanAnalysisDefinition(text) {
  return cleanAnalysisText(text).replace(/[。；;]+$/g, '');
}

function uniqueAnalysisValues(values) {
  const seen = new Set();
  return values.map(cleanAnalysisText).filter(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getAnalysisKilangDisplayRows(rows) {
  const displayable = rows.filter(row => cleanAnalysisDefinition(row.definition));
  return displayable.length > 0 ? displayable : rows;
}

async function loadItems() {
  savedItems = await fdtGetSavedItems();
  populateLanguageFilter();
  render();
}

function populateLanguageFilter() {
  const current = els.languageFilter.value;
  const languages = [...new Set(savedItems.map(item => item.language).filter(Boolean))].sort();
  els.languageFilter.replaceChildren(new Option('全部語言', ''));
  languages.forEach(language => els.languageFilter.appendChild(new Option(language, language)));
  els.languageFilter.value = languages.includes(current) ? current : '';
}

function itemSearchText(item) {
  return [
    item.type,
    item.language,
    item.headword,
    item.matchedWord,
    item.ab,
    item.zh,
    item.root,
    ...(item.affixes || []),
    ...(item.examples || []).flatMap(example => [example.ab, example.zh, example.source]),
  ].join(' ').toLowerCase();
}

function getFilteredItems() {
  const query = els.search.value.trim().toLowerCase();
  const type = els.typeFilter.value;
  const language = els.languageFilter.value;
  return savedItems.filter(item => {
    if (type && item.type !== type) return false;
    if (language && item.language !== language) return false;
    if (query && !itemSearchText(item).includes(query)) return false;
    return true;
  });
}

function getSelectedItems() {
  const ids = [...document.querySelectorAll('.item-check:checked')].map(input => input.value);
  return savedItems.filter(item => ids.includes(item.id));
}

function render() {
  const items = getFilteredItems();
  els.summary.textContent = `${savedItems.length} saved / ${items.length} shown`;
  els.empty.hidden = savedItems.length !== 0;
  els.list.replaceChildren();

  updateSelectedActionState();

  items.forEach(item => els.list.appendChild(renderItem(item)));
  updateSelectedActionState();
}

function renderItem(item) {
  const card = document.createElement('article');
  card.className = 'item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'item-check';
  checkbox.value = item.id;
  checkbox.addEventListener('change', updateSelectedCopyState);

  const main = document.createElement('div');
  main.className = 'item-main';

  const title = document.createElement('div');
  title.className = 'item-title';
  const ab = document.createElement('div');
  ab.className = 'ab';
  ab.textContent = item.ab || item.matchedWord || item.headword || item.zh || '(empty)';
  title.appendChild(ab);
  main.appendChild(title);

  if (item.zh && item.zh !== ab.textContent) {
    const zh = document.createElement('div');
    zh.className = 'zh';
    zh.textContent = item.zh;
    main.appendChild(zh);
  }

  if (item.affixes?.length) {
    const affixes = document.createElement('div');
    affixes.className = 'affixes';
    affixes.textContent = item.affixes.join(' + ');
    main.appendChild(affixes);
  }

  const showExamples = item.type !== 'sense' || els.showSenseExamples.checked;
  if (showExamples && item.examples?.length) {
    const examples = document.createElement('div');
    examples.className = 'examples';
    item.examples.slice(0, 3).forEach(example => {
      const row = document.createElement('div');
      row.className = 'example';
      if (example.ab) {
        const exAb = document.createElement('div');
        exAb.className = 'example-ab';
        exAb.textContent = example.ab;
        row.appendChild(exAb);
      }
      if (example.zh) {
        const exZh = document.createElement('div');
        exZh.textContent = example.zh;
        row.appendChild(exZh);
      }
      examples.appendChild(row);
    });
    main.appendChild(examples);
  }

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'item-indihunt-button';
  exportBtn.title = 'Export to IndiHunt';
  exportBtn.setAttribute('aria-label', 'Export to IndiHunt');
  const indivoreLogo = document.createElement('img');
  indivoreLogo.className = 'item-indihunt-logo';
  indivoreLogo.src = 'assets/indivore/icon128.png';
  indivoreLogo.alt = '';
  indivoreLogo.width = 24;
  indivoreLogo.height = 24;
  exportBtn.appendChild(indivoreLogo);
  exportBtn.addEventListener('click', () => exportItemsToIndiHunt([item], exportBtn));
  actions.appendChild(exportBtn);

  const language = document.createElement('div');
  language.className = 'item-language';
  language.textContent = item.language || '';

  const root = document.createElement('div');
  root.className = 'item-root';
  root.textContent = item.root || '';

  card.append(checkbox, language, root, main, actions);
  return card;
}

function updateSelectedCopyState() {
  updateSelectedActionState();
}

function updateSelectedActionState() {
  const hasSelection = getSelectedItems().length > 0;
  els.copySelected.disabled = !hasSelection;
  els.deleteSelected.disabled = !hasSelection;
  els.exportIndiHunt.disabled = !hasSelection;
}

async function deleteSelectedItems() {
  const selectedIds = new Set(getSelectedItems().map(item => item.id));
  if (selectedIds.size === 0) return;
  savedItems = savedItems.filter(item => !selectedIds.has(item.id));
  await fdtSetSavedItems(savedItems);
  populateLanguageFilter();
  render();
}

function copyItems(items, btn) {
  if (!items.length) return;
  const text = items.map(fdtFormatSavedItem).join('\n\n---\n\n');
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = '已複製';
    setTimeout(() => { btn.textContent = original; }, 900);
  });
}

function exportItemsToIndiHunt(items, btn) {
  if (!items.length) return;
  const exportItems = items.flatMap(formatIndiHuntItems).slice(0, INDIHUNT_MAX_ITEMS);
  if (!exportItems.length) return;
  const payload = {
    version: 1,
    source: 'ycm-popupdict',
    exportedAt: new Date().toISOString(),
    items: exportItems,
  };
  openIndiHuntImport(payload);
  flashButtonLabel(btn, '已送出');
}

function formatIndiHuntItems(item) {
  const items = [];
  const main = formatIndiHuntMainItem(item);
  if (main) items.push(main);

  (item.examples || []).forEach(example => {
    const sentence = formatIndiHuntSentenceItem(example, item);
    if (sentence) items.push(sentence);
  });

  return items;
}

function formatIndiHuntMainItem(item) {
  const ab = cleanExportText(item.ab || item.matchedWord || item.headword);
  const language = getIndiHuntLanguageCode(item.language);
  if (!ab || !language) return null;

  return cleanIndiHuntItem({
    ab,
    zh: cleanExportText(item.zh),
    type: item.type === 'example' ? 'sentence' : 'word',
    language,
    dialect: cleanExportText(item.dialect),
    audio: cleanExportText(item.audioUrl),
    notes: formatIndiHuntNotes(item),
    tags: formatIndiHuntTags(item),
  });
}

function formatIndiHuntSentenceItem(example, parent) {
  const ab = cleanExportText(example.ab);
  const language = getIndiHuntLanguageCode(parent.language);
  if (!ab || !language) return null;

  return cleanIndiHuntItem({
    ab,
    zh: cleanExportText(example.zh),
    type: 'sentence',
    language,
    dialect: cleanExportText(parent.dialect),
    audio: cleanExportText(example.audioUrl || example.audio_url),
    notes: formatIndiHuntNotes(parent, example),
    tags: formatIndiHuntTags(parent),
  });
}

function cleanIndiHuntItem(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== '';
    })
  );
}

function getIndiHuntLanguageCode(language) {
  return INDIHUNT_LANG_CODE[language] || '';
}

function formatIndiHuntNotes(item, example = null) {
  const notes = [];
  if (item.root) notes.push(`Root: ${item.root}`);
  if (item.affixes?.length) notes.push(`Affixes: ${item.affixes.join(' + ')}`);
  if (item.sourceMeta || item.dialect) notes.push(`Source: ${item.sourceMeta || item.dialect}`);
  if (example?.source) notes.push(`Example source: ${example.source}`);
  if (item.pageTitle) notes.push(`Page: ${item.pageTitle}`);
  if (item.pageUrl) notes.push(item.pageUrl);
  return notes.join(' · ');
}

function formatIndiHuntTags(item) {
  return [item.sourceId].map(cleanExportText).filter(Boolean);
}

function cleanExportText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function openIndiHuntImport(payload) {
  const b64 = encodePayload(payload);
  chrome.tabs.create({ url: `${INDIHUNT_IMPORT_URL}#v1:${b64}` });
}

function flashButtonLabel(btn, text) {
  if (!btn) return;
  const label = btn.querySelector('span') || btn;
  const original = label.textContent;
  label.textContent = text;
  setTimeout(() => { label.textContent = original; }, 900);
}

// ── AI MT & TTS ───────────────────────────────────────────────────────────────

// Gradio 5 SSE: POST → event_id, GET stream → find complete event, cancel reader
async function gradioCall(base, fn, data, signal) {
  const submitRes = await fetch(`${base}/gradio_api/call/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
    signal,
  });
  if (!submitRes.ok) return null;
  const { event_id } = await submitRes.json();
  if (!event_id) return null;

  const streamRes = await fetch(`${base}/gradio_api/call/${fn}/${event_id}`, { signal });
  if (!streamRes.ok || !streamRes.body) return null;

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const match = /event:\s*complete[\r\n]+data:\s*(\[[\s\S]+?\])\s*$/.exec(buf);
      if (match) {
        result = JSON.parse(match[1])[0];
        break;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return result;
}

function getActiveDirection() {
  return document.querySelector('.direction-option.is-active')?.dataset.direction ?? 'zh-to-x';
}

function getActiveDialect() {
  return AMI_DIALECTS.find(d => d.code === els.aiDialect.value) ?? AMI_DIALECTS[0];
}

function updateAiSelectors() {
  const isAmi = els.aiLanguage.value === 'ami';
  els.aiDialect.hidden = !isAmi;
  els.aiListen.hidden  = !isAmi;
}

async function aiTranslate() {
  const text = els.aiInput.value.trim();
  if (!text || els.aiTranslate.disabled) return;

  const lang = els.aiLanguage.value;
  if (lang !== 'ami') {
    els.aiOutput.value = 'ILRDF MT currently supports Amis only.';
    return;
  }

  const direction   = getActiveDirection();
  const dialectCode = getActiveDialect().code;
  const isZhToAmi   = direction === 'zh-to-x';
  const fn   = isZhToAmi ? 'translate_1' : 'translate';
  const data = isZhToAmi ? [text, 'zho_Hant', dialectCode] : [text, dialectCode, 'zho_Hant'];

  setAiTranslating(true);
  els.aiOutput.value = '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ILRDF_TIMEOUT);
  try {
    const result = await gradioCall(ILRDF_MT_BASE, fn, data, controller.signal);
    els.aiOutput.value = typeof result === 'string' ? result : 'Translation failed. Try again.';
  } catch {
    els.aiOutput.value = 'Translation service unavailable.';
  } finally {
    clearTimeout(timeout);
    setAiTranslating(false);
  }
}

let currentTtsAudio = null;

async function aiListen() {
  if (els.aiListen.hidden || els.aiListen.disabled) return;
  // Play the Formosan side: input when ami→zh, output when zh→ami
  const direction = getActiveDirection();
  const ttsText   = direction === 'x-to-zh' ? els.aiInput.value.trim() : els.aiOutput.value.trim();
  if (!ttsText) return;

  const { speaker } = getActiveDialect();

  setAiListening(true);
  currentTtsAudio?.pause();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ILRDF_TIMEOUT);
  try {
    const result = await gradioCall(ILRDF_TTS_BASE, 'default_speaker_tts', [speaker, ttsText], controller.signal);
    const url = result?.url ?? (typeof result === 'string' ? result : null);
    if (url) {
      const audio = new Audio(url);
      currentTtsAudio = audio;
      audio.onended = () => setAiListening(false);
      audio.onerror = () => setAiListening(false);
      audio.play().catch(() => setAiListening(false));
    } else {
      setAiListening(false);
    }
  } catch {
    setAiListening(false);
  } finally {
    clearTimeout(timeout);
  }
}

function setAiTranslating(on) {
  els.aiTranslate.disabled = on;
  const span = els.aiTranslate.querySelector('span:last-child');
  if (span) span.textContent = on ? '翻譯中…' : 'Translate';
}

function setAiListening(on) {
  els.aiListen.disabled = on;
  const span = els.aiListen.querySelector('span:last-child');
  if (span) span.textContent = on ? '…' : 'Listen';
}
