"""
routers/user.py — Endpointy zarządzania profilem użytkownika.

Dostępne endpointy:
  GET  /api/user/profile?user_id=<id>      → pełny profil
  PATCH /api/user/profile                   → aktualizacja profilu (JSON)
  POST /api/user/profile/avatar             → upload własnego awatara (multipart/form-data)
"""

import os
import uuid
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session
from pydantic import BaseModel, Field

from database import get_session
from models import User, FitnessLevel

router = APIRouter()

# ── Katalog uploadu ────────────────────────────────────────────────────────────
BACKEND_DIR  = Path(__file__).parent.parent          # .../backend/
UPLOADS_DIR  = BACKEND_DIR / "uploads" / "avatars"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_FILE_SIZE_MB   = 5
BACKEND_URL        = os.getenv("BACKEND_URL", "http://localhost:8000")


# ── Schematy Pydantic ─────────────────────────────────────────────────────────

class ProfileResponse(BaseModel):
    """Pełny profil użytkownika zwracany przez GET /profile i GET /auth/me."""
    user_id:        int
    email:          str
    google_id:      str
    display_name:   Optional[str]
    avatar_url:     Optional[str]
    fitness_level:  Optional[str]
    training_goal:  Optional[str]
    strava_linked:  bool
    strava_athlete_id: Optional[int]


class ProfileUpdateRequest(BaseModel):
    """Ciało żądania PATCH /api/user/profile."""
    user_id:        int                    = Field(..., description="ID użytkownika")
    display_name:   Optional[str]          = Field(None, max_length=64)
    avatar_url:     Optional[str]          = Field(None, max_length=512)
    fitness_level:  Optional[FitnessLevel] = None
    training_goal:  Optional[str]          = Field(None, max_length=64)


# ── Helpery ───────────────────────────────────────────────────────────────────

def _strava_status(user_id: int, session: Session) -> tuple[bool, Optional[int]]:
    """Zwraca (strava_linked, strava_athlete_id) dla danego user_id."""
    from sqlmodel import select
    from models import StravaTokens
    tokens = session.exec(select(StravaTokens).where(StravaTokens.user_id == user_id)).first()
    if tokens:
        return True, tokens.strava_athlete_id
    return False, None


def _build_profile(user: User, session: Session) -> ProfileResponse:
    linked, athlete_id = _strava_status(user.id, session)
    return ProfileResponse(
        user_id        = user.id,
        email          = user.email,
        google_id      = user.google_id,
        display_name   = user.display_name,
        avatar_url     = user.avatar_url,
        fitness_level  = user.fitness_level,
        training_goal  = user.training_goal,
        strava_linked  = linked,
        strava_athlete_id = athlete_id,
    )


# ── Endpointy ─────────────────────────────────────────────────────────────────

@router.get("/profile", response_model=ProfileResponse, summary="Pobierz profil użytkownika")
def get_profile(
    user_id: int = Query(..., description="ID użytkownika"),
    session: Session = Depends(get_session),
):
    """
    Zwraca kompletny profil użytkownika, włącznie z polami display_name,
    avatar_url, fitness_level, training_goal oraz statusem Strava.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie istnieje")
    return _build_profile(user, session)


@router.patch("/profile", response_model=ProfileResponse, summary="Aktualizuj profil użytkownika")
def update_profile(
    body: ProfileUpdateRequest,
    session: Session = Depends(get_session),
):
    """
    Aktualizuje wybrane pola profilu użytkownika (PATCH — częściowa aktualizacja).
    Pola None są ignorowane — nie nadpisują istniejących wartości.
    Wymaga: user_id w body.
    """
    user = session.get(User, body.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie istnieje")

    # Partial update — nadpisuj tylko podane pola
    if body.display_name  is not None: user.display_name  = body.display_name.strip() or None
    if body.avatar_url    is not None: user.avatar_url    = body.avatar_url
    if body.fitness_level is not None: user.fitness_level = body.fitness_level
    if body.training_goal is not None: user.training_goal = body.training_goal

    session.add(user)
    session.commit()
    session.refresh(user)

    return _build_profile(user, session)


@router.post(
    "/profile/avatar",
    response_model=dict,
    summary="Upload własnego awatara",
)
async def upload_avatar(
    user_id: int  = Form(..., description="ID użytkownika"),
    file:    UploadFile = File(..., description="Plik obrazu (jpg/png/webp/gif, max 5MB)"),
    session: Session = Depends(get_session),
):
    """
    Przyjmuje multipart/form-data z polem 'file'.
    Sprawdza rozszerzenie i rozmiar, zapisuje w uploads/avatars/,
    aktualizuje avatar_url w bazie i zwraca publiczny URL.

    Bezpieczeństwo:
    - Biała lista rozszerzeń (nie ufamy Content-Type klienta)
    - UUID jako nazwa pliku (brak path traversal)
    - Cap 5 MB
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie istnieje")

    # Walidacja rozszerzenia
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Niedozwolony format pliku. Dozwolone: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Walidacja rozmiaru (read chunk-by-chunk, cap 5MB)
    MAX_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Plik zbyt duży. Maksymalny rozmiar: {MAX_FILE_SIZE_MB} MB"
        )

    # Usuń stary avatar jeśli był lokalny
    if user.avatar_url and user.avatar_url.startswith(f"{BACKEND_URL}/uploads/avatars/"):
        old_filename = user.avatar_url.split("/uploads/avatars/")[-1]
        old_path = UPLOADS_DIR / old_filename
        if old_path.exists():
            old_path.unlink(missing_ok=True)

    # Zapisz nowy plik z UUID jako nazwą
    new_filename = f"{uuid.uuid4().hex}{suffix}"
    dest_path = UPLOADS_DIR / new_filename
    dest_path.write_bytes(content)

    # Skonstruuj publiczny URL (serwowany przez FastAPI static files)
    public_url = f"{BACKEND_URL}/uploads/avatars/{new_filename}"

    # Zapisz w bazie
    user.avatar_url = public_url
    session.add(user)
    session.commit()

    return {"avatar_url": public_url}
