// Admin operations: dashboard (live), tickets, review queue
import { $, $$, esc, api, bus, state, icon, toast, btnBusy, debounce, ago, dt, clock, slaText, sevChip, statusChip, clsChip, slaChip, chanIcon, highlight, entLegend, probBars, mkChart, css, metaCls, zoneName, csvDownload } from '../core.js';
import { createMap, destroyMaps, lampLayer, heatLayer, hotspotLayer, pin, fit, STATUS_COLOR } from '../map.js';
import { openTicketDrawer } from './ticket_drawer.js';

/* ---------------- dashboard ---------------- */
function kpis(o) {
  const k = (cls, ic, lbl, val, small, bar) => `<div class="kpi ${cls}"><div class="lbl">${icon(ic)} ${lbl}</div><b>${val}</b><small>${small}</small>${bar != null ? `<div class="bar"><i style="width:${bar}%;background:var(--ok)"></i></div>` : ''}</div>`;
  return k('', 'list', 'Open tickets', o.open, `${o.last_hour} in the last hour · ${o.unassigned} unassigned`) +
    k(o.critical_high ? 'warn' : '', 'warn', 'Critical and high', o.critical_high, `${o.past_sla} already past SLA`) +
    k('', 'zap', 'Lamps working', o.lamps_online_pct + '%', `${o.lamps_faulty} of ${o.lamps_total} faulty`, o.lamps_online_pct) +
    k('', 'cpu', 'Triaged automatically', o.auto_triage_pct + '%', `${o.review} waiting for human review`) +
    k('', 'clock', 'Average fix time', o.avg_resolution_h + ' h', `${o.sla_met_pct}% within SLA (30 days)`) +
    k('good', 'star', 'Citizen rating', o.csat ?? '–', `${o.csat_n} ratings · ${o.techs_on_shift}/${o.techs_total} crews on shift`);
}
function feedItem(t, isNew) {
  return `<button class="fi ${isNew ? 'new' : ''}" data-t="${t.id}"><div class="meta">${icon(chanIcon(t.channel), 'sm')}<span class="mono sub">${esc(t.channel)}</span>${sevChip(t.sev_label)}${statusChip(t.status)}<span class="sub right">${ago(t.ts)}</span></div><p>${esc(t.text)}</p><div class="meta">${clsChip(t.cls_label, t.color)}<span class="chip c-mute">${esc(t.zone_name || 'Location unknown')}</span>${t.reports > 1 ? `<span class="chip c-med">${icon('users', 'sm')} ${t.reports}</span>` : ''}<span class="sub mono right">${t.code}</span></div></button>`;
}

