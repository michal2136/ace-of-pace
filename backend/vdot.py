"""
vdot.py — Jack Daniels VDOT Pace Calculator
============================================
Derives mathematically precise training zones from any race performance
(typically a 5 km personal best).

References
----------
- Daniels & Gilbert (1979) regression equations
- Jack Daniels, "Daniels' Running Formula" (3rd ed., 2014)

Public API
----------
    zones = zones_from_5k(pb_seconds=1470)   # e.g. 24:30 → 1470 s
    block  = zones_to_prompt_block(zones)     # ready-to-inject prompt section
"""

from __future__ import annotations
import math
from dataclasses import dataclass


# ─────────────────────────────────────────────────────────────────────────────
# Data class
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TrainingZones:
    """All Daniels training zones derived from a single VDOT value."""
    vdot:        float   # VO2max proxy (mL/kg/min)
    easy_slow:   str     # slowest easy pace  (min:sec/km)
    easy_fast:   str     # fastest easy pace  (min:sec/km)
    marathon:    str     # marathon pace       (min:sec/km)
    tempo_slow:  str     # slowest tempo pace  (min:sec/km)
    tempo_fast:  str     # fastest tempo pace  (min:sec/km)
    interval:    str     # interval pace       (min:sec/km)
    repetition:  str     # repetition pace     (min:sec/km)


# ─────────────────────────────────────────────────────────────────────────────
# Core maths
# ─────────────────────────────────────────────────────────────────────────────

def _vdot(distance_m: float, time_sec: float) -> float:
    """
    Daniels-Gilbert VDOT from a race result.

    Args:
        distance_m: distance in metres  (e.g. 5000 for 5 km)
        time_sec:   finish time in seconds
    Returns:
        VDOT value
    """
    t = time_sec / 60.0        # minutes
    v = distance_m / t         # m/min

    vo2 = -4.6 + 0.182258 * v + 0.000104 * v ** 2
    pct = (
        0.8
        + 0.1894393 * math.exp(-0.012778  * t)
        + 0.2989558 * math.exp(-0.1932605 * t)
    )
    return vo2 / pct


def _velocity_at(vdot: float, pct_vo2max: float) -> float:
    """
    Running velocity (m/min) at *pct_vo2max* fraction of VO2max.

    Solves:  0.000104·v² + 0.182258·v − (4.6 + pct·VDOT) = 0
    """
    a =  0.000104
    b =  0.182258
    c = -(4.6 + pct_vo2max * vdot)
    return (-b + math.sqrt(b ** 2 - 4 * a * c)) / (2 * a)


def _sec_km(v_m_per_min: float) -> int:
    """Velocity m/min → integer seconds-per-km."""
    return int(round(60_000.0 / v_m_per_min))


def _fmt(sec_per_km: int) -> str:
    """Seconds-per-km → 'M:SS/km' string."""
    m, s = divmod(sec_per_km, 60)
    return f"{m}:{s:02d}/km"


# ─────────────────────────────────────────────────────────────────────────────
# Intensity targets (% VO2max) — from Daniels' tables
# ─────────────────────────────────────────────────────────────────────────────

_PCT = {
    "easy_slow":  0.59,   # lower bound of easy / recovery
    "easy_fast":  0.74,   # upper bound of easy
    "marathon":   0.80,   # marathon race pace
    "tempo_slow": 0.83,   # threshold / cruise interval lower bound
    "tempo_fast": 0.88,   # threshold upper bound
    "interval":   0.975,  # ~5 km race effort (I-pace)
    "repetition": 1.10,   # fast turnover / R-pace
}


# ─────────────────────────────────────────────────────────────────────────────
# Public functions
# ─────────────────────────────────────────────────────────────────────────────

def zones_from_5k(pb_seconds: float) -> TrainingZones:
    """
    Calculate all Daniels training zones from a 5 km personal best.

    Args:
        pb_seconds: 5 km finish time in **seconds**  (e.g. 1470 for 24:30)

    Returns:
        TrainingZones dataclass with formatted pace strings
    """
    if pb_seconds <= 0:
        raise ValueError("pb_seconds must be positive")

    vdot_val = _vdot(5_000.0, pb_seconds)

    def _pace(key: str) -> str:
        return _fmt(_sec_km(_velocity_at(vdot_val, _PCT[key])))

    return TrainingZones(
        vdot       = round(vdot_val, 1),
        easy_slow  = _pace("easy_slow"),
        easy_fast  = _pace("easy_fast"),
        marathon   = _pace("marathon"),
        tempo_slow = _pace("tempo_slow"),
        tempo_fast = _pace("tempo_fast"),
        interval   = _pace("interval"),
        repetition = _pace("repetition"),
    )


