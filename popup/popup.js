const STORAGE_KEY = "homesteadOverlayPlannerPlans";
const SETTINGS_KEY = "homesteadOverlayPlannerSettings";
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

const BINDING_ACTIONS = [
  { id: "select", label: "Select" },
  { id: "pan", label: "Pan Mode" },
  { id: "connection", label: "Connection" },
  { id: "line", label: "Line" },
  { id: "polygon", label: "Polygon" },
  { id: "rectangle", label: "Rectangle" },
  { id: "label", label: "Label" },
  { id: "undo", label: "Undo" },
  { id: "redo", label: "Redo" },
  { id: "length", label: "Length Toggle" },
  { id: "showUnshowLength", label: "Show/Unshow Length" },
  { id: "save", label: "Save" },
  { id: "exit", label: "Exit" }
];

const DEFAULT_KEY_BINDINGS = Object.freeze({
  select: "v",
  pan: "h",
  connection: "c",
  line: "l",
  polygon: "g",
  rectangle: "r",
  label: "t",
  undo: "z",
  redo: "y",
  length: "k",
  showUnshowLength: "j",
  save: "s",
  exit: "x"
});

let activeTab = null;
let activeMapState = null;
let settings = {
  keyBindings: { ...DEFAULT_KEY_BINDINGS }
};

const ui = {
  startButton: null,
  importButton: null,
  importInput: null,
  pageStatus: null,
  plansList: null,
  flashMessage: null,
  bindingsHint: null,
  customizeBindingsBtn: null,
  bindingsPanel: null,
  bindingsRows: null,
  closeBindingsBtn: null,
  resetBindingsBtn: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ui.startButton = document.getElementById("startPlanningBtn");
  ui.importButton = document.getElementById("importPlanBtn");
  ui.importInput = document.getElementById("importPlanInput");
  ui.pageStatus = document.getElementById("pageStatus");
  ui.plansList = document.getElementById("plansList");
  ui.flashMessage = document.getElementById("flashMessage");
  ui.bindingsHint = document.getElementById("bindingsHint");
  ui.customizeBindingsBtn = document.getElementById("customizeBindingsBtn");
  ui.bindingsPanel = document.getElementById("bindingsPanel");
  ui.bindingsRows = document.getElementById("bindingsRows");
  ui.closeBindingsBtn = document.getElementById("closeBindingsBtn");
  ui.resetBindingsBtn = document.getElementById("resetBindingsBtn");

  ui.startButton.addEventListener("click", onStartPlanning);
  ui.importButton.addEventListener("click", onImportPlanClick);
  ui.importInput.addEventListener("change", onImportPlanFileSelected);
  ui.customizeBindingsBtn.addEventListener("click", () => {
    const nextHidden = !ui.bindingsPanel.hidden;
    ui.bindingsPanel.hidden = nextHidden;
    if (!nextHidden) {
      renderBindingsRows();
    }
  });
  ui.closeBindingsBtn.addEventListener("click", () => {
    ui.bindingsPanel.hidden = true;
  });
  ui.resetBindingsBtn.addEventListener("click", async () => {
    settings.keyBindings = { ...DEFAULT_KEY_BINDINGS };
    await saveSettings();
    renderBindingSummary();
    renderBindingsRows();
    setFlash("Shortcuts reset to defaults.");
  });

  settings = await loadSettings();
  renderBindingSummary();
  renderBindingsRows();

  activeTab = await getActiveTab();
  updatePageStatus();
  await refreshPlansList();
}

function normalizeShortcut(shortcut) {
  return typeof shortcut === "string" ? shortcut.trim().toLowerCase() : "";
}

function normalizeKeyBindings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const out = {};
  Object.keys(DEFAULT_KEY_BINDINGS).forEach((key) => {
    out[key] = normalizeShortcut(source[key]) || DEFAULT_KEY_BINDINGS[key];
  });
  return out;
}

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    const raw = data && data[SETTINGS_KEY] ? data[SETTINGS_KEY] : {};
    return {
      keyBindings: normalizeKeyBindings(raw.keyBindings)
    };
  } catch (_error) {
    return {
      keyBindings: { ...DEFAULT_KEY_BINDINGS }
    };
  }
}

async function saveSettings() {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      keyBindings: normalizeKeyBindings(settings.keyBindings)
    }
  });
}

function displayShortcut(shortcut) {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) {
    return "";
  }
  return normalized.toUpperCase();
}

