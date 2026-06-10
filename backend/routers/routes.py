from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List, Any, Optional
import json
import logging

logger = logging.getLogger(__name__)

from database import get_session
from models import SavedRoute
from models import User

router = APIRouter()

class SavedRouteCreate(BaseModel):
    user_id: int # Złagodziliśmy autoryzację do uproszczeń
    name: str = "Moja Pętla"
    geojson_feature: Any # Pełny jeden feature
    distance_m: float
    
class SavedRouteResponse(BaseModel):
    id: int
    name: str
    distance_m: float
    geojson_feature: Any

@router.post("/saved", response_model=SavedRouteResponse)
def create_saved_route(route: SavedRouteCreate, session: Session = Depends(get_session)):
    # Walidacja użytkownika
    statement = select(User).where(User.id == route.user_id)
    user = session.exec(statement).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie istnieje")
        
    # Zamień słownik w string JSON
    geojson_str = json.dumps(route.geojson_feature)
    
    new_route = SavedRoute(
        user_id=route.user_id,
        name=route.name,
        geojson_data=geojson_str,
        distance_m=route.distance_m
    )
    session.add(new_route)
    session.commit()
    session.refresh(new_route)
    
    return SavedRouteResponse(
        id=new_route.id,
        name=new_route.name,
        distance_m=new_route.distance_m or 0.0,
        geojson_feature=json.loads(new_route.geojson_data)
    )

@router.get("/saved/{user_id}", response_model=List[SavedRouteResponse])
def get_saved_routes(user_id: int, session: Session = Depends(get_session)):
    statement = select(SavedRoute).where(SavedRoute.user_id == user_id)
    routes = session.exec(statement).all()
    
    res = []
    for r in routes:
        res.append(SavedRouteResponse(
            id=r.id,
            name=r.name,
            distance_m=r.distance_m or 0.0,
            geojson_feature=json.loads(r.geojson_data)
        ))
    return res


class RenameRouteRequest(BaseModel):
    name: str
    user_id: int   # prosty guard — nie mamy JWT w tym endpoincie


@router.patch("/saved/{route_id}", response_model=SavedRouteResponse)
def rename_saved_route(
    route_id: int,
    req: RenameRouteRequest,
    session: Session = Depends(get_session),
):
    """Zmiana nazwy zapisanej trasy."""
    route = session.get(SavedRoute, route_id)
    if not route:
        raise HTTPException(status_code=404, detail="Trasa nie istnieje.")
    if route.user_id != req.user_id:
        raise HTTPException(status_code=403, detail="Brak uprawnień do tej trasy.")
    route.name = req.name.strip() or route.name
    session.add(route)
    session.commit()
    session.refresh(route)
    return SavedRouteResponse(
        id=route.id,
        name=route.name,
        distance_m=route.distance_m or 0.0,
        geojson_feature=json.loads(route.geojson_data),
    )


@router.delete("/saved/{route_id}")
def delete_saved_route(
    route_id: int,
    user_id: int,
    session: Session = Depends(get_session),
):
    """Usuwa zapisaną trasę (tylko właściciel)."""
    route = session.get(SavedRoute, route_id)
    if not route:
        raise HTTPException(status_code=404, detail="Trasa nie istnieje.")
    if route.user_id != user_id:
        raise HTTPException(status_code=403, detail="Brak uprawnień.")
    session.delete(route)
    session.commit()
    return {"ok": True}



# ── Zapisz trasę ze Strava ────────────────────────────────────────────────────

class SaveFromStravaRequest(BaseModel):
    user_id: int
    strava_activity_id: int
    name: Optional[str] = None   # jeśli brak, użyjemy nazwy z Strava


@router.post("/save-from-strava", response_model=SavedRouteResponse)
async def save_route_from_strava(
    req: SaveFromStravaRequest,
    session: Session = Depends(get_session),
):
    """
    Pobiera aktywność ze Strava po ID, dekoduje jej polyline do GeoJSON
    i zapisuje jako SavedRoute — gotowe do załadowania na mapę.
    """
    from services.strava_client import fetch_strava_activities

    user = session.get(User, req.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie istnieje.")

    try:
        # Pobieramy listę (max 100) aktywności i szukamy po ID
        activities = await fetch_strava_activities(req.user_id, session, limit=100)
    except Exception as exc:
        logger.error("[save-from-strava] Błąd Strava API: %s", exc)
        raise HTTPException(status_code=502, detail=f"Błąd Strava API: {exc}")

    act = next((a for a in activities if a["id"] == req.strava_activity_id), None)
    if not act:
        raise HTTPException(status_code=404, detail="Aktywność nie znaleziona w ostatnich 100 wpisach Strava.")

    geojson = act.get("geojson")
    if not geojson:
        raise HTTPException(status_code=422, detail="Ta aktywność nie ma danych GPS (brak polyline).")

    route_name = req.name or act.get("name") or "Trasa ze Strava"

    new_route = SavedRoute(
        user_id=req.user_id,
        name=route_name,
        geojson_data=json.dumps(geojson),
        distance_m=act.get("distance_m", 0),
    )
    session.add(new_route)
    session.commit()
    session.refresh(new_route)

    logger.info(
        "[save-from-strava] Zapisano trasę '%s' (%.0f m) dla user_id=%d",
        route_name, new_route.distance_m or 0, req.user_id,
    )

    return SavedRouteResponse(
        id=new_route.id,
        name=new_route.name,
        distance_m=new_route.distance_m or 0.0,
        geojson_feature=json.loads(new_route.geojson_data),
    )
