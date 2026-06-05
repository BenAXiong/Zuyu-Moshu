const CONTEXT_KEY = 'companionContext';
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
let currentContext = null;
let companionHistory = [];
let currentExportItems = [];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('clear')?.addEventListener('click', clearContext);
  document.getElementById('back')?.addEventListener('click', goBack);
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => setActiveMode(tab.dataset.mode));
  });

  loadContext();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[CONTEXT_KEY]) return;
    renderContext(changes[CONTEXT_KEY].newValue || null, { resetHistory: true });
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'companionContextUpdated') loadContext();
  });
});

function loadContext() {
  chrome.storage.session.get({ [CONTEXT_KEY]: null }, data => {
    renderContext(data[CONTEXT_KEY], { resetHistory: true });
  });
}

function clearContext() {
  companionHistory = [];
  updateBackButton();
  chrome.storage.session.remove(CONTEXT_KEY, () => renderContext(null));
}

function setActiveMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
}

async function renderContext(context, options = {}) {
  if (options.resetHistory) companionHistory = [];
  updateBackButton();
  currentContext = context;
  const serial = ++renderSerial;
  const content = document.getElementById('content');
  if (!content) return;

  if (!context) {
    content.className = 'content empty';
    content.replaceChildren(makeEmptyState());
    return;
  }

  const mode = context.mode === 'word' ? 'lookup' : 'analysis';
  setActiveMode(mode);
  content.className = 'content';
  content.replaceChildren(makeLoadingState(context));
  currentExportItems = [];

  const settings = contextToSettings(context);
  const view = context.mode === 'word'
    ? await buildLookupView(context, settings)
    : await buildAnalysisView(context, settings);
  if (serial !== renderSerial || currentContext !== context) return;
  content.replaceChildren(view);
}

function drillLookup(word) {
  const clean = FDT_LOOKUP_CORE.cleanWord(word);
  if (!clean || FDT_LOOKUP_CORE.hasCjk(clean)) return;
  if (currentContext) companionHistory.push(currentContext);
  renderContext({
    ...(currentContext || {}),
    mode: 'word',
    rawText: clean,
    tokens: [clean],
    trigger: 'drill',
    timestamp: new Date().toISOString(),
  }, { resetHistory: false });
}

function goBack() {
  const previous = companionHistory.pop();
  updateBackButton();
  if (previous) renderContext(previous, { resetHistory: false });
}

function updateBackButton() {
  const back = document.getElementById('back');
  if (!back) return;
  back.hidden = companionHistory.length === 0;
}

function makeEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const title = document.createElement('strong');
  title.textContent = '選取文字開始';
  const body = document.createElement('span');
  body.textContent = '將查詢顯示切換到 Companion 後，雙擊或 Ctrl+選取文字會在這裡顯示。';
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
  wrap.appendChild(makeLookupHeader(context, word));

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

  sections.forEach(section => wrap.appendChild(section));
  return wrap;
}

function makeLookupHeader(context, word) {
  const card = document.createElement('section');
  card.className = 'lookup-head';
  const top = document.createElement('div');
  top.className = 'lookup-head-main';
  const title = document.createElement('h2');
  title.textContent = context.rawText || word || '查詢';
  top.append(title, makeHeaderActions(context.rawText, context));
  card.append(top, makeContextDetails(context, [
    ['語言', context.language || ''],
    ['觸發', getTriggerLabel(context.trigger)],
    ['頁面', context.page?.title || ''],
    ['網址', context.page?.url || ''],
    ['時間', formatTimestamp(context.timestamp)],
  ]));
  return card;
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
  entries.slice(0, 24).forEach(entry => section.appendChild(makeZhRow(entry)));
  return [section];
}

