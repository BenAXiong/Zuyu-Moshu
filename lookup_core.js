const FDT_LOOKUP_CORE = (() => {
  const MAX_WORD_LEN = 40;

  function cleanWord(word) {
    return String(word || '')
      .replace(/[‘’ʼ´`]/g, "'")
      .replace(/^[,.";:!?()[\]{}—–，。！？；：「」『』、]+|[,.";:!?()[\]{}—–，。！？；：「」『』、]+$/g, '')
      .toLowerCase();
  }

  function cleanDisplayText(text) {
    return String(text || '')
      .replace(/`([^`~]+)~/g, '$1')
      .replace(/[`~|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanMoeText(text) {
    return cleanDisplayText(text);
  }

  function cleanMoeDefinition(text) {
    return cleanMoeText(text).replace(/[。．.]+$/u, '').trim();
  }

  function isCjk(char) {
    return /[\u3400-\u9fff\uf900-\ufaff]/u.test(char);
  }

  function hasCjk(text) {
    return [...String(text || '')].some(isCjk);
  }

  function countCjk(text) {
    return [...String(text || '')].filter(isCjk).length;
  }

  function cleanPhraseText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function getPhraseTokens(raw, maxTokens = 16) {
    if (hasCjk(raw)) return [];
    return cleanPhraseText(raw)
      .split(/[\s,;!?()[\]{}"“”、，。！？；：「」『』\n\r\t]+/)
      .map(cleanWord)
      .filter(token => token && token.length <= MAX_WORD_LEN && !hasCjk(token))
      .slice(0, maxTokens);
  }

  function normalizeAudioUrl(url) {
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : '';
  }

  function getAudioUrl(entry) {
    return normalizeAudioUrl(entry?.audioUrl ?? entry?.audio_url ?? entry?.audio);
  }

  function parseMoeExamples(json) {
    try {
      const parsed = JSON.parse(json || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function isSentenceLikeExample(example) {
    const ab = example.ab || '';
    const zh = example.zh || '';
    const abTokens = ab.split(/\s+/).filter(Boolean).length;
    const zhChars = countCjk(zh);
    if (/[.!?。！？；;]/.test(`${ab}${zh}`)) return true;
    if (abTokens >= 3 && zhChars >= 4) return true;
    return zhChars >= 8;
  }

  function getMoeExampleRows(row) {
    return parseMoeExamples(row?.examples_json)
      .map(ex => ({
        ab: cleanMoeText(ex.ab),
        zh: cleanMoeText(ex.zh || ex.en),
        source: cleanMoeText(ex.source || ''),
        sourceId: 'KILANG',
        audioUrl: getAudioUrl(ex),
      }))
      .filter(ex => (ex.ab || ex.zh) && isSentenceLikeExample(ex));
  }

  function dedupeMoeExamples(examples) {
    const seen = new Set();
    return examples.filter(example => {
      const key = `${example.ab}\n${example.zh}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getMoeSourceRank(code) {
    return ({
      s: 0,
      m: 1,
      a: 2,
      'old-s': 3,
      p: 4,
    })[code] ?? 9;
  }

  function getMoeDisplayRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const displayable = list.filter(row => cleanMoeDefinition(row.definition) || getMoeExampleRows(row).length > 0);
    if (displayable.length === 0) return list;

    const bestRank = Math.min(...displayable.map(row => getMoeSourceRank(row.dict_code)));
    return displayable.filter(row => getMoeSourceRank(row.dict_code) === bestRank);
  }

  function getMoeSenseKey(row) {
    const definition = cleanMoeDefinition(row.definition);
    return definition || cleanMoeText(row.word_ab) || String(row.id || '');
  }

  function getMoeSenseRows(rows) {
    const senses = [];
    const byKey = new Map();

    getMoeDisplayRows(rows).forEach(row => {
      const key = getMoeSenseKey(row);
      if (!key) return;

      let sense = byKey.get(key);
      if (!sense) {
        sense = {
          row,
          definition: cleanMoeDefinition(row.definition),
          audioUrl: getAudioUrl(row),
          examples: [],
        };
        byKey.set(key, sense);
        senses.push(sense);
      }
      if (!sense.audioUrl) sense.audioUrl = getAudioUrl(row);
      sense.examples = dedupeMoeExamples([...sense.examples, ...getMoeExampleRows(row)]);
    });

    return senses;
  }

  function getMoePrimaryRow(rows) {
    return getMoeSenseRows(rows)[0]?.row || rows?.[0] || null;
  }

  function getMoeSourceLabel(code) {
    return ({
      s: 'S',
      p: 'P',
      m: 'M',
      a: 'A',
      'old-s': 'OLD',
    })[code] || 'SRC';
  }

  function getMoeSourceMeta(row) {
    const parts = [];
    if (row?.tier) parts.push(`T${row.tier}`);
    if (row?.dict_code) parts.push(getMoeSourceLabel(row.dict_code));
    return parts.join(' ');
  }

  function getShortPhraseDefinitions(text) {
    const clean = cleanDisplayText(String(text || '').replace(/[|｜]/g, '；'));
    if (!clean) return [];
    const withoutParen = clean
      .replace(/[（(][^（）()]*[）)]/g, ' ')
      .replace(/[〈《<][^〉》>]*[〉》>]/g, ' ')
      .replace(/[（）()]/g, ' ')
      .replace(/[〈〉《》<>]/g, ' ')
      .replace(/^[\s,.;:：，。；、]+|[\s,.;:：，。；、]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const candidates = withoutParen
      .split(/[；;。，,、/／]|或|及|和|與|表示|指/u)
      .map(part => part.replace(/^[的地得之]|[的地得之]$/g, '').trim())
      .filter(Boolean);
    const ordered = [
      ...candidates.filter(part => countCjk(part) <= 6),
      ...candidates.filter(part => countCjk(part) > 6),
    ];
    const picked = ordered.length > 0 ? ordered : [withoutParen];
    return picked.map(part => truncatePhraseHint(part)).filter(Boolean);
  }

  function getPhraseGlossesFromTexts(texts, options = {}) {
    const limit = options.limit ?? 2;
    const maxPerText = options.maxPerText ?? 2;
    const glosses = [];
    const seen = new Set();
    for (const text of texts) {
      let addedForText = 0;
      for (const part of getShortPhraseDefinitions(text)) {
        const key = part.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        glosses.push(part);
        addedForText++;
        if (glosses.length >= limit) return glosses;
        if (addedForText >= maxPerText) break;
      }
    }
    return glosses;
  }

  function truncatePhraseHint(text) {
    const chars = [...cleanDisplayText(text)];
    if (chars.length <= 6) return chars.join('');
    return `${chars.slice(0, 5).join('')}…`;
  }

  function normalizeDictEntry(entry, query = '') {
    const chineseQuery = hasCjk(query);
    return {
      ...entry,
      sourceId: 'EPARK',
      ab: cleanDisplayText(entry?.ab || entry?.word_ab || ''),
      zh: cleanDisplayText(entry?.zh || entry?.word_ch || ''),
      dialect: cleanDisplayText(entry?.dialect_name || ''),
      audioUrl: getAudioUrl(entry),
      displayText: chineseQuery
        ? cleanDisplayText(entry?.ab || entry?.word_ab || '')
        : cleanDisplayText(entry?.zh || entry?.word_ch || ''),
    };
  }

  function normalizeDictEntries(results, query = '') {
    const chineseQuery = hasCjk(query);
    return (Array.isArray(results) ? results : [])
      .map(entry => normalizeDictEntry(entry, query))
      .filter(entry => entry.displayText && (!chineseQuery || !hasCjk(entry.displayText)));
  }

  return {
    cleanWord,
    cleanDisplayText,
    cleanMoeText,
    cleanMoeDefinition,
    hasCjk,
    countCjk,
    cleanPhraseText,
    getPhraseTokens,
    getAudioUrl,
    getMoeExampleRows,
    getMoeSenseRows,
    getMoePrimaryRow,
    getMoeSourceMeta,
    getPhraseGlossesFromTexts,
    normalizeDictEntries,
  };
})();
