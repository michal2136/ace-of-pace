"""
routers/calendar.py — Zunifikowany widok kalendarza treningowego.

GET  /api/calendar/full-view     — agreguje aktywności Strava + plany Kasi
POST /api/calendar/generate-plan — Structured Output: Gemini → JSON → TrainingPlan DB
"""

import os
import json
import time
import logging
from datetime import date as Date, datetime, timedelta
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from database import get_session
from models import TrainingPlan, StravaTokens, User
from vdot import (
    zones_from_5k, zones_to_prompt_block, parse_mmss,
    build_pace_dictionary, pace_dict_to_prompt_block, PaceDictionary,
)

load_dotenv()
logger = logging.getLogger(__name__)

router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# Stałe Gemini
# ─────────────────────────────────────────────────────────────────────────────

_GEMINI_STRUCTURED_MODEL = "gemini-2.5-flash-lite"
_GEMINI_STRUCTURED_URL_TPL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent?key={key}"
)

# JSON Schema wymuszony na poziomie Gemini API
# ROOT = object z kluczem "days" — Gemini nie potrafi wygenerować
# pełnej tablicy gdy root schema to "type": "array".
#
# v6: Używamy "type": "string" dla distance_km / pace / HR
#     Eliminuje błędy parsowania float gdy model wstawi "5.0 km" zamiast 5.0
_PLAN_RESPONSE_SCHEMA = {
    "type": "object",
    "required": ["days"],
    "properties": {
        "days": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["date", "is_rest_day", "title", "warmup", "main_phase", "cooldown"],
                "properties": {
                    "date":         {"type": "string", "description": "YYYY-MM-DD"},
                    "is_rest_day":  {"type": "boolean"},
                    "title":        {"type": "string"},
                    "trainer_notes":{"type": "string"},
                    "warmup": {
                        "type": "object",
                        "nullable": True,
                        "properties": {
                            "distance_km":    {"type": "string"},
                            "target_pace":    {"type": "string"},
                            "heart_rate_zone":{"type": "string"},
                            "instructions":   {"type": "string"},
                        },
                    },
                    "main_phase": {
                        "type": "object",
                        "nullable": True,
                        "properties": {
                            "distance_km":    {"type": "string"},
                            "target_pace":    {"type": "string"},
                            "heart_rate_zone":{"type": "string"},
                            "instructions":   {"type": "string"},
                        },
                    },
                    "cooldown": {
                        "type": "object",
                        "nullable": True,
                        "properties": {
                            "distance_km":    {"type": "string"},
                            "target_pace":    {"type": "string"},
                            "heart_rate_zone":{"type": "string"},
                            "instructions":   {"type": "string"},
                        },
                    },
                },
            },
        },
    },
}



# ─────────────────────────────────────────────────────────────────────────────
# Schematy Pydantic — silne typowanie kontraktu API
# ─────────────────────────────────────────────────────────────────────────────

class CalendarEvent(BaseModel):
    """Unified event — może być ukończonym treningiem lub zaplanowanym.\n
    Discriminator: ``is_completed`` (True = Strava, False = Kasia/plan)
    """
    id: str = Field(
        description="Unikalny identyfikator — prefixowany: 'strava-<id>' lub 'plan-<id>'"
    )
    date: Date = Field(description="Data aktywności (YYYY-MM-DD)")
    label: str = Field(description="Nazwa treningu lub typ planu")
    is_completed: bool = Field(
        description="True = aktywność ukończona (Strava), False = zaplanowana (Kasia)"
    )
    source: str = Field(description="'strava' | 'kasia'")
    type: Optional[str] = Field(default=None)
    distance_km:     Optional[float] = Field(default=None)
    description:     Optional[str]   = Field(default=None)
    goal_id:         Optional[int]   = Field(default=None)
    # Legacy v2
    target_pace:     Optional[str]   = Field(default=None)
    heart_rate_zone: Optional[str]   = Field(default=None)
    # v3 — is_rest + fazy
    is_rest_day:                 bool            = Field(default=False)
    trainer_notes:               Optional[str]   = Field(default=None)
    # Rozgrzewka
    warmup_distance_km:          Optional[float] = Field(default=None)
    warmup_exact_pace:           Optional[str]   = Field(default=None)
    warmup_heart_rate_target:    Optional[str]   = Field(default=None)
    warmup_beginner_explanation: Optional[str]   = Field(default=None)
    warmup_description:          Optional[str]   = Field(default=None)
    # Część główna
    main_distance_km:            Optional[float] = Field(default=None)
    main_exact_pace:             Optional[str]   = Field(default=None)
    main_heart_rate_target:      Optional[str]   = Field(default=None)
    main_beginner_explanation:   Optional[str]   = Field(default=None)
    main_target_pace:            Optional[str]   = Field(default=None)
    main_description:            Optional[str]   = Field(default=None)
    # Schłodzenie
    cooldown_distance_km:            Optional[float] = Field(default=None)
    cooldown_exact_pace:             Optional[str]   = Field(default=None)
    cooldown_heart_rate_target:      Optional[str]   = Field(default=None)
    cooldown_beginner_explanation:   Optional[str]   = Field(default=None)
    cooldown_description:            Optional[str]   = Field(default=None)