async function fetchKilangSection(word) {
  const response = await sendRuntimeMessage({ type: 'moeInsights', word });
  const insights = response?.insights;
  const rows = Array.isArray(insights?.rows) ? insights.rows : [];
  if (rows.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'companion-card';

  const primary = FDT_LOOKUP_CORE.getMoePrimaryRow(rows) || {};
  const relation = makeKilangRelationRow(word, insights, primary);
  if (relation) section.appendChild(relation);
  const chain = getMoeChain(primary, insights);
  if (chain.length > 0) section.appendChild(makeChain(chain));

  const senses = FDT_LOOKUP_CORE.getMoeSenseRows(rows);
  senses.forEach((sense, index) => {
    section.appendChild(makeSenseBlock(sense, index + 1));
  });
  return section;
}

function getMoeChain(primary, insights) {
  const values = [
    primary.ultimate_root,
    primary.parent_word,
    insights?.match || primary.word_ab,
  ]
    .map(FDT_LOOKUP_CORE.cleanMoeText)
    .filter(Boolean);
  return [...new Set(values)];
}

function makeChain(chain) {
  const row = document.createElement('div');
  row.className = 'chain-row';
  chain.forEach((item, index) => {
    if (index > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'chain-arrow';
      arrow.textContent = '>';
      row.appendChild(arrow);
    }
    row.appendChild(makeDrillButton(item, 'chain-chip chain-button'));
  });
  return row;
}

function makeKilangRelationRow(query, insights, primary) {
  const matched = FDT_LOOKUP_CORE.cleanMoeText(insights?.match || primary.word_ab || '');
  const fallbackFrom = FDT_LOOKUP_CORE.cleanMoeText(insights?.fallbackFrom || '');
  const relationAffix = getRecoveryAffixSummary(insights?.recovery);
  const inferred = getInferredAffixSummary(matched, primary);
  if (!fallbackFrom && !inferred) return null;

  const row = document.createElement('div');
  row.className = 'relation-row';
  const icon = document.createElement('span');
  icon.className = 'relation-icon';
  icon.textContent = isPureAltRecovery(insights?.recovery) && !relationAffix ? '~' : '↳';
  const base = makeDrillButton(matched || query, 'relation-base inline-drill');
  row.append(icon, base);

  const affix = relationAffix || inferred;
  if (affix) {
    const plus = document.createElement('span');
    plus.className = 'relation-plus';
    plus.textContent = '+';
    const label = document.createElement('span');
    label.className = 'relation-affix';
    label.textContent = affix;
    row.append(plus, label);
  }
  return row;
}

function getRecoveryAffixSummary(recovery) {
  const affixes = Array.isArray(recovery?.affixes) ? recovery.affixes : [];
  return affixes.map(FDT_LOOKUP_CORE.cleanMoeText).filter(Boolean).join(' + ');
}

function getRecoveryOperations(recovery) {
  return Array.isArray(recovery?.operations) ? recovery.operations : [];
}

function isPureAltRecovery(recovery) {
  const operations = getRecoveryOperations(recovery);
  return operations.includes('alt') && !operations.includes('glottal') && getRecoveryAffixSummary(recovery) === '';
}

function getInferredAffixSummary(word, row) {
  const stem = FDT_LOOKUP_CORE.cleanMoeText(row?.stem || row?.ultimate_root || '');
  const cleanWord = FDT_LOOKUP_CORE.cleanMoeText(word).toLowerCase();
  const cleanStem = stem.toLowerCase();
  if (!cleanWord || !cleanStem || cleanWord === cleanStem) return '';

  const start = cleanWord.indexOf(cleanStem);
  if (start < 0) return '';

  const prefix = cleanWord.slice(0, start);
  const suffix = cleanWord.slice(start + cleanStem.length);
  if (prefix && suffix) return `${prefix}-...-${suffix}`;
  if (prefix) return `${prefix}-`;
  if (suffix) return `-${suffix}`;
  return '';
}

function makeSenseBlock(sense, number) {
  const savedItem = registerExportItem(buildSavedMoeSense(sense));
  const block = document.createElement('article');
  block.className = 'sense-block';
  const head = document.createElement('div');
  head.className = 'sense-head';
  const def = document.createElement('h3');
  def.textContent = sense.definition || FDT_LOOKUP_CORE.cleanMoeText(sense.row?.word_ab) || `義項 ${number}`;
  const meta = document.createElement('span');
  meta.className = 'pill subtle';
  meta.textContent = FDT_LOOKUP_CORE.getMoeSourceMeta(sense.row) || `#${number}`;
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(meta, createCompanionSaveButton(() => savedItem));
  head.append(def, actions);
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
  const zh = document.createElement('strong');
  zh.textContent = row.displayText;
  const dialect = document.createElement('span');
  dialect.textContent = row.dialect || '';
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (row.audioUrl) actions.appendChild(createDirectAudioButton(row.audioUrl));
  actions.append(dialect, createCompanionSaveButton(() => savedItem));
  main.append(zh, actions);
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

function makeZhRow(row) {
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
  const meta = document.createElement('span');
  meta.textContent = row.metaLabel || row.dialect || '';
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (row.audioUrl) actions.appendChild(createDirectAudioButton(row.audioUrl));
  actions.append(meta, createCompanionSaveButton(() => savedItem));
  main.append(ab, actions);
  item.appendChild(main);

  if (row.secondaryText) {
    const zh = document.createElement('div');
    zh.className = 'example-zh';
    zh.textContent = row.secondaryText;
    item.appendChild(zh);
  }
  return item;
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
  const rows = tokens.map(token => byToken.get(token) || {
    token,
    displayToken: token,
    glosses: token.length <= 2 ? [token] : [],
    root: '',
    sourceId: '',
  });
  wrap.appendChild(makeReaderView(context.rawText || '', rows));
  wrap.appendChild(makeAnalysisGrid(rows));
  return wrap;
}

function makeAnalysisHeader(context, tokens, lookupCount) {
  const card = document.createElement('section');
  card.className = 'lookup-head';
  const top = document.createElement('div');
  top.className = 'lookup-head-main';
  const title = document.createElement('h2');
  title.textContent = context.rawText || '分析';
  top.append(title, makeHeaderActions(context.rawText, context));
  card.append(top, makeContextDetails(context, [
    ['語言', context.language || ''],
    ['統計', `${tokens.length} token / ${lookupCount} lookup`],
    ['觸發', getTriggerLabel(context.trigger)],
    ['頁面', context.page?.title || ''],
    ['網址', context.page?.url || ''],
    ['時間', formatTimestamp(context.timestamp)],
  ], `${tokens.length} token / ${lookupCount} lookup`));
  return card;
}

function makeContextDetails(_context, rows, summarySuffix = '') {
  const details = document.createElement('details');
  details.className = 'context-details';
  const summary = document.createElement('summary');
  summary.textContent = summarySuffix ? `詳細資訊 · ${summarySuffix}` : '詳細資訊';
  details.appendChild(summary);

  const list = document.createElement('dl');
  list.className = 'context-detail-list';
  rows
    .filter(([, value]) => value)
    .forEach(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const desc = document.createElement('dd');
      desc.textContent = value;
      list.append(term, desc);
    });
  details.appendChild(list);
  return details;
}

function makeAnalysisGrid(rows) {
  const grid = document.createElement('section');
  grid.className = 'analysis-grid companion-card';
  rows.forEach(row => {
    const item = document.createElement('article');
    item.className = row.sourceId ? 'analysis-token found' : 'analysis-token';
    const token = makeDrillButton(row.displayToken || row.token, 'analysis-token-button');
    const gloss = document.createElement('div');
    gloss.className = 'analysis-gloss';
    gloss.textContent = row.glosses?.length ? row.glosses.join(' / ') : 'x';
    item.append(token, gloss);
    if (row.root) {
      const root = document.createElement('span');
      root.className = 'analysis-root';
      root.textContent = row.root;
      item.appendChild(root);
    }
    grid.appendChild(item);
  });
  return grid;
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
    else line.appendChild(document.createTextNode(part.text));
  });

  const actions = document.createElement('div');
  actions.className = 'reader-actions';
  const mt = createCompanionMtButton(segment.text, currentContext);
  const tts = createCompanionTtsButton(segment.text, currentContext);
  if (mt) actions.appendChild(mt);
  if (tts) actions.appendChild(tts);

  block.appendChild(line);
  if (actions.childNodes.length > 0) block.appendChild(actions);
  return block;
}

