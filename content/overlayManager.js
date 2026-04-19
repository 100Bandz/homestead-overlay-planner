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
      this.activeTool = HOP.constants.TOOL.SELECT;
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
        sideToggleMode: false
      };
      this.boundResize = this._onResize.bind(this);
    }

    _getDefaultKeyBindings() {
      return {
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
      };
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
      this.ui.mount(this._handleToolbarAction.bind(this));
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
        toggleEdgeLengthVisibility: (shapeId, edgeIndex) =>
          this._toggleEdgeLengthVisibility(shapeId, edgeIndex),
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

      this._setTool(this.activeTool);
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

      const viewport = this._getMapViewportRect();
      this.currentMapState = HOP.MapState.parseMapUrl(window.location.href, {
        viewportHeight: viewport.height
      });

      this.ui.showStatus(`Loaded plan "${plan.name}".`);
      this._render();

      return {
        ok: true,
        status: this.getStatus(),
        plan
      };
    }

    async saveCurrentPlan(optionalName) {
      if (!this.currentMapState) {
        this.ui.showStatus(
          "Cannot save plan: unsupported Google Maps URL state."
        );
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
      this.ui.showStatus(`Saved plan "${saved.name}".`);

      return {
        ok: true,
        plan: saved,
        status: this.getStatus()
      };
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
      if (this.ui) {
        this.ui.clearStatus();
      }
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

    _normalizeShape(shape) {
      if (!shape || typeof shape !== "object" || typeof shape.type !== "string") {
        return null;
      }

      if (shape.type === "label") {
        if (!shape.point) {
          return null;
        }
        const rawBox = shape.labelBox && typeof shape.labelBox === "object" ? shape.labelBox : {};
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
              : 24
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

      const selectedId = this.selection.getSelectedId();
      if (selectedId && !this.shapes.some((shape) => shape.id === selectedId)) {
        this.selection.clear();
      }

      if (
        this.selectedEdge &&
        !this._isValidEdgeRef(this.selectedEdge.shapeId, this.selectedEdge.edgeIndex)
      ) {
        this.selectedEdge = null;
      }

      if (!opts.skipRender) {
        this._render();
      }
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
      } else if (this.measurementSettings.sideToggleMode) {
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

      this.ui.setButtonState(
        HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTH_PICK,
        this.measurementSettings.sideToggleMode,
        this.measurementSettings.sideToggleMode
          ? "Show/Unshow Length: ON"
          : "Show/Unshow Length"
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

    _toggleLengthPickMode() {
      this.measurementSettings.sideToggleMode = !this.measurementSettings.sideToggleMode;
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

    _shapeEdgeCount(shape) {
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
      const endpoints = this._edgeEndpoints(shape, edgeIndex);
      if (!endpoints) {
        return 0;
      }

      const a = HOP.projection.canonicalToLatLng(endpoints.start);
      const b = HOP.projection.canonicalToLatLng(endpoints.end);
      return HOP.projection.latLngDistanceMeters(a, b);
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

    _promptAndSetEdgeLength(shapeId, edgeIndex) {
      if (!this._isValidEdgeRef(shapeId, edgeIndex)) {
        return false;
      }

      const shape = this.shapes.find((candidate) => candidate.id === shapeId);
      if (!shape) {
        return false;
      }

      const current = this._edgeLengthMeters(shape, edgeIndex);
      const raw = window.prompt("Set side length (meters):", Number(current).toFixed(1));
      if (raw === null) {
        return false;
      }

      const target = Number(String(raw).replace(/[^0-9.+-]/g, ""));
      if (!Number.isFinite(target) || target <= 0) {
        this.ui.showStatus("Invalid length. Enter a value in meters, for example 12.5");
        return false;
      }

      return this._setShapeEdgeLength(shapeId, edgeIndex, target);
    }

    _setShapeEdgeLength(shapeId, edgeIndex, targetMeters) {
      const shapeIndex = this.shapes.findIndex((shape) => shape.id === shapeId);
      if (shapeIndex < 0) {
        return false;
      }

      const currentShape = this.shapes[shapeIndex];
      if (!Array.isArray(currentShape.points) || currentShape.points.length < 2) {
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

      if (mutable.type === "line") {
        mutable.points[1] = this._translatedPoint(mutable.points[1], deltaX, deltaY);
      } else if (mutable.type === "rectangle" && mutable.points.length === 4) {
        if (edgeIndex === 0) {
          mutable.points[1] = this._translatedPoint(mutable.points[1], deltaX, deltaY);
          mutable.points[2] = this._translatedPoint(mutable.points[2], deltaX, deltaY);
        } else if (edgeIndex === 1) {
          mutable.points[2] = this._translatedPoint(mutable.points[2], deltaX, deltaY);
          mutable.points[3] = this._translatedPoint(mutable.points[3], deltaX, deltaY);
        } else if (edgeIndex === 2) {
          mutable.points[3] = this._translatedPoint(mutable.points[3], deltaX, deltaY);
          mutable.points[0] = this._translatedPoint(mutable.points[0], deltaX, deltaY);
        } else if (edgeIndex === 3) {
          mutable.points[0] = this._translatedPoint(mutable.points[0], deltaX, deltaY);
          mutable.points[1] = this._translatedPoint(mutable.points[1], deltaX, deltaY);
        }
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
      this.ui.showStatus(`Side length set to ${targetMeters.toFixed(1)} m.`);
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
      if (action === "save") {
        this.saveCurrentPlan();
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

      const selectedId = this.selection.getSelectedId();
      if (selectedId && !this.shapes.some((shape) => shape.id === selectedId)) {
        this.selection.clear();
      }

      if (
        this.selectedEdge &&
        !this._isValidEdgeRef(this.selectedEdge.shapeId, this.selectedEdge.edgeIndex)
      ) {
        this.selectedEdge = null;
      }

      this._refreshToolbarStates();
      this._render();
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

      const selectedId = this.selection.getSelectedId();
      if (selectedId && !this.shapes.some((shape) => shape.id === selectedId)) {
        this.selection.clear();
      }

      if (
        this.selectedEdge &&
        !this._isValidEdgeRef(this.selectedEdge.shapeId, this.selectedEdge.edgeIndex)
      ) {
        this.selectedEdge = null;
      }

      this._refreshToolbarStates();
      this._render();
      return true;
    }

    _handleToolbarAction(action) {
      if (
        action === HOP.constants.TOOL.SELECT ||
        action === HOP.constants.TOOL.PAN ||
        action === HOP.constants.TOOL.CONNECTION ||
        action === HOP.constants.TOOL.LINE ||
        action === HOP.constants.TOOL.RECTANGLE ||
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

      if (action === HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTH_PICK) {
        this._toggleLengthPickMode();
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
        this.saveCurrentPlan();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.EXIT) {
        this.exit();
      }
    }

    _render() {
      if (!this.renderer) {
        return;
      }

      this._refreshToolbarStates();

      this.renderer.render({
        view: this._buildViewModel(),
        shapes: this.shapes,
        selectedId: this.selection.getSelectedId(),
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
