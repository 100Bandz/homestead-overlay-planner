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
      this.measurementSettings = {
        showAllLengths: true,
        showAllAreas: true,
        sideToggleMode: false
      };
      this.boundResize = this._onResize.bind(this);
    }

    start() {
      if (this.active) {
        const currentState = HOP.MapState.parseMapUrl(window.location.href);
        if (currentState) {
          this._onMapStateChanged(currentState);
          this.ui.showStatus("Planning mode active.");
        } else {
          this._onUnsupportedView();
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
        setShapes: (shapes, options) => this._setShapes(shapes, options),
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
        prepareNewShape: (shape) => this._normalizeShape(shape)
      });

      this.drawingTools.attach();
      this.mapWatcher.start();
      window.addEventListener("resize", this.boundResize);
      this.active = true;

      const current = HOP.MapState.parseMapUrl(window.location.href);
      if (!current) {
        this.ui.showStatus(
          "Unsupported Google Maps view. Please switch to the standard map view."
        );
      } else {
        this.currentMapState = current;
      }

      this._setTool(this.activeTool);
      this._refreshToolbarStates();
      this._render();

      return { ok: true, status: this.getStatus() };
    }

    async loadPlan(planId) {
      if (!planId) {
        return { ok: false, error: "Missing plan id" };
      }

      this.start();

      const plan = await this.storage.getPlan(planId);
      if (!plan) {
        this.ui.showStatus("Plan not found.");
        return { ok: false, error: "Plan not found" };
      }

      this.shapes = this._normalizeShapes(
        Array.isArray(plan.shapes) ? JSON.parse(JSON.stringify(plan.shapes)) : []
      );

      this.currentPlanId = plan.id;
      this.currentPlanName = plan.name;
      this.selection.clear();
      this.drawingTools.cancelCurrentDrawing();

      const currentMap = HOP.MapState.parseMapUrl(window.location.href);
      const isCurrentViewValid = !!currentMap;

      if (!isCurrentViewValid) {
        this.ui.showStatus(
          `Loaded plan "${plan.name}". Switch to standard map view to render accurately.`,
          {
            actionLabel: "Jump To Saved View",
            action: () => {
              if (plan.source && plan.source.url) {
                window.location.href = plan.source.url;
              }
            }
          }
        );
      } else {
        const distance = HOP.projection.latLngDistanceMeters(
          { lat: currentMap.lat, lng: currentMap.lng },
          { lat: plan.source.lat, lng: plan.source.lng }
        );
        const zoomDiff = Math.abs(currentMap.zoom - plan.source.zoom);

        if (distance > 300 || zoomDiff > 1.5) {
          this.ui.showStatus(`Loaded plan "${plan.name}" from a different view.`, {
            actionLabel: "Jump To Saved View",
            action: () => {
              if (plan.source && plan.source.url) {
                window.location.href = plan.source.url;
              }
            }
          });
        } else {
          this.ui.showStatus(`Loaded plan "${plan.name}".`);
        }
      }

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

      const defaultName = existing ? existing.name : "Homestead Plan";
      const chosenName =
        typeof optionalName === "string" && optionalName.trim()
          ? optionalName.trim()
          : (window.prompt("Save plan as:", defaultName) || "").trim();

      if (!chosenName) {
        return { ok: false, cancelled: true };
      }

      const viewport = this._getMapViewportRect();
      const now = new Date().toISOString();
      const plan = {
        id: existing ? existing.id : HOP.ids.createId("plan"),
        name: chosenName,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        source: {
          url: window.location.href,
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
        measurements.areaVisible =
          typeof raw.areaVisible === "boolean" ? raw.areaVisible : true;
      }

      return {
        ...shape,
        measurements
      };
    }

    _normalizeShapes(shapes) {
      return (Array.isArray(shapes) ? shapes : [])
        .map((shape) => this._normalizeShape(shape))
        .filter(Boolean);
    }

    _setShapes(nextShapes, options) {
      this.shapes = this._normalizeShapes(nextShapes);
      if (!options || !options.skipRender) {
        this._render();
      }
    }

    _setTool(tool) {
      this.activeTool = tool;
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

      this._setShapes(shapes);
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

      this._refreshToolbarStates();

      if (this.measurementSettings.sideToggleMode) {
        this.ui.showStatus("Length toggle mode active. Click a side to show/hide its length.");
      } else {
        this.ui.showStatus("Length toggle mode disabled.");
      }

      this._render();
    }

    _handleToolbarAction(action) {
      if (
        action === HOP.constants.TOOL.SELECT ||
        action === HOP.constants.TOOL.PAN ||
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
        this.drawingTools.undoLast();
        this._render();
        return;
      }

      if (action === HOP.constants.TOOLBAR_ACTION.DELETE_SELECTED) {
        this.drawingTools.deleteSelected();
        this._render();
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

      this.renderer.render({
        view: this._buildViewModel(),
        shapes: this.shapes,
        selectedId: this.selection.getSelectedId(),
        draft: this.drawingTools ? this.drawingTools.getDraft() : null,
        measurementSettings: this.measurementSettings
      });
    }
  }

  HOP.OverlayManager = OverlayManager;
})();
