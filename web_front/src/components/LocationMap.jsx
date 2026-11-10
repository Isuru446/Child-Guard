import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';
import './LocationMap.css';

const COLORS = {
  child: '#0284c7',
  geofence: '#f59e0b',
  beacon: '#7c3aed',
  bus: '#16a34a',
};

function validCoordinates(item) {
  return (
    [item.lat, item.lng].every(
      (value) =>
        value !== undefined &&
        value !== null &&
        value !== '' &&
        Number.isFinite(Number(value)),
    ) &&
    Math.abs(Number(item.lat)) <= 90 &&
    Math.abs(Number(item.lng)) <= 180
  );
}

function createPopup(item) {
  const container = document.createElement('div');

  const name = document.createElement('strong');
  name.textContent = item.name || item.id || 'Location';
  container.appendChild(name);

  const details = [
    item.id ? `ID: ${item.id}` : '',
    item.description,
    item.type === 'geofence' && item.radius > 0
      ? `Radius: ${item.radius} m`
      : '',
    `Coordinates: ${Number(item.lat)}, ${Number(item.lng)}`,
  ].filter(Boolean);

  details.forEach((text) => {
    const line = document.createElement('p');
    line.textContent = text;
    container.appendChild(line);
  });

  return container;
}

export default function LocationMap({
  locations = [],
  label = 'Recorded locations map',
  preserveView = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const fitted=useRef(false);
  const latestPoints=useRef([]);
  const tilesRef=useRef(null);
  const [tileError,setTileError]=useState(false);

  const points = useMemo(
    () => locations.filter(validCoordinates),
    [locations],
  );

  const hasPoints=points.length>0;
  useEffect(()=>{latestPoints.current=points;},[points]);
  useEffect(() => {
    if(!hasPoints)return;
    const first=latestPoints.current[0];
    fitted.current=false;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
    }).setView([Number(first.lat), Number(first.lng)], 15);

    mapRef.current = map;

    const tiles=L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        keepBuffer:1,updateWhenIdle:true,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    ).addTo(map);
    tilesRef.current=tiles;
    tiles.on('tileerror',()=>setTileError(true));

    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tilesRef.current=null;
    };
  }, [hasPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const group = L.featureGroup().addTo(map);

    points.forEach((item) => {
      const position = [Number(item.lat), Number(item.lng)];
      const color = COLORS[item.type] || COLORS.child;

      if (
        item.type === 'geofence' &&
        Number.isFinite(Number(item.radius)) &&
        Number(item.radius) > 0
      ) {
        L.circle(position, {
          radius: Number(item.radius),
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.12,
          dashArray: '6 4',
        })
          .bindPopup(createPopup(item))
          .addTo(group);
      }

      L.circleMarker(position, {
        radius: item.type === 'beacon' ? 7 : 8,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      })
        .bindPopup(createPopup(item))
        .addTo(group);
    });

    if (points.length && (!preserveView || !fitted.current)) {
      fitted.current=true;
      map.fitBounds(group.getBounds(), {
        padding: [35, 35],
        maxZoom: 16,
      });
    }

    return () => {
      map.removeLayer(group);
    };
  }, [points,preserveView]);

  return (
    <div className="cg-location-map">
      <div
        ref={containerRef}
        className="cg-location-map__canvas"
        role="region"
        aria-label={label}
      />

      {hasPoints&&<button type="button" className="cg-location-map__recenter" onClick={()=>{const map=mapRef.current;if(map){map.setView([Number(points[0].lat),Number(points[0].lng)],map.getZoom());}}}>Recenter</button>}
      {hasPoints&&tileError&&<div className="cg-location-map__tile-error" role="status">Map tiles are unavailable. Recorded coordinates remain available. <button type="button" onClick={()=>{setTileError(false);tilesRef.current?.redraw();}}>Retry map tiles</button></div>}
      {!points.length && (
        <div className="cg-location-map__empty">
          No recorded locations available.
        </div>
      )}
    </div>
  );
}
