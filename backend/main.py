import os
import math
import networkx as nx
import osmnx as ox
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Dict, Optional
from pathlib import Path
from genetic_loop import genetic_algorithm, sanitize_graph

from database import create_db_and_tables
from routers import auth, routes, assistant, user as user_router, calendar as calendar_router

app = FastAPI(title="Ace of Pace API", description="Ace of Pace — AI Running Coach & Loop Router")

# W środowisku deweloperskim Vite może wystartować na dowolnym porcie (5173–5179, 3000 itp.).
# Zamiast listy hardkodowanych portów używamy regex-a, który obejmuje każdy localhost.
# Na produkcji FRONTEND_URL powinien być ustawiony na konkretną domenę.
_FRONTEND_ORIGIN_REGEX = r"http://localhost:\d+"

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_FRONTEND_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    # Upewnij się że katalog na avatary istnieje
    uploads_dir = Path(__file__).parent / "uploads" / "avatars"
    uploads_dir.mkdir(parents=True, exist_ok=True)

app.include_router(auth.router,          prefix="/api/auth",      tags=["auth"])
app.include_router(user_router.router,   prefix="/api/user",      tags=["user"])
app.include_router(routes.router,        prefix="/api/routes",    tags=["routes"])
app.include_router(assistant.router,     prefix="/api/assistant", tags=["assistant"])
app.include_router(calendar_router.router, prefix="/api/calendar", tags=["calendar"])

# Alias: /api/user/activities → auth router (legacy compat — frontend używa /api/user/activities)
app.include_router(auth.router, prefix="/api/user", tags=["user"], include_in_schema=False)

# Serwuj uploaded avatary jako statyczne pliki
_uploads_path = Path(__file__).parent / "uploads"
_uploads_path.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_path)), name="uploads")


class LoopRequest(BaseModel):
    lat: float
    lng: float
    distance_km: float

# ─────────────────────────────────────────────────────────────────────────────
# DYNAMIC GRAPH CACHE
# Cache key: (round(lat,2), round(lng,2), dist_bucket_km)
# Każda para lokalizacja+dystans trzyma swój własny graf w RAM.
# ─────────────────────────────────────────────────────────────────────────────
_graph_cache: Dict[str, nx.MultiGraph] = {}

def _get_or_fetch_graph(lat: float, lng: float, target_km: float) -> Optional[nx.MultiGraph]:
    """
    Zwraca graf dopasowany do target_km.
    dist = target_km * 1000 — bounding box wystarczająco duży na pełną pętlę.
    Cache key: zaokrąglone współrzędne + bucket dystansu (co 5km).
    """
    # Bucket co 5km — unikamy refetchowania dla nieznacznie różnych dystansów
    dist_bucket = max(5, int(math.ceil(target_km / 5.0)) * 5)
    lat_r = round(lat, 2)
    lon_r = round(lng, 2)
    cache_key = f"{lat_r},{lon_r},{dist_bucket}km"

    if cache_key in _graph_cache:
        print(f"  📦 Cache hit: {cache_key}")
        return _graph_cache[cache_key]

    # dist w metrach = target_km * 1300 (bounding box od centrum)
    # Zwiększamy bufor do 1.3x dystansu, żeby dać GA miejsce na manewry wokół celu
    dist_m = int(target_km * 1300)
    print(f"  🌍 Pobieranie OSM: center=({lat:.4f},{lng:.4f}), dist={dist_m}m [klucz: {cache_key}]")
    print(f"  ⏳ Pierwsze pobranie może zająć kilkanaście sekund...")

    try:
        G_raw = ox.graph_from_point(
            (lat, lng),
            dist=dist_m,
            network_type='walk',
            simplify=True,
        )
        G_un = nx.MultiGraph(G_raw.to_undirected())
        G_sane = sanitize_graph(G_un)
        _graph_cache[cache_key] = G_sane
        print(f"  ✅ Graf gotowy: {G_sane.number_of_nodes()} węzłów, {G_sane.number_of_edges()} krawędzi")
        return G_sane
    except Exception as e:
        print(f"  ❌ Błąd pobierania grafu: {e}")
        return None


# Warm-up: załaduj statyczny graf Mielca jeśli istnieje (opcjonalny pre-cache)
_static_path = os.path.join('data', 'mielec_graph.graphml')
if os.path.exists(_static_path):
    print(f"Wczytywanie statycznego grafu z {_static_path} jako warm-up cache...")
    try:
        _G_static = ox.load_graphml(_static_path)
        _G_static_un = nx.MultiGraph(_G_static.to_undirected())
        _G_static_sane = sanitize_graph(_G_static_un)
        # Wrzuć do cache jako domyślny Mielec ~13km
        _graph_cache["50.29,21.42,15km"] = _G_static_sane
        print("Statyczny graf wczytany do cache.")
    except Exception as e:
        print(f"WARNING: Nie udało się załadować statycznego grafu: {e}")
else:
    print("INFO: Brak statycznego grafu — grafy będą pobierane dynamicznie.")


@app.post("/api/generate-loop")
def generate_loop(request_data: LoopRequest):
    print(f"\n🚀 API Request: ({request_data.lat:.4f}, {request_data.lng:.4f}) | {request_data.distance_km}km")

    # 1. Pobierz (lub użyj cache) grafu dostatecznie dużego dla tego dystansu
    G = _get_or_fetch_graph(request_data.lat, request_data.lng, request_data.distance_km)
    if G is None:
        raise HTTPException(status_code=500, detail="Nie udało się pobrać mapy drogowej.")

    # 2. Snap start do najbliższego węzła
    print("  📍 Szukam najbliższego węzła...")
    start_node = ox.distance.nearest_nodes(G, request_data.lng, request_data.lat)
    target_dist_m = float(request_data.distance_km * 1000.0)

    # 3. Uruchom algorytm Dijkstra (Mach 2.2)
    print(f"  🧠 Uruchamiam Dijkstra Router v7.9 (węzeł={start_node})...")
    feature, actual_dist_m, overlaps, fit_score = genetic_algorithm(
        G, start_node,
        target_dist=target_dist_m
    )

    if not feature:
        print("  ❌ Nie udało się wygenerować trasy.")
        raise HTTPException(status_code=400, detail="Dla tej lokalizacji nie znaleziono czystej pętli.")

    print(f"  ✅ Pętla gotowa: {actual_dist_m:.1f}m (score={fit_score:.0f}%)")

    # Wizualne domknięcie: dociągnij do dokładnego kliknięcia użytkownika
    geojson_coords = feature['geometry']['coordinates']
    geojson_coords.insert(0, [request_data.lng, request_data.lat])
    geojson_coords.append([request_data.lng, request_data.lat])

    feature['geometry']['coordinates'] = geojson_coords
    feature['properties']['distance_m'] = actual_dist_m
    feature['properties']['overlaps'] = overlaps

    return {
        "type": "FeatureCollection",
        "features": [feature]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
