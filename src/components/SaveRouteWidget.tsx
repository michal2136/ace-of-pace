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
  /** Czy przycisk ma być małą kwadratową ikonką */
  iconOnly?: boolean;
}

export const SaveRouteWidget: React.FC<SaveRouteWidgetProps> = ({
  onSave,
  defaultName = '',
  size = 'sm',
  className = '',
  iconOnly = false,
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
        className={`flex flex-col gap-2 p-3 rounded-xl border border-border bg-card shadow-sm ${className}`}
        onClick={stopProp}
      >
        <p className="text-xs font-semibold text-muted-foreground">
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
          className="w-full px-3 py-1.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex gap-2">
          <button
            onClick={(e) => { stopProp(e); doSave(); }}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/95 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" /> Zapisz
          </button>
          <button
            onClick={(e) => { stopProp(e); setState('idle'); setName(defaultName); }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  /* ── Przycisk główny (idle / saving / ok / error) ────────── */
  const buttonClass = state === 'ok' ? 'border-success/30 bg-success/15 text-success cursor-default'
                    : state === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive cursor-pointer'
                    : state === 'saving' ? 'border-border bg-muted text-muted-foreground cursor-not-allowed opacity-60'
                    : 'border-border bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer';

  const label = state === 'saving' ? 'Zapisywanie…'
              : state === 'ok'     ? 'Zapisano w bibliotece!'
              : state === 'error'  ? 'Błąd — spróbuj ponownie'
              : 'Zapisz trasę do biblioteki';

  const layoutClass = iconOnly
    ? `${size === 'xs' ? 'w-8 h-8' : 'w-9 h-9'} p-0 flex items-center justify-center shrink-0 rounded-lg`
    : `w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2 ${txtSm}`;

  return (
    <button
      onClick={(e) => { stopProp(e); if (state === 'idle') setState('naming'); }}
      disabled={state === 'saving'}
      className={`${layoutClass} border font-semibold
                  transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 ${buttonClass} ${className}`}
      title={iconOnly ? label : undefined}
    >
      {state === 'saving' && <Loader2  className={`${icoSz} animate-spin`} />}
      {state === 'ok'     && <Check    className={icoSz} />}
      {state === 'error'  && <X        className={icoSz} />}
      {(state === 'idle') && <BookmarkPlus className={icoSz} />}
      {!iconOnly && label}
    </button>
  );
};
