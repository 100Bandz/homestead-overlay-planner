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

    const earthRadiusMeters =
      (HOP.constants && HOP.constants.EARTH_RADIUS_METERS) || 6371000;
    const latLng = points.map((point) => HOP.projection.canonicalToLatLng(point));
    const lat0Deg = latLng.reduce((sum, value) => sum + value.lat, 0) / latLng.length;
    const lat0Rad = (lat0Deg * Math.PI) / 180;

    const unwrappedLng = [latLng[0].lng];
    for (let i = 1; i < latLng.length; i += 1) {
      const previous = unwrappedLng[i - 1];
      let current = latLng[i].lng;
      let delta = current - previous;
      while (delta > 180) {
        current -= 360;
        delta = current - previous;
      }
      while (delta < -180) {
        current += 360;
        delta = current - previous;
      }
      unwrappedLng.push(current);
    }

    const lng0Deg = unwrappedLng.reduce((sum, value) => sum + value, 0) / unwrappedLng.length;

    const projected = latLng.map((value, index) => {
      const dLatRad = ((value.lat - lat0Deg) * Math.PI) / 180;
      const dLngRad = ((unwrappedLng[index] - lng0Deg) * Math.PI) / 180;
      return {
        // Local tangent-plane approximation: good for small homestead-scale shapes.
        x: earthRadiusMeters * dLngRad * Math.cos(lat0Rad),
        y: earthRadiusMeters * dLatRad
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
