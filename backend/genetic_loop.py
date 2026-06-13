import networkx as nx
import osmnx as ox
import math
import random
import logging
from typing import List, Tuple, Dict, Any, Optional

logger = logging.getLogger(__name__)

SOFT_BURN_MULTIPLIER = 50.0
MAX_OVERLAP = 0.15
DIST_UPPER_TOLERANCE = 1.15

# Kary za skręty — dodawane do kosztu krawędzi wychodzącej ze skrzyżowania.
# Nie wpływają na mierzony dystans, tylko na decyzje routingu.
TURN_PENALTY_M = 50.0    # skręt > 45°
UTURN_PENALTY_M = 250.0  # skręt > 135° (prawie zawrotka)

HIERARCHY_WEIGHTS: Dict[str, float] = {
    # Nagradzamy — parki, ścieżki rowerowe, trasy piesze
    'cycleway':      0.7,
    'path':          0.8,
    'pedestrian':    0.8,
    'track':         0.85,
    # Neutralne
    'living_street': 0.95,
    'unclassified':  1.1,
    # Lekka kara — wąskie chodniki i osiedlowe uliczki
    'footway':       1.2,
    'residential':   1.2,
    # Kara — drogi bez dedykowanej infrastruktury pieszej
    'tertiary':      1.8,
    'secondary':     3.0,
    # Ostateczność — arterie
    'primary':       5.0,
    'trunk':         5.0,
    'service':       2.5,
}


# ─────────────────────────────────────────────────────────────
# Geometria
# ─────────────────────────────────────────────────────────────

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _compute_bearing(G: nx.MultiGraph, u: int, v: int) -> float:
    """Azymut geograficzny od węzła u do v [0, 360)."""
    lat1 = math.radians(G.nodes[u]['y'])
    lat2 = math.radians(G.nodes[v]['y'])
    dlon = math.radians(G.nodes[v]['x'] - G.nodes[u]['x'])
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _turn_angle(bearing_in: float, bearing_out: float) -> float:
    """Absolutny kąt skrętu [0, 180] stopni."""
    diff = abs(bearing_out - bearing_in) % 360
    return min(diff, 360 - diff)


def _precompute_bearings(G: nx.MultiGraph) -> Dict[Tuple[int, int], float]:
    """Oblicza i cache'uje azymuty dla wszystkich krawędzi grafu."""
    cache: Dict[Tuple[int, int], float] = {}
    for u in G.nodes():
        for v in G.neighbors(u):
            cache[(u, v)] = _compute_bearing(G, u, v)
    return cache


# ─────────────────────────────────────────────────────────────
# Przygotowanie grafu
# ─────────────────────────────────────────────────────────────

def sanitize_graph(G: nx.MultiGraph) -> nx.MultiGraph:
    """
    Usuwa krawędzie >300m bez geometrii OSM (ślepe skoki przez rzeki/budynki).
    Zachowuje tylko największą składową spójną.
    """
    to_remove = [
        (u, v, k)
        for u, v, k, data in G.edges(keys=True, data=True)
        if data.get('length', 0) > 300 and 'geometry' not in data
    ]
    G.remove_edges_from(to_remove)
    logger.info("Dry Land Purge: usunięto %d krawędzi-skoków", len(to_remove))

    if not nx.is_connected(G):
        largest_cc = max(nx.connected_components(G), key=len)
        removed = G.number_of_nodes() - len(largest_cc)
        G = G.subgraph(largest_cc).copy()
        logger.info("Graf rozspójniony — %d węzłów usuniętych", removed)

    return G


def _prune_dead_ends(
    G: nx.MultiGraph,
    protected_nodes: set,
    start_node: int,
) -> nx.MultiGraph:
    """
    Jeden przebieg usuwania węzłów stopnia 1 (ślepe zaułki) nie będących w protected_nodes.
    Po usunięciu zachowuje składową spójną zawierającą start_node.
    """
    dead_ends = [
        n for n in G.nodes()
        if len(set(G.neighbors(n))) == 1 and n not in protected_nodes
    ]
    if not dead_ends:
        return G

    H = G.copy()
    H.remove_nodes_from(dead_ends)
    logger.info("Dead-end pruning: usunięto %d węzłów (%d → %d)",
                len(dead_ends), G.number_of_nodes(), H.number_of_nodes())

    if start_node not in H:
        logger.warning("Start node usunięty — używam pełnego grafu")
        return G

    if not nx.is_connected(H):
        cc = nx.node_connected_component(H, start_node)
        H = H.subgraph(cc).copy()

    return H


