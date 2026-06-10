import { LatLngExpression } from 'leaflet';

export const exportGpx = (points: LatLngExpression[]) => {
  if (points.length === 0) return;

  const gpxHeader = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Smart Loop Mapper">
  <trk>
    <name>Moja trasa z wybranymi punktami</name>
    <trkseg>
`;
  const gpxFooter = `    </trkseg>
  </trk>
</gpx>`;
  
  const gpxPoints = points.map((p: any) => {
    const lat = Array.isArray(p) ? p[0] : p.lat;
    const lng = Array.isArray(p) ? p[1] : p.lng;
    return `      <trkpt lat="${lat}" lon="${lng}"></trkpt>\n`;
  }).join('');

  const gpxData = gpxHeader + gpxPoints + gpxFooter;
  
  const blob = new Blob([gpxData], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `smart_loop_trasa_${new Date().getTime()}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