class FullCalendarViewResponse(BaseModel):
    """Odpowiedź zagregowana — posortowana lista eventów."""
    events: List[CalendarEvent]
    total: int
    date_from: Date
    date_to: Date
    strava_count: int
    plan_count: int


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


STRAVA_CLIENT_ID     = os.getenv("STRAVA_CLIENT_ID")
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET")


async def _get_valid_strava_token(user_id: int, session: Session) -> Optional[str]:
    """
    Pobiera i ewentualnie odświeża access token Stravy.
    Zwraca None jeśli konto nie jest połączone (nie rzuca wyjątku — obsługujemy gracefully).
    """
    tokens = session.exec(
        select(StravaTokens).where(StravaTokens.user_id == user_id)
    ).first()

    if not tokens:
        return None

    # Refresh z 60s buforem
    if tokens.expires_at - 60 < int(time.time()):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    "https://www.strava.com/oauth/token",
                    data={
                        "client_id":     STRAVA_CLIENT_ID,
                        "client_secret": STRAVA_CLIENT_SECRET,
                        "grant_type":    "refresh_token",
                        "refresh_token": tokens.refresh_token,
                    },
                )
            if resp.status_code != 200:
                logger.warning(
                    "Nie udało się odświeżyć tokena Strava dla user_id=%d: HTTP %d",
                    user_id, resp.status_code
                )
                return None
            data = resp.json()
            tokens.access_token  = data["access_token"]
            tokens.refresh_token = data["refresh_token"]
            tokens.expires_at    = data["expires_at"]
            session.add(tokens)
            session.commit()
        except Exception as exc:
            logger.warning("Błąd refreshu tokena Strava: %s", exc)
            return None

    return tokens.access_token


async def _fetch_strava_events(
    user_id: int,
    session: Session,
    date_from: Date,
    date_to: Date,
) -> List[CalendarEvent]:
    """
    Pobiera aktywności Strava z okna czasowego [date_from, date_to].
    Używa parametrów after/before API Stravy dla precyzyjnego filtrowania.
    Zwraca pustą listę przy braku połączenia lub błędzie sieci — nigdy nie rzuca.
    """
    import datetime

    access_token = await _get_valid_strava_token(user_id, session)
    if not access_token:
        return []

    # Strava API przyjmuje Unix timestamp
    after_ts  = int(datetime.datetime.combine(date_from, datetime.time.min).timestamp())
    before_ts = int(datetime.datetime.combine(date_to,   datetime.time.max).timestamp())

    events: List[CalendarEvent] = []

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://www.strava.com/api/v3/athlete/activities",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "after":    after_ts,
                    "before":   before_ts,
                    "per_page": 200,   # max per Strava API
                    "page":     1,
                },
            )

        if resp.status_code != 200:
            logger.warning(
                "Strava /athlete/activities zwróciło HTTP %d dla user_id=%d",
                resp.status_code, user_id
            )
            return []

        for act in resp.json():
            # Filtrujemy tylko aktywności biegowe (Run, TrailRun, VirtualRun)
            act_type = act.get("type", "")
            if "run" not in act_type.lower():
                continue

            activity_date_str = act.get("start_date_local", "")[:10]
            try:
                activity_date = Date.fromisoformat(activity_date_str)
            except ValueError:
                continue

            distance_km = round(act.get("distance", 0) / 1000, 2)

            events.append(CalendarEvent(
                id           = f"strava-{act['id']}",
                date         = activity_date,
                label        = act.get("name", "Trening"),
                is_completed = True,
                source       = "strava",
                type         = act.get("type"),
                distance_km  = distance_km if distance_km > 0 else None,
                description  = None,
                goal_id      = None,
                is_rest_day  = False,
            ))

    except Exception as exc:
        logger.warning("Błąd pobierania aktywności Strava: %s", exc)

    return events


