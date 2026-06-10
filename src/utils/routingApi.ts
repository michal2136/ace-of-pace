import { LatLngExpression } from 'leaflet';

const getCoords = (p: any) => Array.isArray(p) ? `${p[1]},${p[0]}` : `${p.lng},${p.lat}`;

export const fetchRouteSegment = async (from: LatLngExpression, to: LatLngExpression): Promise<{ geojson: LatLngExpression[], distance: number, error?: boolean }> => {
  const apiKey = import.meta.env.VITE_ORS_API_KEY;
  const coordsStr = `${getCoords(from)};${getCoords(to)}`;

  try {
    let url = `https://router.project-osrm.org/route/v1/foot/${coordsStr}?overview=full&geometries=geojson`;
    
    if (apiKey && apiKey !== 'YOUR_ORS_API_KEY') {
      url = `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${apiKey}&start=${getCoords(from)}&end=${getCoords(to)}`;
      const res = await Promise.race([fetch(url), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))]) as Response;
      if (!res.ok) throw new Error('ORS API Error');
      const data = await res.json();
      const coords = data.features[0].geometry.coordinates.map((c: number[]) => [c[1], c[0]] as LatLngExpression);
      const dist = data.features[0].properties.segments[0].distance;
      return { geojson: coords, distance: dist };
    } else {
      const res = await Promise.race([fetch(url), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))]) as Response;
      if (!res.ok) throw new Error('OSRM API Error');
      const data = await res.json();
      if (data.code === 'Ok' && data.routes.length > 0) {
        const route = data.routes[0];
        const decodedGeometry = route.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as LatLngExpression);
        return { geojson: decodedGeometry, distance: route.distance };
      }
    }
  } catch (error) {
    console.warn("Routing API error, fallback to straight line", error);
  }
  
  // Straight line fallback z błędem
  // Przybliżenie Haversine dla linii prostej z promieniem ziemi ~6371km
  const lat1 = Array.isArray(from) ? from[0] : (from as any).lat;
  const lon1 = Array.isArray(from) ? from[1] : (from as any).lng;
  const lat2 = Array.isArray(to) ? to[0] : (to as any).lat;
  const lon2 = Array.isArray(to) ? to[1] : (to as any).lng;
  const R = 6371e3; // meters
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const d = R * c;
  
  return { geojson: [from, to], distance: d, error: true };
};

export const snapToRoad = async (point: LatLngExpression): Promise<LatLngExpression> => {
  const coordsStr = getCoords(point);
  try {
    const res = await Promise.race([
        fetch(`https://router.project-osrm.org/nearest/v1/foot/${coordsStr}`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]) as Response;
    const data = await res.json();
    if (data.code === 'Ok' && data.waypoints.length > 0) {
      return [data.waypoints[0].location[1], data.waypoints[0].location[0]];
    }
  } catch (e) {
    console.warn("Snap to road error", e);
  }
  return point;
}
