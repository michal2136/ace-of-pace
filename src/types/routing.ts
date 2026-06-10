import { LatLngExpression } from 'leaflet';

export interface Waypoint {
  id: string;
  latlng: LatLngExpression;
  isTemporary?: boolean;
}

export interface RouteSegment {
  fromId: string;
  toId: string;
  geojson: LatLngExpression[];
  distance: number;
  isLoading: boolean;
  isError?: boolean;
}