# ─────────────────────────────────────────────────────────────
# Arc Graph — graf krawędziowy z karami za skręty
#
# Węzeł w arc graph = (u, v) = "właśnie biegnę krawędzią u→v"
# Krawędź w arc graph = (u,v)→(v,w) z wagą = koszt(v,w) + kara_za_skręt(u,v,w)
# Routowanie używa nx.dijkstra_path (implementacja C) zamiast pure-Python Dijkstry.
# ─────────────────────────────────────────────────────────────

def _edge_base_cost(G: nx.MultiGraph, u: int, v: int) -> float:
    """Minimalny koszt krawędzi u→v (najkrótsza krawędź równoległa × waga hierarchii)."""
    edge_data = G.get_edge_data(u, v)
    best = min(edge_data.values(), key=lambda d: d.get('length', 0))
    length = best.get('length', 0)
    h_type = best.get('highway', 'residential')
    if isinstance(h_type, list):
        h_type = h_type[0]
    return length * HIERARCHY_WEIGHTS.get(h_type, 1.2)


def _build_arc_graph(
    G: nx.MultiGraph,
    bearing_cache: Dict[Tuple[int, int], float],
) -> nx.DiGraph:
    """
    Buduje arc graph dla grafu G z precomputowanymi azymutami.
    Zbudowany raz per genetic_algorithm — wielokrotnie używany przez segmenty.

    Każda krawędź w arc graph przechowuje:
      base_cost  — rzeczywisty koszt krawędzi wychodzącej (bez kary za skręt)
      turn_cost  — kara za skręt (0 / TURN_PENALTY_M / UTURN_PENALTY_M)
    """
    L = nx.DiGraph()

    # Węzły = wszystkie skierowane krawędzie G
    for u in G.nodes():
        for v in G.neighbors(u):
            L.add_node((u, v), base_cost=_edge_base_cost(G, u, v))

    # Krawędzie = przejścia między krawędziami (skrzyżowania)
    for mid in G.nodes():
        neighbors = list(G.neighbors(mid))
        for prev in neighbors:
            b_in = bearing_cache.get((prev, mid), 0.0)
            for nxt in neighbors:
                if nxt == prev:
                    continue  # żadnych zawróceń (U-turn) w arc graph
                b_out = bearing_cache.get((mid, nxt), 0.0)
                angle = _turn_angle(b_in, b_out)

                if angle > 135:
                    turn_cost = UTURN_PENALTY_M
                elif angle > 45:
                    turn_cost = TURN_PENALTY_M
                else:
                    turn_cost = 0.0

                L.add_edge(
                    (prev, mid), (mid, nxt),
                    base_cost=L.nodes[(mid, nxt)]['base_cost'],
                    turn_cost=turn_cost,
                )

    return L


def _route_arc_graph(
    L: nx.DiGraph,
    G: nx.MultiGraph,
    source: int,
    target: int,
    visited_edges: set,
) -> Optional[Tuple[List[int], float]]:
    """
    Routuje source→target na arc graph L.
    visited_edges to zbiór (u,v) krawędzi już przejechanych (soft burn).

    Dodaje tymczasowe węzły _src i _tgt do L, usuwa je po zakończeniu.
    """
    if source == target:
        return [source], 0.0

    # Sprawdź czy source i target są w grafie G
    # (arc graph może nie mieć łuków jeśli węzeł jest izolowany)
    if source not in G or target not in G:
        return None

    def _weight(_arc_in, arc_out, data: dict) -> float:
        base = data.get('base_cost', 0.0)
        turn = data.get('turn_cost', 0.0)
        burn = SOFT_BURN_MULTIPLIER if arc_out in visited_edges else 1.0
        return base * burn + turn

    # Tymczasowe węzły super-source i super-target
    L.add_node('_src')
    L.add_node('_tgt')

    for v in G.neighbors(source):
        arc = (source, v)
        if arc in L:
            cost = L.nodes[arc]['base_cost']
            L.add_edge('_src', arc, base_cost=cost, turn_cost=0.0)

    for u in G.neighbors(target):
        arc = (u, target)
        if arc in L:
            L.add_edge(arc, '_tgt', base_cost=0.0, turn_cost=0.0)

    path_L = None
    try:
        path_L = nx.dijkstra_path(L, '_src', '_tgt', weight=_weight)
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        pass
    finally:
        L.remove_node('_src')
        L.remove_node('_tgt')

    if not path_L:
        return None

    # Przetłumacz ścieżkę arc-graph z powrotem na węzły G
    # path_L = ['_src', (s,v1), (v1,v2), ..., (u,target), '_tgt']
    path_G: List[int] = [source]
    for arc in path_L[1:-1]:  # pomiń _src i _tgt
        path_G.append(arc[1])

    if not path_G or path_G[-1] != target:
        return None

    # Dystans rzeczywisty (bez kar — tylko długości OSM)
    real_dist = 0.0
    for i in range(len(path_G) - 1):
        pu, pv = path_G[i], path_G[i + 1]
        edata = G.get_edge_data(pu, pv)
        if edata:
            real_dist += min(d.get('length', 0) for d in edata.values())

    return path_G, real_dist


