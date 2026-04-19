(() => {
  const HOP = (window.HOP = window.HOP || {});

  const SVG_NS = "http://www.w3.org/2000/svg";

  function createSvgElement(tagName, attrs) {
    const el = document.createElementNS(SVG_NS, tagName);
    if (attrs && typeof attrs === "object") {
      Object.keys(attrs).forEach((key) => {
        if (attrs[key] !== undefined && attrs[key] !== null) {
          el.setAttribute(key, String(attrs[key]));
        }
      });
    }
    return el;
  }

  function pointsToString(points) {
    return points.map((p) => `${p.x},${p.y}`).join(" ");
  }

  function formatLengthMeters(meters) {
    if (!Number.isFinite(meters)) {
      return "--";
    }

    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }

    return `${meters.toFixed(1)} m`;
  }

  function formatAreaSquareMeters(squareMeters) {
    if (!Number.isFinite(squareMeters)) {
      return "--";
    }

    if (squareMeters >= 1000000) {
      return `${(squareMeters / 1000000).toFixed(3)} km²`;
    }

    if (squareMeters >= 10000) {
      return `${(squareMeters / 10000).toFixed(2)} ha`;
    }

    return `${squareMeters.toFixed(1)} m²`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  class ShapeRenderer {
    constructor(svgRoot) {
      this.svgRoot = svgRoot;
      this.shapeLayer = createSvgElement("g", { class: "hop-shapes-layer" });
      this.measurementLayer = createSvgElement("g", { class: "hop-measurements-layer" });
      this.draftLayer = createSvgElement("g", { class: "hop-draft-layer" });
      this.textMeasureCanvas = document.createElement("canvas");
      this.textMeasureContext = this.textMeasureCanvas.getContext("2d");
      this.areaAnchorByShapeId = new Map();

      this.svgRoot.innerHTML = "";
      this.svgRoot.appendChild(this.shapeLayer);
      this.svgRoot.appendChild(this.measurementLayer);
      this.svgRoot.appendChild(this.draftLayer);
    }

    clear() {
      this.shapeLayer.innerHTML = "";
      this.measurementLayer.innerHTML = "";
      this.draftLayer.innerHTML = "";
    }

    render({
      view,
      shapes,
      selectedId,
      selectedIds,
      selectedEdge,
      editShapeId,
      draft,
      measurementSettings,
      activeTool
    }) {
      const width = window.innerWidth;
      const height = window.innerHeight;

      this.svgRoot.setAttribute("width", String(width));
      this.svgRoot.setAttribute("height", String(height));
      this.svgRoot.setAttribute("viewBox", `0 0 ${width} ${height}`);

      this.clear();

      if (!view) {
        return;
      }

      const shapeList = Array.isArray(shapes) ? shapes : [];
      const selectedSet = new Set(
        Array.isArray(selectedIds)
          ? selectedIds.filter((id) => typeof id === "string" && id)
          : (selectedId ? [selectedId] : [])
      );
      const knownIds = new Set(shapeList.map((shape) => shape.id));
      Array.from(this.areaAnchorByShapeId.keys()).forEach((shapeId) => {
        if (!knownIds.has(shapeId)) {
          this.areaAnchorByShapeId.delete(shapeId);
        }
      });

      const settings = {
        showAllLengths: !measurementSettings || measurementSettings.showAllLengths !== false,
        showAllAreas: !measurementSettings || measurementSettings.showAllAreas !== false,
        sideToggleMode: !!(measurementSettings && measurementSettings.sideToggleMode),
        selectedEdge:
          selectedEdge && selectedEdge.shapeId && Number.isInteger(selectedEdge.edgeIndex)
            ? selectedEdge
            : null,
        activeTool: activeTool || ""
      };

      shapeList.forEach((shape) => {
        const rendered = this._renderShape(
          shape,
          view,
          selectedSet.has(shape.id),
          editShapeId === shape.id,
          settings
        );
        if (!rendered) {
          return;
        }

        if (rendered.shapeGroup) {
          this.shapeLayer.appendChild(rendered.shapeGroup);
        }

        if (rendered.measurementGroup) {
          this.measurementLayer.appendChild(rendered.measurementGroup);
        }
      });

      const derivedLineAreas = this._renderDerivedLineLoopAreas(shapeList, view, settings);
      if (derivedLineAreas) {
        this.measurementLayer.appendChild(derivedLineAreas);
      }

      if (draft) {
        const draftElement = this._renderDraft(draft, view);
        if (draftElement) {
          this.draftLayer.appendChild(draftElement);
        }
      }
    }

    _fitText(text, maxWidthPx, font) {
      const raw = typeof text === "string" ? text : "";
      const source = raw.trim() || "Label";

      if (!this.textMeasureContext) {
        return source;
      }

      this.textMeasureContext.font = font;
      if (this.textMeasureContext.measureText(source).width <= maxWidthPx) {
        return source;
      }

      const ellipsis = "...";
      let candidate = source;
      while (candidate.length > 1) {
        candidate = candidate.slice(0, -1);
        if (this.textMeasureContext.measureText(candidate + ellipsis).width <= maxWidthPx) {
          return candidate + ellipsis;
        }
      }

      return ellipsis;
    }

    _measureTextWidth(text, font) {
      if (!this.textMeasureContext) {
        return (text || "").length * 7;
      }
      this.textMeasureContext.font = font;
      return this.textMeasureContext.measureText(text).width;
    }

    _edgeLengthMeters(aCanonical, bCanonical) {
      const a = HOP.projection.canonicalToLatLng(aCanonical);
      const b = HOP.projection.canonicalToLatLng(bCanonical);
      return HOP.projection.latLngDistanceMeters(a, b);
    }

    _isEdgeVisible(shape, edgeIndex) {
      const measurements = shape.measurements && typeof shape.measurements === "object"
        ? shape.measurements
        : null;
      if (!measurements || !Array.isArray(measurements.edgeVisibility)) {
        return true;
      }

      return measurements.edgeVisibility[edgeIndex] !== false;
    }

    _isEdgeDeleted(shape, edgeIndex) {
      const measurements = shape.measurements && typeof shape.measurements === "object"
        ? shape.measurements
        : null;
      if (!measurements || !Array.isArray(measurements.openEdges)) {
        return false;
      }

      return measurements.openEdges[edgeIndex] === true;
    }

    _areaVisible(shape) {
      const measurements = shape.measurements && typeof shape.measurements === "object"
        ? shape.measurements
        : null;
      if (!measurements) {
        return true;
      }

      if (Array.isArray(measurements.openEdges) && measurements.openEdges.some(Boolean)) {
        return false;
      }

      return measurements.areaVisible !== false;
    }

    _createEdgeHitLine(a, b, shapeId, edgeIndex) {
      return createSvgElement("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        class: "hop-edge-hit",
        "data-edge-toggle": "true",
        "data-shape-id": shapeId,
        "data-edge-index": edgeIndex
      });
    }

    _createMeasurementBadge(x, y, text, angleDeg, meta) {
      const edgeMeta = meta && meta.shapeId && Number.isInteger(meta.edgeIndex)
        ? meta
        : null;
      const group = createSvgElement("g", {
        class: edgeMeta ? "hop-measurement hop-edge-measurement" : "hop-measurement"
      });

      const font = "600 11px 'Avenir Next', 'Segoe UI', sans-serif";
      const width = Math.max(36, this._measureTextWidth(text, font) + 10);
      const height = 18;
      const normalized = angleDeg > 90 || angleDeg < -90 ? angleDeg + 180 : angleDeg;

      group.setAttribute("transform", `translate(${x},${y}) rotate(${normalized})`);

      if (edgeMeta) {
        group.setAttribute("data-edge-measurement", "true");
        group.setAttribute("data-shape-id", edgeMeta.shapeId);
        group.setAttribute("data-edge-index", edgeMeta.edgeIndex);
      }

      const rect = createSvgElement("rect", {
        x: -width / 2,
        y: -height / 2,
        width,
        height,
        rx: 5,
        ry: 5,
        class: "hop-measurement-box"
      });

      const textNode = createSvgElement("text", {
        x: 0,
        y: 4,
        class: "hop-measurement-text",
        "text-anchor": "middle"
      });
      textNode.textContent = text;

      if (edgeMeta) {
        const hitRect = createSvgElement("rect", {
          x: -width / 2 - 5,
          y: -height / 2 - 4,
          width: width + 10,
          height: height + 8,
          class: "hop-edge-measurement-hit"
        });
        hitRect.setAttribute("data-edge-measurement", "true");
        hitRect.setAttribute("data-shape-id", edgeMeta.shapeId);
        hitRect.setAttribute("data-edge-index", edgeMeta.edgeIndex);
        group.appendChild(hitRect);

        rect.setAttribute("data-edge-measurement", "true");
        rect.setAttribute("data-shape-id", edgeMeta.shapeId);
        rect.setAttribute("data-edge-index", edgeMeta.edgeIndex);
        textNode.setAttribute("data-edge-measurement", "true");
        textNode.setAttribute("data-shape-id", edgeMeta.shapeId);
        textNode.setAttribute("data-edge-index", edgeMeta.edgeIndex);
      }

      group.appendChild(rect);
      group.appendChild(textNode);

      return group;
    }

    _createAreaBadge(x, y, text) {
      const group = createSvgElement("g", {
        class: "hop-area-measurement"
      });
      const font = "700 12px 'Avenir Next', 'Segoe UI', sans-serif";
      const width = Math.max(42, this._measureTextWidth(text, font) + 14);
      const height = 22;

      group.setAttribute("transform", `translate(${x},${y})`);
      group.appendChild(
        createSvgElement("rect", {
          x: -width / 2,
          y: -height / 2,
          width,
          height,
          rx: 7,
          ry: 7,
          class: "hop-area-box"
        })
      );

      const textNode = createSvgElement("text", {
        x: 0,
        y: 5,
        class: "hop-area-text",
        "text-anchor": "middle"
      });
      textNode.textContent = text;
      group.appendChild(textNode);

      return group;
    }

    _chooseOutsideNormal(polygonScreenPoints, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len;
      let ny = dx / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;

      const test = {
        x: mx + nx * 8,
        y: my + ny * 8
      };

      if (HOP.geometry.pointInPolygon(test, polygonScreenPoints)) {
        nx = -nx;
        ny = -ny;
      }

      return { nx, ny, len, dx, dy };
    }

    _averagePoint(points) {
      const avg = points.reduce(
        (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
        { x: 0, y: 0 }
      );
      return {
        x: avg.x / points.length,
        y: avg.y / points.length
      };
    }

    _stableInteriorPoint(shapeId, canonicalPoints) {
      if (!Array.isArray(canonicalPoints) || canonicalPoints.length < 3) {
        return null;
      }

      const previous = shapeId ? this.areaAnchorByShapeId.get(shapeId) : null;
      if (previous && HOP.geometry.pointInPolygon(previous, canonicalPoints)) {
        return previous;
      }

      const centroid = HOP.geometry.polygonCentroid(canonicalPoints);
      const avg = this._averagePoint(canonicalPoints);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      canonicalPoints.forEach((p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      });

      const bboxCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      const candidates = [];
      if (centroid) {
        candidates.push(centroid);
      }
      candidates.push(avg);
      candidates.push(bboxCenter);

      for (let i = 0; i < canonicalPoints.length; i += 1) {
        const next = (i + 1) % canonicalPoints.length;
        candidates.push({
          x: (canonicalPoints[i].x + canonicalPoints[next].x) / 2,
          y: (canonicalPoints[i].y + canonicalPoints[next].y) / 2
        });
      }

      const insideCandidates = candidates.filter((candidate) =>
        HOP.geometry.pointInPolygon(candidate, canonicalPoints)
      );

      let chosen = null;
      if (insideCandidates.length) {
        if (previous) {
          chosen = insideCandidates.reduce((best, candidate) => {
            if (!best) {
              return candidate;
            }
            const bestDistance = HOP.geometry.distance(best, previous);
            const candidateDistance = HOP.geometry.distance(candidate, previous);
            return candidateDistance < bestDistance ? candidate : best;
          }, null);
        } else {
          chosen = insideCandidates[0];
        }
      }

      if (!chosen) {
        chosen = centroid || avg;
      }

      if (shapeId && chosen) {
        this.areaAnchorByShapeId.set(shapeId, chosen);
      }

      return chosen;
    }

    _closestPointOnRectBoundary(point, rect) {
      const left = rect.x;
      const right = rect.x + rect.width;
      const top = rect.y;
      const bottom = rect.y + rect.height;

      const clampedX = clamp(point.x, left, right);
      const clampedY = clamp(point.y, top, bottom);

      const distances = [
        { edge: "left", value: Math.abs(clampedX - left) },
        { edge: "right", value: Math.abs(right - clampedX) },
        { edge: "top", value: Math.abs(clampedY - top) },
        { edge: "bottom", value: Math.abs(bottom - clampedY) }
      ];

      distances.sort((a, b) => a.value - b.value);
      const nearest = distances[0].edge;

      if (nearest === "left") {
        return { x: left, y: clampedY };
      }
      if (nearest === "right") {
        return { x: right, y: clampedY };
      }
      if (nearest === "top") {
        return { x: clampedX, y: top };
      }
      return { x: clampedX, y: bottom };
    }

    _createVertexHandle(point, shapeId, vertexIndex) {
      const group = createSvgElement("g", {
        class: "hop-vertex-handle-group"
      });

      group.appendChild(
        createSvgElement("circle", {
          cx: point.x,
          cy: point.y,
          r: 10,
          class: "hop-vertex-handle-hit",
          "data-vertex-handle": "true",
          "data-shape-id": shapeId,
          "data-vertex-index": vertexIndex
        })
      );

      group.appendChild(
        createSvgElement("circle", {
          cx: point.x,
          cy: point.y,
          r: 5.2,
          class: "hop-vertex-handle"
        })
      );

      return group;
    }

    _createConnectionEndpoint(point, shapeId, vertexIndex) {
      return createSvgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: 9,
        class: "hop-connection-endpoint",
        "data-connection-endpoint": "true",
        "data-shape-id": shapeId,
        "data-vertex-index": vertexIndex
      });
    }

    _createRotateHandle(shapeId, pivot, handle) {
      const group = createSvgElement("g", {
        class: "hop-rotate-handle-group"
      });

      group.appendChild(
        createSvgElement("line", {
          x1: pivot.x,
          y1: pivot.y,
          x2: handle.x,
          y2: handle.y,
          class: "hop-rotate-guide"
        })
      );

      group.appendChild(
        createSvgElement("circle", {
          cx: handle.x,
          cy: handle.y,
          r: 12,
          class: "hop-rotate-handle-hit",
          "data-rotate-handle": "true",
          "data-shape-id": shapeId
        })
      );

      group.appendChild(
        createSvgElement("circle", {
          cx: handle.x,
          cy: handle.y,
          r: 8,
          class: "hop-rotate-handle"
        })
      );

      const icon = createSvgElement("text", {
        x: handle.x,
        y: handle.y + 3,
        class: "hop-rotate-handle-icon",
        "text-anchor": "middle"
      });
      icon.textContent = "R";
      group.appendChild(icon);

      return group;
    }

    _lineRotateHandlePosition(a, b) {
      const pivot = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
      };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;

      let nx = -dy / len;
      let ny = dx / len;
      if (ny > 0 || (Math.abs(ny) < 0.001 && nx < 0)) {
        nx = -nx;
        ny = -ny;
      }

      return {
        pivot,
        handle: {
          x: pivot.x + nx * 36,
          y: pivot.y + ny * 36
        }
      };
    }

    _polygonRotateHandlePosition(screenPoints) {
      const pivot = this._averagePoint(screenPoints);
      const minY = screenPoints.reduce((best, point) => Math.min(best, point.y), Infinity);
      let handleY = minY - 30;
      if (handleY < 14) {
        handleY = minY + 30;
      }
      if (Math.abs(handleY - pivot.y) < 18) {
        handleY = pivot.y - 30;
      }

      return {
        pivot,
        handle: {
          x: pivot.x,
          y: handleY
        }
      };
    }

    _renderDerivedLineLoopAreas(shapes, view, settings) {
      if (!settings.showAllAreas) {
        return null;
      }

      const lines = (Array.isArray(shapes) ? shapes : []).filter(
        (shape) => shape && shape.type === "line" && Array.isArray(shape.points) && shape.points.length >= 2
      );

      if (lines.length < 3) {
        return null;
      }

      const nodeTolerancePx = 12;
      const clusters = [];
      const edges = [];

      const getClusterIndex = (screenPoint, canonicalPoint) => {
        for (let i = 0; i < clusters.length; i += 1) {
          if (HOP.geometry.distance(screenPoint, clusters[i].screen) <= nodeTolerancePx) {
            clusters[i].members += 1;
            clusters[i].screen.x += (screenPoint.x - clusters[i].screen.x) / clusters[i].members;
            clusters[i].screen.y += (screenPoint.y - clusters[i].screen.y) / clusters[i].members;
            clusters[i].canonical.x += (canonicalPoint.x - clusters[i].canonical.x) / clusters[i].members;
            clusters[i].canonical.y += (canonicalPoint.y - clusters[i].canonical.y) / clusters[i].members;
            return i;
          }
        }

        clusters.push({
          screen: { x: screenPoint.x, y: screenPoint.y },
          canonical: { x: canonicalPoint.x, y: canonicalPoint.y },
          members: 1
        });
        return clusters.length - 1;
      };

      lines.forEach((line) => {
        const aCanonical = line.points[0];
        const bCanonical = line.points[1];
        const aScreen = HOP.projection.canonicalToScreen(aCanonical, view);
        const bScreen = HOP.projection.canonicalToScreen(bCanonical, view);
        const a = getClusterIndex(aScreen, aCanonical);
        const b = getClusterIndex(bScreen, bCanonical);
        if (a === b) {
          return;
        }
        edges.push({ a, b, shapeId: line.id });
      });

      if (edges.length < 3) {
        return null;
      }

      const adjacency = new Map();
      for (let i = 0; i < clusters.length; i += 1) {
        adjacency.set(i, []);
      }
      edges.forEach((edge, index) => {
        adjacency.get(edge.a).push({ edgeIndex: index, node: edge.b });
        adjacency.get(edge.b).push({ edgeIndex: index, node: edge.a });
      });

      const visitedNode = new Set();
      const loopGroup = createSvgElement("g", { class: "hop-derived-line-areas" });
      let loopCount = 0;

      for (let nodeIndex = 0; nodeIndex < clusters.length; nodeIndex += 1) {
        if (visitedNode.has(nodeIndex)) {
          continue;
        }

        const queue = [nodeIndex];
        const componentNodes = [];
        const componentEdges = new Set();
        visitedNode.add(nodeIndex);

        while (queue.length) {
          const current = queue.shift();
          componentNodes.push(current);
          (adjacency.get(current) || []).forEach((next) => {
            componentEdges.add(next.edgeIndex);
            if (!visitedNode.has(next.node)) {
              visitedNode.add(next.node);
              queue.push(next.node);
            }
          });
        }

        if (componentNodes.length < 3) {
          continue;
        }

        const allDegreeTwo = componentNodes.every(
          (node) => (adjacency.get(node) || []).length === 2
        );
        if (!allDegreeTwo || componentEdges.size !== componentNodes.length) {
          continue;
        }

        const usedEdges = new Set();
        const start = componentNodes[0];
        let previous = null;
        const orderedNodes = [start];
        let current = start;

        while (true) {
          const neighbors = (adjacency.get(current) || []).filter(
            (entry) => !usedEdges.has(entry.edgeIndex)
          );
          if (!neighbors.length) {
            break;
          }

          let nextEdge = neighbors[0];
          if (neighbors.length > 1 && previous !== null && neighbors[0].node === previous) {
            nextEdge = neighbors[1];
          }

          usedEdges.add(nextEdge.edgeIndex);
          previous = current;
          current = nextEdge.node;
          if (current === start) {
            break;
          }
          orderedNodes.push(current);
        }

        if (orderedNodes.length < 3 || current !== start) {
          continue;
        }

        const canonicalPolygon = orderedNodes.map((index) => clusters[index].canonical);
        const interior = this._stableInteriorPoint(null, canonicalPolygon);
        if (!interior) {
          continue;
        }

        const area = HOP.geometry.polygonAreaSquareMeters(canonicalPolygon);
        if (!Number.isFinite(area) || area <= 0) {
          continue;
        }

        const interiorScreen = HOP.projection.canonicalToScreen(interior, view);
        loopGroup.appendChild(
          this._createAreaBadge(interiorScreen.x, interiorScreen.y, formatAreaSquareMeters(area))
        );
        loopCount += 1;
      }

      return loopCount > 0 ? loopGroup : null;
    }

    _renderShape(shape, view, isSelected, isEditShape, settings) {
      if (!shape || !shape.type || !shape.id) {
        return null;
      }

      const shapeGroup = createSvgElement("g", {
        class: `hop-shape hop-shape-${shape.type}${isSelected ? " hop-shape-selected" : ""}`,
        "data-shape-id": shape.id,
        "data-shape-type": shape.type
      });
      const measurementGroup = createSvgElement("g", {
        class: "hop-shape-measurements",
        "data-shape-id": shape.id,
        "data-shape-type": shape.type
      });

      if (shape.type === "line" && Array.isArray(shape.points) && shape.points.length >= 2) {
        const aCanonical = shape.points[0];
        const bCanonical = shape.points[1];
        const a = HOP.projection.canonicalToScreen(aCanonical, view);
        const b = HOP.projection.canonicalToScreen(bCanonical, view);

        shapeGroup.appendChild(
          createSvgElement("line", {
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            class: "hop-shape-path"
          })
        );

        shapeGroup.appendChild(
          createSvgElement("line", {
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            class: "hop-shape-hit"
          })
        );

        if (
          settings.selectedEdge &&
          settings.selectedEdge.shapeId === shape.id &&
          settings.selectedEdge.edgeIndex === 0
        ) {
          shapeGroup.appendChild(
            createSvgElement("line", {
              x1: a.x,
              y1: a.y,
              x2: b.x,
              y2: b.y,
              class: "hop-selected-edge"
            })
          );
        }

        measurementGroup.appendChild(this._createEdgeHitLine(a, b, shape.id, 0));

        if (settings.showAllLengths && this._isEdgeVisible(shape, 0)) {
          const length = this._edgeLengthMeters(aCanonical, bCanonical);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

          measurementGroup.appendChild(
            this._createMeasurementBadge(
              (a.x + b.x) / 2 + nx * 12,
              (a.y + b.y) / 2 + ny * 12,
              formatLengthMeters(length),
              angleDeg,
              { shapeId: shape.id, edgeIndex: 0 }
            )
          );
        }

        if (settings.activeTool === HOP.constants.TOOL.CONNECTION) {
          shapeGroup.appendChild(this._createConnectionEndpoint(a, shape.id, 0));
          shapeGroup.appendChild(this._createConnectionEndpoint(b, shape.id, 1));
        }

        if (isEditShape || isSelected) {
          shapeGroup.appendChild(this._createVertexHandle(a, shape.id, 0));
          shapeGroup.appendChild(this._createVertexHandle(b, shape.id, 1));
        }

        if (isSelected && settings.activeTool === HOP.constants.TOOL.SELECT) {
          const rotateLayout = this._lineRotateHandlePosition(a, b);
          shapeGroup.appendChild(
            this._createRotateHandle(shape.id, rotateLayout.pivot, rotateLayout.handle)
          );
        }

        return { shapeGroup, measurementGroup };
      }

      if (
        (shape.type === "rectangle" || shape.type === "polygon") &&
        Array.isArray(shape.points) &&
        shape.points.length >= 3
      ) {
        const canonicalPoints = shape.points;
        const screenPoints = canonicalPoints.map((point) => HOP.projection.canonicalToScreen(point, view));
        const edgeCount = screenPoints.length;
        const hasOpenEdges = Array.from({ length: edgeCount }).some((_, index) =>
          this._isEdgeDeleted(shape, index)
        );

        if (!hasOpenEdges) {
          shapeGroup.appendChild(
            createSvgElement("polygon", {
              points: pointsToString(screenPoints),
              class: "hop-shape-path"
            })
          );

          shapeGroup.appendChild(
            createSvgElement("polygon", {
              points: pointsToString(screenPoints),
              class: "hop-shape-hit-fill"
            })
          );
        }

        for (let i = 0; i < edgeCount; i += 1) {
          if (this._isEdgeDeleted(shape, i)) {
            continue;
          }

          const next = (i + 1) % edgeCount;
          const a = screenPoints[i];
          const b = screenPoints[next];
          const aCanonical = canonicalPoints[i];
          const bCanonical = canonicalPoints[next];

          if (hasOpenEdges) {
            shapeGroup.appendChild(
              createSvgElement("line", {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                class: "hop-shape-path"
              })
            );
            shapeGroup.appendChild(
              createSvgElement("line", {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                class: "hop-shape-hit"
              })
            );
          }

          if (
            settings.selectedEdge &&
            settings.selectedEdge.shapeId === shape.id &&
            settings.selectedEdge.edgeIndex === i
          ) {
            shapeGroup.appendChild(
              createSvgElement("line", {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                class: "hop-selected-edge"
              })
            );
          }

          measurementGroup.appendChild(this._createEdgeHitLine(a, b, shape.id, i));

          if (settings.showAllLengths && this._isEdgeVisible(shape, i)) {
            const length = this._edgeLengthMeters(aCanonical, bCanonical);
            const edgeInfo = this._chooseOutsideNormal(screenPoints, a, b);
            const angleDeg = (Math.atan2(edgeInfo.dy, edgeInfo.dx) * 180) / Math.PI;

            measurementGroup.appendChild(
              this._createMeasurementBadge(
                (a.x + b.x) / 2 + edgeInfo.nx * 12,
                (a.y + b.y) / 2 + edgeInfo.ny * 12,
                formatLengthMeters(length),
                angleDeg,
                { shapeId: shape.id, edgeIndex: i }
              )
            );
          }
        }

        if (settings.showAllAreas && this._areaVisible(shape) && !hasOpenEdges) {
          const interiorCanonical = this._stableInteriorPoint(shape.id, canonicalPoints);
          if (interiorCanonical) {
            const interiorScreen = HOP.projection.canonicalToScreen(interiorCanonical, view);
            const area = HOP.geometry.polygonAreaSquareMeters(canonicalPoints);
            measurementGroup.appendChild(
              this._createAreaBadge(interiorScreen.x, interiorScreen.y, formatAreaSquareMeters(area))
            );
          }
        }

        if (isEditShape || isSelected) {
          for (let i = 0; i < screenPoints.length; i += 1) {
            shapeGroup.appendChild(this._createVertexHandle(screenPoints[i], shape.id, i));
          }
        }

        if (isSelected && settings.activeTool === HOP.constants.TOOL.SELECT) {
          const rotateLayout = this._polygonRotateHandlePosition(screenPoints);
          shapeGroup.appendChild(
            this._createRotateHandle(shape.id, rotateLayout.pivot, rotateLayout.handle)
          );
        }

        return { shapeGroup, measurementGroup };
      }

      if (shape.type === "label" && shape.point) {
        const anchor = HOP.projection.canonicalToScreen(shape.point, view);
        const boxModel = shape.labelBox && typeof shape.labelBox === "object" ? shape.labelBox : {};
        const boxWidth = Math.max(48, Math.min(360, Number(boxModel.width) || 96));
        const boxHeight = Math.max(20, Math.min(120, Number(boxModel.height) || 24));
        const offsetX = Number(boxModel.offsetX);
        const offsetY = Number(boxModel.offsetY);
        const boxX = anchor.x + (Number.isFinite(offsetX) ? offsetX : 10);
        const boxY = anchor.y + (Number.isFinite(offsetY) ? offsetY : -28);

        const fullText = shape.text || "Label";
        const fittedText = this._fitText(
          fullText,
          Math.max(20, boxWidth - 16),
          "700 12px 'Avenir Next', 'Segoe UI', sans-serif"
        );

        const stemTarget = this._closestPointOnRectBoundary(anchor, {
          x: boxX,
          y: boxY,
          width: boxWidth,
          height: boxHeight
        });

        shapeGroup.appendChild(
          createSvgElement("circle", {
            cx: anchor.x,
            cy: anchor.y,
            r: 4,
            class: "hop-label-anchor"
          })
        );

        shapeGroup.appendChild(
          createSvgElement("line", {
            x1: anchor.x,
            y1: anchor.y,
            x2: stemTarget.x,
            y2: stemTarget.y,
            class: "hop-label-stem"
          })
        );

        shapeGroup.appendChild(
          createSvgElement("rect", {
            x: boxX,
            y: boxY,
            rx: 7,
            ry: 7,
            width: boxWidth,
            height: boxHeight,
            class: "hop-label-box",
            "data-label-control": "bubble"
          })
        );

        const textNode = createSvgElement("text", {
          x: boxX + 8,
          y: boxY + boxHeight / 2 + 4,
          class: "hop-label-text",
          "data-label-control": "bubble"
        });
        textNode.textContent = fittedText;
        shapeGroup.appendChild(textNode);

        const titleNode = createSvgElement("title", {});
        titleNode.textContent = fullText;
        shapeGroup.appendChild(titleNode);

        if (isSelected) {
          shapeGroup.appendChild(
            createSvgElement("circle", {
              cx: boxX + boxWidth,
              cy: boxY + boxHeight,
              r: 5.2,
              class: "hop-label-resize-handle",
              "data-label-control": "resize"
            })
          );
        }

        return { shapeGroup, measurementGroup: null };
      }

      return null;
    }

    _renderDraft(draft, view) {
      if (!draft || !draft.type) {
        return null;
      }

      const group = createSvgElement("g", {
        class: "hop-draft-shape"
      });

      if (draft.type === "line" && draft.start && draft.end) {
        const a = HOP.projection.canonicalToScreen(draft.start, view);
        const b = HOP.projection.canonicalToScreen(draft.end, view);

        group.appendChild(
          createSvgElement("line", {
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            class: "hop-draft-path"
          })
        );

        return group;
      }

      if (draft.type === "rectangle" && draft.start && draft.end) {
        const rect = HOP.geometry.rectPointsFromDiagonal(draft.start, draft.end);
        const screenRect = rect.map((point) => HOP.projection.canonicalToScreen(point, view));

        group.appendChild(
          createSvgElement("polygon", {
            points: pointsToString(screenRect),
            class: "hop-draft-path"
          })
        );

        return group;
      }

      if (draft.type === "polygon" && Array.isArray(draft.points) && draft.points.length) {
        const points = draft.points.slice();
        if (draft.pointer) {
          points.push(draft.pointer);
        }

        if (points.length >= 2) {
          const screen = points.map((point) => HOP.projection.canonicalToScreen(point, view));
          group.appendChild(
            createSvgElement("polyline", {
              points: pointsToString(screen),
              class: "hop-draft-path",
              fill: "none"
            })
          );
        }

        return group;
      }

      return null;
    }
  }

  HOP.ShapeRenderer = ShapeRenderer;
})();
