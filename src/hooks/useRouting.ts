import { useState, useEffect } from 'react';
import { LatLngExpression } from 'leaflet';

export const useRouting = (points: LatLngExpression[]) => {
  const [routeGeometry, setRouteGeometry] = useState<LatLngExpression[]>([]);
  const [routeDistance, setRouteDistance] = useState<string>('0.00');
  const [isRouting, setIsRouting] = useState(false);

  useEffect(() => {
    if (points.length < 2) {
      setRouteGeometry(points); // jeśli tylko 1 punkt to bez geometrii
      setRouteDistance('0.00');
      return;
    }

    const fetchRoute = async () => {
      setIsRouting(true);
      try {
        const coordinates = points.map(p => {
          const lat = Array.isArray(p) ? p[0] : (p as any).lat;
          const lng = Array.isArray(p) ? p[1] : (p as any).lng;
          return `${lng},${lat}`;
        }).join(';');

        // Korzystamy z publicznego API OSRM z prośbą o trasę pieszego (foot)
        const res = await fetch(`https://router.project-osrm.org/route/v1/foot/${coordinates}?overview=full&geometries=geojson`);
        const data = await res.json();

        if (data.code === 'Ok' && data.routes.length > 0) {
          const route = data.routes[0];
          // GeoJSON zapisuje jako [long, lat], Leaflet wymaga [lat, long]
          const decodedGeometry = route.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as LatLngExpression);
          setRouteGeometry(decodedGeometry);
          setRouteDistance((route.distance / 1000).toFixed(2));
        } else {
          // Fallback w razie błędu API (np. brak trasy)
          setRouteGeometry(points);
        }
      } catch (err) {
        console.error('Błąd wyznaczania trasy:', err);
        setRouteGeometry(points); // fallback na proste linie w razie braku połączenia
      } finally {
        setIsRouting(false);
      }
    };

    const debounce = setTimeout(fetchRoute, 400); // 400ms by nie spamować API podczas przeciągania
    return () => clearTimeout(debounce);
  }, [points]);

  return { routeGeometry, routeDistance, isRouting };
};
