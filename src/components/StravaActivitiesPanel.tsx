import React, { useState, useEffect } from 'react';
import { Loader2, Activity, MapPin, Calendar, Route as RouteIcon, Zap, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SaveRouteWidget } from './SaveRouteWidget';

interface StravaActivity {
  id: number;
  nazwa_treningu: string;
  dystans_km: number;
  data: string;
  slad_gps_geojson: any | null;
}

interface StravaActivitiesPanelProps {
  onLoadRoute: (geojson: any) => void;
  onRequestAnalysis?: (activityId: number, activityName: string) => void;
}

export const StravaActivitiesPanel: React.FC<StravaActivitiesPanelProps> = ({ onLoadRoute, onRequestAnalysis }) => {
  const { user, isLoggedIn } = useAuth();
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoggedIn || !user?.strava_linked) return;
    const fetchActivities = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`http://localhost:8000/api/user/activities?user_id=${user.user_id}&limit=20`);
        if (!res.ok) throw new Error(`Błąd ${res.status}: ${(await res.json()).detail}`);
        setActivities(await res.json());
      } catch (err: any) {
        setError(err.message ?? 'Nieznany błąd');
      } finally {
        setIsLoading(false);
      }
    };
    fetchActivities();
  }, [isLoggedIn, user]);

  if (!isLoggedIn) return (
    <div
      className="p-6 text-center text-sm rounded-xl"
      style={{ background: 'var(--color-surface-overlay)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
    >
      Zaloguj się, aby zobaczyć treningi ze Stravy.
    </div>
  );

  if (!user?.strava_linked) return (
    <div
      className="p-6 text-center rounded-xl flex flex-col gap-3 items-center"
      style={{ background: 'var(--color-strava-subtle)', border: '1px solid rgba(252,76,2,0.2)' }}
    >
      <Activity className="w-8 h-8" style={{ color: 'var(--color-strava)', opacity: 0.6 }} />
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Połącz konto ze Stravą w sekcji profilu (menu w prawym górnym rogu), aby pobrać treningi.
      </p>
    </div>
  );

  if (isLoading) return (
    <div className="flex flex-col items-center gap-3 p-8" style={{ color: 'var(--color-text-muted)' }}>
      <Loader2 className="w-7 h-7 animate-spin" style={{ color: 'var(--color-strava)' }} />
      <span className="text-sm">Pobieranie treningów ze Stravy…</span>
    </div>
  );

  if (error) return (
    <div
      className="p-4 rounded-xl text-sm"
      style={{ background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
    >
      {error}
    </div>
  );

  if (activities.length === 0) return (
    <div
      className="p-8 text-center text-sm rounded-xl border-dashed"
      style={{ background: 'var(--color-surface-overlay)', border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)' }}
    >
      Brak aktywności na koncie Strava.
    </div>
  );

  const handleClick = (act: StravaActivity) => {
    if (!act.slad_gps_geojson) return;
    setActiveId(act.id);
    onLoadRoute(act.slad_gps_geojson);
  };

  const handleAnalyze = (e: React.MouseEvent, act: StravaActivity) => {
    e.stopPropagation();
    onRequestAnalysis?.(act.id, act.nazwa_treningu);
  };

  const buildSaveHandler = (act: StravaActivity) => async (name: string) => {
    if (!user) return false;
    try {
      const res = await fetch('http://localhost:8000/api/routes/save-from-strava', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strava_activity_id: act.id,
          user_id: user.user_id,
          name: name || act.nazwa_treningu,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-2 px-1 pb-2"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <Zap className="w-4 h-4" style={{ color: 'var(--color-strava)' }} />
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
          Ostatnie treningi
        </span>
        <span className="ml-auto text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {activities.length} aktywności
        </span>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar">
        {activities.map((act) => {
          const hasGps = !!act.slad_gps_geojson;
          const isActive = activeId === act.id;

          return (
            <div
              key={act.id}
              className="group rounded-xl transition-all duration-200"
              style={{
                border: isActive
                  ? '1px solid rgba(252,76,2,0.5)'
                  : hasGps
                  ? '1px solid var(--color-border)'
                  : '1px solid var(--color-border)',
                background: isActive
                  ? 'var(--color-strava-subtle)'
                  : 'var(--color-surface-elevated)',
                opacity: !hasGps ? 0.6 : 1,
              }}
            >
              <button
                onClick={() => handleClick(act)}
                disabled={!hasGps}
                className="w-full text-left p-3.5 disabled:cursor-not-allowed"
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="mt-0.5 p-1.5 rounded-lg shrink-0 transition-colors"
                    style={{
                      background: isActive ? 'rgba(252,76,2,0.2)' : 'var(--color-surface-overlay)',
                    }}
                  >
                    <Activity
                      className="w-3.5 h-3.5 transition-colors"
                      style={{ color: isActive ? 'var(--color-strava)' : 'var(--color-text-muted)' }}
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {act.nazwa_treningu}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      <span className="flex items-center gap-1">
                        <RouteIcon className="w-3 h-3" style={{ color: 'var(--color-success)' }} />
                        <span className="font-bold" style={{ color: 'var(--color-success)' }}>{act.dystans_km} km</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {act.data}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 mt-0.5">
                    {hasGps
                      ? <MapPin className="w-3.5 h-3.5 transition-colors" style={{ color: isActive ? 'var(--color-strava)' : 'var(--color-text-muted)' }} />
                      : <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>bez GPS</span>
                    }
                  </div>
                </div>
                {isActive && (
                  <p className="mt-2 text-[10px] font-medium" style={{ color: 'var(--color-strava)' }}>
                    ✓ Trasa wyświetlona na mapie
                  </p>
                )}
              </button>

              <div className="px-3.5 pb-3 flex flex-col gap-1.5">
                {/* Zapytaj Kasię */}
                <button
                  onClick={(e) => handleAnalyze(e, act)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold
                             opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all duration-200"
                  style={{
                    background: 'var(--color-accent-subtle)',
                    border: '1px solid rgba(99,102,241,0.2)',
                    color: 'var(--color-accent)',
                  }}
                >
                  <Sparkles className="w-3 h-3" />
                  Zapytaj Kasię o analizę
                </button>

                {/* Zapisz trasę — tylko gdy jest GPS */}
                {hasGps && (
                  <SaveRouteWidget
                    size="xs"
                    onSave={buildSaveHandler(act)}
                    defaultName={`${act.nazwa_treningu} – ${act.dystans_km} km`}
                    className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
