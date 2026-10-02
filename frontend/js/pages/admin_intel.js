// Admin intelligence: alerts, hotspots (DBSCAN), predictive maintenance, crew scheduling
import { $, $$, esc, api, bus, state, icon, toast, btnBusy, debounce, ago, dt, clock, hrs, sevCls, sevChip, clsChip, metaCls, mkChart, css, openModal, confirmBox } from '../core.js';
import { createMap, destroyMaps, lampLayer, heatLayer, hotspotLayer, routeLayer, pin, fit, riskColor, STATUS_COLOR } from '../map.js';
import { openTicketDrawer } from './ticket_drawer.js';

/* ---------------- alerts ---------------- */
export async function alerts({ el }) {
  const draw = async () => {
    const { items } = await api.get('/api/admin/alerts');
    const live = items.filter(a => !a.ack);
    el.innerHTML = `<div class="card flush"><div class="chead"><div><h3>${live.length} need attention</h3><p class="sub">Recalculated from live data every time a ticket, lamp or forecast changes</p></div><button class="btn small" id="ackAll" ${live.length ? '' : 'disabled'}>Acknowledge all</button></div>
      ${items.map(a => `<div class="alert-row ${a.ack ? 'ack' : ''}"><span class="chip ${sevCls(a.level)}">${a.level}</span><div><h4>${esc(a.title)}</h4><p>${esc(a.detail)}</p></div><div class="row"><button class="btn small" data-go="${a.page}" data-t="${a.ticket_id || ''}">${esc(a.cta)}</button><button class="btn small ghost" data-k="${esc(a.key)}" ${a.ack ? 'disabled' : ''}>${a.ack ? 'Acknowledged' : 'Acknowledge'}</button></div></div>`).join('') || '<div class="empty"><b>All clear</b>Nothing needs attention right now.</div>'}</div>
      <div class="grid g3"><div class="card accent"><h3>${icon('warn')} Critical fault</h3><p class="sub" style="margin-top:6px">Severity 75+, for example exposed wiring. Pushed instantly to every admin screen and auto-dispatched to the nearest qualified crew.</p></div>
      <div class="card accent"><h3>${icon('clock')} SLA at risk</h3><p class="sub" style="margin-top:6px">Fires when a ticket is past, or within two hours of, its response target, or a high-priority ticket sits unassigned.</p></div>
      <div class="card accent"><h3>${icon('target')} Hotspot and forecast</h3><p class="sub" style="margin-top:6px">Four or more faulty lamps clustered together (DBSCAN), or a zone whose predicted failure risk is high.</p></div></div>`;
    $$('[data-go]').forEach(b => b.onclick = () => b.dataset.t ? openTicketDrawer(+b.dataset.t, draw) : location.hash = '#/' + b.dataset.go);
    $$('[data-k]').forEach(b => b.onclick = async () => { await api.post('/api/admin/alerts/ack', { key: b.dataset.k }); draw(); });
    const aa = $('#ackAll'); if (aa) aa.onclick = async () => { await api.post('/api/admin/alerts/ack', { all: true }); draw(); };
  };
  await draw();
  return bus.on('alert', debounce(draw, 800));
}

