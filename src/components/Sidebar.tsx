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
  onNavigate: (tab: ActiveTab) => void;
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
  onNavigate,
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
    onNavigate('assistant');
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
      className="fixed flex flex-col overflow-hidden border-r border-border"
      style={{
        top: '64px',
        left: 0,
        bottom: 0,
        width: '400px',
        zIndex: 1002,
        backgroundColor: 'var(--color-surface)',
      }}
    >
      {/* Content Panel */}
      <div
        className={`flex-1 custom-scrollbar p-4 flex flex-col gap-4 ${
          (activeTab === 'planner' || activeTab === 'assistant') ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >

        {/* ── MAPPER ──────────────────────────────────────────── */}
        {activeTab === 'mapper' && (
          <>
            {/* Section header */}
            <div className="flex flex-col gap-0.5">
              <h2 className="text-xl font-black tracking-tight text-primary font-display">
                Planowanie Trasy
              </h2>
              <p className="text-xs text-secondary">
                Punkt startowy:{' '}
                <span className="font-bold" style={{ color: 'var(--color-accent)' }}>
                  {currentCity}
                </span>
              </p>
            </div>

            {/* Search */}
            <div className="flex flex-col gap-2 relative">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Wpisz miasto..."
                    className="input-base pl-9 w-full"
                  />
                  {isSearching && (
                    <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted" />
                  )}
                </div>
                <button
                  onClick={handleLocateMe}
                  title="Lokalizuj mnie"
                  className="w-10 h-10 shrink-0 rounded-[2px] flex items-center justify-center transition-colors border border-border bg-surface-overlay text-accent hover:bg-surface-elevated cursor-pointer"
                >
                  <Crosshair className="w-4 h-4" />
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
            <div className="flex items-center justify-between p-4 border border-border">
              <span className="text-sm font-bold text-secondary">Dystans trasy</span>
              <span className="text-3xl font-black font-display tracking-tighter" style={{ color: 'var(--color-accent)' }}>{distance} km</span>
            </div>

            {/* Points + Undo/Clear */}
            <div className="flex justify-between items-center text-[11px] font-mono-custom uppercase tracking-widest text-muted px-1 mt-1">
              <span>PUNKTÓW: <strong className="text-primary">{pointsCount}</strong></span>
              <div className="flex items-center gap-4">
                <button
                  onClick={onUndo}
                  disabled={pointsCount === 0}
                  className="flex items-center gap-1.5 transition-colors disabled:opacity-30 text-secondary hover:text-primary bg-transparent border-none cursor-pointer p-0 uppercase"
                >
                  <Undo2 className="w-3.5 h-3.5" /> Cofnij
                </button>
                {pointsCount > 0 && (
                  <button
                    onClick={onClear}
                    className="text-danger hover:opacity-70 transition-opacity bg-transparent border-none cursor-pointer p-0 uppercase"
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
              className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold border border-border bg-transparent text-primary hover:bg-surface-elevated transition-colors cursor-pointer mt-1"
            >
              <Download className="w-3.5 h-3.5" /> Eksportuj GPX
            </button>

            {/* ── Zapisz trasę do biblioteki ── */}
            {hasRoute && onSaveCurrentRoute && (
              <SaveRouteWidget
                onSave={async (name) => onSaveCurrentRoute(name)}
                defaultName={`Trasa ${new Date().toLocaleDateString('pl-PL')}`}
              />
            )}

            {/* Generate Loop */}
            <div className="flex flex-col gap-3 mt-1">
              <div className="w-full h-px bg-primary opacity-20 my-1" />
              <div className="flex flex-col">
                <h3 className="text-lg font-black text-primary font-display tracking-tight">
                  Generuj Smart Pętlę
                </h3>
                <p className="text-[11px] text-secondary">
                  AI dobierze optymalną trasę
                </p>
              </div>
              <div className="flex flex-col gap-1.5 mt-1">
                <label htmlFor="distance" className="text-[10px] font-bold uppercase tracking-widest text-secondary font-mono-custom">
                  DOCELOWY DYSTANS (KM)
                </label>
                <input
                  id="distance"
                  type="number"
                  value={targetDistance}
                  onChange={(e) => setTargetDistance(e.target.value ? Number(e.target.value) : '')}
                  placeholder="np. 15"
                  className="input-base p-2.5 text-sm"
                />
              </div>
              {pointsCount === 0 && (
                <p className="text-xs text-warning mt-0.5">
                  Najpierw zaznacz środek pętli na mapie.
                </p>
              )}
              <button
                onClick={onGenerateLoop}
                disabled={pointsCount === 0 || !targetDistance || isGenerating}
                className="w-full py-3 mt-1 text-xs font-bold uppercase tracking-widest border-none cursor-pointer transition-opacity disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
              >
                {isGenerating ? <><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-2" /> WYZNACZAM...</> : 'WYZNACZ PĘTLĘ (SMART)'}
              </button>
            </div>
          </>
        )}

        {/* ── TRASY ───────────────────────────────────────────── */}
        {activeTab === 'routes' && (
          <>
            <div>
              <h2 className="text-xl font-black tracking-tight text-primary font-display">Twoje Trasy</h2>
              <p className="text-xs mt-0.5 text-secondary">Zapisana biblioteka tras</p>
            </div>
            <SavedRoutesPanel userId={user?.user_id ?? null} onLoadRoute={onLoadSavedRoute} />
          </>
        )}

        {/* ── STRAVA ──────────────────────────────────────────── */}
        {activeTab === 'strava' && (
          <>
            <div>
              <h2 className="text-xl font-black tracking-tight text-primary font-display">Treningi Strava</h2>
              <p className="text-xs mt-0.5 text-secondary">Ostatnie aktywności z konta</p>
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
              <h2 className="text-xl font-black tracking-tight text-primary font-display">Planer & Cele</h2>
              <p className="text-xs mt-0.5 text-secondary">Zarządzaj startami i planem treningowym</p>
            </div>
            <PanelErrorBoundary label="Planer">
              <PlannerPanel onRequestAnalysis={handleRequestAnalysis} />
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