# ─────────────────────────────────────────────────────────────
# Geometria trasy — pełna, nie tylko węzły
# ─────────────────────────────────────────────────────────────

def _path_to_coords(G: nx.MultiGraph, full_path: List[int]) -> List[List[float]]:
    """
    Konwertuje ścieżkę węzłów na listę współrzędnych GeoJSON, używając
    pełnej geometrii krawędzi OSM (nie tylko pozycji węzłów-skrzyżowań).
    Dzięki temu trasa "leży" gładko na ulicy zamiast ciąć przez budynki.
    """
    if not full_path:
        return []

    coords: List[List[float]] = []

    for i in range(len(full_path) - 1):
        u, v = full_path[i], full_path[i + 1]
        edge_data = G.get_edge_data(u, v)
        if not edge_data:
            if not coords:
                coords.append([G.nodes[u]['x'], G.nodes[u]['y']])
            coords.append([G.nodes[v]['x'], G.nodes[v]['y']])
            continue

        best_edge = min(edge_data.values(), key=lambda d: d.get('length', float('inf')))

        if 'geometry' in best_edge:
            pts = list(best_edge['geometry'].coords)  # [(lon, lat), ...]
            # Geometria może być zapisana w kierunku v→u — sprawdź orientację.
            u_x, u_y = G.nodes[u]['x'], G.nodes[u]['y']
            v_x, v_y = G.nodes[v]['x'], G.nodes[v]['y']
            first_x, first_y = pts[0]
            d_first_to_u = (first_x - u_x) ** 2 + (first_y - u_y) ** 2
            d_first_to_v = (first_x - v_x) ** 2 + (first_y - v_y) ** 2
            if d_first_to_v < d_first_to_u:
                pts = pts[::-1]

            if not coords:
                coords.extend([list(p) for p in pts])
            else:
                coords.extend([list(p) for p in pts[1:]])
        else:
            if not coords:
                coords.append([G.nodes[u]['x'], G.nodes[u]['y']])
            coords.append([G.nodes[v]['x'], G.nodes[v]['y']])

    return coords


# ─────────────────────────────────────────────────────────────
# Scoring
# ─────────────────────────────────────────────────────────────

def _overlap_ratio(full_path: List[int]) -> float:
    """Frakcja krawędzi przejechanych drugi raz. Czysta pętla → ~0.0."""
    seen: set = set()
    total = 0
    reused = 0
    for i in range(len(full_path) - 1):
        u, v = full_path[i], full_path[i + 1]
        key = (min(u, v), max(u, v))
        if key in seen:
            reused += 1
        else:
            seen.add(key)
        total += 1
    return reused / total if total > 0 else 1.0


def _dead_end_fraction(full_path: List[int], dead_end_nodes: set) -> float:
    """Frakcja wewnętrznych węzłów trasy będących ślepymi zaułkami."""
    if len(full_path) <= 2 or not dead_end_nodes:
        return 0.0
    interior = full_path[1:-1]
    hits = sum(1 for n in interior if n in dead_end_nodes)
    return hits / len(interior)


# ─────────────────────────────────────────────────────────────
# Waypoint routing
# ─────────────────────────────────────────────────────────────

