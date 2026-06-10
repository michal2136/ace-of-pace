import { Undo2, Loader2, Download, Search, MapPin, Crosshair } from 'lucide-react';
import { SaveRouteWidget } from './SaveRouteWidget';
import { useState, useEffect } from 'react';
import { AssistantPanel } from './AssistantPanel';
import { SavedRoutesPanel } from './SavedRoutesPanel';
import { StravaActivitiesPanel } from './StravaActivitiesPanel';
import { PlannerPanel } from './PlannerPanel';
import { PanelErrorBoundary } from './ErrorBoundary';
import { useAuth } from '../context/AuthContext';
import type { ActiveTab } from './LeftNavRail';

export interface SidebarProps {
  activeTab: ActiveTab;
  distance: string;
  pointsCount: number;
  currentCity: string;
  onLocationSelect: (lat: number, lng: number, cityName: string, zoom?: number) => void;
  onClear: () => void;
  onUndo: () => void;
  onExport: () => void;
  targetDistance: number | '';
  setTargetDistance: (val: number | '') => void;
  isGenerating: boolean;
  onGenerateLoop: () => void;
  onLoadSavedRoute: (geojson: any) => void;
  onSaveCurrentRoute?: (name?: string) => Promise<boolean | undefined>;
  hasRoute?: boolean;
}