@dataclass(frozen=True)
class PaceDictionary:
    """
    Ready-to-use pace strings for every workout phase.
    These values are copied verbatim into the target_pace JSON field —
    no interpretation, no rounding, no prose.
    """
    # ── Warmup & Cooldown ────────────────────────────────────────────────────
    warmup_cooldown: str     # e.g. "6:10–7:06/km"  ← Easy zone bounds

    # ── Main phase per workout type ─────────────────────────────────────────
    easy_run:        str     # e.g. "5:56–6:10/km"  ← Easy fast bound
    long_run:        str     # same as easy (aerobic)
    marathon_pace:   str     # e.g. "5:25/km"
    tempo_run:       str     # e.g. "4:58–5:10/km"  ← Tempo zone
    interval:        str     # e.g. "4:33/km"        ← I-pace (single value)
    repetition:      str     # e.g. "4:05/km"        ← R-pace

    # ── HR zone labels (parallel) ───────────────────────────────────────────
    hr_easy:         str     # "Z1-Z2 (60–74 % HRmax)"
    hr_tempo:        str     # "Z4 (83–88 % HRmax)"
    hr_interval:     str     # "Z5 (~97.5 % VO2max)"


def build_pace_dictionary(z: TrainingZones) -> PaceDictionary:
    """
    Convert a TrainingZones into a PaceDictionary.
    The warmup/cooldown pace = easy_slow (conservative end of easy zone).
    """
    return PaceDictionary(
        warmup_cooldown = f"{z.easy_fast}–{z.easy_slow}",
        easy_run        = f"{z.easy_fast}–{z.easy_slow}",
        long_run        = f"{z.easy_fast}–{z.easy_slow}",
        marathon_pace   = z.marathon,
        tempo_run       = f"{z.tempo_slow}–{z.tempo_fast}",
        interval        = z.interval,
        repetition      = z.repetition,
        hr_easy         = "Z1-Z2 (60–74 % HRmax)",
        hr_tempo        = "Z4 (83–88 % HRmax)",
        hr_interval     = "Z5 (~97.5 % VO2max)",
    )


def pace_dict_to_prompt_block(pd: PaceDictionary, vdot: float) -> str:
    """
    Build the CRITICAL PACE DIRECTIVE block injected into the Gemini system
    prompt.  Uses imperative, unambiguous language with a hard FORBIDDEN list.
    """
    return f"""
═══════════════════════════════════════════════════════════════════
SŁOWNIK TEMP UŻYTKOWNIKA — MATEMATYCZNIE WYLICZONE, BEZWZGLĘDNIE OBOWIĄZKOWE
VDOT = {vdot} (z rekordu 5 km)
═══════════════════════════════════════════════════════════════════

Dla KAŻDEGO pola "target_pace" w JSON użyj WYŁĄCZNIE wartości z tej tabeli:

  Rozgrzewka / Schłodzenie → "{pd.warmup_cooldown}"
  Easy Run / Long Run       → "{pd.easy_run}"
  Marathon Pace             → "{pd.marathon_pace}"
  Tempo Run / Threshold     → "{pd.tempo_run}"
  Interwały (I-pace)        → "{pd.interval}"
  Repetition (R-pace)       → "{pd.repetition}"

KRYTYCZNA ZASADA FORMATOWANIA target_pace:
  ✅ DOZWOLONE:  "5:00–5:10/km",  "4:33/km",  "6:10–7:06/km"
  ❌ ZAKAZANE:   "tempo progowe", "trucht", "spokojnie", "żwawo",
                 "umiarkowane", "szybko", "łagodnie", jakiekolwiek
                 przymiotniki lub opisy słowne.

INSTRUKCJA BEZWZGLĘDNA:
  - Skopiuj dokładną wartość z tabeli powyżej — nie zaokrąglaj, nie opisuj.
  - Pole target_pace MUSI zawierać tylko cyfry, dwukropki i ukośnik "/km".
  - Dla dni wolnych (is_rest_day: true) target_pace = null.
═══════════════════════════════════════════════════════════════════
"""


def zones_to_prompt_block(z: TrainingZones) -> str:
    """
    Legacy prompt block (VDOT table format).
    Kept for backward compatibility — prefer pace_dict_to_prompt_block().
    """
    pd = build_pace_dictionary(z)
    return pace_dict_to_prompt_block(pd, z.vdot)


def parse_mmss(mmss: str) -> float:
    """
    Parse a 'MM:SS' time string into total seconds.

    Args:
        mmss: string like '24:30'
    Returns:
        total seconds as float
    Raises:
        ValueError on invalid format
    """
    parts = mmss.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Expected MM:SS format, got: '{mmss}'")
    minutes, seconds = int(parts[0]), int(parts[1])
    if seconds >= 60:
        raise ValueError(f"Seconds must be < 60, got {seconds}")
    return float(minutes * 60 + seconds)