function makeReaderToken(part, result) {
  const item = document.createElement('span');
  item.className = result?.sourceId ? 'reader-token found' : 'reader-token missing';
  const top = document.createElement('span');
  top.className = 'reader-token-top';
  top.textContent = getReaderTopAnnotation(part, result);

  const ab = makeDrillButton(part.text, 'reader-token-ab inline-drill');
  const zh = document.createElement('span');
  zh.className = 'reader-token-zh';
  zh.textContent = result?.glosses?.length ? result.glosses.join(' / ') : 'x';
  item.append(top, ab, zh);
  return item;
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

function makeHeaderActions(text, context) {
  const group = document.createElement('div');
  group.className = 'lookup-head-actions';
  const mt = createCompanionMtButton(text, context);
  const tts = createCompanionTtsButton(text, context);
  const exportBtn = createCompanionExportButton();
  if (mt) group.appendChild(mt);
  if (tts) group.appendChild(tts);
  group.appendChild(exportBtn);
  return group;
}

function createCompanionSaveButton(getItem) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'companion-icon-button companion-save-button';
  const setState = saved => {
    btn.classList.toggle('saved', saved);
    btn.title = saved ? '移除儲存' : '儲存';
    btn.setAttribute('aria-label', saved ? '移除儲存' : '儲存');
    btn.textContent = saved ? '◆' : '◇';
  };
  setState(false);

  const readItem = () => fdtNormalizeSavedItem(getItem());
  try {
    const item = readItem();
    fdtFindSavedItemKey(item.key).then(saved => setState(!!saved));
  } catch {
    btn.disabled = true;
  }

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

function createCompanionExportButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'companion-icon-button companion-export-button';
  btn.title = 'Export to IndiHunt';
  btn.setAttribute('aria-label', 'Export to IndiHunt');
  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('assets/indivore/icon128.png');
  img.alt = '';
  img.width = 18;
  img.height = 18;
  btn.appendChild(img);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    exportCompanionToIndiHunt();
  });
  return btn;
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
  const items = currentExportItems.flatMap(formatIndiHuntItems).slice(0, INDIHUNT_MAX_ITEMS);
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
  return {
    token,
    displayToken: FDT_LOOKUP_CORE.cleanMoeText(insights.match || row.word_ab || token),
    glosses,
    root: FDT_LOOKUP_CORE.cleanMoeText(row.ultimate_root || row.stem || ''),
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
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = source;
  head.append(title, pill);
  return head;
}

function makeExample(example, parentItem = null) {
  const savedItem = fdtNormalizeSavedItem(buildSavedExample(example, parentItem));
  const row = document.createElement('div');
  row.className = 'example-row';
  const top = document.createElement('div');
  top.className = 'example-ab-line';
  const ab = document.createElement('div');
  ab.className = 'example-ab';
  appendDrillableAbText(ab, example.ab || '');
  const tts = createCompanionTtsButton(example.ab || '', currentContext);
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (example.audioUrl) actions.appendChild(createDirectAudioButton(example.audioUrl));
  if (tts) actions.appendChild(tts);
  actions.appendChild(createCompanionSaveButton(() => savedItem));
  top.appendChild(ab);
  top.appendChild(actions);
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
