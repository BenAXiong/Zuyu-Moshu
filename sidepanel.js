const CONTEXT_KEY = 'companionContext';
const STATE_KEY = 'companionState';
const READER_CONTROLS_KEY = 'companionReaderControlsV1';
const LOOKUP_CONCURRENCY = 4;
const MAX_ANALYSIS_TOKENS = 80;
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

let renderSerial = 0;
let companionState = makeEmptyCompanionState();
let currentContext = null;
let companionHistory = [];
let currentExportItems = [];
let currentHeaderSaveItem = null;
let currentHeaderSaveItems = null;
let currentKilangLookupMeta = null;
let pendingStateWrite = '';
let readerControls = makeDefaultReaderControls();

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('clear')?.addEventListener('click', clearContext);
  document.getElementById('topExport')?.addEventListener('click', exportCompanionToIndiHunt);
  document.getElementById('manualSearch')?.addEventListener('submit', handleManualSearch);
  setupReaderControlButtons();
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => setActiveMode(tab.dataset.mode));
  });

  loadReaderControls();
  loadContext();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    if (changes[STATE_KEY]) {
      const nextStateKey = JSON.stringify(changes[STATE_KEY].newValue || null);
      if (pendingStateWrite && nextStateKey === pendingStateWrite) {
        pendingStateWrite = '';
        return;
      }
      applyCompanionState(changes[STATE_KEY].newValue || makeEmptyCompanionState(), { resetHistory: true });
      return;
    }
    if (changes[CONTEXT_KEY]) {
      applyIncomingContext(changes[CONTEXT_KEY].newValue || null);
    }
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'companionContextUpdated') loadIncomingContext();
  });
});

function loadContext() {
  chrome.storage.session.get({ [STATE_KEY]: null, [CONTEXT_KEY]: null }, data => {
    if (shouldUseIncomingContext(data[CONTEXT_KEY], data[STATE_KEY])) {
      applyIncomingContext(data[CONTEXT_KEY]);
      return;
    }
    if (data[STATE_KEY]) {
      applyCompanionState(data[STATE_KEY], { resetHistory: true });
      return;
    }
    applyCompanionState(makeEmptyCompanionState(), { resetHistory: true });
  });
}

function loadIncomingContext() {
  chrome.storage.session.get({ [CONTEXT_KEY]: null }, data => {
    if (data[CONTEXT_KEY]) applyIncomingContext(data[CONTEXT_KEY]);
  });
}

function clearContext() {
  companionHistory = [];
  const next = {
    ...normalizeCompanionState(companionState),
    contexts: {
      ...normalizeCompanionState(companionState).contexts,
      [getActiveMode()]: null,
    },
  };
  persistCompanionState(next, { resetHistory: true });
}

function setActiveMode(mode) {
  const next = {
    ...normalizeCompanionState(companionState),
    activeMode: normalizeMode(mode),
  };
  persistCompanionState(next, { resetHistory: false });
}

function updateActiveTab(mode) {
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
  updateReaderControlsVisibility(mode);
}

function makeEmptyCompanionState() {
  return {
    activeMode: 'lookup',
    contexts: {
      lookup: null,
      analysis: null,
    },
  };
}

function makeDefaultReaderControls() {
  return {
    topAnnotations: true,
    zhGloss: true,
    dividers: true,
    wordTable: true,
  };
}

function normalizeReaderControls(value) {
  const defaults = makeDefaultReaderControls();
  return {
    topAnnotations: typeof value?.topAnnotations === 'boolean' ? value.topAnnotations : defaults.topAnnotations,
    zhGloss: typeof value?.zhGloss === 'boolean' ? value.zhGloss : defaults.zhGloss,
    dividers: typeof value?.dividers === 'boolean' ? value.dividers : defaults.dividers,
    wordTable: typeof value?.wordTable === 'boolean' ? value.wordTable : defaults.wordTable,
  };
}

function setupReaderControlButtons() {
  document.querySelectorAll('[data-reader-control]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.readerControl;
      if (!Object.prototype.hasOwnProperty.call(readerControls, key)) return;
      readerControls = normalizeReaderControls({
        ...readerControls,
        [key]: !readerControls[key],
      });
      chrome.storage.local.set({ [READER_CONTROLS_KEY]: readerControls });
      syncReaderControlButtons();
      applyReaderControls();
    });
  });
  syncReaderControlButtons();
}

function loadReaderControls() {
  chrome.storage.local.get({ [READER_CONTROLS_KEY]: null }, data => {
    readerControls = normalizeReaderControls(data[READER_CONTROLS_KEY]);
    syncReaderControlButtons();
    applyReaderControls();
  });
}

function syncReaderControlButtons() {
  document.querySelectorAll('[data-reader-control]').forEach(button => {
    const key = button.dataset.readerControl;
    const isOn = !!readerControls[key];
    button.classList.toggle('active', isOn);
    button.setAttribute('aria-pressed', String(isOn));
  });
}

function updateReaderControlsVisibility(mode = getActiveMode()) {
  const controls = document.getElementById('readerControls');
  if (!controls) return;
  controls.hidden = normalizeMode(mode) !== 'analysis';
}

function applyReaderControls(root = document) {
  const readers = [];
  if (root.matches?.('.companion-reader')) readers.push(root);
  if (root.matches?.('.reader-word-table-section')) readers.push(root);
  root.querySelectorAll?.('.companion-reader').forEach(reader => readers.push(reader));
  root.querySelectorAll?.('.reader-word-table-section').forEach(reader => readers.push(reader));
  readers.forEach(reader => {
    reader.classList.toggle('hide-top-annotations', !readerControls.topAnnotations);
    reader.classList.toggle('hide-zh-gloss', !readerControls.zhGloss);
    reader.classList.toggle('hide-dividers', !readerControls.dividers);
    reader.classList.toggle('hide-word-table', !readerControls.wordTable);
  });
}

function normalizeCompanionState(state) {
  const empty = makeEmptyCompanionState();
  const activeMode = normalizeMode(state?.activeMode || empty.activeMode);
  return {
    activeMode,
    contexts: {
      lookup: state?.contexts?.lookup || null,
      analysis: state?.contexts?.analysis || null,
    },
  };
}

function normalizeMode(mode) {
  return mode === 'analysis' ? 'analysis' : 'lookup';
}

function modeForContext(context) {
  return context?.mode === 'word' ? 'lookup' : 'analysis';
}

function getActiveMode() {
  return normalizeCompanionState(companionState).activeMode;
}

function persistCompanionState(state, options = {}) {
  const normalized = normalizeCompanionState(state);
  pendingStateWrite = JSON.stringify(normalized);
  chrome.storage.session.set({ [STATE_KEY]: normalized }, () => {
    applyCompanionState(normalized, options);
  });
}

function applyIncomingContext(context) {
  if (!context) return;
  const mode = modeForContext(context);
  const state = normalizeCompanionState(companionState);
  persistCompanionState({
    activeMode: mode,
    contexts: {
      ...state.contexts,
      [mode]: context,
    },
  }, { resetHistory: true });
  chrome.storage.session.remove(CONTEXT_KEY);
}

function shouldUseIncomingContext(context, state) {
  if (!context) return false;
  if (!state) return true;
  return getContextTime(context) > getStateTime(state);
}

function getStateTime(state) {
  const normalized = normalizeCompanionState(state);
  return Math.max(
    getContextTime(normalized.contexts.lookup),
    getContextTime(normalized.contexts.analysis)
  );
}

