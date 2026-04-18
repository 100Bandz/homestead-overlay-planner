const STORAGE_KEY = "homesteadOverlayPlannerPlans";
const MESSAGE_TYPE = {
  PING: "HOP_PING",
  START: "HOP_START_PLANNING",
  LOAD: "HOP_LOAD_PLAN"
};

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

const MAP_URL_RE = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)([zm])/i;

let activeTab = null;
let activeMapState = null;

const ui = {
  startButton: null,
  pageStatus: null,
  plansList: null,
  flashMessage: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ui.startButton = document.getElementById("startPlanningBtn");
  ui.pageStatus = document.getElementById("pageStatus");
  ui.plansList = document.getElementById("plansList");
  ui.flashMessage = document.getElementById("flashMessage");

  ui.startButton.addEventListener("click", onStartPlanning);

  activeTab = await getActiveTab();
  updatePageStatus();
  await refreshPlansList();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length ? tabs[0] : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function metersToApproxZoom(lat, meters, viewportHeight) {
  const safeMeters = Number(meters);
  if (!Number.isFinite(safeMeters) || safeMeters <= 0) {
    return null;
  }

  const safeViewportHeight = Math.max(320, Number(viewportHeight) || 900);
  const metersPerPixel = safeMeters / safeViewportHeight;
  const latRad = (Number(lat) * Math.PI) / 180;
  const baseResolution = 156543.03392 * Math.cos(latRad);

  if (!Number.isFinite(baseResolution) || baseResolution <= 0) {
    return null;
  }

  const zoom = Math.log2(baseResolution / Math.max(metersPerPixel, 1e-9));
  if (!Number.isFinite(zoom)) {
    return null;
  }

  return clamp(zoom, 0, 24);
}

function parseMapStateFromUrl(url, viewportHeight) {
  if (!url || typeof url !== "string") {
    return null;
  }

  const match = url.match(MAP_URL_RE);
  if (!match) {
    return null;
  }

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  const zoomValue = Number(match[3]);
  const zoomUnit = String(match[4] || "").toLowerCase();
  let zoom = null;

  if (zoomUnit === "z") {
    zoom = zoomValue;
  } else if (zoomUnit === "m") {
    zoom = metersToApproxZoom(lat, zoomValue, viewportHeight);
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
    return null;
  }

  return {
    lat,
    lng,
    zoom,
    url,
    rawZoomValue: zoomValue,
    rawZoomUnit: zoomUnit,
    zoomSource: zoomUnit === "z" ? "url-z" : "url-meter-approx"
  };
}

function isGoogleMapsPage(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  return (
    /^https:\/\/www\.google\.[^/]+\/maps\//.test(url) ||
    /^https:\/\/maps\.google\.com\//.test(url)
  );
}

function updatePageStatus() {
  const url = activeTab && activeTab.url ? activeTab.url : "";
  const onMapsPage = isGoogleMapsPage(url);

  if (!onMapsPage) {
    activeMapState = null;
    ui.pageStatus.textContent = "Open a Google Maps tab to start planning.";
    ui.startButton.disabled = true;
    return;
  }

  activeMapState = parseMapStateFromUrl(url, activeTab && activeTab.height);
  ui.startButton.disabled = false;

  if (!activeMapState) {
    ui.pageStatus.textContent =
      "Google Maps is open, but this URL view is unsupported. Standard map view is required.";
    return;
  }

  const approxSuffix =
    activeMapState.zoomSource === "url-meter-approx" ? " approx" : "";
  ui.pageStatus.textContent = `Map view detected at ${activeMapState.lat.toFixed(5)}, ${activeMapState.lng.toFixed(5)} (z${activeMapState.zoom.toFixed(2)}${approxSuffix}).`;
}

async function onStartPlanning() {
  if (!activeTab || !activeTab.id || !isGoogleMapsPage(activeTab.url || "")) {
    setFlash("Open Google Maps in the active tab first.");
    return;
  }

  try {
    await ensurePlannerInjected(activeTab.id);
    const response = await sendMessageToTab(activeTab.id, {
      type: MESSAGE_TYPE.START
    });

    if (response && response.ok) {
      setFlash("Planning overlay enabled in active tab.");
    } else {
      setFlash("Could not start planning mode.");
    }
  } catch (error) {
    setFlash(`Failed to start planner: ${error.message || "unknown error"}`);
  }
}

async function refreshPlansList() {
  const plans = await loadPlans();
  const sortedPlans = sortPlansForCurrentTab(plans);
  renderPlans(sortedPlans);
}

async function loadPlans() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    if (!Array.isArray(data[STORAGE_KEY])) {
      return [];
    }

    return data[STORAGE_KEY]
      .filter((plan) => plan && typeof plan === "object" && typeof plan.id === "string")
      .map((plan) => ({
        ...plan,
        name: typeof plan.name === "string" && plan.name.trim() ? plan.name : "Untitled Plan",
        shapes: Array.isArray(plan.shapes) ? plan.shapes : [],
        updatedAt:
          typeof plan.updatedAt === "string" && !Number.isNaN(Date.parse(plan.updatedAt))
            ? plan.updatedAt
            : plan.createdAt || new Date().toISOString()
      }));
  } catch (_error) {
    return [];
  }
}

