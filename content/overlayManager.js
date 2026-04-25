(() => {
  const HOP = (window.HOP = window.HOP || {});

  class OverlayManager {
    constructor() {
      this.ui = null;
      this.renderer = null;
      this.storage = new HOP.PlanStorage();
      this.selection = new HOP.SelectionManager();
      this.drawingTools = null;
      this.mapWatcher = new HOP.MapState.MapStateWatcher(
        this._onMapStateChanged.bind(this),
        this._onUnsupportedView.bind(this)
      );
      this.currentMapState = null;
      this.shapes = [];
      this.activeTool = HOP.constants.TOOL.PAN;
      this.active = false;
      this.currentPlanId = null;
      this.currentPlanName = "";
      this.lastViewportRect = null;
      this.editShapeId = null;
      this.selectedEdge = null;
      this.historyPast = [];
      this.historyFuture = [];
      this.historyLimit = 100;
      this.keyBindings = this._getDefaultKeyBindings();
      this.measurementSettings = {
        showAllLengths: true,
        showAllAreas: true,
        sideToggleMode: false,
        areaToggleMode: false,
        unitSystem: this._detectUnitSystem()
      };
      this.navigatorBusyShapeId = null;
      this.navigatorUiStateStorageKey = "homesteadOverlayPlannerNavigatorUiStateV1";
      this.unitSystemStorageKey = "homesteadOverlayPlannerUnitSystemV1";
      this.suspendNavigatorUiStatePersist = false;
      this.autoSaveDelayMs = 900;
      this.autoSaveTimerId = 0;
      this.autoSavePending = false;
      this.autoSaveInFlight = false;
      this.autoSaveLastErrorMessage = "";
      this.autoSaveLastErrorAt = 0;
      this.boundResize = this._onResize.bind(this);
    }

    _getDefaultKeyBindings() {
      return {
        select: "v",
        lasso: "q",
        pan: "h",
        connection: "c",
        line: "l",
        polygon: "g",
        rectangle: "r",
        circle: "o",
        label: "t",
        undo: "z",
        redo: "y",
        length: "k",
        showUnshowLength: "j",
        showUnshowArea: "u",
        rightAngleSnap: "a",
        save: "s",
        exit: "x"
      };
    }

    _detectUnitSystem() {
      const parseRegion = (value) => {
        const raw = typeof value === "string" ? value.trim() : "";
        if (!raw) {
          return "";
        }
        const parts = raw.replace(/_/g, "-").split("-");
        if (parts.length < 2) {
          return "";
        }
        return String(parts[1]).toUpperCase();
      };

      const primaryLocale =
        typeof navigator !== "undefined" &&
        navigator &&
        typeof navigator.language === "string"
          ? navigator.language
          : "";
      const primaryRegion = parseRegion(primaryLocale);
      if (primaryRegion === "US") {
        return "imperial";
      }
      if (primaryRegion) {
        return "metric";
      }

      return "metric";
    }

    _sanitizeUnitSystem(raw) {
      if (raw === "imperial" || raw === "metric") {
        return raw;
      }
      return null;
    }

    async _persistUnitSystemPreference(unitSystem) {
      const safe = this._sanitizeUnitSystem(unitSystem);
      if (!safe) {
        return;
      }

      try {
        await chrome.storage.local.set({
          [this.unitSystemStorageKey]: safe
        });
      } catch (_error) {
        // Ignore unit preference storage failures.
      }
    }

    async _restoreUnitSystemPreference() {
      try {
        const payload = await chrome.storage.local.get(this.unitSystemStorageKey);
        const saved = this._sanitizeUnitSystem(payload[this.unitSystemStorageKey]);
        if (saved) {
          this.measurementSettings.unitSystem = saved;
        }
      } catch (_error) {
        // Ignore unit preference restore failures.
      }
    }

    _normalizeShortcut(shortcut) {
      return typeof shortcut === "string" ? shortcut.trim().toLowerCase() : "";
    }

    _normalizeKeyBindings(raw) {
      const defaults = this._getDefaultKeyBindings();
      const source = raw && typeof raw === "object" ? raw : {};
      const normalized = {};
      Object.keys(defaults).forEach((key) => {
        const candidate = this._normalizeShortcut(source[key]);
        normalized[key] = candidate || defaults[key];
      });
      return normalized;
    }

    _applyRuntimeOptions(options) {
      const opts = options && typeof options === "object" ? options : {};
      if (opts.keyBindings && typeof opts.keyBindings === "object") {
        this.keyBindings = this._normalizeKeyBindings(opts.keyBindings);
      }
    }

    async start(options) {
      const opts = options && typeof options === "object" ? options : {};
      this._applyRuntimeOptions(opts);

      if (this.active) {
        this._setTool(HOP.constants.TOOL.PAN);
        const currentState = HOP.MapState.parseMapUrl(window.location.href, {
          viewportHeight: this._getMapViewportRect().height
        });
        if (currentState) {
          this._onMapStateChanged(currentState);
        } else {
          this._onUnsupportedView();
        }

        if (typeof opts.newPlanName === "string" && opts.newPlanName.trim()) {
          await this._createNewPlan(opts.newPlanName.trim());
        } else {
          this.ui.showStatus("Planning mode active.");
        }

        return { ok: true, status: this.getStatus() };
      }

      this.ui = new HOP.OverlayUI();
      this.suspendNavigatorUiStatePersist = true;
      this.ui.mount(
        this._handleToolbarAction.bind(this),
        this._handleNavigatorAction.bind(this),
        this._handleNavigatorUiStateChanged.bind(this)
      );
      await this._restoreUnitSystemPreference();
      await this._restoreNavigatorUiState();
      this.suspendNavigatorUiStatePersist = false;
      this.renderer = new HOP.ShapeRenderer(this.ui.getSvg());

      this.drawingTools = new HOP.DrawingTools({
        svg: this.ui.getSvg(),
        getView: () => this._buildViewModel(),
        getTool: () => this.activeTool,
        getShapes: () => this.shapes,
        setShapes: (shapes, optionsArg) => this._setShapes(shapes, optionsArg),
        selection: this.selection,
        requestRender: () => this._render(),
        promptLabelText: (defaultText, promptText) => {
          const text = window.prompt(promptText, defaultText);
          return typeof text === "string" ? text.trim() : "";
        },
        reportStatus: (message) => this.ui.showStatus(message),
        isLengthPickMode: () => this.measurementSettings.sideToggleMode,
        isAreaPickMode: () => this.measurementSettings.areaToggleMode,
        toggleEdgeLengthVisibility: (shapeId, edgeIndex) =>
          this._toggleEdgeLengthVisibility(shapeId, edgeIndex),
        toggleShapeAreaVisibility: (shapeId) => this._toggleShapeAreaVisibility(shapeId),
        prepareNewShape: (shape) => this._normalizeShape(shape),
        requestUndo: () => this.undo(),
        requestRedo: () => this.redo(),
        getEditShapeId: () => this.editShapeId,
        setEditShapeId: (shapeId) => this._setEditShapeId(shapeId),
        getSelectedEdge: () => this.selectedEdge,
        setSelectedEdge: (shapeId, edgeIndex) => this._setSelectedEdge(shapeId, edgeIndex),
        clearSelectedEdge: () => this._setSelectedEdge(null, null),
        deleteSelectedEdge: () => this._deleteSelectedEdge(),
        requestSetEdgeLength: (shapeId, edgeIndex) =>
          this._promptAndSetEdgeLength(shapeId, edgeIndex),
        connectLineEndpoints: (fromEndpoint, toEndpoint) =>
          this._connectLineEndpoints(fromEndpoint, toEndpoint),
        getKeyBindings: () => this.keyBindings,
        triggerShortcutAction: (action) => this._handleShortcutAction(action)
      });

      this.drawingTools.attach();
      this.mapWatcher.start();
      window.addEventListener("resize", this.boundResize);
      this.active = true;

      const current = HOP.MapState.parseMapUrl(window.location.href, {
        viewportHeight: this._getMapViewportRect().height
      });
      if (!current) {
        this.ui.showStatus(
          "Unsupported Google Maps view. Please switch to the standard map view."
        );
      } else {
        this.currentMapState = current;
      }

      this._setTool(HOP.constants.TOOL.PAN);
      this._refreshToolbarStates();

      if (typeof opts.newPlanName === "string" && opts.newPlanName.trim()) {
        await this._createNewPlan(opts.newPlanName.trim());
      }

      this._render();
      return { ok: true, status: this.getStatus() };
    }

    _buildPlanSourceUrl(source) {
      if (source && typeof source.url === "string" && source.url.trim()) {
        return source.url;
      }

      if (!source || !Number.isFinite(Number(source.lat)) || !Number.isFinite(Number(source.lng))) {
        return "";
      }

      const zoom = Number.isFinite(Number(source.zoom)) ? Number(source.zoom) : 20;
      return `https://www.google.com/maps/@${Number(source.lat).toFixed(7)},${Number(source.lng).toFixed(7)},${zoom.toFixed(2)}z`;
    }

    async _createNewPlan(planName) {
      this._cancelAutoSave();
      const name = typeof planName === "string" && planName.trim() ? planName.trim() : "Untitled Plan";

      const viewport = this._getMapViewportRect();
      const mapState = HOP.MapState.parseMapUrl(window.location.href, {
        viewportHeight: viewport.height
      });

      if (mapState) {
        this.currentMapState = mapState;
      }

      const now = new Date().toISOString();
      const sourceLat = this.currentMapState ? this.currentMapState.lat : 0;
      const sourceLng = this.currentMapState ? this.currentMapState.lng : 0;
      const sourceZoom = this.currentMapState ? this.currentMapState.zoom : 0;

      const plan = {
        id: HOP.ids.createId("plan"),
        name,
        createdAt: now,
        updatedAt: now,
        source: {
          url: this._buildPlanSourceUrl({
            url: window.location.href,
            lat: sourceLat,
            lng: sourceLng,
            zoom: sourceZoom
          }),
          lat: sourceLat,
          lng: sourceLng,
          zoom: sourceZoom,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height
        },
        shapes: []
      };

      const saved = await this.storage.savePlan(plan);
      this.currentPlanId = saved.id;
      this.currentPlanName = saved.name;
      this.shapes = [];
      this.selection.clear();
      this.editShapeId = null;
      this.selectedEdge = null;
      this.historyPast = [];
      this.historyFuture = [];
      if (this.drawingTools) {
        this.drawingTools.cancelCurrentDrawing();
      }

      this.ui.showStatus(`Created new plan "${saved.name}".`);
      this._render();

      return saved;
    }

    async loadPlan(planId, options) {
      if (!planId) {
        return { ok: false, error: "Missing plan id" };
      }

      this._cancelAutoSave();
      const opts = options && typeof options === "object" ? options : {};
      await this.start({ keyBindings: opts.keyBindings });

      const plan = await this.storage.getPlan(planId);
      if (!plan) {
        this.ui.showStatus("Plan not found.");
        return { ok: false, error: "Plan not found" };
      }

      const targetUrl = this._buildPlanSourceUrl(plan.source);
      if (!opts.skipNavigation && targetUrl && window.location.href !== targetUrl) {
        window.location.href = targetUrl;
        return {
          ok: true,
          navigating: true,
          targetUrl,
          planId: plan.id
        };
      }

      this.shapes = this._normalizeShapes(
        Array.isArray(plan.shapes) ? JSON.parse(JSON.stringify(plan.shapes)) : []
      );
      this.currentPlanId = plan.id;
      this.currentPlanName = plan.name;
      this.selection.clear();
      this.editShapeId = null;
      this.selectedEdge = null;
      this.historyPast = [];
      this.historyFuture = [];
      this.drawingTools.cancelCurrentDrawing();
      this._setTool(HOP.constants.TOOL.PAN);

      if (
        typeof opts.focusShapeId === "string" &&
        this.shapes.some((shape) => shape.id === opts.focusShapeId)
      ) {
        this.selection.select(opts.focusShapeId);
      }

      const viewport = this._getMapViewportRect();
      this.currentMapState = HOP.MapState.parseMapUrl(window.location.href, {
        viewportHeight: viewport.height
      });

      const focusedShape =
        typeof opts.focusShapeId === "string"
          ? this.shapes.find((shape) => shape.id === opts.focusShapeId)
          : null;
      const focusedShapeIndex = focusedShape
        ? this.shapes.findIndex((shape) => shape.id === focusedShape.id)
        : -1;

      if (focusedShape) {
        this.ui.showStatus(
          `Loaded plan "${plan.name}". Focused on ${this._shapeNavigatorName(focusedShape, focusedShapeIndex)}.`
        );
      } else {
        this.ui.showStatus(`Loaded plan "${plan.name}".`);
      }
      this._render();

      return {
        ok: true,
        status: this.getStatus(),
        plan
      };
    }

    async saveCurrentPlan(optionalName, optionsArg) {
      const options = optionsArg && typeof optionsArg === "object" ? optionsArg : {};
      const silent = options.silent === true;
      const source = typeof options.source === "string" ? options.source : "manual";

      if (source !== "autosave") {
        this._cancelAutoSave();
      }

      try {
        if (!this.currentMapState) {
          if (!silent) {
            this.ui.showStatus(
              "Cannot save plan: unsupported Google Maps URL state."
            );
          }
          return { ok: false, error: "Unsupported view" };
        }

        const existing = this.currentPlanId
          ? await this.storage.getPlan(this.currentPlanId)
          : null;

        let chosenName =
          typeof optionalName === "string" && optionalName.trim()
            ? optionalName.trim()
            : (existing && existing.name) || this.currentPlanName;

        if (!chosenName) {
          if (silent) {
            return { ok: false, cancelled: true, error: "Missing plan name" };
          }
          chosenName = (window.prompt("Save plan as:", "Homestead Plan") || "").trim();
        }

        if (!chosenName) {
          return { ok: false, cancelled: true };
        }

        const viewport = this._getMapViewportRect();
        const currentMap = HOP.MapState.parseMapUrl(window.location.href, {
          viewportHeight: viewport.height
        });

        if (currentMap) {
          this.currentMapState = currentMap;
        }

        const now = new Date().toISOString();
        const plan = {
          id: existing ? existing.id : (this.currentPlanId || HOP.ids.createId("plan")),
          name: chosenName,
          createdAt: existing ? existing.createdAt : now,
          updatedAt: now,
          source: {
            url: this._buildPlanSourceUrl({
              url: window.location.href,
              lat: this.currentMapState.lat,
              lng: this.currentMapState.lng,
              zoom: this.currentMapState.zoom
            }),
            lat: this.currentMapState.lat,
            lng: this.currentMapState.lng,
            zoom: this.currentMapState.zoom,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height
          },
          shapes: JSON.parse(JSON.stringify(this.shapes))
        };

        const saved = await this.storage.savePlan(plan);
        this.currentPlanId = saved.id;
        this.currentPlanName = saved.name;
        if (!silent) {
          this.ui.showStatus(`Saved plan "${saved.name}".`);
        }

        return {
          ok: true,
          plan: saved,
          status: this.getStatus()
        };
      } catch (error) {
        console.error("Homestead Overlay Planner save failed:", error);
        const rawMessage =
          error && typeof error.message === "string" && error.message.trim()
            ? error.message.trim()
            : "unknown error";
        const message = /extension context invalidated/i.test(rawMessage)
          ? "Extension context invalidated. Restart Planning Mode from the extension popup, then save again."
          : rawMessage;
        if (source === "autosave") {
          this._reportAutoSaveFailure(message);
        } else {
          this.ui.showStatus(`Save failed: ${message}`);
        }
        return {
          ok: false,
          error: message
        };
      }
    }

    exit() {
      if (!this.active) {
        return { ok: true };
      }

      this.mapWatcher.stop();
      window.removeEventListener("resize", this.boundResize);

      if (this.drawingTools) {
        this.drawingTools.detach();
      }

      if (this.ui) {
        this.ui.destroy();
      }
      this._cancelAutoSave();

      this.renderer = null;
      this.drawingTools = null;
      this.ui = null;
      this.active = false;

      return { ok: true };
    }

    getStatus() {
      return {
        active: this.active,
        activeTool: this.activeTool,
        shapeCount: this.shapes.length,
        planId: this.currentPlanId,
        editShapeId: this.editShapeId,
        selectedEdge: this.selectedEdge
          ? { shapeId: this.selectedEdge.shapeId, edgeIndex: this.selectedEdge.edgeIndex }
          : null,
        canUndo: this.historyPast.length > 0,
        canRedo: this.historyFuture.length > 0,
        keyBindings: { ...this.keyBindings },
        measurementSettings: { ...this.measurementSettings }
      };
    }

    _onMapStateChanged(mapState) {
      this.currentMapState = mapState;
      this._render();
    }

    _onUnsupportedView() {
      this.currentMapState = null;
      if (this.ui) {
        this.ui.showStatus(
          "Unsupported Google Maps view. Please switch to the standard map view."
        );
      }
      this._render();
    }

    _onResize() {
      this._render();
    }

    _sanitizeNavigatorUiState(raw) {
      if (!raw || typeof raw !== "object") {
        return null;
      }

      const left = Number(raw.left);
      const top = Number(raw.top);

      return {
        collapsed: raw.collapsed === true,
        left: Number.isFinite(left) ? left : null,
        top: Number.isFinite(top) ? top : null
      };
    }

    async _persistNavigatorUiState(state) {
      const sanitized = this._sanitizeNavigatorUiState(state);
      if (!sanitized) {
        return;
      }

      try {
        await chrome.storage.local.set({
          [this.navigatorUiStateStorageKey]: sanitized
        });
      } catch (_error) {
        // Ignore UI state storage failures.
      }
    }

    async _restoreNavigatorUiState() {
      if (!this.ui) {
        return;
      }

      try {
        const payload = await chrome.storage.local.get(this.navigatorUiStateStorageKey);
        const state = this._sanitizeNavigatorUiState(payload[this.navigatorUiStateStorageKey]);
        if (state) {
          this.ui.applyNavigatorState(state);
        }
      } catch (_error) {
        // Ignore UI state restore failures.
      }
    }

    _handleNavigatorUiStateChanged(state) {
      if (this.suspendNavigatorUiStatePersist) {
        return;
      }

      void this._persistNavigatorUiState(state);
    }

    _shapeTypeLabel(shapeType) {
      if (shapeType === "line") {
        return "Line";
      }
      if (shapeType === "rectangle") {
        return "Rectangle";
      }
      if (shapeType === "circle") {
        return "Circle";
      }
      if (shapeType === "polygon") {
        return "Polygon";
      }
      if (shapeType === "label") {
        return "Label";
      }
      return "Shape";
    }

    _shapeNavigatorName(shape, index) {
      const position = Number.isInteger(index) && index >= 0 ? index + 1 : 1;
      const typeLabel = this._shapeTypeLabel(shape && shape.type);

      if (!shape || typeof shape !== "object") {
        return `${typeLabel} ${position}`;
      }

      if (shape.type === "label") {
        const text = typeof shape.text === "string" ? shape.text.trim() : "";
        return text || `Label ${position}`;
      }

      const custom = typeof shape.label === "string" ? shape.label.trim() : "";
      if (custom) {
        return custom;
      }

      return `${typeLabel} ${position}`;
    }

    _buildNavigatorItems() {
      return this.shapes.map((shape, index) => ({
        id: shape.id,
        typeLabel: this._shapeTypeLabel(shape.type),
        name: this._shapeNavigatorName(shape, index)
      }));
    }

    _shapePoints(shape) {
      if (!shape || typeof shape !== "object") {
        return [];
      }

      if (shape.type === "label") {
        if (
          shape.point &&
          Number.isFinite(shape.point.x) &&
          Number.isFinite(shape.point.y)
        ) {
          return [{ x: Number(shape.point.x), y: Number(shape.point.y) }];
        }
        return [];
      }

      if (shape.type === "circle") {
        const center =
          shape.center &&
          Number.isFinite(shape.center.x) &&
          Number.isFinite(shape.center.y)
            ? { x: Number(shape.center.x), y: Number(shape.center.y) }
            : null;
        const radius = Number(shape.radius);
        if (!center || !Number.isFinite(radius) || radius <= 0) {
          return [];
        }
        return [
          center,
          { x: HOP.projection.normalizeCanonicalX(center.x + radius), y: center.y },
          { x: HOP.projection.normalizeCanonicalX(center.x - radius), y: center.y },
          { x: center.x, y: center.y + radius },
          { x: center.x, y: center.y - radius }
        ];
      }

      if (!Array.isArray(shape.points)) {
        return [];
      }

      return shape.points
        .filter(
          (point) =>
            point &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y)
        )
        .map((point) => ({
          x: Number(point.x),
          y: Number(point.y)
        }));
    }

    _shapeBounds(points) {
      const safePoints = Array.isArray(points) ? points : [];
      if (!safePoints.length) {
        return null;
      }

      const baseX = safePoints[0].x;
      const unwrapped = safePoints.map((point) => ({
        x: baseX + HOP.projection.wrapDeltaX(point.x - baseX),
        y: point.y
      }));

      const minX = Math.min(...unwrapped.map((point) => point.x));
      const maxX = Math.max(...unwrapped.map((point) => point.x));
      const minY = Math.min(...unwrapped.map((point) => point.y));
      const maxY = Math.max(...unwrapped.map((point) => point.y));
      const worldSize =
        HOP.constants.TILE_SIZE * Math.pow(2, HOP.constants.CANONICAL_ZOOM);

      return {
        center: {
          x: HOP.projection.normalizeCanonicalX((minX + maxX) / 2),
          y: Math.max(0, Math.min((minY + maxY) / 2, worldSize))
        },
        spanX: Math.max(0, maxX - minX),
        spanY: Math.max(0, maxY - minY)
      };
    }

    _shapeFocusZoom(bounds, viewport) {
      if (!bounds || !viewport) {
        return this.currentMapState ? this.currentMapState.zoom : 20;
      }

      const horizontalPadding = 120;
      const verticalPadding = 120;
      const viewportWidth = Number.isFinite(Number(viewport.width))
        ? Number(viewport.width)
        : (window.innerWidth || 1200);
      const viewportHeight = Number.isFinite(Number(viewport.height))
        ? Number(viewport.height)
        : (window.innerHeight || 900);
      const usableWidth = Math.max(120, viewportWidth - horizontalPadding);
      const usableHeight = Math.max(120, viewportHeight - verticalPadding);
      const minSpanCanonical = 256;

      const spanX = Math.max(bounds.spanX, minSpanCanonical);
      const spanY = Math.max(bounds.spanY, minSpanCanonical);
      const scale = Math.max(spanX / usableWidth, spanY / usableHeight, 1e-9);
      const zoom = HOP.constants.CANONICAL_ZOOM - Math.log2(scale);

      return Math.max(1, Math.min(22, zoom));
    }

    _shapeFocusUrl(shape) {
      const points = this._shapePoints(shape);
      const bounds = this._shapeBounds(points);
      if (!bounds) {
        return "";
      }

      const viewport = this._getMapViewportRect();
      const zoom = this._shapeFocusZoom(bounds, viewport);
      const centerLatLng = HOP.projection.canonicalToLatLng(bounds.center);
      return this._buildPlanSourceUrl({
        lat: centerLatLng.lat,
        lng: centerLatLng.lng,
        zoom
      });
    }

    async _focusShape(shapeId) {
      const shape = this.shapes.find((candidate) => candidate.id === shapeId);
      if (!shape) {
        this.ui.showStatus("Could not find that shape.");
        return;
      }

      if (!this.currentPlanId) {
        this.ui.showStatus("Save this plan before using Find.");
        return;
      }

      if (this.navigatorBusyShapeId) {
        return;
      }

      const targetUrl = this._shapeFocusUrl(shape);
      if (!targetUrl) {
        this.ui.showStatus("Could not determine shape location.");
        return;
      }

      this.navigatorBusyShapeId = shape.id;
      const shapeName = this._shapeNavigatorName(shape, this.shapes.indexOf(shape));
      this.ui.showStatus(`Finding ${shapeName}...`);

      try {
        const saveResult = await this.saveCurrentPlan(this.currentPlanName || undefined);
        if (!saveResult || !saveResult.ok) {
          this.ui.showStatus("Could not save current plan before Find.");
          return;
        }

        await this._persistNavigatorUiState(this.ui ? this.ui.getNavigatorState() : null);

        const response = await chrome.runtime.sendMessage({
          type: "HOP_SERVICE_LOAD_PLAN",
          planId: this.currentPlanId,
          targetUrl,
          keyBindings: this.keyBindings,
          focusShapeId: shape.id
        });

        if (!response || !response.ok) {
          const message = response && response.error ? response.error : "Failed to navigate to shape.";
          this.ui.showStatus(message);
        }
      } catch (error) {
        this.ui.showStatus(`Find failed: ${error && error.message ? error.message : "unknown error"}`);
      } finally {
        this.navigatorBusyShapeId = null;
      }
    }

    _getMapViewportRect() {
      const fallback = {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight
      };

      const canvases = Array.from(document.querySelectorAll("canvas"));
      let bestRect = null;
      let bestArea = 0;

      canvases.forEach((canvas) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 280 || rect.height < 220) {
          return;
        }

        const style = window.getComputedStyle(canvas);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return;
        }

        const area = rect.width * rect.height;
        if (area > bestArea) {
          bestArea = area;
          bestRect = rect;
        }
      });

      if (!bestRect) {
        this.lastViewportRect = fallback;
        return fallback;
      }

      const next = {
        left: bestRect.left,
        top: bestRect.top,
        width: bestRect.width,
        height: bestRect.height
      };

      this.lastViewportRect = next;
      return next;
    }

    _buildViewModel() {
      if (!this.currentMapState) {
        return null;
      }

      const viewport = this._getMapViewportRect();
      return HOP.projection.buildViewModel(
        this.currentMapState,
        viewport.width,
        viewport.height,
        viewport.left,
        viewport.top
      );
    }

    _currentMapScale() {
      const zoom = this.currentMapState ? Number(this.currentMapState.zoom) : NaN;
      if (!Number.isFinite(zoom)) {
        return 1;
      }
      return Math.pow(2, HOP.constants.CANONICAL_ZOOM - zoom);
    }

    _normalizeShape(shape) {
      if (!shape || typeof shape !== "object" || typeof shape.type !== "string") {
        return null;
      }

      if (shape.type === "label") {
        if (!shape.point) {
          return null;
        }
        const rawBox = shape.labelBox && typeof shape.labelBox === "object" ? shape.labelBox : {};
        const rawReferenceScale = Number(rawBox.referenceScale);
        return {
          ...shape,
          text: typeof shape.text === "string" ? shape.text : "Label",
          labelBox: {
            offsetX: Number.isFinite(Number(rawBox.offsetX)) ? Number(rawBox.offsetX) : 10,
            offsetY: Number.isFinite(Number(rawBox.offsetY)) ? Number(rawBox.offsetY) : -28,
            width: Number.isFinite(Number(rawBox.width))
              ? Math.max(48, Math.min(360, Number(rawBox.width)))
              : 96,
            height: Number.isFinite(Number(rawBox.height))
              ? Math.max(20, Math.min(120, Number(rawBox.height)))
              : 24,
            referenceScale:
              Number.isFinite(rawReferenceScale) && rawReferenceScale > 0
                ? rawReferenceScale
                : this._currentMapScale()
          }
        };
      }

      if (shape.type === "circle") {
        const center =
          shape.center &&
          Number.isFinite(shape.center.x) &&
          Number.isFinite(shape.center.y)
            ? {
                x: HOP.projection.normalizeCanonicalX(Number(shape.center.x)),
                y: Math.max(
                  0,
                  Math.min(
                    HOP.constants.TILE_SIZE * Math.pow(2, HOP.constants.CANONICAL_ZOOM),
                    Number(shape.center.y)
                  )
                )
              }
            : null;
        const radius = Number(shape.radius);
        if (!center || !Number.isFinite(radius) || radius <= 0) {
          return null;
        }

        const raw = shape.measurements && typeof shape.measurements === "object"
          ? shape.measurements
          : {};
        const rawVisibility = Array.isArray(raw.edgeVisibility) ? raw.edgeVisibility : [];

        return {
          ...shape,
          center,
          radius,
          measurements: {
            edgeVisibility: [typeof rawVisibility[0] === "boolean" ? rawVisibility[0] : true],
            areaVisible: typeof raw.areaVisible === "boolean" ? raw.areaVisible : true
          }
        };
      }

      if (!Array.isArray(shape.points) || !shape.points.length) {
        return null;
      }

      const edgeCount = shape.type === "line" ? 1 : shape.points.length;
      const raw = shape.measurements && typeof shape.measurements === "object"
        ? shape.measurements
        : {};
      const rawVisibility = Array.isArray(raw.edgeVisibility) ? raw.edgeVisibility : [];

      const measurements = {
        edgeVisibility: Array.from({ length: edgeCount }, (_, index) =>
          typeof rawVisibility[index] === "boolean" ? rawVisibility[index] : true
        )
      };

      if (shape.type === "rectangle" || shape.type === "polygon") {
        const rawOpenEdges = Array.isArray(raw.openEdges) ? raw.openEdges : [];
        measurements.openEdges = Array.from({ length: edgeCount }, (_, index) =>
          rawOpenEdges[index] === true
        );
        measurements.areaVisible =
          typeof raw.areaVisible === "boolean" ? raw.areaVisible : true;
      }

      const normalized = {
        ...shape,
        measurements
      };

      if (shape.type === "line") {
        if (typeof shape.connectionId === "string" && shape.connectionId.trim()) {
          normalized.connectionId = shape.connectionId.trim();
        } else {
          delete normalized.connectionId;
        }
      }

      return normalized;
    }

    _normalizeShapes(shapes) {
      return (Array.isArray(shapes) ? shapes : [])
        .map((shape) => this._normalizeShape(shape))
        .filter(Boolean);
    }

    _cloneShapes(shapes) {
      return JSON.parse(JSON.stringify(Array.isArray(shapes) ? shapes : []));
    }

    _canAutoSave() {
      return !!(this.active && this.currentPlanId);
    }

    _cancelAutoSave() {
      if (this.autoSaveTimerId) {
        window.clearTimeout(this.autoSaveTimerId);
        this.autoSaveTimerId = 0;
      }
      this.autoSavePending = false;
    }

    _reportAutoSaveFailure(message) {
      const normalized =
        typeof message === "string" && message.trim() ? message.trim() : "unknown error";
      const now = Date.now();
      const recentlyReported =
        normalized === this.autoSaveLastErrorMessage &&
        now - this.autoSaveLastErrorAt < 5000;
      if (recentlyReported) {
        return;
      }

      this.autoSaveLastErrorMessage = normalized;
      this.autoSaveLastErrorAt = now;
      if (this.ui) {
        this.ui.showStatus(`Auto-save failed: ${normalized}`);
      }
    }

    _scheduleAutoSave() {
      if (!this._canAutoSave()) {
        return;
      }

      this.autoSavePending = true;
      if (this.autoSaveTimerId) {
        window.clearTimeout(this.autoSaveTimerId);
      }

      this.autoSaveTimerId = window.setTimeout(() => {
        this.autoSaveTimerId = 0;
        void this._flushAutoSave();
      }, this.autoSaveDelayMs);
    }

    async _flushAutoSave() {
      if (!this.autoSavePending || !this._canAutoSave()) {
        this.autoSavePending = false;
        return;
      }

      if (this.autoSaveInFlight) {
        return;
      }

      this.autoSavePending = false;
      this.autoSaveInFlight = true;
      try {
        await this.saveCurrentPlan(undefined, {
          silent: true,
          source: "autosave"
        });
      } finally {
        this.autoSaveInFlight = false;
        if (this.autoSavePending) {
          this._scheduleAutoSave();
        }
      }
    }

    _recordHistory(snapshot, clearFuture) {
      const cloned = this._cloneShapes(snapshot);
      this.historyPast.push(cloned);
      if (this.historyPast.length > this.historyLimit) {
        this.historyPast.shift();
      }
      if (clearFuture !== false) {
        this.historyFuture = [];
      }
    }

    _pruneSelectionToExistingShapes() {
      const existingIds = new Set(this.shapes.map((shape) => shape.id));
      const selectedIds =
        this.selection && typeof this.selection.getSelectedIds === "function"
          ? this.selection.getSelectedIds()
          : (this.selection && this.selection.getSelectedId
              ? [this.selection.getSelectedId()].filter(Boolean)
              : []);

      if (!selectedIds.length) {
        return;
      }

      const kept = selectedIds.filter((id) => existingIds.has(id));
      if (!kept.length) {
        this.selection.clear();
        return;
      }

      if (kept.length !== selectedIds.length) {
        const primary = this.selection.getSelectedId();
        if (typeof this.selection.selectMany === "function") {
          this.selection.selectMany(kept, { primaryId: primary });
        } else if (kept.includes(primary)) {
          this.selection.select(primary);
        } else {
          this.selection.select(kept[0]);
        }
      }
    }

    _setShapes(nextShapes, options) {
      const opts = options && typeof options === "object" ? options : {};

      if (opts.recordHistory) {
        const snapshot = opts.historySnapshot ? opts.historySnapshot : this.shapes;
        this._recordHistory(snapshot, opts.clearFuture);
      }

      this.shapes = this._normalizeShapes(nextShapes);

      if (this.editShapeId && !this.shapes.some((shape) => shape.id === this.editShapeId)) {
        this.editShapeId = null;
      }

      this._pruneSelectionToExistingShapes();

      if (
        this.selectedEdge &&
        !this._isValidEdgeRef(this.selectedEdge.shapeId, this.selectedEdge.edgeIndex)
      ) {
        this.selectedEdge = null;
      }

      if (!opts.skipRender) {
        this._render();
      }

      this._scheduleAutoSave();
    }

    _setEditShapeId(shapeId) {
      this.editShapeId = shapeId || null;
      this._render();
    }

    _setTool(tool) {
      this.activeTool = tool;

      if (tool !== HOP.constants.TOOL.SELECT) {
        this.editShapeId = null;
        if (tool !== HOP.constants.TOOL.CONNECTION) {
          this.selectedEdge = null;
        }
      } else if (this.measurementSettings.sideToggleMode || this.measurementSettings.areaToggleMode) {
        this.selectedEdge = null;
      }

      if (this.ui) {
        this.ui.setActiveTool(tool);
        this.ui.setInteractionMode(tool);
      }
      this._render();
    }

    _refreshToolbarStates() {
      if (!this.ui) {
        return;
      }

      this.ui.setButtonState(
        HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTHS,
        this.measurementSettings.showAllLengths,
        this.measurementSettings.showAllLengths ? "Lengths: On" : "Lengths: Off"
      );

      this.ui.setButtonState(
        HOP.constants.TOOLBAR_ACTION.TOGGLE_AREAS,
        this.measurementSettings.showAllAreas,
        this.measurementSettings.showAllAreas ? "Areas: On" : "Areas: Off"
      );

      const isImperial = this.measurementSettings.unitSystem === "imperial";
      this.ui.setButtonState(
        HOP.constants.TOOLBAR_ACTION.TOGGLE_UNITS,
        isImperial,
        isImperial ? "Units: Imperial" : "Units: Metric"
      );

      this.ui.setButtonState(
        HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTH_PICK,
        this.measurementSettings.sideToggleMode,
        this.measurementSettings.sideToggleMode
          ? "Show/Unshow Length: ON"
          : "Show/Unshow Length"
      );

      this.ui.setButtonState(
        HOP.constants.TOOLBAR_ACTION.TOGGLE_AREA_PICK,
        this.measurementSettings.areaToggleMode,
        this.measurementSettings.areaToggleMode
          ? "Show/Unshow Area: ON"
          : "Show/Unshow Area"
      );

      this.ui.setButtonState(
        HOP.constants.TOOLBAR_ACTION.UNDO,
        this.historyPast.length > 0,
        "Undo"
      );

      this.ui.setButtonState(
        HOP.constants.TOOLBAR_ACTION.REDO,
        this.historyFuture.length > 0,
        "Redo"
      );
    }

    _toggleEdgeLengthVisibility(shapeId, edgeIndex) {
      const shapes = this.shapes.slice();
      const index = shapes.findIndex((shape) => shape.id === shapeId);
      if (index < 0) {
        return;
      }

      const shape = shapes[index];
      if (!shape.measurements || !Array.isArray(shape.measurements.edgeVisibility)) {
        return;
      }

      const edge = Number(edgeIndex);
      if (!Number.isInteger(edge) || edge < 0 || edge >= shape.measurements.edgeVisibility.length) {
        return;
      }

      const nextVisibility = shape.measurements.edgeVisibility.slice();
      nextVisibility[edge] = !nextVisibility[edge];

      shapes[index] = {
        ...shape,
        measurements: {
          ...shape.measurements,
          edgeVisibility: nextVisibility
        }
      };

      this._setShapes(shapes, { recordHistory: true });
      this._refreshToolbarStates();
    }

    _toggleAllLengths() {
      this.measurementSettings.showAllLengths = !this.measurementSettings.showAllLengths;
      this._refreshToolbarStates();
      this._render();
    }

    _toggleAllAreas() {
      this.measurementSettings.showAllAreas = !this.measurementSettings.showAllAreas;
      this._refreshToolbarStates();
      this._render();
    }

    _toggleUnitSystem() {
      this.measurementSettings.unitSystem =
        this.measurementSettings.unitSystem === "imperial" ? "metric" : "imperial";
      this._refreshToolbarStates();
      this._render();
      void this._persistUnitSystemPreference(this.measurementSettings.unitSystem);
      this.ui.showStatus(
        this.measurementSettings.unitSystem === "imperial"
          ? "Units set to Imperial."
          : "Units set to Metric."
      );
    }

    _toggleLengthPickMode() {
      this.measurementSettings.sideToggleMode = !this.measurementSettings.sideToggleMode;
      if (this.measurementSettings.sideToggleMode) {
        this.measurementSettings.areaToggleMode = false;
      }
      if (this.measurementSettings.sideToggleMode && this.activeTool !== HOP.constants.TOOL.SELECT) {
        this._setTool(HOP.constants.TOOL.SELECT);
      }
      if (this.measurementSettings.sideToggleMode) {
        this.selectedEdge = null;
      }

      this._refreshToolbarStates();

      if (this.measurementSettings.sideToggleMode) {
        this.ui.showStatus("Length toggle mode active. Click a side to show/hide its length.");
      } else {
        this.ui.showStatus("Length toggle mode disabled.");
      }

      this._render();
    }

    _toggleAreaPickMode() {
      this.measurementSettings.areaToggleMode = !this.measurementSettings.areaToggleMode;
      if (this.measurementSettings.areaToggleMode) {
        this.measurementSettings.sideToggleMode = false;
      }
      if (this.measurementSettings.areaToggleMode && this.activeTool !== HOP.constants.TOOL.SELECT) {
        this._setTool(HOP.constants.TOOL.SELECT);
      }
      if (this.measurementSettings.areaToggleMode) {
        this.selectedEdge = null;
      }

      this._refreshToolbarStates();

      if (this.measurementSettings.areaToggleMode) {
        this.ui.showStatus("Area toggle mode active. Click a rectangle, polygon, or circle to show/hide its area.");
      } else {
        this.ui.showStatus("Area toggle mode disabled.");
      }

      this._render();
    }

    _toggleShapeAreaVisibility(shapeId) {
      const shapes = this.shapes.slice();
      const shapeIndex = shapes.findIndex((shape) => shape.id === shapeId);
      if (shapeIndex < 0) {
        return false;
      }

      const shape = shapes[shapeIndex];
      if (
        !shape ||
        (
          shape.type !== "rectangle" &&
          shape.type !== "polygon" &&
          shape.type !== "circle"
        )
      ) {
        return false;
      }

      const measurements = shape.measurements && typeof shape.measurements === "object"
        ? shape.measurements
        : {};
      if (
        shape.type !== "circle" &&
        (
          !Array.isArray(shape.points) ||
          shape.points.length < 3
        )
      ) {
        return false;
      }

      if (
        shape.type !== "circle" &&
        Array.isArray(measurements.openEdges) &&
        measurements.openEdges.some(Boolean)
      ) {
        this.ui.showStatus("Area labels are unavailable for open shapes.");
        return false;
      }

      const nextAreaVisible = measurements.areaVisible === false;
      shapes[shapeIndex] = {
        ...shape,
        measurements: {
          ...measurements,
          areaVisible: nextAreaVisible
        }
      };

      this._setShapes(shapes, { recordHistory: true });
      this._refreshToolbarStates();

      const name = this._shapeNavigatorName(shape, shapeIndex);
      this.ui.showStatus(
        `${nextAreaVisible ? "Area shown" : "Area hidden"} for ${name}.`
      );
      return true;
    }

    _shapeEdgeCount(shape) {
      if (shape && shape.type === "circle") {
        return 1;
      }
      if (!shape || !Array.isArray(shape.points) || shape.points.length < 2) {
        return 0;
      }
      return shape.type === "line" ? 1 : shape.points.length;
    }

    _isValidEdgeRef(shapeId, edgeIndex) {
      if (!shapeId || !Number.isInteger(edgeIndex)) {
        return false;
      }
      const shape = this.shapes.find((candidate) => candidate.id === shapeId);
      if (!shape) {
        return false;
      }
      const edgeCount = this._shapeEdgeCount(shape);
      return edgeIndex >= 0 && edgeIndex < edgeCount;
    }

    _setSelectedEdge(shapeId, edgeIndex) {
      if (!this._isValidEdgeRef(shapeId, edgeIndex)) {
        this.selectedEdge = null;
        this._render();
        return false;
      }

      this.selectedEdge = { shapeId, edgeIndex };
      this.selection.select(shapeId);
      this._render();
      return true;
    }

    _deleteSelectedEdge() {
      if (!this.selectedEdge) {
        return false;
      }

      const { shapeId, edgeIndex } = this.selectedEdge;
      const shapeIndex = this.shapes.findIndex((shape) => shape.id === shapeId);
      if (shapeIndex < 0) {
        this.selectedEdge = null;
        this._render();
        return false;
      }

      const shape = this.shapes[shapeIndex];
      if (shape.type !== "rectangle" && shape.type !== "polygon") {
        return false;
      }

      const edgeCount = this._shapeEdgeCount(shape);
      if (edgeIndex < 0 || edgeIndex >= edgeCount) {
        return false;
      }

      const before = this._cloneShapes(this.shapes);
      const shapes = this._cloneShapes(this.shapes);
      const mutable = shapes[shapeIndex];
      const measurements = mutable.measurements && typeof mutable.measurements === "object"
        ? mutable.measurements
        : {};

      const openEdges = Array.isArray(measurements.openEdges)
        ? measurements.openEdges.slice(0, edgeCount)
        : Array.from({ length: edgeCount }, () => false);
      while (openEdges.length < edgeCount) {
        openEdges.push(false);
      }
      openEdges[edgeIndex] = true;

      const edgeVisibility = Array.isArray(measurements.edgeVisibility)
        ? measurements.edgeVisibility.slice(0, edgeCount)
        : Array.from({ length: edgeCount }, () => true);
      while (edgeVisibility.length < edgeCount) {
        edgeVisibility.push(true);
      }
      edgeVisibility[edgeIndex] = false;

      const remainingEdges = [];
      for (let i = 0; i < edgeCount; i += 1) {
        if (!openEdges[i]) {
          remainingEdges.push(i);
        }
      }

      if (remainingEdges.length === 1) {
        const onlyEdge = remainingEdges[0];
        const nextIndex = (onlyEdge + 1) % edgeCount;
        const lineShape = {
          id: mutable.id,
          type: "line",
          points: [
            { ...mutable.points[onlyEdge] },
            { ...mutable.points[nextIndex] }
          ],
          measurements: {
            edgeVisibility: [true]
          }
        };

        if (typeof mutable.connectionId === "string" && mutable.connectionId) {
          lineShape.connectionId = mutable.connectionId;
        }

        shapes[shapeIndex] = lineShape;
        this.selectedEdge = { shapeId: mutable.id, edgeIndex: 0 };
        this._setShapes(shapes, {
          recordHistory: true,
          historySnapshot: before
        });
        this.ui.showStatus("Side deleted. Shape collapsed to a single line.");
        return true;
      }

      mutable.measurements = {
        ...measurements,
        openEdges,
        edgeVisibility
      };

      this._setShapes(shapes, {
        recordHistory: true,
        historySnapshot: before
      });
      this.ui.showStatus("Side deleted. This shape is now open on that edge.");
      return true;
    }

    _edgeEndpoints(shape, edgeIndex) {
      if (
        shape &&
        shape.type === "circle" &&
        shape.center &&
        Number.isFinite(shape.center.x) &&
        Number.isFinite(shape.center.y) &&
        Number.isFinite(shape.radius) &&
        shape.radius > 0
      ) {
        const center = {
          x: HOP.projection.normalizeCanonicalX(shape.center.x),
          y: Math.max(
            0,
            Math.min(
              HOP.constants.TILE_SIZE * Math.pow(2, HOP.constants.CANONICAL_ZOOM),
              Number(shape.center.y)
            )
          )
        };
        const radius = Number(shape.radius);
        return {
          startIndex: 0,
          endIndex: 1,
          start: center,
          end: {
            x: HOP.projection.normalizeCanonicalX(center.x + radius),
            y: center.y
          }
        };
      }

      if (!shape || !Array.isArray(shape.points) || shape.points.length < 2) {
        return null;
      }

      if (shape.type === "line") {
        return {
          startIndex: 0,
          endIndex: 1,
          start: shape.points[0],
          end: shape.points[1]
        };
      }

      const n = shape.points.length;
      const i = edgeIndex;
      const j = (i + 1) % n;
      return {
        startIndex: i,
        endIndex: j,
        start: shape.points[i],
        end: shape.points[j]
      };
    }

    _edgeLengthMeters(shape, edgeIndex) {
      if (
        shape &&
        shape.type === "circle" &&
        shape.center &&
        Number.isFinite(shape.center.x) &&
        Number.isFinite(shape.center.y) &&
        Number.isFinite(shape.radius) &&
        shape.radius > 0
      ) {
        const center = {
          x: HOP.projection.normalizeCanonicalX(shape.center.x),
          y: Math.max(
            0,
            Math.min(
              HOP.constants.TILE_SIZE * Math.pow(2, HOP.constants.CANONICAL_ZOOM),
              Number(shape.center.y)
            )
          )
        };
        const edgePoint = {
          x: HOP.projection.normalizeCanonicalX(center.x + Number(shape.radius)),
          y: center.y
        };
        const centerLatLng = HOP.projection.canonicalToLatLng(center);
        const edgeLatLng = HOP.projection.canonicalToLatLng(edgePoint);
        const radiusMeters = HOP.projection.latLngDistanceMeters(centerLatLng, edgeLatLng);
        return 2 * radiusMeters;
      }

      const endpoints = this._edgeEndpoints(shape, edgeIndex);
      if (!endpoints) {
        return 0;
      }

      const a = HOP.projection.canonicalToLatLng(endpoints.start);
      const b = HOP.projection.canonicalToLatLng(endpoints.end);
      return HOP.projection.latLngDistanceMeters(a, b);
    }

    _lengthUnitWord() {
      return this.measurementSettings.unitSystem === "imperial" ? "feet" : "meters";
    }

    _lengthUnitSuffix() {
      return this.measurementSettings.unitSystem === "imperial" ? "ft" : "m";
    }

    _displayLengthFromMeters(meters) {
      const value = Number(meters);
      if (!Number.isFinite(value)) {
        return 0;
      }
      return this.measurementSettings.unitSystem === "imperial"
        ? value * 3.280839895013123
        : value;
    }

    _metersFromDisplayLength(displayLength) {
      const value = Number(displayLength);
      if (!Number.isFinite(value)) {
        return NaN;
      }
      return this.measurementSettings.unitSystem === "imperial"
        ? value / 3.280839895013123
        : value;
    }

    _normalizePoint(point) {
      const worldSize = HOP.constants.TILE_SIZE * Math.pow(2, HOP.constants.CANONICAL_ZOOM);
      return {
        x: HOP.projection.normalizeCanonicalX(point.x),
        y: Math.max(0, Math.min(worldSize, point.y))
      };
    }

    _translatedPoint(point, dx, dy) {
      return this._normalizePoint({
        x: point.x + dx,
        y: point.y + dy
      });
    }

    _canonicalVector(fromPoint, toPoint) {
      return {
        x: HOP.projection.wrapDeltaX(toPoint.x - fromPoint.x),
        y: toPoint.y - fromPoint.y
      };
    }

    _vectorLength(vector) {
      return Math.hypot(vector.x, vector.y);
    }

    _normalizeVector(vector) {
      const length = this._vectorLength(vector);
      if (!Number.isFinite(length) || length <= 0) {
        return null;
      }
      return {
        x: vector.x / length,
        y: vector.y / length
      };
    }

    _scaleVector(vector, scale) {
      return {
        x: vector.x * scale,
        y: vector.y * scale
      };
    }

    _addVector(point, vector) {
      return this._normalizePoint({
        x: point.x + vector.x,
        y: point.y + vector.y
      });
    }

    _subtractVector(point, vector) {
      return this._normalizePoint({
        x: point.x - vector.x,
        y: point.y - vector.y
      });
    }

    _rectangleFrame(points) {
      if (!Array.isArray(points) || points.length !== 4) {
        return null;
      }

      const baseX = points[0].x;
      const unwrapped = points.map((point) => ({
        x: baseX + HOP.projection.wrapDeltaX(point.x - baseX),
        y: point.y
      }));

      const center = unwrapped.reduce(
        (acc, point) => ({
          x: acc.x + point.x / 4,
          y: acc.y + point.y / 4
        }),
        { x: 0, y: 0 }
      );

      const rawU = {
        x: unwrapped[1].x - unwrapped[0].x,
        y: unwrapped[1].y - unwrapped[0].y
      };
      const rawV = {
        x: unwrapped[3].x - unwrapped[0].x,
        y: unwrapped[3].y - unwrapped[0].y
      };

      const uUnit = this._normalizeVector(rawU);
      if (!uUnit) {
        return null;
      }

      const dot = rawV.x * uUnit.x + rawV.y * uUnit.y;
      let perpV = {
        x: rawV.x - dot * uUnit.x,
        y: rawV.y - dot * uUnit.y
      };

      let vLength = this._vectorLength(perpV);
      if (!Number.isFinite(vLength) || vLength <= 0) {
        perpV = {
          x: -uUnit.y,
          y: uUnit.x
        };
        vLength = 1;
      }

      const cross = rawU.x * rawV.y - rawU.y * rawV.x;
      const orientationSign = cross >= 0 ? 1 : -1;
      let vUnit = this._normalizeVector(perpV);
      if (!vUnit) {
        return null;
      }
      vUnit = {
        x: vUnit.x * orientationSign,
        y: vUnit.y * orientationSign
      };

      const widthCanonical = this._vectorLength(rawU);
      const heightCanonical = vLength;

      if (!Number.isFinite(widthCanonical) || widthCanonical <= 0) {
        return null;
      }

      return {
        center,
        uUnit,
        vUnit,
        widthCanonical,
        heightCanonical
      };
    }

    _buildRectanglePointsFromFrame(frame, widthCanonical, heightCanonical) {
      const halfU = this._scaleVector(frame.uUnit, widthCanonical / 2);
      const halfV = this._scaleVector(frame.vUnit, heightCanonical / 2);

      const p0Unwrapped = {
        x: frame.center.x - halfU.x - halfV.x,
        y: frame.center.y - halfU.y - halfV.y
      };
      const p1Unwrapped = {
        x: frame.center.x + halfU.x - halfV.x,
        y: frame.center.y + halfU.y - halfV.y
      };
      const p2Unwrapped = {
        x: frame.center.x + halfU.x + halfV.x,
        y: frame.center.y + halfU.y + halfV.y
      };
      const p3Unwrapped = {
        x: frame.center.x - halfU.x + halfV.x,
        y: frame.center.y - halfU.y + halfV.y
      };

      return [
        this._normalizePoint(p0Unwrapped),
        this._normalizePoint(p1Unwrapped),
        this._normalizePoint(p2Unwrapped),
        this._normalizePoint(p3Unwrapped)
      ];
    }

    _promptAndSetEdgeLength(shapeId, edgeIndex) {
      if (!this._isValidEdgeRef(shapeId, edgeIndex)) {
        return false;
      }

      const shape = this.shapes.find((candidate) => candidate.id === shapeId);
      if (!shape) {
        return false;
      }

      const currentMeters = this._edgeLengthMeters(shape, edgeIndex);
      const currentDisplay = this._displayLengthFromMeters(currentMeters);
      const promptText =
        shape && shape.type === "circle"
          ? `Set diameter (${this._lengthUnitWord()}):`
          : `Set side length (${this._lengthUnitWord()}):`;
      const raw = window.prompt(promptText, Number(currentDisplay).toFixed(1));
      if (raw === null) {
        return false;
      }

      const targetDisplay = Number(String(raw).replace(/[^0-9.+-]/g, ""));
      const targetMeters = this._metersFromDisplayLength(targetDisplay);
      if (!Number.isFinite(targetMeters) || targetMeters <= 0) {
        this.ui.showStatus(
          `Invalid length. Enter a value in ${this._lengthUnitWord()}, for example 12.5`
        );
        return false;
      }

      return this._setShapeEdgeLength(shapeId, edgeIndex, targetMeters);
    }

    _setShapeEdgeLength(shapeId, edgeIndex, targetMeters) {
      const shapeIndex = this.shapes.findIndex((shape) => shape.id === shapeId);
      if (shapeIndex < 0) {
        return false;
      }

      const currentShape = this.shapes[shapeIndex];
      if (
        currentShape.type !== "circle" &&
        (!Array.isArray(currentShape.points) || currentShape.points.length < 2)
      ) {
        return false;
      }

      const endpoints = this._edgeEndpoints(currentShape, edgeIndex);
      if (!endpoints) {
        return false;
      }

      const currentMeters = this._edgeLengthMeters(currentShape, edgeIndex);
      if (!Number.isFinite(currentMeters) || currentMeters <= 0) {
        return false;
      }

      const ratio = targetMeters / currentMeters;
      if (!Number.isFinite(ratio) || ratio <= 0) {
        return false;
      }

      const dx = HOP.projection.wrapDeltaX(endpoints.end.x - endpoints.start.x);
      const dy = endpoints.end.y - endpoints.start.y;
      const deltaX = dx * ratio - dx;
      const deltaY = dy * ratio - dy;

      const before = this._cloneShapes(this.shapes);
      const shapes = this._cloneShapes(this.shapes);
      const mutable = shapes[shapeIndex];

      if (mutable.type === "rectangle") {
        const frame = this._rectangleFrame(mutable.points);
        if (!frame) {
          return false;
        }

        let widthCanonical = frame.widthCanonical;
        let heightCanonical = frame.heightCanonical;

        if (edgeIndex % 2 === 0) {
          widthCanonical = frame.widthCanonical * ratio;
        } else {
          heightCanonical = frame.heightCanonical * ratio;
        }

        if (
          !Number.isFinite(widthCanonical) ||
          !Number.isFinite(heightCanonical) ||
          widthCanonical <= 0 ||
          heightCanonical <= 0
        ) {
          return false;
        }

        mutable.points = this._buildRectanglePointsFromFrame(
          frame,
          widthCanonical,
          heightCanonical
        );
      } else if (mutable.type === "line") {
        mutable.points[1] = this._translatedPoint(mutable.points[1], deltaX, deltaY);
      } else if (
        mutable.type === "circle" &&
        mutable.center &&
        Number.isFinite(mutable.center.x) &&
        Number.isFinite(mutable.center.y) &&
        Number.isFinite(mutable.radius) &&
        mutable.radius > 0
      ) {
        const nextRadius = Number(mutable.radius) * ratio;
        if (!Number.isFinite(nextRadius) || nextRadius <= 0) {
          return false;
        }
        mutable.radius = nextRadius;
      } else {
        const endIndex = endpoints.endIndex;
        mutable.points[endIndex] = this._translatedPoint(mutable.points[endIndex], deltaX, deltaY);
      }

      this._setShapes(shapes, {
        recordHistory: true,
        historySnapshot: before
      });
      this.selection.select(shapeId);
      this._setSelectedEdge(shapeId, edgeIndex);
      const targetDisplay = this._displayLengthFromMeters(targetMeters);
      const unitSuffix = this._lengthUnitSuffix();
      if (currentShape.type === "circle") {
        this.ui.showStatus(`Diameter set to ${targetDisplay.toFixed(1)} ${unitSuffix}.`);
      } else {
        this.ui.showStatus(`Side length set to ${targetDisplay.toFixed(1)} ${unitSuffix}.`);
      }
      return true;
    }

    _connectLineEndpoints(fromEndpoint, toEndpoint) {
      const from = fromEndpoint && typeof fromEndpoint === "object" ? fromEndpoint : null;
      const to = toEndpoint && typeof toEndpoint === "object" ? toEndpoint : null;
      if (
        !from ||
        !to ||
        !from.shapeId ||
        !to.shapeId ||
        !Number.isInteger(from.vertexIndex) ||
        !Number.isInteger(to.vertexIndex)
      ) {
        return false;
      }

      const fromShapeIndex = this.shapes.findIndex((shape) => shape.id === from.shapeId);
      const toShapeIndex = this.shapes.findIndex((shape) => shape.id === to.shapeId);
      if (fromShapeIndex < 0 || toShapeIndex < 0) {
        return false;
      }

      const fromShape = this.shapes[fromShapeIndex];
      const toShape = this.shapes[toShapeIndex];
      if (
        fromShape.type !== "line" ||
        toShape.type !== "line" ||
        !Array.isArray(fromShape.points) ||
        !Array.isArray(toShape.points)
      ) {
        return false;
      }

      if (
        from.vertexIndex < 0 ||
        from.vertexIndex > 1 ||
        to.vertexIndex < 0 ||
        to.vertexIndex > 1
      ) {
        return false;
      }

      const before = this._cloneShapes(this.shapes);
      const shapes = this._cloneShapes(this.shapes);
      const mutableFrom = shapes[fromShapeIndex];
      const mutableTo = shapes[toShapeIndex];
      const anchor = mutableFrom.points[from.vertexIndex];

      if (!anchor) {
        return false;
      }

      mutableTo.points[to.vertexIndex] = {
        x: anchor.x,
        y: anchor.y
      };

      const connectionId =
        mutableFrom.connectionId ||
        mutableTo.connectionId ||
        HOP.ids.createId("connection");
      const fromConnectionId = mutableFrom.connectionId || null;
      const toConnectionId = mutableTo.connectionId || null;
      mutableFrom.connectionId = connectionId;
      mutableTo.connectionId = connectionId;

      if (fromConnectionId && toConnectionId && fromConnectionId !== toConnectionId) {
        shapes.forEach((shape) => {
          if (shape.type === "line" && shape.connectionId === toConnectionId) {
            shape.connectionId = connectionId;
          }
        });
      }

      this._setShapes(shapes, {
        recordHistory: true,
        historySnapshot: before
      });
      this.selection.select(from.shapeId);
      this.ui.showStatus("Connected line endpoints. Connected lines now move together.");
      return true;
    }

    _handleShortcutAction(action) {
      if (action === "select") {
        this._setTool(HOP.constants.TOOL.SELECT);
        return true;
      }
      if (action === "lasso") {
        this._setTool(HOP.constants.TOOL.LASSO);
        return true;
      }
      if (action === "pan") {
        this._setTool(HOP.constants.TOOL.PAN);
        return true;
      }
      if (action === "connection") {
        this._setTool(HOP.constants.TOOL.CONNECTION);
        return true;
      }
      if (action === "line") {
        this._setTool(HOP.constants.TOOL.LINE);
        return true;
      }
      if (action === "polygon") {
        this._setTool(HOP.constants.TOOL.POLYGON);
        return true;
      }
      if (action === "rectangle") {
        this._setTool(HOP.constants.TOOL.RECTANGLE);
        return true;
      }
      if (action === "circle") {
        this._setTool(HOP.constants.TOOL.CIRCLE);
        return true;
      }
      if (action === "label") {
        this._setTool(HOP.constants.TOOL.LABEL);
        return true;
      }
      if (action === "undo") {
        return this.undo();
      }
      if (action === "redo") {
        return this.redo();
      }
      if (action === "length") {
        this._toggleAllLengths();
        return true;
      }
      if (action === "showUnshowLength") {
        this._toggleLengthPickMode();
        return true;
      }
      if (action === "showUnshowArea") {
        this._toggleAreaPickMode();
        return true;
      }
      if (action === "rightAngleSnap") {
        return true;
      }
      if (action === "save") {
        void this.saveCurrentPlan();
        return true;
      }
      if (action === "exit") {
        this.exit();
        return true;
      }
      return false;
    }

    undo() {
      if (this.historyPast.length === 0) {
        return false;
      }

      const previous = this.historyPast.pop();
      this.historyFuture.push(this._cloneShapes(this.shapes));
      this.shapes = this._normalizeShapes(previous);

      if (this.editShapeId && !this.shapes.some((shape) => shape.id === this.editShapeId)) {
        this.editShapeId = null;
      }

      this._pruneSelectionToExistingShapes();

      if (
        this.selectedEdge &&
        !this._isValidEdgeRef(this.selectedEdge.shapeId, this.selectedEdge.edgeIndex)
      ) {
        this.selectedEdge = null;
      }

      this._refreshToolbarStates();
      this._render();
      this._scheduleAutoSave();
      return true;
    }

    redo() {
      if (this.historyFuture.length === 0) {
        return false;
      }

      const next = this.historyFuture.pop();
      this.historyPast.push(this._cloneShapes(this.shapes));
      this.shapes = this._normalizeShapes(next);

      if (this.editShapeId && !this.shapes.some((shape) => shape.id === this.editShapeId)) {
        this.editShapeId = null;
      }

      this._pruneSelectionToExistingShapes();

      if (
        this.selectedEdge &&
        !this._isValidEdgeRef(this.selectedEdge.shapeId, this.selectedEdge.edgeIndex)
      ) {
        this.selectedEdge = null;
      }

      this._refreshToolbarStates();
      this._render();
      this._scheduleAutoSave();
      return true;
    }

    _handleToolbarAction(action) {
      if (
        action === HOP.constants.TOOL.SELECT ||
        action === HOP.constants.TOOL.LASSO ||
        action === HOP.constants.TOOL.PAN ||
        action === HOP.constants.TOOL.CONNECTION ||
        action === HOP.constants.TOOL.LINE ||
        action === HOP.constants.TOOL.RECTANGLE ||
        action === HOP.constants.TOOL.CIRCLE ||
        action === HOP.constants.TOOL.POLYGON ||
        action === HOP.constants.TOOL.LABEL
      ) {
        this._setTool(action);
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTHS) {
        this._toggleAllLengths();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.TOGGLE_AREAS) {
        this._toggleAllAreas();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.TOGGLE_UNITS) {
        this._toggleUnitSystem();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTH_PICK) {
        this._toggleLengthPickMode();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.TOGGLE_AREA_PICK) {
        this._toggleAreaPickMode();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.COPY) {
        this.drawingTools.copySelectedShape();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.PASTE) {
        this.drawingTools.pasteCopiedShape();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.UNDO) {
        this.undo();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.REDO) {
        this.redo();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.DELETE_SELECTED) {
        this.drawingTools.deleteSelected();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.SAVE) {
        void this.saveCurrentPlan();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.EXIT) {
        this.exit();
      }
    }

    _handleNavigatorAction(payload) {
      const action = payload && typeof payload.action === "string" ? payload.action : "";
      const shapeId = payload && typeof payload.shapeId === "string" ? payload.shapeId : "";
      if (!shapeId) {
        return;
      }

      if (action === "find") {
        this._focusShape(shapeId);
      }
    }

    _render() {
      if (!this.renderer) {
        return;
      }

      this._refreshToolbarStates();
      if (this.ui) {
        this.ui.setNavigatorItems(
          this._buildNavigatorItems(),
          this.selection.getSelectedId()
        );
      }

      this.renderer.render({
        view: this._buildViewModel(),
        shapes: this.shapes,
        selectedId: this.selection.getSelectedId(),
        selectedIds:
          typeof this.selection.getSelectedIds === "function"
            ? this.selection.getSelectedIds()
            : [this.selection.getSelectedId()].filter(Boolean),
        selectedEdge: this.selectedEdge,
        editShapeId: this.editShapeId,
        draft: this.drawingTools ? this.drawingTools.getDraft() : null,
        measurementSettings: this.measurementSettings,
        activeTool: this.activeTool
      });
    }
  }

  HOP.OverlayManager = OverlayManager;
})();
