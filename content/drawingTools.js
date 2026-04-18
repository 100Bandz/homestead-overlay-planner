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

      this.draft = null;
      this.pointerDrawing = null;
      this.draggingShape = null;
      this.draggingLabelControl = null;
      this.ignoreNextPolygonClick = false;
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

    cancelCurrentDrawing() {
      this.draft = null;
      this.pointerDrawing = null;
      this.draggingShape = null;
      this.draggingLabelControl = null;
      this.requestRender();
    }

    undoLast() {
      if (this.draft) {
        this.cancelCurrentDrawing();
        return;
      }

      const shapes = this.getShapes().slice();
      shapes.pop();
      this.selection.clear();
      this.setShapes(shapes);
    }

    deleteSelected() {
      const selectedId = this.selection.getSelectedId();
      if (!selectedId) {
        return;
      }

      const filtered = this.getShapes().filter((shape) => shape.id !== selectedId);
      this.selection.clear();
      this.setShapes(filtered);
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

      const shapes = this.getShapes().map((candidate) =>
        candidate.id === shape.id ? { ...candidate, text: text.trim() } : candidate
      );
      this.setShapes(shapes);
      return true;
    }

    _onKeyDown(event) {
      if (this._isTypingContext()) {
        return;
      }

      if (event.key === "Escape") {
        this.cancelCurrentDrawing();
        this.selection.clear();
        this.requestRender();
        return;
      }

      if (
        this.getTool() === HOP.constants.TOOL.SELECT &&
        (event.key === "Delete" || event.key === "Backspace") &&
        this.selection.getSelectedId()
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

    _onPointerDown(event) {
      if (event.button !== 0) {
        return;
      }

      const tool = this.getTool();
      const point = this._canonicalPointFromEvent(event);
      if (!point) {
        return;
      }

      if (tool === HOP.constants.TOOL.SELECT) {
        const edgeToggleTarget = this.isLengthPickMode()
          ? this._findEdgeToggleFromTarget(event.target)
          : null;

        if (edgeToggleTarget) {
          event.preventDefault();
          this.selection.select(edgeToggleTarget.shapeId);
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
              }
            };
            this.svg.setPointerCapture(event.pointerId);
            this.requestRender();
            return;
          }
        }

        const shapeId = this._findShapeIdFromEventTarget(event.target);
        if (!shapeId) {
          this.selection.clear();
          this.requestRender();
          return;
        }

        this.selection.select(shapeId);
        const shape = this._findShapeById(shapeId);
        if (shape) {
          this.draggingShape = {
            shapeId,
            pointerId: event.pointerId,
            startPoint: point,
            startShape: JSON.parse(JSON.stringify(shape)),
            moved: false
          };
          this.svg.setPointerCapture(event.pointerId);
        }

        this.requestRender();
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
        this.draggingLabelControl &&
        this.draggingLabelControl.pointerId === event.pointerId
      ) {
        const currentScreen = this._screenPointFromEvent(event);
        const dxScreen = currentScreen.x - this.draggingLabelControl.startScreen.x;
        const dyScreen = currentScreen.y - this.draggingLabelControl.startScreen.y;

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
        const index = shapes.findIndex((shape) => shape.id === this.draggingShape.shapeId);
        if (index >= 0) {
          shapes[index] = this._translateShape(this.draggingShape.startShape, dx, dy);
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
        this.draggingLabelControl &&
        this.draggingLabelControl.pointerId === event.pointerId
      ) {
        this.svg.releasePointerCapture(event.pointerId);
        this.draggingLabelControl = null;
        return;
      }

      if (
        tool === HOP.constants.TOOL.SELECT &&
        this.draggingShape &&
        this.draggingShape.pointerId === event.pointerId
      ) {
        this.svg.releasePointerCapture(event.pointerId);
        this.draggingShape = null;
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
      const point = this._canonicalPointFromEvent(event);
      if (!point) {
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

      if (this.ignoreNextPolygonClick) {
        this.ignoreNextPolygonClick = false;
        return;
      }

      if (!this.draft || this.draft.type !== "polygon") {
        this.draft = {
          type: "polygon",
          points: [point],
          pointer: point
        };
        this.requestRender();
        return;
      }

      this.draft.points.push(point);
      this.draft.pointer = point;
      this.requestRender();
    }

    _onDoubleClick(event) {
      const tool = this.getTool();
      if (tool === HOP.constants.TOOL.SELECT) {
        const shapeId = this._findShapeIdFromEventTarget(event.target);
        if (!shapeId) {
          return;
        }

        const shape = this._findShapeById(shapeId);
        if (!shape || shape.type !== "label") {
          return;
        }

        event.preventDefault();
        this._editLabelText(shape.id, "Edit label text:");
        return;
      }

      if (tool !== HOP.constants.TOOL.POLYGON) {
        return;
      }

      event.preventDefault();

      if (!this.draft || this.draft.type !== "polygon") {
        return;
      }

      let points = this.draft.points.slice();
      const view = this.getView();

      if (view && points.length >= 2) {
        const last = HOP.projection.canonicalToScreen(points[points.length - 1], view);
        const beforeLast = HOP.projection.canonicalToScreen(points[points.length - 2], view);
        if (HOP.geometry.distance(last, beforeLast) < 4) {
          points.pop();
        }
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
      this.ignoreNextPolygonClick = true;
      this.requestRender();
    }

    _appendShape(shape) {
      const prepared = this.prepareNewShape(shape);
      if (!prepared) {
        return;
      }

      const next = this.getShapes().slice();
      next.push(prepared);
      this.selection.select(prepared.id);
      this.setShapes(next, { skipRender: true });
    }
  }

  HOP.DrawingTools = DrawingTools;
})();
