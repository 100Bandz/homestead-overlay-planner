(() => {
  const HOP = (window.HOP = window.HOP || {});

  function distance(a, b) {
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function rectPointsFromDiagonal(a, b) {
    return [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y }
    ];
  }

  function pointInPolygon(point, polygonPoints) {
    if (!Array.isArray(polygonPoints) || polygonPoints.length < 3) {
      return false;
    }

    let inside = false;
    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
      const xi = polygonPoints[i].x;
      const yi = polygonPoints[i].y;
      const xj = polygonPoints[j].x;
      const yj = polygonPoints[j].y;

      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;

      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  function nearestPointOnSegment(point, segA, segB) {
    const abx = segB.x - segA.x;
    const aby = segB.y - segA.y;
    const lengthSquared = abx * abx + aby * aby;

    if (lengthSquared === 0) {
      return { x: segA.x, y: segA.y };
    }

    let t = ((point.x - segA.x) * abx + (point.y - segA.y) * aby) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    return {
      x: segA.x + abx * t,
      y: segA.y + aby * t
    };
  }

  function distanceToSegment(point, segA, segB) {
    const nearest = nearestPointOnSegment(point, segA, segB);
    return distance(point, nearest);
  }

  function polygonCentroid(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return null;
    }

    let signedArea = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < points.length; i += 1) {
      const next = (i + 1) % points.length;
      const x0 = points[i].x;
      const y0 = points[i].y;
      const x1 = points[next].x;
      const y1 = points[next].y;
      const cross = x0 * y1 - x1 * y0;
      signedArea += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }

    if (Math.abs(signedArea) < 1e-9) {
      const avg = points.reduce(
        (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
        { x: 0, y: 0 }
      );
      return {
        x: avg.x / points.length,
        y: avg.y / points.length
      };
    }

    const areaFactor = 1 / (3 * signedArea);
    return {
      x: cx * areaFactor,
      y: cy * areaFactor
    };
  }

  function polygonAreaSquareMeters(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return 0;
    }

    const R = 6378137;
    const projected = points.map((point) => {
      const ll = HOP.projection.canonicalToLatLng(point);
      const latRad = (ll.lat * Math.PI) / 180;
      const lngRad = (ll.lng * Math.PI) / 180;
      return {
        x: R * lngRad,
        y: R * Math.log(Math.tan(Math.PI / 4 + latRad / 2))
      };
    });

    let sum = 0;
    for (let i = 0; i < projected.length; i += 1) {
      const next = (i + 1) % projected.length;
      sum +=
        projected[i].x * projected[next].y -
        projected[next].x * projected[i].y;
    }

    return Math.abs(sum) * 0.5;
  }

  HOP.geometry = {
    distance,
    rectPointsFromDiagonal,
    pointInPolygon,
    nearestPointOnSegment,
    distanceToSegment,
    polygonCentroid,
    polygonAreaSquareMeters
  };
})();
