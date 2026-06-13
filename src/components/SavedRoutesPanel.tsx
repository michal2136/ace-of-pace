import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Route as RouteIcon, Pencil, Trash2, Check, X, MapPin, ChevronDown, AlertTriangle } from 'lucide-react';

interface SavedRoute {
  id: number;
  name: string;
  distance_m: number;
  geojson_feature: any;
}

interface SavedRoutesPanelProps {
  userId: number | null;
  onLoadRoute: (geojson: any) => void;
}

export const SavedRoutesPanel: React.FC<SavedRoutesPanelProps> = ({ userId, onLoadRoute }) => {
  const [routes, setRoutes]       = useState<SavedRoute[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Accordion
  const [expandedId,      setExpandedId]      = useState<number | null>(null);

  // Per-card states
  const [editingId,       setEditingId]       = useState<number | null>(null);
  const [editName,        setEditName]        = useState('');
  const [savingId,        setSavingId]        = useState<number | null>(null);
  const [deletingId,      setDeletingId]      = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleteError,     setDeleteError]     = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchRoutes = async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:8000/api/routes/saved/${userId}`);
      if (!res.ok) throw new Error('Błąd podczas pobierania tras.');
      setRoutes(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchRoutes(); }, [userId]); // eslint-disable-line

  useEffect(() => {
    if (editingId !== null) setTimeout(() => inputRef.current?.focus(), 60);
  }, [editingId]);

  const handleCardClick = (rt: SavedRoute) => {
    if (editingId === rt.id || confirmDeleteId === rt.id) return;
    if (expandedId === rt.id) {
      setExpandedId(null);
    } else {
      setExpandedId(rt.id);
      onLoadRoute(rt.geojson_feature);
    }
  };

  const startEdit = (e: React.MouseEvent, rt: SavedRoute) => {
    e.stopPropagation();
    setEditingId(rt.id);
    setEditName(rt.name);
    setConfirmDeleteId(null);
    setDeleteError(null);
  };

  const cancelEdit = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setEditingId(null);
    setEditName('');
  };

  const confirmRename = async (e: React.SyntheticEvent, rt: SavedRoute) => {
    e.stopPropagation();
    const trimmed = editName.trim();
    if (!trimmed || trimmed === rt.name) { cancelEdit(); return; }
    setSavingId(rt.id);
    try {
      const res = await fetch(`http://localhost:8000/api/routes/saved/${rt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, user_id: userId }),
      });
      if (!res.ok) throw new Error();
      setRoutes(prev => prev.map(r => r.id === rt.id ? { ...r, name: trimmed } : r));
    } catch {
      /* stays with old name */
    } finally {
      setSavingId(null);
      setEditingId(null);
      setEditName('');
    }
  };

  // Inline delete — no window.confirm, properly checks response
  const executeDelete = async (rt: SavedRoute) => {
    setDeletingId(rt.id);
    setDeleteError(null);
    try {
      const res = await fetch(`http://localhost:8000/api/routes/saved/${rt.id}?user_id=${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Błąd ${res.status}`);
      }
      setRoutes(prev => prev.filter(r => r.id !== rt.id));
      if (expandedId === rt.id) setExpandedId(null);
      setConfirmDeleteId(null);
    } catch (err: any) {
      setDeleteError(err.message || 'Nie udało się usunąć trasy.');
    } finally {
      setDeletingId(null);
    }
  };

  if (!userId) return (
    <div
      className="p-6 text-center text-sm rounded-xl"
      style={{
        background: 'var(--color-surface-overlay)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
      }}
    >
      Zaloguj się, aby widzieć zapisane trasy.
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center px-1">
        <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <RouteIcon className="w-4 h-4 text-primary" />
          Twoja Biblioteka
        </h3>
        <span className="text-[10px] font-medium text-muted-foreground">
          {routes.length} {routes.length === 1 ? 'trasa' : 'tras'}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl text-sm border border-destructive/20 bg-destructive/10 text-destructive">
          {error}
        </div>
      ) : routes.length === 0 ? (
        <div className="p-8 text-center text-sm rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground">
          Brak zapisanych tras. Wygeneruj pętlę lub zapisz aktywność ze Stravy!
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar">
          {routes.map((rt) => {
            const isExpanded      = expandedId      === rt.id;
            const isEditing       = editingId       === rt.id;
            const isSaving        = savingId        === rt.id;
            const isDeleting      = deletingId      === rt.id;
            const isConfirmDelete = confirmDeleteId === rt.id;
            const formattedDist   = (rt.distance_m / 1000).toFixed(2);

            return (
              <div
                key={rt.id}
                className={`rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden transition-all duration-200 ${
                  isExpanded
                    ? 'border-primary/40 ring-1 ring-primary/10'
                    : 'border-border/30 hover:border-border'
                }`}
                style={{ opacity: isDeleting ? 0.5 : 1 }}
              >
                {/* ── Collapsed header row (always visible) ─────────── */}
                <button
                  onClick={() => handleCardClick(rt)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left focus:outline-none cursor-pointer"
                >
                  <RouteIcon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isExpanded ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  />
                  <p className="flex-1 min-w-0 text-xs font-semibold text-foreground truncate leading-tight">
                    {rt.name}
                  </p>
                  <div className="flex items-baseline gap-0.5 shrink-0">
                    <span className="text-xl font-extrabold text-primary leading-none tabular-nums">
                      {formattedDist}
                    </span>
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest leading-none ml-0.5">
                      km
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                      isExpanded ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>

                {/* ── Expanded section ──────────────────────────────── */}
                {isExpanded && (
                  <div className="border-t border-border/30 bg-muted/20">

                    {/* Delete error banner */}
                    {deleteError && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive/10 text-destructive text-[10px] font-medium border-b border-destructive/20">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {deleteError}
                      </div>
                    )}

                    {/* ── INLINE DELETE CONFIRM ── */}
                    {isConfirmDelete ? (
                      <div
                        className="flex items-center gap-2 px-3 py-2.5"
                        onClick={e => e.stopPropagation()}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                        <span className="text-[10px] font-semibold text-foreground flex-1 min-w-0 truncate">
                          Usunąć "{rt.name}"?
                        </span>
                        <button
                          onClick={() => executeDelete(rt)}
                          disabled={isDeleting}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-destructive text-white hover:bg-red-600 transition-colors cursor-pointer shrink-0 border-none flex items-center gap-1 disabled:opacity-60"
                        >
                          {isDeleting
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Trash2 className="w-3 h-3" />
                          }
                          Usuń
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); setDeleteError(null); }}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer shrink-0"
                        >
                          Anuluj
                        </button>
                      </div>

                    ) : isEditing ? (
                      /* ── RENAME FORM (no layout shift) ── */
                      <div
                        className="flex items-center gap-2 px-3 py-2 overflow-hidden"
                        onClick={e => e.stopPropagation()}
                      >
                        <input
                          ref={inputRef}
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Enter')  confirmRename(e, rt);
                            if (e.key === 'Escape') cancelEdit(e);
                          }}
                          className="flex-1 min-w-0 max-w-[200px] px-2.5 py-1.5 rounded-lg border border-input bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          placeholder="Nowa nazwa"
                        />
                        <button
                          onClick={(e) => confirmRename(e, rt)}
                          disabled={isSaving}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer shrink-0 border-none"
                        >
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={(e) => cancelEdit(e)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>

                    ) : (
                      /* ── ACTION BUTTONS ROW ── */
                      <div
                        className="flex items-center gap-1.5 px-3 py-2"
                        onClick={e => e.stopPropagation()}
                      >
                        <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mr-auto">
                          BIBLIOTEKA
                        </span>
                        {/* Pokaż na mapie */}
                        <button
                          onClick={() => onLoadRoute(rt.geojson_feature)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer shrink-0"
                          title="Pokaż na mapie"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                        {/* Edytuj nazwę */}
                        <button
                          onClick={(e) => startEdit(e, rt)}
                          title="Zmień nazwę"
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer shrink-0"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {/* Usuń — triggers inline confirm */}
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDeleteId(rt.id); setDeleteError(null); }}
                          title="Usuń trasę"
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
