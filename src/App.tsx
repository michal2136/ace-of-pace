import { useState } from 'react';
import { MapComponent } from './components/MapComponent';
import { Sidebar } from './components/Sidebar';
import { TopNavbar } from './components/TopNavbar';
import type { ActiveTab } from './components/LeftNavRail';
import { OnboardingModal } from './components/OnboardingModal';
import { LatLngExpression } from 'leaflet';
import { exportGpx } from './utils/exportGpx';
import { useRouteSegments } from './hooks/useRouteSegments';
import { Waypoint } from './types/routing';
import { snapToRoad } from './utils/routingApi';
import { useAuth } from './context/AuthContext';


const genId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);

export interface LocationState {
  lat: number;
  lng: number;
  cityName: string;
  zoom: number;
}

const DEFAULT_LOCATION: LocationState = { lat: 52.0, lng: 19.0, cityName: 'Polska', zoom: 6 };

function App() {
  const { isLoggedIn, user } = useAuth();

  // Show onboarding modal when user is new (no displayName set)
  const showOnboarding = isLoggedIn && !!user && !user.onboarding_done;

  // ── Active tab (shared between NavRail + Sidebar) ───────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('mapper');

  // ── Location ────────────────────────────────────────────────
  const [location, setLocation] = useState<LocationState>(() => {
    try {
      const saved = localStorage.getItem('smartloop_default_location');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { lat: parsed.lat, lng: parsed.lng, cityName: parsed.cityName, zoom: 13 };
      }
    } catch {}
    return DEFAULT_LOCATION;
  });

  const handleLocationSelect = (lat: number, lng: number, cityName: string, zoom = 13) => {
    setLocation({ lat, lng, cityName, zoom });
    localStorage.setItem('smartloop_default_location', JSON.stringify({ lat, lng, cityName }));
  };

  // ── Routing state ────────────────────────────────────────────
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [targetDistance, setTargetDistance] = useState<number | ''>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [routeData, setRouteData] = useState<any>(null);

  const { segments, totalDistance } = useRouteSegments(waypoints);

  const displayedDistance =
    routeData && routeData.features?.[0]?.properties?.distance_m
      ? (routeData.features[0].properties.distance_m / 1000).toFixed(2)
      : totalDistance;

  const handleAddWaypoint = (latlng: LatLngExpression) => {
    setWaypoints(prev => [...prev, { id: genId(), latlng }]);
  };

  const handleUpdateWaypoint = async (id: string, latlng: LatLngExpression) => {
    const snapped = await snapToRoad(latlng);
    setWaypoints(prev => prev.map(wp => wp.id === id ? { ...wp, latlng: snapped } : wp));
  };

  const handleInsertWaypoint = async (afterId: string, latlng: LatLngExpression) => {
    const snapped = await snapToRoad(latlng);
    setWaypoints(prev => {
      const idx = prev.findIndex(w => w.id === afterId);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy.splice(idx + 1, 0, { id: genId(), latlng: snapped });
      return copy;
    });
  };

  const handleRemoveWaypoint = (id: string) => {
    setWaypoints(prev => prev.filter(w => w.id !== id));
  };

  const handleUndo = () => {
    setWaypoints(prev => prev.slice(0, -1));
  };

  const handleGenerateLoop = async () => {
    if (waypoints.length === 0 || !targetDistance) return;
    setIsGenerating(true);
    setRouteData(null);
    try {
      const startPt = waypoints[0].latlng;
      const lat0 = Array.isArray(startPt) ? startPt[0] : (startPt as any).lat;
      const lng0 = Array.isArray(startPt) ? startPt[1] : (startPt as any).lng;

      let response;
      try {
        response = await fetch('http://localhost:8000/api/generate-loop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: lat0, lng: lng0, distance_km: Number(targetDistance) }),
        });
      } catch (networkErr) {
        throw new Error('NETWORK_ERROR');
      }

      if (!response.ok) {
        let errMsg = 'Nieznany błąd serwera.';
        try {
          const errData = await response.json();
          if (errData && errData.detail) {
            errMsg = errData.detail;
          }
        } catch (_) {}
        throw new Error(errMsg);
      }
      setRouteData(await response.json());
    } catch (err: any) {
      console.error(err);
      if (err.message === 'NETWORK_ERROR') {
        alert('Nie udało się połączyć z serwerem. Upewnij się, że FastAPI działa!');
      } else {
        alert(`Błąd generowania pętli: ${err.message}`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleLoadSavedRoute = (geojsonFeature: any) => {
    setRouteData({ type: 'FeatureCollection', features: [geojsonFeature] });
    setWaypoints([]);
  };

  // ── Zapisz bieżącą trasę mapy do biblioteki ────────────────
  const handleSaveCurrentRoute = async (name?: string) => {
    if (!user) return;

    // Pobierz geometrię:
    // 1. Wygenerowana pętla (routeData z backendu) → pełna geometria z GeoJSON
    // 2. Ręcznie rysowana trasa (Mapper + OSRM) → użyj geometrii segmentów
    //    (ta sama logika co eksport GPX — zawiera setki punktów snap do dróg)
    // 3. Fallback → surowe waypointy (ostateczność)
    let coords: [number, number][] = [];

    if (routeData?.features?.[0]?.geometry?.coordinates) {
      // Pętla wygenerowana przez AI — geometry.coordinates już w formacie [lng, lat]
      coords = routeData.features[0].geometry.coordinates as [number, number][];
    } else if (segments.length > 0 && segments.some(s => s.geojson.length > 0)) {
      // Ręcznie rysowana trasa — bierzemy pełną geometrię OSRM (snap do ulic)
      // seg.geojson to LatLngExpression[] czyli [lat, lng] → zamieniamy na [lng, lat] dla GeoJSON
      const allPoints = segments.flatMap(s => s.geojson);
      coords = allPoints.map(ll => {
        if (Array.isArray(ll)) return [ll[1], ll[0]] as [number, number];   // [lat,lng] → [lng,lat]
        return [(ll as any).lng, (ll as any).lat] as [number, number];
      });
    } else if (waypoints.length >= 2) {
      // Ostatni fallback — tylko punkty kliknięć (brak geometrii)
      coords = waypoints.map(wp => {
        const ll = wp.latlng;
        if (Array.isArray(ll)) return [ll[1], ll[0]] as [number, number];
        return [(ll as any).lng, (ll as any).lat] as [number, number];
      });
    }

    if (coords.length < 2) return;

    const geojson = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    };

    const distKm = parseFloat(displayedDistance) || 0;
    const routeName = name || `Trasa ${new Date().toLocaleDateString('pl-PL')} — ${distKm} km`;

    try {
      const res = await fetch('http://localhost:8000/api/routes/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:         user.user_id,
          name:            routeName,
          distance_m:      distKm * 1000,
          geojson_feature: geojson,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (err) {
      console.error('[saveRoute]', err);
      return false;
    }
  };

  const fullRouteGeometry = segments.flatMap(s => s.geojson);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* ── Top Navbar (fixed, 56px) ──────────────────────────── */}
      <TopNavbar onNavigate={setActiveTab} activeTab={activeTab} />

      {/* ── Below navbar ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '64px' }}>
        {/* Map — fills full remaining area */}
        <div className="relative flex-1">
          <MapComponent
            waypoints={waypoints}
            segments={segments}
            location={location}
            routeData={routeData}
            onAddWaypoint={handleAddWaypoint}
            onUpdateWaypoint={handleUpdateWaypoint}
            onInsertWaypoint={handleInsertWaypoint}
            onRemoveWaypoint={handleRemoveWaypoint}
          />
        </div>
      </div>

      {/* Sidebar — fixed glass panel over map (portal-like, fixed to viewport) */}
      <Sidebar
        activeTab={activeTab}
        onNavigate={setActiveTab}
        distance={displayedDistance}
        pointsCount={routeData ? (routeData.features?.[0]?.geometry?.coordinates?.length ?? 0) : waypoints.length}
        currentCity={location.cityName}
        onLocationSelect={handleLocationSelect}
        onClear={() => { setWaypoints([]); setRouteData(null); }}
        onUndo={handleUndo}
        onExport={() =>
          exportGpx(
            fullRouteGeometry.length > 0 ? fullRouteGeometry : waypoints.map(w => w.latlng)
          )
        }
        targetDistance={targetDistance}
        setTargetDistance={setTargetDistance}
        isGenerating={isGenerating}
        onGenerateLoop={handleGenerateLoop}
        onLoadSavedRoute={handleLoadSavedRoute}
        onSaveCurrentRoute={handleSaveCurrentRoute}
        hasRoute={!!(routeData || waypoints.length >= 2)}
      />

      {/* Onboarding modal — shown on first login */}
      {showOnboarding && <OnboardingModal onComplete={() => {}} />}
    </div>
  );
}

export default App;