def _waypoints_on_circle(
    center_lat: float,
    center_lon: float,
    radius_km: float,
    n: int,
    offset_deg: float = 0.0,
) -> List[Tuple[float, float]]:
    """Generuje N punktów (lat, lon) równomiernie na okręgu o promieniu radius_km."""
    lat_rad = math.radians(center_lat)
    points = []
    for i in range(n):
        angle_rad = math.radians(offset_deg + i * 360.0 / n)
        dlat = (radius_km / 111.0) * math.cos(angle_rad)
        dlon = (radius_km / (111.0 * math.cos(lat_rad))) * math.sin(angle_rad)
        points.append((center_lat + dlat, center_lon + dlon))
    return points


def _try_waypoint_config(
    G: nx.MultiGraph,
    L: nx.DiGraph,
    L_full: nx.DiGraph,
    start_node: int,
    start_lat: float,
    start_lon: float,
    target_dist_km: float,
    n_waypoints: int,
    offset_deg: float,
    radius_scale: float = 1.0,
    min_side_multiplier: float = 0.3,
) -> Optional[Tuple[List[int], float]]:
    """
    Jedna konfiguracja wielokąta.
    L = arc graph G_pruned (preferowany), L_full = arc graph G (fallback).
    Zwraca (full_path, total_dist_m) lub None.

    radius_scale: skalowanie promienia (1.0 = idealny, 0.8/1.2 = wariacje)
    min_side_multiplier: filtr minimalnej długości boku (0 = wyłączony)
    """
    winding = 1.25
    poly_factor = 1 + n_waypoints * math.sin(math.pi / n_waypoints)
    ideal_radius_km = target_dist_km / (2 * winding * poly_factor) * radius_scale

    wp_coords = _waypoints_on_circle(start_lat, start_lon, ideal_radius_km, n_waypoints, offset_deg)

    lons = [lon for _, lon in wp_coords]
    lats = [lat for lat, _ in wp_coords]
    raw_nodes = ox.distance.nearest_nodes(G, lons, lats)

    seen: set = {start_node}
    wp_nodes: List[int] = []
    for node in raw_nodes:
        if node not in seen:
            wp_nodes.append(node)
            seen.add(node)

    if len(wp_nodes) < 2:
        return None

    if min_side_multiplier > 0:
        min_side_km = ideal_radius_km * min_side_multiplier
        for i in range(len(wp_nodes)):
            n1 = wp_nodes[i]
            n2 = wp_nodes[(i + 1) % len(wp_nodes)]
            d = haversine(G.nodes[n1]['y'], G.nodes[n1]['x'], G.nodes[n2]['y'], G.nodes[n2]['x'])
            if d < min_side_km:
                return None

    full_path: List[int] = [start_node]
    visited_edges: set = set()
    total_dist = 0.0
    current = start_node

    for wp in wp_nodes + [start_node]:
        if wp == current:
            continue

        # Próbuj pruned arc graph — bez ślepych zaułków
        result = _route_arc_graph(L, G, current, wp, visited_edges)
        if result is None:
            # Fallback: pełny arc graph
            result = _route_arc_graph(L_full, G, current, wp, visited_edges)
        if result is None:
            return None

        segment, seg_dist = result
        for i in range(len(segment) - 1):
            u, v = segment[i], segment[i + 1]
            visited_edges.add((u, v))
            visited_edges.add((v, u))

        full_path.extend(segment[1:])
        total_dist += seg_dist
        current = wp

    return full_path, total_dist


# ─────────────────────────────────────────────────────────────
# Główna funkcja
# ─────────────────────────────────────────────────────────────

