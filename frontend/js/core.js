// Shared helpers: DOM, API client, icons, formatting, chips, charts, modal/drawer/toast, event bus + SSE
export const $ = (s, e = document) => e.querySelector(s);
export const $$ = (s, e = document) => [...e.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const state = { user: null, meta: null };

/* ---------------- API ---------------- */
export async function api(method, url, data, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (data instanceof FormData) init.body = data;
  else if (data !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(data); }
  let res;
  try { res = await fetch(url, init); } catch (e) { throw Object.assign(new Error('Cannot reach the server. Is it still running?'), { status: 0 }); }
  if (opts.raw) return res;
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && !opts.quiet) bus.emit('unauth');
    throw Object.assign(new Error((json && json.error) || `Request failed (${res.status})`), { status: res.status });
  }
  return json;
}
api.get = (u, o) => api('GET', u, undefined, o);
api.post = (u, d, o) => api('POST', u, d ?? {}, o);
api.put = (u, d) => api('PUT', u, d);
api.patch = (u, d) => api('PATCH', u, d);

/* ---------------- bus + live stream ---------------- */
const listeners = {};
export const bus = {
  on(t, fn) { (listeners[t] ||= new Set()).add(fn); return () => listeners[t].delete(fn); },
  emit(t, d) { (listeners[t] || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } }); }
};
let es = null;
export function connectStream() {
  if (es) es.close();
  es = new EventSource('/api/stream');
  es.onmessage = ev => { try { const m = JSON.parse(ev.data); bus.emit(m.type, m.data); bus.emit('*', m); } catch (e) { /* ignore */ } };
  es.onerror = () => bus.emit('stream-state', false);
  es.onopen = () => bus.emit('stream-state', true);
}
export function closeStream() { if (es) es.close(); es = null; }

/* ---------------- icons ---------------- */
const IC = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  plus: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  warn: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkc: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  nav: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  chev: '<polyline points="9 18 15 12 9 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  gps: '<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  twitter: '<path d="M4 4l16 16M20 4L4 20"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  lamp: '<path d="M7 21h6M10 21V7a4 4 0 0 1 4-4h3"/><path d="M15 3h5v4h-5z" fill="currentColor"/>'
};
export const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;
export const logoSVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h6M10 21V7a4 4 0 0 1 4-4h3"/><path d="M15 3h5v4h-5z" fill="currentColor"/></svg>`;

/* ---------------- formatting ---------------- */
export const ago = ts => {
  if (!ts) return '–';
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
};
export const clock = ts => ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '–';
export const dt = ts => ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '–';
export const day = ts => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const hrs = ms => { const h = ms / 3.6e6; return h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h.toFixed(h < 10 ? 1 : 0) + ' h' : Math.round(h / 24) + ' d'; };
export const eta = t => t.eta_ts ? clock(t.eta_ts) : '–';
export const pct = v => Math.round(v * 100) + '%';
export function slaText(t) {
  if (t.status === 'resolved') return t.sla === 'met' ? 'Fixed within SLA' : 'Fixed after SLA';
  if (!t.due_ts) return '';
  const d = t.due_ts - Date.now();
  return d < 0 ? `Overdue by ${hrs(-d)}` : `Due in ${hrs(d)}`;
}

/* ---------------- chips ---------------- */
export const sevCls = l => ({ Critical: 'c-crit', High: 'c-high', Medium: 'c-med', Low: 'c-low' }[l] || 'c-mute');
export const sevChip = l => `<span class="chip ${sevCls(l)}">${esc(l)}</span>`;
export const STATUS = { open: ['Open', 'c-info'], review: ['Needs review', 'c-violet'], assigned: ['Crew assigned', 'c-med'], in_progress: ['In progress', 'c-high'], resolved: ['Resolved', 'c-low'], rejected: ['Closed', 'c-mute'] };
export const statusChip = s => `<span class="chip ${(STATUS[s] || ['', 'c-mute'])[1]}">${(STATUS[s] || [s])[0]}</span>`;
export const clsChip = (label, color) => `<span class="chip" style="background:${color}22;color:${color}">${esc(label)}</span>`;
export const slaChip = t => {
  if (t.status === 'resolved') return t.sla === 'met' ? '<span class="chip c-low">SLA met</span>' : '<span class="chip c-crit">SLA missed</span>';
  if (t.sla === 'breached') return '<span class="chip c-crit">SLA breached</span>';
  if (t.sla === 'at_risk') return '<span class="chip c-high">SLA at risk</span>';
  return '';
};
export const chanIcon = c => ({ 'WhatsApp': 'msg', 'Web portal': 'globe', 'Call centre': 'phone', 'X / Twitter': 'twitter', 'Email': 'mail', 'SMS': 'msg', 'Predictive AI': 'cpu' }[c] || 'inbox');

