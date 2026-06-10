"""
Router dla asystenta Kasi i modułu planowania treningowego.
Endpointy:
  POST /api/assistant/analyze-activity  — analiza aktywności przez Kasię
  POST /api/assistant/chat              — ogólny chat z Kasią
  GET/POST /api/assistant/goals         — CRUD celów startowych
  DELETE /api/assistant/goals/{id}
  GET/POST /api/assistant/plans         — CRUD planu treningowego
  DELETE /api/assistant/plans/{id}
  POST /api/assistant/generate-plan     — Kasia generuje plan tygodniowy
"""
import os
import time
import httpx
from datetime import date, timedelta
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel

from database import get_session
from models import User, StravaTokens, Goal, TrainingPlan
from services.kasia_coach import ask_kasia, _fetch_strava_user_context

router = APIRouter()

STRAVA_CLIENT_ID = os.getenv("STRAVA_CLIENT_ID")
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET")


# ─── HELPER: pobierz i odśwież token Stravy ───────────────────────────────────
async def _get_strava_token(user_id: int, session: Session) -> str:
    statement = select(StravaTokens).where(StravaTokens.user_id == user_id)
    tokens = session.exec(statement).first()
    if not tokens:
        raise HTTPException(status_code=404, detail="Strava nie jest połączona")

    if tokens.expires_at - 60 < int(time.time()):
        async with httpx.AsyncClient() as client:
            resp = await client.post("https://www.strava.com/oauth/token", data={
                "client_id": STRAVA_CLIENT_ID,
                "client_secret": STRAVA_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "refresh_token": tokens.refresh_token,
            })
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Nie udało się odświeżyć tokena")
        d = resp.json()
        tokens.access_token = d["access_token"]
        tokens.refresh_token = d["refresh_token"]
        tokens.expires_at = d["expires_at"]
        session.add(tokens)
        session.commit()

    return tokens.access_token


# ─── ANALIZA AKTYWNOŚCI ────────────────────────────────────────────────────────

class AnalyzeActivityRequest(BaseModel):
    user_id: int
    activity_id: int

class KasiaResponse(BaseModel):
    response: str
    activity_context: Optional[Any] = None


@router.post("/analyze-activity", response_model=KasiaResponse)
async def analyze_activity(req: AnalyzeActivityRequest, session: Session = Depends(get_session)):
    """
    Pobiera szczegółowe dane aktywności ze Stravy (tętno, tempo, przewyższenia)
    i przekazuje je Kasi do analizy.
    RAG: pobiera też historię 30 dni, żeby Kasia znała profil biegacza.
    Zwraca gotowy komentarz trenera bez żargonu.
    """
    access_token = await _get_strava_token(req.user_id, session)
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient(timeout=20.0) as client:
        act_resp = await client.get(
            f"https://www.strava.com/api/v3/activities/{req.activity_id}",
            headers=headers
        )

    if act_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Błąd pobierania aktywności ze Strava")

    act = act_resp.json()

    # Formatujemy dane dla Kasi — czytelna struktura bez JSONowego bajtu
    distance_km = round(act.get("distance", 0) / 1000, 2)
    moving_time_s = act.get("moving_time", 0)
    pace_sec = (moving_time_s / distance_km) if distance_km > 0 else 0
    pace_str = f"{int(pace_sec // 60)}:{int(pace_sec % 60):02d}" if pace_sec else None

    activity_context = {
        "name": act.get("name", "Trening"),
        "type": act.get("type", "Run"),
        "date": act.get("start_date_local", "")[:10],
        "distance_km": distance_km,
        "moving_time_s": moving_time_s,
        "average_pace_min_per_km": pace_str,
        "average_heartrate": act.get("average_heartrate"),
        "max_heartrate": act.get("max_heartrate"),
        "average_cadence": act.get("average_cadence"),
        "total_elevation_gain": act.get("total_elevation_gain"),
        "suffer_score": act.get("suffer_score"),
        "average_watts": act.get("average_watts"),
        "kudos_count": act.get("kudos_count"),
        "description": act.get("description") or "",
    }

    # RAG: pobierz kontekst 30 dni Strava do system promptu
    strava_user_context = await _fetch_strava_user_context(req.user_id, session)

    kasia_reply = await ask_kasia(
        user_message=f"Przeanalizuj ten mój trening i powiedz mi co sądzisz: {activity_context['name']} ({distance_km}km).",
        activity_context=activity_context,
        strava_user_context=strava_user_context,
    )

    return KasiaResponse(response=kasia_reply, activity_context=activity_context)


