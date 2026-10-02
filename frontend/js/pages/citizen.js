// Citizen pages: home, report a fault (live AI preview), my reports (+ detail/tracking), city map
import { $, $$, esc, api, bus, state, icon, toast, btnBusy, debounce, ago, dt, clock, hrs, slaText, sevChip, statusChip, clsChip, slaChip, chanIcon, highlight, entLegend, gauge, probBars, metaCls, zoneName, openModal, confirmBox } from '../core.js';
import { createMap, destroyMaps, removeMap, lampLayer, pin, targetPin, fit, STATUS_COLOR } from '../map.js';

/* ---------- shared bits ---------- */
const STEPS = ['Received', 'AI verified', 'Crew assigned', 'Repairing', 'Fixed'];
const IDX = { review: 1, open: 2, assigned: 3, in_progress: 3, resolved: 5, rejected: 0 };
export function stepper(status) {
  const idx = IDX[status] ?? 0;
  return `<div class="stepper" role="list" aria-label="Progress">${STEPS.map((s, i) => `<div class="step ${i < idx ? 'done' : i === idx && idx < 5 ? 'cur' + (status === 'in_progress' ? ' live' : '') : ''}" role="listitem"><div class="n">${i < idx ? icon('check', 'sm') : i + 1}</div>${s}</div>`).join('')}</div>`;
}
const first = n => (n || '').split(' ')[0];
function ticketCard(t) {
  const c = metaCls(t.cls);
  return `<a class="ticket-card" href="#/tickets/${t.id}" style="text-decoration:none;color:inherit">
    <div class="row wrap" style="gap:6px">${clsChip(t.cls_label, t.color)}${sevChip(t.sev_label)}${statusChip(t.status)}${slaChip(t)}<span class="sub right mono">${t.code}</span></div>
    <p>${esc(t.text || '')}</p>
    ${stepper(t.status)}
    <div class="row between sub"><span>${icon('pin', 'sm')} ${esc(t.zone_name || 'Location pending')}${t.lamp_id ? ' · ' + esc(t.lamp_id) : ''}</span><span>${t.status === 'resolved' ? 'Fixed ' + ago(t.resolved_ts) : t.eta_ts ? 'Crew ETA ' + clock(t.eta_ts) : 'Reported ' + ago(t.ts)}</span></div></a>`;
}

/* ---------- home ---------- */
export async function home({ el, user }) {
  destroyMaps();
  el.innerHTML = '<div class="skeleton"></div>';
  const [{ items }, city] = await Promise.all([api.get('/api/my/tickets'), api.get('/api/city/map')]);
  const active = items.filter(t => !['resolved', 'rejected'].includes(t.status)), done = items.filter(t => t.status === 'resolved');
  const s = city.stats;
  el.innerHTML = `
  <div class="hero"><h2>Hello ${esc(first(user.name))}. See a streetlight that's off?</h2><p>Tell us in your own words, in English, Hindi, Marathi or Hinglish. We find the lamp, judge how urgent it is and send a crew.</p><a class="btn primary big" href="#/report">${icon('plus')} Report a faulty light</a></div>
  <div class="grid g4" style="margin-top:16px">
    <div class="kpi"><div class="lbl">${icon('list')} Your reports</div><b>${items.length}</b><small>${active.length} still open</small></div>
    <div class="kpi good"><div class="lbl">${icon('checkc')} Fixed for you</div><b>${done.length}</b><small>thank you for helping</small></div>
    <div class="kpi"><div class="lbl">${icon('zap')} Lamps working</div><b>${s.lamps_online_pct}%</b><small>${s.lamps_total - s.lamps_ok} of ${s.lamps_total} need attention</small><div class="bar"><i style="width:${s.lamps_online_pct}%;background:var(--ok)"></i></div></div>
    <div class="kpi"><div class="lbl">${icon('clock')} Average fix time</div><b>${s.avg_resolution_h} h</b><small>${s.sla_met_pct}% fixed within target</small></div>
  </div>
  <div class="grid g-main">
    <div class="stack"><div class="row between"><h3>Your active reports</h3><a href="#/tickets">See all</a></div>
      ${active.length ? active.slice(0, 3).map(ticketCard).join('') : `<div class="card empty"><b>No open reports</b>All your reports are fixed. Spotted another dark street?<div style="margin-top:12px"><a class="btn primary" href="#/report">Report a fault</a></div></div>`}</div>
    <div class="card flush"><div class="chead"><div><h3>City light status</h3><p class="sub">Live. Tap a lamp for details</p></div><a class="btn small" href="#/map">Full map</a></div><div class="mapbox short" id="mm"></div>
      <div class="legend"><span><i style="background:#FFD27A"></i>Working</span><span><i style="background:#FF4D4D"></i>Faulty</span><span><i style="background:#2CD3B5"></i>Crew on the way</span></div></div>
  </div>`;
  const map = createMap($('#mm'), { zoom: 11, wheel: false, labels: false });
  lampLayer(map, city.lamps, { radius: 4 }); fit(map, city.lamps.map(l => [l.lat, l.lng]), .05);
  return bus.on('ticket', debounce(() => { if (location.hash.startsWith('#/home') || location.hash === '#/') home({ el, user }); }, 1500));
}