def _fetch_plan_events(
    user_id: int,
    session: Session,
    date_from: Date,
    date_to: Date,
) -> List[CalendarEvent]:
    """
    Pobiera plany treningowe z tabeli training_plans dla okna [date_from, date_to].
    Zawsze synchroniczne — dane są lokalne.
    """
    plans = session.exec(
        select(TrainingPlan).where(
            TrainingPlan.user_id  == user_id,
            TrainingPlan.plan_date >= date_from,
            TrainingPlan.plan_date <= date_to,
        )
    ).all()

    return [
        CalendarEvent(
            id           = f"plan-{p.id}",
            date         = p.plan_date,
            label        = p.type,
            is_completed = False,
            source       = "kasia",
            type         = p.type,
            distance_km  = p.distance_km,
            description  = p.description,
            goal_id      = p.goal_id,
            target_pace     = p.target_pace,
            heart_rate_zone = p.heart_rate_zone,
            is_rest_day   = p.is_rest_day,
            trainer_notes = p.trainer_notes,
            # Rozgrzewka
            warmup_distance_km          = p.warmup_distance_km,
            warmup_exact_pace           = p.warmup_exact_pace,
            warmup_heart_rate_target    = p.warmup_heart_rate_target,
            warmup_beginner_explanation = p.warmup_beginner_explanation,
            warmup_description          = p.warmup_description,
            # Główna
            main_distance_km            = p.main_distance_km,
            main_exact_pace             = p.main_exact_pace,
            main_heart_rate_target      = p.main_heart_rate_target,
            main_beginner_explanation   = p.main_beginner_explanation,
            main_target_pace            = p.main_target_pace,
            main_description            = p.main_description,
            # Schłodzenie
            cooldown_distance_km            = p.cooldown_distance_km,
            cooldown_exact_pace             = p.cooldown_exact_pace,
            cooldown_heart_rate_target      = p.cooldown_heart_rate_target,
            cooldown_beginner_explanation   = p.cooldown_beginner_explanation,
            cooldown_description            = p.cooldown_description,
        )
        for p in plans
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Structured Output v2 — RAG + System Prompt + Gemini → JSON → DB
# ─────────────────────────────────────────────────────────────────────────────

class GeneratePlanRequest(BaseModel):
    """
    Payload od frontendu (PlanConfigModal — 2-step wizard).

    Pola:
    - extra_notes      : zmontowane preferencje (cel, dni, dni wolne) jako tekst
    - pb_5k_mmss       : aktualny rekord 5 km (MANDATORY w nowym UI) — kalkulator VDOT
    - target_time_mmss : cel wynikowy w formacie MM:SS (opcjonalny), np. '50:00' na 10km
    """
    user_id:          int           = Field(..., ge=1, description="ID użytkownika")
    goal_id:          Optional[int] = Field(default=None, description="Opcjonalne ID celu startowego")
    weeks:            int           = Field(default=2, ge=1, le=8, description="Liczba tygodni planu")
    extra_notes:      Optional[str] = Field(default=None, max_length=1000, description="Cel, dni treningowe, dni wolne")
    pb_5k_mmss:       Optional[str] = Field(
        default=None,
        max_length=8,
        description="Aktualny rekord 5 km w formacie MM:SS. Używany do kalkulacji VDOT (Daniels).",
    )
    target_time_mmss: Optional[str] = Field(
        default=None,
        max_length=10,
        description="Cel wynikowy w formacie MM:SS, np. '50:00' na 10 km.",
    )


# ─── Pydantic v6 — "Matematyczny Silnik" ─────────────────────────────────────
# str zamiast float — eliminuje błędy parsowania gdy model wstawi "5.0 km".
# Optional fazy — model nie wywala błędu w dni wolne.

class WorkoutPhase(BaseModel):
    """Pojedyncza faza treningu. Wszystkie pola Optional."""
    distance_km:     Optional[str] = None
    target_pace:     Optional[str] = None
    heart_rate_zone: Optional[str] = None
    instructions:    Optional[str] = None


class DailyWorkout(BaseModel):
    """Jeden dzień treningowy. Optional fazy — null dla dni wolnych."""
    date:          str
    is_rest_day:   bool
    title:         str
    warmup:        Optional[WorkoutPhase] = None
    main_phase:    Optional[WorkoutPhase] = None
    cooldown:      Optional[WorkoutPhase] = None
    trainer_notes: Optional[str]          = None

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        try:
            datetime.strptime(v.strip(), "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"Nieprawidłowy format daty: '{v}'.")
        return v.strip()


class TrainingPlanPayload(BaseModel):
    """Opakowanie odpowiedzi Gemini."""
    days: List[DailyWorkout]


class GeneratePlanResponse(BaseModel):
    """Odpowiedź endpointu generate-plan."""
    plans_created: int
    plans:         List[dict]
    message:       str


async def _call_gemini_structured(prompt: str) -> list:
    """
    Wywołuje Gemini API z wymuszonym formatem JSON + response_schema.
    Retry 3x z backoff (3s, 7s). Na 2. próbie przełącza na gemini-2.5-flash.
    """
    load_dotenv(override=True)
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Brak klucza GEMINI_API_KEY — nie można wywołać AI."
        )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema":    _PLAN_RESPONSE_SCHEMA,
            "temperature":        0.2,
            "maxOutputTokens":    8192,
        },
    }

    RETRY_STATUSES = {429, 500, 503}
    FALLBACK_MODEL = "gemini-2.5-flash"
    RETRY_DELAYS   = [3, 7]

    last_status = None
    resp = None

    for attempt in range(3):
        model_now = _GEMINI_STRUCTURED_MODEL if attempt == 0 else FALLBACK_MODEL
        url_now   = _GEMINI_STRUCTURED_URL_TPL.format(model=model_now, key=api_key)

        if attempt > 0:
            logger.warning(
                "[generate-plan] Próba #%d — model=%s (poprzedni HTTP %s)",
                attempt + 1, model_now, last_status,
            )
            await asyncio.sleep(RETRY_DELAYS[attempt - 1])

        logger.info("[generate-plan] Gemini model=%s attempt=%d", model_now, attempt + 1)

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    url_now, json=payload,
                    headers={"Content-Type": "application/json"},
                )
        except httpx.TimeoutException:
            last_status = 504
            logger.warning("[generate-plan] Timeout przy próbie #%d", attempt + 1)
            if attempt < 2:
                continue
            raise HTTPException(status_code=504, detail="Gemini API nie odpowiedział w czasie.")
        except Exception as exc:
            last_status = 503
            logger.warning("[generate-plan] Błąd sieci przy próbie #%d: %s", attempt + 1, exc)
            if attempt < 2:
                continue
            raise HTTPException(status_code=503, detail=f"Błąd połączenia z Gemini: {exc}")

        last_status = resp.status_code

        if resp.status_code == 200:
            break

        if resp.status_code in RETRY_STATUSES and attempt < 2:
            logger.warning(
                "[generate-plan] Gemini HTTP %d przy próbie #%d — retry za %ds",
                resp.status_code, attempt + 1, RETRY_DELAYS[attempt],
            )
            continue

        if resp.status_code == 429:
            raise HTTPException(status_code=429, detail="Przekroczono limit zapytań Gemini. Odczekaj chwilę.")
        raise HTTPException(
            status_code=502,
            detail=f"Gemini API zwróciło błąd HTTP {resp.status_code} po 3 próbach.",
        )

    try:
        raw_text: str = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict) and "days" in parsed:
            items = parsed["days"]
        elif isinstance(parsed, list):
            items = parsed
        else:
            raise ValueError(f"Nieoczekiwana struktura odpowiedzi: {type(parsed).__name__}")
        if not isinstance(items, list):
            raise ValueError("Pole 'days' nie jest tablicą.")
        logger.info("[generate-plan] Gemini zwrócił %d elementów planu.", len(items))
        return items
    except (KeyError, IndexError, json.JSONDecodeError, ValueError) as exc:
        logger.error("[generate-plan] Błąd parsowania JSON: %s | raw=%s", exc, resp.text[:400])
        raise HTTPException(
            status_code=502,
            detail=f"Gemini zwrócił nieprawidłowy JSON: {exc}"
        )