export async function dashboard({ el }) {
  el.innerHTML = '<div class="skeleton"></div>';
  const [o, mp, list] = await Promise.all([api.get('/api/admin/overview'), api.get('/api/admin/map'), api.get('/api/admin/tickets?scope=active&limit=30')]);
  let feed = list.items, flash = null, layers = { lamps: true, heat: false, hot: true, crews: true };
  el.innerHTML = `<div class="kpis" id="kpis">${kpis(o)}</div>
  <div class="grid g-main">
    <div class="card flush"><div class="chead"><div><h3>Live lamp map</h3><p class="sub">Click a lamp for details · updates as complaints arrive</p></div>
      <div class="seg" id="layerSeg">${[['lamps', 'Lamps'], ['heat', 'Heat'], ['hot', 'Hotspots'], ['crews', 'Crews']].map(([k, l]) => `<button data-k="${k}" aria-pressed="${layers[k]}">${l}</button>`).join('')}</div></div>
      <div class="mapbox tall" id="dm"></div>
      <div class="legend"><span><i style="background:#FFD27A"></i>Working</span><span><i style="background:#FF4D4D"></i>Faulty</span><span><i style="background:#2CD3B5"></i>Crew assigned</span><span><i style="background:#FFB21F"></i>Hotspot</span><span><i style="background:#5B9BFF"></i>Depot</span></div></div>
    <div class="card"><div class="row between"><div><h3>Incoming complaints</h3><p class="sub">Newest first · click to open</p></div><span class="chip c-low"><span class="dot" style="width:7px;height:7px;border-radius:50%;background:var(--ok);display:inline-block"></span> Live</span></div><div class="feed" id="feed"></div></div>
  </div>
  <div class="grid g3">
    <div class="card"><h3>Open faults by type</h3><p class="sub">Classified by the NLP model</p><div class="chartbox"><canvas id="cType" aria-label="Open faults by type"></canvas></div></div>
    <div class="card"><h3>Complaints per day</h3><p class="sub">Last 14 days, all channels</p><div class="chartbox"><canvas id="cDay" aria-label="Complaints per day"></canvas></div></div>
    <div class="card"><h3>Where complaints come from</h3><p class="sub">Last 30 days by channel</p><div class="chartbox"><canvas id="cCh" aria-label="Channel mix"></canvas></div></div>
  </div>
  <div class="grid g3">
    <div class="card"><h3>Open by severity</h3>${['Critical', 'High', 'Medium', 'Low'].map(s => `<div class="row" style="margin:12px 0;gap:12px"><span style="width:62px">${sevChip(s)}</span><div class="bar grow" style="height:10px"><i style="width:${Math.min(100, (o.by_severity[s] || 0) / Math.max(1, o.open) * 100)}%;background:${{ Critical: 'var(--bad)', High: 'var(--warn)', Medium: 'var(--lamp)', Low: 'var(--ok)' }[s]}"></i></div><b class="mono">${o.by_severity[s] || 0}</b></div>`).join('')}</div>
    <div class="card"><h3>Quick actions</h3><div class="col" style="margin-top:12px">
      <a class="btn primary" href="#/schedule">${icon('truck')} Plan crews (${o.unassigned} unassigned)</a>
      <a class="btn" href="#/review">${icon('eye')} Review queue (${o.review})</a>
      <a class="btn" href="#/alerts">${icon('bell')} Open alerts</a>
      <button class="btn" id="burst">${icon('zap')} Simulate 3 incoming complaints</button></div></div>
    <div class="card"><h3>System pulse</h3><dl class="kv" style="margin-top:12px;grid-template-columns:120px 1fr"><dt>Live intake</dt><dd id="simS">${o.sim.on ? `<span class="chip c-low">On · every ~${o.sim.interval}s</span>` : '<span class="chip c-mute">Off</span>'}</dd><dt>Connected users</dt><dd>${o.online}</dd><dt>Crews on shift</dt><dd>${o.techs_on_shift} of ${o.techs_total}</dd><dt>Past SLA</dt><dd>${o.past_sla}</dd></dl>
      <div class="note info">${icon('info')}<span>Turn on <b>Live intake</b> (top right) and watch new complaints classify, locate and appear here in real time.</span></div></div>
  </div>`;

  const paintFeed = () => { $('#feed').innerHTML = feed.slice(0, 30).map(t => feedItem(t, flash === t.id)).join('') || '<div class="empty">No open complaints 🎉</div>'; $$('#feed .fi').forEach(b => b.onclick = () => openTicketDrawer(+b.dataset.t, refresh)); };
  paintFeed();

  // map
  const map = createMap($('#dm'), { zoom: 12 });
  let L_lamps, L_heat, L_hot, L_crew;
  const drawMap = data => {
    [L_lamps, L_heat, L_hot, L_crew].forEach(l => l && map.removeLayer(l));
    const pts = data.lamps.filter(l => l.status !== 'ok').map(l => [l.lat, l.lng, 1]);
    if (layers.heat) L_heat = heatLayer(map, pts.concat(data.lamps.map(l => [l.lat, l.lng, l.risk * .35])), { radius: 38, blur: 30 });
    if (layers.lamps) L_lamps = lampLayer(map, data.lamps, { radius: 6.5, tooltip: l => `<b class="mono">${l.id}</b><br>${l.status === 'ok' ? 'Working' : l.ticket ? esc(l.ticket.cls_label) : 'Faulty'}<br>Risk ${Math.round(l.risk * 100)}%`, onClick: l => l.ticket && openTicketDrawer(l.ticket.id, refresh) });
    if (layers.hot) L_hot = hotspotLayer(map, data.hotspots, { label: s => `${s.n} faults` });
    if (layers.crews) { L_crew = L.layerGroup().addTo(map); data.techs.forEach(t => pin(map, t.lat, t.lng, { color: t.color, text: t.name[0], size: 22 }).addTo(L_crew).bindTooltip(`${esc(t.name)}${t.on_shift ? '' : ' (off shift)'}`)); }
  };
  drawMap(mp); fit(map, mp.lamps.map(l => [l.lat, l.lng]), .05);
  $$('#layerSeg button').forEach(b => b.onclick = () => { const k = b.dataset.k; layers[k] = !layers[k]; b.setAttribute('aria-pressed', layers[k]); drawMap(mp); });

  // charts
  const mkCharts = o => {
    mkChart($('#cType'), { type: 'bar', data: { labels: o.by_class.map(c => c.label), datasets: [{ data: o.by_class.map(c => c.n), backgroundColor: o.by_class.map(c => c.color), borderRadius: 6, barThickness: 16 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { precision: 0 } }, y: { grid: { display: false } } } } });
    mkChart($('#cDay'), { type: 'line', data: { labels: o.daily.map(d => new Date(d.ts - 43200000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })), datasets: [{ data: o.daily.map(d => d.n), borderColor: css('--lamp'), backgroundColor: css('--lamp') + '33', fill: true, tension: .35, pointRadius: 2 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    mkChart($('#cCh'), { type: 'doughnut', data: { labels: o.by_channel.map(c => c.channel), datasets: [{ data: o.by_channel.map(c => c.n), backgroundColor: ['#25D366', '#5B9BFF', '#9B7BFF', '#8E9BB5', '#FFB21F', '#2CD3B5'], borderWidth: 0 }] }, options: { cutout: '62%', plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8 } } } } });
  };
  mkCharts(o);

  $('#burst').onclick = e => btnBusy(e.currentTarget, async () => { await api.post('/api/admin/simulator/burst', { n: 3 }); toast('3 complaints sent through the pipeline', 'good'); });

  // live refresh
  const refresh = debounce(async () => {
    try {
      const [no, nm] = await Promise.all([api.get('/api/admin/overview'), api.get('/api/admin/map')]);
      $('#kpis').innerHTML = kpis(no); Object.assign(mp, nm); drawMap(mp);
      const ch = Chart.getChart($('#cType')); if (ch) { ch.data.labels = no.by_class.map(c => c.label); ch.data.datasets[0].data = no.by_class.map(c => c.n); ch.data.datasets[0].backgroundColor = no.by_class.map(c => c.color); ch.update(); }
      const dd = Chart.getChart($('#cDay')); if (dd) { dd.data.datasets[0].data = no.daily.map(d => d.n); dd.update(); }
    } catch (e) { /* page left */ }
  }, 1800);
  const offs = [bus.on('ticket', ev => {
    const t = ev.ticket; if (!t || t.kind === 'preventive') return;
    const i = feed.findIndex(x => x.id === t.id);
    if (['resolved', 'rejected'].includes(t.status)) { if (i >= 0) feed.splice(i, 1); }
    else if (i >= 0) { feed[i] = t; if (ev.action === 'merged') flash = t.id; }
    else { feed.unshift(t); flash = t.id; if (ev.action === 'created') toast(`${ev.channel}: ${t.cls_label} · ${t.zone_name || 'location unknown'} · ${t.sev_label}`); }
    if ($('#feed')) paintFeed(); refresh();
  })];
  const iv = setInterval(() => $('#feed') && paintFeed(), 60000);
  return () => { offs.forEach(f => f()); clearInterval(iv); };
}

/* ---------------- tickets ---------------- */
export async function tickets({ el, params }) {
  const f = { q: '', scope: 'active', sev_label: '', cls: '', zone: '', channel: '', sla: '', sort: 'newest', offset: 0 };
  if (params[0]) setTimeout(() => openTicketDrawer(+params[0], () => load()), 50);
  const cls = Object.entries(state.meta.classes).filter(([k]) => k !== 'preventive');
  el.innerHTML = `<div class="card flush">
    <div class="chead" style="padding-bottom:14px"><div class="row wrap grow" style="gap:10px">
      <div style="position:relative;min-width:220px;flex:1;max-width:320px"><input class="input" id="q" placeholder="Search text, lamp, name, TKT id" aria-label="Search" style="padding-left:34px"><span style="position:absolute;left:11px;top:11px;color:var(--muted)">${icon('search', 'sm')}</span></div>
      <select class="input sm" id="scope" style="width:auto"><option value="active">Active</option><option value="">All tickets</option><option value="open">Open</option><option value="review">Needs review</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select>
      <select class="input sm" id="sev" style="width:auto"><option value="">Any severity</option>${['Critical', 'High', 'Medium', 'Low'].map(s => `<option>${s}</option>`).join('')}</select>
      <select class="input sm" id="cls" style="width:auto"><option value="">Any type</option>${cls.map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <select class="input sm" id="zone" style="width:auto"><option value="">Any zone</option>${state.meta.zones.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select>
      <select class="input sm" id="chan" style="width:auto"><option value="">Any channel</option>${state.meta.channels.map(c => `<option>${esc(c)}</option>`).join('')}<option>Predictive AI</option></select>
      <select class="input sm" id="sort" style="width:auto"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="severity">Most severe</option><option value="sla">SLA soonest</option></select>
      <label class="row sub" style="gap:6px"><input type="checkbox" id="late"> SLA breached</label></div>
      <a class="btn small" href="/api/admin/export/tickets.csv">${icon('download', 'sm')} Export CSV</a></div>
    <div class="tscroll"><table><thead><tr><th>Ticket</th><th>Complaint</th><th>Type</th><th>Severity</th><th>Zone · lamp</th><th>Status</th><th>SLA</th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="pager"><span class="sub" id="pinfo"></span><button class="btn small" id="prev">Previous</button><button class="btn small" id="next">Next</button></div></div>`;
  const PAGE = 25; let total = 0;
  async function load() {
    const p = new URLSearchParams({ limit: PAGE, offset: f.offset, sort: f.sort });
    if (f.q) p.set('q', f.q); if (f.scope === 'active') p.set('scope', 'active'); else if (f.scope) p.set('status', f.scope);
    if (f.sev_label) p.set('sev_label', f.sev_label); if (f.cls) p.set('cls', f.cls); if (f.zone) p.set('zone', f.zone); if (f.channel) p.set('channel', f.channel); if (f.sla) p.set('sla', f.sla);
    const d = await api.get('/api/admin/tickets?' + p); total = d.total;
    $('#rows').innerHTML = d.items.map(t => `<tr class="click" data-t="${t.id}"><td><b class="mono">${t.code}</b><div class="sub">${icon(chanIcon(t.channel), 'sm')} ${esc(t.channel)}</div></td>
      <td style="max-width:340px"><div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(t.text)}</div><div class="sub">${ago(t.ts)}${t.reports > 1 ? ` · ${t.reports} reports` : ''}</div></td>
      <td>${clsChip(t.cls_label, t.color)}<div class="sub">${Math.round(t.conf * 100)}% sure</div></td><td>${sevChip(t.sev_label)}<div class="sub mono">${t.sev}/100</div></td>
      <td>${esc(t.zone_name || '–')}<div class="sub mono">${esc(t.lamp_id || 'no lamp')}</div></td><td>${statusChip(t.status)}<div class="sub">${esc(t.tech_name || '')}</div></td><td>${slaChip(t) || '<span class="sub">' + esc(slaText(t)) + '</span>'}<div class="sub">${t.status === 'resolved' ? '' : esc(slaText(t))}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty"><b>No tickets match</b>Try clearing a filter.</td></tr>';
    $$('#rows tr[data-t]').forEach(r => r.onclick = () => openTicketDrawer(+r.dataset.t, load));
    $('#pinfo').textContent = total ? `${f.offset + 1}–${Math.min(total, f.offset + PAGE)} of ${total}` : '0 results';
    $('#prev').disabled = f.offset === 0; $('#next').disabled = f.offset + PAGE >= total;
  }
  const reload = () => { f.offset = 0; load(); };
  $('#q').oninput = debounce(e => { f.q = e.target.value.trim(); reload(); }, 350);
  [['scope', 'scope'], ['sev', 'sev_label'], ['cls', 'cls'], ['zone', 'zone'], ['chan', 'channel'], ['sort', 'sort']].forEach(([id, k]) => $('#' + id).onchange = e => { f[k] = e.target.value; reload(); });
  $('#late').onchange = e => { f.sla = e.target.checked ? 'breached' : ''; reload(); };
  $('#prev').onclick = () => { f.offset = Math.max(0, f.offset - PAGE); load(); };
  $('#next').onclick = () => { f.offset += PAGE; load(); };
  await load();
  return bus.on('ticket', debounce(() => { if (!document.querySelector('.drawer')) load(); }, 2000));
}

/* ---------------- review queue ---------------- */
export async function review({ el }) {
  const draw = async () => {
    const [d, city] = await Promise.all([api.get('/api/admin/tickets?status=review&limit=50&sort=oldest'), api.get('/api/city/map')]);
    const lampsByZone = {}; city.lamps.forEach(l => (lampsByZone[l.zone] ||= []).push(l));
    const model = await api.get('/api/admin/model');
    el.innerHTML = `<div class="note info" style="margin:4px 0 16px">${icon('cpu')}<span><b>Human in the loop.</b> When the AI is unsure (vague location, low confidence) it parks the ticket here instead of guessing. Every correction you make is saved as a training example, currently <b>${model.corrections}</b>. <a href="#/models">Retrain the model</a> to learn from them.</span></div>
      <div class="grid g2" style="margin-top:0" id="cards">${d.items.map(t => card(t)).join('') || '<div class="card empty" style="grid-column:1/-1"><b>Review queue is empty</b>Everything was triaged automatically.</div>'}</div>`;
    d.items.forEach(t => wire(t, lampsByZone));
  };
  const card = t => `<div class="card" id="r${t.id}"><div class="row between"><span class="mono"><b>${t.code}</b></span><div class="row wrap" style="gap:6px">${sevChip(t.sev_label)}<span class="chip c-violet">${esc(t.review_reason || 'Needs review')}</span></div></div>
    <div class="sub" style="margin-top:2px">${icon(chanIcon(t.channel), 'sm')} ${esc(t.channel)} · ${esc(t.lang || '')} · ${ago(t.ts)}</div>
    <div class="hltext" style="font-size:15px">${highlight(t.clean_text || t.text, t.entities || [])}</div>
    <div class="sub" style="margin:6px 0">AI guess: ${clsChip(t.cls_label, t.color)} ${Math.round(t.conf * 100)}% · location: ${esc(t.geo_by || 'not found')}</div>
    <div class="grid g2" style="margin:10px 0 0;gap:10px"><div class="field" style="margin:0"><label>Fault type</label><select class="input sm" data-k="cls">${Object.entries(state.meta.classes).filter(([k]) => k !== 'preventive').map(([k, v]) => `<option value="${k}" ${k === t.cls ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>Zone</label><select class="input sm" data-k="zone"><option value="">Choose zone…</option>${state.meta.zones.map(z => `<option value="${z.id}" ${z.id === t.zone ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select></div></div>
    <div class="field" style="margin:10px 0 0"><label>Lamp</label><select class="input sm" data-k="lamp"><option value="">Choose a zone first</option></select></div>
    <div class="row wrap" style="margin-top:14px"><button class="btn primary" data-a="ok">${icon('check', 'sm')} Approve and release</button><button class="btn" data-a="open">Open ticket</button><button class="btn danger right" data-a="rej">Reject</button></div></div>`;
  function wire(t, lampsByZone) {
    const c = $('#r' + t.id), zs = $('[data-k=zone]', c), ls = $('[data-k=lamp]', c);
    const fill = () => { const L = lampsByZone[zs.value] || []; ls.innerHTML = zs.value ? '<option value="">Choose lamp…</option>' + L.map(l => `<option value="${l.id}" ${l.id === t.lamp_id ? 'selected' : ''}>${l.id}${l.status !== 'ok' ? ' · faulty' : ''}</option>`).join('') : '<option value="">Choose a zone first</option>'; };
    zs.onchange = fill; fill();
    $('[data-a=open]', c).onclick = () => openTicketDrawer(t.id, draw);
    $('[data-a=ok]', c).onclick = e => btnBusy(e.currentTarget, async () => {
      if (!ls.value && !t.lamp_id) return toast('Pick the lamp this complaint refers to.');
      try { await api.post(`/api/admin/tickets/${t.id}/review`, { cls: $('[data-k=cls]', c).value, lamp_id: ls.value || null }); toast(`${t.code} released to the open queue`, 'good'); draw(); } catch (err) { toast(err.message); }
    });
    $('[data-a=rej]', c).onclick = e => btnBusy(e.currentTarget, async () => { try { await api.post(`/api/admin/tickets/${t.id}/status`, { status: 'rejected', note: 'Not a valid streetlight complaint' }); toast(`${t.code} rejected`); draw(); } catch (err) { toast(err.message); } });
  }
  await draw();
  return bus.on('ticket', debounce(ev => { if (ev.ticket && ev.ticket.status === 'review' && ev.action === 'created') draw(); }, 1200));
}
