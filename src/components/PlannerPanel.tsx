import React, { useState, useEffect, useCallback, useRef } from 'react';
import Calendar from 'react-calendar';
import { Loader2, Target, Plus, Trash2, Sparkles, CheckCircle, Clock, Zap, BrainCircuit, X, AlertCircle, Settings2, ChevronDown, Activity, Flame, Wind, Timer, MapPin, Heart, Route } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGeneratePlan } from '../hooks/useGeneratePlan';

const API = 'http://localhost:8000';

// ── Types ───────────────────────────────────────────────────────────────────
interface Goal {
  id: number;
  title: string;
  race_date: string;
  target_time: string | null;
  distance_km: number | null;
  notes: string | null;
  days_left: number;
}

/** Unified event as returned by GET /api/calendar/full-view */
interface CalendarEvent {
  id: string;              // 'strava-<id>' | 'plan-<id>'
  date: string;            // YYYY-MM-DD
  label: string;
  is_completed: boolean;   // true = Strava, false = Kasia
  source: 'strava' | 'kasia';
  type: string | null;
  distance_km: number | null;
  description: string | null;
  goal_id: number | null;
  target_pace:     string | null;
  heart_rate_zone: string | null;
  // v3 structured phases
  is_rest_day:                  boolean | null;
  trainer_notes:                string | null;
  // Rozgrzewka
  warmup_distance_km:           number | null;
  warmup_exact_pace:            string | null;
  warmup_heart_rate_target:     string | null;
  warmup_beginner_explanation:  string | null;
  warmup_description:           string | null;
  // Bieg główny
  main_distance_km:             number | null;
  main_exact_pace:              string | null;
  main_heart_rate_target:       string | null;
  main_beginner_explanation:    string | null;
  main_target_pace:             string | null;
  main_description:             string | null;
  // Wyciszenie
  cooldown_distance_km:          number | null;
  cooldown_exact_pace:           string | null;
  cooldown_heart_rate_target:    string | null;
  cooldown_beginner_explanation: string | null;
  cooldown_description:          string | null;
}