/* ---------- report ---------- */
const EXAMPLES = [
  ['English', 'The street light near SIES College Nerul keeps flickering on and off since 3 days. Students walk here at night.'],
  ['Hinglish', 'Kharghar Central Park ke paas light band hai, andhera hai. Please fix'],
  ['हिन्दी', 'नेरुल स्टेशन के पास स्ट्रीट लाइट बंद है, अंधेरा है'],
  ['मराठी', 'वाशी स्टेशन जवळ दिवा बंद आहे, खूप अंधार आहे'],
  ['Danger', 'Sparks coming from the pole near Vashi Station and a wire is hanging!']
];
export async function report({ el }) {
  const st = { gps: null, photo: null, tok: 0, last: '' };
  const pre = sessionStorage.getItem('prefill');
  if (pre) { try { st.pre = JSON.parse(pre); } catch (e) { /* ignore */ } sessionStorage.removeItem('prefill'); }
  el.innerHTML = `<div class="grid g-main" style="margin-top:4px">
    <div class="stack" id="left"><div class="card">
      <div class="row between"><h3>What's wrong?</h3><span class="sub" id="cnt">0 / 2000</span></div>
      <p class="sub">Describe the problem and where it is. Mention a landmark, road or pole ID if you can.</p>
      <div class="field" style="margin-top:12px"><textarea class="input" id="txt" maxlength="2000" placeholder="e.g. The street light near SIES College Nerul keeps flickering since 3 days" aria-label="Describe the problem"></textarea></div>
      <div class="row wrap" style="gap:8px;margin-bottom:12px"><span class="sub">Try an example:</span><div class="samples">${EXAMPLES.map((e, i) => `<button type="button" data-i="${i}">${e[0]}</button>`).join('')}</div></div>
      <div class="row wrap" id="voiceRow" style="gap:8px"></div>
    </div>
    <div class="card flush"><div class="chead"><div><h3>Where is it?</h3><p class="sub">Optional but the fastest way to get a crew to the right pole</p></div>
      <div class="row wrap"><button class="btn small" id="gpsBtn" type="button">${icon('gps', 'sm')} Use my location</button><button class="btn small ghost hide" id="clrPin" type="button">Clear pin</button></div></div>
      <div class="mapbox short" id="pm"></div><div class="legend"><span>${icon('pin', 'sm')} Tap the map to drop a pin</span><span><i style="background:#2CD3B5"></i>Where the AI thinks it is</span></div></div>
    <div class="card"><div class="row between"><h3>Photo</h3><span class="sub">Optional</span></div>
      <label class="drop" id="drop" style="display:block;margin-top:10px">${icon('camera', 'lg')}<div>Tap to add a photo of the light or pole</div><input type="file" id="photo" accept="image/*" class="hide"></label></div>
    <div class="row"><button class="btn primary big" id="submit" style="flex:1">${icon('send')} Submit report</button></div></div>
    <div class="stack" id="right"><div class="card" id="ai"></div><div id="near"></div></div></div>`;

  const $t = $('#txt');
  const map = createMap($('#pm'), { zoom: 12, labels: true });
  const lamps = await api.get('/api/city/map');
  lampLayer(map, lamps.lamps, { radius: 3.5, color: l => l.status === 'ok' ? '#6E86B8' : STATUS_COLOR[l.status] });
  let pinM = null, aiM = null;
  const setPin = (lat, lng, pan) => {
    st.gps = [lat, lng]; if (pinM) map.removeLayer(pinM);
    pinM = pin(map, lat, lng, { color: '#FFB21F', text: '★', size: 28, draggable: true });
    pinM.on('dragend', () => { const p = pinM.getLatLng(); st.gps = [p.lat, p.lng]; analyze(); nearby(); });
    $('#clrPin').classList.remove('hide'); if (pan) map.setView([lat, lng], 16); analyze(); nearby();
  };
  map.on('click', e => setPin(e.latlng.lat, e.latlng.lng));
  $('#clrPin').onclick = () => { st.gps = null; if (pinM) map.removeLayer(pinM); pinM = null; $('#clrPin').classList.add('hide'); analyze(); $('#near').innerHTML = ''; };
  $('#gpsBtn').onclick = () => {
    if (!navigator.geolocation) return toast('Your browser does not support location.');
    navigator.geolocation.getCurrentPosition(p => {
      const { latitude: la, longitude: lo } = p.coords;
      if (la < 18.5 || la > 19.5 || lo < 72.5 || lo > 73.5) { toast('You appear to be outside the Navi Mumbai service area. Drop a pin on the map instead.'); return; }
      setPin(la, lo, true);
    }, () => toast('Could not get your location. Drop a pin on the map instead.'), { enableHighAccuracy: true, timeout: 8000 });
  };
  $$('.samples button').forEach(b => b.onclick = () => { $t.value = EXAMPLES[b.dataset.i][1]; $t.dispatchEvent(new Event('input')); });

  // voice input (Chrome / Edge)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    $('#voiceRow').innerHTML = `<button class="btn small" id="mic" type="button">${icon('mic', 'sm')} Speak instead</button><select class="input sm" id="vlang" style="width:auto" aria-label="Speech language"><option value="en-IN">English</option><option value="hi-IN">हिन्दी</option><option value="mr-IN">मराठी</option></select><span class="sub" id="vstat"></span>`;
    let rec = null;
    $('#mic').onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = $('#vlang').value; rec.interimResults = true; rec.continuous = false;
      const base = $t.value ? $t.value + ' ' : '';
      rec.onresult = e => { $t.value = base + [...e.results].map(r => r[0].transcript).join(' '); $t.dispatchEvent(new Event('input')); };
      rec.onend = () => { rec = null; $('#vstat').textContent = ''; $('#mic').innerHTML = `${icon('mic', 'sm')} Speak instead`; };
      rec.onerror = ev => { $('#vstat').textContent = ev.error === 'not-allowed' ? 'Microphone blocked' : 'Could not hear you'; };
      rec.start(); $('#vstat').textContent = 'Listening…'; $('#mic').innerHTML = `${icon('x', 'sm')} Stop`;
    };
  }

  // photo
  const onPhoto = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('That photo is larger than 5 MB.'); e.target.value = ''; return; }
    st.photo = f; const r = new FileReader();
    r.onload = () => { $('#drop').innerHTML = `<img src="${r.result}" alt="Selected photo"><div class="sub" style="margin-top:6px">${esc(f.name)} · tap to change</div><input type="file" id="photo" accept="image/*" class="hide">`; $('#photo').onchange = onPhoto; };
    r.readAsDataURL(f);
  };
  $('#photo').onchange = onPhoto;

  // live AI understanding
  const aiBox = $('#ai');
  const empty = () => aiBox.innerHTML = `<h3>${icon('cpu')} What our AI understood</h3><p class="sub" style="margin:6px 0 14px">Start typing and you'll see how your message is read, live.</p>
    <ul class="steps">${['Language', 'Fault type', 'Places and pole IDs', 'How urgent', 'Which lamp'].map(x => `<li><span class="tick"></span><b style="font-weight:500">${x}</b><em></em></li>`).join('')}</ul>`;
  empty();
  async function analyze() {
    const text = $t.value.trim(); if (text.length < 6) { empty(); return; }
    const tok = ++st.tok; aiBox.style.opacity = .7;
    try {
      const { analysis: a } = await api.post('/api/analyze', { text, channel: 'Web portal', lat: st.gps && st.gps[0], lng: st.gps && st.gps[1] });
      if (tok !== st.tok) return; aiBox.style.opacity = 1; st.a = a; drawAI(a);
    } catch (e) { aiBox.style.opacity = 1; aiBox.innerHTML = `<div class="note bad">${icon('warn')}<span>${esc(e.message)}</span></div>`; }
  }
  function drawAI(a) {
    if (aiM) { map.removeLayer(aiM); aiM = null; }
    if (a.geo && !st.gps) { aiM = targetPin(map, a.lamp ? a.lamp.lat : a.geo.lat, a.lamp ? a.lamp.lng : a.geo.lng); map.setView([a.geo.lat, a.geo.lng], 15); }
    const eta = `${a.sla_hours} hours`;
    aiBox.innerHTML = `<h3>${icon('cpu')} What our AI understood</h3>
      <div class="row wrap" style="gap:8px;margin:12px 0">${clsChip(a.cls_label, a.color)}${sevChip(a.sev.label)}<span class="chip c-mute">${esc(a.lang)}</span><span class="chip c-info">${Math.round(a.conf * 100)}% sure</span></div>
      <div class="hltext" style="font-size:15px;line-height:2">${highlight(a.text, a.ents)}</div>
      <div class="row wrap" style="gap:4px;margin-bottom:6px">${entLegend()}</div>
      <dl class="kv" style="margin-top:12px">
        <dt>Location</dt><dd>${a.geo ? `<b>${esc(a.geo.zone_name)}</b> · ${esc(a.geo.by)}` : '<span style="color:var(--warn)">Not found. Add a landmark, road or pin on the map</span>'}</dd>
        <dt>Lamp</dt><dd>${a.lamp ? `<span class="mono">${esc(a.lamp.id)}</span> matched` : 'A person will match the lamp'}</dd>
        <dt>Urgency</dt><dd>${a.sev.label} (${a.sev.score}/100) · target fix in <b>${eta}</b></dd>
        <dt>Handled by</dt><dd>${esc(a.dept)}</dd></dl>
      ${a.override ? `<div class="note warn">${icon('warn')}<span>Electrical danger words detected. This is treated as a hazard. <b>Keep away from the pole.</b></span></div>` : ''}
      ${a.duplicate ? `<div class="note info" id="dupBox">${icon('info')}<span>This fault is already reported as <b>${esc(a.duplicate.code)}</b> (${a.duplicate.reports} citizen${a.duplicate.reports > 1 ? 's' : ''}). Submitting adds your report to it and raises its priority.</span></div>` : ''}
      ${a.review ? `<div class="note warn">${icon('eye')}<span>${esc(a.review)}. A control-room operator will check it and may ask you for a landmark.</span></div>` : ''}`;
  }
  const nearby = async () => {
    if (!st.gps) return;
    const { items } = await api.get(`/api/nearby?lat=${st.gps[0]}&lng=${st.gps[1]}`);
    $('#near').innerHTML = items.length ? `<div class="card"><h3>Already reported near here</h3><p class="sub">Confirm an existing report instead of filing a new one</p>${items.map(t => `<div class="row between" style="padding:10px 0;border-top:1px solid var(--line)"><div>${clsChip(t.cls_label, t.color)} <span class="sub">${t.distance_m} m away · ${t.reports} report${t.reports > 1 ? 's' : ''} · ${statusChip(t.status)}</span></div><button class="btn small" data-c="${t.id}">Me too</button></div>`).join('')}</div>` : '';
    $$('#near [data-c]').forEach(b => b.onclick = () => btnBusy(b, async () => { try { await api.post(`/api/tickets/${b.dataset.c}/confirm`); toast('Thanks! Your confirmation was added.', 'good'); b.textContent = 'Confirmed'; b.disabled = true; } catch (e) { toast(e.message); } }));
  };
  const deb = debounce(analyze, 550);
  $t.addEventListener('input', () => { $('#cnt').textContent = `${$t.value.length} / 2000`; deb(); });

  $('#submit').onclick = ev => btnBusy(ev.currentTarget, async () => {
    const text = $t.value.trim(); if (text.length < 6) { toast('Please describe the problem first.'); $t.focus(); return; }
    const fd = new FormData(); fd.append('text', text); fd.append('channel', 'Web portal');
    if (st.gps) { fd.append('lat', st.gps[0]); fd.append('lng', st.gps[1]); }
    if (st.photo) fd.append('photo', st.photo);
    try {
      const r = await api.post('/api/tickets', fd);
      state.user.unread++; success(r);
    } catch (e) { toast(e.message); }
  });
  function success(r) {
    const t = r.ticket;
    $('#left').innerHTML = `<div class="card accent fade"><div class="row" style="gap:12px"><div class="avatar" style="background:var(--ok);color:#fff;width:46px;height:46px">${icon('check', 'lg')}</div><div><h3>${r.merged ? 'Added to an existing report' : 'Report received'}</h3><p class="sub">Reference <b class="mono">${t.code}</b></p></div></div>
      <div class="row wrap" style="gap:8px;margin:14px 0">${clsChip(t.cls_label, t.color)}${sevChip(t.sev_label)}${statusChip(t.status)}</div>
      ${stepper(t.status)}
      <div class="reply" style="margin-top:14px"><div class="sub" style="margin-bottom:4px">Automatic reply</div>${esc(r.reply)}</div>
      ${t.sev_label === 'Critical' ? `<div class="note warn">${icon('warn')}<span>This looks dangerous and has been flagged critical. Please keep people away from the pole.</span></div>` : ''}
      <div class="row wrap" style="margin-top:16px"><a class="btn primary" href="#/tickets/${t.id}">Track this report</a><button class="btn" id="again">Report another</button></div></div>`;
    $('#again').onclick = () => report({ el });
  }
  if (st.pre) { $t.value = st.pre.text || ''; if (st.pre.lat) setPin(st.pre.lat, st.pre.lng, true); $t.dispatchEvent(new Event('input')); }
}

