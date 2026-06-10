import osmnx as ox
import os

def main():
    center_point = (50.28626, 21.42156) # Mielec Center
    # Zwiększony promień do 13 km, aby bezpiecznie objąć Złotniki, Chorzelów i całe przedmieścia
    radius_meters = 13000 
    
    print(f"Pobieranie sieci dróg biegowych w promieniu {radius_meters}m od {center_point}...")
    
    G = ox.graph_from_point(center_point, dist=radius_meters, network_type='walk')
    
    print(f"Pobrano graf. Węzły: {len(G.nodes)}, Krawędzie: {len(G.edges)}")
    
    os.makedirs('data', exist_ok=True)
    out_path = os.path.join('data', 'mielec_graph.graphml')
    ox.save_graphml(G, out_path)
    print(f"Graf poprawnie zapisany do {out_path}!")

if __name__ == "__main__":
    main()
