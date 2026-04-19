(() => {
  const HOP = (window.HOP = window.HOP || {});
  const WORLD_SIZE = HOP.constants.TILE_SIZE * Math.pow(2, HOP.constants.CANONICAL_ZOOM);

  class DrawingTools {
    constructor(options) {
      this.svg = options.svg;
      this.getView = options.getView;
      this.getTool = options.getTool;
      this.getShapes = options.getShapes;
      this.setShapes = options.setShapes;
      this.selection = options.selection;
      this.requestRender = options.requestRender;
      this.promptLabelText = options.promptLabelText;
      this.reportStatus = options.reportStatus;
      this.isLengthPickMode =
        typeof options.isLengthPickMode === "function" ? options.isLengthPickMode : () => false;
      this.isAreaPickMode =
        typeof options.isAreaPickMode === "function" ? options.isAreaPickMode : () => false;
      this.toggleEdgeLengthVisibility =
        typeof options.toggleEdgeLengthVisibility === "function"
          ? options.toggleEdgeLengthVisibility
          : () => {};
      this.toggleShapeAreaVisibility =
        typeof options.toggleShapeAreaVisibility === "function"
          ? options.toggleShapeAreaVisibility
          : () => false;
      this.prepareNewShape =
        typeof options.prepareNewShape === "function" ? options.prepareNewShape : (shape) => shape;
      this.requestUndo =
        typeof options.requestUndo === "function" ? options.requestUndo : () => false;
      this.requestRedo =
        typeof options.requestRedo === "function" ? options.requestRedo : () => false;
      this.getKeyBindings =
        typeof options.getKeyBindings === "function" ? options.getKeyBindings : () => ({});
      this.triggerShortcutAction =
        typeof options.triggerShortcutAction === "function"
          ? options.triggerShortcutAction
          : () => false;
      this.getEditShapeId =
        typeof options.getEditShapeId === "function" ? options.getEditShapeId : () => null;
      this.setEditShapeId =
        typeof options.setEditShapeId === "function" ? options.setEditShapeId : () => {};
      this.getSelectedEdge =
        typeof options.getSelectedEdge === "function" ? options.getSelectedEdge : () => null;
      this.setSelectedEdge =
        typeof options.setSelectedEdge === "function" ? options.setSelectedEdge : () => false;
      this.clearSelectedEdge =
        typeof options.clearSelectedEdge === "function" ? options.clearSelectedEdge : () => {};
      this.deleteSelectedEdge =
        typeof options.deleteSelectedEdge === "function" ? options.deleteSelectedEdge : () => false;
      this.requestSetEdgeLength =
        typeof options.requestSetEdgeLength === "function"
          ? options.requestSetEdgeLength
          : () => false;
      this.connectLineEndpoints =
        typeof options.connectLineEndpoints === "function"
          ? options.connectLineEndpoints
          : () => false;

      this.copiedShape = null;
      this.draft = null;
      this.pointerDrawing = null;
      this.draggingShape = null;
      this.draggingLabelControl = null;
      this.draggingVertex = null;
      this.draggingRotate = null;
      this.connectionDraft = null;
      this.lastEdgeMeasurementTap = null;
      this.boundPointerDown = this._onPointerDown.bind(this);
      this.boundPointerMove = this._onPointerMove.bind(this);
      this.boundPointerUp = this._onPointerUp.bind(this);
      this.boundClick = this._onClick.bind(this);
      this.boundDoubleClick = this._onDoubleClick.bind(this);
      this.boundKeyDown = this._onKeyDown.bind(this);
    }

    attach() {
      this.svg.addEventListener("pointerdown", this.boundPointerDown);
      this.svg.addEventListener("pointermove", this.boundPointerMove);
      this.svg.addEventListener("pointerup", this.boundPointerUp);
      this.svg.addEventListener("click", this.boundClick);
      this.svg.addEventListener("dblclick", this.boundDoubleClick);
      window.addEventListener("keydown", this.boundKeyDown);
    }

    detach() {
      this.svg.removeEventListener("pointerdown", this.boundPointerDown);
      this.svg.removeEventListener("pointermove", this.boundPointerMove);
      this.svg.removeEventListener("pointerup", this.boundPointerUp);
      this.svg.removeEventListener("click", this.boundClick);
      this.svg.removeEventListener("dblclick", this.boundDoubleClick);
      window.removeEventListener("keydown", this.boundKeyDown);
      this.cancelCurrentDrawing();
    }

    getDraft() {
      return this.draft;
    }

    _cloneShapes(shapes) {
      return JSON.parse(JSON.stringify(Array.isArray(shapes) ? shapes : []));
    }

    cancelCurrentDrawing() {
      this.draft = null;
      this.pointerDrawing = null;
      this.draggingShape = null;
      this.draggingLabelControl = null;
      this.draggingVertex = null;
      this.draggingRotate = null;
      this.connectionDraft = null;
      this.lastEdgeMeasurementTap = null;
      this.requestRender();
    }

    undoLast() {
      if (this.draft) {
        this.cancelCurrentDrawing();
        return;
      }

      this.requestUndo();
    }

    redoLast() {
      this.requestRedo();
    }

    deleteSelected() {
      if (this.deleteSelectedEdge()) {
        return;
      }

      const selectedIds =
        this.selection && typeof this.selection.getSelectedIds === "function"
          ? this.selection.getSelectedIds()
          : [this.selection.getSelectedId()].filter(Boolean);

      if (!selectedIds.length) {
        return;
      }

      const before = this._cloneShapes(this.getShapes());
      const selectedSet = new Set(selectedIds);
      const filtered = this.getShapes().filter((shape) => !selectedSet.has(shape.id));
      this.selection.clear();
      this.setEditShapeId(null);
      this.clearSelectedEdge();
      this.setShapes(filtered, {
        recordHistory: true,
        historySnapshot: before
      });
    }

    _isTypingContext() {
      const active = document.activeElement;
      if (!active) {
        return false;
      }

      const tag = String(active.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        return true;
      }

      return !!active.isContentEditable;
    }

    _editLabelText(shapeId, promptText) {
      const shape = this._findShapeById(shapeId);
      if (!shape || shape.type !== "label") {
        return false;
      }

      const text = this.promptLabelText(shape.text || "", promptText || "Edit label text:");
      if (typeof text !== "string" || !text.trim()) {
        return false;
      }

      const before = this._cloneShapes(this.getShapes());
      const shapes = this.getShapes().map((candidate) =>
        candidate.id === shape.id ? { ...candidate, text: text.trim() } : candidate
      );

      this.setShapes(shapes, {
        recordHistory: true,
        historySnapshot: before
      });
      return true;
    }

    _isCopyableShape(shape) {
      if (!shape || typeof shape !== "object") {
        return false;
      }

      return (
        shape.type === "line" ||
        shape.type === "rectangle" ||
        shape.type === "polygon" ||
        shape.type === "label"
      );
    }

    _copySelectedShape() {
      const selectedId = this.selection.getSelectedId();
      if (!selectedId) {
        this.reportStatus("Select a line, rectangle, polygon, or label first.");
        return false;
      }

      const shape = this._findShapeById(selectedId);
      if (!this._isCopyableShape(shape)) {
        this.reportStatus("Only line, rectangle, polygon, and label shapes can be copied.");
        return false;
      }

      this.copiedShape = JSON.parse(JSON.stringify(shape));
      this.reportStatus("Shape copied.");
      return true;
    }

    _offsetPoint(point, dx, dy) {
      return {
        x: HOP.projection.normalizeCanonicalX(Number(point.x) + dx),
        y: this._normalizeY(Number(point.y) + dy)
      };
    }

    _offsetCopyShape(shape, dx, dy) {
      const clone = JSON.parse(JSON.stringify(shape || {}));
      if (clone.type === "label") {
        if (clone.point && Number.isFinite(clone.point.x) && Number.isFinite(clone.point.y)) {
          clone.point = this._offsetPoint(clone.point, dx, dy);
        }
        return clone;
      }

      if (!Array.isArray(clone.points)) {
        clone.points = [];
      }
      clone.points = clone.points.map((point) => this._offsetPoint(point, dx, dy));
      return clone;
    }

    _pasteCopiedShape() {
      if (!this._isCopyableShape(this.copiedShape)) {
        this.reportStatus("Copy a line, rectangle, polygon, or label first.");
        return false;
      }

      const view = this.getView();
      const offsetScreenPixels = 24;
      const offsetCanonical = view ? view.scale * offsetScreenPixels : 0;

      const pasted = this._offsetCopyShape(
        this.copiedShape,
        offsetCanonical,
        offsetCanonical
      );

      if (pasted.type === "label") {
        if (!pasted.point || !Number.isFinite(pasted.point.x) || !Number.isFinite(pasted.point.y)) {
          this.reportStatus("Could not paste shape.");
          return false;
        }
      } else if (!Array.isArray(pasted.points) || pasted.points.length < 2) {
        this.reportStatus("Could not paste shape.");
        return false;
      }

      if (pasted.type === "line") {
        delete pasted.connectionId;
      }

      pasted.id = HOP.ids.createId(
        pasted.type === "label" ? "shape_label" : `shape_${pasted.type || "copy"}`
      );
      this._appendShape(pasted);
      this.setEditShapeId(null);
      this.clearSelectedEdge();
      this.requestRender();
      this.reportStatus("Shape pasted.");
      return true;
    }

    copySelectedShape() {
      return this._copySelectedShape();
    }

    pasteCopiedShape() {
      return this._pasteCopiedShape();
    }

    _normalizeShortcut(shortcut) {
      return typeof shortcut === "string" ? shortcut.trim().toLowerCase() : "";
    }

    _eventToShortcut(event) {
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

    _matchShortcutAction(shortcut) {
      const normalized = this._normalizeShortcut(shortcut);
      if (!normalized) {
        return "";
      }

      const bindings = this.getKeyBindings() || {};
      const actions = Object.keys(bindings);
      for (let i = 0; i < actions.length; i += 1) {
        const action = actions[i];
        if (this._normalizeShortcut(bindings[action]) === normalized) {
          return action;
        }
      }

      return "";
    }

    _onKeyDown(event) {
      if (this._isTypingContext()) {
        return;
      }

      const keyLower = String(event.key || "").toLowerCase();
      const hasPrimaryModifier = !!(event.ctrlKey || event.metaKey);
      const isPlainPrimary = hasPrimaryModifier && !event.shiftKey && !event.altKey;

      if (isPlainPrimary && keyLower === "c") {
        if (this._copySelectedShape()) {
          event.preventDefault();
        }
        return;
      }

      if (isPlainPrimary && keyLower === "v") {
        if (this._pasteCopiedShape()) {
          event.preventDefault();
        }
        return;
      }

      if (isPlainPrimary && keyLower === "a") {
        const allIds = this.getShapes()
          .map((shape) => (shape && typeof shape.id === "string" ? shape.id : ""))
          .filter(Boolean);
        if (!allIds.length) {
          return;
        }

        if (this.selection && typeof this.selection.selectMany === "function") {
          this.selection.selectMany(allIds, { primaryId: this.selection.getSelectedId() || allIds[0] });
        } else if (allIds[0]) {
          this.selection.select(allIds[0]);
        }

        this.clearSelectedEdge();
        this.setEditShapeId(null);
        this.requestRender();
        this.reportStatus(`Selected ${allIds.length} shapes.`);
        event.preventDefault();
        return;
      }

      const shortcut = this._eventToShortcut(event);
      const action = this._matchShortcutAction(shortcut);
      if (action) {
        const handled = this.triggerShortcutAction(action);
        if (handled) {
          event.preventDefault();
          return;
        }
      }

      if (event.key === "Escape") {
        this.cancelCurrentDrawing();
        this.selection.clear();
        this.setEditShapeId(null);
        this.clearSelectedEdge();
        this.requestRender();
        return;
      }

      if (
        this.getTool() === HOP.constants.TOOL.SELECT &&
        (event.key === "Delete" || event.key === "Backspace") &&
        (this.selection.getSelectedId() || this.getSelectedEdge())
      ) {
        event.preventDefault();
        this.deleteSelected();
        return;
      }

      if (this.getTool() === HOP.constants.TOOL.SELECT && event.key === "Enter") {
        const selectedId = this.selection.getSelectedId();
        if (!selectedId) {
          return;
        }

        const selected = this._findShapeById(selectedId);
        if (selected && selected.type === "label") {
          event.preventDefault();
          this._editLabelText(selectedId, "Edit label text:");
        }
      }
    }

    _screenPointFromEvent(event) {
      return {
        x: event.clientX,
        y: event.clientY
      };
    }

    _canonicalPointFromEvent(event) {
      const view = this.getView();
      if (!view) {
        return null;
      }
      return HOP.projection.screenToCanonical(this._screenPointFromEvent(event), view);
    }

    _findShapeIdFromEventTarget(target) {
      const elementTarget = this._elementTarget(target);
      const shapeNode =
        elementTarget && elementTarget.closest ? elementTarget.closest("[data-shape-id]") : null;
      return shapeNode ? shapeNode.getAttribute("data-shape-id") : null;
    }

    _elementTarget(target) {
      if (!target) {
        return null;
      }
      if (target.nodeType === 3) {
        return target.parentElement || null;
      }
      return target;
    }

    _findShapeById(shapeId) {
      return this.getShapes().find((shape) => shape.id === shapeId) || null;
    }

    _findEdgeToggleFromTarget(target) {
      const elementTarget = this._elementTarget(target);
      const node =
        elementTarget && elementTarget.closest
          ? elementTarget.closest("[data-edge-toggle='true']")
          : null;
      if (!node) {
        return null;
      }

      const shapeId = node.getAttribute("data-shape-id");
      const edgeIndex = Number(node.getAttribute("data-edge-index"));
      if (!shapeId || !Number.isInteger(edgeIndex)) {
        return null;
      }

      return {
        shapeId,
        edgeIndex
      };
    }

    _findEdgeMeasurementFromTarget(target) {
      const elementTarget = this._elementTarget(target);
      const node =
        elementTarget && elementTarget.closest
          ? elementTarget.closest("[data-edge-measurement='true']")
          : null;
      if (!node) {
        return null;
      }

      const shapeId = node.getAttribute("data-shape-id");
      const edgeIndex = Number(node.getAttribute("data-edge-index"));
      if (!shapeId || !Number.isInteger(edgeIndex)) {
        return null;
      }

      return {
        shapeId,
        edgeIndex
      };
    }

    _isMeasurementVisualTarget(target) {
      const elementTarget = this._elementTarget(target);
      if (!elementTarget) {
        return false;
      }

      if (
        elementTarget.closest &&
        (elementTarget.closest(".hop-edge-measurement") ||
          elementTarget.closest(".hop-edge-measurement-hit") ||
          elementTarget.closest(".hop-measurement-text") ||
          elementTarget.closest(".hop-measurement-box"))
      ) {
        return true;
      }

      return false;
    }

    _findLabelControlFromTarget(target) {
      const elementTarget = this._elementTarget(target);
      const controlNode =
        elementTarget && elementTarget.closest ? elementTarget.closest("[data-label-control]") : null;
      if (!controlNode) {
        return null;
      }

      const control = controlNode.getAttribute("data-label-control");
      const shapeNode = controlNode.closest("[data-shape-id]");
      const shapeId = shapeNode ? shapeNode.getAttribute("data-shape-id") : null;

      if (!shapeId || !control) {
        return null;
      }

      if (control !== "bubble" && control !== "resize") {
        return null;
      }

      return {
        shapeId,
        control
      };
    }

    _findVertexHandleFromTarget(target) {
      const elementTarget = this._elementTarget(target);
      const handleNode =
        elementTarget && elementTarget.closest
          ? elementTarget.closest("[data-vertex-handle='true']")
          : null;
      if (!handleNode) {
        return null;
      }

      const shapeId = handleNode.getAttribute("data-shape-id");
      const vertexIndex = Number(handleNode.getAttribute("data-vertex-index"));
      if (!shapeId || !Number.isInteger(vertexIndex)) {
        return null;
      }

      return {
        shapeId,
        vertexIndex
      };
    }

    _findConnectionEndpointFromTarget(target) {
      const elementTarget = this._elementTarget(target);
      const node =
        elementTarget && elementTarget.closest
          ? elementTarget.closest("[data-connection-endpoint='true']")
          : null;
      if (!node) {
        return null;
      }

      const shapeId = node.getAttribute("data-shape-id");
      const vertexIndex = Number(node.getAttribute("data-vertex-index"));
      if (!shapeId || !Number.isInteger(vertexIndex)) {
        return null;
      }

      return {
        shapeId,
        vertexIndex
      };
    }

    _findRotateHandleFromTarget(target) {
      const elementTarget = this._elementTarget(target);
      const node =
        elementTarget && elementTarget.closest
          ? elementTarget.closest("[data-rotate-handle='true']")
          : null;
      if (!node) {
        return null;
      }

      const shapeId = node.getAttribute("data-shape-id");
      if (!shapeId) {
        return null;
      }

      return { shapeId };
    }

    _normalizeY(value) {
      return Math.max(0, Math.min(WORLD_SIZE, value));
    }

    _currentViewScale() {
      const view = this.getView ? this.getView() : null;
      const scale = view ? Number(view.scale) : NaN;
      return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    _labelZoomFactor(labelBox, currentScale) {
      const rawReferenceScale = labelBox ? Number(labelBox.referenceScale) : NaN;
      const referenceScale =
        Number.isFinite(rawReferenceScale) && rawReferenceScale > 0
          ? rawReferenceScale
          : currentScale;
      return Math.max(0.35, Math.min(1, referenceScale / currentScale));
    }

    _renderedLabelBox(labelBox, currentScale) {
      const source = labelBox && typeof labelBox === "object" ? labelBox : {};
      const baseOffsetX = Number(source.offsetX);
      const baseOffsetY = Number(source.offsetY);
      const baseWidth = Number(source.width);
      const baseHeight = Number(source.height);
      const zoomFactor = this._labelZoomFactor(source, currentScale);

      return {
        offsetX: (Number.isFinite(baseOffsetX) ? baseOffsetX : 10) * zoomFactor,
        offsetY: (Number.isFinite(baseOffsetY) ? baseOffsetY : -28) * zoomFactor,
        width: Math.max(24, Math.min(360, (Number.isFinite(baseWidth) ? baseWidth : 96) * zoomFactor)),
        height: Math.max(12, Math.min(120, (Number.isFinite(baseHeight) ? baseHeight : 24) * zoomFactor))
      };
    }

    _averageCanonicalPoints(points) {
      if (!Array.isArray(points) || !points.length) {
        return null;
      }

      const anchorX = points[0].x;
      let sumX = anchorX;
      let sumY = Number(points[0].y) || 0;

      for (let i = 1; i < points.length; i += 1) {
        const point = points[i];
        sumX += anchorX + HOP.projection.wrapDeltaX(point.x - anchorX);
        sumY += Number(point.y) || 0;
      }

      return {
        x: HOP.projection.normalizeCanonicalX(sumX / points.length),
        y: this._normalizeY(sumY / points.length)
      };
    }

    _shapeRotationPivot(shape) {
      if (!shape) {
        return null;
      }

      if (shape.type === "label" && shape.point) {
        return {
          x: HOP.projection.normalizeCanonicalX(shape.point.x),
          y: this._normalizeY(shape.point.y)
        };
      }

      if (!Array.isArray(shape.points) || shape.points.length === 0) {
        return null;
      }

      if (shape.type === "line" && shape.points.length >= 2) {
        const a = shape.points[0];
        const b = shape.points[1];
        const bUnwrappedX = a.x + HOP.projection.wrapDeltaX(b.x - a.x);
        return {
          x: HOP.projection.normalizeCanonicalX((a.x + bUnwrappedX) / 2),
          y: this._normalizeY((a.y + b.y) / 2)
        };
      }

      return this._averageCanonicalPoints(shape.points);
    }

    _rotationPivotForShapeIds(shapeIds, startShapesById) {
      if (!Array.isArray(shapeIds) || shapeIds.length === 0) {
        return null;
      }

      if (shapeIds.length === 1) {
        const onlyShape = startShapesById ? startShapesById[shapeIds[0]] : null;
        return this._shapeRotationPivot(onlyShape);
      }

      const aggregatePoints = [];
      shapeIds.forEach((shapeId) => {
        const shape = startShapesById ? startShapesById[shapeId] : null;
        if (!shape) {
          return;
        }
        if (shape.type === "label" && shape.point) {
          aggregatePoints.push(shape.point);
          return;
        }
        if (Array.isArray(shape.points)) {
          shape.points.forEach((point) => aggregatePoints.push(point));
        }
      });

      return this._averageCanonicalPoints(aggregatePoints);
    }

    _normalizeAngleDelta(delta) {
      if (!Number.isFinite(delta)) {
        return 0;
      }
      let normalized = delta;
      while (normalized > Math.PI) {
        normalized -= Math.PI * 2;
      }
      while (normalized < -Math.PI) {
        normalized += Math.PI * 2;
      }
      return normalized;
    }

    _rotateShape(shape, pivot, angleDelta) {
      if (!shape || !pivot || !Number.isFinite(angleDelta)) {
        return shape;
      }

      const cos = Math.cos(angleDelta);
      const sin = Math.sin(angleDelta);
      const rotatePoint = (point) => {
        const dx = HOP.projection.wrapDeltaX(point.x - pivot.x);
        const dy = point.y - pivot.y;
        return {
          x: HOP.projection.normalizeCanonicalX(pivot.x + dx * cos - dy * sin),
          y: this._normalizeY(pivot.y + dx * sin + dy * cos)
        };
      };

      if (shape.type === "label" && shape.point) {
        return {
          ...shape,
          point: rotatePoint(shape.point)
        };
      }

      if (Array.isArray(shape.points) && shape.points.length) {
        return {
          ...shape,
          points: shape.points.map(rotatePoint)
        };
      }

      return shape;
    }

    _translateShape(shape, dx, dy) {
      if (!shape) {
        return shape;
      }

      const normalizePoint = (point) => ({
        x: HOP.projection.normalizeCanonicalX(point.x + dx),
        y: this._normalizeY(point.y + dy)
      });

      if (shape.type === "label" && shape.point) {
        return {
          ...shape,
          point: normalizePoint(shape.point)
        };
      }

      if (Array.isArray(shape.points)) {
        return {
          ...shape,
          points: shape.points.map(normalizePoint)
        };
      }

      return shape;
    }

    _dragGroupIdsForShape(shape) {
      if (!shape || shape.type !== "line" || !shape.connectionId) {
        return [shape ? shape.id : null].filter(Boolean);
      }

      return this.getShapes()
        .filter(
          (candidate) =>
            candidate &&
            candidate.type === "line" &&
            candidate.connectionId &&
            candidate.connectionId === shape.connectionId
        )
        .map((candidate) => candidate.id);
    }

    _composeDragGroupIds(shape) {
      const baseIds = this._dragGroupIdsForShape(shape);
      const selectedIds =
        this.selection && typeof this.selection.getSelectedIds === "function"
          ? this.selection.getSelectedIds()
          : [this.selection.getSelectedId()].filter(Boolean);

      if (
        !shape ||
        !shape.id ||
        !selectedIds.length ||
        selectedIds.length < 2 ||
        !selectedIds.includes(shape.id)
      ) {
        return baseIds;
      }

      const all = new Set(baseIds);
      selectedIds.forEach((id) => all.add(id));
      return Array.from(all);
    }

    _findLineEndpointByScreenPoint(screenPoint, tolerancePx) {
      const view = this.getView();
      if (!view) {
        return null;
      }

      const lines = this.getShapes().filter(
        (shape) => shape && shape.type === "line" && Array.isArray(shape.points) && shape.points.length >= 2
      );
      let best = null;
      lines.forEach((shape) => {
        for (let i = 0; i < 2; i += 1) {
          const endpointScreen = HOP.projection.canonicalToScreen(shape.points[i], view);
          const distance = HOP.geometry.distance(screenPoint, endpointScreen);
          if (distance <= tolerancePx && (!best || distance < best.distance)) {
            best = {
              shapeId: shape.id,
              vertexIndex: i,
              distance
            };
          }
        }
      });

      return best ? { shapeId: best.shapeId, vertexIndex: best.vertexIndex } : null;
    }

    _isEdgeOpen(shape, edgeIndex) {
      const measurements = shape && shape.measurements && typeof shape.measurements === "object"
        ? shape.measurements
        : null;
      if (!measurements || !Array.isArray(measurements.openEdges)) {
        return false;
      }
      return measurements.openEdges[edgeIndex] === true;
    }

    _findNearestEdgeForShapeAtScreenPoint(shape, screenPoint, tolerancePx) {
      if (
        !shape ||
        (shape.type !== "polygon" && shape.type !== "rectangle") ||
        !Array.isArray(shape.points) ||
        shape.points.length < 3
      ) {
        return null;
      }

      const view = this.getView();
      if (!view) {
        return null;
      }

      const points = shape.points.map((point) => HOP.projection.canonicalToScreen(point, view));
      let bestEdge = null;
      let bestDistance = Infinity;

      for (let i = 0; i < points.length; i += 1) {
        if (this._isEdgeOpen(shape, i)) {
          continue;
        }

        const next = (i + 1) % points.length;
        const distance = HOP.geometry.distanceToSegment(screenPoint, points[i], points[next]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestEdge = i;
        }
      }

      if (bestEdge === null || bestDistance > tolerancePx) {
        return null;
      }

      return bestEdge;
    }

    _consumeEdgeMeasurementDoubleTap(shapeId, edgeIndex) {
      const now = Date.now();
      const thresholdMs = 450;
      const previous = this.lastEdgeMeasurementTap;
      const isDoubleTap =
        previous &&
        previous.shapeId === shapeId &&
        previous.edgeIndex === edgeIndex &&
        now - previous.time <= thresholdMs;

      this.lastEdgeMeasurementTap = {
        shapeId,
        edgeIndex,
        time: now
      };

      if (isDoubleTap) {
        this.lastEdgeMeasurementTap = null;
        return true;
      }

      return false;
    }

    _appendPolygonPoint(point) {
      if (!this.draft || this.draft.type !== "polygon") {
        this.draft = {
          type: "polygon",
          points: [point],
          pointer: point
        };
        this.requestRender();
        return;
      }

      const points = this.draft.points;
      const view = this.getView();
      if (view && points.length) {
        const lastScreen = HOP.projection.canonicalToScreen(points[points.length - 1], view);
        const nextScreen = HOP.projection.canonicalToScreen(point, view);
        if (HOP.geometry.distance(lastScreen, nextScreen) < 3) {
          this.draft.pointer = point;
          this.requestRender();
          return;
        }
      }

      points.push(point);
      this.draft.pointer = point;
      this.requestRender();
    }

    _finishPolygonAtPoint(point) {
      if (!this.draft || this.draft.type !== "polygon") {
        return false;
      }

      const view = this.getView();
      const points = this.draft.points.slice();

      if (point && view && points.length) {
        const lastScreen = HOP.projection.canonicalToScreen(points[points.length - 1], view);
        const finishScreen = HOP.projection.canonicalToScreen(point, view);
        if (HOP.geometry.distance(lastScreen, finishScreen) >= 3) {
          points.push(point);
        }
      }

      if (view && points.length >= 2) {
        const deduped = [points[0]];
        for (let i = 1; i < points.length; i += 1) {
          const prevScreen = HOP.projection.canonicalToScreen(deduped[deduped.length - 1], view);
          const nextScreen = HOP.projection.canonicalToScreen(points[i], view);
          if (HOP.geometry.distance(prevScreen, nextScreen) >= 3) {
            deduped.push(points[i]);
          }
        }
        points.length = 0;
        deduped.forEach((p) => points.push(p));
      }

      if (points.length < 3) {
        this.reportStatus("Polygon needs at least 3 points.");
        return false;
      }

      this._appendShape({
        id: HOP.ids.createId("shape_poly"),
        type: "polygon",
        points
      });

      this.draft = null;
      this.requestRender();
      return true;
    }

    _startVertexEdit(pointerId, shapeId, vertexIndex) {
      const shape = this._findShapeById(shapeId);
      if (!shape) {
        return;
      }

      if (shape.type === "line" || shape.type === "rectangle" || shape.type === "polygon") {
        this.selection.select(shapeId);
        this.clearSelectedEdge();
        this.setEditShapeId(shapeId);
        this.draggingVertex = {
          pointerId,
          shapeId,
          vertexIndex,
          startShapesSnapshot: this._cloneShapes(this.getShapes()),
          moved: false
        };
        this.svg.setPointerCapture(pointerId);
        this.requestRender();
      }
    }

    _onPointerDown(event) {
      if (event.button !== 0) {
        return;
      }

      const tool = this.getTool();
      if (tool !== HOP.constants.TOOL.CONNECTION && this.connectionDraft) {
        this.connectionDraft = null;
      }
      const point = this._canonicalPointFromEvent(event);

      if (tool === HOP.constants.TOOL.SELECT) {
        const edgeMeasurement = this._findEdgeMeasurementFromTarget(event.target);
        if (edgeMeasurement) {
          event.stopPropagation();
          this.selection.select(edgeMeasurement.shapeId);
          this.setSelectedEdge(edgeMeasurement.shapeId, edgeMeasurement.edgeIndex);
          this.setEditShapeId(null);
          const shouldPrompt =
            event.detail >= 2 ||
            this._consumeEdgeMeasurementDoubleTap(
              edgeMeasurement.shapeId,
              edgeMeasurement.edgeIndex
            );
          if (shouldPrompt) {
            this.requestSetEdgeLength(edgeMeasurement.shapeId, edgeMeasurement.edgeIndex);
          }
          this.requestRender();
          return;
        }

        this.lastEdgeMeasurementTap = null;

        const vertexHandle = this._findVertexHandleFromTarget(event.target);
        if (vertexHandle) {
          event.preventDefault();
          this._startVertexEdit(event.pointerId, vertexHandle.shapeId, vertexHandle.vertexIndex);
          return;
        }

        const rotateHandle = this._findRotateHandleFromTarget(event.target);
        if (rotateHandle && point) {
          event.preventDefault();
          event.stopPropagation();
          const shape = this._findShapeById(rotateHandle.shapeId);
          if (shape) {
            this.selection.select(shape.id);
            this.clearSelectedEdge();
            this.setEditShapeId(null);

            const groupShapeIds = this._composeDragGroupIds(shape);
            const startShapesById = {};
            const shapes = this.getShapes();
            groupShapeIds.forEach((id) => {
              const member = shapes.find((candidate) => candidate.id === id);
              if (member) {
                startShapesById[id] = JSON.parse(JSON.stringify(member));
              }
            });

            const pivot = this._rotationPivotForShapeIds(groupShapeIds, startShapesById);
            const view = this.getView();
            if (pivot && view) {
              const pivotScreen = HOP.projection.canonicalToScreen(pivot, view);
              const cursorScreen = this._screenPointFromEvent(event);
              this.draggingRotate = {
                pointerId: event.pointerId,
                shapeId: shape.id,
                groupShapeIds,
                startShapesById,
                startShapesSnapshot: this._cloneShapes(this.getShapes()),
                pivot,
                startAngle: Math.atan2(
                  cursorScreen.y - pivotScreen.y,
                  cursorScreen.x - pivotScreen.x
                ),
                moved: false
              };
              this.svg.setPointerCapture(event.pointerId);
              this.requestRender();
            }
          }
          return;
        }

        const edgeToggleTarget = this.isLengthPickMode()
          ? this._findEdgeToggleFromTarget(event.target)
          : null;

        if (edgeToggleTarget) {
          event.preventDefault();
          this.selection.select(edgeToggleTarget.shapeId);
          this.clearSelectedEdge();
          this.toggleEdgeLengthVisibility(edgeToggleTarget.shapeId, edgeToggleTarget.edgeIndex);
          this.requestRender();
          return;
        }

        const labelControl = this._findLabelControlFromTarget(event.target);
        if (labelControl) {
          const shape = this._findShapeById(labelControl.shapeId);
          if (shape && shape.type === "label") {
            event.preventDefault();
            const viewScale = this._currentViewScale();
            this.selection.select(labelControl.shapeId);
            this.clearSelectedEdge();
            this.draggingLabelControl = {
              pointerId: event.pointerId,
              shapeId: labelControl.shapeId,
              mode: labelControl.control,
              startScreen: this._screenPointFromEvent(event),
              referenceScale: viewScale,
              startBox: this._renderedLabelBox(shape.labelBox, viewScale),
              startShapesSnapshot: this._cloneShapes(this.getShapes()),
              moved: false
            };
            this.svg.setPointerCapture(event.pointerId);
            this.requestRender();
            return;
          }
        }

        const shapeId = this._findShapeIdFromEventTarget(event.target);
        if (!shapeId) {
          this.selection.clear();
          this.clearSelectedEdge();
          this.setEditShapeId(null);
          this.requestRender();
          return;
        }

        const shape = this._findShapeById(shapeId);
        if (!shape) {
          return;
        }

        if (
          this.isAreaPickMode() &&
          (shape.type === "rectangle" || shape.type === "polygon")
        ) {
          event.preventDefault();
          this.selection.select(shapeId);
          this.clearSelectedEdge();
          this.setEditShapeId(null);
          this.toggleShapeAreaVisibility(shapeId);
          this.requestRender();
          return;
        }

        if (event.shiftKey) {
          event.preventDefault();
          if (this.selection && typeof this.selection.has === "function" && this.selection.has(shapeId)) {
            this.selection.remove(shapeId);
          } else if (this.selection && typeof this.selection.add === "function") {
            this.selection.add(shapeId);
          } else {
            this.selection.select(shapeId);
          }
          this.clearSelectedEdge();
          this.setEditShapeId(null);
          this.requestRender();
          return;
        }

        const isAlreadySelected =
          this.selection && typeof this.selection.has === "function"
            ? this.selection.has(shapeId)
            : this.selection.getSelectedId() === shapeId;

        if (!isAlreadySelected) {
          this.selection.select(shapeId);
        }
        this.clearSelectedEdge();

        if (shape && point) {
          const groupShapeIds = this._composeDragGroupIds(shape);
          const startShapesById = {};
          const shapes = this.getShapes();
          groupShapeIds.forEach((id) => {
            const member = shapes.find((candidate) => candidate.id === id);
            if (member) {
              startShapesById[id] = JSON.parse(JSON.stringify(member));
            }
          });

          this.draggingShape = {
            shapeId,
            pointerId: event.pointerId,
            startPoint: point,
            startShape: JSON.parse(JSON.stringify(shape)),
            groupShapeIds,
            startShapesById,
            startShapesSnapshot: this._cloneShapes(this.getShapes()),
            moved: false
          };
          this.svg.setPointerCapture(event.pointerId);
        }

        this.requestRender();
        return;
      }

      if (!point) {
        return;
      }

      if (tool === HOP.constants.TOOL.LINE) {
        event.preventDefault();
        this.pointerDrawing = {
          pointerId: event.pointerId,
          start: point
        };
        this.draft = {
          type: "line",
          start: point,
          end: point
        };
        this.svg.setPointerCapture(event.pointerId);
        this.requestRender();
        return;
      }

      if (tool === HOP.constants.TOOL.RECTANGLE) {
        event.preventDefault();
        this.pointerDrawing = {
          pointerId: event.pointerId,
          start: point
        };
        this.draft = {
          type: "rectangle",
          start: point,
          end: point
        };
        this.svg.setPointerCapture(event.pointerId);
        this.requestRender();
      }
    }

    _onPointerMove(event) {
      const point = this._canonicalPointFromEvent(event);
      if (!point) {
        return;
      }

      const tool = this.getTool();

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingRotate &&
        this.draggingRotate.pointerId === event.pointerId
      ) {
        const view = this.getView();
        if (!view) {
          return;
        }

        const pivotScreen = HOP.projection.canonicalToScreen(this.draggingRotate.pivot, view);
        const currentScreen = this._screenPointFromEvent(event);
        const currentAngle = Math.atan2(
          currentScreen.y - pivotScreen.y,
          currentScreen.x - pivotScreen.x
        );
        const angleDelta = this._normalizeAngleDelta(currentAngle - this.draggingRotate.startAngle);

        if (Math.abs(angleDelta) > 0.003) {
          this.draggingRotate.moved = true;
        }

        const shapes = this.getShapes().slice();
        const groupIds = Array.isArray(this.draggingRotate.groupShapeIds)
          ? this.draggingRotate.groupShapeIds
          : [this.draggingRotate.shapeId];
        let changed = false;

        groupIds.forEach((shapeId) => {
          const index = shapes.findIndex((shape) => shape.id === shapeId);
          const startShape = this.draggingRotate.startShapesById
            ? this.draggingRotate.startShapesById[shapeId]
            : null;
          if (index >= 0 && startShape) {
            shapes[index] = this._rotateShape(startShape, this.draggingRotate.pivot, angleDelta);
            changed = true;
          }
        });

        if (changed) {
          this.setShapes(shapes, { skipRender: true });
          this.requestRender();
        }
        return;
      }

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingVertex &&
        this.draggingVertex.pointerId === event.pointerId
      ) {
        const shapes = this.getShapes().slice();
        const index = shapes.findIndex((shape) => shape.id === this.draggingVertex.shapeId);
        if (index >= 0) {
          const shape = { ...shapes[index] };
          if (Array.isArray(shape.points) && shape.points[this.draggingVertex.vertexIndex]) {
            const nextPoints = shape.points.slice();
            nextPoints[this.draggingVertex.vertexIndex] = point;
            shape.points = nextPoints;
            shapes[index] = shape;
            this.draggingVertex.moved = true;
            this.setShapes(shapes, { skipRender: true });
            this.requestRender();
          }
        }
        return;
      }

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingLabelControl &&
        this.draggingLabelControl.pointerId === event.pointerId
      ) {
        const currentScreen = this._screenPointFromEvent(event);
        const dxScreen = currentScreen.x - this.draggingLabelControl.startScreen.x;
        const dyScreen = currentScreen.y - this.draggingLabelControl.startScreen.y;
        if (Math.abs(dxScreen) > 1 || Math.abs(dyScreen) > 1) {
          this.draggingLabelControl.moved = true;
        }

        const shapes = this.getShapes().slice();
        const index = shapes.findIndex((shape) => shape.id === this.draggingLabelControl.shapeId);
        if (index >= 0 && shapes[index].type === "label") {
          const current = shapes[index];
          const startBox = this.draggingLabelControl.startBox;
          const labelBox = {
            offsetX: startBox.offsetX,
            offsetY: startBox.offsetY,
            width: startBox.width,
            height: startBox.height,
            referenceScale: this.draggingLabelControl.referenceScale
          };

          if (this.draggingLabelControl.mode === "bubble") {
            labelBox.offsetX = startBox.offsetX + dxScreen;
            labelBox.offsetY = startBox.offsetY + dyScreen;
          } else if (this.draggingLabelControl.mode === "resize") {
            labelBox.width = Math.max(48, Math.min(360, startBox.width + dxScreen));
            labelBox.height = Math.max(20, Math.min(120, startBox.height + dyScreen));
          }

          shapes[index] = {
            ...current,
            labelBox
          };

          this.setShapes(shapes, { skipRender: true });
          this.requestRender();
        }
        return;
      }

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingShape &&
        this.draggingShape.pointerId === event.pointerId
      ) {
        const dx = HOP.projection.wrapDeltaX(point.x - this.draggingShape.startPoint.x);
        const dy = point.y - this.draggingShape.startPoint.y;

        const view = this.getView();
        if (view) {
          const startScreen = HOP.projection.canonicalToScreen(this.draggingShape.startPoint, view);
          const currentScreen = HOP.projection.canonicalToScreen(point, view);
          const dragDistance = HOP.geometry.distance(startScreen, currentScreen);
          if (dragDistance > 3) {
            this.draggingShape.moved = true;
          }
        }

        const shapes = this.getShapes().slice();
        const groupIds = Array.isArray(this.draggingShape.groupShapeIds)
          ? this.draggingShape.groupShapeIds
          : [this.draggingShape.shapeId];
        let changed = false;
        groupIds.forEach((shapeId) => {
          const index = shapes.findIndex((shape) => shape.id === shapeId);
          const startShape = this.draggingShape.startShapesById
            ? this.draggingShape.startShapesById[shapeId]
            : null;
          if (index >= 0 && startShape) {
            shapes[index] = this._translateShape(startShape, dx, dy);
            changed = true;
          }
        });
        if (changed) {
          this.setShapes(shapes, { skipRender: true });
          this.requestRender();
        }
        return;
      }

      if (tool === HOP.constants.TOOL.LINE && this.draft && this.pointerDrawing) {
        this.draft = {
          type: "line",
          start: this.pointerDrawing.start,
          end: point
        };
        this.requestRender();
        return;
      }

      if (tool === HOP.constants.TOOL.RECTANGLE && this.draft && this.pointerDrawing) {
        this.draft = {
          type: "rectangle",
          start: this.pointerDrawing.start,
          end: point
        };
        this.requestRender();
        return;
      }

      if (tool === HOP.constants.TOOL.POLYGON && this.draft && this.draft.type === "polygon") {
        this.draft.pointer = point;
        this.requestRender();
      }
    }

    _onPointerUp(event) {
      const tool = this.getTool();

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingRotate &&
        this.draggingRotate.pointerId === event.pointerId
      ) {
        this.svg.releasePointerCapture(event.pointerId);
        if (this.draggingRotate.moved) {
          this.setShapes(this.getShapes(), {
            recordHistory: true,
            historySnapshot: this.draggingRotate.startShapesSnapshot,
            skipRender: true
          });
        }
        this.draggingRotate = null;
        this.requestRender();
        return;
      }

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingVertex &&
        this.draggingVertex.pointerId === event.pointerId
      ) {
        this.svg.releasePointerCapture(event.pointerId);
        if (this.draggingVertex.moved) {
          this.setShapes(this.getShapes(), {
            recordHistory: true,
            historySnapshot: this.draggingVertex.startShapesSnapshot,
            skipRender: true
          });
        }
        this.draggingVertex = null;
        this.requestRender();
        return;
      }

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingLabelControl &&
        this.draggingLabelControl.pointerId === event.pointerId
      ) {
        this.svg.releasePointerCapture(event.pointerId);
        if (this.draggingLabelControl.moved) {
          this.setShapes(this.getShapes(), {
            recordHistory: true,
            historySnapshot: this.draggingLabelControl.startShapesSnapshot,
            skipRender: true
          });
        }
        this.draggingLabelControl = null;
        this.requestRender();
        return;
      }

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingShape &&
        this.draggingShape.pointerId === event.pointerId
      ) {
        this.svg.releasePointerCapture(event.pointerId);
        if (this.draggingShape.moved) {
          this.setShapes(this.getShapes(), {
            recordHistory: true,
            historySnapshot: this.draggingShape.startShapesSnapshot,
            skipRender: true
          });
        }
        this.draggingShape = null;
        this.requestRender();
        return;
      }

      if (!this.pointerDrawing || this.pointerDrawing.pointerId !== event.pointerId) {
        return;
      }

      const end = this._canonicalPointFromEvent(event);
      if (!end) {
        this.cancelCurrentDrawing();
        return;
      }

      const start = this.pointerDrawing.start;
      this.pointerDrawing = null;
      this.svg.releasePointerCapture(event.pointerId);

      const view = this.getView();
      if (!view) {
        this.cancelCurrentDrawing();
        return;
      }

      const startScreen = HOP.projection.canonicalToScreen(start, view);
      const endScreen = HOP.projection.canonicalToScreen(end, view);
      const screenDistance = HOP.geometry.distance(startScreen, endScreen);

      if (screenDistance < 4) {
        this.draft = null;
        this.requestRender();
        return;
      }

      if (tool === HOP.constants.TOOL.LINE) {
        this._appendShape({
          id: HOP.ids.createId("shape_line"),
          type: "line",
          points: [start, end]
        });
      } else if (tool === HOP.constants.TOOL.RECTANGLE) {
        this._appendShape({
          id: HOP.ids.createId("shape_rect"),
          type: "rectangle",
          points: HOP.geometry.rectPointsFromDiagonal(start, end)
        });
      }

      this.draft = null;
      this.requestRender();
    }

    _onClick(event) {
      if (event.button !== 0) {
        return;
      }

      const tool = this.getTool();

      if (tool === HOP.constants.TOOL.SELECT) {
        const edgeMeasurement = this._findEdgeMeasurementFromTarget(event.target);
        const measurementLikeTarget = this._isMeasurementVisualTarget(event.target);
        const fallbackSelectedEdge = this.getSelectedEdge();
        const edgeFromMeasurementTarget =
          edgeMeasurement ||
          (measurementLikeTarget && fallbackSelectedEdge ? fallbackSelectedEdge : null);

        if (edgeFromMeasurementTarget && event.detail >= 2) {
          event.preventDefault();
          event.stopPropagation();
          this.selection.select(edgeFromMeasurementTarget.shapeId);
          this.setSelectedEdge(edgeFromMeasurementTarget.shapeId, edgeFromMeasurementTarget.edgeIndex);
          this.setEditShapeId(null);
          this.requestSetEdgeLength(
            edgeFromMeasurementTarget.shapeId,
            edgeFromMeasurementTarget.edgeIndex
          );
          return;
        }
      }

      const point = this._canonicalPointFromEvent(event);
      if (!point) {
        return;
      }

      if (tool === HOP.constants.TOOL.CONNECTION) {
        event.preventDefault();
        event.stopPropagation();

        const endpointFromTarget = this._findConnectionEndpointFromTarget(event.target);
        const endpoint =
          endpointFromTarget || this._findLineEndpointByScreenPoint(this._screenPointFromEvent(event), 14);

        if (!endpoint) {
          this.connectionDraft = null;
          this.reportStatus("Click a line endpoint to start a connection.");
          return;
        }

        if (!this.connectionDraft) {
          this.connectionDraft = endpoint;
          this.selection.select(endpoint.shapeId);
          this.clearSelectedEdge();
          this.reportStatus("Endpoint selected. Click another endpoint to connect.");
          this.requestRender();
          return;
        }

        const success = this.connectLineEndpoints(this.connectionDraft, endpoint);
        this.connectionDraft = null;
        if (!success) {
          this.reportStatus("Connection failed. Select two line endpoints.");
        }
        this.requestRender();
        return;
      }

      if (tool === HOP.constants.TOOL.LABEL) {
        event.preventDefault();

        const shapeId = HOP.ids.createId("shape_label");
        this._appendShape({
          id: shapeId,
          type: "label",
          point,
          text: "Label",
          labelBox: {
            offsetX: 10,
            offsetY: -28,
            width: 96,
            height: 24,
            referenceScale: this._currentViewScale()
          }
        });

        this.selection.select(shapeId);
        this.triggerShortcutAction("select");
        this.requestRender();
        this._editLabelText(shapeId, "Label text:");
        return;
      }

      if (tool !== HOP.constants.TOOL.POLYGON) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (
        event.detail >= 2 &&
        this.draft &&
        this.draft.type === "polygon" &&
        Array.isArray(this.draft.points) &&
        this.draft.points.length >= 2
      ) {
        this._finishPolygonAtPoint(point);
        return;
      }

      this._appendPolygonPoint(point);
    }

    _onDoubleClick(event) {
      const tool = this.getTool();
      if (tool === HOP.constants.TOOL.SELECT) {
        const edgeMeasurement = this._findEdgeMeasurementFromTarget(event.target);
        const measurementLikeTarget = this._isMeasurementVisualTarget(event.target);
        const fallbackSelectedEdge = this.getSelectedEdge();
        const edgeFromMeasurementTarget =
          edgeMeasurement ||
          (measurementLikeTarget && fallbackSelectedEdge ? fallbackSelectedEdge : null);

        if (edgeFromMeasurementTarget) {
          event.preventDefault();
          event.stopPropagation();
          this.selection.select(edgeFromMeasurementTarget.shapeId);
          this.setSelectedEdge(edgeFromMeasurementTarget.shapeId, edgeFromMeasurementTarget.edgeIndex);
          this.setEditShapeId(null);
          this.requestSetEdgeLength(
            edgeFromMeasurementTarget.shapeId,
            edgeFromMeasurementTarget.edgeIndex
          );
          return;
        }

        const edgeTarget = this._findEdgeToggleFromTarget(event.target);
        if (edgeTarget) {
          event.preventDefault();
          event.stopPropagation();
          const shape = this._findShapeById(edgeTarget.shapeId);
          if (shape && (shape.type === "polygon" || shape.type === "rectangle")) {
            this.selection.select(edgeTarget.shapeId);
            this.setSelectedEdge(edgeTarget.shapeId, edgeTarget.edgeIndex);
            this.setEditShapeId(null);
            this.requestRender();
            return;
          }
        }

        const shapeId = this._findShapeIdFromEventTarget(event.target);
        if (!shapeId) {
          this.setEditShapeId(null);
          this.clearSelectedEdge();
          return;
        }

        const shape = this._findShapeById(shapeId);
        if (!shape) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (shape.type === "label") {
          this.clearSelectedEdge();
          this._editLabelText(shape.id, "Edit label text:");
          return;
        }

        if (shape.type === "polygon" || shape.type === "rectangle") {
          const nearestEdge = this._findNearestEdgeForShapeAtScreenPoint(
            shape,
            this._screenPointFromEvent(event),
            14
          );
          if (Number.isInteger(nearestEdge)) {
            this.selection.select(shape.id);
            this.setSelectedEdge(shape.id, nearestEdge);
            this.setEditShapeId(null);
            this.requestRender();
            return;
          }
        }

        if (shape.type === "line" || shape.type === "rectangle" || shape.type === "polygon") {
          const currentEdit = this.getEditShapeId();
          this.setEditShapeId(currentEdit === shape.id ? null : shape.id);
          this.clearSelectedEdge();
          this.selection.select(shape.id);
          this.requestRender();
        }

        return;
      }

      if (tool !== HOP.constants.TOOL.POLYGON) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this._finishPolygonAtPoint(this._canonicalPointFromEvent(event));
    }

    _appendShape(shape) {
      const prepared = this.prepareNewShape(shape);
      if (!prepared) {
        return;
      }

      const before = this._cloneShapes(this.getShapes());
      const next = this.getShapes().slice();
      next.push(prepared);
      this.selection.select(prepared.id);
      this.clearSelectedEdge();
      this.setShapes(next, {
        skipRender: true,
        recordHistory: true,
        historySnapshot: before
      });
    }
  }

  HOP.DrawingTools = DrawingTools;
})();