/* ---------- my reports ---------- */
export async function tickets({ el, params, user, setTitle }) {
  if (params[0]) return detail({ el, id: +params[0], user, setTitle });
  let filter = 'active';
  const draw = async () => {
    const { items } = await api.get('/api/my/tickets');
    const act = items.filter(t => !['resolved', 'rejected'].includes(t.status)), done = items.filter(t => ['resolved', 'rejected'].includes(t.status));
    const list = filter === 'active' ? act : filter === 'done' ? done : items;
    el.innerHTML = `<div class="row between wrap" style="margin-bottom:14px"><div class="seg" id="seg"><button data-f="active" aria-pressed="${filter === 'active'}">Active (${act.length})</button><button data-f="done" aria-pressed="${filter === 'done'}">Fixed (${done.length})</button><button data-f="all" aria-pressed="${filter === 'all'}">All (${items.length})</button></div><a class="btn primary" href="#/report">${icon('plus')} New report</a></div>
      <div class="grid g2" style="margin-top:0">${list.map(ticketCard).join('') || `<div class="card empty" style="grid-column:1/-1"><b>Nothing here yet</b>Reports you file will appear here with live progress.</div>`}</div>`;
    $$('#seg button').forEach(b => b.onclick = () => { filter = b.dataset.f; draw(); });
  };
  await draw();
  return bus.on('ticket', debounce(() => location.hash === '#/tickets' && draw(), 1200));
}

