import React, { useState, useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { MapContainer, TileLayer, Polyline, useMapEvents, Marker, Popup, useMap, Tooltip, GeoJSON } from 'react-leaflet';
import L, { LatLngExpression } from 'leaflet';
import { Home } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { RouteSegment, Waypoint } from '../types/routing';
import { LocationState } from '../App';
import { useTheme } from '../context/ThemeContext';

const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

interface MapInteractionsProps {
  onAddWaypoint: (point: LatLngExpression) => void;
}

const MapInteractions = ({ onAddWaypoint }: MapInteractionsProps) => {
  useMapEvents({
    click(e) {
      onAddWaypoint([e.latlng.lat, e.latlng.lng]);
    }
  });
  return null;
};

const MapUpdater = ({ location }: { location: LocationState }) => {
  const map = useMap();
  useEffect(() => {
    map.flyTo([location.lat, location.lng], location.zoom, { duration: 1.5 });
  }, [location.lat, location.lng, location.zoom, map]);
  return null;
}

const RouteEditor = ({ waypoints, segments, onInsertWaypoint }: any) => {
  const map = useMap();
  const { theme } = useTheme();
  const [dragTempPt, setDragTempPt] = useState<{latlng: LatLngExpression, afterId: string} | null>(null);
  const routeColor = theme === 'light' ? '#90B300' : '#CEFF00';

  useMapEvents({
    mousemove(e) {
      if (dragTempPt) {
        setDragTempPt({ ...dragTempPt, latlng: [e.latlng.lat, e.latlng.lng] });
      }
    },
    mouseup() {
      if (dragTempPt) {
        onInsertWaypoint(dragTempPt.afterId, dragTempPt.latlng);
        setDragTempPt(null);
        map.dragging.enable();
      }
    }
  });

  return (
    <>
      {segments.map((seg: RouteSegment) => {
        const isBeingSplit = dragTempPt?.afterId === seg.fromId;

        if (isBeingSplit && dragTempPt) {
          const fromWp = waypoints.find((w: Waypoint) => w.id === seg.fromId);
          const toWp = waypoints.find((w: Waypoint) => w.id === seg.toId);
          if (fromWp && toWp) {
            return (
              <React.Fragment key={`${seg.fromId}-${seg.toId}-split`}>
                <Polyline positions={[fromWp.latlng, dragTempPt.latlng]} pathOptions={{ color: routeColor, weight: 4, dashArray: '5,5' }} />
                <Polyline positions={[dragTempPt.latlng, toWp.latlng]} pathOptions={{ color: routeColor, weight: 4, dashArray: '5,5' }} />
              </React.Fragment>
            );
          }
        }

        return (
          <Polyline 
            key={`${seg.fromId}-${seg.toId}`}
            positions={seg.geojson} 
            pathOptions={{ 
              color: seg.isError ? '#ef4444' : routeColor, 
              weight: 6, 
              className: seg.isLoading ? 'animate-pulse opacity-40' : 'cursor-grab hover:opacity-100 transition-opacity',
              opacity: seg.isLoading ? 0.4 : 0.85
            }}
            eventHandlers={{
              mousedown: (e) => {
                map.dragging.disable();
                setDragTempPt({ latlng: [e.latlng.lat, e.latlng.lng], afterId: seg.fromId });
              }
            }}
          />
        );
      })}

      {dragTempPt && (
        <Marker 
          position={dragTempPt.latlng}
          icon={L.divIcon({
            html: `<div class="bg-[var(--color-accent)] w-4 h-4 rounded-full border-[3px] border-white shadow-xl"></div>`,
            className: 'bg-transparent border-none',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          })} 
        />
      )}
    </>
  );
};


interface MapComponentProps {
  waypoints: Waypoint[];
  segments: RouteSegment[];
  location: LocationState;
  routeData?: any;
  onAddWaypoint: (point: LatLngExpression) => void;
  onUpdateWaypoint: (id: string, point: LatLngExpression) => void;
  onInsertWaypoint: (afterId: string, point: LatLngExpression) => void;
  onRemoveWaypoint: (id: string) => void;
}

const createMarkerIcon = (isStart: boolean, isEnd: boolean) => {
  const bgColor = isStart ? 'bg-emerald-500' : isEnd ? 'bg-red-500' : 'bg-blue-500';
  const size = isStart || isEnd ? 'w-5 h-5' : 'w-4 h-4';
  return L.divIcon({
    html: `<div class="${bgColor} ${size} rounded-full border-2 border-white shadow-lg transition-all duration-300 hover:scale-125 cursor-grab active:cursor-grabbing"></div>`,
    className: 'bg-transparent border-none',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

const homeIconHtml = renderToString(<Home className="w-5 h-5 text-primary" style={{ color: 'var(--color-accent)' }} />);
const homeMarkerIcon = L.divIcon({
  html: `<div class="bg-[var(--color-surface)] w-9 h-9 flex items-center justify-center rounded-[var(--radius)] border border-[var(--color-border)] hover:border-[var(--color-accent)] shadow-xl transition-all duration-300 hover:scale-110 cursor-pointer">
           ${homeIconHtml}
         </div>`,
  className: 'bg-transparent border-none',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

export const MapComponent = ({ waypoints, segments, location, routeData, onAddWaypoint, onUpdateWaypoint, onInsertWaypoint, onRemoveWaypoint }: MapComponentProps) => {
  const { theme } = useTheme();
  const tileUrl = theme === 'light' ? TILE_LIGHT : TILE_DARK;
  const routeColor = theme === 'light' ? '#90B300' : '#CEFF00';
  const hasRoute = !!(routeData || waypoints.length > 0);

  // Sprawdzamy czy pierwszy waypoint nakłada się na pozycję bazy
  const isStartAtBase = waypoints.length > 0 && 
    Math.abs((Array.isArray(waypoints[0].latlng) ? waypoints[0].latlng[0] : (waypoints[0].latlng as any).lat) - location.lat) < 0.0001 &&
    Math.abs((Array.isArray(waypoints[0].latlng) ? waypoints[0].latlng[1] : (waypoints[0].latlng as any).lng) - location.lng) < 0.0001;

  return (
    <div className="relative h-full w-full">
      <MapContainer 
        center={[location.lat, location.lng]} 
        zoom={location.zoom} 
        className="h-full w-full outline-none"
        zoomControl={false}
      >
        <MapUpdater location={location} />
        <TileLayer
          key={theme}
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={tileUrl}
        />
        <MapInteractions onAddWaypoint={onAddWaypoint} />
        
        {/* Ikona Domyślnej Bazy / GPS — ukrywana gdy nakłada się z rzeczywistym startem trasy */}
        {!isStartAtBase && (
          <Marker 
            position={[location.lat, location.lng]} 
            icon={homeMarkerIcon}
            zIndexOffset={-100}
          >
            <Tooltip 
              direction="top" 
              offset={[0, -15]} 
              opacity={0.95} 
              className="font-bold text-[var(--color-accent)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg rounded-[var(--radius)] px-3 py-1 font-mono-custom text-xs"
            >
              {location.cityName} (Baza)
            </Tooltip>
            <Popup className="min-w-[180px] p-0 m-0 custom-popup">
              <div 
                className="flex flex-col items-center gap-1.5 p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopPropagation();
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopPropagation();
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopPropagation();
                }}
              >
                <span className="font-display font-black text-primary text-[15px] tracking-tight">{location.cityName}</span>
                <span className="text-[10px] text-secondary font-mono-custom uppercase tracking-widest font-bold">Zapisana Baza / GPS</span>
                {!hasRoute && (
                  <button 
                    onClick={() => {
                      onAddWaypoint([location.lat, location.lng]);
                    }}
                    className="mt-2 bg-accent hover:bg-accent-hover text-accent-fg text-xs font-bold py-2 px-3 rounded-[var(--radius)] w-full transition-colors shadow-sm whitespace-nowrap uppercase tracking-wider font-display cursor-pointer"
                  >
                    Rozpocznij trasę stąd
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        <RouteEditor waypoints={waypoints} segments={segments} onInsertWaypoint={onInsertWaypoint} />

        {routeData && (
          <GeoJSON 
            key={JSON.stringify(routeData)} 
            data={routeData} 
            style={{
              color: routeColor,
              weight: 6,
              opacity: 0.85,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )}

        {waypoints.map((wp, idx) => {
          const startPt = waypoints.length >= 2 ? L.latLng(waypoints[0].latlng) : null;
          const endPt = waypoints.length >= 2 ? L.latLng(waypoints[waypoints.length - 1].latlng) : null;
          const isClosed = !!(startPt && endPt && startPt.lat === endPt.lat && startPt.lng === endPt.lng);
          const canCloseLoop = idx === 0 && waypoints.length >= 2 && !isClosed;

          return (
            <Marker 
              key={wp.id} 
              position={wp.latlng} 
              draggable={true}
              eventHandlers={{
                dragend: (e) => {
                  const pos = e.target.getLatLng();
                  onUpdateWaypoint(wp.id, [pos.lat, pos.lng]);
                },
                click: () => {
                  if (canCloseLoop) {
                     onAddWaypoint(wp.latlng);
                  }
                }
              }}
              icon={createMarkerIcon(idx === 0, idx === waypoints.length - 1 && waypoints.length > 1)} 
            >
              {canCloseLoop ? (
                <Tooltip direction="top" offset={[0, -10]} opacity={0.95} className="font-bold text-emerald-700 border-emerald-500 shadow-xl rounded-full px-3 py-1">
                  Kliknij by domknąć pętlę!
                </Tooltip>
              ) : (
                <Popup className="min-w-[140px] p-0 m-0 custom-popup">
                  <div 
                    className="flex flex-col items-center gap-1.5 p-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.nativeEvent.stopPropagation();
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      e.nativeEvent.stopPropagation();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.nativeEvent.stopPropagation();
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                      e.nativeEvent.stopPropagation();
                    }}
                  >
                    <span className="font-display font-bold text-primary text-sm">Punkt #{idx + 1}</span>
                    <span className="text-xs text-secondary text-center leading-tight">Możesz go przeciągnąć.</span>
                    <button 
                      onClick={() => onRemoveWaypoint(wp.id)}
                      className="mt-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2 px-3 rounded-[var(--radius)] w-full transition-colors shadow-sm uppercase tracking-wider font-display cursor-pointer"
                    >
                      Usuń punkt
                    </button>
                  </div>
                </Popup>
              )}
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};
