"""
Kasia — AI Running Coach Service (RAG v2)
Formułuje systemowy prompt trenera biegania oparty na rzeczywistych danych Strava
i wywołuje LLM (Google Gemini). Zero żargonu sportowego.
"""
import os
import httpx
import json
import logging
import math
from typing import Optional
from dotenv import load_dotenv

load_dotenv()  # Wymuszamy wczytanie .env PRZED odczytem zmiennych

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

if not GEMINI_API_KEY:
    print("⚠️  KASIA: Brak GEMINI_API_KEY — działam w trybie offline.")
else:
    print(f"✅ KASIA: Klucz Gemini załadowany ({GEMINI_API_KEY[:8]}...)")

# Modele do próbowania po kolei — jeśli jeden wyczerpie limit, próbujemy kolejnego
GEMINI_MODELS = [
    "gemini-2.5-flash-lite",  # ✅ Zweryfikowany — działa dla tego klucza
    "gemini-2.0-flash-lite",  # Fallback — lekki model
    "gemini-flash-latest",    # Alias na aktualny flash
    "gemini-2.5-flash",       # Wolniejszy fallback — może być przeciążony
]

# ─────────────────────────────────────────────────────────────────────────────
# System Prompt — bez żargonu, przyjazny dla początkujących
# ─────────────────────────────────────────────────────────────────────────────

_KASIA_BASE_PROMPT = """\
Jesteś Kasią — serdeczną trenerką biegania dla osób, które dopiero zaczynają swoją przygodę z bieganiem.
Twój styl jest ciepły, konkretny i oparty wyłącznie na twardych liczbach — nigdy na abstrakcjach.

ABSOLUTNY ZAKAZ ŻARGONU:
Nigdy NIE używasz słów: tempo progowe, BNP, interwał anaerobowy, VO2max, próg mleczanowy,
strefy tętna (HR1-HR5, Z1-Z5), tapering, periodyzacja, kadencja, superkompensacja,
PB/PR w kontekście technicznym. Traktujesz rozmówcę jak osobę, która nigdy nie biegała.

ZAMIAST ŻARGONU używasz:
- prostych opisów wysiłku: "bieg, podczas którego możesz swobodnie rozmawiać",
  "czujesz zadyszkę, ale możesz powiedzieć krótkie zdanie", "oddech bardzo ciężki, mówienie niemożliwe"
- konkretnych liczb z historii użytkownika (tempo w min/km, tętno w bpm)
- codziennych porównań: "jakbyś szedł szybkim krokiem", "spokojny marsz-trucht"

Formatuj odpowiedź używając emoji dla czytelności: 🏃 📊 ❤️ ⚡ 🗺️ 💪
Odpowiadaj po polsku, zwięźle i motywująco.
"""


def _build_kasia_system_prompt(strava_context: Optional[str] = None) -> str:
    """
    Buduje pełny system prompt Kasi.
    Jeśli dostępne są dane Strava, wstrzykuje spersonalizowany kontekst użytkownika.
    """
    prompt = _KASIA_BASE_PROMPT

    if strava_context:
        prompt += f"\n\n{strava_context}"
    else:
        prompt += (
            "\n\nKONTEKST UŻYTKOWNIKA: Brak danych historycznych — traktuj jako absolutnego początkującego. "
            "Sugeruj bardzo spokojne tempo i krótkie dystanse."
        )

    return prompt


