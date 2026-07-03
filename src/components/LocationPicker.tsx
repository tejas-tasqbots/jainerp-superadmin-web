import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Interactive location picker on Leaflet + OpenStreetMap (no API key, CSS pin).
 * Console-styled with inline styles so it works without the Tailwind setup the
 * portals use. Click / drag to set the pin, or use the browser's geolocation.
 */
const PIN = L.divIcon({
  html: `<div style="font-size:28px;line-height:1;transform:translate(-50%,-90%)">📍</div>`,
  className: '',
  iconSize: [0, 0],
});

export function LocationPicker({
  lat, lng, onChange, height = 220,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  onChange: (lat: number, lng: number) => void;
  height?: number;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [locating, setLocating] = useState(false);
  const [geoErr, setGeoErr] = useState('');

  const hasCoords = lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng));

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const start: [number, number] = hasCoords ? [Number(lat), Number(lng)] : [22.9734, 78.6569];
    const map = L.map(elRef.current, { attributionControl: false }).setView(start, hasCoords ? 14 : 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => setPin(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    if (hasCoords) placeMarker(Number(lat), Number(lng));
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !hasCoords) return;
    placeMarker(Number(lat), Number(lng));
    mapRef.current.setView([Number(lat), Number(lng)], Math.max(mapRef.current.getZoom(), 13));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  function placeMarker(la: number, ln: number) {
    const map = mapRef.current!;
    if (markerRef.current) markerRef.current.setLatLng([la, ln]);
    else {
      const m = L.marker([la, ln], { icon: PIN, draggable: true }).addTo(map);
      m.on('dragend', () => { const p = m.getLatLng(); onChangeRef.current(round(p.lat), round(p.lng)); });
      markerRef.current = m;
    }
  }
  function setPin(la: number, ln: number) { placeMarker(la, ln); onChangeRef.current(round(la), round(ln)); }

  function useMyLocation() {
    if (!window.isSecureContext) {
      setGeoErr('Live location needs a secure (HTTPS) connection. Tap the map or drag the pin to set the location instead.');
      return;
    }
    if (!navigator.geolocation) { setGeoErr('Geolocation not supported'); return; }
    setLocating(true); setGeoErr('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); const la = pos.coords.latitude, ln = pos.coords.longitude; mapRef.current?.setView([la, ln], 15); setPin(la, ln); },
      (err) => { setLocating(false); setGeoErr(err.code === 1 ? 'Location permission denied' : 'Could not get your location'); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#475569' }}>📍 Location on map</span>
        <button type="button" onClick={useMyLocation} disabled={locating}
          style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {locating ? 'Locating…' : 'Use my current location'}
        </button>
      </div>
      <div ref={elRef} style={{ height, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', zIndex: 0 }} />
      <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
        {hasCoords ? `Pinned at ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} · tap the map or drag the pin to adjust` : 'Tap on the map to drop a pin, or use your current location'}
      </p>
      {geoErr && <p style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>{geoErr}</p>}
    </div>
  );
}

function round(n: number) { return Math.round(n * 1e6) / 1e6; }
