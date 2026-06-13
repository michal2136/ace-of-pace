import polyline
import httpx
import os
import time
from sqlmodel import Session, select
from database import get_session
from models import StravaTokens

STRAVA_CLIENT_ID = os.getenv("STRAVA_CLIENT_ID")
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET")

async def refresh_strava_token_if_needed(tokens: StravaTokens, session: Session) -> str:
    """ Sprawdza czy token wygasł. Jeżeli tak, odświeża go. """
    if time.time() > tokens.expires_at:
        async with httpx.AsyncClient() as client:
            response = await client.post("https://www.strava.com/oauth/token", data={
                "client_id": STRAVA_CLIENT_ID,
                "client_secret": STRAVA_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "refresh_token": tokens.refresh_token
            })
            
            if response.status_code == 200:
                data = response.json()
                tokens.access_token = data["access_token"]
                tokens.refresh_token = data["refresh_token"]
                tokens.expires_at = data["expires_at"]
                session.commit()
                # Zwróć nowy akses token
                return tokens.access_token
            else:
                raise Exception("Nie udało się odświeżyć tokenu Strava. Użytkownik musi zautoryzować aplikację ponownie.")
    return tokens.access_token

def decode_polyline_to_geojson(poly: str) -> dict:
    """ Konwertuje the Google encoded polyline format string do standardu GeoJSON formated coords """
    coords = polyline.decode(poly)
    # polyline rzuca [(lat, lng)] ale GeoJSON chce [[lng, lat]]
    geojson_coords = [[lng, lat] for lat, lng in coords]
    
    return {
        "type": "Feature",
        "properties": {},
        "geometry": {
            "type": "LineString",
            "coordinates": geojson_coords
        }
    }

async def fetch_strava_activities(user_id: int, session: Session, limit: int = 10) -> list:
    statement = select(StravaTokens).where(StravaTokens.user_id == user_id)
    tokens = session.exec(statement).first()
    
    if not tokens:
        raise Exception("Brak podłączonego konta Strava")
        
    access_token = await refresh_strava_token_if_needed(tokens, session)
    
    # Pobieramy więcej, żeby po przefiltrowaniu mieć wystarczająco biegów
    fetch_limit = min(max(limit * 3, 50), 200)
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://www.strava.com/api/v3/athlete/activities?per_page={fetch_limit}",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        
    if response.status_code != 200:
        raise Exception(f"Błąd Strava API: {response.text}")
        
    activities = response.json()
    parsed_activities = []
    
    for act in activities:
        # Zostawiamy tylko treningi biegowe
        act_type = act.get("type") or ""
        sport_type = act.get("sport_type") or ""
        if "run" not in act_type.lower() and "run" not in sport_type.lower():
            continue

        # Płacą za mapę tylko po polyline (niezależnie jak obcięta lub wygładzona)
        map_poly = act.get("map", {}).get("summary_polyline")
        geojson_feature = None
        if map_poly:
            geojson_feature = decode_polyline_to_geojson(map_poly)
            # Uzupełniamy dystans po to tylko, żeby był pod ręką
            geojson_feature["properties"]["distance_m"] = act.get("distance", 0)
            
        parsed_activities.append({
            "id": act["id"],
            "name": act["name"],
            "distance_m": act.get("distance", 0),
            "moving_time_s": act.get("moving_time", 0),
            "average_heartrate": act.get("average_heartrate", None), # Dla Kasi :)
            "start_date": act["start_date"],
            "geojson": geojson_feature
        })
        
        if len(parsed_activities) >= limit:
            break
        
    return parsed_activities
