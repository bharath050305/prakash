// Technician: optimised route, start/complete jobs, shift toggle, history
import { $, $$, esc, api, bus, icon, toast, btnBusy, debounce, ago, dt, clock, sevChip, statusChip, clsChip, slaChip, metaCls, openModal, slaText } from '../core.js';
import { createMap, destroyMaps, pin, targetPin, routeLayer, lampLayer, fit } from '../map.js';

export async function jobs({ el }) {
  let tab = 'route';
  const draw = async () => {
    destroyMaps();
    const d = await api.get('/api/tech/jobs'), t = d.tech, col = t.color;
    const next = d.jobs[0];
    el.innerHTML = `
    <div class="kpis" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">${icon('truck')} Jobs left today</div><b>${d.jobs.length}</b><small>${d.jobs.filter(j => j.status === 'in_progress').length} in progress</small></div>
      <div class="kpi good"><div class="lbl">${icon('checkc')} Done in 24 h</div><b>${d.stats.done_24h}</b><small>${d.stats.total_done} all-time</small></div>
      <div class="kpi"><div class="lbl">${icon('clock')} Avg repair time</div><b>${d.stats.avg_repair_min || '–'}${d.stats.avg_repair_min ? ' min' : ''}</b><small>on site, last 24 h</small></div>
      <div class="kpi"><div class="lbl">${icon('star')} Citizen rating</div><b>${d.stats.rating ?? '–'}</b><small>your resolved jobs</small></div>
      <div class="kpi"><div class="lbl">${icon('user')} Shift</div><div class="row" style="margin-top:8px"><button class="switch" id="shift" role="switch" aria-checked="${t.on_shift}" aria-label="On shift"></button><b style="font-size:17px;margin:0">${t.on_shift ? 'On shift' : 'Off shift'}</b></div><small>Skills: ${t.skills.length ? t.skills.map(s => s === 'hv' ? 'HV-certified' : 'Bucket truck').join(', ') : 'Standard crew'}</small></div></div>
    <div class="seg" id="seg" style="margin-bottom:14px"><button data-t="route" aria-pressed="${tab === 'route'}">Today's route (${d.jobs.length})</button><button data-t="hist" aria-pressed="${tab === 'hist'}">Completed (${d.history.length})</button></div>
    <div id="tab"></div>`;
    $('#shift').onclick = async () => { const r = await api.post('/api/tech/shift', { on: !t.on_shift }); toast(r.on_shift ? 'You are on shift. The optimiser will include you.' : 'You are off shift. No new jobs will be assigned.'); draw(); };
    $$('#seg button').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
    if (tab === 'hist') return history(d);
    if (!t.on_shift && !d.jobs.length) { $('#tab').innerHTML = `<div class="card empty"><b>You're off shift</b>Switch on shift above to receive jobs.</div>`; return; }
    if (!d.jobs.length) { $('#tab').innerHTML = `<div class="card empty"><b>All caught up</b>No jobs assigned right now. New jobs arrive here as soon as the control room dispatches them.</div>`; return; }
    $('#tab').innerHTML = `<div class="grid g-side" style="margin-top:0"><div class="stack" id="jl"></div><div class="card flush" style="align-self:start;position:sticky;top:84px"><div class="chead"><div><h3>Route map</h3><p class="sub">Numbers show the order to visit</p></div></div><div class="mapbox" id="rm"></div></div></div>`;
    $('#jl').innerHTML = d.jobs.map((j, i) => jobCard(j, i, col)).join('');
    const map = createMap($('#rm'), { zoom: 13 });
    const stops = d.jobs.filter(j => j.lat != null).map((j, i) => ({ lat: j.lat, lng: j.lng, seq: i + 1, sev_label: j.sev_label }));
    routeLayer(map, [{ name: t.name, color: col, depot: t.depot, stops }]);
    $$('[data-start]').forEach(b => b.onclick = () => btnBusy(b, async () => { try { await api.post(`/api/tech/jobs/${b.dataset.start}/start`); toast('Work started. The citizen has been notified.', 'good'); draw(); } catch (e) { toast(e.message); } }));
    $$('[data-done]').forEach(b => b.onclick = () => complete(+b.dataset.done, d.jobs.find(j => j.id === +b.dataset.done), draw));
  };
  function jobCard(j, i, col) {
    const m = metaCls(j.cls), active = j.status === 'in_progress';
    return `<div class="job ${active ? 'active' : ''}" style="--c:${col}"><div class="row" style="align-items:flex-start;gap:12px"><div class="n">${i + 1}</div><div class="grow">
      <div class="row wrap" style="gap:6px">${clsChip(j.cls_label, j.color)}${sevChip(j.sev_label)}${statusChip(j.status)}${slaChip(j)}<span class="mono sub right">${j.code}</span></div>
      <p style="margin:8px 0;font-size:14.5px">${esc(j.text)}</p>
      <div class="sub row wrap" style="gap:14px">${icon('pin', 'sm')} ${esc(j.zone_name || '')} · <span class="mono">${esc(j.lamp_id || '')}</span><span>${icon('clock', 'sm')} ETA ${clock(j.eta_ts)}</span><span>${esc(slaText(j))}</span></div>
      ${j.reports > 1 ? `<div class="note warn" style="margin-top:8px">${icon('users')}<span>${j.reports} citizens reported this fault.</span></div>` : ''}
      <div class="row wrap" style="margin-top:12px"><a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${j.lat},${j.lng}">${icon('nav', 'sm')} Navigate</a>
        ${active ? `<button class="btn small primary" data-done="${j.id}">${icon('check', 'sm')} Mark fixed</button>` : `<button class="btn small primary" data-start="${j.id}">${icon('tool', 'sm')} Start work</button><button class="btn small ghost" data-done="${j.id}">Fixed already</button>`}</div></div></div></div>`;
  }
  function complete(id, j, after) {
    const m = metaCls(j.cls);
    const parts = { outage: 'LED lamp', flicker: 'Driver', dayburn: 'Photocell', hazard: 'Cable, clamp', dim: 'LED lamp', vandal: 'Fixture, cable', timer: 'Contactor', cluster: 'MCB, fuse' }[j.cls] || '';
    const modal = openModal(`<h3>Mark ${esc(j.code)} as fixed</h3><p class="sub" style="margin:4px 0 14px">${esc(j.cls_label)} · ${esc(j.lamp_id || '')}</p>
      <div class="field"><label for="note">What did you do?</label><textarea class="input" id="note" style="min-height:90px;font-size:14px" placeholder="e.g. Replaced lamp and tested driver"></textarea></div>
      <div class="field"><label for="parts">Parts used</label><input class="input" id="parts" value="${esc(parts)}"></div>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">${icon('check', 'sm')} Confirm fixed</button></div>`);
    $('#ok', modal.el).onclick = e => btnBusy(e.currentTarget, async () => {
      try { await api.post(`/api/tech/jobs/${id}/complete`, { note: $('#note', modal.el).value.trim(), parts: $('#parts', modal.el).value.trim() }); modal.close(); toast('Job complete. The citizen has been notified.', 'good'); after(); } catch (err) { toast(err.message); }
    });
  }
  function history(d) {
    $('#tab').innerHTML = `<div class="card flush"><div class="tscroll"><table><thead><tr><th>Ticket</th><th>Fault</th><th>Zone</th><th>Fixed</th><th>Rating</th><th>Notes</th></tr></thead><tbody>${d.history.map(j => `<tr><td class="mono">${j.code}</td><td>${clsChip(j.cls_label, j.color)}</td><td>${esc(j.zone_name || '')}</td><td>${dt(j.resolved_ts)}</td><td>${j.rating ? '★'.repeat(j.rating) : '–'}</td><td class="sub">${esc(j.resolution_note || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No completed jobs yet</td></tr>'}</tbody></table></div></div>`;
  }
  await draw();
  return bus.on('ticket', debounce(() => { if (location.hash === '#/jobs' || location.hash === '') draw(); }, 1500));
}
