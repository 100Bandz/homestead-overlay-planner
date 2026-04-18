chrome.runtime.onInstalled.addListener(() => {
  console.log("Homestead Overlay Planner installed.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "HOP_SERVICE_HEALTH") {
    sendResponse({ ok: true, timestamp: Date.now() });
  }
});