function getContextTime(context) {
  const time = new Date(context?.timestamp || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function applyCompanionState(state, options = {}) {
  companionState = normalizeCompanionState(state);
  const context = companionState.contexts[companionState.activeMode] || null;
  renderContext(context, {
    ...options,
    activeMode: companionState.activeMode,
  });
}

async function renderContext(context, options = {}) {
  if (options.resetHistory) companionHistory = [];
  currentContext = context;
  const serial = ++renderSerial;
  const content = document.getElementById('content');
  if (!content) return;
  const activeMode = normalizeMode(options.activeMode || getActiveMode());
  updateActiveTab(activeMode);

  if (!context) {
    content.className = 'content empty';
    content.replaceChildren(makeEmptyState());
    syncManualSearchInput(null);
    return;
  }

  content.className = 'content';
  content.replaceChildren(makeLoadingState(context));
  currentExportItems = [];
  currentHeaderSaveItem = null;
  currentHeaderSaveItems = null;
  currentKilangLookupMeta = null;

  const settings = contextToSettings(context);
  const view = context.mode === 'word'
    ? await buildLookupView(context, settings)
    : await buildAnalysisView(context, settings);
  if (serial !== renderSerial || currentContext !== context) return;
  syncManualSearchInput(context);
  content.replaceChildren(view);
}

async function handleManualSearch(event) {
  event.preventDefault();
  const input = document.getElementById('manualSearchInput');
  const rawText = FDT_LOOKUP_CORE.cleanPhraseText(input?.value || '');
  if (!rawText) return;

  companionHistory = [];
  const context = await buildManualSearchContext(rawText);
  const mode = modeForContext(context);
  if (input) input.value = context.rawText || rawText;
  const state = normalizeCompanionState(companionState);
  persistCompanionState({
    activeMode: mode,
    contexts: {
      ...state.contexts,
      [mode]: context,
    },
  }, { resetHistory: true });
}

async function buildManualSearchContext(rawText) {
  const settings = await readCompanionSettings();
  const hasCjk = FDT_LOOKUP_CORE.hasCjk(rawText);
  const tokens = FDT_LOOKUP_CORE.getPhraseTokens(rawText, MAX_ANALYSIS_TOKENS);
  const mode = hasCjk || tokens.length <= 1 ? 'word' : 'sentences';
  const cleanWord = hasCjk ? rawText : (tokens[0] || FDT_LOOKUP_CORE.cleanWord(rawText));
  const displayText = mode === 'word' ? cleanWord : rawText;
  return {
    mode,
    rawText: displayText,
    tokens: mode === 'word'
      ? (hasCjk ? [] : [cleanWord].filter(Boolean))
      : tokens,
    page: { title: '', url: '' },
    trigger: 'manual',
    language: settings.language || '',
    sources: Array.isArray(settings.sources) ? settings.sources : DEFAULTS.sources,
    timestamp: new Date().toISOString(),
  };
}

function readCompanionSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, data => {
      const fallback = currentContext ? contextToSettings(currentContext) : DEFAULTS;
      resolve({
        ...fallback,
        ...data,
      });
    });
  });
}

function syncManualSearchInput(context) {
  const input = document.getElementById('manualSearchInput');
  if (!input || document.activeElement === input) return;
  input.value = context?.rawText || '';
}

function drillLookup(word) {
  const clean = FDT_LOOKUP_CORE.cleanWord(word);
  if (!clean || FDT_LOOKUP_CORE.hasCjk(clean)) return;
  if (currentContext) companionHistory.push(currentContext);
  const context = {
    ...(currentContext || {}),
    mode: 'word',
    rawText: clean,
    tokens: [clean],
    trigger: 'drill',
    timestamp: new Date().toISOString(),
  };
  const state = normalizeCompanionState(companionState);
  persistCompanionState({
    activeMode: 'lookup',
    contexts: {
      ...state.contexts,
      lookup: context,
    },
  }, { resetHistory: false });
}

function goBack() {
  const previous = companionHistory.pop();
  if (!previous) return;
  const mode = modeForContext(previous);
  const state = normalizeCompanionState(companionState);
  persistCompanionState({
    activeMode: mode,
    contexts: {
      ...state.contexts,
      [mode]: previous,
    },
  }, { resetHistory: false });
}

function makeEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const title = document.createElement('strong');
  title.textContent = getActiveMode() === 'analysis' ? '尚無句子內容' : '尚無單詞內容';
  const body = document.createElement('span');
  body.textContent = '可從網頁選取文字，或使用上方輸入列。';
  empty.append(title, body);
  return empty;
}

function makeLoadingState(context) {
  const wrap = document.createElement('section');
  wrap.className = 'companion-card loading-card';
  const title = document.createElement('h2');
  title.textContent = context.rawText || '查詢中';
  const meta = document.createElement('p');
  meta.textContent = '查詢中...';
  wrap.append(title, meta);
  return wrap;
}

function contextToSettings(context) {
  return {
    language: context.language || DEFAULTS.language,
    sources: Array.isArray(context.sources) && context.sources.length > 0
      ? context.sources
      : DEFAULTS.sources,
  };
}

async function buildLookupView(context, settings) {
  const word = FDT_LOOKUP_CORE.cleanWord(context.rawText);
  const isZhLookup = FDT_LOOKUP_CORE.hasCjk(context.rawText || word);
  const wrap = document.createElement('div');
  wrap.className = 'companion-stack';
  const header = makeLookupHeader(context, word, { isZhLookup });
  wrap.appendChild(header);

  if (!word) {
    wrap.appendChild(makeNotice('沒有可查詢的文字'));
    return wrap;
  }

  const sections = isZhLookup
    ? await fetchZhSections(word || context.rawText, settings)
    : await fetchWordSections(word, settings);
  if (sections.length === 0) {
    wrap.appendChild(makeNotice('沒有結果'));
    return wrap;
  }

  currentHeaderSaveItems = isZhLookup ? getCurrentZhResultSaveItems() : null;
  currentHeaderSaveItem = isZhLookup
    ? buildHeaderSavedItem(word || context.rawText, true, currentHeaderSaveItems)
    : buildHeaderSavedItem(word || context.rawText, false);
  refreshHeaderSaveState(header);
  if (hasCurrentDirectAudio()) {
    header.querySelector('[data-companion-header-tts="true"]')?.remove();
  }
  if (!isZhLookup) updateLookupHeaderRoot(header, word || context.rawText);
  sections.forEach(section => wrap.appendChild(section));
  return wrap;
}

function makeLookupHeader(context, word, options = {}) {
  const card = document.createElement('section');
  card.className = 'lookup-head';
  const top = document.createElement('div');
  top.className = 'lookup-head-main';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'lookup-title-group';
  if (companionHistory.length > 0) titleGroup.appendChild(createInlineBackButton());
  const title = document.createElement('h2');
  title.textContent = context.rawText || word || '查詢';
  titleGroup.appendChild(title);
  titleGroup.appendChild(createHeaderRootChip());
  const tts = createCompanionTtsButton(context.rawText, context);
  if (tts) {
    tts.dataset.companionHeaderTts = 'true';
    titleGroup.appendChild(tts);
  }
  top.append(titleGroup, makeHeaderActions(context.rawText, context, {
    includeMt: false,
    batchSave: !!options.isZhLookup,
  }));
  card.appendChild(top);
  return card;
}

function createHeaderRootChip() {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'companion-root-chip';
  chip.hidden = true;
  chip.disabled = true;
  chip.title = '詞根';
  chip.setAttribute('aria-label', '詞根');
  const text = document.createElement('span');
  text.className = 'companion-root-text';
  chip.append(createCompanionRootIcon(), text);
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const root = chip.dataset.root || '';
    if (!root || chip.disabled) return;
    drillLookup(root);
  });
  return chip;
}

function createCompanionRootIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('companion-root-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M8 13V5.5M8 9.5C5.8 9.5 4.2 8.2 4 6.2c2.1-.2 3.7.7 4 2.4M8 8.4c2.3-.1 4-1.4 4.3-3.6C10 4.6 8.4 5.6 8 7.3');
  svg.appendChild(path);
  return svg;
}

function updateLookupHeaderRoot(header, query) {
  const chip = header.querySelector('.companion-root-chip');
  const text = chip?.querySelector('.companion-root-text');
  if (!chip || !text) return;
  const root = getCurrentDbRoot();
  const cleanRoot = FDT_LOOKUP_CORE.cleanMoeText(root);
  const cleanQuery = FDT_LOOKUP_CORE.cleanMoeText(query || currentContext?.rawText || '');
  const cleanMatched = FDT_LOOKUP_CORE.cleanMoeText(currentKilangLookupMeta?.matched || '');
  const isCurrentRoot = !!cleanRoot && cleanRoot.toLowerCase() === cleanQuery.toLowerCase();
  const isAltRoot = isPureAltRecovery(currentKilangLookupMeta?.recovery)
    && !!cleanMatched
    && cleanRoot.toLowerCase() === cleanMatched.toLowerCase()
    && cleanRoot.toLowerCase() !== cleanQuery.toLowerCase();
  const isRecoveredRoot = !!cleanRoot
    && !!cleanMatched
    && cleanRoot.toLowerCase() === cleanMatched.toLowerCase()
    && cleanRoot.toLowerCase() !== cleanQuery.toLowerCase();
  const iconOnly = isCurrentRoot;
  text.textContent = isRecoveredRoot ? `~ ${cleanRoot}` : cleanRoot;
  chip.dataset.root = cleanRoot;
  chip.hidden = !cleanRoot;
  chip.disabled = !cleanRoot || iconOnly;
  chip.classList.toggle('current', iconOnly);
  chip.classList.toggle('recovered', isRecoveredRoot || isAltRoot);
  chip.title = iconOnly ? '詞根' : (isRecoveredRoot ? '查詢修復後詞根' : '查詢詞根');
  chip.setAttribute('aria-label', chip.title);
}

function getCurrentDbRoot() {
  const item = currentExportItems.find(entry => entry.sourceId === 'KILANG' && entry.root);
  return item?.root || '';
}

async function fetchWordSections(word, settings) {
  const sources = getSources(settings);
  const sections = [];
  let dictFetched = false;

  for (const source of sources) {
    if (source === 'KILANG' && canUseKilang(settings, word)) {
      const kilang = await fetchKilangSection(word);
      if (kilang) sections.push(kilang);
    }

    if (!dictFetched && (source === 'EPARK' || source === 'ILRDF') && canUseDict(settings)) {
      const dict = await fetchDictSection(word, settings, source);
      if (dict) sections.push(dict);
      dictFetched = true;
    }
  }

  return sections;
}

async function fetchZhSections(word, settings) {
  const sources = getSources(settings);
  const tasks = [];

  if (canUseDict(settings)) {
    tasks.push((async () => {
      const response = await sendRuntimeMessage({ type: 'lookup', word, dialects: getDialects(settings) });
      return FDT_LOOKUP_CORE.normalizeDictZhEntries(response?.results);
    })());
  }

  if (canUseKilangZh(settings, word)) {
    tasks.push((async () => {
      const response = await sendRuntimeMessage({ type: 'moeZhLookup', word });
      return FDT_LOOKUP_CORE.normalizeMoeZhEntries(response?.insights?.rows);
    })());
  }

  const entries = FDT_LOOKUP_CORE.sortZhEntries(
    FDT_LOOKUP_CORE.dedupeZhEntries((await Promise.all(tasks)).flat()),
    sources
  );
  if (entries.length === 0) return [];

  const section = document.createElement('section');
  section.className = 'companion-card';
  let expandedExampleShown = false;
  entries.slice(0, 24).forEach(entry => {
    const shouldExpand = !expandedExampleShown && getZhRowExamples(entry).length > 0;
    if (shouldExpand) expandedExampleShown = true;
    section.appendChild(makeZhRow(entry, { expanded: shouldExpand }));
  });
  return [section];
}

async function fetchKilangSection(word) {
  const response = await sendRuntimeMessage({ type: 'moeCandidateInsights', word });
  const candidates = Array.isArray(response?.insights?.candidates)
    ? response.insights.candidates
    : [];
  const resolved = FDT_LOOKUP_CORE.normalizeMoeCandidateInsights(word, candidates);
  if (resolved.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'companion-card';

  resolved.forEach((candidate, index) => {
    if (index === 0) {
      currentKilangLookupMeta = {
        matched: candidate.matched,
        recovery: candidate.recovery,
      };
    }
    section.appendChild(makeKilangCandidateGroup(candidate));
  });
  return section;
}

function makeKilangCandidateGroup(candidate) {
  const group = document.createElement('div');
  group.className = 'candidate-group';
  group.dataset.candidateIndex = String(candidate.index);

  if (candidate.showHeader) {
    group.appendChild(makeKilangCandidateHeader(candidate));
  }

  if (candidate.chain) group.appendChild(makeChain(candidate.chain));
  if (!candidate.showHeader && !candidate.chain) {
    const relation = makeKilangRelationRow(candidate);
    if (relation) group.appendChild(relation);
  }

  candidate.senses.forEach((sense, senseIndex) => {
    group.appendChild(makeSenseBlock(sense, senseIndex + 1));
  });

  return group;
}

function makeKilangCandidateHeader(candidate) {
  const head = document.createElement('div');
  head.className = 'candidate-header';
  const icon = document.createElement('span');
  icon.className = 'candidate-icon';
  icon.textContent = candidate.icon;
  const label = makeDrillButton(
    candidate.matched,
    'candidate-title inline-drill'
  );
  head.append(icon, label);

  if (candidate.recoveryAffix) {
    const plus = document.createElement('span');
    plus.className = 'relation-plus';
    plus.textContent = '+';
    const pill = document.createElement('span');
    pill.className = 'relation-affix';
    pill.textContent = candidate.recoveryAffix;
    head.append(plus, pill);
  }

  if (candidate.inferred) {
    head.appendChild(createInferredHelp('fallback'));
  }
  return head;
}

function makeChain(chain) {
  const row = document.createElement('div');
  row.className = 'chain-row';
  row.appendChild(createChainIcon());
  chain.nodes.forEach((item, index) => {
    if (index > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'chain-arrow';
      arrow.textContent = '>';
      row.appendChild(arrow);
    }
    row.appendChild(makeDrillButton(item, 'chain-chip chain-button'));
  });
  if (chain.affix) {
    const plus = document.createElement('span');
    plus.className = 'relation-plus';
    plus.textContent = '+';
    const label = document.createElement('span');
    label.className = 'relation-affix';
    label.textContent = chain.affix;
    row.append(plus, label);
  }
  if (chain.inferred) row.appendChild(createInferredHelp('chain'));
  row.appendChild(createKilangTreeLogo());
  return row;
}

function createKilangTreeLogo() {
  const wrap = document.createElement('span');
  wrap.className = 'chain-tree-logo';
  wrap.title = 'Tree view';
  wrap.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('assets/kilang/Kilang_5_nobg_noring2.png');
  img.alt = '';
  img.width = 22;
  img.height = 22;
  wrap.appendChild(img);
  return wrap;
}

function createChainIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('chain-icon');
  const left = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  left.setAttribute('d', 'M6.6 4.3 5.5 3.2a2.6 2.6 0 0 0-3.7 3.7l1.4 1.4a2.6 2.6 0 0 0 3.7 0l.6-.6');
  const right = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  right.setAttribute('d', 'M9.4 11.7l1.1 1.1a2.6 2.6 0 0 0 3.7-3.7l-1.4-1.4a2.6 2.6 0 0 0-3.7 0l-.6.6');
  const mid = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  mid.setAttribute('d', 'M5.8 10.2 10.2 5.8');
  svg.append(left, right, mid);
  return svg;
}

