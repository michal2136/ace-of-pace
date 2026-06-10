import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Route as RouteIcon, Activity, Pencil, Trash2, Check, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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
  const { user } = useAuth();
  const [routes, setRoutes]     = useState<SavedRoute[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Per-karta: która jest w trybie edycji i jaka jest tymczasowa nazwa
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [editName,  setEditName]    = useState('');
  const [savingId,  setSavingId]    = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
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

  // Fokus na input gdy wchodzi tryb edycji
  useEffect(() => {
    if (editingId !== null) setTimeout(() => inputRef.current?.focus(), 60);
  }, [editingId]);

  const startEdit = (e: React.MouseEvent, rt: SavedRoute) => {
    e.stopPropagation();
    setEditingId(rt.id);
    setEditName(rt.name);
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
      /* zostaje stara nazwa — możemy pokazać flash błędu */
    } finally {
      setSavingId(null);
      setEditingId(null);
      setEditName('');
    }
  };

  const handleDelete = async (e: React.MouseEvent, rt: SavedRoute) => {
    e.stopPropagation();
    if (!window.confirm(`Usunąć trasę "${rt.name}"?`)) return;
    setDeletingId(rt.id);
    try {
      await fetch(`http://localhost:8000/api/routes/saved/${rt.id}?user_id=${userId}`, {
        method: 'DELETE',
      });
      setRoutes(prev => prev.filter(r => r.id !== rt.id));
    } catch {
      /* ignore */
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
        <h3
          className="text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <RouteIcon className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
          Twoja Biblioteka
        </h3>
        <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {routes.length} {routes.length === 1 ? 'trasa' : 'tras'}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-success)' }} />
        </div>
      ) : error ? (
        <div
          className="p-4 rounded-xl text-sm"
          style={{ background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
        >
          {error}
        </div>
      ) : routes.length === 0 ? (
        <div
          className="p-8 text-center text-sm rounded-xl border-dashed"
          style={{ background: 'var(--color-surface-overlay)', border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)' }}
        >
          Brak zapisanych tras. Wygeneruj pętlę lub zapisz aktywność ze Stravy!
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar">
          {routes.map((rt) => {
            const isEditing  = editingId  === rt.id;
            const isSaving   = savingId   === rt.id;
            const isDeleting = deletingId === rt.id;

            return (
              <div
                key={rt.id}
                className="group rounded-xl transition-all duration-200"
                style={{
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border)',
                  opacity: isDeleting ? 0.5 : 1,
                }}
              >
                {/* ── Klikalna część — ładuje trasę na mapę ── */}
                <button
                  className="w-full text-left px-4 pt-3 pb-2"
                  onClick={() => !isEditing && onLoadRoute(rt.geojson_feature)}
                  disabled={isEditing}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <h4
                        className="font-bold text-[15px] truncate"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {rt.name}
                      </h4>
                      <div
                        className="flex gap-3 text-[11px] font-medium mt-1"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <span className="flex items-center gap-1">
                          <RouteIcon className="w-3 h-3" style={{ color: 'var(--color-success)' }} />
                          {(rt.distance_m / 1000).toFixed(2)} km
                        </span>
                        <span className="flex items-center gap-1">
                          <Activity className="w-3 h-3" style={{ color: 'var(--color-accent)' }} />
                          GeoJSON
                        </span>
                      </div>
                    </div>

                    {/* Akcje — widoczne na hover */}
                    <div
                      className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                      onClick={e => e.stopPropagation()}
                    >
                      {/* Edytuj nazwę */}
                      <button
                        onClick={(e) => startEdit(e, rt)}
                        title="Zmień nazwę"
                        className="p-1.5 rounded-lg transition-colors"
                        style={{
                          background: 'var(--color-surface-overlay)',
                          color: 'var(--color-accent)',
                          border: '1px solid rgba(99,102,241,0.2)',
                        }}
                        onMouseOver={e => (e.currentTarget.style.background = 'var(--color-accent-subtle)')}
                        onMouseOut={e  => (e.currentTarget.style.background = 'var(--color-surface-overlay)')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      {/* Usuń */}
                      <button
                        onClick={(e) => handleDelete(e, rt)}
                        disabled={isDeleting}
                        title="Usuń trasę"
                        className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                        style={{
                          background: 'var(--color-surface-overlay)',
                          color: '#f87171',
                          border: '1px solid rgba(248,113,113,0.2)',
                        }}
                        onMouseOver={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.1)')}
                        onMouseOut={e  => (e.currentTarget.style.background = 'var(--color-surface-overlay)')}
                      >
                        {isDeleting
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2  className="w-3.5 h-3.5" />
                        }
                      </button>
                    </div>
                  </div>
                </button>

                {/* ── Inline rename form ── */}
                {isEditing && (
                  <div
                    className="px-4 pb-3 flex flex-col gap-2"
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
                      onClick={e => e.stopPropagation()}
                      className="input-base text-sm"
                      placeholder="Nowa nazwa trasy"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => confirmRename(e, rt)}
                        disabled={isSaving}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold text-white"
                        style={{ background: 'linear-gradient(135deg,#6366f1,#818cf8)' }}
                      >
                        {isSaving
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Check   className="w-3.5 h-3.5" />
                        }
                        {isSaving ? 'Zapisuję…' : 'Zatwierdź'}
                      </button>
                      <button
                        onClick={(e) => cancelEdit(e)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1"
                        style={{
                          background: 'var(--color-surface-overlay)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        <X className="w-3.5 h-3.5" /> Anuluj
                      </button>
                    </div>
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