export const Sidebar = ({
  activeTab,
  distance,
  pointsCount,
  currentCity,
  onLocationSelect,
  onClear,
  onUndo,
  onExport,
  targetDistance,
  setTargetDistance,
  isGenerating,
  onGenerateLoop,
  onLoadSavedRoute,
  onSaveCurrentRoute,
  hasRoute = false,
}: SidebarProps) => {
  const { user } = useAuth();

  // "Zapytaj Kasię" bridge: Strava → Assistant
  const [analysisRequest, setAnalysisRequest] = useState<{ activityId: number; activityName: string } | null>(null);

  const handleRequestAnalysis = (activityId: number, activityName: string) => {
    setAnalysisRequest({ activityId, activityName });
  };

  // Geocoding search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 3) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&addressdetails=1`
        );
        setSearchResults(await res.json());
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert('Geolokalizacja nie jest wspierana przez twoją przeglądarkę.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || 'Moja lokalizacja';
          onLocationSelect(lat, lng, city, 14);
        } catch {
          onLocationSelect(lat, lng, 'Moja lokalizacja', 14);
        }
      },
      () => alert('Odmówiono dostępu do lokalizacji.')
    );
  };

  return (
    <aside
      className="fixed flex flex-col overflow-hidden"
      style={{
        top: '56px',
        left: '68px',
        bottom: 0,
        width: '308px',
        zIndex: 1002,
        background: 'var(--glass-bg)',
        borderRight: '1px solid var(--glass-border)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '4px 0 32px rgba(0,0,0,0.20)',
      }}
    >
      {/* Content Panel */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">

        {/* ── MAPPER ──────────────────────────────────────────── */}
        {activeTab === 'mapper' && (
          <>
            {/* Section header */}
            <div>
              <h2
                className="text-base font-bold tracking-tight"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Planowanie Trasy
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                Punkt startowy:{' '}
                <span className="font-semibold" style={{ color: 'var(--color-success)' }}>
                  {currentCity}
                </span>
              </p>
            </div>

            {/* Search */}
            <div className="flex flex-col gap-2 relative">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-muted)' }}
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Wpisz miasto..."
                    className="input-base pl-9"
                  />
                  {isSearching && (
                    <Loader2
                      className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin"
                      style={{ color: 'var(--color-text-muted)' }}
                    />
                  )}
                </div>
                <button
                  onClick={handleLocateMe}
                  title="Lokalizuj mnie"
                  className="px-3 rounded-xl flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95"
                  style={{
                    background: 'var(--color-surface-overlay)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-accent)',
                  }}
                >
                  <Crosshair className="w-5 h-5" />
                </button>
              </div>

              {searchResults.length > 0 && (
                <div
                  className="absolute top-full left-0 w-full rounded-xl overflow-hidden shadow-2xl z-50 mt-1"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {searchResults.map((res: any) => (
                    <button
                      key={res.place_id}
                      onClick={() => {
                        const name = res.name || res.display_name.split(',')[0];
                        onLocationSelect(Number(res.lat), Number(res.lon), name);
                        setSearchQuery('');
                        setSearchResults([]);
                      }}
                      className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-colors duration-100"
                      style={{
                        color: 'var(--color-text-primary)',
                        borderBottom: '1px solid var(--color-border)',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-surface-elevated)')}
                      onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <MapPin className="w-4 h-4 shrink-0" style={{ color: 'var(--color-success)' }} />
                      <span className="truncate">{res.display_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Distance display */}
            <div
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{
                background: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border)',
              }}
            >
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Dystans trasy</span>
              <span className="text-2xl font-bold" style={{ color: 'var(--color-success)' }}>{distance} km</span>
            </div>

            {/* Points + Undo/Clear */}
            <div className="flex justify-between items-center text-xs px-1" style={{ color: 'var(--color-text-muted)' }}>
              <span>Punktów: <strong style={{ color: 'var(--color-text-secondary)' }}>{pointsCount}</strong></span>
              <div className="flex items-center gap-3">
                <button
                  onClick={onUndo}
                  disabled={pointsCount === 0}
                  className="flex items-center gap-1 transition-opacity disabled:opacity-30"
                  style={{ color: 'var(--color-text-secondary)' }}
                  onMouseOver={(e) => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                  onMouseOut={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                >
                  <Undo2 className="w-4 h-4" /> Cofnij
                </button>
                {pointsCount > 0 && (
                  <button
                    onClick={onClear}
                    className="transition-opacity"
                    style={{ color: '#f87171' }}
                    onMouseOver={(e) => (e.currentTarget.style.opacity = '0.7')}
                    onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                  >
                    Wyczyść
                  </button>
                )}
              </div>
            </div>

            {/* Export GPX */}
            <button
              onClick={onExport}
              disabled={pointsCount < 2}
              className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            >
              <Download className="w-4 h-4" /> Eksportuj GPX
            </button>

            {/* ── Zapisz trasę do biblioteki ── */}
            {hasRoute && onSaveCurrentRoute && (
              <SaveRouteWidget
                onSave={async (name) => onSaveCurrentRoute(name)}
                defaultName={`Trasa ${new Date().toLocaleDateString('pl-PL')}`}
              />
            )}

            {/* Generate Loop */}
            <div
              className="flex flex-col gap-3 pt-4"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  Generuj Smart Pętlę
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  AI dobierze optymalną trasę
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="distance" className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  Docelowy dystans (km)
                </label>
                <input
                  id="distance"
                  type="number"
                  value={targetDistance}
                  onChange={(e) => setTargetDistance(e.target.value ? Number(e.target.value) : '')}
                  placeholder="np. 15"
                  className="input-base"
                />
              </div>
              {pointsCount === 0 && (
                <p className="text-xs" style={{ color: '#fbbf24' }}>
                  Najpierw zaznacz środek pętli na mapie.
                </p>
              )}
              <button
                onClick={onGenerateLoop}
                disabled={pointsCount === 0 || !targetDistance || isGenerating}
                className="w-full flex justify-center items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all duration-200 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 disabled:hover:translate-y-0"
                style={{
                  background: 'linear-gradient(135deg, #059669, #10b981)',
                  boxShadow: '0 4px 14px rgba(16,185,129,0.25)',
                }}
              >
                {isGenerating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generowanie…</>
                ) : (
                  'Wyznacz Pętlę (Smart)'
                )}
              </button>
            </div>
          </>
        )}

        {/* ── TRASY ───────────────────────────────────────────── */}
        {activeTab === 'routes' && (
          <>
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Twoje Trasy</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Zapisana biblioteka tras</p>
            </div>
            <SavedRoutesPanel userId={user?.user_id ?? null} onLoadRoute={onLoadSavedRoute} />
          </>
        )}

        {/* ── STRAVA ──────────────────────────────────────────── */}
        {activeTab === 'strava' && (
          <>
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Treningi Strava</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Ostatnie aktywności z konta</p>
            </div>
            <StravaActivitiesPanel
              onLoadRoute={onLoadSavedRoute}
              onRequestAnalysis={handleRequestAnalysis}
            />
          </>
        )}

        {/* ── PLANER ──────────────────────────────────────────── */}
        {activeTab === 'planner' && (
          <>
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Planer & Cele</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Zarządzaj startami i planem treningowym</p>
            </div>
            <PanelErrorBoundary label="Planer">
              <PlannerPanel />
            </PanelErrorBoundary>
          </>
        )}

        {/* ── ASYSTENT KASIA ──────────────────────────────────── */}
        {activeTab === 'assistant' && (
          <div className="-mx-4 -mb-4 -mt-0 h-full flex flex-col">
            <AssistantPanel
              initialAnalysis={analysisRequest}
              onAnalysisConsumed={() => setAnalysisRequest(null)}
            />
          </div>
        )}
      </div>
    </aside>
  );
};
