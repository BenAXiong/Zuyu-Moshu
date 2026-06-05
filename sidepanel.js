const CONTEXT_KEY = 'companionContext';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('clear')?.addEventListener('click', clearContext);
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => setActiveMode(tab.dataset.mode));
  });

  loadContext();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[CONTEXT_KEY]) return;
    renderContext(changes[CONTEXT_KEY].newValue || null);
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'companionContextUpdated') loadContext();
  });
});

function loadContext() {
  chrome.storage.session.get({ [CONTEXT_KEY]: null }, data => {
    renderContext(data[CONTEXT_KEY]);
  });
}

function clearContext() {
  chrome.storage.session.remove(CONTEXT_KEY, () => renderContext(null));
}

function setActiveMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
}

function renderContext(context) {
  const status = document.getElementById('status');
  const content = document.getElementById('content');
  if (!content || !status) return;

  if (!context) {
    status.textContent = '等待選取文字';
    content.className = 'content empty';
    content.innerHTML = `
      <div class="empty-state">
        <strong>選取文字開始</strong>
        <span>將查詢顯示切換到 Companion 後，雙擊或 Ctrl+選取文字會在這裡顯示。</span>
      </div>
    `;
    return;
  }

  const mode = context.mode === 'word' ? 'lookup' : 'analysis';
  setActiveMode(mode);
  status.textContent = `${getModeLabel(context.mode)} · ${getTriggerLabel(context.trigger)}`;
  content.className = 'content';
  content.innerHTML = '';

  const card = document.createElement('section');
  card.className = 'context-card';
  card.append(
    makeRow('選取內容', context.rawText || '', 'context-head context-text'),
    makeRow('模式', getModeLabel(context.mode)),
    makeTokensRow(context.tokens || []),
    makePageRow(context.page || {}),
    makeRow('觸發', getTriggerLabel(context.trigger)),
    makeRow('時間', formatTimestamp(context.timestamp))
  );
  content.appendChild(card);
}

function makeRow(label, value, className = 'context-row') {
  const row = document.createElement('div');
  row.className = className;
  const labelEl = document.createElement('span');
  labelEl.className = 'context-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('div');
  valueEl.textContent = value || '—';
  row.append(labelEl, valueEl);
  return row;
}

function makeTokensRow(tokens) {
  const row = document.createElement('div');
  row.className = 'context-row';
  const label = document.createElement('span');
  label.className = 'context-label';
  label.textContent = 'Tokens';
  const list = document.createElement('div');
  list.className = 'token-list';
  if (tokens.length === 0) {
    list.textContent = '—';
  } else {
    tokens.forEach(token => {
      const item = document.createElement('span');
      item.className = 'token';
      item.textContent = token;
      list.appendChild(item);
    });
  }
  row.append(label, list);
  return row;
}

function makePageRow(page) {
  const row = document.createElement('div');
  row.className = 'context-row';
  const label = document.createElement('span');
  label.className = 'context-label';
  label.textContent = '頁面';
  const title = document.createElement('div');
  title.textContent = page.title || '—';
  const link = document.createElement('a');
  link.href = page.url || '#';
  link.textContent = page.url || '';
  link.target = '_blank';
  link.rel = 'noreferrer';
  row.append(label, title);
  if (page.url) row.appendChild(link);
  return row;
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
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}
