(() => {
  const HOP = (window.HOP = window.HOP || {});
  const STORAGE_KEY = HOP.constants.STORAGE_KEY;

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
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
    if (!raw || typeof raw !== "object") {
      return {
        offsetX: 10,
        offsetY: -28,
        width: 96,
        height: 24
      };
    }

    const offsetX = Number(raw.offsetX);
    const offsetY = Number(raw.offsetY);
    const width = Number(raw.width);
    const height = Number(raw.height);
    const referenceScale = Number(raw.referenceScale);

    const sanitized = {
      offsetX: Number.isFinite(offsetX) ? offsetX : 10,
      offsetY: Number.isFinite(offsetY) ? offsetY : -28,
      width: Number.isFinite(width) ? Math.max(48, Math.min(360, width)) : 96,
      height: Number.isFinite(height) ? Math.max(20, Math.min(120, height)) : 24
    };

    if (Number.isFinite(referenceScale) && referenceScale > 0) {
      sanitized.referenceScale = referenceScale;
    }

    return sanitized;
  }

  function sanitizeShape(shape) {
    if (!shape || typeof shape !== "object" || typeof shape.type !== "string") {
      return null;
    }

    const clean = {
      id: typeof shape.id === "string" ? shape.id : HOP.ids.createId("shape"),
      type: shape.type
    };

    if (shape.type === "label") {
      const point = sanitizePoint(shape.point);
      if (!point) {
        return null;
      }
      clean.point = point;
      clean.text = typeof shape.text === "string" ? shape.text : "";
      clean.labelBox = sanitizeLabelBox(shape.labelBox);
      return clean;
    }

    const points = safeArray(shape.points).map(sanitizePoint).filter(Boolean);
    if (!points.length) {
      return null;
    }

    clean.points = points;
    if (typeof shape.label === "string") {
      clean.label = shape.label;
    }

    const measurements = shape.measurements && typeof shape.measurements === "object"
      ? shape.measurements
      : {};

    const edgeCount = shape.type === "line" ? 1 : points.length;
    const rawEdgeVisibility = safeArray(measurements.edgeVisibility);
    clean.measurements = {
      edgeVisibility: Array.from({ length: edgeCount }, (_, index) =>
        typeof rawEdgeVisibility[index] === "boolean" ? rawEdgeVisibility[index] : true
      )
    };

    if (shape.type === "rectangle" || shape.type === "polygon") {
      clean.measurements.areaVisible =
        typeof measurements.areaVisible === "boolean" ? measurements.areaVisible : true;
    }

    return clean;
  }

  function sanitizePlan(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const id = typeof raw.id === "string" ? raw.id : HOP.ids.createId("plan");
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Untitled Plan";

    const source = raw.source && typeof raw.source === "object" ? raw.source : {};
    const lat = Number(source.lat);
    const lng = Number(source.lng);
    const zoom = Number(source.zoom);

    const cleanSource = {
      url: typeof source.url === "string" ? source.url : "",
      lat: Number.isFinite(lat) ? lat : 0,
      lng: Number.isFinite(lng) ? lng : 0,
      zoom: Number.isFinite(zoom) ? zoom : 0,
      viewportWidth: Number(source.viewportWidth) || 0,
      viewportHeight: Number(source.viewportHeight) || 0
    };

    const createdAt =
      typeof raw.createdAt === "string" && !Number.isNaN(Date.parse(raw.createdAt))
        ? raw.createdAt
        : new Date().toISOString();

    const updatedAt =
      typeof raw.updatedAt === "string" && !Number.isNaN(Date.parse(raw.updatedAt))
        ? raw.updatedAt
        : createdAt;

    const shapes = safeArray(raw.shapes).map(sanitizeShape).filter(Boolean);

    return {
      id,
      name,
      createdAt,
      updatedAt,
      source: cleanSource,
      shapes
    };
  }

  function storageErrorMessage(error) {
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
    return "unknown storage error";
  }

  class PlanStorage {
    async _readPlans(strict) {
      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        return safeArray(data[STORAGE_KEY]).map(sanitizePlan).filter(Boolean);
      } catch (error) {
        if (strict) {
          throw new Error(`Storage read failed: ${storageErrorMessage(error)}`);
        }
        return [];
      }
    }

    async getAllPlans() {
      return this._readPlans(false);
    }

    async _writePlans(plans) {
      try {
        await chrome.storage.local.set({
          [STORAGE_KEY]: plans
        });
      } catch (error) {
        throw new Error(`Storage write failed: ${storageErrorMessage(error)}`);
      }
    }

    async getPlan(planId) {
      const plans = await this.getAllPlans();
      return plans.find((plan) => plan.id === planId) || null;
    }

    async savePlan(plan) {
      const cleaned = sanitizePlan(plan);
      if (!cleaned) {
        throw new Error("Invalid plan data");
      }

      const plans = await this._readPlans(true);
      const existingIndex = plans.findIndex((item) => item.id === cleaned.id);

      if (existingIndex >= 0) {
        plans[existingIndex] = {
          ...plans[existingIndex],
          ...cleaned,
          createdAt: plans[existingIndex].createdAt,
          updatedAt: new Date().toISOString()
        };
      } else {
        const now = new Date().toISOString();
        plans.push({
          ...cleaned,
          createdAt: cleaned.createdAt || now,
          updatedAt: now
        });
      }

      await this._writePlans(plans);

      return plans.find((item) => item.id === cleaned.id) || cleaned;
    }

    async deletePlan(planId) {
      const plans = await this._readPlans(true);
      const nextPlans = plans.filter((plan) => plan.id !== planId);

      await this._writePlans(nextPlans);

      return nextPlans.length !== plans.length;
    }
  }

  HOP.PlanStorage = PlanStorage;
})();