async function detail({ el, id, user, setTitle }) {
  let map = null;
  const draw = async () => {
    let t; try { t = (await api.get(`/api/tickets/${id}`)).ticket; } catch (e) { el.innerHTML = `<div class="card empty"><b>Can't open this report</b>${esc(e.message)}<div style="margin-top:12px"><a class="btn" href="#/tickets">Back to my reports</a></div></div>`; return; }
    setTitle(t.code, `${t.cls_label} · ${t.zone_name || 'location pending'}`);
    const rate = t.status === 'resolved' && t.reporter_name === user.name ? (t.rating ? `<div class="card"><h3>Your rating</h3><div class="stars" aria-label="${t.rating} stars">${[1, 2, 3, 4, 5].map(n => `<button class="${n <= t.rating ? 'on' : ''}" disabled>${icon('star')}</button>`).join('')}</div>${t.feedback ? `<p class="muted" style="margin-top:8px">“${esc(t.feedback)}”</p>` : ''}</div>` :
      `<div class="card accent"><h3>How was the repair?</h3><p class="sub">Your rating helps us improve.</p><div class="stars" id="stars" style="margin:10px 0">${[1, 2, 3, 4, 5].map(n => `<button data-n="${n}" aria-label="${n} star">${icon('star')}</button>`).join('')}</div><textarea class="input" id="fb" style="min-height:70px" placeholder="Anything to add? (optional)"></textarea><button class="btn primary" id="rate" style="margin-top:10px" disabled>Submit rating</button></div>`) : '';
    el.innerHTML = `<a href="#/tickets" class="sub" style="display:inline-block;margin-bottom:10px">← My reports</a>
      <div class="grid g-main" style="margin-top:0"><div class="stack">
        <div class="card"><div class="row wrap" style="gap:8px">${clsChip(t.cls_label, t.color)}${sevChip(t.sev_label)}${statusChip(t.status)}${slaChip(t)}</div>
          ${t.status === 'rejected' ? `<div class="note bad">${icon('x')}<span>This report was closed. ${esc(t.resolution_note || '')}</span></div>` : stepper(t.status)}
          <p style="margin:14px 0;font-size:15.5px;line-height:1.6">${esc(t.text)}</p>
          ${t.photo ? `<img src="${esc(t.photo)}" alt="Photo attached to report" style="max-width:100%;max-height:220px;border-radius:12px">` : ''}
          ${t.tech_name && t.status !== 'resolved' ? `<div class="note good">${icon('truck')}<span><b>${esc(t.tech_name)}</b> is assigned${t.eta_ts ? ` · expected around <b>${clock(t.eta_ts)}</b>` : ''}.</span></div>` : ''}
          ${t.status === 'review' ? `<div class="note info">${icon('eye')}<span>A control-room operator is checking this report${t.review_reason ? ` (${esc(t.review_reason)})` : ''}. You may be asked for a landmark.</span></div>` : ''}
          ${t.status === 'resolved' ? `<div class="note good">${icon('checkc')}<span>Fixed ${ago(t.resolved_ts)}${t.resolution_note ? ': ' + esc(t.resolution_note) : ''}</span></div>` : ''}</div>
        ${rate}
        <div class="card"><h3>Timeline</h3><ul class="tl" style="margin-top:14px">${t.events.slice().reverse().map(e => `<li class="${e.actor === 'AI pipeline' ? 'ai' : e.kind === 'resolved' ? 'good' : ''}"><span class="d"></span><b>${esc(label(e.kind))}</b><p>${esc(e.detail || '')}</p><small>${esc(e.actor)} · ${dt(e.ts)}</small></li>`).join('')}</ul></div></div>
        <div class="stack"><div class="card flush"><div class="chead"><div><h3>Location</h3><p class="sub">${esc(t.lamp_id || 'Lamp not matched yet')}</p></div></div><div class="mapbox short" id="dm"></div></div>
          <div class="card"><h3>Details</h3><dl class="kv" style="margin-top:12px"><dt>Reference</dt><dd class="mono">${t.code}</dd><dt>Reported</dt><dd>${dt(t.ts)} via ${esc(t.channel)}</dd><dt>Fault type</dt><dd>${esc(t.cls_label)}</dd><dt>Priority</dt><dd>${esc(t.sev_label)}</dd><dt>Target</dt><dd>${esc(slaText(t))}</dd><dt>Confirmed by</dt><dd>${t.reports} citizen${t.reports > 1 ? 's' : ''}</dd></dl></div></div></div>`;
    if (t.lat != null) { removeMap(map); map = createMap($('#dm'), { center: [t.lat, t.lng], zoom: 17, labels: false }); targetPin(map, t.lat, t.lng); } else $('#dm').innerHTML = '<div class="empty" style="color:#95A3BF">Location pending</div>';
    let n = 0; $$('#stars button').forEach(b => b.onclick = () => { n = +b.dataset.n; $$('#stars button').forEach(x => x.classList.toggle('on', +x.dataset.n <= n)); $('#rate').disabled = false; });
    const rb = $('#rate'); if (rb) rb.onclick = () => btnBusy(rb, async () => { try { await api.post(`/api/tickets/${id}/rate`, { rating: n, feedback: $('#fb').value }); toast('Thank you for rating!', 'good'); draw(); } catch (e) { toast(e.message); } });
  };
  await draw();
  return bus.on('ticket', d => { if (d.ticket && d.ticket.id === id) draw(); });
}
const label = k => ({ received: 'Report received', classified: 'Fault type identified', severity: 'Urgency scored', located: 'Location matched', review: 'Sent for human review', autoreply: 'Reply sent to you', assigned: 'Crew assigned', started: 'Repair started', resolved: 'Fixed', merged: 'Another citizen confirmed', rejected: 'Closed', reopened: 'Reopened', rated: 'You rated this', note: 'Note', reviewed: 'Checked by control room', corrected: 'Corrected by control room', confirmed: 'Confirmed by control room', prep: 'Message cleaned' }[k] || k);

