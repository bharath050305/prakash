// Admin: team & access (technicians, users, audit) and system settings
import { $, $$, esc, api, state, icon, toast, btnBusy, ago, dt, openModal, confirmBox, csvDownload } from '../core.js';

const SKILL = { hv: 'HV-certified', bucket: 'Bucket truck' };

export async function team({ el }) {
  let tab = 'tech';
  const draw = async () => {
    el.innerHTML = `<div class="seg" id="seg" style="margin-bottom:14px"><button data-t="tech" aria-pressed="${tab === 'tech'}">Technicians</button><button data-t="users" aria-pressed="${tab === 'users'}">Users and roles</button><button data-t="audit" aria-pressed="${tab === 'audit'}">Audit log</button></div><div id="tab"><div class="spinner"></div></div>`;
    $$('#seg button').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
    if (tab === 'tech') await techs(); else if (tab === 'users') await users(); else await audit();
  };
  async function techs() {
    const { items } = await api.get('/api/admin/technicians');
    $('#tab').innerHTML = `<div class="card flush"><div class="chead"><div><h3>Field technicians</h3><p class="sub">Only on-shift crews are planned. Skills are hard constraints in the optimiser.</p></div><button class="btn primary small" id="add">${icon('plus', 'sm')} Add technician</button></div>
      <div class="tscroll"><table><thead><tr><th>Technician</th><th>Skills</th><th>Base</th><th>Shift</th><th>Load</th><th>Completed</th><th>Avg fix</th><th>Rating</th></tr></thead><tbody>${items.map(t => `<tr><td><div class="row"><span style="width:12px;height:12px;border-radius:50%;background:${t.color};flex:none"></span><div><b>${esc(t.name)}</b><div class="sub">${esc(t.email || '')}</div></div></div></td>
        <td>${t.skills.length ? t.skills.map(s => `<span class="chip c-info">${SKILL[s]}</span>`).join(' ') : '<span class="chip c-mute">Standard</span>'}</td><td>${esc(t.depot_zone)}</td>
        <td><div class="row"><button class="switch" data-s="${t.id}" role="switch" aria-checked="${t.on_shift}" aria-label="${esc(t.name)} on shift"></button><span class="sub">${t.on_shift ? 'On' : 'Off'}</span></div></td><td>${t.current} open</td><td>${t.done}</td><td>${t.avg_resolution_h} h</td><td>${t.rating ? '★ ' + t.rating : '–'}</td></tr>`).join('')}</tbody></table></div></div>`;
    $$('[data-s]').forEach(b => b.onclick = async () => { const t = items.find(x => x.id === +b.dataset.s); await api.patch(`/api/admin/technicians/${t.id}`, { on_shift: !t.on_shift }); toast(`${t.name} is now ${t.on_shift ? 'off' : 'on'} shift`); techs(); });
    $('#add').onclick = () => {
      const m = openModal(`<h3>Add technician</h3><p class="sub" style="margin:4px 0 14px">Creates a login with the technician role and adds them to the optimiser.</p>
        <div class="field"><label>Full name</label><input class="input" id="tn"></div><div class="field"><label>Email</label><input class="input" id="te" type="email"></div><div class="field"><label>Temporary password</label><input class="input" id="tp" type="text" placeholder="At least 6 characters"></div>
        <div class="field"><label>Base zone</label><select class="input" id="tz">${state.meta.zones.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Skills</label><div class="row wrap"><label class="row" style="gap:6px"><input type="checkbox" id="k1"> HV-certified (hazards, feeders)</label><label class="row" style="gap:6px"><input type="checkbox" id="k2"> Bucket truck</label></div></div>
        <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Create</button></div>`);
      $('#ok', m.el).onclick = e => btnBusy(e.currentTarget, async () => {
        try { await api.post('/api/admin/technicians', { name: $('#tn', m.el).value, email: $('#te', m.el).value, password: $('#tp', m.el).value, zone: $('#tz', m.el).value, skills: [$('#k1', m.el).checked && 'hv', $('#k2', m.el).checked && 'bucket'].filter(Boolean) }); m.close(); toast('Technician added', 'good'); techs(); } catch (err) { toast(err.message); }
      });
    };
  }
  async function users() {
    const { items } = await api.get('/api/admin/users');
    const RC = { admin: 'c-crit', technician: 'c-med', citizen: 'c-info' };
    $('#tab').innerHTML = `<div class="card flush"><div class="chead"><div><h3>${items.length} accounts</h3><p class="sub">Role-based access: admins manage everything, technicians see only their jobs, citizens see only their own reports.</p></div></div>
      <div class="tscroll"><table><thead><tr><th>Name</th><th>Role</th><th>Reports</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>${items.map(u => `<tr><td><b>${esc(u.name)}</b><div class="sub">${esc(u.email)}</div></td><td><span class="chip ${RC[u.role]}">${u.role}</span></td><td>${u.reports}</td><td>${u.last_login ? ago(u.last_login) : 'never'}</td><td>${u.active ? '<span class="chip c-low">Active</span>' : '<span class="chip c-mute">Disabled</span>'}</td>
        <td class="right">${u.id === state.user.id ? '<span class="sub">You</span>' : `<button class="btn small ${u.active ? '' : 'good'}" data-u="${u.id}" data-a="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button>${u.role === 'citizen' ? ` <button class="btn small ghost" data-p="${u.id}">Make admin</button>` : ''}`}</td></tr>`).join('')}</tbody></table></div></div>`;
    $$('[data-u]').forEach(b => b.onclick = async () => { await api.patch(`/api/admin/users/${b.dataset.u}`, { active: b.dataset.a === '1' }); toast('Account updated'); users(); });
    $$('[data-p]').forEach(b => b.onclick = async () => { if (await confirmBox('Promote to admin?', 'This person will get full control-room access.', 'Make admin')) { await api.patch(`/api/admin/users/${b.dataset.p}`, { role: 'admin' }); toast('Role updated'); users(); } });
  }
  async function audit() {
    const { items } = await api.get('/api/admin/audit');
    $('#tab').innerHTML = `<div class="card flush"><div class="chead"><div><h3>Audit log</h3><p class="sub">Who changed what, most recent first</p></div></div><div class="tscroll"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${items.map(a => `<tr><td class="sub">${dt(a.ts)}</td><td>${esc(a.user)}</td><td><span class="chip c-mute mono">${esc(a.action)}</span></td><td class="sub">${esc(a.detail || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing logged yet</td></tr>'}</tbody></table></div></div>`;
  }
  await draw();
}

export async function system({ el }) {
  const s = await api.get('/api/admin/settings');
  el.innerHTML = `<div class="grid g2" style="margin-top:4px">
    <div class="stack">
      <div class="card"><h3>${icon('clock')} SLA targets</h3><p class="sub">Hours allowed to fix a fault of each severity. Applies to new tickets.</p>
        <div class="grid g4" style="gap:10px;margin-top:12px">${['Critical', 'High', 'Medium', 'Low'].map(k => `<div class="field" style="margin:0"><label>${k}</label><input class="input" type="number" min="1" max="500" data-sla="${k}" value="${s.sla_hours[k]}"></div>`).join('')}</div>
        <button class="btn primary" id="saveSla" style="margin-top:12px">Save SLA targets</button></div>
      <div class="card"><h3>${icon('cpu')} Automation</h3>
        <div class="row between" style="padding:12px 0;border-bottom:1px solid var(--line)"><div><b>Auto-dispatch critical faults</b><div class="sub">Send straight to the nearest qualified technician, at the front of their route</div></div><button class="switch" id="ad" role="switch" aria-checked="${s.auto_dispatch_critical}"></button></div>
        <div style="padding:12px 0;border-bottom:1px solid var(--line)"><div class="row between"><div><b>Human-review threshold</b><div class="sub">Classifier confidence below this sends the ticket to the review queue</div></div><b class="mono" id="thrV">${Math.round(s.review_threshold * 100)}%</b></div><input type="range" id="thr" min="25" max="90" value="${Math.round(s.review_threshold * 100)}" style="width:100%;accent-color:var(--lamp);margin-top:8px"></div>
        <div class="row between" style="padding:12px 0"><div><b>Live intake simulator</b><div class="sub">Posts a realistic complaint through the pipeline so dashboards stay alive in a demo</div></div><div class="row"><select class="input sm" id="simI" style="width:auto">${[10, 15, 25, 45, 90].map(v => `<option value="${v}" ${s.simulator_interval === v ? 'selected' : ''}>every ${v}s</option>`).join('')}</select><button class="switch" id="sim" role="switch" aria-checked="${s.simulator_on}"></button></div></div></div>
      <div class="card"><h3>${icon('lock')} Change my password</h3><div class="grid g2" style="gap:10px;margin-top:12px"><div class="field" style="margin:0"><label>Current</label><input class="input" type="password" id="pc" autocomplete="current-password"></div><div class="field" style="margin:0"><label>New</label><input class="input" type="password" id="pn" autocomplete="new-password"></div></div><button class="btn" id="pw" style="margin-top:12px">Update password</button></div></div>
    <div class="stack">
      <div class="card"><h3>${icon('download')} Data</h3><p class="sub">Export every ticket with its AI classification, severity, SLA and outcome.</p><div class="row wrap" style="margin-top:12px"><a class="btn" href="/api/admin/export/tickets.csv">${icon('download', 'sm')} Export tickets (CSV)</a></div></div>
      <div class="card"><h3>${icon('globe')} Integrations</h3><p class="sub">Webhook endpoints (POST, JSON). Authenticate with the <span class="mono">X-API-Key</span> header.</p>
        <dl class="kv" style="margin-top:10px;grid-template-columns:110px 1fr">${['whatsapp', 'sms', 'email', 'twitter', 'call', 'web'].map(c => `<dt>${c}</dt><dd class="mono" style="font-size:12px">${location.origin}/api/intake/${c}</dd>`).join('')}<dt>API key</dt><dd class="mono">${esc(s.api_key)}</dd></dl>
        <div class="note info">${icon('info')}<span>To show the app on a phone during your demo, start the server with <span class="mono">python run.py --host 0.0.0.0</span> and open <span class="mono">http://&lt;your-PC-IP&gt;:5000</span> on the same Wi-Fi.</span></div></div>
      <div class="card" style="border-color:var(--bad)"><h3 style="color:var(--bad)">${icon('warn')} Reset demo data</h3><p class="sub">Wipes every ticket, user and lamp, then regenerates the demo dataset. Use this before a presentation for a clean start.</p><button class="btn danger" id="reset" style="margin-top:12px">${icon('refresh', 'sm')} Reset demo data…</button></div></div></div>`;
  const put = async body => { try { await api.put('/api/admin/settings', body); toast('Saved', 'good'); } catch (e) { toast(e.message); } };
  $('#saveSla').onclick = () => put({ sla_hours: Object.fromEntries($$('[data-sla]').map(i => [i.dataset.sla, +i.value])) });
  const sw = (id, key) => { const b = $('#' + id); b.onclick = () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', v); put({ [key]: v }); }; };
  sw('ad', 'auto_dispatch_critical'); sw('sim', 'simulator_on');
  $('#thr').oninput = e => $('#thrV').textContent = e.target.value + '%'; $('#thr').onchange = e => put({ review_threshold: +e.target.value / 100 });
  $('#simI').onchange = e => put({ simulator_interval: +e.target.value });
  $('#pw').onclick = e => btnBusy(e.currentTarget, async () => { try { await api.post('/api/auth/password', { current: $('#pc').value, new: $('#pn').value }); toast('Password updated', 'good'); $('#pc').value = $('#pn').value = ''; } catch (err) { toast(err.message); } });
  $('#reset').onclick = () => {
    const m = openModal(`<h3>Reset all demo data?</h3><p class="sub" style="margin:8px 0 14px">This cannot be undone. Type <b>RESET</b> to confirm.</p><input class="input" id="cf" placeholder="RESET" autocomplete="off"><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reset everything</button></div>`);
    $('#go', m.el).onclick = e => btnBusy(e.currentTarget, async () => { try { await api.post('/api/admin/reset', { confirm: $('#cf', m.el).value }); m.close(); toast('Demo data regenerated', 'good'); } catch (err) { toast(err.message); } });
  };
}
