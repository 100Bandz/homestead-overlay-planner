(() => {
  const HOP = (window.HOP = window.HOP || {});
  const constants = HOP.constants;
  const WORLD_SIZE = constants.TILE_SIZE * Math.pow(2, constants.CANONICAL_ZOOM);

  function clampLatitude(lat) {
    return Math.max(-constants.MAX_MERCATOR_LAT, Math.min(constants.MAX_MERCATOR_LAT, lat));
  }

  function normalizeCanonicalX(x) {
    const wrapped = ((x % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
    return wrapped;
  }

  function clampCanonicalY(y) {
    return Math.max(0, Math.min(WORLD_SIZE, y));
  }

  function latLngToCanonical(lat, lng) {
    const clampedLat = clampLatitude(Number(lat));
    const normalizedLng = ((((Number(lng) + 180) % 360) + 360) % 360) - 180;
    const sinLat = Math.sin((clampedLat * Math.PI) / 180);

    const x = ((normalizedLng + 180) / 360) * WORLD_SIZE;
    const y =
      (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * WORLD_SIZE;

    return {
      x: normalizeCanonicalX(x),
      y: clampCanonicalY(y)
    };
  }

  function canonicalToLatLng(point) {
    const xRatio = normalizeCanonicalX(point.x) / WORLD_SIZE;
    const yRatio = clampCanonicalY(point.y) / WORLD_SIZE;

    const lng = xRatio * 360 - 180;
    const n = Math.PI - 2 * Math.PI * yRatio;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

    return { lat, lng };
  }

  function wrapDeltaX(dx) {
    if (dx > WORLD_SIZE / 2) {
      return dx - WORLD_SIZE;
    }
    if (dx < -WORLD_SIZE / 2) {
      return dx + WORLD_SIZE;
    }
    return dx;
  }

  function buildViewModel(mapState, viewportWidth, viewportHeight, viewportLeft, viewportTop) {
    const center = latLngToCanonical(mapState.lat, mapState.lng);
    const scale = Math.pow(2, constants.CANONICAL_ZOOM - mapState.zoom);

    return {
      center,
      zoom: mapState.zoom,
      scale,
      viewportWidth,
      viewportHeight,
      viewportLeft: Number.isFinite(viewportLeft) ? viewportLeft : 0,
      viewportTop: Number.isFinite(viewportTop) ? viewportTop : 0,
      worldSize: WORLD_SIZE
    };
  }

  function canonicalToScreen(point, view) {
    const dx = wrapDeltaX(point.x - view.center.x);
    const dy = point.y - view.center.y;

    return {
      x: view.viewportLeft + view.viewportWidth / 2 + dx / view.scale,
      y: view.viewportTop + view.viewportHeight / 2 + dy / view.scale
    };
  }

  function screenToCanonical(point, view) {
    const rawX =
      view.center.x +
      (point.x - view.viewportLeft - view.viewportWidth / 2) * view.scale;
    const rawY =
      view.center.y +
      (point.y - view.viewportTop - view.viewportHeight / 2) * view.scale;

    return {
      x: normalizeCanonicalX(rawX),
      y: clampCanonicalY(rawY)
    };
  }

  function latLngDistanceMeters(a, b) {
    const R = constants.EARTH_RADIUS_METERS || 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;

    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;

    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);

    const h =
      sinDLat * sinDLat +
      Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  HOP.projection = {
    clampLatitude,
    normalizeCanonicalX,
    latLngToCanonical,
    canonicalToLatLng,
    buildViewModel,
    canonicalToScreen,
    screenToCanonical,
    latLngDistanceMeters,
    wrapDeltaX
  };
})();