function sortPlansForCurrentTab(plans) {
  return plans
    .slice()
    .sort((a, b) => scorePlan(b) - scorePlan(a) || compareUpdatedDesc(a, b));
}

function scorePlan(plan) {
  let score = 0;

  if (activeTab && activeTab.url && plan.source && plan.source.url === activeTab.url) {
    score += 1500;
  }

  if (activeMapState && plan.source) {
    const planLat = Number(plan.source.lat);
    const planLng = Number(plan.source.lng);
    const planZoom = Number(plan.source.zoom);

    if (Number.isFinite(planLat) && Number.isFinite(planLng) && Number.isFinite(planZoom)) {
      const distance = haversineMeters(
        { lat: activeMapState.lat, lng: activeMapState.lng },
        { lat: planLat, lng: planLng }
      );
      const zoomDiff = Math.abs(activeMapState.zoom - planZoom);

      score += Math.max(0, 800 - distance * 0.8);
      score += Math.max(0, 150 - zoomDiff * 40);
    }
  }

  return score;
}

function compareUpdatedDesc(a, b) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const x = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function renderPlans(plans) {
  ui.plansList.innerHTML = "";

  if (!plans.length) {
    const empty = document.createElement("div");
    empty.className = "plan-empty";
    empty.textContent = "No saved plans yet. Start planning on Google Maps, then save from the in-page toolbar.";
    ui.plansList.appendChild(empty);
    return;
  }

  plans.forEach((plan) => {
    const card = document.createElement("article");
    card.className = "plan-card";

    const title = document.createElement("p");
    title.className = "plan-name";
    title.textContent = plan.name;

    const meta = document.createElement("p");
    meta.className = "plan-meta";
    const updatedText = formatTimestamp(plan.updatedAt);
    const count = Array.isArray(plan.shapes) ? plan.shapes.length : 0;
    meta.textContent = `${updatedText} • ${count} shape${count === 1 ? "" : "s"}`;

    const actions = document.createElement("div");
    actions.className = "plan-actions";

    const loadBtn = document.createElement("button");
    loadBtn.className = "plan-btn load";
    loadBtn.type = "button";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => onLoadPlan(plan.id));

    const exportBtn = document.createElement("button");
    exportBtn.className = "plan-btn";
    exportBtn.type = "button";
    exportBtn.textContent = "Export JSON";
    exportBtn.addEventListener("click", () => onExportPlan(plan));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "plan-btn delete";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => onDeletePlan(plan.id));

    actions.appendChild(loadBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(actions);
    ui.plansList.appendChild(card);
  });
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString();
}

async function onLoadPlan(planId) {
  if (!activeTab || !activeTab.id || !isGoogleMapsPage(activeTab.url || "")) {
    setFlash("Open Google Maps in the active tab before loading a plan.");
    return;
  }

  try {
    await ensurePlannerInjected(activeTab.id);
    const response = await sendMessageToTab(activeTab.id, {
      type: MESSAGE_TYPE.LOAD,
      planId
    });

    if (response && response.ok) {
      setFlash("Plan loaded into active map tab.");
    } else {
      setFlash(response && response.error ? response.error : "Failed to load plan.");
    }
  } catch (error) {
    setFlash(`Failed to load plan: ${error.message || "unknown error"}`);
  }
}

async function onDeletePlan(planId) {
  const confirmed = window.confirm("Delete this saved plan?");
  if (!confirmed) {
    return;
  }

  const plans = await loadPlans();
  const next = plans.filter((plan) => plan.id !== planId);

  await chrome.storage.local.set({
    [STORAGE_KEY]: next
  });

  setFlash("Plan deleted.");
  await refreshPlansList();
}

function onExportPlan(plan) {
  try {
    const json = JSON.stringify(plan, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeFilename(plan.name || plan.id || "homestead-plan")}.json`;
    anchor.click();

    URL.revokeObjectURL(url);
    setFlash("JSON export downloaded.");
  } catch (_error) {
    setFlash("Could not export this plan as JSON.");
  }
}

function sanitizeFilename(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "homestead-plan";
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

  const secondPing = await sendMessageToTab(tabId, { type: MESSAGE_TYPE.PING });
  if (!secondPing || !secondPing.ok) {
    throw new Error("Planner content script did not initialize.");
  }
}

async function sendMessageToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (_error) {
    return null;
  }
}

function setFlash(message) {
  ui.flashMessage.textContent = message;
}
