// Admin ticket detail drawer, shared by dashboard, tickets, hotspots and alerts pages
import { $, $$, esc, api, bus, icon, toast, btnBusy, ago, dt, clock, slaText, sevChip, statusChip, clsChip, slaChip, chanIcon, highlight, entLegend, gauge, probBars, openDrawer, metaCls, state } from '../core.js';
import { createMap, removeMap, targetPin } from '../map.js';

const EVENT_LABEL = { received: 'Received', prep: 'Text cleaned', classified: 'Fault type identified', severity: 'Severity scored', located: 'Located', review: 'Sent to review', autoreply: 'Auto-reply', assigned: 'Assigned', started: 'Work started', resolved: 'Resolved', merged: 'Duplicate merged', rejected: 'Rejected', reopened: 'Reopened', rated: 'Rated', note: 'Note', reviewed: 'Released from review', corrected: 'Corrected', confirmed: 'AI confirmed' };
let techCache = null;

export async function openTicketDrawer(id, onChange) {
  const d = openDrawer('<h3>Loading…</h3>', '<div class="spinner"></div>');
  let map = null;
  const draw = async () => {
    let t;
    try { t = (await api.get(`/api/admin/tickets/${id}`)).ticket; } catch (e) { d.body.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
    techCache = (await api.get('/api/admin/technicians')).items;
    const live = !['resolved', 'rejected'].includes(t.status);
    d.title.innerHTML = `<div class="row wrap" style="gap:8px"><h3 class="mono" style="font-size:18px">${t.code}</h3>${statusChip(t.status)}${sevChip(t.sev_label)}${slaChip(t)}</div><div class="sub">${esc(t.cls_label)} · ${esc(t.zone_name || 'unknown zone')} · ${ago(t.ts)}</div>`;
    const techOpts = techCache.map(x => { const need = t.needs || [], ok = need.every(n => x.skills.includes(n)); return `<option value="${x.id}" ${ok ? '' : 'disabled'} ${t.tech_id === x.id ? 'selected' : ''}>${esc(x.name)} · ${x.current} jobs${x.on_shift ? '' : ' (off shift)'}${ok ? '' : ' · lacks ' + need.join('+')}</option>`; }).join('');
    d.body.innerHTML = `
      <div class="card"><div class="row between"><h4>${icon(chanIcon(t.channel))} Complaint</h4><span class="sub">${esc(t.channel)} · ${esc(t.lang || '')} · ${esc(t.reporter_name || 'Anonymous')}</span></div>
        <div class="hltext" style="font-size:15px">${highlight(t.clean_text || t.text, t.entities || [])}</div>
        ${t.clean_text && t.clean_text !== t.text ? `<details style="margin-top:6px"><summary class="sub" style="cursor:pointer">Show original message</summary><pre class="code" style="white-space:pre-wrap">${esc(t.text)}</pre></details>` : ''}
        <div class="row wrap" style="gap:4px;margin-top:8px">${entLegend()}</div>
        ${t.photo ? `<img src="${esc(t.photo)}" alt="Photo attached by the citizen" style="max-width:100%;max-height:200px;border-radius:12px;margin-top:10px">` : ''}
        ${t.reports > 1 ? `<div class="note warn">${icon('users')}<span><b>${t.reports} reports</b> merged into this ticket${(t.reporters || []).length ? ':' : ''}</span></div>${(t.reporters || []).map(r => `<div class="sub" style="padding:3px 0 0 4px">· ${esc(r.channel || '')} · ${dt(r.ts)} · ${esc((r.text || '').slice(0, 90))}</div>`).join('')}` : ''}
        ${t.review_reason ? `<div class="note info">${icon('eye')}<span>Sent for review: ${esc(t.review_reason)}</span></div>` : ''}</div>
      <div class="grid g2" style="margin:0">
        <div class="card"><h4>Fault type</h4><div class="sub" style="margin-bottom:6px">Confidence ${Math.round(t.conf * 100)}%</div>${probBars((t.probs || []).map(p => ({ ...p, label: metaCls(p.cls).label, color: metaCls(p.cls).color })), 3)}
          ${(t.why_tokens || []).length ? `<div class="sub" style="margin:8px 0 4px">Words that drove this decision</div>${t.why_tokens.map(w => `<span class="tok">${esc(w.token)}</span>`).join('')}` : ''}</div>
        <div class="card"><h4>Severity</h4><div class="row" style="gap:12px">${gauge(t.sev, t.sev_label, 130)}<div>${sevChip(t.sev_label)}<div class="sub" style="margin-top:6px">${esc(slaText(t))}</div></div></div><ul class="why">${(t.sev_why || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul></div></div>
      <div class="card flush"><div class="chead" style="padding-bottom:6px"><div><h4>Location</h4><p class="sub">${esc(t.geo_by || 'Not located')}${t.geo_conf ? ' · ' + Math.round(t.geo_conf * 100) + '% confidence' : ''}${t.lamp_id ? ` · lamp <span class="mono">${esc(t.lamp_id)}</span>` : ''}</p></div></div><div class="mapbox short" id="tdm" style="height:210px"></div></div>
      ${live ? `<div class="card"><h4>Actions</h4>
        <div class="field" style="margin-top:10px"><label>Assign technician</label><div class="row"><select class="input" id="techSel"><option value="">Choose…</option>${techOpts}</select><button class="btn primary" id="assign">Assign</button></div>
          ${t.tech_name ? `<div class="sub">Currently ${esc(t.tech_name)}${t.eta_ts ? ' · ETA ' + clock(t.eta_ts) : ''}</div>` : ''}</div>
        <div class="field"><label>Correct fault type (teaches the model)</label><div class="row"><select class="input" id="clsSel">${Object.entries(state.meta.classes).filter(([k]) => k !== 'preventive').map(([k, v]) => `<option value="${k}" ${k === t.cls ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select><button class="btn" id="fixCls">Save</button></div></div>
        <div class="field"><label>Note or resolution</label><input class="input" id="note" placeholder="Add a note, or describe the fix when resolving"></div>
        <div class="row wrap"><button class="btn good" id="resolve">${icon('check', 'sm')} Mark resolved</button><button class="btn" id="noteBtn">Add note</button>${t.status !== 'open' ? '<button class="btn" id="reopen">Move to open queue</button>' : ''}<button class="btn danger right" id="reject">Reject</button></div></div>` : `<div class="card"><h4>Closed</h4><p class="sub" style="margin-top:6px">${esc(t.resolution_note || '')}${t.parts_used ? ' · Parts: ' + esc(t.parts_used) : ''}${t.rating ? ` · Citizen rating ${'★'.repeat(t.rating)}` : ''}</p><div class="row" style="margin-top:10px"><button class="btn" id="reopen">Reopen ticket</button></div></div>`}
      <div class="card"><h4>Timeline</h4><ul class="tl" style="margin-top:14px">${t.events.slice().reverse().map(e => `<li class="${e.actor === 'AI pipeline' || e.actor === 'AI dispatcher' ? 'ai' : e.kind === 'resolved' ? 'good' : ''}"><span class="d"></span><b>${esc(EVENT_LABEL[e.kind] || e.kind)}</b><p>${esc(e.detail || '')}</p><small>${esc(e.actor)} · ${dt(e.ts)}</small></li>`).join('')}</ul></div>
      ${t.auto_reply ? `<div class="card"><h4>Auto-reply sent to citizen</h4><div class="reply" style="margin-top:8px">${esc(t.auto_reply)}</div></div>` : ''}`;
    if (map) { removeMap(map); map = null; }
    if (t.lat != null) { map = createMap($('#tdm'), { center: [t.lat, t.lng], zoom: 16, labels: false }); targetPin(map, t.lat, t.lng); } else $('#tdm').innerHTML = '<div class="empty" style="color:#95A3BF">No location yet</div>';
    const done = async (fn, msg) => { try { await fn(); toast(msg, 'good'); onChange && onChange(); draw(); } catch (e) { toast(e.message); } };
    const b = (sel, fn) => { const el = $(sel, d.el); if (el) el.onclick = ev => btnBusy(ev.currentTarget, fn); };
    b('#assign', async () => { const v = $('#techSel', d.el).value; if (!v) return toast('Choose a technician first.'); await done(() => api.post(`/api/admin/tickets/${id}/assign`, { tech_id: +v }), 'Technician assigned'); });
    b('#fixCls', async () => { const v = $('#clsSel', d.el).value; if (v === t.cls) return toast('Fault type unchanged.'); await done(() => api.post(`/api/admin/tickets/${id}/review`, { cls: v }), 'Corrected. Saved as a training example.'); });
    b('#resolve', async () => done(() => api.post(`/api/admin/tickets/${id}/status`, { status: 'resolved', note: $('#note', d.el).value }), 'Marked resolved'));
    b('#reject', async () => done(() => api.post(`/api/admin/tickets/${id}/status`, { status: 'rejected', note: $('#note', d.el).value || 'Closed by control room' }), 'Ticket rejected'));
    b('#reopen', async () => done(() => api.post(`/api/admin/tickets/${id}/status`, { status: 'open', note: $('#note', d.el)?.value || '' }), 'Moved back to the open queue'));
    b('#noteBtn', async () => { const v = $('#note', d.el).value.trim(); if (!v) return toast('Write a note first.'); await done(() => api.post(`/api/admin/tickets/${id}/note`, { note: v }), 'Note added'); });
  };
  await draw();
  const off = bus.on('ticket', x => { if (x.ticket && x.ticket.id === id) draw(); });
  const obs = new MutationObserver(() => { if (!document.body.contains(d.el)) { off(); obs.disconnect(); removeMap(map); } });
  obs.observe(document.body, { childList: true });
  return d;
}