# RAG Helper v2 — 30 dni Strava + średnie tempo + tętno
# ─────────────────────────────────────────────────────────────────────────────

async def _build_strava_context(user_id: int, session: Session) -> str:
    """
    Pobiera aktywności biegowe z Strava API z ostatnich 30 dni.
    Oblicza:
    - średną prędkość spokojnych biegów (all runs → min/km)
    - średnie tętno (jeśli dostępne)
    Zwraca szczegółowy tekst kontekstowy dla system promptu Gemini.
    Przy braku połączenia lub błędzie sieci zwraca pusty string — nigdy nie rzuca.
    """
    import datetime as dt
    import math

    access_token = await _get_valid_strava_token(user_id, session)
    if not access_token:
        return ""

    today    = dt.date.today()
    cutoff   = today - dt.timedelta(days=30)   # 30 dni (było 14)
    after_ts = int(dt.datetime.combine(cutoff, dt.time.min).timestamp())

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://www.strava.com/api/v3/athlete/activities",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"after": after_ts, "per_page": 50, "page": 1},
            )
        if resp.status_code != 200:
            logger.warning("[RAG] Strava HTTP %d dla user_id=%d", resp.status_code, user_id)
            return ""

        acts = [a for a in resp.json() if "run" in a.get("type", "").lower()]
        if not acts:
            return "Brak danych biegowych z ostatnich 30 dni."

        # — statystyki zbiorcze
        total_km   = sum(a.get("distance", 0) for a in acts) / 1000
        longest_km = max(a.get("distance", 0) for a in acts) / 1000
        speeds     = [a["average_speed"] for a in acts if a.get("average_speed", 0) > 0]
        hr_list    = [a["average_heartrate"] for a in acts if a.get("average_heartrate")]

        lines = [
            f"Treningi (30 dni): {len(acts)} sesji biegowych, łącznie {total_km:.1f} km.",
            f"Najdłuższy bieg: {longest_km:.1f} km.",
        ]

        # — średnie tempo (m/s → min/km)
        avg_easy_pace_str = None
        if speeds:
            avg_ms   = sum(speeds) / len(speeds)
            secs_km  = int(round(1000 / avg_ms))
            m, s     = divmod(secs_km, 60)
            avg_easy_pace_str = f"{m}:{s:02d} min/km"
            lines.append(f"średnie tempo wszystkich biegów: {avg_easy_pace_str}.")

        # — średnie tętno
        avg_hr_str = None
        if hr_list:
            avg_hr     = int(round(sum(hr_list) / len(hr_list)))
            avg_hr_str = f"{avg_hr} bpm"
            lines.append(f"średnie tętno: {avg_hr_str}.")

        # — 3 ostatnie sesje
        recent = acts[:3]
        if recent:
            details = [
                f"  - {a.get('start_date_local','')[:10]}: "
                f"{a.get('name','Trening')} ({a.get('distance',0)/1000:.1f} km)"
                for a in recent
            ]
            lines.append("Ostatnie treningi:\n" + "\n".join(details))

        context = " ".join(lines)

        # — Spersonalizowana dyrektywa
        personalized = "\n\nKONTEKST UŻYTKOWNIKA (na podstawie Strava):\n"
        if avg_easy_pace_str:
            personalized += (
                f"Jego naturalne, spokojne tempo biegania to około {avg_easy_pace_str}. "
            )
        if avg_hr_str:
            personalized += (
                f"Przy tym wysiłku jego średnie tętno wynosi {avg_hr_str}. "
            )
        personalized += (
            "ZASADA KRYTYCZNA: Używaj TYŁKO tych wyliczonych wartości liczbowych. "
            "ZABRANIASZ sobie używania: 'tempo progowe', 'BNP', 'interwał anaerobowy', "
            "'strefy tętna', 'V02max', 'bieg w tętnie X', ani żadnego innego żargomu sportowego. "
            "Zamiast tego używaj prostego języka: 'bieg, podczas którego możesz swobodnie mówić', "
            "'możesz tylko krótkie zdania', 'oddech trudny, mówienie niemożliwe'."
        )

        return context + personalized

    except Exception as exc:
        logger.warning("[RAG] Błąd pobierania danych Strava: %s", exc)
        return ""