def genetic_algorithm(
    G: nx.MultiGraph,
    start_node: int,
    target_dist: float,
) -> Tuple[Optional[Dict], float, int, float]:
    """
    Waypoint Polygon Loop Generator z wygładzaniem trasy.

    Pipeline:
      1. Pruning dead-ends → G_pruned
      2. Build arc graphs (raz) → L_pruned, L_full
      3. Per config: route waypoints używając arc graph z karami za skręty
      4. Scoring: overlap × 10 + dist_err + dead_end_frac × 2
    """
    logger.info("Waypoint Router | target=%.1fkm", target_dist / 1000)

    start_lat = G.nodes[start_node]['y']
    start_lon = G.nodes[start_node]['x']
    target_dist_km = target_dist / 1000.0
    dist_cap = target_dist * DIST_UPPER_TOLERANCE

    dead_end_nodes: set = {n for n in G.nodes() if len(set(G.neighbors(n))) == 1}
    logger.info("Dead-end nodes: %d / %d (%.0f%%)",
                len(dead_end_nodes), G.number_of_nodes(),
                100 * len(dead_end_nodes) / max(G.number_of_nodes(), 1))

    # 1. Pruning — jeden przebieg, chroniony start
    G_pruned = _prune_dead_ends(G, {start_node}, start_node)

    # 2. Bearing cache + arc graphs (built once)
    logger.info("Budowanie arc graph dla %d węzłów...", G_pruned.number_of_nodes())
    bc_pruned = _precompute_bearings(G_pruned)
    L_pruned = _build_arc_graph(G_pruned, bc_pruned)

    bc_full = _precompute_bearings(G)
    L_full = _build_arc_graph(G, bc_full)
    logger.info("Arc graph gotowy: %d węzłów, %d krawędzi",
                L_pruned.number_of_nodes(), L_pruned.number_of_edges())

    best_result: Optional[Tuple[List[int], float]] = None

    def _score(full_path: List[int], total_dist: float) -> float:
        overlap = _overlap_ratio(full_path)
        dist_err = abs(total_dist - target_dist) / target_dist
        de_frac = _dead_end_fraction(full_path, dead_end_nodes)
        return overlap * 10.0 + dist_err + de_frac * 2.0

    def _run_tier(
        n_list: List[int],
        offset_step: int,
        radius_scales: List[float],
        dist_limit: float,
        max_overlap: float,
        min_side_mult: float,
        early_exit_score: float,
    ) -> Optional[Tuple[List[int], float]]:
        tier_best: Optional[Tuple[List[int], float]] = None
        tier_score = float('inf')
        configs = [
            (n, offset, rs)
            for n in n_list
            for offset in range(0, 360, offset_step)
            for rs in radius_scales
        ]
        random.shuffle(configs)
        for n_wp, off, rs in configs:
            result = _try_waypoint_config(
                G, L_pruned, L_full,
                start_node, start_lat, start_lon,
                target_dist_km, n_wp, off,
                radius_scale=rs,
                min_side_multiplier=min_side_mult,
            )
            if result is None:
                continue
            fp, td = result
            if td > dist_limit:
                continue
            ov = _overlap_ratio(fp)
            if ov > max_overlap:
                continue
            s = _score(fp, td)
            if s < tier_score:
                tier_score = s
                tier_best = result
                if s < early_exit_score:
                    logger.info("Early exit: score=%.3f", s)
                    return tier_best
        return tier_best

    # Tier 1 — standardowy: 36 konfiguracji (sprawdzone), ścisłe kryteria
    best_result = _run_tier(
        n_list=[4, 3, 5],
        offset_step=30,
        radius_scales=[1.0],
        dist_limit=dist_cap,
        max_overlap=MAX_OVERLAP,
        min_side_mult=0.3,
        early_exit_score=0.15,
    )

    # Tier 2 — łagodniejszy: inne promienie + brak filtra boku, szerszy cap
    if best_result is None:
        logger.warning("Tier 1 failed — próbuję Tier 2")
        best_result = _run_tier(
            n_list=[4, 3, 5],
            offset_step=30,
            radius_scales=[0.85, 1.15],
            dist_limit=target_dist * 1.30,
            max_overlap=0.30,
            min_side_mult=0.0,
            early_exit_score=0.5,
        )

    # Tier 3 — ostateczność: lollipop (n=2), bardzo luzne kryteria
    if best_result is None:
        logger.warning("Tier 2 failed — ostateczny fallback Tier 3")
        best_result = _run_tier(
            n_list=[2, 3],
            offset_step=45,
            radius_scales=[0.8, 1.0, 1.2],
            dist_limit=target_dist * 1.50,
            max_overlap=0.60,
            min_side_mult=0.0,
            early_exit_score=2.0,
        )

    if best_result is None:
        logger.error("Brak trasy dla %.1fkm", target_dist_km)
        return None, 0, 0, 0

    full_path, real_dist = best_result
    best_diff = abs(real_dist - target_dist)
    coords = _path_to_coords(G, full_path)
    fit_score = max(0.0, 100.0 - (best_diff / target_dist) * 100.0)

    feature: Dict[str, Any] = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {
            "distance_m": real_dist,
            "engine": "WaypointPolygon-v1",
            "v": "8.3",
        },
    }
    return feature, real_dist, 0, fit_score