function eventToShortcut(event) {
  const modifierKeys = new Set(["Control", "Meta", "Alt", "Shift"]);
  if (modifierKeys.has(event.key)) {
    return "";
  }

  let keyToken = "";
  if (event.key === " ") {
    keyToken = "space";
  } else if (event.key.length === 1) {
    keyToken = event.key.toLowerCase();
  } else {
    keyToken = String(event.key || "").toLowerCase();
  }

  if (!keyToken) {
    return "";
  }

  const parts = [];
  if (event.ctrlKey) {
    parts.push("ctrl");
  }
  if (event.metaKey) {
    parts.push("meta");
  }
  if (event.altKey) {
    parts.push("alt");
  }
  if (event.shiftKey) {
    parts.push("shift");
  }
  parts.push(keyToken);
  return parts.join("+");
}

function renderBindingSummary() {
  if (!ui.bindingsHint) {
    return;
  }

  const summaryItems = [
    `Select: ${displayShortcut(settings.keyBindings.select)}`,
    `Pan: ${displayShortcut(settings.keyBindings.pan)}`,
    `Line: ${displayShortcut(settings.keyBindings.line)}`,
    `Save: ${displayShortcut(settings.keyBindings.save)}`
  ];
  ui.bindingsHint.textContent = summaryItems.join(" • ");
}

