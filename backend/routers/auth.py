import os
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import RedirectResponse
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import Optional, List
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import httpx
from database import get_session
from models import User, StravaTokens

router = APIRouter()
logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
STRAVA_CLIENT_ID = os.getenv("STRAVA_CLIENT_ID")
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

class GoogleAuthRequest(BaseModel):
    token: str

@router.post("/google")
def google_auth(request: GoogleAuthRequest, session: Session = Depends(get_session)):
    """Waliduje Google ID token i tworzy/odświeża użytkownika."""
    if not GOOGLE_CLIENT_ID:
        logger.error("GOOGLE_CLIENT_ID nie jest ustawiony w zmiennych środowiskowych!")
        raise HTTPException(status_code=500, detail="Konfiguracja serwera: brak GOOGLE_CLIENT_ID")

    if not request.token:
        raise HTTPException(status_code=400, detail="Brak tokenu Google w żądaniu")

    try:
        idinfo = id_token.verify_oauth2_token(
            request.token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )

        email     = idinfo["email"]
        google_id = idinfo["sub"]
        given_name = (
            idinfo.get("given_name")
            or (idinfo.get("name", "").split()[0] if idinfo.get("name") else None)
        )

        statement = select(User).where(User.google_id == google_id)
        user = session.exec(statement).first()

        if not user:
            user = User(email=email, google_id=google_id, display_name=given_name)
            session.add(user)
            session.commit()
            session.refresh(user)
            logger.info("Nowy użytkownik zarejestrowany: email=%s id=%d", email, user.id)
        else:
            logger.info("Użytkownik zalogowany: email=%s id=%d", email, user.id)

        return {"message": "Success", "user_id": user.id, "email": user.email}

    except ValueError as exc:
        # Nieprawidłowy lub wygasły token Google
        logger.warning("Nieprawidłowy Google ID token: %s", exc)
        raise HTTPException(status_code=401, detail=f"Nieprawidłowy token Google: {exc}")
    except Exception as exc:
        # Transport error, clock skew, sieć, itp.
        logger.error("Nieoczekiwany błąd podczas weryfikacji Google token: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Błąd weryfikacji tokenu: {exc}")




@router.get("/strava/login")
def strava_login(user_id: int):
    """ Redirect usera do logowania Strava. Przekazujemy user_id do state, żeby wiedzieć dla kogo to. """
    redirect_uri = f"{os.getenv('BACKEND_URL', 'http://localhost:8000')}/api/auth/strava/callback"
    scope = "activity:read_all"
    url = f"https://www.strava.com/oauth/authorize?client_id={STRAVA_CLIENT_ID}&response_type=code&redirect_uri={redirect_uri}&approval_prompt=force&scope={scope}&state={user_id}"
    return RedirectResponse(url)


@router.get("/strava/callback")
async def strava_callback(code: str, state: str, session: Session = Depends(get_session)):
    """ Odbiera code ze stravy i state (nasz user_id), pobiera token i zapisuje w DB """
    user_id = int(state)
    
    async with httpx.AsyncClient() as client:
        response = await client.post("https://www.strava.com/oauth/token", data={
            "client_id": STRAVA_CLIENT_ID,
            "client_secret": STRAVA_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code"
        })

    if response.status_code != 200:
        # Redirect na front z flagą błędu — nie zostawiamy usera na golym API
        return RedirectResponse(url=f"{FRONTEND_URL}/?strava_error=auth_failed")

    data = response.json()

    # Zapis tokenu
    statement = select(StravaTokens).where(StravaTokens.user_id == user_id)
    tokens = session.exec(statement).first()

    if not tokens:
        tokens = StravaTokens(
            user_id=user_id,
            strava_athlete_id=data["athlete"]["id"],
            access_token=data["access_token"],
            refresh_token=data["refresh_token"],
            expires_at=data["expires_at"]
        )
        session.add(tokens)
    else:
        tokens.access_token = data["access_token"]
        tokens.refresh_token = data["refresh_token"]
        tokens.expires_at = data["expires_at"]
        tokens.strava_athlete_id = data["athlete"]["id"]

    session.commit()

    # Przekierowanie z powrotem na frontend — ProfileSection reaguje na ?strava_linked=true
    return RedirectResponse(url=f"{FRONTEND_URL}/?strava_linked=true")