@router.post(
    "/generate-plan",
    response_model=GeneratePlanResponse,
    status_code=200,
    summary="Generuj plan treningowy — VDOT + RAG + Structured AI Output v3",
    description=(
        "Oblicza matematyczne strefy tempa z 5k PB (VDOT Danielsa), "
        "pobiera kontekst Strava (RAG), buduje system prompt z twardymi ograniczeniami "
        "i generuje plan przez Gemini Structured Output."
    ),
    responses={
        200: {"description": "Plan wygenerowany i zapisany do bazy"},
        404: {"description": "Użytkownik nie istnieje"},
        429: {"description": "Przekroczono limit Gemini API"},
        502: {"description": "Gemini zwrócił nieprawidłową odpowiedź"},
        503: {"description": "Brak klucza API lub problem z połączeniem"},
        504: {"description": "Timeout Gemini API"},
    },
)
async def generate_plan(
    req: GeneratePlanRequest,
    session: Session = Depends(get_session),
) -> GeneratePlanResponse:
    """
    Generuje plan treningowy używając VDOT + RAG + Gemini Structured Output.

    Przepływ:
    1. Waliduje istnienie użytkownika w DB.
    2. RAG — pobiera ostatnie 14 dni treningów ze Strava i buduje kontekst.
    2.5. VDOT — jeśli użytkownik podał 5k PB, oblicza PaceDictionary
         z matematycznie precyzyjnymi tempami (Daniels).
    3. Buduje System Prompt ze Słownikiem Temp i zakazem halucynacji prozy.
    4. Wywołuje Gemini Structured Output z wymuszonym JSON.
    5. Waliduje każdy rekord przez Pydantic.
    6. Atomowo zapisuje do TrainingPlan.
    7. Zwraca 200 z potwierdzeniem.
    """

    # 1. Walidacja użytkownika
    user = session.get(User, req.user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"Użytkownik id={req.user_id} nie istnieje.")

    # 2. RAG — personalizowany kontekst z 30 dni Strava
    strava_context = await _build_strava_context(req.user_id, session)

    # Wyciągamy surowe wartości liczbowe z kontekstu Strava do wstrzyknięcia w prompt
    avg_pace_str = "6:00"   # fallback jeśli brak Strava
    avg_hr_str   = "145"    # fallback
    if strava_context:
        import re
        pm = re.search(r"(\d{1,2}:\d{2}) min/km", strava_context)
        hm = re.search(r"średnie tętno: (\d+) bpm", strava_context)
        if pm: avg_pace_str = pm.group(1)
        if hm: avg_hr_str   = hm.group(1)

    # 2.5. VDOT — matematyczne strefy tempa z 5k PB (jeśli podano)
    vdot_section = ""
    pace_dict: Optional[PaceDictionary] = None
    zones = None
    if req.pb_5k_mmss:
        try:
            pb_sec    = parse_mmss(req.pb_5k_mmss)
            zones     = zones_from_5k(pb_sec)
            pace_dict = build_pace_dictionary(zones)
            vdot_section = pace_dict_to_prompt_block(pace_dict, zones.vdot)
            logger.info(
                "[generate-plan] VDOT=%s dla user_id=%d (5k PB=%s)",
                zones.vdot, req.user_id, req.pb_5k_mmss,
            )
        except ValueError as exc:
            logger.warning("[generate-plan] Nieprawidłowy pb_5k_mmss '%s': %s", req.pb_5k_mmss, exc)

    # 3. System Prompt — kalkulator matematyczny, zero prozy
    today_str  = Date.today().isoformat()
    user_prefs = req.extra_notes or "Brak dodatkowych preferencji."

    target_section = ""
    if req.target_time_mmss:
        target_section = (
            f"\nCEL WYNIKOWY: {req.target_time_mmss}. "
            f"Plan MUSI prowadzić progresywnie do tego wyniku."
        )

    # Blok tempa: VDOT jeśli dostępny, inaczej obliczony ze Strava
    if vdot_section:
        pace_section = vdot_section
    else:
        # Oblicz warianty tempa na podstawie średniego tempa ze Strava
        # easy = avg+15s, main = avg, tempo = avg-20s, cooldown = avg+20s
        try:
            p_parts  = avg_pace_str.split(":")
            p_secs   = int(p_parts[0]) * 60 + int(p_parts[1])
            easy_s   = p_secs + 15
            tempo_s  = p_secs - 20
            cool_s   = p_secs + 20
            def _fmt(s: int) -> str:
                s = max(180, s)  # min 3:00/km
                return f"{s//60}:{s%60:02d}"
            pace_section = (
                f"\nOBLICZONE TEMPA (na podstawie Strava, średnie tempo={avg_pace_str}):\n"
                f"- Spokojny bieg (Easy): {_fmt(easy_s)} min/km\n"
                f"- Bieg główny (tempo bazowe): {avg_pace_str} min/km\n"
                f"- Szybszy bieg (Tempo): {_fmt(tempo_s)} min/km\n"
                f"- Schłodzenie: {_fmt(cool_s)} min/km\n"
                f"- Tętno bazowe (Easy): {int(avg_hr_str)-10}-{avg_hr_str} bpm\n"
                f"- Tętno główne (Main): {avg_hr_str}-{int(avg_hr_str)+10} bpm\n"
            )
        except Exception:
            pace_section = f"\nŚrednie tempo biegacza ze Strava: {avg_pace_str} min/km. Tętno: {avg_hr_str} bpm.\n"

    system_prompt = f"""\
Jesteś silnikiem matematycznym Runna. Twoim jedynym zadaniem jest wypełnienie pól JSON \
konkretnymi wartościami liczbowymi i jednozdaniowymi komendami głosowymi.

DANE WEJŚCIOWE:
- Dzisiaj: {today_str}
- Plan na: {req.weeks} tydzień/tygodnie (startując od jutra)
- Łączna liczba dni w planie: {req.weeks * 7} (MUSISZ wygenerować DOKŁADNIE tyle wpisów)
- Preferencje: {user_prefs}
{target_section}
{pace_section}
{vdot_section}

REGUŁY MATEMATYCZNE (bezwzględne):
1. Reguła 80/20: 80% dni = Easy (spokojny), 20% = Tempo/Long Run.
2. Stopniowy wzrost dystansu max +10% tygodniowo.
3. Jeden Long Run na tydzień (najdłuższy bieg, 120-150% typowego biegu).
4. target_pace MUSI być w formacie "M:SS - M:SS" (np. "5:40 - 5:55"). Przedział max 10-15 sekund.
5. heart_rate_zone:
   - Biegi spokojne (Easy, Long Run, Regeneracja): format limitu, np. "< 150 bpm"
   - Biegi szybsze (Tempo, Interwały): format zakresu, np. "155-165 bpm"
6. instructions: JEDNA krótka komenda opisująca wysiłek przez rozmowę:
   - Easy/Long: "Możesz swobodnie rozmawiać pełnymi zdaniami"
   - Tempo: "Możesz powiedzieć tylko pojedyncze słowa"
   - Bardzo intensywny: "Mówienie niemożliwe, skup się na oddechu"
7. ZAKAZ słów: tempo progowe, BNP, VO2max, interwał anaerobowy, strefy HR.
8. Dla dni wolnych (is_rest_day=true): warmup, main_phase, cooldown = null.

ZASADA FAZ (KRYTYCZNA — model musi to respektować):
- Easy Run, Long Run, Regeneracja → wypełniaj WYŁĄCZNIE `main_phase`. Pola `warmup` i `cooldown` MUSZĄ być null.
- Tempo Run, Interwały, Fartlek → wypełniaj WSZYSTKIE 3 fazy: warmup + main_phase + cooldown.
- NIE kopiuj tempa z main_phase do warmup/cooldown. Warmup jest zawsze wolniejszy, cooldown też.

FORMAT ODPOWIEDZI (obowiązkowy):
Zwróć obiekt JSON z kluczem "days" zawierającym tablicę WSZYSTKICH {req.weeks * 7} dni:
{{"days": [

  // PRZYKŁAD 1: Easy Run — TYLKO main_phase (warmup i cooldown = null)
  {{"date": "YYYY-MM-DD", "title": "Spokojny bieg", "is_rest_day": false,
    "warmup": null,
    "main_phase": {{"distance_km": "7.0", "target_pace": "5:50 - 6:05", "heart_rate_zone": "< 148 bpm", "instructions": "Możesz swobodnie rozmawiać pełnymi zdaniami"}},
    "cooldown": null,
    "trainer_notes": "Utrzymaj stałe, równe tempo przez cały bieg."}},

  // PRZYKŁAD 2: Tempo Run — WSZYSTKIE 3 fazy, różne tempa
  {{"date": "YYYY-MM-DD", "title": "Tempo Run", "is_rest_day": false,
    "warmup":     {{"distance_km": "1.5", "target_pace": "6:10 - 6:25", "heart_rate_zone": "< 135 bpm", "instructions": "Bardzo luźny trucht, rozgrzewka"}},
    "main_phase": {{"distance_km": "5.0", "target_pace": "5:05 - 5:15", "heart_rate_zone": "158-168 bpm", "instructions": "Możesz powiedzieć tylko pojedyncze słowa"}},
    "cooldown":   {{"distance_km": "1.0", "target_pace": "6:30 - 6:45", "heart_rate_zone": "< 130 bpm", "instructions": "Spokojny trucht, oddech wraca do normy"}},
    "trainer_notes": "Główna część to mocne, równe tempo."}},

  // PRZYKŁAD 3: Dzień wolny
  {{"date": "YYYY-MM-DD", "title": "Dzień wolny", "is_rest_day": true,
    "warmup": null, "main_phase": null, "cooldown": null,
    "trainer_notes": "Odpoczynek jest częścią treningu."}},

  ... (pozostałe {req.weeks * 7 - 3} wpisy)
]}}

NIE PRZERYWAJ GENEROWANIA — wygeneruj WSZYSTKIE {req.weeks * 7} dni bez skrótów.
Wszystkie wartości liczbowe zapisuj jako STRING (np. "7.0", "5:50 - 6:05", "< 150 bpm").
"""

    logger.info(
        "[generate-plan v5] user_id=%d weeks=%d vdot=%s avg_pace=%s avg_hr=%s",
        req.user_id, req.weeks, bool(vdot_section), avg_pace_str, avg_hr_str,
    )

    # 4. Wywołaj Gemini Structured Output
    raw_items: list = await _call_gemini_structured(system_prompt)

    # 5. Waliduj przez DailyWorkout v6 — duża tolerancja (str fields, Optional fazy)
    valid_items: List[DailyWorkout] = []
    for idx, item in enumerate(raw_items):
        try:
            valid_items.append(DailyWorkout.model_validate(item))
        except Exception as exc:
            logger.warning(
                "[generate-plan v6] Pomijam rek. #%d — błąd walidacji: %s | dane: %s",
                idx, exc, str(item)[:200],
            )

    if not valid_items:
        raise HTTPException(
            status_code=502,
            detail="Gemini zwrócił dane, ale żaden rekord nie przeszedł walidacji DailyWorkout."
        )

    # 6. Helper: bezpieczna konwersja str → float (obsługuje "5.0 km", "5,0", None)
    def _to_float(v: Optional[str]) -> Optional[float]:
        if not v:
            return None
        cleaned = v.strip().split()[0].replace(',', '.')  # "5.0 km" → "5.0"
        try:
            f = float(cleaned)
            return round(f, 2) if f > 0 else None
        except (ValueError, TypeError):
            return None

    def _s(v: Optional[str], n: int) -> Optional[str]:
        """Safe truncate."""
        return (v or "")[:n] or None

    # 7. Atomowy zapis do DB — mapowanie DailyWorkout → TrainingPlan (ORM)
    db_plans: List[TrainingPlan] = []
    for item in valid_items:
        w = item.warmup
        m = item.main_phase
        c = item.cooldown

        # Oblicz łączny dystans
        total_dist: Optional[float] = None
        if not item.is_rest_day:
            parts = [
                _to_float(w.distance_km) or 0.0 if w else 0.0,
                _to_float(m.distance_km) or 0.0 if m else 0.0,
                _to_float(c.distance_km) or 0.0 if c else 0.0,
            ]
            s = sum(parts)
            total_dist = round(s, 2) if s > 0 else None

        db_plans.append(TrainingPlan(
            user_id         = req.user_id,
            goal_id         = req.goal_id,
            plan_date       = Date.fromisoformat(item.date),
            type            = ("Rest" if item.is_rest_day else _s(item.title, 60) or "Easy Run"),
            description     = _s(item.title, 500),
            distance_km     = total_dist,
            target_pace     = _s(m.target_pace,     30) if m else None,
            heart_rate_zone = _s(m.heart_rate_zone,  60) if m else None,
            is_rest_day     = item.is_rest_day,
            trainer_notes   = _s(item.trainer_notes, 600),
            # Rozgrzewka
            warmup_distance_km          = _to_float(w.distance_km)    if w else None,
            warmup_exact_pace           = _s(w.target_pace,    20)     if w else None,
            warmup_heart_rate_target    = _s(w.heart_rate_zone, 30)    if w else None,
            warmup_beginner_explanation = _s(w.instructions,   300)    if w else None,
            warmup_description          = None,
            # Główna
            main_distance_km            = _to_float(m.distance_km)    if m else None,
            main_exact_pace             = _s(m.target_pace,    20)     if m else None,
            main_heart_rate_target      = _s(m.heart_rate_zone, 30)    if m else None,
            main_beginner_explanation   = _s(m.instructions,   300)    if m else None,
            main_target_pace            = _s(m.target_pace,    40)     if m else None,
            main_description            = None,
            # Schłodzenie
            cooldown_distance_km            = _to_float(c.distance_km)    if c else None,
            cooldown_exact_pace             = _s(c.target_pace,    20)     if c else None,
            cooldown_heart_rate_target      = _s(c.heart_rate_zone, 30)    if c else None,
            cooldown_beginner_explanation   = _s(c.instructions,   300)    if c else None,
            cooldown_description            = None,
        ))

    try:
        for plan in db_plans:
            session.add(plan)
        session.commit()
        logger.info("[generate-plan v6] Zapisano %d rekordów dla user_id=%d", len(db_plans), req.user_id)
    except Exception as exc:
        session.rollback()
        logger.error("[generate-plan v6] DB commit failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Nie udało się zapisać planu: {exc}")

    return GeneratePlanResponse(
        plans_created = len(db_plans),
        plans         = [i.model_dump() for i in valid_items],
        message       = (
            f"✅ Plan v6 gotowy — {len(db_plans)} treningów dla user_id={req.user_id}."
            + (f" VDOT: {zones.vdot}" if vdot_section else f" Strava avg: {avg_pace_str}/km")  # type: ignore[possibly-undefined]
        ),
    )



