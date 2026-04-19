(() => {
  const HOP = (window.HOP = window.HOP || {});

  if (HOP.__contentScriptInitialized) {
    return;
  }

  if (!HOP.OverlayManager) {
    console.error("Homestead Overlay Planner failed to initialize: missing OverlayManager");
    return;
  }

  HOP.__contentScriptInitialized = true;
  HOP.overlayManager = new HOP.OverlayManager();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, error: "Invalid message" });
      return false;
    }

    const type = message.type;

    (async () => {
      try {
        if (type === HOP.constants.MESSAGE_TYPE.PING) {
          sendResponse({ ok: true, status: HOP.overlayManager.getStatus() });
          return;
        }

        if (type === HOP.constants.MESSAGE_TYPE.START) {
          const result = await HOP.overlayManager.start(message.options);
          sendResponse(result);
          return;
        }

        if (type === HOP.constants.MESSAGE_TYPE.LOAD) {
          const result = await HOP.overlayManager.loadPlan(message.planId, message.options);
          sendResponse(result);
          return;
        }

        if (type === HOP.constants.MESSAGE_TYPE.EXIT) {
          const result = HOP.overlayManager.exit();
          sendResponse(result);
          return;
        }

        if (type === HOP.constants.MESSAGE_TYPE.STATUS) {
          sendResponse({ ok: true, status: HOP.overlayManager.getStatus() });
          return;
        }

        sendResponse({ ok: false, error: "Unknown message type" });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : "Unknown error"
        });
      }
    })();

    return true;
  });
})();
