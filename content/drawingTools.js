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
      this.toggleEdgeLengthVisibility =
        typeof options.toggleEdgeLengthVisibility === "function"
          ? options.toggleEdgeLengthVisibility
          : () => {};
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

      this.draft = null;
      this.pointerDrawing = null;
      this.draggingShape = null;
      this.draggingLabelControl = null;
      this.draggingVertex = null;
      this.connectionDraft = null;
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
      this.connectionDraft = null;
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

      const selectedId = this.selection.getSelectedId();
      if (!selectedId) {
        return;
      }

      const before = this._cloneShapes(this.getShapes());
      const filtered = this.getShapes().filter((shape) => shape.id !== selectedId);
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
      const shapeNode = target && target.closest ? target.closest("[data-shape-id]") : null;
      return shapeNode ? shapeNode.getAttribute("data-shape-id") : null;
    }

    _findShapeById(shapeId) {
      return this.getShapes().find((shape) => shape.id === shapeId) || null;
    }

    _findEdgeToggleFromTarget(target) {
      const node = target && target.closest ? target.closest("[data-edge-toggle='true']") : null;
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
      const node = target && target.closest ? target.closest("[data-edge-measurement='true']") : null;
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

    _findLabelControlFromTarget(target) {
      const controlNode = target && target.closest ? target.closest("[data-label-control]") : null;
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
      const handleNode = target && target.closest ? target.closest("[data-vertex-handle='true']") : null;
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
      const node = target && target.closest ? target.closest("[data-connection-endpoint='true']") : null;
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

    _normalizeY(value) {
      return Math.max(0, Math.min(WORLD_SIZE, value));
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
          if (event.detail >= 2) {
            this.requestSetEdgeLength(edgeMeasurement.shapeId, edgeMeasurement.edgeIndex);
          }
          this.requestRender();
          return;
        }

        const vertexHandle = this._findVertexHandleFromTarget(event.target);
        if (vertexHandle) {
          event.preventDefault();
          this._startVertexEdit(event.pointerId, vertexHandle.shapeId, vertexHandle.vertexIndex);
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
            this.selection.select(labelControl.shapeId);
            this.clearSelectedEdge();
            this.draggingLabelControl = {
              pointerId: event.pointerId,
              shapeId: labelControl.shapeId,
              mode: labelControl.control,
              startScreen: this._screenPointFromEvent(event),
              startBox: {
                offsetX: shape.labelBox ? shape.labelBox.offsetX : 10,
                offsetY: shape.labelBox ? shape.labelBox.offsetY : -28,
                width: shape.labelBox ? shape.labelBox.width : 96,
                height: shape.labelBox ? shape.labelBox.height : 24
              },
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

        this.selection.select(shapeId);
        this.clearSelectedEdge();
        const shape = this._findShapeById(shapeId);
        if (shape && point) {
          const groupShapeIds = this._dragGroupIdsForShape(shape);
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
            height: startBox.height
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
        if (edgeMeasurement && event.detail >= 2) {
          event.preventDefault();
          event.stopPropagation();
          this.selection.select(edgeMeasurement.shapeId);
          this.setSelectedEdge(edgeMeasurement.shapeId, edgeMeasurement.edgeIndex);
          this.setEditShapeId(null);
          this.requestSetEdgeLength(edgeMeasurement.shapeId, edgeMeasurement.edgeIndex);
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
            height: 24
          }
        });

        this.selection.select(shapeId);
        this.requestRender();
        this._editLabelText(shapeId, "Label text:");
        return;
      }

      if (tool !== HOP.constants.TOOL.POLYGON) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this._appendPolygonPoint(point);
    }

    _onDoubleClick(event) {
      const tool = this.getTool();
      if (tool === HOP.constants.TOOL.SELECT) {
        const edgeMeasurement = this._findEdgeMeasurementFromTarget(event.target);
        if (edgeMeasurement) {
          event.preventDefault();
          event.stopPropagation();
          this.selection.select(edgeMeasurement.shapeId);
          this.setSelectedEdge(edgeMeasurement.shapeId, edgeMeasurement.edgeIndex);
          this.setEditShapeId(null);
          this.requestSetEdgeLength(edgeMeasurement.shapeId, edgeMeasurement.edgeIndex);
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

      if (!this.draft || this.draft.type !== "polygon") {
        return;
      }

      const points = this.draft.points.slice();
      const view = this.getView();
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
        return;
      }

      this._appendShape({
        id: HOP.ids.createId("shape_poly"),
        type: "polygon",
        points
      });

      this.draft = null;
      this.requestRender();
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
