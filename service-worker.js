const INJECTION_FILES = [
  "utils/constants.js",
  "utils/ids.js",
  "utils/geometry.js",
  "content/projection.js",
  "content/mapState.js",
  "content/storage.js",
  "content/selectionManager.js",
  "content/shapeRenderer.js",
  "content/drawingTools.js",
  "content/ui.js",
  "content/overlayManager.js",
  "content/contentScript.js"
];

const MESSAGE_TYPE = {
  PING: "HOP_PING",
  LOAD: "HOP_LOAD_PLAN"
};

chrome.runtime.onInstalled.addListener(() => {
  console.log("Homestead Overlay Planner installed.");
});

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessageToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (_error) {
    return null;
  }
}

async function waitForTabComplete(tabId, timeoutMs) {
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.status === "complete") {
      return tab;
    }
    await sleep(120);
  }

  return chrome.tabs.get(tabId);
}

async function ensurePlannerInjected(tabId) {
  const ping = await sendMessageToTab(tabId, { type: MESSAGE_TYPE.PING });
  if (ping && ping.ok) {
    return;
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["styles/overlay.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: INJECTION_FILES
  });

  for (let i = 0; i < 6; i += 1) {
    const secondPing = await sendMessageToTab(tabId, { type: MESSAGE_TYPE.PING });
    if (secondPing && secondPing.ok) {
      return;
    }
    await sleep(120);
  }

  throw new Error("Planner content script did not initialize.");
}

async function runSeamlessPlanLoad(payload, senderTabId) {
  const requestedTabId = Number(payload && payload.tabId);
  const tabId = Number.isInteger(requestedTabId) && requestedTabId > 0
    ? requestedTabId
    : Number(senderTabId);
  const planId = payload && payload.planId;
  const targetUrl = payload && typeof payload.targetUrl === "string" ? payload.targetUrl : "";
  const keyBindings = payload && payload.keyBindings && typeof payload.keyBindings === "object"
    ? payload.keyBindings
    : undefined;
  const focusShapeId =
    payload && typeof payload.focusShapeId === "string" && payload.focusShapeId.trim()
      ? payload.focusShapeId.trim()
      : "";

  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error("Missing tab id.");
  }
  if (!planId || typeof planId !== "string") {
    throw new Error("Missing plan id.");
  }

  const currentTab = await chrome.tabs.get(tabId);
  if (!currentTab) {
    throw new Error("Target tab not found.");
  }

  if (targetUrl && currentTab.url !== targetUrl) {
    await chrome.tabs.update(tabId, { url: targetUrl });
    await waitForTabComplete(tabId, 20000);
  }

  await ensurePlannerInjected(tabId);

  const response = await sendMessageToTab(tabId, {
    type: MESSAGE_TYPE.LOAD,
    planId,
    options: {
      skipNavigation: true,
      keyBindings,
      focusShapeId
    }
  });

  if (!response || !response.ok) {
    const message = response && response.error ? response.error : "Failed to load plan in tab.";
    throw new Error(message);
  }

  return response;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "HOP_SERVICE_HEALTH") {
    sendResponse({ ok: true, timestamp: Date.now() });
    return;
  }

  if (message.type === "HOP_SERVICE_LOAD_PLAN") {
    (async () => {
      try {
        const senderTabId =
          sender && sender.tab && Number.isInteger(sender.tab.id)
            ? sender.tab.id
            : null;
        const result = await runSeamlessPlanLoad(message, senderTabId);
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : "Failed to load plan."
        });
      }
    })();

    return true;
  }
});
