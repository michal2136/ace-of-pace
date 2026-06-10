import { useState } from 'react';
import { MapComponent } from './components/MapComponent';
import { Sidebar } from './components/Sidebar';
import { TopNavbar } from './components/TopNavbar';
import { LeftNavRail } from './components/LeftNavRail';
import { OnboardingModal } from './components/OnboardingModal';
import type { ActiveTab } from './components/LeftNavRail';
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

      const response = await fetch('http://localhost:8000/api/generate-loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: lat0, lng: lng0, distance_km: Number(targetDistance) }),
      });

      if (!response.ok) throw new Error('API Error');
      setRouteData(await response.json());
    } catch (err) {
      console.error(err);
      alert('Nie udało się wygenerować pętli z API. Upewnij się, że FastAPI działa!');
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

    // Pobierz geometrię: preferuj wygenerowany route, fallback na waypoints
    let coords: [number, number][] = [];
    if (routeData?.features?.[0]?.geometry?.coordinates) {
      coords = routeData.features[0].geometry.coordinates as [number, number][];
    } else if (waypoints.length >= 2) {
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
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '56px' }}>
        {/* Left Nav Rail (68px) */}
        <LeftNavRail activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Map — fills full remaining area */}
        <div className="relative flex-1" style={{ marginLeft: '68px' }}>
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
