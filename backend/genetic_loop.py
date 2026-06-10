import networkx as nx
import osmnx as ox
import math
import random
from typing import List, Tuple, Dict, Any, Optional

# ─────────────────────────────────────────────────────────────────────────────
# KONFIGURACJA - Mach 2.2 'Dry Land' Stable (Yesterday 17:00) 🌊🚫
# ─────────────────────────────────────────────────────────────────────────────
# Mnożnik spalonego mostu (Soft Burn). Im większy, tym rzadziej trasa się nakłada.
# Wartość 10.0 to złoty środek między brakiem powrotów a gwarancją domknięcia pętli.
SOFT_BURN_MULTIPLIER = 10.0

# Wagi dla hierarchii dróg. Wolimy asfalt i główne arterie niż podwórka.
HIERARCHY_WEIGHTS = {
    'primary': 0.8,
    'secondary': 0.9,
    'tertiary': 1.0,
    'residential': 1.1,
    'service': 2.0,
    'track': 3.0,
    'path': 1.5,
    'footway': 1.2
}

def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0 # Promień ziemi w km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def sanitize_graph(G: nx.MultiGraph) -> nx.MultiGraph:
    """
    Usuwa ślepe skoki przez rzeki i budynki (tzw. 'blind jumps' bez geometrii).
    Standard Mach 2.2: length > 300m + brak danych o zakrętach = DELETE.
    """
    to_remove = []
    for u, v, k, data in G.edges(keys=True, data=True):
        # Jeśli segment jest podejrzanie długi i nie ma precyzyjnej geometrii OSM
        if data.get('length', 0) > 300 and 'geometry' not in data:
            to_remove.append((u, v, k))
            
    G.remove_edges_from(to_remove)
    print(f"  🌊 Dry Land Purge: Usunięto {len(to_remove)} skoków przez wodę/budynki.")
    return G

def _get_edge_cost(u, v, data, visited_edges: set = None) -> float:
    """
    Oblicza koszt krawędzi z uwzględnieniem Soft Bridge Burning i Hierarchii.
    """
    length = data.get('length', 0)
    h_type = data.get('highway', 'residential')
    if isinstance(h_type, list): h_type = h_type[0]
    
    # Podstawowa waga z hierarchii
    h_weight = HIERARCHY_WEIGHTS.get(h_type, 1.2)
    cost = length * h_weight
    
    # Soft Burn (Yesterday 17:00 feature)
    if visited_edges and (u, v) in visited_edges:
        cost *= SOFT_BURN_MULTIPLIER
        
    return cost

def genetic_algorithm(G: nx.MultiGraph, start_node: int, target_dist: float) -> Tuple[Optional[Dict], float, int, float]:
    """
    Zrekonstruowany silnik Dijkstra-based (Mach 2.2).
    Nazwa zachowana dla kompatybilności z main.py, ale logika to deterministyczny Dijkstra.
    """
    print(f"  🎯 Dijkstra Router (Mach 2.2) | Target: {target_dist/1000:.1f}km")
    
    # 1. Znajdź potencjalne punkty nawrotu (turnaround nodes) w odpowiedniej odległości
    start_lat = G.nodes[start_node]['y']
    start_lon = G.nodes[start_node]['x']
    
    # straight_line_target ~ 0.45 * target_dist (połowa z zapasem na krętość)
    sl_target_km = (target_dist / 2000.0) * 0.85
    tolerance_km = sl_target_km * 0.3
    
    candidates = []
    degrees = dict(G.degree())
    for n, data in G.nodes(data=True):
        if n == start_node: continue
        if degrees[n] < 3: continue # Tylko skrzyżowania
        
        dist = haversine(start_lat, start_lon, data['y'], data['x'])
        if abs(dist - sl_target_km) <= tolerance_km:
            candidates.append(n)
            
    if not candidates:
        print("  ❌ Brak kandydatów na skrzyżowania zawrotne.")
        return None, 0, 0, 0

    # Sortuj po dystansie, żeby zacząć od najbardziej obiecujących
    candidates.sort(key=lambda n: abs(haversine(start_lat, start_lon, G.nodes[n]['y'], G.nodes[n]['x']) - sl_target_km))
    
    best_res = None
    best_diff = float('inf')
    
    # 2. Iteruj po najlepszych kandydatach
    for turnaround in candidates[:40]:
        try:
            # Outbound: najkrótsza droga 'tam'
            out_path = nx.shortest_path(G, start_node, turnaround, weight=lambda u, v, d: _get_edge_cost(u, v, d))
            
            # Zapamiętaj 'spalone' krawędzie
            visited = set()
            for i in range(len(out_path) - 1):
                u, v = out_path[i], out_path[i+1]
                visited.add((u, v))
                visited.add((v, u))
                
            # Inbound: droga powrotna z karnym mnożnikiem (SOFT_BURN)
            in_path = nx.shortest_path(G, turnaround, start_node, weight=lambda u, v, d: _get_edge_cost(u, v, d, visited))
            
            # Złóż całą trasę
            full_path = out_path + in_path[1:]
            
            # Wylicz dystans rzeczywisty
            real_dist = 0
            for i in range(len(full_path) - 1):
                u, v = full_path[i], full_path[i+1]
                edge_data = G.get_edge_data(u, v)
                # Wybieramy najkrótszą krawędź między węzłami
                real_dist += min([d.get('length', 0) for d in edge_data.values()])
                
            diff = abs(real_dist - target_dist)
            if diff < best_diff:
                best_diff = diff
                # GeoJSON formatting
                coords = [[G.nodes[n]['x'], G.nodes[n]['y']] for n in full_path]
                best_res = ({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {
                        "distance_m": real_dist,
                        "engine": "Dijkstra-Mach2.2",
                        "v": "7.9"
                    }
                }, real_dist, 0, 100 - (diff/target_dist)*100)
                
                # Jeśli trafiony idealnie (<5% błędu) - wyjdź
                if diff < target_dist * 0.05:
                    break
        except (nx.NetworkXNoPath, Exception):
            continue
            
    return best_res if best_res else (None, 0, 0, 0)