/* ---------------- NLP visuals ---------------- */
const TAG = { POLE_ID: 'POLE', LOCATION: 'LOC', LANDMARK: 'LMK', DURATION: 'TIME', FAULT: 'FAULT' };
export function highlight(text, ents) {
  let o = '', p = 0;
  for (const e of ents || []) { o += esc(text.slice(p, e.s)) + `<mark class="ent e-${e.label}" title="${e.label}">${esc(e.text)}<small>${TAG[e.label]}</small></mark>`; p = e.e; }
  return o + esc(text.slice(p));
}
export const entLegend = () => ['POLE_ID', 'LOCATION', 'LANDMARK', 'DURATION', 'FAULT'].map(k => `<mark class="ent e-${k}" style="font-size:11.5px">${k}</mark>`).join(' ');
export function gauge(score, label, w = 180) {
  const c = label === 'Critical' ? 'var(--bad)' : label === 'High' ? 'var(--warn)' : label === 'Medium' ? 'var(--lamp)' : 'var(--ok)', L = 169.6;
  return `<svg class="gauge" viewBox="0 0 140 84" width="${w}" role="img" aria-label="Severity ${score} of 100"><path d="M16 70A54 54 0 0 1 124 70" fill="none" stroke="var(--surface3)" stroke-width="12" stroke-linecap="round"/><path d="M16 70A54 54 0 0 1 124 70" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${(L * (1 - score / 100)).toFixed(1)}" style="transition:stroke-dashoffset .8s"/><text x="70" y="62" text-anchor="middle" font-size="30" font-weight="700" fill="var(--ink)">${score}</text><text x="70" y="80" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="IBM Plex Sans,sans-serif">out of 100</text></svg>`;
}
export function probBars(probs, n = 4) {
  return probs.slice(0, n).map(p => `<div class="prob"><span>${esc(p.label)}</span><div class="bar"><i style="width:${Math.max(3, p.p * 100).toFixed(0)}%;background:${p.color}"></i></div><span class="mono">${Math.round(p.p * 100)}%</span></div>`).join('');
}

/* ---------------- charts ---------------- */
let CHARTS = [];
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export function mkChart(el, cfg) {
  if (!window.Chart || !el) return null;
  Chart.defaults.color = css('--muted'); Chart.defaults.font.family = "'IBM Plex Sans',sans-serif"; Chart.defaults.borderColor = css('--line');
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 500 } }, cfg.options || {});
  const c = new Chart(el, cfg); CHARTS.push(c); return c;
}
export function destroyCharts() { CHARTS.forEach(c => { try { c.destroy(); } catch (e) { /* gone */ } }); CHARTS = []; }

/* ---------------- toast / modal / drawer ---------------- */
export function toast(msg, kind = '') {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const d = document.createElement('div'); d.className = 'toast ' + kind;
  d.innerHTML = (kind === 'crit' ? icon('warn') : kind === 'good' ? icon('checkc') : '') + `<span>${esc(msg)}</span>`;
  box.appendChild(d); setTimeout(() => d.remove(), kind === 'crit' ? 7000 : 4200);
}
export function openModal(html, { wide = false, onClose } = {}) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('div'); el.className = 'modal' + (wide ? ' wide' : ''); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.innerHTML = html;
  document.body.append(scrim, el);
  const close = () => { scrim.remove(); el.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key); scrim.onclick = close;
  $$('[data-close]', el).forEach(b => b.onclick = close);
  return { el, close };
}
export function openDrawer(title, html, { onClose } = {}) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('aside'); el.className = 'drawer'; el.setAttribute('role', 'dialog');
  el.innerHTML = `<div class="dhead"><div class="grow" id="dTitle">${title}</div><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div><div class="dbody">${html}</div>`;
  document.body.append(scrim, el);
  const close = () => { scrim.remove(); el.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key); scrim.onclick = close; $('[data-close]', el).onclick = close;
  return { el, close, body: $('.dbody', el), title: $('#dTitle', el) };
}
export const confirmBox = (title, text, okLabel = 'Confirm') => new Promise(res => {
  const m = openModal(`<h3>${esc(title)}</h3><p class="muted" style="margin:10px 0 18px">${esc(text)}</p><div class="row right" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="okb">${esc(okLabel)}</button></div>`, { onClose: () => res(false) });
  $('#okb', m.el).onclick = () => { res(true); m.close(); };
});

/* ---------------- misc ---------------- */
export const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const loading = el => { el.innerHTML = '<div class="spinner" role="progressbar" aria-label="Loading"></div>'; };
export const btnBusy = async (btn, fn) => { const t = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin:0;border-width:2px"></span>'; try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = t; } };
export function theme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
export function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('prakash-theme', t); } catch (e) { /* private mode */ } bus.emit('theme', t); }
export function initTheme() {
  let t = null; try { t = localStorage.getItem('prakash-theme'); } catch (e) { /* ignore */ }
  document.documentElement.setAttribute('data-theme', t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
export const initials = n => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export function csvDownload(url) { const a = document.createElement('a'); a.href = url; a.click(); }
export const metaCls = c => (state.meta && state.meta.classes[c]) || { label: c, color: '#888' };
export const zoneName = id => { const z = state.meta && state.meta.zones.find(z => z.id === id); return z ? z.name : '–'; };