function renderBindingsRows() {
  ui.bindingsRows.innerHTML = "";

  BINDING_ACTIONS.forEach((actionDef) => {
    const row = document.createElement("div");
    row.className = "binding-row";

    const label = document.createElement("label");
    label.className = "binding-label";
    label.textContent = actionDef.label;

    const input = document.createElement("input");
    input.className = "binding-input";
    input.type = "text";
    input.readOnly = true;
    input.value = displayShortcut(settings.keyBindings[actionDef.id]);

    input.addEventListener("focus", () => {
      input.select();
    });

    input.addEventListener("keydown", async (event) => {
      event.preventDefault();

      if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        settings.keyBindings[actionDef.id] = "";
      } else {
        const shortcut = eventToShortcut(event);
        if (!shortcut) {
          return;
        }
        settings.keyBindings[actionDef.id] = shortcut;
      }

      settings.keyBindings = normalizeKeyBindings(settings.keyBindings);
      await saveSettings();
      renderBindingSummary();
      input.value = displayShortcut(settings.keyBindings[actionDef.id]);
    });

    row.appendChild(label);
    row.appendChild(input);
    ui.bindingsRows.appendChild(row);
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length ? tabs[0] : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRuntimeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeIsoDate(value, fallbackIso) {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return fallbackIso;
}

function sanitizePoint(point) {
  if (!point || typeof point !== "object") {
    return null;
  }

  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function sanitizeLabelBox(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const offsetX = Number(source.offsetX);
  const offsetY = Number(source.offsetY);
  const width = Number(source.width);
  const height = Number(source.height);

  return {
    offsetX: Number.isFinite(offsetX) ? offsetX : 10,
    offsetY: Number.isFinite(offsetY) ? offsetY : -28,
    width: Number.isFinite(width) ? Math.max(48, Math.min(360, width)) : 96,
    height: Number.isFinite(height) ? Math.max(20, Math.min(120, height)) : 24
  };
}

function sanitizeShape(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const type = typeof raw.type === "string" ? raw.type : "";
  if (type !== "line" && type !== "rectangle" && type !== "polygon" && type !== "label") {
    return null;
  }

  const id = normalizeId(raw.id) || createRuntimeId("shape");

  if (type === "label") {
    const point = sanitizePoint(raw.point);
    if (!point) {
      return null;
    }
    return {
      id,
      type,
      point,
      text: typeof raw.text === "string" ? raw.text : "",
      labelBox: sanitizeLabelBox(raw.labelBox)
    };
  }

  const points = Array.isArray(raw.points) ? raw.points.map(sanitizePoint).filter(Boolean) : [];
  if ((type === "line" && points.length < 2) || (type !== "line" && points.length < 3)) {
    return null;
  }

  const normalizedPoints = type === "line" ? points.slice(0, 2) : points;
  const edgeCount = type === "line" ? 1 : normalizedPoints.length;
  const measurements = raw.measurements && typeof raw.measurements === "object"
    ? raw.measurements
    : {};
  const edgeVisibilitySource = Array.isArray(measurements.edgeVisibility)
    ? measurements.edgeVisibility
    : [];

  const normalized = {
    id,
    type,
    points: normalizedPoints,
    measurements: {
      edgeVisibility: Array.from({ length: edgeCount }, (_, index) =>
        edgeVisibilitySource[index] !== false
      )
    }
  };

  if (typeof raw.label === "string") {
    normalized.label = raw.label;
  }

  if (type === "line") {
    if (typeof raw.connectionId === "string" && raw.connectionId.trim()) {
      normalized.connectionId = raw.connectionId.trim();
    }
  } else {
    const openEdgesSource = Array.isArray(measurements.openEdges) ? measurements.openEdges : [];
    normalized.measurements.openEdges = Array.from(
      { length: edgeCount },
      (_, index) => openEdgesSource[index] === true
    );
    normalized.measurements.areaVisible =
      typeof measurements.areaVisible === "boolean" ? measurements.areaVisible : true;
  }

  return normalized;
}

function sanitizePlanForImport(rawPlan, usedIds) {
  if (!rawPlan || typeof rawPlan !== "object") {
    return null;
  }

  let id = normalizeId(rawPlan.id);
  if (!id) {
    do {
      id = createRuntimeId("plan");
    } while (usedIds && usedIds.has(id));
  }

  if (usedIds) {
    usedIds.add(id);
  }

  const nowIso = new Date().toISOString();
  const source = rawPlan.source && typeof rawPlan.source === "object" ? rawPlan.source : {};
  const sourceLat = Number(source.lat);
  const sourceLng = Number(source.lng);
  const sourceZoom = Number(source.zoom);
  const sourceViewportWidth = Number(source.viewportWidth);
  const sourceViewportHeight = Number(source.viewportHeight);

  const shapes = Array.isArray(rawPlan.shapes)
    ? rawPlan.shapes.map(sanitizeShape).filter(Boolean)
    : [];

  return {
    id,
    name:
      typeof rawPlan.name === "string" && rawPlan.name.trim()
        ? rawPlan.name.trim()
        : "Untitled Plan",
    createdAt: normalizeIsoDate(rawPlan.createdAt, nowIso),
    updatedAt: normalizeIsoDate(rawPlan.updatedAt, nowIso),
    source: {
      url: typeof source.url === "string" ? source.url : "",
      lat: Number.isFinite(sourceLat) ? sourceLat : 0,
      lng: Number.isFinite(sourceLng) ? sourceLng : 0,
      zoom: Number.isFinite(sourceZoom) ? sourceZoom : 0,
      viewportWidth: Number.isFinite(sourceViewportWidth) ? sourceViewportWidth : 0,
      viewportHeight: Number.isFinite(sourceViewportHeight) ? sourceViewportHeight : 0
    },
    shapes
  };
}

function extractImportPlans(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object" && Array.isArray(payload.plans)) {
    return payload.plans;
  }

  if (payload && typeof payload === "object") {
    return [payload];
  }

  return [];
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

  const proposedName = window.prompt("New plan name:", "New Homestead Plan");
  const newPlanName = typeof proposedName === "string" ? proposedName.trim() : "";
  if (!newPlanName) {
    setFlash("Start planning cancelled (name required).");
    return;
  }

  try {
    await ensurePlannerInjected(activeTab.id);
    const response = await sendMessageToTab(activeTab.id, {
      type: MESSAGE_TYPE.START,
      options: {
        newPlanName,
        keyBindings: settings.keyBindings
      }
    });

    if (response && response.ok) {
      setFlash(`Created and opened new plan "${newPlanName}".`);
      await refreshPlansList();
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

async function loadPlansRaw() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  } catch (_error) {
    return [];
  }
}

async function loadPlans() {
  const plans = await loadPlansRaw();
  return plans
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
}

async function savePlans(plans) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: Array.isArray(plans) ? plans : []
  });
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

async function renamePlan(planId, nextName) {
  const trimmed = typeof nextName === "string" ? nextName.trim() : "";
  if (!trimmed) {
    return false;
  }

  const plans = await loadPlans();
  const index = plans.findIndex((plan) => plan.id === planId);
  if (index < 0) {
    return false;
  }

  if (plans[index].name === trimmed) {
    return true;
  }

  plans[index] = {
    ...plans[index],
    name: trimmed,
    updatedAt: new Date().toISOString()
  };

  await savePlans(plans);
  return true;
}

function startInlinePlanRename(titleNode, plan) {
  const input = document.createElement("input");
  input.className = "plan-name-input";
  input.type = "text";
  input.value = plan.name || "";

  const parent = titleNode.parentNode;
  if (!parent) {
    return;
  }

  parent.replaceChild(input, titleNode);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) {
      return;
    }
    done = true;

    if (commit) {
      const ok = await renamePlan(plan.id, input.value);
      if (!ok) {
        setFlash("Could not rename plan.");
      } else {
        setFlash("Plan name updated.");
      }
      await refreshPlansList();
      return;
    }

    await refreshPlansList();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });

  input.addEventListener("blur", () => {
    finish(true);
  });
}

