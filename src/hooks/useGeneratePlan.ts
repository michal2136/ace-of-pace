/**
 * useGeneratePlan — custom hook v2
 *
 * Enkapsuluje wywołanie POST /api/calendar/generate-plan.
 * Po otrzymaniu 200 OK natychmiast wywołuje `onSuccess` (refetch kalendarza).
 *
 * Dodaje `phase` — symulowany etap przetwarzania dla lepszego UX.
 * (Gemini nie ma streamingu, więc fazy są time-based)
 */

import { useState, useCallback, useRef } from 'react';

const API = 'http://localhost:8000';

export interface GeneratePlanPayload {
  user_id:           number;
  goal_id?:          number | null;
  weeks?:            number;
  extra_notes?:      string | null;
  pb_5k_mmss?:       string | null;   // '24:30' — VDOT Danielsa
  target_time_mmss?: string | null;   // 'MM:SS' — cel wynikowy
}

export interface GeneratePlanResult {
  plans_created: number;
  message:       string;
}

export type GeneratePlanStatus = 'idle' | 'loading' | 'success' | 'error';

/** Etap widoczny w overlayerze — symulowany bo Gemini nie ma SSE/streaming */
export type GeneratePlanPhase =
  | 'analyzing'   // ~0-4s   — Strava RAG + VDOT
  | 'computing'   // ~4-12s  — Gemini Structured Output
  | 'saving'      // ~12s+   — zapis do DB (faktycznie 200 OK)
  | null;

export interface UseGeneratePlanReturn {
  status:  GeneratePlanStatus;
  phase:   GeneratePlanPhase;
  result:  GeneratePlanResult | null;
  error:   string | null;
  elapsed: number;            // sekundy od startu, do wyświetlenia w overlay
  generate: (payload: GeneratePlanPayload) => Promise<void>;
  reset:    () => void;
}

/**
 * @param onSuccess - Callback wywoływany po 200 OK — zazwyczaj refetch kalendarza.
 */
export function useGeneratePlan(onSuccess?: () => void | Promise<void>): UseGeneratePlanReturn {
  const [status,  setStatus]  = useState<GeneratePlanStatus>('idle');
  const [phase,   setPhase]   = useState<GeneratePlanPhase>(null);
  const [result,  setResult]  = useState<GeneratePlanResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stopTimers = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    phaseTimers.current.forEach(clearTimeout);
    phaseTimers.current = [];
  };

  const generate = useCallback(async (payload: GeneratePlanPayload) => {
    setStatus('loading');
    setPhase('analyzing');
    setResult(null);
    setError(null);
    setElapsed(0);
    stopTimers();

    // ── Elapsed counter (co 1s) ──────────────────────────────────────────
    const start = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    // ── Symulowane przejścia faz ─────────────────────────────────────────
    // analyzing → computing po 4s, computing → saving po 12s
    phaseTimers.current.push(
      setTimeout(() => setPhase('computing'), 4000),
      setTimeout(() => setPhase('saving'),   12000),
    );

    try {
      const res = await fetch(`${API}/api/calendar/generate-plan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = (await res.json())?.detail ?? detail; } catch { /* ignore */ }
        throw new Error(detail);
      }

      const data: GeneratePlanResult = await res.json();
      stopTimers();
      setPhase('saving');          // pokaż "saving" przez chwilę przed success
      await new Promise(r => setTimeout(r, 600));

      setResult(data);
      setStatus('success');
      setPhase(null);

      // ← natychmiastowy refetch kalendarza — nowe treningi bez F5
      if (onSuccess) await onSuccess();

    } catch (err: unknown) {
      stopTimers();
      setError(err instanceof Error ? err.message : 'Nieznany błąd');
      setStatus('error');
      setPhase(null);
    }
  }, [onSuccess]);

  const reset = useCallback(() => {
    stopTimers();
    setStatus('idle');
    setPhase(null);
    setResult(null);
    setError(null);
    setElapsed(0);
  }, []);

  return { status, phase, result, error, elapsed, generate, reset };
}
