import { useState, useEffect, useRef } from 'react';
import { RouteSegment, Waypoint } from '../types/routing';
import { fetchRouteSegment } from '../utils/routingApi';

export const useRouteSegments = (waypoints: Waypoint[]) => {
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  const activeFetches = useRef<Set<string>>(new Set());

  useEffect(() => {
    const targetSegments: { from: Waypoint, to: Waypoint }[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      targetSegments.push({ from: waypoints[i], to: waypoints[i + 1] });
    }

    setSegments(prev => {
      const newSegments: RouteSegment[] = [];
      
      targetSegments.forEach(({ from, to }) => {
        // Find existing segment
        const existing = prev.find(s => s.fromId === from.id && s.toId === to.id);
        
        if (existing) {
          newSegments.push(existing);
        } else {
          // It's a brand new segment linking two waypoints!
          newSegments.push({
            fromId: from.id,
            toId: to.id,
            geojson: [from.latlng, to.latlng],
            distance: 0,
            isLoading: true
          });
          
          const fetchKey = `${from.id}-${to.id}-${from.latlng.toString()}-${to.latlng.toString()}`;
          if (!activeFetches.current.has(fetchKey)) {
            activeFetches.current.add(fetchKey);
            
            fetchRouteSegment(from.latlng, to.latlng).then(res => {
              setSegments(current => 
                current.map(s => 
                  s.fromId === from.id && s.toId === to.id 
                    ? { ...s, geojson: res.geojson, distance: res.distance, isLoading: false, isError: res.error }
                    : s
                )
              );
            }).catch(() => {
              setSegments(current => 
                current.map(s => 
                  s.fromId === from.id && s.toId === to.id 
                    ? { ...s, isLoading: false, isError: true }
                    : s
                )
              );
            }).finally(() => {
              activeFetches.current.delete(fetchKey);
            });
          }
        }
      });

      return newSegments;
    });

  }, [waypoints]);

  const totalDistance = segments.reduce((acc, seg) => acc + seg.distance, 0);

  return { segments, totalDistance: (totalDistance / 1000).toFixed(2) };
};