function renderPlans(plans) {
  ui.plansList.innerHTML = "";

  if (!plans.length) {
    const empty = document.createElement("div");
    empty.className = "plan-empty";
    empty.textContent = "No saved plans yet. Start Planning creates a new plan and auto-saves it.";
    ui.plansList.appendChild(empty);
    return;
  }

  plans.forEach((plan) => {
    const card = document.createElement("article");
    card.className = "plan-card";

    const title = document.createElement("p");
    title.className = "plan-name";
    title.textContent = plan.name;
    title.title = "Double-click to rename";
    title.addEventListener("dblclick", () => startInlinePlanRename(title, plan));

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
    loadBtn.addEventListener("click", () => onLoadPlan(plan));

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

function buildPlanSourceUrl(plan) {
  if (plan && plan.source && typeof plan.source.url === "string" && plan.source.url.trim()) {
    return plan.source.url;
  }

  if (!plan || !plan.source) {
    return "";
  }

  const lat = Number(plan.source.lat);
  const lng = Number(plan.source.lng);
  const zoom = Number(plan.source.zoom);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "";
  }

  const safeZoom = Number.isFinite(zoom) ? zoom : 20;
  return `https://www.google.com/maps/@${lat.toFixed(7)},${lng.toFixed(7)},${safeZoom.toFixed(2)}z`;
}

async function waitForTabNavigation(tabId, timeoutMs) {
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 12000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      break;
    }
    if (tab.status === "complete") {
      return tab;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }

  return chrome.tabs.get(tabId);
}

async function onLoadPlan(plan) {
  if (!activeTab || !activeTab.id) {
    setFlash("Open a browser tab before loading a plan.");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "HOP_SERVICE_LOAD_PLAN",
      tabId: activeTab.id,
      planId: plan.id,
      targetUrl: buildPlanSourceUrl(plan),
      keyBindings: settings.keyBindings
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

  await savePlans(next);
  setFlash("Plan deleted.");
  await refreshPlansList();
}

function onImportPlanClick() {
  if (!ui.importInput) {
    return;
  }
  ui.importInput.value = "";
  ui.importInput.click();
}

async function onImportPlanFileSelected(event) {
  const input = event && event.target ? event.target : null;
  const file = input && input.files && input.files[0] ? input.files[0] : null;
  if (!file) {
    return;
  }

  try {
    const rawText = await file.text();
    if (!rawText || !rawText.trim()) {
      setFlash("Import failed: file is empty.");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (_error) {
      setFlash("Import failed: invalid JSON.");
      return;
    }

    const candidates = extractImportPlans(parsed);
    if (!candidates.length) {
      setFlash("Import failed: no plans found in this file.");
      return;
    }

    const existingPlans = await loadPlansRaw();
    const usedIds = new Set(
      existingPlans
        .map((plan) => (plan && typeof plan.id === "string" ? plan.id : ""))
        .filter(Boolean)
    );
    const mergedById = new Map();
    existingPlans.forEach((plan) => {
      if (plan && typeof plan === "object" && typeof plan.id === "string" && plan.id) {
        mergedById.set(plan.id, plan);
      }
    });

    let added = 0;
    let updated = 0;
    let skipped = 0;

    candidates.forEach((candidate) => {
      const normalized = sanitizePlanForImport(candidate, usedIds);
      if (!normalized) {
        skipped += 1;
        return;
      }

      if (mergedById.has(normalized.id)) {
        updated += 1;
      } else {
        added += 1;
      }
      mergedById.set(normalized.id, normalized);
    });

    if (added === 0 && updated === 0) {
      setFlash("Import failed: no valid plans could be imported.");
      return;
    }

    await savePlans(Array.from(mergedById.values()));
    await refreshPlansList();

    const details = [];
    details.push(`${added} added`);
    details.push(`${updated} updated`);
    if (skipped > 0) {
      details.push(`${skipped} skipped`);
    }
    setFlash(`Import complete: ${details.join(", ")}.`);
  } catch (error) {
    setFlash(`Import failed: ${error && error.message ? error.message : "unknown error"}`);
  } finally {
    if (input) {
      input.value = "";
    }
  }
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
