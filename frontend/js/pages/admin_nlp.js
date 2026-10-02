// Admin NLP + platform pages: NLP lab, channels simulator, analytics, model performance
import { $, $$, esc, api, bus, state, icon, toast, btnBusy, debounce, ago, dt, clock, sevChip, clsChip, statusChip, chanIcon, highlight, entLegend, gauge, probBars, mkChart, css, metaCls, zoneName, openModal } from '../core.js';
import { createMap, lampLayer, targetPin, fit } from '../map.js';
import { openTicketDrawer } from './ticket_drawer.js';

/* ================= NLP lab ================= */
const SAMPLES = [
  ['Flicker + safety', 'WhatsApp', 'The light near SIES College Nerul keeps flickering on and off since 3 days. Students walk here at night, very unsafe.'],
  ['Exposed wire', 'Call centre', 'uh caller reports sparks and um a wire hanging from the pole near Vashi Station!'],
  ['Hinglish', 'WhatsApp', 'Kharghar Central Park ke paas 4 lights band hai, andhera hai. Please fix'],
  ['हिन्दी', 'WhatsApp', 'नेरुल स्टेशन के पास स्ट्रीट लाइट बंद है, अंधेरा है'],
  ['मराठी', 'SMS', 'वाशी स्टेशन जवळ दिवसा पण स्ट्रीट लाईट चालू आहे, वीज वाया जातेय'],
  ['Tweet', 'X / Twitter', '@NMMC_Helpline #NerulStreetlight flickering on Palm Beach Road, dangerous for bikers! 😡 pls fix'],
  ['Email', 'Email', 'Subject: Streetlight dead near Belapur Station\nHello team,\nThe lamp outside Belapur Station has been off for 5 days. Women feel unsafe at night.\n> On Mon, old quoted text\n-- \nRegards, Rohan'],
  ['Pole ID', 'Web portal', 'SL-NER-021 not glowing near D Y Patil Stadium'],
  ['No location', 'Email', 'Street light not working near the temple, please fix ASAP'],
  ['Whole road', 'WhatsApp', 'Why are all the lights off on Palm Beach Road? Whole stretch is dark.']
];
let labState = { ch: 'WhatsApp', text: '' };
let runTok = 0;