# ─────────────────────────────────────────────────────────────────────────────
# Pobieranie i obliczanie kontekstu Strava
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_strava_user_context(user_id: int, session) -> Optional[str]:
    """
    RAG: Pobiera aktywności biegowe z ostatnich 30 dni ze Strava API dla danego user_id.
    Oblicza:
    - średnie tempo spokojnych biegów (min/km)
    - średnie tętno (jeśli dostępne)
    Zwraca gotowy blok tekstowy do wstrzyknięcia w system prompt.
    Nigdy nie rzuca wyjątku — przy braku danych zwraca None.
    """
    import time
    import datetime as dt
    from sqlmodel import select
    from models import StravaTokens

    # Pobierz tokeny Strava
    try:
        tokens = session.exec(select(StravaTokens).where(StravaTokens.user_id == user_id)).first()
        if not tokens:
            return None

        # Odśwież token jeśli wygasł
        if tokens.expires_at - 60 < int(time.time()):
            strava_client_id     = os.getenv("STRAVA_CLIENT_ID")
            strava_client_secret = os.getenv("STRAVA_CLIENT_SECRET")
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    "https://www.strava.com/oauth/token",
                    data={
                        "client_id":     strava_client_id,
                        "client_secret": strava_client_secret,
                        "grant_type":    "refresh_token",
                        "refresh_token": tokens.refresh_token,
                    },
                )
            if resp.status_code != 200:
                logger.warning("[Kasia RAG] Nie udało się odświeżyć tokena Strava: HTTP %d", resp.status_code)
                return None
            data = resp.json()
            tokens.access_token  = data["access_token"]
            tokens.refresh_token = data["refresh_token"]
            tokens.expires_at    = data["expires_at"]
            session.add(tokens)
            session.commit()

        access_token = tokens.access_token

    except Exception as exc:
        logger.warning("[Kasia RAG] Błąd dostępu do tokenów Strava: %s", exc)
        return None

    # Pobierz aktywności z ostatnich 30 dni
    today    = dt.date.today()
    cutoff   = today - dt.timedelta(days=30)
    after_ts = int(dt.datetime.combine(cutoff, dt.time.min).timestamp())

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://www.strava.com/api/v3/athlete/activities",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"after": after_ts, "per_page": 50, "page": 1},
            )
        if resp.status_code != 200:
            logger.warning("[Kasia RAG] Strava HTTP %d dla user_id=%d", resp.status_code, user_id)
            return None

        acts = [a for a in resp.json() if "run" in a.get("type", "").lower()]
        if not acts:
            logger.info("[Kasia RAG] Brak biegów w ostatnich 30 dniach dla user_id=%d", user_id)
            return None

    except Exception as exc:
        logger.warning("[Kasia RAG] Błąd pobierania aktywności Strava: %s", exc)
        return None

    # Oblicz statystyki
    speeds  = [a["average_speed"] for a in acts if a.get("average_speed", 0) > 0]
    hr_list = [a["average_heartrate"] for a in acts if a.get("average_heartrate")]

    avg_pace_str = None
    if speeds:
        avg_ms   = sum(speeds) / len(speeds)
        secs_km  = int(round(1000 / avg_ms))
        m, s     = divmod(secs_km, 60)
        avg_pace_str = f"{m}:{s:02d} min/km"

    avg_hr_str = None
    if hr_list:
        avg_hr     = int(round(sum(hr_list) / len(hr_list)))
        avg_hr_str = f"{avg_hr} bpm"

    # Zbuduj blok kontekstowy
    context_lines = [
        f"KONTEKST UŻYTKOWNIKA: To jest biegacz z historią {len(acts)} biegów w ostatnich 30 dniach.",
    ]

    if avg_pace_str:
        context_lines.append(
            f"Z jego historii Strava wynika, że jego spokojne tempo to około {avg_pace_str}. "
            "Używaj tej liczby jako punktu odniesienia we wszystkich odpowiedziach."
        )
    if avg_hr_str:
        context_lines.append(
            f"Przy tym wysiłku jego średnie tętno wynosi {avg_hr_str}. "
            "Gdy mówisz o intensywności, podawaj konkretne wartości tętna w bpm."
        )

    context_lines.append(
        "ZASADA KRYTYCZNA: Używaj WYŁĄCZNIE tych wyliczonych wartości liczbowych jako punktu odniesienia. "
        "BEZWZGLĘDNY ZAKAZ: 'tempo progowe', 'BNP', 'interwał anaerobowy', 'strefa HR', 'VO2max'. "
        "ZAMIAST TEGO: 'bieg, podczas którego możesz swobodnie rozmawiać', "
        "'możesz tylko krótkie zdania', 'oddech bardzo ciężki, mówienie niemożliwe'."
    )

    return "\n".join(context_lines)


# ─────────────────────────────────────────────────────────────────────────────
# Wywołanie Gemini API
# ─────────────────────────────────────────────────────────────────────────────

async def _call_gemini(model: str, payload: dict) -> Optional[str]:
    """Wywołuje jeden model Gemini. Zwraca tekst lub None jeśli 429/503/błąd."""
    # Czytaj klucz dynamicznie — żeby działał po reload bez restartu procesu
    load_dotenv(override=True)
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers={"Content-Type": "application/json"})

        if resp.status_code == 200:
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]
        elif resp.status_code in (429, 503):
            logger.warning("⚠️ [%s] %d — próbuję następny model...", model, resp.status_code)
            return None
        else:
            body = resp.text[:200]
            logger.error("❌ [%s] Error %d: %s", model, resp.status_code, body)
            return None
    except Exception as e:
        logger.error("❌ [%s] Exception: %s", model, e)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Publiczne API serwisu
