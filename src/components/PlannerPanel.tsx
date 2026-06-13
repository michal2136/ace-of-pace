import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Target, Plus, Trash2, Sparkles, CheckCircle, Clock, BrainCircuit, X, AlertCircle, Activity, Flame, Wind, Timer, MapPin, Heart, CalendarDays as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

import { useGeneratePlan } from '../hooks/useGeneratePlan';
import { SaveRouteWidget } from './SaveRouteWidget';

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
  avg_heart_rate:  number | null;
  avg_pace:        string | null;
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
  'Easy Run':  { color: '#3100FF', bg: 'rgba(49,0,255,0.08)' },
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

// ── Custom Calendar ───────────────────────────────────────────────────────────
const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

interface DayDot { color: string; }
interface CustomCalendarProps {
  value: Date | null;
  onChange: (d: Date) => void;
  eventsByDate: Record<string, { is_completed: boolean; is_rest_day?: boolean | null; type?: string | null; distance_km?: number | null }[]>;
}

const CustomCalendar: React.FC<CustomCalendarProps> = ({ value, onChange, eventsByDate }) => {
  const today = new Date();
  const [viewYear, setViewYear] = React.useState(value ? value.getFullYear() : today.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(value ? value.getMonth() : today.getMonth());

  // Sync view when external value changes month
  React.useEffect(() => {
    if (value) { setViewYear(value.getFullYear()); setViewMonth(value.getMonth()); }
  }, [value]);

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  // Build grid: 6 rows × 7 cols, starting Monday
  const firstDay = new Date(viewYear, viewMonth, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells: (Date | null)[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      // neighboring month cells
      const d = new Date(viewYear, viewMonth, dayNum);
      cells.push(d);
    } else {
      cells.push(new Date(viewYear, viewMonth, dayNum));
    }
  }

  const toStr = (d: Date) => d.toISOString().slice(0, 10);
  const todayStr = toStr(today);
  const selectedStr = value ? toStr(value) : '';

  const getDots = (dateStr: string): DayDot[] => {
    const evs = (eventsByDate[dateStr] ?? []).filter(
      ev => !ev.is_rest_day && !ev.type?.toLowerCase().includes('rest')
    );
    return evs.map(ev => ({ color: ev.is_completed ? '#fc4c02' : '#3100FF' }));
  };

  const getDistLabel = (dateStr: string): string | null => {
    const evs = (eventsByDate[dateStr] ?? []).filter(
      ev => !ev.is_rest_day && !ev.type?.toLowerCase().includes('rest')
    );
    const total = evs.reduce((s, e) => s + (e.distance_km ?? 0), 0);
    return total > 0 ? `${Math.round(total * 10) / 10}` : null;
  };

  return (
    <div className="custom-cal">
      {/* Navigation */}
      <div className="custom-cal__nav">
        <button onClick={prevMonth} className="custom-cal__nav-btn" aria-label="Poprzedni miesiąc">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="custom-cal__month-label">
          {MONTHS_PL[viewMonth]} {viewYear}
        </span>
        <button onClick={nextMonth} className="custom-cal__nav-btn" aria-label="Następny miesiąc">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="custom-cal__weekdays">
        {WEEKDAYS.map(d => <div key={d} className="custom-cal__wd">{d}</div>)}
      </div>

      {/* Day grid */}
      <div className="custom-cal__grid">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="custom-cal__cell custom-cal__cell--empty" />;
          const dStr = toStr(date);
          const isCurrentMonth = date.getMonth() === viewMonth;
          const isToday = dStr === todayStr;
          const isSelected = dStr === selectedStr;
          const dots = isCurrentMonth ? getDots(dStr) : [];
          const distLabel = isCurrentMonth ? getDistLabel(dStr) : null;

          return (
            <button
              key={i}
              onClick={() => onChange(date)}
              className={[
                'custom-cal__cell',
                !isCurrentMonth && 'custom-cal__cell--other',
                isToday && 'custom-cal__cell--today',
                isSelected && 'custom-cal__cell--selected',
                dots.length > 0 && 'custom-cal__cell--has-events',
              ].filter(Boolean).join(' ')}
            >
              <span className="custom-cal__day-num">{date.getDate()}</span>
              {distLabel && (
                <span className="custom-cal__dist">{distLabel}</span>
              )}
              {dots.length > 0 && (
                <div className="custom-cal__dots">
                  {dots.slice(0, 4).map((dot, di) => (
                    <span key={di} className="custom-cal__dot" style={{ background: dot.color }} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};


// ── Compact inline phase row — used inside the day-detail panel (no overlay) ──
const InlinePhaseRow: React.FC<{
  icon:        React.ReactNode;
  label:       string;
  accentColor: string;
  distKm?:     number | null;
  pace?:       string | null;
  hrTarget?:   string | null;
  coachCue?:   string | null;
}> = ({ icon, label, accentColor, distKm, pace, hrTarget, coachCue }) => (
  <div
    className="rounded-[2px] border overflow-hidden"
    style={{
      background: 'var(--color-surface-elevated)',
      borderColor: 'var(--color-border)',
    }}
  >
    {/* Header strip — accent tint using CSS var overlay */}
    <div
      className="flex items-center gap-1.5 px-2 py-1 border-b"
      style={{
        background: 'var(--phase-header-bg, var(--color-surface-overlay))',
        /* We rely on inline accentColor to tint via box-shadow trick below */
        borderColor: 'var(--color-border)',
        boxShadow: `inset 3px 0 0 0 ${accentColor}`,
      }}
    >
      <span className="shrink-0 flex items-center">{icon}</span>
      <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: accentColor }}>{label}</span>
    </div>
    {/* Metric line: dist @ pace  ❤ hr */}
    <div className="px-2 py-1.5 flex items-baseline gap-1.5 flex-wrap">
      {distKm != null && (
        <>
          <span className="text-lg font-extrabold tabular-nums leading-none" style={{ color: 'var(--color-text-primary)' }}>{distKm}</span>
          <span className="text-[8px] font-bold uppercase mr-1" style={{ color: 'var(--color-text-muted)' }}>km</span>
        </>
      )}
      {pace && (
        <>
          <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>@</span>
          <span className="text-sm font-extrabold tabular-nums leading-none" style={{ color: accentColor }}>{pace}</span>
          <span className="text-[8px] font-bold uppercase" style={{ color: 'var(--color-text-muted)' }}>min/km</span>
        </>
      )}
      {!distKm && !pace && <span className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>—</span>}
      {hrTarget && (
        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          <Heart className="w-2.5 h-2.5" style={{ color: 'var(--color-danger)' }} />
          <span className="text-[9px] font-bold tabular-nums" style={{ color: 'var(--color-danger)' }}>{hrTarget}</span>
        </span>
      )}
    </div>
    {/* Coach cue */}
    {coachCue && (
      <div
        className="px-2 pb-1.5 text-[9px] italic leading-snug border-t pt-1"
        style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}
      >
        « {coachCue} »
      </div>
    )}
  </div>
);

// ── Kasia Generate Overlay — wieloetapowy, phase-aware ──────────────────────

const PHASES = [
  {
    id:      'analyzing'  as const,
    icon:    null,
    label:   'Analizuję Twoje dane ze Strava…',
    sub:     'Pobieram historię 30 dni i obliczam Twoje tempa',
  },
  {
    id:      'computing'  as const,
    icon:    null,
    label:   'Kasia przelicza tempa i układa pełny plan…',
    sub:     'Gemini generuje ustrukturyzowany JSON dla każdego dnia',
  },
  {
    id:      'saving'     as const,
    icon:    null,
    label:   'Zapisuję plan do kalendarza…',
    sub:     'Walidacja Pydantic + atomowy zapis do bazy danych',
  },
] as const;

type Phase = typeof PHASES[number]['id'];

const KasiaGenerateOverlay: React.FC<{ phase: Phase | null; elapsed: number }> = ({ phase, elapsed }) => {
  const currentIdx = PHASES.findIndex(p => p.id === phase);
  const current    = currentIdx >= 0 ? PHASES[currentIdx] : PHASES[0];
  const accentColor = '#CEFF00'; // Neonowy zielony niezależnie od motywu dla ciemnego overlay

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Kasia generuje plan treningowy"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-7 bg-black/95 backdrop-blur-md animate-in fade-in"
    >
      {/* ── Animated brain rings ── */}
      <div className="relative w-24 h-24 shrink-0">
        {/* outer ring */}
        <div 
          className="absolute inset-0 rounded-full border-4 border-transparent animate-[spin_0.85s_linear_infinite]" 
          style={{ borderTopColor: accentColor, borderRightColor: accentColor }}
        />
        {/* middle ring */}
        <div 
          className="absolute inset-2.5 rounded-full border-[3px] border-transparent animate-[spin_1.3s_linear_infinite_reverse]" 
          style={{ borderTopColor: `${accentColor}99`, borderLeftColor: `${accentColor}99` }}
        />
        {/* inner ring */}
        <div 
          className="absolute inset-[22px] rounded-full border-2 border-transparent animate-[spin_2s_linear_infinite]" 
          style={{ borderTopColor: `${accentColor}66` }}
        />
        {/* icon center */}
        <div className="absolute inset-8 flex items-center justify-center">
          <BrainCircuit className="w-6 h-6" style={{ color: accentColor }} />
        </div>
      </div>

      {/* ── Text area ── */}
      <div className="text-center max-w-[340px] px-6">
        <p className="m-0 text-lg font-display font-black text-white leading-tight">
          {current.icon} {current.label}
        </p>
        <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
          {current.sub}
        </p>
      </div>

      {/* ── Step indicators ── */}
      <div className="flex flex-col gap-2 w-[300px]">
        {PHASES.map((p, i) => {
          const done    = i < currentIdx;
          const active  = i === currentIdx;
          const pending = i > currentIdx;
          
          let cardStyle: React.CSSProperties = {
            backgroundColor: 'rgba(255,255,255,0.03)',
            borderColor: 'rgba(255,255,255,0.08)',
          };
          if (active) {
            cardStyle = {
              backgroundColor: `${accentColor}15`,
              borderColor: `${accentColor}40`,
            };
          } else if (done) {
            cardStyle = {
              backgroundColor: 'rgba(52,211,153,0.1)',
              borderColor: 'rgba(52,211,153,0.3)',
            };
          }

          let dotStyle: React.CSSProperties = {
            backgroundColor: 'rgba(255,255,255,0.1)',
            color: '#a1a1aa',
          };
          if (active) {
            dotStyle = {
              backgroundColor: accentColor,
              color: '#0a0a0c',
              boxShadow: `0 0 10px ${accentColor}99`,
            };
          } else if (done) {
            dotStyle = {
              backgroundColor: '#34d399',
              color: '#ffffff',
            };
          }

          return (
            <div
              key={p.id}
              className={`flex items-center gap-3 py-2 px-3.5 rounded-[2px] transition-all duration-300 border ${pending ? 'opacity-40' : 'opacity-100'}`}
              style={cardStyle}
            >
              {/* status dot */}
              <div 
                className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[9px] font-black ${active ? 'animate-pulse' : ''}`}
                style={dotStyle}
              >
                {done ? '✓' : i + 1}
              </div>
              <span 
                className="text-xs font-semibold"
                style={{
                  color: active ? accentColor : done ? '#34d399' : '#a1a1aa'
                }}
              >
                {p.label.replace('…', '')}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Progress bar + elapsed ── */}
      <div className="w-[300px]">
        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-1000 ease-in-out"
            style={{ 
              width: `${Math.min(100, ((currentIdx + 1) / PHASES.length) * 100)}%`,
              backgroundColor: accentColor
            }} 
          />
        </div>
        <div className="flex justify-between mt-2">
          <span className="label-mono text-zinc-500 text-[9px] tracking-widest font-mono-custom">NIE ODŚWIEŻAJ STRONY</span>
          <span className="label-mono text-[10px] font-mono-custom font-black" style={{ color: accentColor }}>{elapsed}s</span>
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

  // Helper do automatycznego formatowania MM:SS (dodawanie dwukropka po 2 cyfrach)
  const handleMmssChange = (val: string, prev: string, setter: (v: string) => void, clearError: () => void) => {
    clearError();
    let clean = val.replace(/[^0-9:]/g, '');
    
    // Jeśli rośnie (użytkownik dopisuje znaki)
    if (clean.length > prev.length) {
      const digits = clean.replace(/[^0-9]/g, '');
      if (digits.length === 2 && !clean.includes(':')) {
        clean = digits + ':';
      } else if (digits.length === 3 && !clean.includes(':')) {
        clean = digits.slice(0, 2) + ':' + digits.slice(2);
      } else if (digits.length === 4) {
        clean = digits.slice(0, 2) + ':' + digits.slice(2);
      } else if (digits.length >= 5) {
        clean = digits.slice(0, digits.length - 2) + ':' + digits.slice(digits.length - 2);
      }
    }
    setter(clean);
  };

  // Gramatyczne etykiety dla tygodni w języku polskim
  const getWeeksLabel = (w: number) => {
    if (w === 1) return '1 tydzień';
    if (w === 2) return '2 tygodnie';
    if (w === 4) return '4 tygodnie';
    if (w === 8) return '8 tygodni';
    return `${w} tyg.`;
  };

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

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-modal-title"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in"
    >
      <form
        onSubmit={step === 1 ? handleNext : handleSubmit}
        className="w-full max-w-[400px] card-sporty shadow-[0_32px_80px_rgba(0,0,0,0.5)] flex flex-col animate-in slide-in-from-bottom-8"
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="p-4 pb-3 border-b border-border bg-surface-elevated">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-[var(--radius)] bg-accent/10 flex items-center justify-center border border-accent/20 shrink-0">
                <BrainCircuit className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p id="plan-modal-title" className="m-0 text-sm font-display font-black text-primary uppercase tracking-tight">
                  Skonfiguruj plan
                </p>
                <p className="m-0 text-[11px] font-medium text-muted">
                  {STEP_LABELS[step - 1]}
                </p>
              </div>
            </div>
            <button
              type="button" onClick={onClose}
              className="btn-ghost p-1 rounded-[var(--radius)]"
              aria-label="Zamknij"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-3 flex gap-1">
            {([1, 2] as const).map(s => (
              <div key={s} className={`flex-1 h-0.5 rounded-[1px] transition-colors duration-300 ${s <= step ? 'bg-accent' : 'bg-border'}`} />
            ))}
          </div>
          <p className="label-mono mt-1.5 text-[9px]">Krok {step} z 2</p>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="p-4 flex flex-col gap-4 overflow-y-auto max-h-[55vh] bg-surface">

          {/* ════════════════ STEP 1 — Runner profile ════════════════════ */}
          {step === 1 && (
            <>
              {/* 5k PB — mandatory */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="input-pb5k" className="label-mono text-secondary">
                    Aktualny rekord na 5 km
                  </label>
                  <span className="badge badge-lime text-danger bg-danger/10 border-danger/30 text-[9px] px-1.5 py-0.5">wymagane</span>
                </div>
                <input
                  id="input-pb5k"
                  type="text"
                  value={pb5k}
                  onChange={e => handleMmssChange(e.target.value, pb5k, setPb5k, () => setPb5kError(null))}
                  onBlur={e  => setPb5kError(validateMmss(e.target.value, false))}
                  placeholder="np. 24:30"
                  className={`input-base font-mono-custom p-2 text-sm ${pb5kError ? 'border-danger focus:border-danger focus:ring-1 focus:ring-danger' : ''}`}
                  aria-required="true"
                  aria-describedby={pb5kError ? 'pb5k-error' : 'pb5k-hint'}
                />
                {pb5kError
                  ? <p id="pb5k-error" className="m-0 text-[10px] font-medium text-danger">{pb5kError}</p>
                  : <p id="pb5k-hint"  className="m-0 text-[10px] text-muted">
                      Kasia wyliczy Twój VDOT i ustawi strefy tempa.
                    </p>
                }
              </div>

              {/* Target goal */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="input-target-time" className="label-mono text-secondary">
                    🏆 Cel wynikowy
                  </label>
                  <span className="badge badge-muted text-[9px] px-1.5 py-0.5">opcjonalne</span>
                </div>

                {/* Inline distance + time */}
                <div className="flex gap-2">
                  <div className="flex flex-col gap-1 basis-[110px]">
                    <label htmlFor="input-target-dist" className="text-[10px] font-semibold text-muted uppercase tracking-wider">Dystans</label>
                    <select
                      id="input-target-dist"
                      value={targetDist}
                      onChange={e => setTargetDist(e.target.value)}
                      className="input-base p-2 text-sm bg-surface-overlay"
                    >
                      {['5','10','15','21.1','42.2'].map(d => (
                        <option key={d} value={d}>{d} km</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <label htmlFor="input-target-time" className="text-[10px] font-semibold text-muted uppercase tracking-wider">Docelowy czas</label>
                    <input
                      id="input-target-time"
                      type="text"
                      value={targetTime}
                      onChange={e => handleMmssChange(e.target.value, targetTime, setTargetTime, () => setTargetTimeErr(null))}
                      onBlur={e  => setTargetTimeErr(validateMmss(e.target.value, true))}
                      placeholder="np. 50:00"
                      className={`input-base font-mono-custom p-2 text-sm ${targetTimeErr ? 'border-danger focus:border-danger focus:ring-1 focus:ring-danger' : ''}`}
                      aria-describedby={targetTimeErr ? 'target-error' : undefined}
                    />
                  </div>
                </div>
                {targetTimeErr && <p id="target-error" className="m-0 text-[10px] font-medium text-danger">{targetTimeErr}</p>}
                <p className="m-0 text-[10px] text-muted">
                  Np. "50:00 na 10 km" — Kasia zbuduje plan pod ten cel.
                </p>
              </div>
            </>
          )}

          {/* ════════════════ STEP 2 — Plan config ═══════════════════════ */}
          {step === 2 && (
            <>
              {/* Liczba dni */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="label-mono text-secondary">Dni treningowe / tydzień</label>
                  <span className="badge badge-lime text-[10px] px-1.5 py-0.5">{trainingDays} dni</span>
                </div>
                <input
                  type="range" min={2} max={6} step={1}
                  value={trainingDays}
                  onChange={e => setTrainingDays(Number(e.target.value))}
                  className="w-full cursor-pointer my-1"
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                <div className="flex justify-between text-[9px] text-muted font-mono-custom px-1">
                  {[2,3,4,5,6].map(n => <span key={n}>{n}</span>)}
                </div>
              </div>

              {/* Długość planu */}
              <div className="flex flex-col gap-1">
                <label className="label-mono text-secondary">Długość planu</label>
                <div className="flex gap-1.5">
                  {[1,2,4,8].map(w => (
                    <button
                      key={w} type="button"
                      onClick={() => setWeeks(w)}
                      className={`flex-1 py-1.5 rounded-[var(--radius)] text-xs font-bold border transition-all duration-150 cursor-pointer ${
                        weeks === w 
                          ? 'bg-accent border-accent text-accent-fg shadow-sm' 
                          : 'bg-surface-overlay border-border text-secondary hover:border-accent/50'
                      }`}
                    >
                      {getWeeksLabel(w)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dni wolne */}
              <div className="flex flex-col gap-1">
                <label className="label-mono text-secondary">🚫 Preferowane dni wolne</label>
                <div className="flex gap-1">
                  {DAYS_OF_WEEK.map(day => {
                    const active = restDays.has(day.id);
                    return (
                      <button
                        key={day.id} type="button"
                        onClick={() => toggleRestDay(day.id)}
                        aria-pressed={active}
                        className={`flex-1 py-1.5 rounded-[var(--radius)] text-[10px] font-bold border transition-colors cursor-pointer ${
                          active ? 'bg-danger/10 border-danger/40 text-danger' : 'bg-surface-overlay border-border text-muted hover:border-border-strong'
                        }`}
                      >{day.label}</button>
                    );
                  })}
                </div>
              </div>

              {/* Summary card */}
              <div className="p-3 rounded-[var(--radius)] bg-black/10 border border-border flex flex-col gap-1 mt-1">
                <p className="m-0 text-[10px] font-bold text-accent uppercase tracking-wider">
                  📋 Podsumowanie
                </p>
                <p className="m-0 text-xs text-secondary font-medium">
                  5k PB: <strong className="text-primary font-mono-custom">{pb5k || '—'}</strong>
                  {targetTime && (
                    <> &nbsp;·&nbsp; Cel: <strong className="text-primary font-mono-custom">{targetTime} na {targetDist} km</strong></>
                  )}
                </p>
              </div>
            </>
          )}

        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="p-3 border-t border-border flex gap-3 bg-surface-elevated">
          {/* Back / Cancel */}
          <button
            type="button"
            onClick={() => step === 1 ? onClose() : setStep(1)}
            className="flex-1 btn-ghost py-2 text-xs uppercase tracking-wider font-bold rounded-[var(--radius)] cursor-pointer"
          >
            {step === 1 ? 'Anuluj' : '← Wróć'}
          </button>

          {/* Next / Generate */}
          <button
            type="submit"
            disabled={isLoading && step === 2}
            className="flex-[2] btn-lime py-2 text-xs uppercase tracking-wider font-bold rounded-[var(--radius)] cursor-pointer"
          >
            {step === 1 ? (
              <>Dalej →</>
            ) : isLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Kasia myśli…</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" /> Generuj Plan</>
            )}
          </button>
        </div>

      </form>
    </div>
  );
};
// ── Main component ─────────────────────────────────────────────────────────
interface PlannerPanelProps {
  onRequestAnalysis?: (activityId: number, activityName: string) => void;
}

export const PlannerPanel: React.FC<PlannerPanelProps> = ({ onRequestAnalysis }) => {
  const { user, isLoggedIn } = useAuth();

  const [goals, setGoals]             = useState<Goal[]>([]);
  const [isLoading, setIsLoading]     = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [generating, setGenerating]   = useState<number | null>(null);
  const [kasiaMessage, setKasiaMessage] = useState<string | null>(null);

  // ── Plan Config Modal state
  const [showPlanModal, setShowPlanModal] = useState(false);

  // ── Toast state (success / error feedback)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    // Automatyczne usuwanie emoji z początku tekstu powiadomień
    const cleanText = text.replace(/^(✅|❌|🗑️)\s*/, '');
    setToast({ type, text: cleanText });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  // ── Calendar state
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
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
  const planCount   = calendarData?.plan_count   ?? 0;

  const eventsByDate = (Array.isArray(allEvents) ? allEvents : []).reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
    if (!ev?.date) return acc;
    acc[ev.date] = acc[ev.date] ? [...acc[ev.date], ev] : [ev];
    return acc;
  }, {});

  const selectedDateStr = toDateStr(selectedDate);
  const selectedEvents  = (selectedDateStr ? (eventsByDate[selectedDateStr] ?? []) : []).filter(
    ev => !ev.is_rest_day && !ev.type?.toLowerCase().includes('rest')
  );

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
    <div className="flex flex-col gap-4 flex-1 overflow-hidden">

      {/* ── Fullscreen AI overlay ── */}
      {isGenerating && <KasiaGenerateOverlay phase={planPhase} elapsed={planElapsed} />}

      {/* WorkoutDrawer removed — workout details now expand inline in the day panel */}

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
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] flex items-center gap-3.5 py-3 px-4 rounded-[var(--radius)] w-max max-w-[440px] border shadow-[0_16px_48px_rgba(0,0,0,0.55)] bg-[var(--color-surface)] animate-in slide-in-from-bottom-8 border-l-4"
          style={{ 
            borderColor: 'var(--color-border)', 
            borderLeftColor: toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'
          }}
        >
          {/* Custom colored icon container */}
          <div 
            className="w-7 h-7 rounded-[var(--radius)] border flex items-center justify-center shrink-0"
            style={{
              backgroundColor: toast.type === 'success' ? 'rgba(52,211,153,0.10)' : 'rgba(239,68,68,0.10)',
              borderColor: toast.type === 'success' ? 'rgba(52,211,153,0.20)' : 'rgba(239,68,68,0.20)',
            }}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
            ) : (
              <AlertCircle className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
            )}
          </div>

          {/* Sporty Display Typography Text */}
          <span className="text-[11px] font-display font-black uppercase tracking-wider text-primary leading-tight flex-1">
            {toast.text}
          </span>

          {/* Clean close button */}
          <button
            onClick={() => setToast(null)}
            className="p-1 text-secondary hover:text-primary transition-colors bg-transparent border-none cursor-pointer flex items-center justify-center rounded-[var(--radius)]"
            aria-label="Zamknij"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── View toggle (shadcn/ui style tabs with underline) ────────────────────── */}
      <div className="flex border-b border-border/50 w-full shrink-0">
        {(['calendar', 'goals'] as const).map(v => (
          <button
            key={v}
            onClick={() => setCalendarView(v)}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest transition-all cursor-pointer border-b-2 bg-transparent ${
              calendarView === v
                ? 'border-primary text-primary font-black'
                : 'border-transparent text-muted hover:text-secondary'
            }`}
          >
            {v === 'calendar' ? 'Kalendarz' : 'Cele'}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════
          VIEW: CALENDAR
      ════════════════════════════════════════════════════════════ */}
      {calendarView === 'calendar' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* Scrollable area: calendar + day details */}
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-0 pb-2">

            {/* Custom Calendar */}
            <CustomCalendar
              value={selectedDate}
              onChange={(d) => setSelectedDate(d)}
              eventsByDate={eventsByDate}
            />

            {/* ── Day detail section ───────────────────────────────────── */}
            {selectedDate && (
              <div className="mt-3 flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150">

                {/* Date header */}
                <div className="flex items-center justify-between px-0.5 mb-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    {selectedDate instanceof Date && !isNaN(selectedDate.getTime())
                      ? selectedDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })
                      : '—'}
                  </span>
                  <button
                    onClick={() => setSelectedDate(null)}
                    className="p-0.5 border-none bg-transparent text-muted hover:text-primary rounded-[2px] transition-colors cursor-pointer flex items-center justify-center"
                    aria-label="Zamknij"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {selectedEvents.length === 0 ? (
                  <p className="text-[11px] italic text-muted text-center py-3 px-2 rounded-[var(--radius)] border border-dashed border-border/40">
                    Brak aktywności tego dnia
                  </p>
                ) : (
                  selectedEvents.map(ev => {
                    const evColor = ev.is_completed
                      ? 'var(--color-strava)'
                      : ev.type ? getTypeStyle(ev.type).color : 'var(--color-accent)';
                    const evBg = ev.is_completed
                      ? 'rgba(252,76,2,0.06)'
                      : ev.type ? getTypeStyle(ev.type).bg : 'var(--color-accent-subtle)';
                    const evBorder = ev.is_completed
                      ? 'rgba(252,76,2,0.25)'
                      : ev.type ? getTypeStyle(ev.type).color + '40' : 'rgba(180,242,78,0.25)';

                    const parts = [ev.warmup_distance_km ?? 0, ev.main_distance_km ?? 0, ev.cooldown_distance_km ?? 0];
                    const phaseSum = parts.reduce((a, b) => a + b, 0);
                    const totalDist = phaseSum > 0 ? Math.round(phaseSum * 100) / 100 : (ev.distance_km ?? null);
                    const hasPhases = !!(
                      ev.warmup_distance_km || ev.warmup_beginner_explanation ||
                      ev.main_distance_km   || ev.main_beginner_explanation   ||
                      ev.cooldown_distance_km || ev.cooldown_beginner_explanation
                    );
                    const isRest = ev.is_rest_day || ev.type?.toLowerCase().includes('rest') || ev.type?.toLowerCase().includes('recovery');

                    return (
                      <div
                        key={String(ev.id)}
                        className="rounded-[var(--radius)] border overflow-hidden"
                        style={{ background: evBg, borderColor: evBorder }}
                      >
                        {/* Card header */}
                        <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                          {ev.is_completed
                            ? <CheckCircle className="w-3.5 h-3.5 shrink-0 text-strava" />
                            : <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: evColor }} />
                          }
                          <div className="flex-1 overflow-hidden">
                            <p className="text-[14px] font-bold truncate m-0" style={{ color: evColor }}>
                              {ev.label}
                            </p>
                          </div>
                          {ev.is_completed && (
                            <span className="text-[9px] font-black uppercase tracking-wider shrink-0 text-strava/70">STRAVA</span>
                          )}
                          {!ev.is_completed && (
                            <button
                              onClick={e => { e.stopPropagation(); handleDeletePlan(ev.id); }}
                              className="shrink-0 w-5 h-5 flex items-center justify-center rounded-[2px] transition-colors text-muted hover:text-danger hover:bg-danger/10 border-none bg-transparent cursor-pointer ml-0.5"
                              title="Usuń plan"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        {/* Details — always visible, no scroll needed */}
                        <div className="border-t px-3 pb-3 pt-2 flex flex-col gap-2" style={{ borderColor: evBorder + '80', background: 'var(--color-surface-elevated)' }}>

                          {/* Pace + dist summary */}
                          {!ev.is_completed && (ev.main_exact_pace || ev.main_target_pace || ev.target_pace) && (
                            <div className="flex items-center gap-2">
                              <Timer className="w-3 h-3 shrink-0" style={{ color: evColor }} />
                              <span className="text-[11px] font-black tabular-nums" style={{ color: evColor }}>
                                {ev.main_exact_pace ?? ev.main_target_pace ?? ev.target_pace} min/km
                              </span>
                              {totalDist != null && (
                                <>
                                  <span className="text-muted text-[9px]">·</span>
                                  <span className="text-[11px] font-bold text-muted tabular-nums">{totalDist} km łącznie</span>
                                </>
                              )}
                            </div>
                          )}

                          {ev.is_completed && (totalDist != null || ev.avg_pace || ev.avg_heart_rate) && (
                            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${[totalDist, ev.avg_pace, ev.avg_heart_rate].filter(Boolean).length}, 1fr)` }}>
                              {totalDist != null && (
                                <div
                                  className="flex flex-col items-center justify-center gap-0.5 rounded-lg py-2.5 px-1"
                                  style={{ background: 'var(--color-surface-overlay)', border: '1px solid var(--color-border)' }}
                                >
                                  <span className="text-lg font-black tabular-nums leading-none" style={{ color: 'var(--color-strava)' }}>{totalDist}</span>
                                  <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>km</span>
                                </div>
                              )}
                              {ev.avg_pace && (
                                <div
                                  className="flex flex-col items-center justify-center gap-0.5 rounded-lg py-2.5 px-1"
                                  style={{ background: 'var(--color-surface-overlay)', border: '1px solid var(--color-border)' }}
                                >
                                  <span className="text-lg font-black tabular-nums leading-none" style={{ color: 'var(--color-text-primary)' }}>{ev.avg_pace}</span>
                                  <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>min/km</span>
                                </div>
                              )}
                              {ev.avg_heart_rate && (
                                <div
                                  className="flex flex-col items-center justify-center gap-0.5 rounded-lg py-2.5 px-1"
                                  style={{ background: 'var(--color-surface-overlay)', border: '1px solid var(--color-border)' }}
                                >
                                  <span className="text-lg font-black tabular-nums leading-none" style={{ color: '#f87171' }}>{ev.avg_heart_rate}</span>
                                  <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>bpm</span>
                                </div>
                              )}
                            </div>
                          )}

                          {isRest ? (
                            <div className="flex items-start gap-2">
                              <Wind className="w-3.5 h-3.5 text-muted shrink-0 mt-0.5" />
                              <p className="m-0 text-[10px] font-medium text-secondary leading-snug">
                                {ev.trainer_notes || ev.description || 'Dzień regeneracji — odpoczynek jest częścią treningu.'}
                              </p>
                            </div>
                          ) : hasPhases ? (
                            <div className="flex flex-col gap-1.5">
                              {(ev.warmup_distance_km != null || ev.warmup_beginner_explanation) && (
                                <InlinePhaseRow
                                  icon={<Flame className="w-3 h-3 text-warning" />}
                                  label="Rozgrzewka"
                                  accentColor="var(--color-warning, #fbbf24)"
                                  distKm={ev.warmup_distance_km}
                                  pace={ev.warmup_exact_pace ?? undefined}
                                  hrTarget={ev.warmup_heart_rate_target ?? undefined}
                                  coachCue={ev.warmup_beginner_explanation ?? undefined}
                                />
                              )}
                              {(ev.main_distance_km != null || ev.main_beginner_explanation) && (
                                <InlinePhaseRow
                                  icon={<Activity className="w-3 h-3" style={{ color: evColor }} />}
                                  label="Bieg główny"
                                  accentColor={evColor}
                                  distKm={ev.main_distance_km}
                                  pace={ev.main_exact_pace ?? ev.main_target_pace ?? undefined}
                                  hrTarget={ev.main_heart_rate_target ?? undefined}
                                  coachCue={ev.main_beginner_explanation ?? undefined}
                                />
                              )}
                              {(ev.cooldown_distance_km != null || ev.cooldown_beginner_explanation) && (
                                <InlinePhaseRow
                                  icon={<Wind className="w-3 h-3 text-accent" />}
                                  label="Schłodzenie"
                                  accentColor="var(--color-accent)"
                                  distKm={ev.cooldown_distance_km}
                                  pace={ev.cooldown_exact_pace ?? undefined}
                                  hrTarget={ev.cooldown_heart_rate_target ?? undefined}
                                  coachCue={ev.cooldown_beginner_explanation ?? undefined}
                                />
                              )}
                              {ev.trainer_notes && (
                                <div
                                className="rounded-[2px] border px-2.5 py-2 flex gap-2 items-start"
                                style={{
                                  background: 'var(--color-surface-overlay)',
                                  borderColor: 'var(--color-border)',
                                }}
                              >
                                  <BrainCircuit className="w-3 h-3 shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
                                  <p className="m-0 text-[10px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{ev.trainer_notes}</p>
                                </div>
                              )}
                            </div>
                          ) : (
                            ev.description
                              ? <p className="text-[10px] text-secondary leading-relaxed m-0">{ev.description}</p>
                              : null
                          )}

                          {/* Strava actions */}
                          {ev.is_completed && (
                            <div className="pt-1.5 border-t border-border/20 flex items-center gap-2">
                              {onRequestAnalysis && (
                                <button
                                  onClick={() => {
                                    const stravaId = typeof ev.id === 'string' ? parseInt(ev.id.replace('strava-', ''), 10) : Number(ev.id);
                                    if (!isNaN(stravaId)) onRequestAnalysis(stravaId, ev.label);
                                  }}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                                  style={{
                                    background: 'rgba(168,85,247,0.1)',
                                    border: '1px solid rgba(168,85,247,0.25)',
                                    color: '#a855f7',
                                  }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(168,85,247,0.18)'; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(168,85,247,0.1)'; }}
                                >
                                  <Sparkles className="w-3 h-3" />
                                  Analiza
                                </button>
                              )}
                              <SaveRouteWidget
                                defaultName={ev.label}
                                size="xs"
                                onSave={async (name) => {
                                  const stravaId = typeof ev.id === 'string' ? parseInt(ev.id.replace('strava-', ''), 10) : ev.id;
                                  if (isNaN(stravaId)) return false;
                                  try {
                                    const res = await fetch(`${API}/api/routes/save-from-strava`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        user_id: user?.user_id,
                                        strava_activity_id: stravaId,
                                        name: name || ev.label,
                                      }),
                                    });
                                    if (res.ok) {
                                      showToast('success', `Zapisano trasę: ${name || ev.label}`);
                                      return true;
                                    }
                                  } catch {}
                                  return false;
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* ── Wygeneruj nowy plan — przyklejony na dole ── */}
          <div className="shrink-0 pt-2 border-t border-border/30">
            <div className="flex gap-2">
              <button
                id="btn-kasia-generate-plan"
                disabled={isGenerating}
                onClick={() => setShowPlanModal(true)}
                className="btn-lime flex-1 h-9 py-0 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    KASIA MYŚLI...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    Wygeneruj nowy plan
                  </>
                )}
              </button>
              <button
                id="btn-delete-all-plans"
                disabled={planCount === 0}
                onClick={handleDeleteAllPlans}
                className="w-9 h-9 shrink-0 flex items-center justify-center border border-danger/20 text-danger hover:border-danger hover:bg-danger/10 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-danger/20 disabled:cursor-not-allowed rounded-[var(--radius)] transition-colors cursor-pointer bg-transparent"
                title="Usuń wszystkie plany"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[9px] text-muted text-center mt-1.5 mb-0">
              Wygenerowanie nowego planu usunie poprzedni.
            </p>
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
            <h3 className="label-mono flex items-center gap-2 m-0 text-secondary">
              <Target className="w-4 h-4 text-accent" />
              Cele startowe
            </h3>
            <button
              onClick={() => setShowGoalForm(!showGoalForm)}
              className="text-[10px] font-bold flex items-center gap-1 transition-opacity hover:opacity-70 text-accent bg-transparent border-none cursor-pointer p-0"
            >
              <Plus className="w-3 h-3" /> Dodaj cel
            </button>
          </div>

          {/* Goal form */}
          {showGoalForm && (
            <form
              onSubmit={handleCreateGoal}
              className="flex flex-col gap-2 p-3 card-sporty animate-in fade-in slide-in-from-top-2"
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
              <input value={goalTime} onChange={e => setGoalTime(e.target.value)} placeholder="Cel czasowy: 1:45:00" className="input-base font-mono-custom" />
              <button
                type="submit"
                className="btn-lime w-full py-2.5 mt-1"
              >
                Zapisz cel
              </button>
            </form>
          )}

          {/* Goal list */}
          {goals.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted border border-dashed border-border/50 bg-black/10 rounded-[2px]">
              Brak celów — dodaj swój pierwszy start!
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {goals.map(g => (
                <div key={g.id} className="card-sporty p-3 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="m-0 text-sm font-bold text-primary truncate">{g.title}</p>
                      <div className="flex items-center flex-wrap gap-2.5 mt-1.5 text-[10px] text-muted font-mono-custom">
                        <span className="flex items-center gap-1"><CalendarIcon className="w-3 h-3" /> {g.race_date}</span>
                        {g.distance_km && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {g.distance_km} km</span>}
                        {g.target_time && <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {g.target_time}</span>}
                      </div>
                    </div>
                    <div className={`badge ${g.days_left <= 7 ? 'badge-danger' : g.days_left <= 30 ? 'badge-warning' : 'badge-lime'}`}>
                      {g.days_left > 0 ? `za ${g.days_left} dni` : 'Dziś!'}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
                    <button
                      onClick={() => handleGeneratePlan(g.id)}
                      disabled={generating === g.id}
                      className="flex-1 btn-ghost border-accent/20 bg-accent-subtle text-accent hover:border-accent hover:bg-accent/20 py-1.5 text-[11px]"
                    >
                      {generating === g.id
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Generuję…</>
                        : <><Sparkles className="w-3 h-3" /> Wygeneruj plan z Kasią</>
                      }
                    </button>
                    <button
                      onClick={() => handleDeleteGoal(g.id)}
                      className="btn-ghost px-2 text-muted border-transparent hover:text-danger hover:border-danger/30 hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                      aria-label="Usuń cel"
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
            <div className="card-sporty p-3 mt-2 bg-accent-subtle border-accent/30 text-sm text-primary whitespace-pre-wrap">
              <p className="label-mono text-accent mb-2">
                Plan od Kasi
              </p>
              {kasiaMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