/* ---------------- hotspots ---------------- */
export async function hotspots({ el }) {
  const d = await api.get('/api/admin/hotspots');
  let mode = 'open';
  el.innerHTML = `<div class="grid g-main" style="margin-top:4px">
    <div class="card flush"><div class="chead"><div><h3>Fault density</h3><p class="sub" id="hsub"></p></div>
      <div class="seg" id="seg"><button data-m="open" aria-pressed="true">Open faults</button><button data-m="recurring" aria-pressed="false">Repeat failures (90 d)</button><button data-m="risk" aria-pressed="false">Predicted risk</button></div></div>
      <div class="mapbox tall" id="hm"></div><div class="legend" id="hleg"></div></div>
    <div class="stack"><div class="card" id="zones"></div><div class="card" id="clusters"></div></div></div>`;
  const map = createMap($('#hm'), { zoom: 12 });
  let layers = [];
  const clear = () => { layers.forEach(l => map.removeLayer(l)); layers = []; };
  const SUB = { open: 'DBSCAN groups faulty lamps within 170 m of each other (at least 3). One crew per cluster instead of one per complaint.', recurring: 'DBSCAN on 90 days of complaint locations (75 m, at least 8). Places where repairs keep being repeated.', risk: 'Heat = gradient-boosted 14-day failure probability per lamp.' };
  const LEG = { open: '<span><i style="background:#FF4D4D"></i>Faulty lamp</span><span><i style="background:#FFB21F"></i>Hotspot cluster</span>', recurring: '<span><i style="background:#A996FF"></i>Repeat-failure hotspot</span><span><i style="background:#FFB21F"></i>Lamp with 2+ faults in 90 days</span>', risk: '<span><i style="background:#6E86B8"></i>Low risk</span><span><i style="background:#FFD27A"></i>Elevated</span><span><i style="background:#FF9A3D"></i>High</span><span><i style="background:#FF4D4D"></i>Very high</span>' };
  const paint = () => {
    clear(); $('#hsub').textContent = SUB[mode]; $('#hleg').innerHTML = LEG[mode];
    if (mode === 'open') {
      layers.push(heatLayer(map, d.lamps.filter(l => l.status !== 'ok').map(l => [l.lat, l.lng, 1]), { radius: 42, blur: 32 }));
      layers.push(lampLayer(map, d.lamps, { radius: 6 }), hotspotLayer(map, d.current, { label: s => `${s.n} faults`, onClick: s => show(s) }));
    } else if (mode === 'recurring') {
      layers.push(lampLayer(map, d.lamps, { radius: 6, color: l => l.f90 >= 2 ? '#FFB21F' : '#6E86B8' }), hotspotLayer(map, d.recurring, { color: '#A996FF', label: s => `${s.n} in 90 d` }));
    } else {
      layers.push(heatLayer(map, d.lamps.map(l => [l.lat, l.lng, l.risk]), { radius: 38, blur: 30 }), lampLayer(map, d.lamps, { radius: 5.5, color: l => riskColor(l.risk), tooltip: l => `<b class="mono">${l.id}</b><br>Risk ${Math.round(l.risk * 100)}%` }));
    }
  };
  const show = s => { map.setView([s.lat, s.lng], 16); };
  paint(); fit(map, d.lamps.map(l => [l.lat, l.lng]), .05);
  $$('#seg button').forEach(b => b.onclick = () => { mode = b.dataset.m; $$('#seg button').forEach(x => x.setAttribute('aria-pressed', x === b)); paint(); });

  const mx = Math.max(...d.zones.map(z => z.f90), 1);
  $('#zones').innerHTML = `<h3>Zones ranked</h3><p class="sub">By open faults, then 90-day repeat complaints</p><table style="margin-top:8px"><thead><tr><th>Zone</th><th>Open</th><th>90 days</th><th>Risk</th></tr></thead><tbody>${d.zones.map(z => `<tr class="click" data-z="${z.id}"><td><b>${esc(z.name)}</b><div class="sub">${z.lamps} lamps</div></td><td>${z.open ? `<span class="chip c-high">${z.open}</span>` : '<span class="sub">0</span>'}</td><td><div class="row"><div class="bar grow"><i style="width:${z.f90 / mx * 100}%"></i></div><span class="mono">${z.f90}</span></div></td><td><span class="chip ${z.avg_risk > .22 ? 'c-crit' : z.avg_risk > .15 ? 'c-med' : 'c-low'}">${Math.round(z.avg_risk * 100)}%</span></td></tr>`).join('')}</tbody></table>`;
  $$('#zones tr[data-z]').forEach(r => r.onclick = () => { const z = d.zones.find(x => x.id === r.dataset.z); map.setView([z.lat, z.lng], 15); });
  $('#clusters').innerHTML = `<h3>Active hotspot clusters</h3><p class="sub">Send one crew per cluster instead of one per complaint</p>
    ${d.current.length ? d.current.map((c, i) => `<div style="padding:11px 0;border-top:1px solid var(--line)"><div class="row between"><b>Near ${esc(c.zone_name)}</b><span class="chip c-high">${c.n} faulty lamps</span></div><div class="sub" style="margin:4px 0">${esc(c.cause)}</div><div class="row wrap"><button class="btn small" data-f="${i}">${icon('target', 'sm')} Show on map</button><a class="btn small primary" href="#/schedule">Plan crew</a></div></div>`).join('') : '<div class="empty">No clusters right now.</div>'}
    <h3 style="margin-top:18px">Repeat-failure hotspots</h3><p class="sub">Last 90 days: fix the cause, not the symptom</p>
    ${d.recurring.length ? d.recurring.slice(0, 6).map((c, i) => `<div style="padding:10px 0;border-top:1px solid var(--line)"><div class="row between"><b>${esc(c.zone_name)}</b><span class="chip c-violet">${c.n} complaints · ${c.lamps} lamps</span></div><div class="sub" style="margin:4px 0">Mostly “${esc(c.top_label)}”. ${esc(c.action)}</div><button class="btn small" data-r="${i}">Show on map</button></div>`).join('') : '<div class="empty">No recurring hotspots.</div>'}`;
  $$('#clusters [data-f]').forEach(b => b.onclick = () => { show(d.current[+b.dataset.f]); });
  $$('#clusters [data-r]').forEach(b => b.onclick = () => { mode = 'recurring'; $$('#seg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === 'recurring')); paint(); show(d.recurring[+b.dataset.r]); });
}

/* ---------------- predictive ---------------- */
export async function predict({ el }) {
  let rain = null, selected = new Set();
  const load = async () => api.get('/api/admin/predictions' + (rain != null ? `?rain=${rain}` : ''));
  let d = await load();
  rain = d.rain;
  el.innerHTML = `<div class="kpis" id="pk"></div>
    <div class="grid g-main"><div class="card"><div class="row between wrap"><div><h3>Weekly faults: history and forecast</h3><p class="sub">Damped-trend Holt smoothing · shaded band is the 80% prediction interval</p></div><span class="chip c-mute" id="fcinfo"></span></div><div class="chartbox" style="height:290px"><canvas id="cF" aria-label="Weekly fault forecast"></canvas></div></div>
      <div class="card"><h3>What drives failures</h3><p class="sub">Feature importance from the trained gradient-boosted model</p><div class="chartbox" style="height:290px"><canvas id="cI" aria-label="Feature importance"></canvas></div></div></div>
    <div class="card" style="margin-top:16px"><div class="row wrap" style="gap:24px"><div class="grow" style="min-width:260px"><h3>${icon('activity')} What-if: rainfall in the last 7 days</h3><p class="sub">Drag to see how weather changes every lamp's failure risk. The model re-scores the whole network instantly.</p></div>
      <div class="row" style="flex:1;min-width:280px;gap:14px"><input type="range" id="rain" min="0" max="250" step="5" value="${rain}" style="flex:1;accent-color:var(--lamp)" aria-label="Rainfall in millimetres"><b class="mono" style="min-width:70px" id="rainV">${rain} mm</b></div></div></div>
    <div class="grid g-main"><div class="card flush"><div class="chead"><div><h3>Lamps most likely to fail in the next 14 days</h3><p class="sub">Inspect these before they fail and avoid an emergency visit</p></div><button class="btn primary small" id="prev" disabled>${icon('tool', 'sm')} Create preventive work orders</button></div><div class="tscroll"><table><thead><tr><th style="width:34px"><input type="checkbox" id="all" aria-label="Select all"></th><th>Lamp</th><th>Zone</th><th>Age</th><th>Risk</th><th>Main reason</th></tr></thead><tbody id="rows"></tbody></table></div></div>
      <div class="stack"><div class="card flush"><div class="chead"><div><h3>Risk map</h3><p class="sub">Warmer = more likely to fail</p></div></div><div class="mapbox short" id="rm"></div></div><div class="card"><h3>Risk by zone</h3><div id="zr"></div></div></div></div>`;
  let map = createMap($('#rm'), { zoom: 11, wheel: false, labels: false }), lyr = [];
  const paint = () => {
    $('#pk').innerHTML = `<div class="kpi"><div class="lbl">${icon('trend')} Expected faults, next 14 days</div><b>${d.forecast.next14}</b><small>plus or minus ${d.forecast.next14_band}</small></div>
      <div class="kpi ${d.high_risk > 25 ? 'warn' : ''}"><div class="lbl">${icon('warn')} Lamps above 55% risk</div><b>${d.high_risk}</b><small>of ${d.total} monitored</small></div>
      <div class="kpi"><div class="lbl">${icon('zap')} Expected lamp failures</div><b>${d.expected_failures}</b><small>sum of risk over 14 days</small></div>
      <div class="kpi"><div class="lbl">${icon('cpu')} Model AUC (held out)</div><b>${d.model.auc.toFixed(2)}</b><small>precision@top-10% ${Math.round(d.model.precision_top10 * 100)}% · synthetic data</small></div>`;
    $('#fcinfo').textContent = `Forecast error (MAPE) ${Math.round(d.forecast.mape * 100)}%`;
    $('#rows').innerHTML = d.top.slice(0, 15).map(l => `<tr><td><input type="checkbox" data-l="${l.id}" ${l.pending ? 'disabled' : ''} ${selected.has(l.id) ? 'checked' : ''} aria-label="Select ${l.id}"></td><td class="mono">${l.id}${l.pending ? ' <span class="chip c-info">open ticket</span>' : ''}</td><td>${esc(state.meta.zones.find(z => z.id === l.zone).name)}</td><td>${l.age} y</td><td style="min-width:130px"><div class="row"><div class="bar grow"><i style="width:${l.risk * 100}%;background:${riskColor(l.risk)}"></i></div><span class="mono">${Math.round(l.risk * 100)}%</span></div></td><td>${esc(l.reason)}<div class="sub">${esc(l.driver_type)}</div></td></tr>`).join('');
    $$('#rows input[data-l]').forEach(c => c.onchange = () => { c.checked ? selected.add(c.dataset.l) : selected.delete(c.dataset.l); $('#prev').disabled = !selected.size; $('#prev').lastChild.textContent = ` Create preventive work orders${selected.size ? ' (' + selected.size + ')' : ''}`; });
    const mxz = Math.max(...d.zones.map(z => z.avg), .01);
    $('#zr').innerHTML = d.zones.sort((a, b) => b.avg - a.avg).map(z => `<div class="row" style="margin:10px 0;gap:10px"><span style="width:76px">${esc(z.name)}</span><div class="bar grow" style="height:9px"><i style="width:${z.avg / mxz * 100}%;background:${riskColor(z.avg * 2.2)}"></i></div><span class="mono" style="width:46px;text-align:right">${Math.round(z.avg * 100)}%</span></div>`).join('');
    lyr.forEach(l => map.removeLayer(l)); lyr = [heatLayer(map, d.lamps.map(l => [l.lat, l.lng, l.risk]), { radius: 34, blur: 26 }), lampLayer(map, d.lamps, { radius: 4.5, color: l => riskColor(l.risk) })];
  };
  paint(); fit(map, d.lamps.map(l => [l.lat, l.lng]), .05);
  const drawCharts = () => {
    const f = d.forecast, n = f.actual.length, labels = [...f.actual.map((_, i) => i === n - 1 ? 'Now' : `W-${n - 1 - i}`), ...f.fcst.map((_, i) => `W+${i + 1}`)];
    const pad = (arr, off) => [...Array(off).fill(null), ...arr], last = f.actual[n - 1];
    mkChart($('#cF'), { type: 'line', data: { labels, datasets: [
      { label: 'Low', data: pad([last, ...f.lo], n - 1), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'High', data: pad([last, ...f.hi], n - 1), borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: css('--lamp') + '30' },
      { label: 'Forecast', data: pad([last, ...f.fcst], n - 1), borderColor: css('--lamp'), borderDash: [6, 4], pointRadius: 0, tension: .3 },
      { label: 'Actual', data: [...f.actual], borderColor: css('--info'), backgroundColor: css('--info'), pointRadius: 2.5, tension: .3 }] },
      options: { plugins: { legend: { labels: { filter: i => ['Actual', 'Forecast'].includes(i.text), usePointStyle: true } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true } } } });
    mkChart($('#cI'), { type: 'bar', data: { labels: d.model.importance.map(f => f.label), datasets: [{ data: d.model.importance.map(f => f.value), backgroundColor: css('--info'), borderRadius: 6, barThickness: 15 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { callback: v => Math.round(v * 100) + '%' } }, y: { grid: { display: false } } } } });
  };
  drawCharts();
  const rr = debounce(async () => { d = await load(); paint(); }, 250);
  $('#rain').oninput = e => { rain = +e.target.value; $('#rainV').textContent = rain + ' mm'; rr(); };
  $('#all').onchange = e => { $$('#rows input[data-l]:not(:disabled)').forEach(c => { c.checked = e.target.checked; c.onchange(); }); };
  $('#prev').onclick = ev => btnBusy(ev.currentTarget, async () => {
    const r = await api.post('/api/admin/preventive', { lamp_ids: [...selected] }); selected.clear(); toast(`${r.created} preventive work order${r.created === 1 ? '' : 's'} created. They join the scheduling queue.`, 'good'); d = await load(); paint();
  });
}

/* ---------------- scheduling ---------------- */
export async function schedule({ el }) {
  let d = await api.get('/api/admin/schedule'), view = 'opt';
  const fmtDelta = (a, b, lowerBetter = true, unit = '', digits = 1) => { if (a == null || b == null) return ''; const diff = b - a; if (Math.abs(diff) < .05) return ''; const good = lowerBetter ? diff < 0 : diff > 0; return ` <span class="${good ? 'good-t' : 'bad-t'}">${diff < 0 ? '−' : '+'}${Math.abs(diff).toFixed(digits)}${unit}</span>`; };
  const draw = () => {
    const o = d.opt.metrics, m = d.manual.metrics, cur = view === 'opt' ? d.opt : d.manual, kmPct = m.km ? Math.round((1 - o.km / m.km) * 100) : 0;
    el.innerHTML = `${d.pool ? '' : `<div class="note info" style="margin:0 0 14px">${icon('info')}<span>No unassigned, located tickets to plan right now.</span></div>`}
    <div class="card"><div class="row between wrap"><div><h3>Shift plan</h3><p class="sub">${d.pool} tickets in the pool · ${d.opt.techs.length} crews on shift · routes start now · skills and shift length are hard limits</p></div>
      <div class="row wrap"><div class="seg" id="mSeg"><button data-m="manual" aria-pressed="${view === 'manual'}">Manual dispatcher</button><button data-m="opt" aria-pressed="${view === 'opt'}">AI optimised</button></div><button class="btn primary" id="disp" ${d.pool ? '' : 'disabled'}>${icon('send', 'sm')} Dispatch optimised plan</button></div></div>
      <table class="cmp" style="margin-top:12px"><thead><tr><th>Measure</th><th>Manual (oldest first, nearest depot)</th><th>AI optimised</th></tr></thead><tbody>
        <tr><td>Total travel distance</td><td>${m.km.toFixed(1)} km</td><td>${o.km.toFixed(1)} km${kmPct > 0 ? ` <span class="good-t">−${kmPct}%</span>` : ''}</td></tr>
        <tr><td>Average time to reach Critical/High jobs</td><td>${m.avg_high_wait_min != null ? m.avg_high_wait_min + ' min' : '–'}</td><td>${o.avg_high_wait_min != null ? o.avg_high_wait_min + ' min' : '–'}${fmtDelta(o.avg_high_wait_min, m.avg_high_wait_min, true, ' min', 0) ? '' : ''}</td></tr>
        <tr><td>Jobs that miss their SLA</td><td>${m.sla_breaches}</td><td>${o.sla_breaches}</td></tr>
        <tr><td>Hazard / feeder jobs given to an unqualified crew</td><td>${m.skill_mismatch}</td><td>${o.skill_mismatch}</td></tr>
        <tr><td>Jobs planned · deferred to next shift</td><td>${m.planned} · ${m.deferred}</td><td>${o.planned} · ${o.deferred}</td></tr></tbody></table>
      <div class="note info">${icon('cpu')}<span><b>How it works.</b> Priority = severity + ageing + SLA pressure + citizen confirmations. Jobs are placed by cheapest insertion into the route that adds least travel and delay, respecting skills (HV-certified, bucket truck) and shift length, then improved with 2-opt and or-opt moves.</span></div></div>
    <div class="grid g-main"><div class="card flush"><div class="chead"><div><h3>Routes</h3><p class="sub">${view === 'opt' ? 'AI optimised' : 'Manual'} plan · numbers show visit order</p></div></div><div class="mapbox tall" id="sm"></div></div>
      <div class="stack">${cur.techs.map(t => `<div class="card tech-card" style="--c:${t.color}"><div class="row between"><div><b>${esc(t.name)}</b><div class="sub">${t.skills.length ? t.skills.map(s => s === 'hv' ? 'HV-certified' : 'Bucket truck').join(' + ') : 'Standard crew'} · from ${esc(t.depot.zone)}</div></div><span class="chip c-mute">${t.stops.length} jobs · ${t.km} km</span></div>
        <div class="row" style="margin-top:8px"><div class="bar grow"><i style="width:${t.utilisation * 100}%;background:${t.utilisation > .9 ? 'var(--warn)' : t.color}"></i></div><span class="sub mono">${Math.round(t.utilisation * 100)}% of shift</span></div>
        <ol>${t.stops.map(s => `<li><span class="n">${s.seq}</span><span>${esc(metaCls(s.cls).label)} <span class="sub mono">· TKT-${s.ticket_id}</span>${s.ok ? '' : ` <span class="chip c-crit">${icon('warn', 'sm')} not qualified</span>`}</span><span class="row" style="gap:6px">${sevChip(s.sev_label)}<span class="mono">${clock(s.eta_ts)}</span></span></li>`).join('') || '<li style="grid-template-columns:1fr" class="sub">No jobs assigned</li>'}</ol></div>`).join('')}
        ${cur.deferred.length ? `<div class="note warn">${icon('warn')}<span>${cur.deferred.length} lower-priority ticket(s) deferred to the next shift because every qualified crew is full.</span></div>` : ''}
        ${d.needs_location ? `<div class="note info">${icon('eye')}<span>${d.needs_location} ticket(s) can't be scheduled until a human confirms their location. <a href="#/review">Open review queue</a></span></div>` : ''}</div></div>`;
    const map = createMap($('#sm'), { zoom: 12 });
    routeLayer(map, cur.techs, { onStop: s => openTicketDrawer(s.ticket_id, reload) });
    $$('#mSeg button').forEach(b => b.onclick = () => { view = b.dataset.m; destroy(); draw(); });
    $('#disp').onclick = async e => { if (!(await confirmBox('Dispatch the optimised plan?', `${o.planned} jobs will be assigned to ${d.opt.techs.filter(t => t.stops.length).length} crews. Technicians and citizens are notified, and any earlier unstarted assignments are replaced.`, 'Dispatch'))) return; await btnBusy(e.target.closest('button'), async () => { await api.post('/api/admin/schedule/dispatch'); toast(`${o.planned} jobs dispatched`, 'good'); await reload(); }); };
  };
  const destroy = () => destroyMaps();
  const reload = async () => { d = await api.get('/api/admin/schedule'); destroyMaps(); draw(); };
  draw();
}
