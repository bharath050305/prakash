// Leaflet helpers. Basemap tiles need internet; everything else (lamps, heat, routes, labels) is drawn locally,
// so the map stays useful offline with a plain background.
import { theme, bus, state, esc } from './core.js';

// Esri World Street Map tiles (free, no key, no Referer rules); the dark theme recolours them with a CSS filter (see app.css)
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const ATTR = 'Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors';
export const CENTER = [19.06, 73.02];
export const STATUS_COLOR = { ok: '#FFD27A', fault: '#FF4D4D', assigned: '#2CD3B5', review: '#A996FF' };
const MAPS = new Set();

export function createMap(el, { center = CENTER, zoom = 12, wheel = true, labels = true } = {}) {
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: wheel, preferCanvas: true, attributionControl: true, zoomSnap: 0.5, zoomDelta: 0.5 }).setView(center, zoom);
  let layer = null, errs = 0, loaded = 0, noted = false;
  const setTiles = () => {
    if (layer) map.removeLayer(layer);
    layer = L.tileLayer(TILE_URL, { attribution: ATTR, maxZoom: 19, maxNativeZoom: 18 }).addTo(map);
    layer.on('tileload', () => loaded++);
    layer.on('tileerror', () => {
      errs++;
      if (errs > 3 && !loaded && !noted) {
        noted = true;
        const n = document.createElement('div'); n.className = 'map-offline'; n.textContent = 'Offline: basemap unavailable, showing lamps only';
        el.appendChild(n);
      }
    });
    layer.bringToBack();
  };
  setTiles();
  const off = () => {};
  if (labels && state.meta) state.meta.zones.forEach(z => L.marker([z.lat, z.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="zone-label">${esc(z.name)}</span>`, iconSize: [0, 0] }) }).addTo(map));
  map._off = off;
  el._map = map;
  MAPS.add(map);
  setTimeout(() => map.invalidateSize(), 60);
  return map;
}
export function removeMap(map) { if (map && MAPS.has(map)) { try { map.remove(); } catch (e) { /* already gone */ } MAPS.delete(map); } }
export function destroyMaps() { MAPS.forEach(m => { try { m._off && m._off(); m.remove(); } catch (e) { /* already gone */ } }); MAPS.clear(); }

export function lampLayer(map, lamps, { onClick, color, radius = 5, tooltip } = {}) {
  const g = L.layerGroup().addTo(map);
  const pulse = [];
  lamps.forEach(l => {
    const col = color ? color(l) : STATUS_COLOR[l.status] || STATUS_COLOR.ok;
    const faulty = l.status && l.status !== 'ok';
    const m = L.circleMarker([l.lat, l.lng], { radius: faulty ? radius + 1.5 : radius - 1, color: faulty ? '#fff' : col, weight: faulty ? 1.2 : .5, fillColor: col, fillOpacity: faulty ? .95 : .75 }).addTo(g);
    if (tooltip) m.bindTooltip(tooltip(l), { direction: 'top', offset: [0, -4] });
    if (onClick) m.on('click', () => onClick(l, m));
    if (l.status === 'fault') pulse.push(l);
  });
  pulse.forEach(l => L.marker([l.lat, l.lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="lamp-dot lamp-pulse" style="width:10px;height:10px;background:#FF4D4D;opacity:0"></div>', iconSize: [10, 10], iconAnchor: [5, 5] }) }).addTo(g));
  return g;
}

export function heatLayer(map, points, { radius = 34, blur = 28, gradient } = {}) {
  if (!L.heatLayer) return L.layerGroup().addTo(map);
  return L.heatLayer(points, { radius, blur, maxZoom: 15, minOpacity: .25, gradient: gradient || { .3: '#FFD27A', .6: '#FF8A3D', 1: '#FF2D2D' } }).addTo(map);
}

export function hotspotLayer(map, spots, { color = '#FFB21F', label = s => `${s.n} faults`, onClick } = {}) {
  const g = L.layerGroup().addTo(map);
  spots.forEach(s => {
    const c = L.circle([s.lat, s.lng], { radius: s.radius, color, weight: 2, dashArray: '7 6', fillColor: color, fillOpacity: .1 }).addTo(g);
    L.marker([s.lat, s.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="hs-label">${esc(label(s))}</span>`, iconSize: [0, 0] }) }).addTo(g);
    if (onClick) c.on('click', () => onClick(s));
  });
  return g;
}

export function pin(map, lat, lng, { color = '#2CD3B5', text = '', size = 26, draggable = false } = {}) {
  const m = L.marker([lat, lng], { draggable, icon: L.divIcon({ className: '', html: `<div class="num-pin" style="width:${size}px;height:${size}px;background:${color}">${esc(text)}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) }).addTo(map);
  return m;
}
export function targetPin(map, lat, lng) {
  return L.marker([lat, lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="target-pin"><i></i></div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map);
}

export function routeLayer(map, techs, { onStop } = {}) {
  const g = L.layerGroup().addTo(map), pts = [];
  techs.forEach(t => {
    if (!t.stops.length) return;
    const line = [[t.depot.lat, t.depot.lng], ...t.stops.map(s => [s.lat, s.lng]), [t.depot.lat, t.depot.lng]];
    L.polyline(line, { color: t.color, weight: 3, opacity: .95, className: 'route' }).addTo(g);
    L.marker([t.depot.lat, t.depot.lng], { icon: L.divIcon({ className: '', html: `<div class="depot-pin" style="width:22px;height:22px;background:${t.color}">${esc(t.name[0])}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).bindTooltip(`${esc(t.name)} · depot`).addTo(g);
    t.stops.forEach(s => {
      const m = pin(map, s.lat, s.lng, { color: t.color, text: s.seq, size: 24 });
      m.addTo(g);
      m.bindTooltip(`${esc(t.name)} · stop ${s.seq} · ${s.sev_label}`);
      if (onStop) m.on('click', () => onStop(s, t));
      pts.push([s.lat, s.lng]);
    });
    pts.push([t.depot.lat, t.depot.lng]);
  });
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(.2), { maxZoom: 17 });
  return g;
}

export function fit(map, pts, pad = .12) { if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(pad), { maxZoom: 16 }); }
export const riskColor = r => r >= .6 ? '#FF4D4D' : r >= .35 ? '#FF9A3D' : r >= .18 ? '#FFD27A' : '#6E86B8';