# ─── OGÓLNY CHAT Z KASIĄ ──────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    user_id: int
    message: str

@router.post("/chat", response_model=KasiaResponse)
async def chat_with_kasia(req: ChatRequest, session: Session = Depends(get_session)):
    """
    Ogólna rozmowa z Kasią.
    RAG: pobiera historię 30 dni Strava i wstrzykuje spersonalizowany kontekst
    do system promptu — Kasia zna tempo i tętno biegacza ZANIM odpowie.
    """
    # RAG: pobierz kontekst historyczny Strava (last 30 days)
    strava_user_context = await _fetch_strava_user_context(req.user_id, session)

    reply = await ask_kasia(
        user_message=req.message,
        strava_user_context=strava_user_context,
    )
    return KasiaResponse(response=reply)


# ─── CELE STARTOWE (CRUD) ─────────────────────────────────────────────────────

class GoalCreate(BaseModel):
    user_id: int
    title: str
    race_date: date
    target_time: Optional[str] = None
    distance_km: Optional[float] = None
    notes: Optional[str] = None

class GoalResponse(BaseModel):
    id: int
    title: str
    race_date: date
    target_time: Optional[str]
    distance_km: Optional[float]
    notes: Optional[str]
    days_left: int

@router.get("/goals", response_model=List[GoalResponse])
def get_goals(user_id: int, session: Session = Depends(get_session)):
    """
    Zwraca liste celow startowych uzytkownika.
    Zawsze zwraca [] dla nowego/nieznanego user_id — nigdy 404 ani 500.
    """
    try:
        goals = session.exec(select(Goal).where(Goal.user_id == user_id)).all()
        return [
            GoalResponse(
                id=g.id,
                title=g.title,
                race_date=g.race_date,
                target_time=g.target_time,
                distance_km=g.distance_km,
                notes=g.notes,
                days_left=(g.race_date - date.today()).days
            ) for g in goals
        ]
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("get_goals DB error: %s", exc)
        return []

@router.post("/goals", response_model=GoalResponse)
def create_goal(goal: GoalCreate, session: Session = Depends(get_session)):
    user = session.get(User, goal.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie istnieje")
    g = Goal(**goal.model_dump())
    session.add(g)
    session.commit()
    session.refresh(g)
    return GoalResponse(
        id=g.id, title=g.title, race_date=g.race_date,
        target_time=g.target_time, distance_km=g.distance_km,
        notes=g.notes, days_left=(g.race_date - date.today()).days
    )

@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: int, user_id: int, session: Session = Depends(get_session)):
    g = session.get(Goal, goal_id)
    if not g or g.user_id != user_id:
        raise HTTPException(status_code=404, detail="Cel nie znaleziony")
    session.delete(g)
    session.commit()
    return {"ok": True}


# ─── PLAN TRENINGOWY (CRUD) ───────────────────────────────────────────────────

class PlanCreate(BaseModel):
    user_id: int
    goal_id: Optional[int] = None
    plan_date: date
    type: str
    description: Optional[str] = None
    distance_km: Optional[float] = None

class PlanResponse(BaseModel):
    id: int
    goal_id: Optional[int]
    plan_date: date
    type: str
    description: Optional[str]
    distance_km: Optional[float]

@router.get("/plans", response_model=List[PlanResponse])
def get_plans(user_id: int, session: Session = Depends(get_session)):
    """
    Zwraca liste planow treningowych uzytkownika.
    Zawsze zwraca [] dla nowego/nieznanego user_id — nigdy 404 ani 500.
    """
    try:
        plans = session.exec(select(TrainingPlan).where(TrainingPlan.user_id == user_id)).all()
        return [PlanResponse(id=p.id, goal_id=p.goal_id, plan_date=p.plan_date,
                             type=p.type, description=p.description, distance_km=p.distance_km)
                for p in plans]
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("get_plans DB error: %s", exc)
        return []

