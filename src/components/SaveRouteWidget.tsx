/**
 * SaveRouteWidget — wielokrotny komponent do zapisu trasy do biblioteki.
 *
 * Przepływ: idle → naming → saving → ok | error
 * - W stanie 'naming' pokazuje input z nazwą + Zapisz/Anuluj
 * - Zatrzymuje propagację kliknięć/klawiszy aby nie trafiały do mapy
 * - Opcjonalny `defaultName` — pojawia się w inpucie jako wartość wstępna
 */

import React, { useState, useRef, useEffect } from 'react';
import { BookmarkPlus, Check, X, Loader2 } from 'lucide-react';

type SaveState = 'idle' | 'naming' | 'saving' | 'ok' | 'error';

interface SaveRouteWidgetProps {
  /** Wywołanie zapisu. Zwraca true = sukces, false/undefined = błąd. */
  onSave: (name: string) => Promise<boolean | undefined>;
  /** Proponowana nazwa (np. "Evening Run – 9.77 km"). Edytowalna przez użytkownika. */
  defaultName?: string;
  /** Rozmiar tekstu przycisku głównego: 'sm' | 'xs'. Domyślnie 'sm'. */
  size?: 'sm' | 'xs';
  /** Dodatkowe klasy CSS na głównym wrapperies. */
  className?: string;
}

export const SaveRouteWidget: React.FC<SaveRouteWidgetProps> = ({
  onSave,
  defaultName = '',
  size = 'sm',
  className = '',
}) => {
  const [state, setState] = useState<SaveState>('idle');
  const [name, setName]   = useState(defaultName);
  const inputRef          = useRef<HTMLInputElement>(null);

  // Fokus na input zaraz po przejściu do 'naming'
  useEffect(() => {
    if (state === 'naming') {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [state]);

  // Resetuj nazwę gdy defaultName się zmieni (np. nowa aktywność)
  useEffect(() => {
    if (state === 'idle') setName(defaultName);
  }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSave = () => {
    if (state === 'saving') return;
    setState('saving');
    onSave(name.trim() || defaultName).then(ok => {
      setState(ok ? 'ok' : 'error');
      setTimeout(() => setState('idle'), 3200);
    });
  };

  const stopProp = (e: React.SyntheticEvent) => e.stopPropagation();

  const txtSm = size === 'sm' ? 'text-sm' : 'text-[11px]';
  const icoSz = size === 'sm' ? 'w-4 h-4' : 'w-3 h-3';

  /* ── Formularz nazwy ─────────────────────────────────────── */
  if (state === 'naming') {
    return (
      <div
        className={`flex flex-col gap-2 p-3 rounded-xl ${className}`}
        style={{ background: 'var(--color-surface-overlay)', border: '1px solid var(--color-border)' }}
        onClick={stopProp}
      >
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
          Nazwa trasy:
        </p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();           // ← kluczowe: mapa nie dostaje klawiszy
            if (e.key === 'Enter')  { e.preventDefault(); doSave(); }
            if (e.key === 'Escape') { setState('idle'); setName(defaultName); }
          }}
          onClick={stopProp}
          placeholder="np. Pętla przez park"
          className="input-base text-sm"
          style={{ width: '100%' }}
        />
        <div className="flex gap-2">
          <button
            onClick={(e) => { stopProp(e); doSave(); }}
            className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#6366f1,#818cf8)' }}
          >
            <Check className="w-3.5 h-3.5" /> Zapisz
          </button>
          <button
            onClick={(e) => { stopProp(e); setState('idle'); setName(defaultName); }}
            className="px-3 py-2 rounded-lg text-xs font-bold flex items-center"
            style={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  /* ── Przycisk główny (idle / saving / ok / error) ────────── */
  const bg    = state === 'ok'    ? 'rgba(52,211,153,0.11)'
              : state === 'error' ? 'rgba(248,113,113,0.09)'
              : state === 'saving'? 'var(--color-accent-subtle)'
              : 'var(--color-accent-subtle)';
  const bdr   = state === 'ok'    ? '1px solid rgba(52,211,153,0.32)'
              : state === 'error' ? '1px solid rgba(248,113,113,0.28)'
              : '1px solid rgba(99,102,241,0.22)';
  const clr   = state === 'ok'    ? '#34d399'
              : state === 'error' ? '#f87171'
              : 'var(--color-accent)';
  const label = state === 'saving' ? 'Zapisywanie…'
              : state === 'ok'     ? 'Zapisano w bibliotece!'
              : state === 'error'  ? 'Błąd — spróbuj ponownie'
              : 'Zapisz trasę do biblioteki';

  return (
    <button
      onClick={(e) => { stopProp(e); if (state === 'idle') setState('naming'); }}
      disabled={state === 'saving'}
      className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2 ${txtSm} font-semibold
                  transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 ${className}`}
      style={{ background: bg, border: bdr, color: clr }}
    >
      {state === 'saving' && <Loader2  className={`${icoSz} animate-spin`} />}
      {state === 'ok'     && <Check    className={icoSz} />}
      {state === 'error'  && <X        className={icoSz} />}
      {(state === 'idle') && <BookmarkPlus className={icoSz} />}
      {label}
    </button>
  );
};