function makeKilangRelationRow(candidate) {
  const exactAffix = candidate.fallbackFrom
    ? ''
    : FDT_LOOKUP_CORE.getMoeInferredAffixSummary(candidate.matched, candidate.primary);
  if (!candidate.fallbackFrom && !exactAffix) return null;

  const row = document.createElement('div');
  row.className = 'relation-row';
  const icon = document.createElement('span');
  icon.className = 'relation-icon';
  icon.textContent = candidate.icon;
  const base = makeDrillButton(candidate.matched, 'relation-base inline-drill');
  row.append(icon, base);

  const affix = candidate.recoveryAffix || exactAffix;
  if (affix) {
    const plus = document.createElement('span');
    plus.className = 'relation-plus';
    plus.textContent = '+';
    const label = document.createElement('span');
    label.className = 'relation-affix';
    label.textContent = affix;
    row.append(plus, label);
  }
  if (candidate.inferred) {
    row.appendChild(createInferredHelp('fallback'));
  }
  return row;
}

function createInferredHelp(kind) {
  const mark = document.createElement('span');
  mark.className = 'inferred-help';
  mark.tabIndex = 0;
  mark.textContent = '?';
  const selected = FDT_LOOKUP_CORE.cleanMoeText(currentContext?.rawText || '');
  const label = kind === 'chain' ? 'chain' : 'fallback';
  mark.title = selected
    ? `No exact entry for "${selected}" in our database. The displayed entry is in our database, but this ${label} relation was inferred by the extension from spelling or affix recovery.`
    : `The displayed entry is in our database, but this ${label} relation was inferred by the extension from spelling or affix recovery.`;
  mark.setAttribute('aria-label', mark.title);
  return mark;
}

function isPureAltRecovery(recovery) {
  return FDT_LOOKUP_CORE.isPureMoeAltRecovery(recovery);
}

function makeSenseBlock(sense, number) {
  const savedItem = registerExportItem(buildSavedMoeSense(sense));
  const block = document.createElement('article');
  block.className = 'sense-block';
  const head = document.createElement('div');
  head.className = 'sense-head';
  const def = document.createElement('h3');
  def.textContent = sense.definition || FDT_LOOKUP_CORE.cleanMoeText(sense.row?.word_ab) || `義項 ${number}`;
  head.append(def, createBookmarkRail(() => savedItem));
  block.appendChild(head);

  if (sense.examples.length > 0) {
    const examples = document.createElement('div');
    examples.className = 'examples';
    sense.examples.forEach(example => examples.appendChild(makeExample(example, savedItem)));
    block.appendChild(examples);
  }

  return block;
}

async function fetchDictSection(word, settings, source) {
  const dialects = getDialects(settings);
  const response = await sendRuntimeMessage({ type: 'lookup', word, dialects });
  const rows = FDT_LOOKUP_CORE.normalizeDictEntries(response?.results, word);
  if (rows.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'companion-card';
  section.appendChild(makeSectionTitle(source === 'ILRDF' ? 'ILRDF' : 'ePark', source));
  rows.slice(0, 20).forEach(row => section.appendChild(makeDictRow(row)));
  return section;
}

function makeDictRow(row) {
  const savedItem = registerExportItem(buildSavedDictRow(row));
  const item = document.createElement('article');
  item.className = 'dict-row';
  const main = document.createElement('div');
  main.className = 'dict-main';
  const primary = document.createElement('div');
  primary.className = 'inline-audio-line';
  const zh = document.createElement('strong');
  zh.textContent = row.displayText;
  const audio = createDirectAudioButton(row.audioUrl);
  primary.appendChild(zh);
  if (audio) primary.appendChild(audio);
  main.appendChild(primary);
  main.appendChild(createBookmarkRail(() => savedItem));
  item.appendChild(main);
  if (row.ab) {
    const ab = document.createElement('button');
    ab.type = 'button';
    ab.className = 'dict-ab dict-drill';
    ab.textContent = row.ab;
    ab.title = `查詢 ${row.ab}`;
    ab.addEventListener('click', () => drillLookup(row.ab));
    item.appendChild(ab);
  }
  return item;
}

function makeZhRow(row, options = {}) {
  const savedItem = registerExportItem(buildSavedZhRow(row));
  const item = document.createElement('article');
  item.className = 'dict-row zh-row';
  const main = document.createElement('div');
  main.className = 'dict-main';
  const ab = document.createElement('button');
  ab.type = 'button';
  ab.className = 'dict-ab dict-drill';
  ab.textContent = row.displayText || row.ab || '';
  ab.title = `查詢 ${ab.textContent}`;
  ab.addEventListener('click', () => drillLookup(ab.textContent));
  const primary = document.createElement('div');
  primary.className = 'inline-audio-line';
  const audio = createDirectAudioButton(row.audioUrl);
  primary.appendChild(ab);
  if (audio) primary.appendChild(audio);
  main.appendChild(primary);
  main.appendChild(createBookmarkRail(() => savedItem));
  item.appendChild(main);

  if (row.secondaryText) {
    const zh = document.createElement('div');
    zh.className = 'example-zh';
    zh.textContent = row.secondaryText;
    item.appendChild(zh);
  }
  const examples = getZhRowExamples(row);
  if (examples.length > 0) {
    item.classList.add('has-examples');
    item.appendChild(createZhRowChevron(item, examples, savedItem));
    if (options.expanded) expandZhRowExamples(item, examples, savedItem);
  }
  return item;
}

function getZhRowExamples(row) {
  return Array.isArray(row?.examples) ? row.examples.filter(example => example?.ab || example?.zh) : [];
}

function createZhRowChevron(item, examples, savedItem) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'row-chevron';
  btn.title = '顯示例句';
  btn.setAttribute('aria-label', '顯示例句');
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = '⌄';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (item.classList.contains('expanded')) collapseZhRowExamples(item);
    else expandZhRowExamples(item, examples, savedItem);
  });
  return btn;
}

function expandZhRowExamples(item, examples, savedItem) {
  item.classList.add('expanded');
  const chevron = item.querySelector('.row-chevron');
  if (chevron) {
    chevron.setAttribute('aria-expanded', 'true');
    chevron.textContent = '⌃';
  }
  item.querySelector('.zh-row-examples')?.remove();
  const panel = document.createElement('div');
  panel.className = 'examples zh-row-examples';
  examples.forEach(example => panel.appendChild(makeExample(example, savedItem)));
  item.appendChild(panel);
}

function collapseZhRowExamples(item) {
  item.classList.remove('expanded');
  const chevron = item.querySelector('.row-chevron');
  if (chevron) {
    chevron.setAttribute('aria-expanded', 'false');
    chevron.textContent = '⌄';
  }
  item.querySelector('.zh-row-examples')?.remove();
}

