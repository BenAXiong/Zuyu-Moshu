let activeAudio = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'offscreenPlayAudio') return false;

  playAudio(msg.url)
    .then(ok => sendResponse({ ok }))
    .catch(error => sendResponse({ ok: false, reason: error?.message || 'playFailed' }));

  return true;
});

async function playAudio(url) {
  if (!url) return false;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }

  const audio = new Audio(url);
  activeAudio = audio;
  const cleanup = () => {
    if (activeAudio === audio) activeAudio = null;
  };
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  await audio.play();
  return true;
}