interface FullCalendarResponse {
  events: CalendarEvent[];
  total: number;
  date_from: string;
  date_to: string;
  strava_count: number;
  plan_count: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
// Guard: returns empty string if `d` is not a valid Date (e.g. null from react-calendar)
const toDateStr = (d: Date | null | undefined): string => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const TYPE_COLORS: Record<string, { color: string; bg: string }> = {
  'Easy Run':  { color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  'Long Run':  { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  'Interwały': { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  'Tempo Run': { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  'Rest':      { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
  'Recovery':  { color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
};

const getTypeStyle = (type: string) => {
  const key = Object.keys(TYPE_COLORS).find(k => type.toLowerCase().includes(k.toLowerCase()));
  return key ? TYPE_COLORS[key] : { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
};

// ── Workout Drawer ─────────────────────────────────────────────────────────
interface WorkoutDrawerProps {
  event: CalendarEvent | null;
  onClose: () => void;
  onSaveRoute?: (eventId: string, name: string) => Promise<void>;
}

/**
 * PhaseRow v2 — Runna-style tile.
 *
 * Anatomy (top → bottom):
 *  ┌─────────────────────────────────────────────────────┐
 *  │ 🔥 ROZGRZEWKA                              [badge] │  ← header
 *  ├─────────────────────────────────────────────────────┤
 *  │  1.5 km @ 6:10                                   │  ← METRIC HERO
 *  │  ❤ 115–130 bpm                                    │  ← HR line
 *  ├─────────────────────────────────────────────────────┤
 *  │ « Możesz swobodnie rozmawiać pełnymi zdaniami »   │  ← coach cue
 *  └─────────────────────────────────────────────────────┘
 */
const PhaseRow: React.FC<{
  icon:         React.ReactNode;
  label:        string;
  accentColor:  string;
  distKm?:      number | null;
  pace?:        string | null;         // exact_pace / target_pace_min_km
  hrTarget?:    string | null;         // heart_rate_target
  coachCue?:    string | null;         // audio_coach_cue / beginner_explanation
}> = ({ icon, label, accentColor, distKm, pace, hrTarget, coachCue }) => (
  <div style={{
    borderRadius: 16,
    border: `1px solid ${accentColor}22`,
    background: 'var(--color-surface-overlay, rgba(255,255,255,0.03))',
    overflow: 'hidden',
    boxShadow: `0 1px 0 ${accentColor}10`,
  }}>

    {/* ── Header strip ────────────────────────────── */}
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '7px 14px',
      background: `${accentColor}10`,
      borderBottom: `1px solid ${accentColor}18`,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{
        fontSize: 10, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        color: accentColor,
      }}>{label}</span>
    </div>

    {/* ── METRIC HERO ─────────────────────────────── */}
    <div style={{ padding: '14px 16px 0' }}>
      {/* Distance @ Pace on one line, big and bold */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        {distKm != null ? (
          <>
            <span style={{
              fontSize: 28, fontWeight: 900, lineHeight: 1,
              color: 'var(--color-text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}>{distKm}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)' }}>km</span>
          </>
        ) : null}
        {pace ? (
          <>
            <span style={{ fontSize: 15, color: accentColor, fontWeight: 600, opacity: 0.6, padding: '0 2px' }}>@</span>
            <span style={{
              fontSize: 22, fontWeight: 900, lineHeight: 1,
              color: accentColor,
              fontVariantNumeric: 'tabular-nums',
            }}>{pace}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', alignSelf: 'flex-end', paddingBottom: 2 }}>min/km</span>
          </>
        ) : null}
        {!distKm && !pace && (
          <span style={{ fontSize: 14, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>—</span>
        )}
      </div>

      {/* ❤ HR line — sits directly under the metric */}
      {hrTarget && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          marginTop: 6,
        }}>
          <Heart style={{ width: 12, height: 12, color: '#fb7185', flexShrink: 0 }} />
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: '#fb7185',
            fontVariantNumeric: 'tabular-nums',
          }}>{hrTarget}</span>
        </div>
      )}
    </div>

    {/* ── Coach Cue card ────────────────────────────── */}
    {coachCue ? (
      <div style={{
        margin: '10px 12px 12px',
        borderRadius: 10,
        background: 'rgba(148,163,184,0.07)',
        border: '1px solid rgba(148,163,184,0.14)',
        padding: '8px 12px',
        display: 'flex', gap: 8, alignItems: 'flex-start',
      }}>
        {/* mic / coach icon */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, marginTop: 2 }}>
          <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
        <p style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.55,
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
        }}>{coachCue}</p>
      </div>
    ) : (
      <div style={{ height: 12 }} />
    )}
  </div>
);

const WorkoutDrawer: React.FC<WorkoutDrawerProps> = ({ event, onClose, onSaveRoute }) => {
  const [isSaving, setIsSaving]   = useState(false);
  const [isSaved,  setIsSaved]    = useState(false);

  // reset saved state gdy event się zmienia
  useEffect(() => { setIsSaved(false); }, [event?.id]);

  const handleSaveRoute = async () => {
    if (!event || !onSaveRoute) return;
    setIsSaving(true);
    await onSaveRoute(event.id, event.label);
    setIsSaving(false);
    setIsSaved(true);
  };
  const isRest = event?.is_rest_day ||
    event?.type?.toLowerCase().includes('rest') ||
    event?.type?.toLowerCase().includes('recovery') ||
    event?.type?.toLowerCase().includes('wolne');

  const style = event?.type ? getTypeStyle(event.type) : { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
  const accentColor = event?.is_completed ? '#fc4c02' : style.color;

  // Total distance (prefer sum of phases, fall back to top-level distance_km)
  const totalDist = (() => {
    const parts = [
      event?.warmup_distance_km   ?? 0,
      event?.main_distance_km     ?? 0,
      event?.cooldown_distance_km ?? 0,
    ];
    const sum = parts.reduce((a, b) => a + b, 0);
    return sum > 0 ? Math.round(sum * 100) / 100 : (event?.distance_km ?? null);
  })();

  // Check if we have v5 structured phases (either distance_km or coach cue present)
  const hasPhases = !!(
    event?.warmup_distance_km   || event?.warmup_beginner_explanation ||
    event?.main_distance_km     || event?.main_beginner_explanation ||
    event?.cooldown_distance_km || event?.cooldown_beginner_explanation
  );

  if (!event) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 10050,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: 'modalFadeIn 0.2s ease',
        }}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Szczegóły treningu"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '100%', maxWidth: 380, zIndex: 10051,
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-24px 0 80px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          animation: 'drawerSlideIn 0.28s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: `linear-gradient(135deg, ${accentColor}18, ${accentColor}06)`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Badge + date */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
                  padding: '3px 10px', borderRadius: 99,
                  background: `${accentColor}20`, color: accentColor,
                  border: `1px solid ${accentColor}40`,
                }}>
                  {event.is_completed ? '✓ STRAVA' : (event.type ?? 'TRENING')}
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {typeof event.date === 'string' ? event.date : String(event.date)}
                </span>
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
                {event.label}
              </h2>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 10, color: 'var(--color-text-muted)', display: 'flex', flexShrink: 0 }}
              aria-label="Zamknij"
            >
              <X style={{ width: 20, height: 20 }} />
            </button>
          </div>

          {/* ── Total distance stat chip ── */}
          {totalDist && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <MapPin style={{ width: 14, height: 14, color: accentColor, flexShrink: 0 }} />
              <span style={{ fontSize: 30, fontWeight: 900, color: accentColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {totalDist}
              </span>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 700 }}>km łącznie</span>
            </div>
          )}
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>

          {isRest ? (
            /* Rest day */
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '40px 20px', gap: 12, textAlign: 'center',
              background: 'rgba(148,163,184,0.06)', borderRadius: 16,
              border: '1px dashed rgba(148,163,184,0.2)',
            }}>
              <Wind style={{ width: 36, height: 36, color: '#94a3b8' }} />
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text-secondary)' }}>Dzień regeneracji</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 240 }}>
                {event.trainer_notes || event.description || 'Odpoczynek jest częścią treningu. Pozwól mięśniom się zregenerować.'}
              </p>
            </div>
          ) : hasPhases ? (
            /* ── v4 Structured phases — beginner-friendly ── */
            <>
                          {/* ─── ROZGRZEWKA ────────────────────────────── */}
              {(event.warmup_distance_km != null || event.warmup_beginner_explanation) && (
                <PhaseRow
                  icon={<Flame style={{ width: 13, height: 13, color: '#fb923c' }} />}
                  label="Rozgrzewka"
                  accentColor="#fb923c"
                  distKm={event.warmup_distance_km}
                  pace={event.warmup_exact_pace ?? undefined}
                  hrTarget={event.warmup_heart_rate_target ?? undefined}
                  coachCue={event.warmup_beginner_explanation ?? undefined}
                />
              )}

              {/* ─── BIEG GŁÓWNY ─────────────────────────── */}
              {(event.main_distance_km != null || event.main_beginner_explanation) && (
                <PhaseRow
                  icon={<Activity style={{ width: 13, height: 13, color: accentColor }} />}
                  label="Bieg główny"
                  accentColor={accentColor}
                  distKm={event.main_distance_km}
                  pace={event.main_exact_pace ?? event.main_target_pace ?? undefined}
                  hrTarget={event.main_heart_rate_target ?? undefined}
                  coachCue={event.main_beginner_explanation ?? undefined}
                />
              )}

              {/* ─── SCHŁODZENIE ─────────────────────────── */}
              {(event.cooldown_distance_km != null || event.cooldown_beginner_explanation) && (
                <PhaseRow
                  icon={<Wind style={{ width: 13, height: 13, color: '#60a5fa' }} />}
                  label="Schłodzenie"
                  accentColor="#60a5fa"
                  distKm={event.cooldown_distance_km}
                  pace={event.cooldown_exact_pace ?? undefined}
                  hrTarget={event.cooldown_heart_rate_target ?? undefined}
                  coachCue={event.cooldown_beginner_explanation ?? undefined}
                />
              )}

              {/* Trainer notes — grey box at bottom */}
              {event.trainer_notes && (
                <div style={{
                  marginTop: 6,
                  borderRadius: 12,
                  background: 'rgba(148,163,184,0.07)',
                  border: '1px solid rgba(148,163,184,0.18)',
                  padding: '10px 14px',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <BrainCircuit style={{ width: 14, height: 14, color: '#a78bfa', flexShrink: 0, marginTop: 2 }} />
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                    {event.trainer_notes}
                  </p>
                </div>
              )}
            </>
          ) : (
            /* ── Legacy fallback: show raw description ── */
            <>
              {event.description && (
                <div style={{
                  borderRadius: 12,
                  background: `${accentColor}09`,
                  border: `1px solid ${accentColor}22`,
                  padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Activity style={{ width: 14, height: 14, color: accentColor }} />
                    <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: accentColor }}>
                      Opis treningu
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--color-text-secondary)' }}>
                    {event.description}
                  </p>
                </div>
              )}
              {/* target_pace as a compact chip if available */}
              {event.target_pace && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 12,
                  background: `${accentColor}0d`, border: `1px solid ${accentColor}25`,
                }}>
                  <Timer style={{ width: 14, height: 14, color: accentColor }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tempo</span>
                  <strong style={{ fontSize: 15, fontWeight: 900, color: accentColor, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                    {event.target_pace}
                  </strong>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer: Zapisz trasę (tylko Strava) ───────────────── */}
        {event?.is_completed && onSaveRoute && (
          <div style={{
            borderTop: '1px solid var(--color-border)',
            padding: '12px 16px',
            flexShrink: 0,
          }}>
            <button
              id="btn-save-strava-route"
              disabled={isSaving || isSaved}
              onClick={handleSaveRoute}
              style={{
                width: '100%',
                padding: '10px 16px',
                borderRadius: 12,
                border: isSaved
                  ? '1px solid rgba(52,211,153,0.3)'
                  : '1px solid rgba(99,102,241,0.3)',
                background: isSaved
                  ? 'rgba(52,211,153,0.1)'
                  : 'rgba(99,102,241,0.1)',
                color: isSaved ? '#34d399' : 'var(--color-accent)',
                fontSize: 13,
                fontWeight: 700,
                cursor: (isSaving || isSaved) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.2s',
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? (
                <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> Zapisuję…</>
              ) : isSaved ? (
                <><CheckCircle style={{ width: 14, height: 14 }} /> Trasa zapisana w bibliotece!</>
              ) : (
                <><Route style={{ width: 14, height: 14 }} /> Zapisz trasę do biblioteki</>
              )}
            </button>
          </div>
        )}

      </div>
    </>
  );
};

// ── Kasia Generate Overlay — wieloetapowy, phase-aware ──────────────────────

const PHASES = [
  {
    id:      'analyzing'  as const,
    icon:    '📊',
    label:   'Analizuję Twoje dane ze Strava…',
    sub:     'Pobieram historię 30 dni i obliczam Twoje tempa',
  },
  {
    id:      'computing'  as const,
    icon:    '🧠',
    label:   'Kasia przelicza tempa i układa pełny plan…',
    sub:     'Gemini generuje ustrukturyzowany JSON dla każdego dnia',
  },
  {
    id:      'saving'     as const,
    icon:    '💾',
    label:   'Zapisuję plan do kalendarza…',
    sub:     'Walidacja Pydantic + atomowy zapis do bazy danych',
  },
] as const;

type Phase = typeof PHASES[number]['id'];

const KasiaGenerateOverlay: React.FC<{ phase: Phase | null; elapsed: number }> = ({ phase, elapsed }) => {
  const currentIdx = PHASES.findIndex(p => p.id === phase);
  const current    = currentIdx >= 0 ? PHASES[currentIdx] : PHASES[0];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Kasia generuje plan treningowy"
      style={{
        position:        'fixed',
        inset:           0,
        zIndex:          9999,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             28,
        background:      'rgba(8, 8, 18, 0.88)',
        backdropFilter:  'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        animation:       'modalFadeIn 0.25s ease',
      }}
    >
      {/* ── Animated brain rings ── */}
      <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
        {/* outer ring */}
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: '50%',
          border: '3px solid transparent',
          borderTopColor: '#6366f1',
          borderRightColor: '#6366f1',
          animation: 'spin 0.85s linear infinite',
        }} />
        {/* middle ring */}
        <div style={{
          position: 'absolute', inset: 10,
          borderRadius: '50%',
          border: '2.5px solid transparent',
          borderTopColor: '#a78bfa',
          borderLeftColor: '#a78bfa',
          animation: 'spin 1.3s linear infinite reverse',
        }} />
        {/* inner ring */}
        <div style={{
          position: 'absolute', inset: 22,
          borderRadius: '50%',
          border: '2px solid transparent',
          borderTopColor: '#818cf8',
          animation: 'spin 2s linear infinite',
        }} />
        {/* icon center */}
        <div style={{
          position: 'absolute', inset: 32,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <BrainCircuit style={{ width: 22, height: 22, color: '#a5b4fc' }} />
        </div>
      </div>

      {/* ── Text area ── */}
      <div style={{ textAlign: 'center', maxWidth: 340, padding: '0 24px' }}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#e2e8f0', lineHeight: 1.3 }}>
          {current.icon} {current.label}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
          {current.sub}
        </p>
      </div>

      {/* ── Step indicators ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 300 }}>
        {PHASES.map((p, i) => {
          const done    = i < currentIdx;
          const active  = i === currentIdx;
          const pending = i > currentIdx;
          return (
            <div
              key={p.id}
              style={{
                display:        'flex',
                alignItems:     'center',
                gap:            10,
                padding:        '8px 14px',
                borderRadius:   10,
                background:     active  ? 'rgba(99,102,241,0.15)'
                              : done    ? 'rgba(52,211,153,0.08)'
                              : 'rgba(255,255,255,0.03)',
                border:         `1px solid ${
                                  active  ? 'rgba(99,102,241,0.4)'
                                : done    ? 'rgba(52,211,153,0.25)'
                                : 'rgba(255,255,255,0.06)'}`,
                transition:     'all 0.3s ease',
                opacity:        pending ? 0.45 : 1,
              }}
            >
              {/* status dot */}
              <div style={{
                width:         18, height: 18, borderRadius: '50%', flexShrink: 0,
                display:       'flex', alignItems: 'center', justifyContent: 'center',
                fontSize:      10, fontWeight: 800,
                background:    active  ? '#6366f1'
                             : done    ? '#34d399'
                             : 'rgba(255,255,255,0.08)',
                color:         active || done ? '#fff' : '#475569',
                boxShadow:     active ? '0 0 10px rgba(99,102,241,0.6)' : 'none',
                animation:     active ? 'pulse 1.5s ease infinite' : 'none',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 12, fontWeight: active ? 700 : 500,
                color: active ? '#c7d2fe' : done ? '#6ee7b7' : '#475569',
              }}>
                {p.label.replace('…', '')}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Progress bar + elapsed ── */}
      <div style={{ width: 300 }}>
        <div style={{
          height: 3, borderRadius: 99,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            borderRadius: 99,
            background: 'linear-gradient(90deg, #6366f1, #a78bfa)',
            width: `${Math.min(100, ((currentIdx + 1) / PHASES.length) * 100)}%`,
            transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
          }} />
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginTop: 8,
        }}>
          <span style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>
            NIE ODŚWIEŻAJ STRONY
          </span>
          <span style={{
            fontSize: 10, color: '#6366f1', fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {elapsed}s
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Plan Config Modal — 2-krokowy wizard ─────────────────────────────────────
const DAYS_OF_WEEK = [
  { id: 'mon', label: 'Pon' },
  { id: 'tue', label: 'Wt'  },
  { id: 'wed', label: 'Śr'  },
  { id: 'thu', label: 'Czw' },
  { id: 'fri', label: 'Pt'  },
  { id: 'sat', label: 'Sob' },
  { id: 'sun', label: 'Nd'  },
] as const;

type DayId = typeof DAYS_OF_WEEK[number]['id'];

interface PlanConfigModalProps {
  onClose:   () => void;
  onConfirm: (payload: {
    weeks:            number;
    extra_notes:      string;
    pb_5k_mmss:       string;        // MANDATORY
    target_time_mmss: string | null; // optional target goal
  }) => void;
  isLoading: boolean;
}

/** Validate MM:SS format — returns error string or null if OK / empty */
function validateMmss(val: string, allowEmpty = true): string | null {
  if (!val.trim()) return allowEmpty ? null : 'To pole jest wymagane';
  const m = val.match(/^(\d{1,3}):(\d{2})$/);
  if (!m)                    return 'Format: MM:SS (np. 24:30)';
  if (parseInt(m[2]) >= 60)  return 'Sekundy muszą być < 60';
  return null;
}

const STEP_LABELS = ['Twój profil biegacza', 'Konfiguracja planu'] as const;

const PlanConfigModal: React.FC<PlanConfigModalProps> = ({ onClose, onConfirm, isLoading }) => {

  // ── Wizard state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — mandatory runner profile
  const [pb5k,           setPb5k]          = useState('');
  const [pb5kError,      setPb5kError]     = useState<string | null>(null);
  const [targetDist,     setTargetDist]    = useState('10'); // km
  const [targetTime,     setTargetTime]    = useState('');   // MM:SS
  const [targetTimeErr,  setTargetTimeErr] = useState<string | null>(null);

  // Step 2 — plan config
  const [trainingDays, setTrainingDays] = useState(4);
  const [weeks,        setWeeks]        = useState(2);
  const [restDays,     setRestDays]     = useState<Set<DayId>>(new Set(['mon']));

  const toggleRestDay = (id: DayId) =>
    setRestDays(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Step 1 → Step 2 ────────────────────────────────────────────────────────
  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    const e1 = validateMmss(pb5k, false);     // required
    const e2 = validateMmss(targetTime, true); // optional
    setPb5kError(e1);
    setTargetTimeErr(e2);
    if (e1 || e2) return;
    setStep(2);
  };

  // ── Step 2 → Submit ────────────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const restLabels = DAYS_OF_WEEK
      .filter(d => restDays.has(d.id))
      .map(d => d.label)
      .join(', ');

    const notes = [
      `Aktualny rekord 5km: ${pb5k}`,
      targetTime ? `Cel wynikowy: ${targetTime} na ${targetDist}km` : null,
      `Dni treningowe w tygodniu: ${trainingDays}`,
      restDays.size > 0 ? `Dni wolne (brak treningu): ${restLabels}` : null,
    ].filter(Boolean).join('. ');

    onConfirm({
      weeks,
      extra_notes:      notes,
      pb_5k_mmss:       pb5k.trim(),
      target_time_mmss: targetTime.trim() || null,
    });
  };

  // ── Shared styles ───────────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.07em',
    marginBottom: 2,
  };
  const inputStyle = (hasErr: boolean): React.CSSProperties => ({
    fontSize: 13,
    borderColor:  hasErr ? '#f87171' : undefined,
    boxShadow:    hasErr ? '0 0 0 2px rgba(248,113,113,0.25)' : undefined,
  });
  const errorStyle: React.CSSProperties = {
    margin: '3px 0 0', fontSize: 11, color: '#f87171',
  };
  const hintStyle: React.CSSProperties = {
    margin: '3px 0 0', fontSize: 11, color: 'var(--color-text-muted)',
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-modal-title"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        padding: '16px',
        animation: 'modalFadeIn 0.2s ease',
      }}
    >
      <form
        onSubmit={step === 1 ? handleNext : handleSubmit}
        style={{
          width: '100%', maxWidth: 400,
          borderRadius: 20,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'modalSlideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--color-border)',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(124,58,237,0.08))',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
              }}>
                <BrainCircuit style={{ width: 18, height: 18, color: '#fff' }} />
              </div>
              <div>
                <p id="plan-modal-title" style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                  Skonfiguruj swój plan
                </p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {STEP_LABELS[step - 1]}
                </p>
              </div>
            </div>
            <button
              type="button" onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: 'var(--color-text-muted)', display: 'flex' }}
              aria-label="Zamknij"
            >
              <X style={{ width: 18, height: 18 }} />
            </button>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 14, display: 'flex', gap: 6 }}>
            {([1, 2] as const).map(s => (
              <div key={s} style={{
                flex: 1, height: 3, borderRadius: 99,
                background: s <= step
                  ? 'linear-gradient(90deg, #4f46e5, #7c3aed)'
                  : 'var(--color-border)',
                transition: 'background 0.3s ease',
              }} />
            ))}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--color-text-muted)' }}>
            Krok {step} z 2
          </p>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', maxHeight: '60vh' }}>

          {/* ════════════════ STEP 1 — Runner profile ════════════════════ */}
          {step === 1 && (
            <>
              {/* 5k PB — mandatory */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label htmlFor="input-pb5k" style={labelStyle}>
                    ⚡ Aktualny rekord na 5 km
                  </label>
                  <span style={{
                    fontSize: 10, color: '#f87171', background: 'rgba(248,113,113,0.1)',
                    padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                  }}>wymagane</span>
                </div>
                <input
                  id="input-pb5k"
                  type="text"
                  value={pb5k}
                  onChange={e => { setPb5k(e.target.value); setPb5kError(null); }}
                  onBlur={e  => setPb5kError(validateMmss(e.target.value, false))}
                  placeholder="MM:SS — np. 24:30"
                  className="input-base"
                  aria-required="true"
                  aria-describedby={pb5kError ? 'pb5k-error' : 'pb5k-hint'}
                  style={inputStyle(!!pb5kError)}
                />
                {pb5kError
                  ? <p id="pb5k-error" style={errorStyle}>{pb5kError}</p>
                  : <p id="pb5k-hint"  style={hintStyle}>
                      Kasia wyliczy Twój VDOT i ustawi precyzyjne strefy tempa.
                    </p>
                }
              </div>

              {/* Target goal */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label htmlFor="input-target-time" style={labelStyle}>
                    🏆 Cel wynikowy
                  </label>
                  <span style={{
                    fontSize: 10, color: '#a78bfa', background: 'rgba(167,139,250,0.1)',
                    padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                  }}>opcjonalne</span>
                </div>

                {/* Inline distance + time */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 110px' }}>
                    <label htmlFor="input-target-dist" style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                      Dystans (km)
                    </label>
                    <select
                      id="input-target-dist"
                      value={targetDist}
                      onChange={e => setTargetDist(e.target.value)}
                      className="input-base"
                      style={{ fontSize: 13, paddingRight: 8 }}
                    >
                      {['5','10','15','21.1','42.2'].map(d => (
                        <option key={d} value={d}>{d} km</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <label htmlFor="input-target-time" style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                      Docelowy czas
                    </label>
                    <input
                      id="input-target-time"
                      type="text"
                      value={targetTime}
                      onChange={e => { setTargetTime(e.target.value); setTargetTimeErr(null); }}
                      onBlur={e  => setTargetTimeErr(validateMmss(e.target.value, true))}
                      placeholder="MM:SS — np. 50:00"
                      className="input-base"
                      aria-describedby={targetTimeErr ? 'target-error' : undefined}
                      style={inputStyle(!!targetTimeErr)}
                    />
                  </div>
                </div>
                {targetTimeErr && <p id="target-error" style={errorStyle}>{targetTimeErr}</p>}
                <p style={hintStyle}>
                  Np. &quot;50:00 na 10 km&quot; — Kasia zbuduje plan prowadzący do tego wyniku.
                </p>
              </div>
            </>
          )}

          {/* ════════════════ STEP 2 — Plan config ═══════════════════════ */}
          {step === 2 && (
            <>
              {/* Liczba dni */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={labelStyle}>🏃 Dni treningowe / tydzień</label>
                  <span style={{
                    fontSize: 13, fontWeight: 800, color: 'var(--color-accent)',
                    background: 'var(--color-accent-subtle)', padding: '2px 10px', borderRadius: 20,
                  }}>{trainingDays} dni</span>
                </div>
                <input
                  type="range" min={2} max={6} step={1}
                  value={trainingDays}
                  onChange={e => setTrainingDays(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-muted)', marginTop: -4 }}>
                  {[2,3,4,5,6].map(n => <span key={n}>{n}</span>)}
                </div>
              </div>

              {/* Długość planu */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>📅 Długość planu</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1,2,4,8].map(w => (
                    <button
                      key={w} type="button"
                      onClick={() => setWeeks(w)}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 10, border: '1px solid',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                        background:   weeks === w ? 'var(--color-accent)' : 'var(--color-surface-overlay)',
                        borderColor:  weeks === w ? 'var(--color-accent)' : 'var(--color-border)',
                        color:        weeks === w ? '#fff' : 'var(--color-text-secondary)',
                      }}
                    >
                      {w} tydz.
                    </button>
                  ))}
                </div>
              </div>

              {/* Dni wolne */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={labelStyle}>🚫 Preferowane dni wolne</label>
                <div style={{ display: 'flex', gap: 5 }}>
                  {DAYS_OF_WEEK.map(day => {
                    const active = restDays.has(day.id);
                    return (
                      <button
                        key={day.id} type="button"
                        onClick={() => toggleRestDay(day.id)}
                        aria-pressed={active}
                        style={{
                          flex: 1, padding: '7px 0', borderRadius: 10,
                          border:      `1px solid ${active ? '#f87171' : 'var(--color-border)'}`,
                          background:  active ? 'rgba(248,113,113,0.12)' : 'var(--color-surface-overlay)',
                          color:       active ? '#f87171' : 'var(--color-text-muted)',
                          fontSize: 10, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >{day.label}</button>
                    );
                  })}
                </div>
              </div>

              {/* Summary card */}
              <div style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(124,58,237,0.05))',
                border: '1px solid rgba(99,102,241,0.2)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#a78bfa' }}>
                  📋 Podsumowanie Twojego profilu
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  5k PB: <strong style={{ color: 'var(--color-text-primary)' }}>{pb5k}</strong>
                  {targetTime && (
                    <> &nbsp;·&nbsp; Cel: <strong style={{ color: 'var(--color-text-primary)' }}>{targetTime} na {targetDist} km</strong></>
                  )}
                </p>
              </div>
            </>
          )}

        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', gap: 10,
          background: 'var(--color-surface-elevated)',
        }}>
          {/* Back / Cancel */}
          <button
            type="button"
            onClick={() => step === 1 ? onClose() : setStep(1)}
            style={{
              flex: 1, padding: '10px', borderRadius: 12,
              border: '1px solid var(--color-border)',
              background: 'transparent', color: 'var(--color-text-secondary)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {step === 1 ? 'Anuluj' : '← Wróć'}
          </button>

          {/* Next / Generate */}
          <button
            type="submit"
            disabled={isLoading && step === 2}
            style={{
              flex: 2, padding: '10px', borderRadius: 12, border: 'none',
              background: (isLoading && step === 2)
                ? 'rgba(99,102,241,0.4)'
                : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: (isLoading && step === 2) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: (isLoading && step === 2) ? 'none' : '0 4px 16px rgba(99,102,241,0.45)',
              transition: 'all 0.2s',
            }}
          >
            {step === 1 ? (
              <>Dalej →</>
            ) : isLoading ? (
              <><Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} /> Kasia myśli…</>
            ) : (
              <><Sparkles style={{ width: 15, height: 15 }} /> Generuj Plan</>
            )}
          </button>
        </div>

      </form>
    </div>
  );
};
// ── Main component ─────────────────────────────────────────────────────────
export const PlannerPanel: React.FC = () => {
  const { user, isLoggedIn } = useAuth();

  const [goals, setGoals]             = useState<Goal[]>([]);
  const [isLoading, setIsLoading]     = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [generating, setGenerating]   = useState<number | null>(null);
  const [kasiaMessage, setKasiaMessage] = useState<string | null>(null);

  // ── Plan Config Modal state
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<CalendarEvent | null>(null);

  // ── Toast state (success / error feedback)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  // ── Calendar state
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarView, setCalendarView] = useState<'goals' | 'calendar'>('calendar');

  // Calendar aggregated data
  const [calendarData, setCalendarData] = useState<FullCalendarResponse | null>(null);

  // Goal form
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDate, setGoalDate]   = useState('');
  const [goalTime, setGoalTime]   = useState('');
  const [goalDist, setGoalDist]   = useState('');

  // ── Data fetching ────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [gRes, calRes] = await Promise.all([
        fetch(`${API}/api/assistant/goals?user_id=${user.user_id}`),
        fetch(`${API}/api/calendar/full-view?user_id=${user.user_id}&days_back=60&days_forward=90`),
      ]);
      if (gRes.ok)   setGoals(await gRes.json());
      if (calRes.ok) setCalendarData(await calRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // ── Dedykowany refetch TYLKO kalendarza (po generate-plan) ────────────────
  const refetchCalendar = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(
        `${API}/api/calendar/full-view?user_id=${user.user_id}&days_back=60&days_forward=90`
      );
      if (res.ok) setCalendarData(await res.json());
    } catch (e) {
      console.error('[refetchCalendar]', e);
    }
  }, [user]);

  // ── Hook: Structured AI plan generation ──────────────────────────────────
  const {
    status:   planStatus,
    phase:    planPhase,
    result:   planResult,
    error:    planError,
    elapsed:  planElapsed,
    generate: generatePlan,
    reset:    resetPlan,
  } = useGeneratePlan(async () => {
    // ← NATYCHMIASTOWY refetch po 200 OK — nowe treningi wskakują na siatkę bez F5
    await refetchCalendar();
  });

  // Show toast when plan generation completes
  useEffect(() => {
    if (planStatus === 'success' && planResult) {
      showToast(
        'success',
        `✅ Kasia ułożyła ${planResult.plans_created} treningów! Pojawiły się na kalendarzu.`
      );
      resetPlan();
    }
    if (planStatus === 'error' && planError) {
      showToast('error', `❌ Błąd generowania: ${planError}`);
      resetPlan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planStatus]);

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn, fetchData]);

  // ── Build unified calendar events map ────────────────────────────────────
  const allEvents = calendarData?.events ?? [];
  const stravaCount = calendarData?.strava_count ?? 0;
  const planCount   = calendarData?.plan_count   ?? 0;

  const eventsByDate = (Array.isArray(allEvents) ? allEvents : []).reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
    if (!ev?.date) return acc;
    acc[ev.date] = acc[ev.date] ? [...acc[ev.date], ev] : [ev];
    return acc;
  }, {});

  const selectedDateStr = toDateStr(selectedDate);
  const selectedEvents  = selectedDateStr ? (eventsByDate[selectedDateStr] ?? []) : [];

  // ── Goal handlers ────────────────────────────────────────────────────────
  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !goalTitle || !goalDate) return;
    try {
      const res = await fetch(`${API}/api/assistant/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.user_id,
          title: goalTitle,
          race_date: goalDate,
          target_time: goalTime || null,
          distance_km: goalDist ? Number(goalDist) : null,
        }),
      });
      if (res.ok) {
        setGoalTitle(''); setGoalDate(''); setGoalTime(''); setGoalDist('');
        setShowGoalForm(false);
        fetchData();
      }
    } catch (e) { console.error(e); }
  };

  const handleDeleteGoal = async (goalId: number) => {
    if (!user) return;
    await fetch(`${API}/api/assistant/goals/${goalId}?user_id=${user.user_id}`, { method: 'DELETE' });
    fetchData();
  };

  const handleDeletePlan = async (planId: string) => {
    if (!user) return;
    const numericId = parseInt(planId.replace('plan-', ''), 10);
    if (isNaN(numericId)) return;
    await fetch(`${API}/api/assistant/plans/${numericId}?user_id=${user.user_id}`, { method: 'DELETE' });
    fetchData();
  };

  const handleDeleteAllPlans = useCallback(async () => {
    if (!user || planCount === 0) return;
    if (!window.confirm(`Usunąć wszystkie ${planCount} planów treningowych? Tej operacji nie można cofnąć.`)) return;
    try {
      const res = await fetch(`${API}/api/calendar/plans?user_id=${user.user_id}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        showToast('success', `🗑️ Usunięto ${data.deleted} planów treningowych.`);
        await refetchCalendar();
      } else {
        showToast('error', '❌ Nie udało się usunąć planów.');
      }
    } catch { showToast('error', '❌ Błąd sieci.'); }
  }, [user, planCount, showToast, refetchCalendar]);

  const handleSaveStravaRoute = useCallback(async (eventId: string, name: string) => {
    if (!user) return;
    const stravaId = parseInt(eventId.replace('strava-', ''), 10);
    if (isNaN(stravaId)) {
      showToast('error', 'Nie można zapisać trasy — brak ID aktywności Strava.');
      return;
    }
    const res = await fetch(`${API}/api/routes/save-from-strava`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.user_id, strava_activity_id: stravaId, name }),
    });
    if (res.ok) {
      showToast('success', `✅ Trasa „${name}” zapisana! Znajdziesz ją w zakładce Trasy.`);
    } else {
      const err = await res.json().catch(() => ({ detail: 'Nieznany błąd' }));
      showToast('error', `❌ ${err.detail || 'Błąd zapisu trasy'}`);
    }
  }, [user, showToast]);

  const handleGeneratePlan = async (goalId: number) => {
    if (!user) return;
    setGenerating(goalId);
    setKasiaMessage(null);
    try {
      const res = await fetch(`${API}/api/assistant/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id, goal_id: goalId }),
      });
      if (res.ok) {
        const data = await res.json();
        setKasiaMessage(data.kasia_response);
        fetchData();
      }
    } catch (e) { console.error(e); }
    finally { setGenerating(null); }
  };

  // ── Calendar tile content — full-width event cards ──────────────────────
  const tileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return null;
    const dateStr = toDateStr(date);
    const events  = eventsByDate[dateStr];
    if (!events || events.length === 0) return null;

    return (
      <div className="cal-blocks">
        {events.slice(0, 2).map(ev => {
          const isRest = ev.type?.toLowerCase().includes('rest') ||
                         ev.type?.toLowerCase().includes('recovery') ||
                         ev.type?.toLowerCase().includes('wolne');
          if (isRest) {
            return (
              <div key={ev.id} className="cal-block cal-block--rest">
                <span>WOLNE</span>
              </div>
            );
          }
          const style = ev.type ? getTypeStyle(ev.type) : { color: '#6366f1', bg: 'rgba(99,102,241,0.12)' };
          const color = ev.is_completed ? '#fc4c02' : style.color;
          const label = ev.distance_km
            ? `${ev.distance_km} km`
            : (ev.type ?? ev.label);
          return (
            <div
              key={ev.id}
              className="cal-block"
              style={{
                background: ev.is_completed ? 'rgba(252,76,2,0.15)' : style.bg,
                color,
                borderColor: `${color}50`,
              }}
              onClick={e => { e.stopPropagation(); setSelectedWorkout(ev); }}
            >
              <span className="cal-block-dot" style={{ background: color }} />
              <span className="cal-block-text">{label}</span>
            </div>
          );
        })}
        {events.length > 2 && (
          <div className="cal-block cal-block--more">+{events.length - 2}</div>
        )}
      </div>
    );
  };

  const tileClassName = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return null;
    const dateStr = toDateStr(date);
    const classes: string[] = [];
    if (eventsByDate[dateStr]?.some(e => e.is_completed))  classes.push('has-completed');
    if (eventsByDate[dateStr]?.some(e => !e.is_completed)) classes.push('has-planned');
    return classes.join(' ') || null;
  };

  // ── Guard states ─────────────────────────────────────────────────────────
  if (!isLoggedIn) return (
    <div
      className="p-6 text-center text-sm rounded-xl"
      style={{ background: 'var(--color-surface-overlay)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
    >
      Zaloguj się, aby zarządzać celami i kalendarzem.
    </div>
  );

  if (isLoading) return (
    <div className="flex items-center justify-center p-8">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-accent)' }} />
    </div>
  );

  // ── Czy spinner ma być widoczny?
  const isGenerating = planStatus === 'loading';

  return (
    <div className="flex flex-col gap-4">

      {/* ── Fullscreen AI overlay ── */}
      {isGenerating && <KasiaGenerateOverlay phase={planPhase} elapsed={planElapsed} />}

      {/* ── Workout Detail Drawer ── */}
      {selectedWorkout && (
        <WorkoutDrawer
          event={selectedWorkout}
          onClose={() => setSelectedWorkout(null)}
          onSaveRoute={handleSaveStravaRoute}
        />
      )}

      {/* ── Plan Config Modal ── */}
      {showPlanModal && (
        <PlanConfigModal
          isLoading={isGenerating}
          onClose={() => setShowPlanModal(false)}
          onConfirm={({ weeks, extra_notes, pb_5k_mmss, target_time_mmss }) => {
            if (!user) return;
            setShowPlanModal(false);
            generatePlan({ user_id: user.user_id, weeks, extra_notes, pb_5k_mmss, target_time_mmss });
          }}
        />
      )}

      {/* ── Toast notification ── */}
      {toast && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 18px',
            borderRadius: 14,
            maxWidth: 420,
            width: 'max-content',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            background: toast.type === 'success'
              ? 'linear-gradient(135deg, rgba(16,185,129,0.95), rgba(5,150,105,0.95))'
              : 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(185,28,28,0.95))',
            backdropFilter: 'blur(8px)',
            animation: 'slideUpFade 0.3s ease',
          }}
        >
          {toast.type === 'success'
            ? <CheckCircle style={{ width: 18, height: 18, color: '#fff', flexShrink: 0 }} />
            : <AlertCircle   style={{ width: 18, height: 18, color: '#fff', flexShrink: 0 }} />
          }
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
            {toast.text}
          </span>
          <button
            onClick={() => setToast(null)}
            style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: 2 }}
            aria-label="Zamknij"
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
      )}

      {/* ── View toggle ────────────────────────────────────────── */}
      <div
        className="flex p-1 rounded-xl gap-1"
        style={{ background: 'var(--color-surface-overlay)', border: '1px solid var(--color-border)' }}
      >
        {(['calendar', 'goals'] as const).map(v => (
          <button
            key={v}
            onClick={() => setCalendarView(v)}
            className="flex-1 py-1.5 text-xs font-bold rounded-lg transition-all duration-150"
            style={{
              background: calendarView === v ? 'var(--color-accent)' : 'transparent',
              color: calendarView === v ? '#fff' : 'var(--color-text-muted)',
            }}
          >
            {v === 'calendar' ? '📅 Kalendarz' : '🎯 Cele'}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════
          VIEW: CALENDAR
      ════════════════════════════════════════════════════════════ */}
      {calendarView === 'calendar' && (
        <div className="flex flex-col gap-3">

          {/* Legend */}
          <div className="flex items-center gap-4 px-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#fc4c02' }} />
              <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Ukończony (Strava)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#6366f1' }} />
              <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Zaplanowany (Kasia)
              </span>
            </div>
          </div>

          {/* ── CTA: Poproś Kasię o plan ─────────────────────────────────── */}
          <button
            id="btn-kasia-generate-plan"
            disabled={isGenerating}
            onClick={() => setShowPlanModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              padding: '13px 18px',
              borderRadius: 14,
              border: 'none',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              background: isGenerating
                ? 'rgba(99,102,241,0.25)'
                : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 60%, #6366f1 100%)',
              boxShadow: isGenerating ? 'none' : '0 4px 20px rgba(99,102,241,0.45)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.01em',
              transition: 'all 0.2s ease',
              opacity: isGenerating ? 0.7 : 1,
            }}
            onMouseOver={e => {
              if (!isGenerating) {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 28px rgba(99,102,241,0.6)';
              }
            }}
            onMouseOut={e => {
              (e.currentTarget as HTMLElement).style.transform = 'none';
              (e.currentTarget as HTMLElement).style.boxShadow = isGenerating ? 'none' : '0 4px 20px rgba(99,102,241,0.45)';
            }}
          >
            {isGenerating ? (
              <>
                <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                Kasia myśli…
              </>
            ) : (
              <>
                <BrainCircuit style={{ width: 18, height: 18, flexShrink: 0 }} />
                Poproś Kasię o ułożenie planu
                <Settings2 style={{ width: 14, height: 14, opacity: 0.7, flexShrink: 0 }} />
              </>
            )}
          </button>

          {/* ── Usuń plany — danger, widoczny tylko gdy istnieją plany ── */}
          {planCount > 0 && (
            <button
              id="btn-delete-all-plans"
              onClick={handleDeleteAllPlans}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '9px 16px',
                borderRadius: 12,
                border: '1px solid rgba(248,113,113,0.22)',
                background: 'rgba(248,113,113,0.05)',
                color: '#f87171',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseOver={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.12)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(248,113,113,0.4)';
              }}
              onMouseOut={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.05)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(248,113,113,0.22)';
              }}
            >
              <Trash2 style={{ width: 13, height: 13 }} />
              Usuń wszystkie plany ({planCount})
            </button>
          )}

          {/* React Calendar */}

          <div className="planner-calendar-wrapper">
            <Calendar
              onChange={(v) => {
                // react-calendar v6: Value = Date | [Date, Date] | null
                // Guard against null (clicking already-selected tile) and range arrays
                if (v && !Array.isArray(v)) setSelectedDate(v as Date);
              }}
              value={selectedDate}
              tileContent={tileContent}
              tileClassName={tileClassName}
              locale="pl-PL"
              calendarType="iso8601"
            />
          </div>

          {/* Selected date detail panel */}
          <div
            className="rounded-xl p-3"
            style={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              minHeight: '64px',
            }}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {selectedDate instanceof Date && !isNaN(selectedDate.getTime())
                ? selectedDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })
                : '—'}
            </p>

            {selectedEvents.length === 0 ? (
              <p className="text-xs italic" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
                Brak aktywności tego dnia
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {selectedEvents.map(ev => (
                  <div
                    key={String(ev.id)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                    style={{
                      background: ev.is_completed
                        ? 'rgba(252,76,2,0.08)'
                        : (ev.type ? getTypeStyle(ev.type).bg : 'var(--color-accent-subtle)'),
                      border: ev.is_completed
                        ? '1px solid rgba(252,76,2,0.25)'
                        : `1px solid ${ev.type ? getTypeStyle(ev.type).color + '40' : 'rgba(99,102,241,0.25)'}`,
                    }}
                  >
                    {ev.is_completed ? (
                      <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: '#fc4c02' }} />
                    ) : (
                      <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: ev.type ? getTypeStyle(ev.type).color : '#6366f1' }} />
                    )}
                    <div className="flex-1 overflow-hidden">
                      <p
                        className="text-xs font-semibold truncate"
                        style={{
                          color: ev.is_completed
                            ? '#fc4c02'
                            : (ev.type ? getTypeStyle(ev.type).color : 'var(--color-accent)'),
                        }}
                      >
                        {ev.label}
                      </p>
                    </div>
                    {ev.distance_km && (
                      <span
                        className="text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded-md"
                        style={{
                          background: ev.is_completed ? 'rgba(252,76,2,0.15)' : 'rgba(99,102,241,0.12)',
                          color: ev.is_completed ? '#fc4c02' : 'var(--color-accent)',
                        }}
                      >
                        {ev.distance_km} km
                      </span>
                    )}
                    {ev.is_completed && (
                      <span className="text-[9px] font-black uppercase tracking-wider shrink-0" style={{ color: '#fc4c02', opacity: 0.8 }}>
                        STRAVA
                      </span>
                    )}
                    {!ev.is_completed && (
                      <button
                        onClick={() => handleDeletePlan(ev.id)}
                        className="shrink-0 w-4 h-4 flex items-center justify-center rounded transition-all"
                        style={{ color: 'var(--color-text-muted)' }}
                        onMouseOver={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; }}
                        onMouseOut={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'; }}
                        title="Usuń plan"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Monthly summary */}
          <div
            className="grid grid-cols-2 gap-2"
          >
            <div
              className="flex flex-col items-center p-3 rounded-xl"
              style={{ background: 'rgba(252,76,2,0.06)', border: '1px solid rgba(252,76,2,0.15)' }}
            >
              <Zap className="w-4 h-4 mb-1" style={{ color: '#fc4c02' }} />
              <span className="text-lg font-black" style={{ color: '#fc4c02' }}>
                {stravaCount}
              </span>
              <span className="text-[10px] font-medium text-center" style={{ color: 'var(--color-text-muted)' }}>
                Treningi Strava
              </span>
            </div>
            <div
              className="flex flex-col items-center p-3 rounded-xl"
              style={{ background: 'var(--color-accent-subtle)', border: '1px solid rgba(99,102,241,0.2)' }}
            >
              <Target className="w-4 h-4 mb-1" style={{ color: 'var(--color-accent)' }} />
              <span className="text-lg font-black" style={{ color: 'var(--color-accent)' }}>
                {planCount}
              </span>
              <span className="text-[10px] font-medium text-center" style={{ color: 'var(--color-text-muted)' }}>
                Plany od Kasi
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          VIEW: GOALS
      ════════════════════════════════════════════════════════════ */}
      {calendarView === 'goals' && (
        <div className="flex flex-col gap-3">

          {/* Header */}
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
              <Target className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
              Cele startowe
            </h3>
            <button
              onClick={() => setShowGoalForm(!showGoalForm)}
              className="text-[10px] font-bold flex items-center gap-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-accent)' }}
            >
              <Plus className="w-3 h-3" /> Dodaj cel
            </button>
          </div>

          {/* Goal form */}
          {showGoalForm && (
            <form
              onSubmit={handleCreateGoal}
              className="flex flex-col gap-2 p-3 rounded-xl"
              style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)' }}
            >
              <input
                value={goalTitle}
                onChange={e => setGoalTitle(e.target.value)}
                placeholder="Np. Półmaraton w Krakowie"
                className="input-base"
                required
              />
              <div className="flex gap-2">
                <input type="date" value={goalDate} onChange={e => setGoalDate(e.target.value)} className="input-base flex-1" required />
                <input value={goalDist} onChange={e => setGoalDist(e.target.value)} placeholder="km" type="number" step="0.1" className="input-base w-20" />
              </div>
              <input value={goalTime} onChange={e => setGoalTime(e.target.value)} placeholder="Cel czasowy: 1:45:00" className="input-base" />
              <button
                type="submit"
                className="w-full py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)' }}
              >
                Zapisz cel
              </button>
            </form>
          )}

          {/* Goal list */}
          {goals.length === 0 ? (
            <div
              className="p-4 text-center text-xs rounded-xl border-dashed"
              style={{ background: 'var(--color-surface-overlay)', border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)' }}
            >
              Brak celów — dodaj swój pierwszy start!
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {goals.map(g => (
                <div
                  key={g.id}
                  className="group p-3 rounded-xl transition-all"
                  style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>{g.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        <span>📅 {g.race_date}</span>
                        {g.distance_km && <span>{g.distance_km} km</span>}
                        {g.target_time && <span>⏱ {g.target_time}</span>}
                      </div>
                    </div>
                    <div
                      className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold"
                      style={{
                        background: g.days_left <= 7 ? 'rgba(248,113,113,0.12)' : g.days_left <= 30 ? 'rgba(251,191,36,0.12)' : 'var(--color-accent-subtle)',
                        color: g.days_left <= 7 ? '#f87171' : g.days_left <= 30 ? '#fbbf24' : 'var(--color-accent)',
                      }}
                    >
                      {g.days_left > 0 ? `za ${g.days_left} dni` : 'Dziś!'}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleGeneratePlan(g.id)}
                      disabled={generating === g.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50"
                      style={{ background: 'var(--color-accent-subtle)', border: '1px solid rgba(99,102,241,0.2)', color: 'var(--color-accent)' }}
                    >
                      {generating === g.id
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Generuję…</>
                        : <><Sparkles className="w-3 h-3" /> Wygeneruj plan z Kasią</>
                      }
                    </button>
                    <button
                      onClick={() => handleDeleteGoal(g.id)}
                      className="p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      style={{ color: 'var(--color-text-muted)' }}
                      onMouseOver={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; (e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.1)'; }}
                      onMouseOut={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Kasia message */}
          {kasiaMessage && (
            <div
              className="p-3 rounded-xl text-sm whitespace-pre-wrap"
              style={{ background: 'var(--color-accent-subtle)', border: '1px solid rgba(99,102,241,0.2)', color: 'var(--color-text-primary)' }}
            >
              <p className="text-[10px] uppercase font-bold tracking-wider mb-1.5" style={{ color: 'var(--color-accent)' }}>
                💬 Plan od Kasi
              </p>
              {kasiaMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
