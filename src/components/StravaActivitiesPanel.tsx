import React, { useState, useEffect } from 'react';
import { Loader2, Activity, MapPin, Zap, Sparkles, ChevronDown } from 'lucide-react';
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
  const [isLoading, setIsLoading]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Accordion: which card is expanded
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  const handleCardClick = (act: StravaActivity) => {
    if (expandedId === act.id) {
      setExpandedId(null);
    } else {
      setExpandedId(act.id);
      if (act.slad_gps_geojson) onLoadRoute(act.slad_gps_geojson);
    }
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
      {/* Header */}
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
          const hasGps     = !!act.slad_gps_geojson;
          const isExpanded = expandedId === act.id;

          return (
            <div
              key={act.id}
              className={`rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden transition-all duration-200 ${
                isExpanded
                  ? 'border-primary/40 ring-1 ring-primary/10'
                  : 'border-border/30 hover:border-border'
              }`}
              style={{ opacity: !hasGps ? 0.65 : 1 }}
            >
              {/* ── Collapsed header row ─────────────────────────────── */}
              <button
                onClick={() => handleCardClick(act)}
                disabled={!hasGps && expandedId !== act.id}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left focus:outline-none ${
                  hasGps ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                {/* Activity icon */}
                <Activity
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    isExpanded ? 'text-primary' : 'text-muted-foreground'
                  }`}
                />

                {/* Left: Name + date + optional badge */}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <p className="text-xs font-semibold text-foreground truncate leading-tight">
                    {act.nazwa_treningu}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-none">
                    {act.data}
                  </p>
                  {!hasGps && (
                    <span className="inline-flex items-center w-max bg-muted text-muted-foreground border border-border/50 rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider mt-0.5">
                      BEZ GPS
                    </span>
                  )}
                </div>

                {/* Neon distance */}
                <div className="flex items-baseline gap-0.5 shrink-0">
                  <span className="text-xl font-extrabold text-primary leading-none tabular-nums">
                    {act.dystans_km}
                  </span>
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest leading-none ml-0.5">
                    km
                  </span>
                </div>

                {/* Chevron (only if has GPS) */}
                {hasGps && (
                  <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                      isExpanded ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                )}
              </button>

              {/* ── Expanded section: action buttons ─────────────────── */}
              {isExpanded && (
                <div className="border-t border-border/30 bg-muted/20">
                  <div
                    className="flex items-center gap-1.5 px-3 py-2"
                    onClick={e => e.stopPropagation()}
                  >
                    <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mr-auto">
                      STRAVA
                    </span>

                    {/* Pokaż na mapie */}
                    {hasGps && (
                      <button
                        onClick={() => onLoadRoute(act.slad_gps_geojson)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer shrink-0"
                        title="Pokaż na mapie"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Analiza Kasi */}
                    <button
                      onClick={(e) => handleAnalyze(e, act)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer shrink-0"
                      title="Analiza Kasi"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                    </button>

                    {/* Zapisz trasę */}
                    {hasGps && (
                      <SaveRouteWidget
                        iconOnly
                        size="xs"
                        onSave={buildSaveHandler(act)}
                        defaultName={`${act.nazwa_treningu} – ${act.dystans_km} km`}
                        className="border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
