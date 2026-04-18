(() => {
  const HOP = (window.HOP = window.HOP || {});

  const STANDARD_VIEW_RE =
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)([zm])/i;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function metersToApproxZoom(lat, meters, viewportHeight) {
    const safeMeters = Number(meters);
    if (!Number.isFinite(safeMeters) || safeMeters <= 0) {
      return null;
    }

    const safeViewportHeight = Math.max(
      320,
      Number(viewportHeight) || window.innerHeight || 900
    );
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

  function estimateLikelyMapViewportHeight() {
    const canvases = Array.from(document.querySelectorAll("canvas"));
    let bestHeight = window.innerHeight || 900;
    let bestArea = 0;

    canvases.forEach((canvas) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 280 || rect.height < 220) {
        return;
      }

      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        bestHeight = rect.height;
      }
    });

    return bestHeight;
  }

  function parseMapUrl(url, options) {
    if (typeof url !== "string") {
      return null;
    }

    const match = url.match(STANDARD_VIEW_RE);
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
      const viewportHeight =
        options && Number.isFinite(options.viewportHeight)
          ? options.viewportHeight
          : estimateLikelyMapViewportHeight();
      zoom = metersToApproxZoom(lat, zoomValue, viewportHeight);
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
      return null;
    }

    return {
      url,
      lat,
      lng,
      zoom,
      rawZoomValue: zoomValue,
      rawZoomUnit: zoomUnit,
      zoomSource: zoomUnit === "z" ? "url-z" : "url-meter-approx"
    };
  }

  function hasStateChanged(prev, next) {
    if (!prev || !next) {
      return true;
    }

    return (
      Math.abs(prev.lat - next.lat) > 1e-10 ||
      Math.abs(prev.lng - next.lng) > 1e-10 ||
      Math.abs(prev.zoom - next.zoom) > 1e-10 ||
      prev.url !== next.url
    );
  }

  class MapStateWatcher {
    constructor(onChange, onUnsupported) {
      this.onChange = typeof onChange === "function" ? onChange : () => {};
      this.onUnsupported = typeof onUnsupported === "function" ? onUnsupported : () => {};
      this.lastHref = "";
      this.currentState = null;
      this.intervalId = null;
      this.historyPatched = false;
      this.originalPushState = null;
      this.originalReplaceState = null;
      this.boundPopState = this._checkNow.bind(this, true);
      this.boundFallbackCheck = this._checkNow.bind(this, false);
    }

    start() {
      if (this.intervalId) {
        return;
      }

      this._patchHistory();
      window.addEventListener("popstate", this.boundPopState);
      this.intervalId = window.setInterval(this.boundFallbackCheck, 500);
      this._checkNow(true);
    }

    stop() {
      if (!this.intervalId) {
        return;
      }

      window.clearInterval(this.intervalId);
      this.intervalId = null;
      window.removeEventListener("popstate", this.boundPopState);
      this._restoreHistory();
    }

    _patchHistory() {
      if (this.historyPatched) {
        return;
      }

      this.originalPushState = history.pushState;
      this.originalReplaceState = history.replaceState;

      const watcher = this;
      history.pushState = function patchedPushState() {
        const result = watcher.originalPushState.apply(this, arguments);
        watcher._checkNow(true);
        return result;
      };

      history.replaceState = function patchedReplaceState() {
        const result = watcher.originalReplaceState.apply(this, arguments);
        watcher._checkNow(true);
        return result;
      };

      this.historyPatched = true;
    }

    _restoreHistory() {
      if (!this.historyPatched) {
        return;
      }

      if (this.originalPushState) {
        history.pushState = this.originalPushState;
      }
      if (this.originalReplaceState) {
        history.replaceState = this.originalReplaceState;
      }

      this.originalPushState = null;
      this.originalReplaceState = null;
      this.historyPatched = false;
    }

    _checkNow(force) {
      const href = window.location.href;
      if (!force && href === this.lastHref) {
        return;
      }

      this.lastHref = href;
      const parsed = parseMapUrl(href);
      if (!parsed) {
        this.currentState = null;
        this.onUnsupported();
        return;
      }

      if (hasStateChanged(this.currentState, parsed)) {
        this.currentState = parsed;
        this.onChange(parsed);
      }
    }
  }

  HOP.MapState = {
    parseMapUrl,
    hasStateChanged,
    MapStateWatcher
  };
})();