@router.get("/me")
def get_me(user_id: int, session: Session = Depends(get_session)):
    """
    Zwraca pełny profil zalogowanego użytkownika.
    Zawiera nowe pola: display_name, avatar_url, fitness_level, training_goal.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Nieautoryzowany — użytkownik nie istnieje")

    strava_linked = False
    strava_athlete_id = None
    statement = select(StravaTokens).where(StravaTokens.user_id == user_id)
    tokens = session.exec(statement).first()
    if tokens:
        strava_linked = True
        strava_athlete_id = tokens.strava_athlete_id

    return {
        "user_id":           user.id,
        "email":             user.email,
        "google_id":         user.google_id,
        "display_name":      user.display_name,
        "avatar_url":        user.avatar_url,
        "fitness_level":     user.fitness_level,
        "training_goal":     user.training_goal,
        "strava_linked":     strava_linked,
        "strava_athlete_id": strava_athlete_id,
    }


async def _get_valid_strava_token(user_id: int, session: Session) -> str:
    """
    Helper: pobiera aktualny access_token dla usera.
    Jeśli wygasł — wykonuje refresh i zapisuje nowy token do bazy.
    """
    statement = select(StravaTokens).where(StravaTokens.user_id == user_id)
    tokens = session.exec(statement).first()

    if not tokens:
        raise HTTPException(status_code=404, detail="Konto Strava nie jest połączone")

    # Odświeżamy token jeśli wygasł (z 60s buforem)
    if tokens.expires_at - 60 < int(time.time()):
        async with httpx.AsyncClient() as client:
            resp = await client.post("https://www.strava.com/oauth/token", data={
                "client_id": STRAVA_CLIENT_ID,
                "client_secret": STRAVA_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "refresh_token": tokens.refresh_token,
            })
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Nie udało się odświeżyć tokena Strava")
        data = resp.json()
        tokens.access_token = data["access_token"]
        tokens.refresh_token = data["refresh_token"]
        tokens.expires_at = data["expires_at"]
        session.add(tokens)
        session.commit()

    return tokens.access_token


class ActivityResponse(BaseModel):
    id: int
    nazwa_treningu: str
    dystans_km: float
    data: str
    slad_gps_geojson: Optional[dict]


@router.get("/activities", response_model=List[ActivityResponse])
async def get_user_activities(
    user_id: int,
    limit: int = 10,
    session: Session = Depends(get_session)
):
    """
    Pobiera ostatnie aktywności biegowe z Strava API.
    Automatycznie odświeża token jeśli wygasł.
    Opcjonalnie pobiera ślad GPS (streams) jako GeoJSON LineString.
    """
    access_token = await _get_valid_strava_token(user_id, session)

    headers = {"Authorization": f"Bearer {access_token}"}

    # Pobieramy więcej, żeby po przefiltrowaniu mieć wystarczająco biegów
    fetch_limit = min(max(limit * 3, 50), 200)

    async with httpx.AsyncClient() as client:
        # 1. Lista aktywności
        acts_resp = await client.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers=headers,
            params={"per_page": fetch_limit, "page": 1},
        )

    if acts_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Błąd pobierania aktywności ze Strava")

    activities_raw = acts_resp.json()
    result: List[ActivityResponse] = []

    async with httpx.AsyncClient() as client:
        for act in activities_raw:
            # Zostawiamy tylko treningi biegowe
            act_type = act.get("type") or ""
            sport_type = act.get("sport_type") or ""
            if "run" not in act_type.lower() and "run" not in sport_type.lower():
                continue

            # Pobieramy stream GPS tylko dla aktywności z trasą
            geojson = None
            if act.get("map", {}).get("summary_polyline"):
                streams_resp = await client.get(
                    f"https://www.strava.com/api/v3/activities/{act['id']}/streams",
                    headers=headers,
                    params={"keys": "latlng", "key_by_type": "true"},
                )
                if streams_resp.status_code == 200:
                    streams = streams_resp.json()
                    latlng = streams.get("latlng", {}).get("data", [])
                    if latlng:
                        # [lat, lng] → GeoJSON wymaga [lng, lat]
                        coords = [[pt[1], pt[0]] for pt in latlng]
                        geojson = {
                            "type": "Feature",
                            "geometry": {"type": "LineString", "coordinates": coords},
                            "properties": {"activity_id": act["id"]},
                        }

            result.append(ActivityResponse(
                id=act["id"],
                nazwa_treningu=act.get("name", "Trening"),
                dystans_km=round(act.get("distance", 0) / 1000, 2),
                data=act.get("start_date_local", "")[:10],  # YYYY-MM-DD
                slad_gps_geojson=geojson,
            ))

            if len(result) >= limit:
                break

    return result