/* ---------- city map ---------- */
export async function cityMap({ el, user }) {
  destroyMaps();
  const d = await api.get('/api/city/map'), s = d.stats;
  el.innerHTML = `<div class="kpis" style="margin-bottom:16px">
    <div class="kpi"><div class="lbl">${icon('zap')} Lamps working</div><b>${s.lamps_online_pct}%</b><small>${s.lamps_ok} of ${s.lamps_total}</small></div>
    <div class="kpi"><div class="lbl">${icon('warn')} Open faults</div><b>${s.open}</b><small>being handled</small></div>
    <div class="kpi"><div class="lbl">${icon('clock')} Average fix</div><b>${s.avg_resolution_h} h</b><small>${s.sla_met_pct}% within target</small></div>
    <div class="kpi"><div class="lbl">${icon('star')} Citizen rating</div><b>${s.csat ?? '–'}</b><small>out of 5</small></div></div>
    <div class="card flush"><div class="mapbox tall" id="cm"></div><div class="legend"><span><i style="background:#FFD27A"></i>Working</span><span><i style="background:#FF4D4D"></i>Faulty</span><span><i style="background:#2CD3B5"></i>Crew assigned</span></div></div>`;
  const map = createMap($('#cm'), { zoom: 12 });
  lampLayer(map, d.lamps, {
    radius: 6.5,
    onClick: (l, m) => {
      const t = d.tickets[l.id];
      const btn = user.role === 'citizen' && l.status === 'ok' ? `<div style="margin-top:8px"><button class="btn small primary" id="repLamp">Report this lamp</button></div>` : '';
      m.bindPopup(`<b class="mono">${esc(l.id)}</b><br>${zoneName(l.zone)} · ${l.status === 'ok' ? 'Working' : l.status === 'assigned' ? 'Crew assigned' : 'Faulty'}${t ? `<br>${esc(t.cls_label)} · ${esc(t.sev_label)} · ${t.reports} report${t.reports > 1 ? 's' : ''}` : ''}${btn}`).openPopup();
      setTimeout(() => { const b = document.getElementById('repLamp'); if (b) b.onclick = () => { sessionStorage.setItem('prefill', JSON.stringify({ text: `${l.id} is not working.`, lat: l.lat, lng: l.lng })); location.hash = '#/report'; }; }, 30);
    }
  });
  fit(map, d.lamps.map(l => [l.lat, l.lng]), .05);
  return bus.on('ticket', debounce(() => cityMap({ el, user }), 3000));
}