async function buildAnalysisView(context, settings) {
  const parsedTokens = FDT_LOOKUP_CORE.getPhraseTokens(context.rawText || '', MAX_ANALYSIS_TOKENS);
  const tokens = parsedTokens.length > 0
    ? parsedTokens
    : (Array.isArray(context.tokens) ? context.tokens.slice(0, MAX_ANALYSIS_TOKENS) : []);
  const uniqueTokens = [...new Set(tokens.filter(token => token.length > 2))].slice(0, MAX_ANALYSIS_TOKENS);

  const wrap = document.createElement('div');
  wrap.className = 'companion-stack';
  wrap.appendChild(makeAnalysisHeader(context, tokens, uniqueTokens.length));

  if (tokens.length === 0) {
    wrap.appendChild(makeNotice('沒有可分析的族語 token'));
    return wrap;
  }

  const lookedUp = await mapWithConcurrency(uniqueTokens, LOOKUP_CONCURRENCY, token => lookupAnalysisToken(token, settings));
  const byToken = new Map(lookedUp.map(result => [result.token, result]));
  const rawRows = tokens.map(token => byToken.get(token) || {
    token,
    displayToken: token,
    glosses: token.length <= 2 ? [token] : [],
    root: '',
    sourceId: '',
  });
  const rows = annotateReaderRows(rawRows, await fdtGetSavedItems());
  wrap.appendChild(makeReaderView(context.rawText || '', rows));
  wrap.appendChild(makeReaderWordTable(rows));
  return wrap;
}

function annotateReaderRows(rows, savedItems) {
  const savedWords = makeSavedWordSet(savedItems);
  return rows.map(row => {
    const status = getReaderTokenStatus(row, savedWords);
    return {
      ...row,
      status,
      statusList: Object.entries(status)
        .filter(([, value]) => value)
        .map(([key]) => key),
    };
  });
}

function makeSavedWordSet(savedItems) {
  const activeLanguage = currentContext?.language || '';
  const words = new Set();
  (Array.isArray(savedItems) ? savedItems : []).forEach(item => {
    if (activeLanguage && item.language && item.language !== activeLanguage) return;
    [
      item.ab,
      item.matchedWord,
      item.root,
    ].forEach(value => {
      const clean = getReaderStatusKey(value);
      if (clean) words.add(clean);
    });
  });
  return words;
}

function getReaderTokenStatus(row, savedWords) {
  const tokenKey = getReaderStatusKey(row?.token);
  const matchKey = getReaderStatusKey(getReaderMatchedWord(row));
  const rootKey = getReaderStatusKey(row?.root);
  const operations = Array.isArray(row?.recoveryOperations) ? row.recoveryOperations : [];
  const recovered = !!row?.sourceId && (
    !!row?.fallbackFrom
    || !!row?.recoveryAffix
    || operations.includes('glottal')
    || (!!matchKey && !!tokenKey && matchKey !== tokenKey)
  );
  const alt = !!row?.sourceId && operations.includes('alt') && !row?.recoveryAffix;
  const saved = [tokenKey, matchKey, rootKey].some(key => key && savedWords.has(key));

  return {
    found: !!row?.sourceId,
    unknown: !row?.sourceId,
    recovered,
    fallback: recovered && !alt,
    alt,
    saved,
  };
}

function getReaderMatchedWord(row) {
  return row?.displayToken || row?.matchedWord || row?.token || '';
}

function getReaderStatusKey(value) {
  return FDT_LOOKUP_CORE.cleanWord(value || '').toLowerCase();
}

function makeAnalysisHeader(context, tokens, lookupCount) {
  const card = document.createElement('section');
  card.className = 'lookup-head';
  const top = document.createElement('div');
  top.className = 'lookup-head-main';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'lookup-title-group';
  if (companionHistory.length > 0) titleGroup.appendChild(createInlineBackButton());
  const title = document.createElement('h2');
  title.textContent = context.rawText || '分析';
  titleGroup.appendChild(title);
  const tts = createCompanionTtsButton(context.rawText, context);
  if (tts) {
    tts.dataset.companionHeaderTts = 'true';
    titleGroup.appendChild(tts);
  }
  top.append(titleGroup, makeHeaderActions(context.rawText, context, { includeMt: true }));
  card.appendChild(top);
  return card;
}

function createInlineBackButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'inline-back-button';
  btn.title = '返回';
  btn.setAttribute('aria-label', '返回');
  btn.textContent = '←';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    goBack();
  });
  return btn;
}

function makeReaderView(rawText, rows) {
  const section = document.createElement('section');
  section.className = 'companion-reader companion-card';
  const resultMap = new Map();
  rows.forEach(row => {
    if (!resultMap.has(row.token)) resultMap.set(row.token, row);
  });

  const segments = getReaderSegments(rawText);
  if (segments.length === 0) {
    section.appendChild(makeNotice('沒有可閱讀的句子'));
    return section;
  }

  segments.forEach(segment => section.appendChild(makeReaderSentence(segment, resultMap)));
  applyReaderControls(section);
  return section;
}

