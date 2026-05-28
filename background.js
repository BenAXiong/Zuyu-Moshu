const API_BASE = 'https://ycm-citadel.vercel.app/api/search';

async function updateIcon(enabled) {
  const size = 16;
  const bitmap = await createImageBitmap(
    await (await fetch(chrome.runtime.getURL('icons/icon16.png'))).blob()
  );
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);
  if (enabled) {
    // White outline for visibility against any icon background
    ctx.beginPath(); ctx.arc(13, 13, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    // Green dot
    ctx.beginPath(); ctx.arc(13, 13, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#34d399'; ctx.fill();
  }
  chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, size, size) });
}

chrome.storage.sync.get({ enabled: true }, (s) => updateIcon(s.enabled));
chrome.storage.onChanged.addListener((changes) => {
  if ('enabled' in changes) updateIcon(changes.enabled.newValue);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'lookup') return;

  const params = new URLSearchParams({ mode: 'DICT', q: msg.word });
  if (msg.dialects) params.set('dialects', msg.dialects);

  fetch(`${API_BASE}?${params}`)
    .then(r => r.json())
    .then(data => sendResponse({ results: data.results ?? [] }))
    .catch(() => sendResponse({ results: [] }));

  return true; // keep channel open for async sendResponse
});