export async function lab({ el }) {
  if (!labState.text) { labState.text = SAMPLES[0][2]; labState.ch = SAMPLES[0][1]; }
  el.innerHTML = `<div class="grid g-main" style="margin-top:4px">
    <div class="card"><h3>Incoming message</h3><p class="sub">Any channel goes through the same pipeline. Paste a message or pick an example in any of four languages.</p>
      <div class="seg" id="chSeg" style="margin-top:12px">${state.meta.channels.map(c => `<button data-c="${esc(c)}" aria-pressed="${labState.ch === c}">${esc(c)}</button>`).join('')}</div>
      <div class="field" style="margin-top:12px"><textarea class="input" id="txt" aria-label="Complaint text" placeholder="Type or paste a complaint">${esc(labState.text)}</textarea></div>
      <div class="samples" style="margin-bottom:14px">${SAMPLES.map((s, i) => `<button data-i="${i}">${esc(s[0])}</button>`).join('')}</div>
      <button class="btn primary" id="go">${icon('cpu', 'sm')} Analyse message</button></div>
    <div class="card"><h3>Pipeline</h3><p class="sub">Seven steps, run in order</p><ul class="steps" id="steps"></ul></div></div><div id="result"></div>`;
  $$('#chSeg button').forEach(b => b.onclick = () => { labState.ch = b.dataset.c; $$('#chSeg button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $$('.samples button').forEach(b => b.onclick = () => { const s = SAMPLES[b.dataset.i]; $('#txt').value = s[2]; labState.ch = s[1]; $$('#chSeg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.c === s[1])); run(); });
  $('#go').onclick = () => run();
  run(true);
}

async function run(fast) {
  const text = $('#txt').value.trim(); if (!text) { toast('Type a message first.'); return; }
  labState.text = text; const tok = ++runTok;
  let a; try { a = (await api.post('/api/analyze', { text, channel: labState.ch })).analysis; } catch (e) { toast(e.message); return; }
  const rows = [
    ['Clean the text', a.prep.length ? `${a.prep.length} fix${a.prep.length > 1 ? 'es' : ''}` : 'Already clean'], ['Detect language', a.lang],
    ['Classify fault type', `${a.cls_label} · ${Math.round(a.conf * 100)}%`], ['Extract entities (NER)', `${a.ents.length} found`],
    ['Score severity', `${a.sev.label} · ${a.sev.score}/100`], ['Geocode and snap to lamp', a.geo ? (a.lamp ? a.lamp.id : a.geo.zone_name) : 'Not found'], ['Check for duplicates', a.duplicate ? 'Match ' + a.duplicate.code : 'New fault']];
  const ul = $('#steps'); if (!ul) return;
  ul.innerHTML = rows.map(r => `<li><span class="tick"></span><b style="font-weight:500">${r[0]}</b><em></em></li>`).join('');
  $('#result').innerHTML = ''; const lis = $$('li', ul);
  const step = i => {
    if (tok !== runTok || !$('#steps')) return;
    if (i >= rows.length) { showResult(a); return; }
    lis[i].classList.add('run');
    setTimeout(() => { if (tok !== runTok) return; lis[i].classList.remove('run'); lis[i].classList.add('done'); lis[i].querySelector('.tick').textContent = '✓'; lis[i].querySelector('em').textContent = rows[i][1]; step(i + 1); }, fast ? 0 : 210);
  };
  step(0);
}

function showResult(a) {
  const g = a.geo, dup = a.duplicate;
  $('#result').innerHTML = `<div class="grid g2 fade">
    <div class="card"><h3>1 · Text clean-up</h3><p class="sub">Channel noise removed before the models read it</p>
      <div class="sub" style="margin-top:10px">Original (${esc(labState.ch)})</div><pre class="code" style="white-space:pre-wrap;margin-top:4px">${esc(a.raw)}</pre>
      <div class="sub" style="margin-top:10px">Cleaned</div><div class="reply" style="border-left-color:var(--info);margin-top:4px">${esc(a.text)}</div>
      <div class="tags">${a.prep.length ? a.prep.map(p => `<span class="chip c-info">${esc(p)}</span>`).join('') : '<span class="chip c-mute">No changes needed</span>'}</div></div>
    <div class="card"><h3>2 · Entities found (NER)</h3><p class="sub">Each phrase a crew needs, tagged by type · language <b>${esc(a.lang)}</b></p>
      <div class="hltext">${highlight(a.text, a.ents)}</div><div class="row wrap" style="gap:4px;margin-top:4px">${entLegend()}</div>
      <dl class="kv" style="margin-top:12px"><dt>Duration stated</dt><dd>${a.dur_days ? `about ${a.dur_days < 1 ? Math.round(a.dur_days * 24) + ' hours' : Math.round(a.dur_days) + ' day(s)'}` : 'not mentioned'}</dd><dt>Pole ID</dt><dd>${a.ents.filter(e => e.label === 'POLE_ID').map(e => `<span class="mono">${esc(e.text)}</span>`).join(', ') || '–'}</dd></dl></div></div>
  <div class="grid g2 fade">
    <div class="card"><h3>3 · Fault type</h3><p class="sub">TF-IDF + logistic regression, confidence across all eight classes</p>${probBars(a.probs, 5)}
      ${a.why_tokens.length ? `<div class="sub" style="margin:8px 0 4px">Words and phrases that pushed the decision:</div>${a.why_tokens.map(w => `<span class="tok">${esc(w.token)}</span>`).join('')}` : ''}
      ${a.override ? `<div class="note warn">${icon('warn')}<span>Safety net applied: <b>${esc(a.override)}</b>. Electrical-danger words are never routed to a routine queue.</span></div>` : ''}
      ${a.conf < .55 ? `<div class="note warn">${icon('eye')}<span>Confidence is below 55%, so this ticket would go to a human for review.</span></div>` : ''}</div>
    <div class="card"><h3>4 · Severity</h3><p class="sub">Transparent rule-weighted score: every point is explained</p>
      <div class="row wrap" style="gap:16px">${gauge(a.sev.score, a.sev.label)}<div>${sevChip(a.sev.label)}<div class="sub" style="margin-top:6px">Fix within <b>${a.sla_hours} h</b></div></div></div><ul class="why">${a.sev.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div></div>
  <div class="grid g2 fade">
    <div class="card flush"><div class="chead"><div><h3>5 · Location (GIS)</h3><p class="sub">${g ? esc(g.by) + ' · confidence ' + Math.round(g.conf * 100) + '%' : 'No place name, landmark, pole ID or GPS pin found'}</p></div>${g ? `<span class="chip c-low">${a.lamp ? a.lamp.id : esc(g.zone_name)}</span>` : '<span class="chip c-high">Needs review</span>'}</div><div class="mapbox short" id="lm"></div></div>
    <div class="card"><h3>6 · Decision</h3>
      <dl class="kv" style="margin-top:10px"><dt>Department</dt><dd>${esc(a.dept)}</dd><dt>Crew needed</dt><dd>${a.needs.length ? a.needs.map(n => n === 'hv' ? 'HV-certified electrician' : 'Bucket truck').join(' + ') : 'Standard crew'}</dd><dt>Likely parts</dt><dd>${esc(a.parts)}</dd><dt>Repair time</dt><dd>About ${a.mins} minutes on site</dd><dt>Route</dt><dd>${a.review ? `<span class="chip c-violet">Human review: ${esc(a.review)}</span>` : dup ? `<span class="chip c-info">Merge into ${esc(dup.code)}</span>` : '<span class="chip c-low">Auto-triaged: open ticket</span>'}</dd></dl>
      ${dup ? `<div class="note info">${icon('info')}<span>This lamp already has an open ticket (<b>${esc(dup.code)}</b>, ${dup.reports} report${dup.reports > 1 ? 's' : ''}). A new report becomes another citizen confirmation, not a second work order.</span></div>` : ''}
      <div class="sub" style="margin:12px 0 4px">Automatic reply (in the citizen's language)</div><div class="reply">${esc(a.reply)}</div>
      <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="mk">${icon('plus', 'sm')} ${dup ? 'Add as confirmation' : 'Create ticket from this message'}</button>${dup ? `<button class="btn" id="opn">Open ${esc(dup.code)}</button>` : ''}</div></div></div>`;
  const map = createMap($('#lm'), { zoom: 12, labels: true });
  if (g) { const p = a.lamp || g; targetPin(map, p.lat, p.lng); map.setView([p.lat, p.lng], 16); } else fit(map, state.meta.zones.map(z => [z.lat, z.lng]), .1);
  $('#mk').onclick = e => btnBusy(e.currentTarget, async () => {
    try { const r = await api.post('/api/intake/web', { text: a.raw, channel: labState.ch }); toast(r.merged ? `Merged into ${r.ticket.code}` : `${r.ticket.code} created · ${r.ticket.cls_label} · ${r.ticket.sev_label}`, 'good'); $('#mk').disabled = true; $('#mk').textContent = r.merged ? 'Merged' : 'Ticket created'; } catch (err) { toast(err.message); }
  });
  const o = $('#opn'); if (o) o.onclick = () => openTicketDrawer(dup.id);
}

/* ================= channels ================= */
const CH = {
  whatsapp: { name: 'WhatsApp', cls: 'wa', icon: 'msg', path: 'whatsapp' },
  sms: { name: 'SMS', cls: 'sms', icon: 'msg', path: 'sms' },
  email: { name: 'Email', cls: 'em', icon: 'mail', path: 'email' },
  twitter: { name: 'X / Twitter', cls: 'tw', icon: 'twitter', path: 'twitter' },
  call: { name: 'Call centre', cls: 'cl', icon: 'phone', path: 'call' }
};
const chat = { whatsapp: [], sms: [], email: [], twitter: [], call: [] };
const SEND_HINT = { whatsapp: 'Nerul station ke paas light band hai 2 din se 😡', sms: 'lamp dead near belapur stn since yesterday plz fix', twitter: '@NMMC_Helpline #KhargharLights flickering near Central Park, risky for cyclists', call: 'uh hello, I am calling about the streetlight, um there is a wire hanging near Airoli Bridge and sparks are coming out' };

export async function channels({ el }) {
  let ch = 'whatsapp', last = null, settings = await api.get('/api/admin/settings'), lampsByZone = null, feed = [];
  el.innerHTML = `<div class="grid g-main" style="margin-top:4px">
    <div class="stack"><div class="card"><div class="row between wrap"><div><h3>Omnichannel simulator</h3><p class="sub">Send a message the way a citizen would. It goes through the same webhook a real WhatsApp/SMS/email gateway would call.</p></div><div class="seg" id="cseg">${Object.entries(CH).map(([k, v]) => `<button data-c="${k}" aria-pressed="${k === ch}">${v.name}</button>`).join('')}</div></div>
      <div style="margin-top:18px" id="phone"></div></div>
      <div class="card" id="triage"><h3>AI triage result</h3><p class="sub" style="margin-top:6px">Send a message to see how it was understood.</p></div></div>
    <div class="stack"><div class="card"><h3>Live channel feed</h3><p class="sub">Every message that enters the system</p><div id="lf" style="margin-top:8px"></div></div>
      <div class="card"><h3>Webhook</h3><p class="sub">Point your WhatsApp Business / SMS / email provider here</p><pre class="code" id="curl"></pre><div class="sub">API key <span class="mono">${esc(settings.api_key)}</span> · also works with an admin session</div></div>
      <div class="card"><h3>Bulk import</h3><p class="sub">Upload a CSV with a <span class="mono">text</span> column (optional: channel, lat, lng). Every row runs through the full pipeline.</p>
        <div class="row wrap" style="margin-top:10px"><label class="btn small">${icon('upload', 'sm')} Choose CSV<input type="file" id="csv" accept=".csv,text/csv" class="hide"></label><a class="btn small ghost" id="tpl" download="complaints_template.csv">Download template</a><button class="btn small" id="burst">${icon('zap', 'sm')} Send 5 random complaints</button></div><div id="impRes"></div></div></div></div>`;

  const curl = () => {
    const body = { whatsapp: { from: '+919800000000', body: 'Light not working near Vashi Station', location: { lat: 19.0634, lng: 72.9986 } }, sms: { from: '+919800000000', body: 'lamp dead near Belapur Station' }, email: { from: 'rohan@example.com', subject: 'Streetlight dead', body: 'Lamp outside Belapur Station is off for 5 days' }, twitter: { user: '@citizen', text: '#Nerul streetlight flickering near SIES College' }, call: { caller: '+919800000000', transcript: 'There is a wire hanging near Airoli Bridge' } }[ch];
    $('#curl').textContent = `curl -X POST ${location.origin}/api/intake/${CH[ch].path} \\\n  -H "Content-Type: application/json" \\\n  -H "X-API-Key: ${settings.api_key}" \\\n  -d '${JSON.stringify(body)}'`;
  };
  const addBubble = (role, text, extra = '') => { chat[ch].push({ role, text, extra, t: new Date() }); };
  const phone = () => {
    const c = CH[ch], msgs = chat[ch];
    const hdr = { whatsapp: 'Prakash · City Streetlights<br><small style="font-weight:400;opacity:.8">Official WhatsApp · online</small>', sms: 'NMMC-LIGHTS<br><small style="font-weight:400;opacity:.8">SMS</small>', email: 'complaints@prakash.city<br><small style="font-weight:400;opacity:.8">Email inbox</small>', twitter: '@NMMC_Helpline<br><small style="font-weight:400;opacity:.8">X / Twitter</small>', call: 'Call-centre assistant<br><small style="font-weight:400;opacity:.8">Speech-to-text transcript</small>' }[ch];
    let body = '';
    if (ch === 'email') {
      body = `<div style="padding:14px;overflow:auto;flex:1;color:#E8EDF7;font-size:13.5px"><div class="field"><label style="color:#95A3BF">From</label><input class="input sm" id="eFrom" value="rohan.mehta@example.com" style="background:#1A2742;color:#fff;border:0"></div><div class="field"><label style="color:#95A3BF">Subject</label><input class="input sm" id="eSub" value="Street light not working" style="background:#1A2742;color:#fff;border:0"></div><div class="field"><label style="color:#95A3BF">Message</label><textarea class="input" id="eBody" style="min-height:130px;font-size:13.5px;background:#1A2742;color:#fff;border:0">Hello,\nThe street lamp outside Belapur Station has been off for 5 days. Women feel unsafe at night. Please fix.\n\nRegards,\nRohan</textarea></div><button class="btn primary" id="send" style="width:100%">${icon('send', 'sm')} Send email</button>
        ${msgs.map(m => `<div class="bubble bot" style="max-width:100%;margin-top:10px">${esc(m.text)}<small>Auto-reply · ${m.t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</small></div>`).join('')}</div>`;
    } else {
      body = `<div class="chat" id="chatlog">${msgs.map(m => `<div class="bubble ${m.role}">${esc(m.text)}${m.extra ? `<div style="opacity:.75;margin-top:4px">${m.extra}</div>` : ''}<small>${m.t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</small></div>`).join('') || `<div class="sub" style="text-align:center;margin:auto;color:#95A3BF;padding:0 20px">Type a streetlight complaint below.<br>English, Hindi, Marathi or Hinglish all work.</div>`}</div>
        ${ch === 'whatsapp' ? `<div style="padding:6px 10px;background:#0B1326;display:flex;gap:8px;align-items:center;color:#95A3BF;font-size:12px">${icon('pin', 'sm')} Share location pin:<select id="pinZone" class="input sm" style="width:auto;background:#1A2742;color:#fff;border:0"><option value="">none</option>${state.meta.zones.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></div>` : ''}
        <div class="composer"><${ch === 'call' ? 'textarea rows="2"' : 'input'} id="msg" placeholder="${ch === 'call' ? 'Speak (simulated transcript)…' : ch === 'twitter' ? 'Post a tweet…' : 'Type a message'}" aria-label="Message">${ch === 'call' ? '</textarea>' : ''}<button id="send" aria-label="Send">${icon('send')}</button></div>`;
    }
    $('#phone').innerHTML = `<div class="phone"><div class="screen"><div class="ph ${c.cls}">${icon(c.icon)}<div>${hdr}</div></div>${body}</div></div>`;
    const log = $('#chatlog'); if (log) log.scrollTop = log.scrollHeight;
    const m = $('#msg'); if (m) { m.value = ''; m.placeholder = SEND_HINT[ch]; m.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && ch !== 'call') { e.preventDefault(); send(); } }; }
    $('#send').onclick = send;
  };
  async function send() {
    let payload, userText;
    if (ch === 'email') { payload = { from: $('#eFrom').value, subject: $('#eSub').value, body: $('#eBody').value }; userText = payload.body; }
    else {
      userText = ($('#msg').value || '').trim() || SEND_HINT[ch]; $('#msg').value = '';
      payload = ch === 'whatsapp' ? { from: '+91 98200 55501', body: userText } : ch === 'sms' ? { from: '+91 98200 55502', body: userText } : ch === 'twitter' ? { user: '@citizen_nerul', text: userText } : { caller: '+91 98200 55503', transcript: userText };
      if (ch === 'whatsapp' && $('#pinZone').value) {
        if (!lampsByZone) { lampsByZone = {}; (await api.get('/api/city/map')).lamps.forEach(l => (lampsByZone[l.zone] ||= []).push(l)); }
        const L = lampsByZone[$('#pinZone').value].filter(l => l.status === 'ok'); const l = L[Math.floor(Math.random() * L.length)] || lampsByZone[$('#pinZone').value][0];
        payload.location = { lat: l.lat, lng: l.lng };
      }
      addBubble('me', userText, payload.location ? `${icon('pin', 'sm')} Location pin shared` : '');
    }
    phone();
    if (ch !== 'email') { const lg = $('#chatlog'); lg.insertAdjacentHTML('beforeend', '<div class="bubble bot" id="typing"><span class="typing"><i></i><i></i><i></i></span></div>'); lg.scrollTop = lg.scrollHeight; }
    try {
      const r = await api.post(`/api/intake/${CH[ch].path}`, payload);
      await new Promise(res => setTimeout(res, 800));
      addBubble('bot', r.reply); last = r; phone(); triage(r);
    } catch (e) { toast(e.message); const t = $('#typing'); if (t) t.remove(); }
  }
  const triage = r => {
    const a = r.analysis, t = r.ticket;
    $('#triage').innerHTML = `<div class="row between wrap"><h3>AI triage result</h3><a class="btn small" id="otk">${icon('eye', 'sm')} Open ${t.code}</a></div>
      <div class="row wrap" style="gap:8px;margin:12px 0">${clsChip(a.cls_label, a.color)}${sevChip(a.sev.label)}<span class="chip c-mute">${esc(a.lang)}</span>${r.merged ? '<span class="chip c-info">Merged into existing ticket</span>' : statusChip(t.status)}${a.override ? '<span class="chip c-crit">Safety rule applied</span>' : ''}</div>
      <div class="hltext" style="font-size:15px">${highlight(a.text, a.ents)}</div>
      ${a.prep.length ? `<div class="tags">${a.prep.map(p => `<span class="chip c-info">${esc(p)}</span>`).join('')}</div>` : ''}
      <dl class="kv" style="margin-top:12px"><dt>Location</dt><dd>${a.geo ? `${esc(a.geo.zone_name)} · ${esc(a.geo.by)}` : 'Not found, sent to review'}</dd><dt>Lamp</dt><dd class="mono">${esc(t.lamp_id || '–')}</dd><dt>Confidence</dt><dd>${Math.round(a.conf * 100)}%</dd></dl>`;
    $('#otk').onclick = () => openTicketDrawer(t.id);
  };
  const paintFeed = () => { $('#lf').innerHTML = feed.slice(0, 7).map(f => `<div class="row" style="padding:9px 0;border-top:1px solid var(--line);gap:10px;align-items:flex-start"><span style="color:var(--lamp)">${icon(chanIcon(f.channel), 'sm')}</span><div class="grow"><div style="font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(f.text)}</div><div class="sub">${esc(f.channel)} · ${ago(f.ts)} · ${esc(f.cls_label)}${f.merged ? ' · merged' : ''}</div></div>${sevChip(f.sev_label)}</div>`).join('') || '<div class="empty" style="padding:18px">Waiting for messages…</div>'; };
  $$('#cseg button').forEach(b => b.onclick = () => { ch = b.dataset.c; $$('#cseg button').forEach(x => x.setAttribute('aria-pressed', x === b)); phone(); curl(); });
  $('#tpl').href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('text,channel,lat,lng\n"Street light flickering near SIES College Nerul",WhatsApp,,\n"Lamp dead near Vashi Station since 3 days",Email,,\n"Sparks from pole near Airoli Bridge",Call centre,,\n');
  $('#csv').onchange = async e => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); $('#impRes').innerHTML = '<div class="spinner" style="margin:12px auto"></div>'; try { const r = await api.post('/api/admin/import', fd); $('#impRes').innerHTML = `<div class="note good">${icon('checkc')}<span>${r.rows} rows read: <b>${r.created}</b> tickets created, <b>${r.merged}</b> merged as duplicates, <b>${r.review}</b> sent to review.</span></div>`; } catch (err) { $('#impRes').innerHTML = `<div class="note bad">${icon('warn')}<span>${esc(err.message)}</span></div>`; } };
  $('#burst').onclick = e => btnBusy(e.currentTarget, async () => { const r = await api.post('/api/admin/simulator/burst', { n: 5 }); toast(`${r.created} complaints sent through the pipeline`, 'good'); });
  phone(); curl(); paintFeed();
  return bus.on('ticket', ev => { const t = ev.ticket; if (!t || !['created', 'merged'].includes(ev.action)) return; feed.unshift({ ...t, merged: ev.action === 'merged' }); feed = feed.slice(0, 12); if ($('#lf')) paintFeed(); });
}

/* ================= analytics ================= */
export async function analytics({ el }) {
  const [a, o] = await Promise.all([api.get('/api/admin/analytics'), api.get('/api/admin/overview')]);
  const k = (ic, l, v, s, c = '') => `<div class="kpi ${c}"><div class="lbl">${icon(ic)} ${l}</div><b>${v}</b><small>${s}</small></div>`;
  el.innerHTML = `<div class="kpis">${k('clock', 'Average fix time', o.avg_resolution_h + ' h', 'last 30 days')}${k('checkc', 'Fixed within SLA', o.sla_met_pct + '%', 'last 30 days', o.sla_met_pct >= 85 ? 'good' : 'warn')}${k('star', 'Citizen rating', o.csat ?? '–', o.csat_n + ' ratings', 'good')}${k('cpu', 'Triaged automatically', o.auto_triage_pct + '%', 'no human needed')}</div>
  <div class="grid g-main"><div class="card"><h3>SLA compliance and throughput</h3><p class="sub">Weekly share of tickets fixed on time, with tickets resolved</p><div class="chartbox" style="height:280px"><canvas id="aS"></canvas></div></div>
    <div class="card"><h3>Average fix time by fault type</h3><p class="sub">Hours from report to resolution</p><div class="chartbox" style="height:280px"><canvas id="aC"></canvas></div></div></div>
  <div class="grid g3"><div class="card"><h3>Volume by channel</h3><p class="sub">AI confidence and review rate per channel below</p><div class="chartbox"><canvas id="aCh"></canvas></div></div>
    <div class="card"><h3>Languages received</h3><p class="sub">Detected automatically</p><div class="chartbox"><canvas id="aL"></canvas></div></div>
    <div class="card"><h3>Citizen ratings</h3><p class="sub">After each repair</p><div class="chartbox"><canvas id="aR"></canvas></div></div></div>
  <div class="grid g2"><div class="card flush"><div class="chead"><div><h3>Channel quality</h3><p class="sub">Shorter, noisier channels are harder for the AI</p></div></div><table><thead><tr><th>Channel</th><th>Tickets</th><th>Avg AI confidence</th><th>Sent to review</th></tr></thead><tbody>${a.channels.sort((x, y) => y.n - x.n).map(c => `<tr><td>${icon(chanIcon(c.channel), 'sm')} ${esc(c.channel)}</td><td>${c.n}</td><td><div class="row"><div class="bar grow"><i style="width:${c.conf * 100}%;background:var(--info)"></i></div><span class="mono">${Math.round(c.conf * 100)}%</span></div></td><td>${c.review}%</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h3>Average fix time by zone</h3><p class="sub">Where crews are slowest</p><div class="chartbox"><canvas id="aZ"></canvas></div></div></div>`;
  const grid = { grid: { display: false } };
  mkChart($('#aS'), { data: { labels: a.weeks.map(w => new Date(w.end - 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })), datasets: [{ type: 'bar', label: 'Resolved', data: a.weeks.map(w => w.n), backgroundColor: css('--info') + '55', borderRadius: 5, yAxisID: 'y1' }, { type: 'line', label: 'Within SLA %', data: a.weeks.map(w => w.sla), borderColor: css('--ok'), backgroundColor: css('--ok'), tension: .3, pointRadius: 3, yAxisID: 'y' }] }, options: { plugins: { legend: { labels: { usePointStyle: true } } }, scales: { x: grid, y: { min: 0, max: 100, ticks: { callback: v => v + '%' } }, y1: { position: 'right', grid: { display: false }, beginAtZero: true } } } });
  mkChart($('#aC'), { type: 'bar', data: { labels: a.by_class.map(c => c.label), datasets: [{ data: a.by_class.map(c => c.hours), backgroundColor: a.by_class.map(c => c.color), borderRadius: 6, barThickness: 16 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: grid } } });
  mkChart($('#aCh'), { type: 'bar', data: { labels: a.channels.map(c => c.channel), datasets: [{ data: a.channels.map(c => c.n), backgroundColor: css('--lamp'), borderRadius: 6 }] }, options: { plugins: { legend: { display: false } }, scales: { x: grid, y: { beginAtZero: true } } } });
  mkChart($('#aL'), { type: 'doughnut', data: { labels: a.langs.map(l => l.lang), datasets: [{ data: a.langs.map(l => l.n), backgroundColor: ['#5B9BFF', '#FFB21F', '#2CD3B5', '#C58BFF'], borderWidth: 0 }] }, options: { cutout: '60%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } } });
  mkChart($('#aR'), { type: 'bar', data: { labels: a.ratings.map(r => r.rating + ' ★'), datasets: [{ data: a.ratings.map(r => r.n), backgroundColor: a.ratings.map(r => r.rating >= 4 ? css('--ok') : r.rating === 3 ? css('--lamp') : css('--bad')), borderRadius: 6 }] }, options: { plugins: { legend: { display: false } }, scales: { x: grid, y: { beginAtZero: true } } } });
  mkChart($('#aZ'), { type: 'bar', data: { labels: a.zones.map(z => z.zone), datasets: [{ data: a.zones.map(z => z.hours), backgroundColor: css('--violet'), borderRadius: 6 }] }, options: { plugins: { legend: { display: false } }, scales: { x: grid, y: { beginAtZero: true, title: { display: true, text: 'hours' } } } } });
}

/* ================= models ================= */
function confusion(m) {
  const n = m.labels.length, L = k => (state.meta.classes[k] || { label: k }).label;
  let h = `<div class="cm" style="grid-template-columns:150px repeat(${n},minmax(38px,1fr))"><div></div>${m.labels.map(k => `<div class="top">${esc(L(k))}</div>`).join('')}`;
  m.confusion.forEach((row, i) => {
    const tot = row.reduce((a, b) => a + b, 0) || 1;
    h += `<div class="lab">${esc(L(m.labels[i]))}</div>` + row.map((v, j) => { const p = v / tot, diag = i === j; return `<div class="cell" title="${esc(L(m.labels[i]))} → ${esc(L(m.labels[j]))}: ${v}" style="background:${diag ? `color-mix(in srgb,var(--ok) ${Math.round(p * 85)}%,var(--surface2))` : v ? `color-mix(in srgb,var(--bad) ${Math.min(90, Math.round(p * 260))}%,var(--surface2))` : 'var(--surface2)'};color:${p > .5 ? '#fff' : 'var(--ink)'}">${v || ''}</div>`; }).join('');
  });
  return h + '</div>';
}
export async function models({ el }) {
  const draw = async () => {
    const d = await api.get('/api/admin/model'), m = d.nlp, r = d.risk;
    el.innerHTML = `<div class="kpis"><div class="kpi good"><div class="lbl">${icon('cpu')} Fault classifier accuracy</div><b>${(m.accuracy * 100).toFixed(1)}%</b><small>${m.n_test} held-out paraphrases never seen in training</small></div>
      <div class="kpi"><div class="lbl">${icon('chart')} Macro F1</div><b>${m.macro_f1.toFixed(2)}</b><small>balanced across 8 classes</small></div>
      <div class="kpi"><div class="lbl">${icon('msg')} Hand-written check</div><b>${(m.handwritten_accuracy * 100).toFixed(0)}%</b><small>${m.n_handwritten} realistic messages</small></div>
      <div class="kpi"><div class="lbl">${icon('trend')} Failure-risk AUC</div><b>${r.auc.toFixed(2)}</b><small>gradient boosting, held-out lamps</small></div></div>
    <div class="grid g2"><div class="card"><h3>ML model vs keyword rules</h3><p class="sub">The original prototype used keyword rules. Same test data, same labels.</p><div class="chartbox" style="height:240px"><canvas id="mc"></canvas></div></div>
      <div class="card"><h3>Per-class quality</h3><p class="sub">Precision, recall and F1 on the held-out set</p><table style="margin-top:6px"><thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>${m.per_class.map(c => `<tr><td>${clsChip(d.classes[c.cls], metaCls(c.cls).color)}</td><td class="mono">${c.precision.toFixed(2)}</td><td class="mono">${c.recall.toFixed(2)}</td><td><div class="row"><div class="bar grow"><i style="width:${c.f1 * 100}%;background:${c.f1 > .9 ? 'var(--ok)' : c.f1 > .8 ? 'var(--lamp)' : 'var(--bad)'}"></i></div><span class="mono">${c.f1.toFixed(2)}</span></div></td></tr>`).join('')}</tbody></table></div></div>
    <div class="grid g-main"><div class="card"><h3>Confusion matrix</h3><p class="sub">Rows are the true class, columns what the model predicted. Green diagonal = correct.</p><div style="margin-top:10px">${confusion(m)}</div></div>
      <div class="stack"><div class="card accent"><h3>${icon('refresh')} Human-in-the-loop retraining</h3><p class="sub" style="margin-top:6px">Corrections made in the review queue and ticket drawer become training examples (weighted ×6).</p>
        <div class="row" style="margin:12px 0;gap:14px"><div><b style="font:700 28px var(--head)">${d.corrections}</b><div class="sub">corrections saved</div></div><div><b style="font:700 28px var(--head)">${m.n_corrections || 0}</b><div class="sub">used by current model</div></div></div>
        ${d.recent.length ? `<div class="sub">Latest:</div>${d.recent.slice(0, 3).map(c => `<div class="sub" style="padding:3px 0">· ${clsChip(d.classes[c.label], metaCls(c.label).color)} ${esc(c.text.slice(0, 60))}…</div>`).join('')}` : ''}
        <button class="btn primary" id="rt" style="margin-top:12px;width:100%">${icon('refresh', 'sm')} Retrain classifier now</button><div id="rtRes"></div></div>
        <div class="card"><h3>Hand-written messages it got wrong</h3><p class="sub">Honest error analysis</p>${m.handwritten_errors.length ? m.handwritten_errors.map(e => `<div style="padding:8px 0;border-top:1px solid var(--line);font-size:13px">${esc(e.text)}<div class="sub">True: ${esc(d.classes[e.truth])} · predicted: ${esc(d.classes[e.pred])}</div></div>`).join('') : '<div class="empty" style="padding:16px">None 🎉</div>'}</div></div></div>
    <div class="grid g3"><div class="card"><h3>${icon('msg')} Classifier</h3><dl class="kv" style="margin-top:10px;grid-template-columns:110px 1fr"><dt>Features</dt><dd>TF-IDF word 1–2 grams + character 2–5 grams (handles typos, Hinglish, Devanagari)</dd><dt>Model</dt><dd>Multinomial logistic regression</dd><dt>Training set</dt><dd>${m.n_train} synthetic complaints in 4 languages</dd><dt>Safety net</dt><dd>Electrical-danger words force “hazard”</dd></dl></div>
      <div class="card"><h3>${icon('target')} NER + severity</h3><dl class="kv" style="margin-top:10px;grid-template-columns:110px 1fr"><dt>NER</dt><dd>Regex + gazetteer hybrid: pole IDs, landmarks, roads, sectors, durations, fault phrases</dd><dt>Geocoding</dt><dd>Landmark → station → sector → area name; GPS pin overrides</dd><dt>Severity</dt><dd>Rule-weighted 0–100 score with a visible explanation for every point</dd></dl></div>
      <div class="card"><h3>${icon('trend')} Prediction models</h3><dl class="kv" style="margin-top:10px;grid-template-columns:110px 1fr"><dt>Failure risk</dt><dd>Gradient boosting · AUC ${r.auc.toFixed(2)} · accuracy ${(r.accuracy * 100).toFixed(0)}% · Brier ${r.brier.toFixed(3)} · ${r.n_train} training lamps (synthetic)</dd><dt>Forecast</dt><dd>Damped-trend Holt smoothing, parameters grid-searched</dd><dt>Hotspots</dt><dd>DBSCAN with haversine distance</dd><dt>Routing</dt><dd>Cheapest insertion + 2-opt + or-opt</dd></dl></div></div>
    <div class="note info" style="margin-top:16px">${icon('info')}<span><b>How to read these numbers.</b> Training data is synthetic, so accuracy shows the pipeline works, not how it would perform on real citizen messages. The held-out set uses different wording from training, which measures generalisation. Retrain on real labelled complaints before deployment.</span></div>`;
    mkChart($('#mc'), { type: 'bar', data: { labels: ['Held-out paraphrases', 'Hand-written messages'], datasets: [{ label: 'Keyword rules (old prototype)', data: [m.baseline_accuracy * 100, m.baseline_handwritten_accuracy * 100], backgroundColor: css('--line2'), borderRadius: 6 }, { label: 'TF-IDF + logistic regression', data: [m.accuracy * 100, m.handwritten_accuracy * 100], backgroundColor: css('--lamp'), borderRadius: 6 }] }, options: { plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } }, scales: { x: { grid: { display: false } }, y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } } });
    $('#rt').onclick = e => btnBusy(e.currentTarget, async () => {
      try { const r = await api.post('/api/admin/model/retrain'); toast('Model retrained', 'good'); await draw(); $('#rtRes').innerHTML = `<div class="note good">${icon('checkc')}<span>Accuracy ${(r.before.accuracy * 100).toFixed(1)}% → <b>${(r.after.accuracy * 100).toFixed(1)}%</b> using ${r.corrections} human correction${r.corrections === 1 ? '' : 's'}.</span></div>`; } catch (err) { toast(err.message); }
    });
  };
  await draw();
}