# ─────────────────────────────────────────────────────────────────────────────

async def ask_kasia(
    user_message: str,
    activity_context: Optional[dict] = None,
    strava_user_context: Optional[str] = None,
) -> str:
    """
    Wysyła wiadomość do Kasi (Gemini) z pełnym kontekstem RAG.

    Args:
        user_message:        Pytanie/wiadomość użytkownika.
        activity_context:    Dane pojedynczej aktywności (do analizy konkretnego treningu).
        strava_user_context: Spersonalizowany blok tekstowy z historii Strava (30 dni)
                             — wynik _fetch_strava_user_context(). Wstrzykiwany do system promptu.

    Automatycznie przełącza modele jeśli jeden wyczerpie limit (waterfall).
    Zwraca odpowiedź jako string.
    """
    load_dotenv(override=True)
    if not os.getenv("GEMINI_API_KEY", ""):
        return _offline_response(activity_context)

    # Buduj system prompt z opcjonalnym kontekstem Strava
    system_prompt = _build_kasia_system_prompt(strava_user_context)

    # Dodaj kontekst konkretnej aktywności (jeśli analizujemy trening)
    activity_block = ""
    if activity_context:
        activity_block = (
            f"\n\n📊 **Dane aktywności ze Stravy:**\n"
            f"```json\n{json.dumps(activity_context, indent=2, ensure_ascii=False)}\n```\n\n"
        )

    full_prompt = f"{system_prompt}\n\n{activity_block}Pytanie użytkownika: {user_message}"

    payload = {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1024},
    }

    # Waterfall — próbuj kolejne modele
    for model in GEMINI_MODELS:
        result = await _call_gemini(model, payload)
        if result:
            return result

    # Wszystkie modele wyczerpały limity
    return (
        "⏳ **Kasia jest chwilowo niedostępna.**\n\n"
        "Bezpłatny klucz API Gemini wyczerpał dzienny limit zapytań.\n"
        "Odczekaj do północy (UTC) lub przejdź na płatny plan na "
        "[Google AI Studio](https://aistudio.google.com/apikey)."
    )


def _offline_response(activity_context: Optional[dict] = None) -> str:
    """Odpowiedź offline gdy brak klucza Gemini — symuluje analizę trenera."""
    if not activity_context:
        return (
            "Hej! 👋 Jestem Kasia, Twoja trenerka biegania. "
            "Pytaj mnie o treningi, analizę aktywności lub plan przygotowań do startu. "
            "Dodaj klucz **GEMINI_API_KEY** do pliku `.env`, żebym mogła dać Ci pełną, spersonalizowaną analizę! 🏃"
        )

    name      = activity_context.get("name", "Trening")
    dist      = activity_context.get("distance_km", 0)
    pace      = activity_context.get("average_pace_min_per_km")
    hr        = activity_context.get("average_heartrate")
    elevation = activity_context.get("total_elevation_gain", 0)

    lines = [f"📊 **Analiza: {name}**\n"]
    lines.append(f"🏃 Dystans: **{dist} km** — " + ("solidna praca! " if dist > 10 else "dobry start! "))

    if pace:
        pace_val = float(str(pace).replace(":", "."))
        lines.append(
            f"⚡ Tempo: **{pace} min/km** — "
            + (
                "bardzo szybko — przy tym tempie mówienie jest bardzo trudne!"
                if pace_val < 5.0
                else "spokojne tempo — powinieneś móc swobodnie rozmawiać."
            )
        )

    if hr:
        if hr < 140:
            hr_desc = "bardzo spokojny wysiłek, możesz śpiewać 🎵"
        elif hr < 160:
            hr_desc = "umiarkowany wysiłek, możesz rozmawiać krótkimi zdaniami"
        else:
            hr_desc = "intensywny wysiłek, oddech ciężki"
        lines.append(f"❤️ Śr. tętno: **{hr} bpm** — {hr_desc}.")

    if elevation > 50:
        lines.append(f"🗺️ Przewyższenie: **{elevation}m** — trasa wymagająca, wzmacniasz siłę nóg!")

    lines.append(
        "\n💪 **Rekomendacja Kasi:** Dodaj klucz GEMINI_API_KEY, "
        "żebym mogła przygotować Ci pełny plan regeneracji i następnego tygodnia!"
    )

    return "\n".join(lines)