# ─────────────────────────────────────────────────────────────────────────────
# Endpoint — usuń WSZYSTKIE plany użytkownika
# ─────────────────────────────────────────────────────────────────────────────

@router.delete(
    "/plans",
    summary="Usuwa wszystkie plany treningowe użytkownika",
)
def delete_all_plans(
    user_id: int = Query(..., description="ID użytkownika", ge=1),
    session: Session = Depends(get_session),
) -> dict:
    """Atomowo usuwa wszystkie rekordy TrainingPlan dla danego user_id."""
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"Użytkownik id={user_id} nie istnieje.")

    plans = session.exec(select(TrainingPlan).where(TrainingPlan.user_id == user_id)).all()
    count = len(plans)
    for plan in plans:
        session.delete(plan)
    session.commit()
    logger.info("[delete-all-plans] Usunięto %d planów dla user_id=%d", count, user_id)
    return {"deleted": count, "message": f"Usunięto {count} planów treningowych."}


# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/full-view",
    response_model=FullCalendarViewResponse,
    summary="Zunifikowany widok kalendarza treningowego",
    description=(
        "Agreguje dane z dwóch źródeł — ukończone aktywności Strava (is_completed=True) "
        "i zaplanowane treningi od Kasi (is_completed=False). "
        "Wynik jest posortowany po dacie ASC."
    ),
    responses={
        200: {"description": "Lista eventów posortowana po dacie ASC"},
        404: {"description": "Użytkownik nie istnieje"},
    },
)
async def get_full_calendar_view(
    user_id: int = Query(..., description="ID użytkownika", ge=1),
    days_back: int = Query(
        default=30,
        description="Liczba dni wstecz od dzisiaj (historia)",
        ge=0, le=365,
    ),
    days_forward: int = Query(
        default=60,
        description="Liczba dni wprzód od dzisiaj (plany)",
        ge=0, le=365,
    ),
    session: Session = Depends(get_session),
) -> FullCalendarViewResponse:
    """
    Zwraca ujednoliconą listę eventów kalendarza treningowego.

    **Źródła danych:**
    - `strava` — aktywności biegowe pobierane live z Strava API (is_completed=True)
    - `kasia`  — plany treningowe z tabeli training_plans (is_completed=False)

    **Sortowanie:** ASC po dacie (najstarsze pierwsze).

    **Deduplikacja:** Jeśli dla tego samego dnia istnieje zarówno plan jak i ukończona
    aktywność, oba są zwracane — frontend może sam zdecydować o wizualizacji.
    """
    today        = Date.today()
    date_from    = today - timedelta(days=days_back)
    date_to      = today + timedelta(days=days_forward)

    # Równoległe pobieranie z obu źródeł
    strava_events, plan_events = await _fetch_strava_events(
        user_id, session, date_from, date_to
    ), _fetch_plan_events(user_id, session, date_from, date_to)

    # Połącz i posortuj po dacie ASC, remis: completed przed planned (są rzeczywiste)
    all_events = sorted(
        strava_events + plan_events,
        key=lambda e: (e.date, 0 if e.is_completed else 1),
    )

    return FullCalendarViewResponse(
        events        = all_events,
        total         = len(all_events),
        date_from     = date_from,
        date_to       = date_to,
        strava_count  = len(strava_events),
        plan_count    = len(plan_events),
    )
