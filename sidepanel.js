const CONTEXT_KEY = 'companionContext';
const LOOKUP_CONCURRENCY = 4;
const MAX_ANALYSIS_TOKENS = 80;

let renderSerial = 0;
let currentContext = null;
let companionHistory = [];

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
  const wrap = document.createElement('div');
  wrap.className = 'companion-stack';
  wrap.appendChild(makeLookupHeader(context, word));

  if (!word) {
    wrap.appendChild(makeNotice('沒有可查詢的文字'));
    return wrap;
  }

  const sections = await fetchWordSections(word, settings);
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

async function fetchKilangSection(word) {
  const response = await sendRuntimeMessage({ type: 'moeInsights', word });
  const insights = response?.insights;
  const rows = Array.isArray(insights?.rows) ? insights.rows : [];
  if (rows.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'companion-card';

  const primary = FDT_LOOKUP_CORE.getMoePrimaryRow(rows) || {};
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

function makeSenseBlock(sense, number) {
  const block = document.createElement('article');
  block.className = 'sense-block';
  const head = document.createElement('div');
  head.className = 'sense-head';
  const def = document.createElement('h3');
  def.textContent = sense.definition || FDT_LOOKUP_CORE.cleanMoeText(sense.row?.word_ab) || `義項 ${number}`;
  const meta = document.createElement('span');
  meta.className = 'pill subtle';
  meta.textContent = FDT_LOOKUP_CORE.getMoeSourceMeta(sense.row) || `#${number}`;
  head.append(def, meta);
  block.appendChild(head);

  if (sense.examples.length > 0) {
    const examples = document.createElement('div');
    examples.className = 'examples';
    sense.examples.forEach(example => examples.appendChild(makeExample(example)));
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
  const item = document.createElement('article');
  item.className = 'dict-row';
  const main = document.createElement('div');
  main.className = 'dict-main';
  const zh = document.createElement('strong');
  zh.textContent = row.displayText;
  const dialect = document.createElement('span');
  dialect.textContent = row.dialect || '';
  main.append(zh, dialect);
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
  const tts = createCompanionTtsButton(text, context);
  if (tts) group.appendChild(tts);
  return group;
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

function makeExample(example) {
  const row = document.createElement('div');
  row.className = 'example-row';
  const top = document.createElement('div');
  top.className = 'example-ab-line';
  const ab = document.createElement('div');
  ab.className = 'example-ab';
  appendDrillableAbText(ab, example.ab || '');
  const tts = createCompanionTtsButton(example.ab || '', currentContext);
  top.appendChild(ab);
  if (tts) top.appendChild(tts);
  const zh = document.createElement('div');
  zh.className = 'example-zh';
  zh.textContent = example.zh || '';
  row.append(top, zh);
  return row;
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