function getReaderSegments(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return [];
  return text
    .split(/(?<=[.!?。！？])\s+|[\r\n]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map((text, index) => ({ text, index, parts: getReaderParts(text) }));
}

function getReaderParts(text) {
  const tokenPattern = /[\p{L}\p{M}\d'^’ʼ:.-]+/gu;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = tokenPattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'token', text: match[0], token: FDT_LOOKUP_CORE.cleanWord(match[0]) });
    lastIndex = tokenPattern.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', text: text.slice(lastIndex) });
  return parts;
}

function makeReaderSentence(segment, resultMap) {
  const block = document.createElement('article');
  block.className = 'reader-sentence';
  const line = document.createElement('div');
  line.className = 'reader-line';
  segment.parts.forEach(part => {
    if (part.type === 'token') line.appendChild(makeReaderToken(part, resultMap.get(part.token)));
    else appendReaderText(line, part.text);
  });

  block.appendChild(line);
  return block;
}

function appendReaderText(parent, text) {
  String(text || '').split(/([,.;:，。；：])/).forEach(part => {
    if (!part) return;
    parent.appendChild(document.createTextNode(part));
    if (/^[,.;:，。；：]$/.test(part)) parent.appendChild(document.createElement('br'));
  });
}

function makeReaderToken(part, result) {
  const item = document.createElement('span');
  applyReaderStatusAttributes(item, result, 'reader-token');
  const top = document.createElement('span');
  top.className = 'reader-token-top';
  top.textContent = getReaderTopAnnotation(part, result);

  const ab = makeDrillButton(part.text, 'reader-token-ab inline-drill');
  const zh = document.createElement('span');
  zh.className = 'reader-token-zh';
  zh.textContent = getReaderGloss(result);
  item.append(top, ab, zh);
  return item;
}

function makeReaderWordTable(rows) {
  const section = document.createElement('section');
  section.className = 'reader-word-table-section companion-card';
  const table = document.createElement('table');
  table.className = 'reader-word-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['ab', 'furigana', 'gloss'].forEach((label, index) => {
    const th = document.createElement('th');
    th.textContent = label;
    th.className = getReaderWordTableColumnClass(index);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  rows.forEach(row => tbody.appendChild(makeReaderWordTableRow(row)));
  table.append(thead, tbody);
  section.appendChild(table);
  applyReaderControls(section);
  return section;
}

function makeReaderWordTableRow(row) {
  const tr = document.createElement('tr');
  applyReaderStatusAttributes(tr, row, 'reader-word-table-row');
  const abCell = document.createElement('td');
  abCell.className = 'reader-word-table-ab-col';
  abCell.appendChild(makeDrillButton(row.token, 'reader-word-table-ab inline-drill'));

  const furiganaCell = document.createElement('td');
  furiganaCell.className = 'reader-word-table-furigana-col';
  furiganaCell.textContent = getReaderTopAnnotation({ text: row.token, token: row.token }, row);

  const glossCell = document.createElement('td');
  glossCell.className = 'reader-word-table-gloss-col';
  glossCell.textContent = getReaderGloss(row);
  glossCell.title = glossCell.textContent;

  tr.append(abCell, furiganaCell, glossCell);
  return tr;
}

function applyReaderStatusAttributes(element, row, baseClass) {
  const status = row?.status || getReaderTokenStatus(row, new Set());
  const statusList = row?.statusList || Object.entries(status)
    .filter(([, value]) => value)
    .map(([key]) => key);
  element.className = [
    baseClass,
    status.found ? 'found' : 'missing',
    ...statusList.map(statusName => `status-${statusName}`),
  ].join(' ');
  element.dataset.token = row?.token || '';
  element.dataset.match = getReaderMatchedWord(row);
  element.dataset.root = row?.root || '';
  element.dataset.status = statusList.join(' ');
}

function getReaderWordTableColumnClass(index) {
  if (index === 0) return 'reader-word-table-ab-col';
  if (index === 1) return 'reader-word-table-furigana-col';
  return 'reader-word-table-gloss-col';
}

function getReaderGloss(result) {
  return result?.glosses?.length ? result.glosses.join(' / ') : 'x';
}

function getReaderTopAnnotation(part, result) {
  if (!result) return '';
  const display = FDT_LOOKUP_CORE.cleanWord(result.displayToken || '');
  if (display && display !== part.token) return `~ ${result.displayToken}`;
  if (result.root && result.root !== part.token) return result.root;
  return '';
}

function makeDrillButton(word, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = word;
  button.title = `查詢 ${word}`;
  button.addEventListener('click', () => drillLookup(word));
  return button;
}

function makeHeaderActions(text, context, options = {}) {
  const group = document.createElement('div');
  group.className = 'lookup-head-actions';
  const saveBtn = options.batchSave
    ? createCompanionBatchSaveButton(() => getHeaderSavedItems())
    : createCompanionSaveButton(() => getHeaderSavedItem());
  const mt = options.includeMt ? createCompanionMtButton(text, context) : null;
  if (mt) group.appendChild(mt);
  group.appendChild(saveBtn);
  return group;
}

function hasCurrentDirectAudio() {
  return currentExportItems.some(item => !!item.audioUrl);
}

function getHeaderSavedItem() {
  return currentHeaderSaveItem || fdtNormalizeSavedItem({
    ...getCompanionSaveContext(),
    type: 'word',
    matchedWord: currentContext?.rawText || '',
    ab: FDT_LOOKUP_CORE.hasCjk(currentContext?.rawText || '') ? '' : currentContext?.rawText || '',
    zh: FDT_LOOKUP_CORE.hasCjk(currentContext?.rawText || '') ? currentContext?.rawText || '' : '',
  });
}

function getHeaderSavedItems() {
  return Array.isArray(currentHeaderSaveItems) && currentHeaderSaveItems.length > 0
    ? currentHeaderSaveItems
    : [getHeaderSavedItem()];
}

function refreshHeaderSaveState(header) {
  header.querySelector('.companion-save-button')?._refreshSavedState?.();
}

function buildHeaderSavedItem(query, isZhLookup = false, sourceItems = null) {
  const items = (Array.isArray(sourceItems) ? sourceItems : currentExportItems)
    .filter(item => item.ab || item.matchedWord || item.zh || item.examples?.length);
  if (items.length === 0) return getHeaderSavedItem();

  const first = items[0] || {};
  const cleanQuery = FDT_LOOKUP_CORE.cleanMoeText(query || currentContext?.rawText || '');
  const ab = isZhLookup
    ? uniqueSavedTexts(items.map(item => item.ab || item.matchedWord))[0] || ''
    : first.matchedWord || first.ab || cleanQuery;
  const zh = isZhLookup
    ? FDT_LOOKUP_CORE.cleanMoeText(currentContext?.rawText || cleanQuery)
    : uniqueSavedTexts(items.map(item => item.zh)).join('；');

  return fdtNormalizeSavedItem({
    ...getCompanionSaveContext(),
    type: 'word',
    matchedWord: ab || cleanQuery,
    ab,
    zh,
    sourceId: uniqueSavedTexts(items.map(item => item.sourceId)).join('+'),
    sourceMeta: uniqueSavedTexts(items.map(item => item.sourceMeta)).join(' / '),
    dialect: uniqueSavedTexts(items.map(item => item.dialect))[0] || '',
    root: uniqueSavedTexts(items.map(item => item.root))[0] || '',
    affixes: uniqueSavedTexts(items.flatMap(item => item.affixes || [])),
    examples: dedupeSavedExamples(items.flatMap(item => item.examples || [])).slice(0, 6),
    audioUrl: uniqueSavedTexts(items.map(item => item.audioUrl))[0] || '',
  });
}

function getCurrentZhResultSaveItems() {
  return currentExportItems
    .filter(item => item.type === 'word' && item.ab && item.zh)
    .map(item => fdtNormalizeSavedItem({
      ...item,
      headword: currentContext?.rawText || item.headword || '',
    }));
}

function uniqueSavedTexts(values) {
  const seen = new Set();
  const out = [];
  values.forEach(value => {
    const clean = FDT_LOOKUP_CORE.cleanMoeText(value || '');
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function dedupeSavedExamples(examples) {
  const seen = new Set();
  return examples.filter(example => {
    const ab = FDT_LOOKUP_CORE.cleanMoeText(example?.ab || '');
    const zh = FDT_LOOKUP_CORE.cleanMoeText(example?.zh || '');
    const key = `${ab}\n${zh}`.toLowerCase();
    if ((!ab && !zh) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createCompanionSaveButton(getItem) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'companion-icon-button companion-save-button';
  const setState = saved => {
    btn.classList.toggle('saved', saved);
    btn.title = saved ? '移除儲存' : '儲存';
    btn.setAttribute('aria-label', saved ? '移除儲存' : '儲存');
    btn.replaceChildren(createBookmarkIcon(saved));
  };
  setState(false);

  const readItem = () => fdtNormalizeSavedItem(getItem());
  btn._refreshSavedState = async () => {
    try {
      const item = readItem();
      const saved = await fdtFindSavedItemKey(item.key);
      if (btn.isConnected) setState(!!saved);
      btn.disabled = false;
    } catch {
      btn.disabled = true;
    }
  };
  btn._refreshSavedState();

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const result = await fdtToggleSavedItem(readItem());
      setState(result.saved);
    } catch {
      btn.classList.add('error');
      clearTimeout(btn._errorTimer);
      btn._errorTimer = setTimeout(() => btn.classList.remove('error'), 900);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

function createCompanionBatchSaveButton(getItems) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'companion-icon-button companion-save-button';
  const setState = saved => {
    btn.classList.toggle('saved', saved);
    btn.title = saved ? '移除儲存' : '儲存全部結果';
    btn.setAttribute('aria-label', saved ? '移除儲存' : '儲存全部結果');
    btn.replaceChildren(createBookmarkIcon(saved));
  };
  setState(false);

  const readItems = () => uniqueSavedItems((getItems() || []).map(item => fdtNormalizeSavedItem(item)));
  btn._refreshSavedState = async () => {
    try {
      const items = readItems();
      const savedItems = await fdtGetSavedItems();
      const savedKeys = new Set(savedItems.map(item => item.key));
      const allSaved = items.length > 0 && items.every(item => savedKeys.has(item.key));
      if (btn.isConnected) setState(allSaved);
      btn.disabled = items.length === 0;
    } catch {
      btn.disabled = true;
    }
  };
  btn._refreshSavedState();

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const items = readItems();
      if (items.length === 0) return;
      const savedItems = await fdtGetSavedItems();
      const savedKeys = new Set(savedItems.map(item => item.key));
      const allSaved = items.every(item => savedKeys.has(item.key));
      if (allSaved) {
        const removeKeys = new Set(items.map(item => item.key));
        await fdtSetSavedItems(savedItems.filter(item => !removeKeys.has(item.key)));
        setState(false);
      } else {
        const missing = items.filter(item => !savedKeys.has(item.key));
        if (missing.length > 1 && !confirm(`this will save ${missing.length} results`)) return;
        await fdtSetSavedItems([...missing, ...savedItems]);
        setState(true);
      }
      refreshCompanionSaveButtons();
    } catch {
      btn.classList.add('error');
      clearTimeout(btn._errorTimer);
      btn._errorTimer = setTimeout(() => btn.classList.remove('error'), 900);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

function uniqueSavedItems(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item.key || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function refreshCompanionSaveButtons() {
  document.querySelectorAll('.companion-save-button').forEach(btn => {
    btn._refreshSavedState?.();
  });
}

function createBookmarkRail(getItem) {
  const rail = document.createElement('div');
  rail.className = 'bookmark-rail';
  rail.appendChild(createCompanionSaveButton(getItem));
  return rail;
}

function createBookmarkIcon(saved = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('companion-save-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4.5 2.5h7v11L8 11.2l-3.5 2.3z');
  if (saved) path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function registerExportItem(item) {
  const normalized = fdtNormalizeSavedItem(item);
  if (!normalized.ab && !normalized.zh && normalized.examples.length === 0) return normalized;
  if (!currentExportItems.some(existing => existing.key === normalized.key)) {
    currentExportItems.push(normalized);
  }
  return normalized;
}

function getCompanionSaveContext() {
  return {
    language: currentContext?.language || '',
    headword: currentContext?.rawText || '',
    pageUrl: currentContext?.page?.url || '',
    pageTitle: currentContext?.page?.title || '',
  };
}

function cleanExportText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function getIndiHuntLanguageCode(language) {
  return INDIHUNT_LANG_CODE[language] || '';
}

function cleanIndiHuntItem(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== '';
    })
  );
}

function formatIndiHuntTags(item) {
  return [item.sourceId].map(cleanExportText).filter(Boolean);
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

function formatIndiHuntAnalysisItems(context) {
  if (!context || context.mode === 'word') return [];
  const language = getIndiHuntLanguageCode(context.language);
  if (!language) return [];

  const segments = getReaderSegments(context.rawText || '');
  const texts = segments.length > 0
    ? segments.map(segment => segment.text)
    : [context.rawText || ''];

  return texts
    .map(text => cleanExportText(text))
    .filter(Boolean)
    .map(ab => cleanIndiHuntItem({
      ab,
      type: 'sentence',
      language,
      notes: formatIndiHuntContextNotes(context),
      tags: ['COMPANION'],
    }));
}

function formatIndiHuntContextNotes(context) {
  const notes = [];
  if (context?.page?.title) notes.push(`Page: ${cleanExportText(context.page.title)}`);
  if (context?.page?.url) notes.push(cleanExportText(context.page.url));
  return notes.join(' · ');
}

function encodeIndiHuntPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function exportCompanionToIndiHunt() {
  const items = (currentContext?.mode === 'word'
    ? currentExportItems.flatMap(formatIndiHuntItems)
    : formatIndiHuntAnalysisItems(currentContext)
  ).slice(0, INDIHUNT_MAX_ITEMS);
  if (items.length === 0) return;
  const b64 = encodeIndiHuntPayload({
    version: 1,
    source: 'ycm-popupdict',
    exportedAt: new Date().toISOString(),
    items,
  });
  chrome.runtime.sendMessage({ type: 'openSavedPage', url: `${INDIHUNT_IMPORT_URL}#v1:${b64}` });
}

async function lookupAnalysisToken(token, settings) {
  const sources = getSources(settings);
  let dictTried = false;
  for (const source of sources) {
    if (source === 'KILANG' && canUseKilang(settings, token)) {
      const result = await lookupAnalysisKilangToken(token);
      if (result) return result;
    }

    if (!dictTried && (source === 'EPARK' || source === 'ILRDF') && canUseDict(settings)) {
      const result = await lookupAnalysisDictToken(token, settings);
      dictTried = true;
      if (result) return result;
    }
  }

  return { token, displayToken: token, glosses: [], root: '', sourceId: '' };
}

async function lookupAnalysisKilangToken(token) {
  const response = await sendRuntimeMessage({ type: 'moeInsights', word: token });
  const insights = response?.insights;
  const rows = Array.isArray(insights?.rows) ? insights.rows : [];
  if (rows.length === 0) return null;

  const senses = FDT_LOOKUP_CORE.getMoeSenseRows(rows);
  const glosses = FDT_LOOKUP_CORE.getPhraseGlossesFromTexts(
    senses.map(sense => sense.definition),
    { limit: 2, maxPerText: 1 }
  );
  const row = senses[0]?.row || FDT_LOOKUP_CORE.getMoePrimaryRow(rows) || {};
  const recovery = insights?.recovery || null;
  return {
    token,
    displayToken: FDT_LOOKUP_CORE.cleanMoeText(insights.match || row.word_ab || token),
    glosses,
    root: FDT_LOOKUP_CORE.cleanMoeText(row.ultimate_root || row.stem || ''),
    fallbackFrom: FDT_LOOKUP_CORE.cleanMoeText(insights?.fallbackFrom || ''),
    recoveryAffix: FDT_LOOKUP_CORE.getMoeRecoveryAffixSummary(recovery),
    recoveryOperations: FDT_LOOKUP_CORE.getMoeRecoveryOperations(recovery),
    sourceId: 'KILANG',
  };
}

async function lookupAnalysisDictToken(token, settings) {
  const response = await sendRuntimeMessage({ type: 'lookup', word: token, dialects: getDialects(settings) });
  const rows = FDT_LOOKUP_CORE.normalizeDictEntries(response?.results, token);
  if (rows.length === 0) return null;

  const glosses = FDT_LOOKUP_CORE.getPhraseGlossesFromTexts(rows.map(row => row.displayText), { limit: 2 });
  return {
    token,
    displayToken: token,
    glosses,
    root: '',
    sourceId: 'EPARK',
  };
}

function makeSectionTitle(titleText, source) {
  const head = document.createElement('div');
  head.className = 'section-title';
  const title = document.createElement('h2');
  title.textContent = titleText;
  head.appendChild(title);
  return head;
}

function makeExample(example, parentItem = null) {
  const savedItem = fdtNormalizeSavedItem(buildSavedExample(example, parentItem));
  const row = document.createElement('div');
  row.className = 'example-row';
  const top = document.createElement('div');
  top.className = 'example-ab-line';
  const ab = document.createElement('div');
  ab.className = 'example-ab inline-audio-line';
  appendDrillableAbText(ab, example.ab || '');
  const tts = example.audioUrl ? null : createCompanionTtsButton(example.ab || '', currentContext);
  const audio = createDirectAudioButton(example.audioUrl);
  if (audio) ab.appendChild(audio);
  if (tts) ab.appendChild(tts);
  top.appendChild(ab);
  top.appendChild(createBookmarkRail(() => savedItem));
  const zh = document.createElement('div');
  zh.className = 'example-zh';
  zh.textContent = example.zh || '';
  row.append(top, zh);
  return row;
}

function buildSavedExample(example, parentItem = null) {
  return {
    ...getCompanionSaveContext(),
    type: 'example',
    ab: example.ab,
    zh: example.zh,
    sourceId: example.sourceId || parentItem?.sourceId || '',
    sourceMeta: example.source || parentItem?.sourceMeta || '',
    dialect: parentItem?.dialect || '',
    root: parentItem?.root || '',
    audioUrl: example.audioUrl || '',
  };
}

function buildSavedMoeSense(sense) {
  const row = sense?.row || {};
  return {
    ...getCompanionSaveContext(),
    type: 'sense',
    matchedWord: FDT_LOOKUP_CORE.cleanMoeText(row.word_ab || currentContext?.rawText || ''),
    ab: FDT_LOOKUP_CORE.cleanMoeText(row.word_ab || currentContext?.rawText || ''),
    zh: FDT_LOOKUP_CORE.cleanMoeDefinition(sense?.definition || row.definition || ''),
    sourceId: 'KILANG',
    sourceMeta: FDT_LOOKUP_CORE.getMoeSourceMeta(row),
    root: FDT_LOOKUP_CORE.cleanMoeText(row.ultimate_root || row.stem || ''),
    examples: sense?.examples || [],
    audioUrl: sense?.audioUrl || FDT_LOOKUP_CORE.getAudioUrl(row),
  };
}

function buildSavedDictRow(row) {
  return {
    ...getCompanionSaveContext(),
    type: 'word',
    matchedWord: row.ab || currentContext?.rawText || '',
    ab: row.ab || currentContext?.rawText || '',
    zh: row.displayText || row.zh || '',
    sourceId: row.sourceId || 'EPARK',
    sourceMeta: row.metaLabel || '',
    dialect: row.dialect || '',
    audioUrl: row.audioUrl || '',
  };
}

function buildSavedZhRow(row) {
  return {
    ...getCompanionSaveContext(),
    type: 'word',
    matchedWord: row.displayText || row.ab || '',
    ab: row.displayText || row.ab || '',
    zh: row.secondaryText || row.zh || '',
    sourceId: row.sourceId || 'EPARK',
    sourceMeta: row.metaLabel || '',
    dialect: row.dialect || '',
    root: row.root || '',
    examples: row.examples || [],
    audioUrl: row.audioUrl || '',
  };
}

function appendDrillableAbText(parent, text) {
  const raw = String(text || '');
  if (!raw) return;

  const parts = raw.split(/([\p{L}\p{M}\d'^’ʼ:.-]+)/gu);
  parts.forEach(part => {
    if (!part) return;
    const word = FDT_LOOKUP_CORE.cleanWord(part);
    if (!isDrillableWord(word)) {
      parent.appendChild(document.createTextNode(part));
      return;
    }

    parent.appendChild(makeDrillButton(part, 'inline-drill'));
  });
}

function isDrillableWord(word) {
  return !!word && word.length > 2 && !FDT_LOOKUP_CORE.hasCjk(word);
}

function createCompanionTtsButton(text, context = currentContext) {
  const clean = FDT_LOOKUP_CORE.cleanPhraseText(text);
  if (!clean || FDT_LOOKUP_CORE.hasCjk(clean) || context?.language !== 'Amis') return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'companion-tts-button';
  btn.title = 'TTS';
  btn.setAttribute('aria-label', 'TTS');
  btn.textContent = '🔊';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await playCompanionTts(clean, btn);
  });
  return btn;
}

function createDirectAudioButton(url) {
  const clean = typeof url === 'string' && /^https?:\/\//.test(url) ? url : '';
  if (!clean) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'companion-icon-button companion-audio-button';
  btn.title = '播放發音';
  btn.setAttribute('aria-label', '播放發音');
  btn.textContent = '▶';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    btn.classList.add('loading');
    btn.classList.remove('error');
    try {
      const response = await sendRuntimeMessage({ type: 'playOffscreenAudio', url: clean });
      if (!response?.ok) btn.classList.add('error');
    } catch {
      btn.classList.add('error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
  return btn;
}

function createCompanionMtButton(text, context = currentContext) {
  const clean = FDT_LOOKUP_CORE.cleanPhraseText(text);
  if (!clean || FDT_LOOKUP_CORE.hasCjk(clean) || context?.language !== 'Amis') return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'companion-ai-button';
  btn.title = 'AI 翻譯';
  btn.setAttribute('aria-label', 'AI 翻譯');
  btn.textContent = '✦';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await translateCompanionText(clean, btn);
  });
  return btn;
}

async function playCompanionTts(text, btn) {
  if (!text || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.classList.remove('error');
  try {
    const response = await sendRuntimeMessage({ type: 'playIlrdfTts', text });
    if (!response?.ok) btn.classList.add('error');
  } catch {
    btn.classList.add('error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

async function translateCompanionText(text, btn) {
  if (!text || btn.disabled) return;
  const target = btn.closest('.lookup-head') || btn.closest('.reader-sentence');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.classList.remove('error');
  renderCompanionMt(target, 'AI 翻譯中...');
  try {
    const response = await sendRuntimeMessage({ type: 'translateIlrdfText', text });
    if (response?.ok) renderCompanionMt(target, response.text);
    else {
      btn.classList.add('error');
      renderCompanionMt(target, 'AI 翻譯失敗');
    }
  } catch {
    btn.classList.add('error');
    renderCompanionMt(target, 'AI 翻譯服務暫時無法使用');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

function renderCompanionMt(target, text) {
  if (!target) return;
  let row = target.querySelector('.companion-mt-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'companion-mt-row';
    target.appendChild(row);
  }
  row.textContent = FDT_LOOKUP_CORE.cleanDisplayText(text) || '—';
}

function makeNotice(text) {
  const notice = document.createElement('section');
  notice.className = 'companion-card notice';
  notice.textContent = text;
  return notice;
}

function makeMetaText(text) {
  const span = document.createElement('span');
  span.textContent = text || '';
  return span;
}

function getSources(settings) {
  return Array.isArray(settings.sources) && settings.sources.length > 0
    ? settings.sources
    : DEFAULTS.sources;
}

function canUseKilang(settings, word) {
  return settings.language === 'Amis'
    && getSources(settings).includes('KILANG')
    && !FDT_LOOKUP_CORE.hasCjk(word);
}

function canUseKilangZh(settings, word) {
  return settings.language === 'Amis'
    && getSources(settings).includes('KILANG')
    && FDT_LOOKUP_CORE.hasCjk(word);
}

function canUseDict(settings) {
  const sources = getSources(settings);
  return sources.includes('EPARK') || sources.includes('ILRDF');
}

function getDialects(settings) {
  return settings.language && LANG_TO_DIALECTS[settings.language]
    ? LANG_TO_DIALECTS[settings.language]
    : '';
}

function sendRuntimeMessage(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
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

function getModeLabel(mode) {
  if (mode === 'word') return '查詢';
  if (mode === 'sentences') return '多句分析';
  return '分析';
}

function getTriggerLabel(trigger) {
  if (trigger === 'doubleClick') return '雙擊';
  if (trigger === 'ctrlSelect') return 'Ctrl 選取';
  return trigger || '選取';
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}