@router.post("/plans", response_model=PlanResponse)
def create_plan(plan: PlanCreate, session: Session = Depends(get_session)):
    p = TrainingPlan(**plan.model_dump())
    session.add(p)
    session.commit()
    session.refresh(p)
    return PlanResponse(id=p.id, goal_id=p.goal_id, plan_date=p.plan_date,
                        type=p.type, description=p.description, distance_km=p.distance_km)

@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, user_id: int, session: Session = Depends(get_session)):
    p = session.get(TrainingPlan, plan_id)
    if not p or p.user_id != user_id:
        raise HTTPException(status_code=404, detail="Plan nie znaleziony")
    session.delete(p)
    session.commit()
    return {"ok": True}


# ─── GENEROWANIE PLANU PRZEZ KASIĘ ───────────────────────────────────────────

class GeneratePlanRequest(BaseModel):
    user_id: int
    goal_id: int

class GeneratePlanResponse(BaseModel):
    kasia_response: str
    plans_created: int

@router.post("/generate-plan", response_model=GeneratePlanResponse)
async def generate_training_plan(req: GeneratePlanRequest, session: Session = Depends(get_session)):
    """
    Kasia generuje propozycje planu treningowego na najblizszy tydzien
    na podstawie celu startowego. Automatycznie dodaje wpisy do TrainingPlan.
    """
    goal = session.get(Goal, req.goal_id)
    if not goal or goal.user_id != req.user_id:
        raise HTTPException(status_code=404, detail="Cel nie znaleziony")

    days_left = (goal.race_date - date.today()).days
    context = {
        "cel": goal.title,
        "data_startu": str(goal.race_date),
        "dni_do_startu": days_left,
        "dystans_km": goal.distance_km,
        "target_time": goal.target_time,
        "uwagi": goal.notes,
    }

    prompt = (
        f"Mój cel: {goal.title}. "
        f"Data startu: {goal.race_date} (za {days_left} dni). "
        f"Dystans: {goal.distance_km} km. Cel czasowy: {goal.target_time}. "
        f"Zaproponuj mi plan treningowy na najbliższe 7 dni w formacie:\n"
        f"dzień 1: [typ] - [dystans] km - [opis]\n"
        f"dzień 2: ... itd.\n"
        f"Bądź szczegółowa i motywująca!"
    )

    # Wywołanie Kasi — wyjątek propaguje jako 500 (jawny błąd integracji AI)
    kasia_reply = await ask_kasia(user_message=prompt, activity_context=context)

    # Parsowanie prostego formatu "dzień X: typ - Y km - opis"
    plans_added = 0
    plans_to_add: list[TrainingPlan] = []

    for line in kasia_reply.split("\n"):
        line_lower = line.lower().strip()
        if not (line_lower.startswith("dzień") or line_lower.startswith("day")):
            continue
        parts = line.split(":", 1)
        if len(parts) < 2:
            continue
        content = parts[1].strip(" -–")
        chunks = [c.strip() for c in content.split("-")]
        plan_type = chunks[0] if chunks else "Trening"
        dist: Optional[float] = None
        desc: Optional[str] = None
        for chunk in chunks[1:]:
            try:
                dist = float(chunk.replace("km", "").strip().split()[0])
            except Exception:
                desc = chunk
        plans_to_add.append(TrainingPlan(
            user_id=req.user_id,
            goal_id=req.goal_id,
            plan_date=date.today() + timedelta(days=plans_added),
            type=plan_type[:60],
            description=desc,
            distance_km=dist,
        ))
        plans_added += 1
        if plans_added >= 7:
            break

    # Zapisz do bazy atomowo — rollback przy błędzie DB, ale odpowiedź i tak OK
    try:
        for plan in plans_to_add:
            session.add(plan)
        session.commit()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("generate-plan DB commit failed: %s", exc)
        session.rollback()
        # Nie rzucamy wyjątku — odpowiedź Kasi jest wartościowa nawet bez zapisu
        plans_added = 0

    return GeneratePlanResponse(kasia_response=kasia_reply, plans_created=plans_added)
