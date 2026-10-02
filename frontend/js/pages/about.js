// Architecture + problem-statement coverage (visible to every role)
import { esc, state } from '../core.js';

export async function about({ el, user }) {
  const admin = user.role === 'admin';
  const link = (p, t) => admin ? `<a href="#/${p}" class="chip c-info">${t}</a>` : `<span class="chip c-info">${t}</span>`;
  const stage = (n, t, items) => `<div class="stage"><h3><span class="num">${n}</span>${t}</h3><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
  el.innerHTML = `
  <div class="flow">
    ${stage(1, 'Collect', ['WhatsApp bot / webhook', 'Web portal with photo + GPS', 'SMS and email inbox', 'X / Twitter mentions', 'Call-centre transcripts', 'Bulk CSV import'])}
    ${stage(2, 'Understand (NLP)', ['Text clean-up per channel', 'Language ID: English, Hindi, Marathi, Hinglish', 'TF-IDF + logistic regression: 8 fault classes', 'Named Entity Recognition', 'Explainable severity score 0–100'])}
    ${stage(3, 'Locate (GIS)', ['Geocode landmark, road, sector or GPS pin', 'Match pole ID', 'Snap to the nearest lamp', 'Merge duplicate reports'])}
    ${stage(4, 'Predict & decide', ['DBSCAN hotspot clustering', 'Gradient-boosted 14-day failure risk', 'Holt weekly fault forecast', 'Skill- and priority-aware route optimiser'])}
    ${stage(5, 'Act', ['Live dashboard and alerts (SSE)', 'Auto-dispatch for critical faults', 'Technician mobile route', 'Auto-reply and status updates to citizens', 'Human review loop that retrains the model'])}
  </div>
  <div class="grid g2">
    <div class="card"><h3>Problem statement coverage</h3><p class="sub">Each requirement and the screen where it lives</p>
      <table style="margin-top:8px"><tbody>
        <tr><td>Collect requests from multiple channels</td><td class="right">${link('channels', 'Channels')} ${link('dashboard', 'Dashboard')}</td></tr>
        <tr><td>Automatically classify fault types</td><td class="right">${link('lab', 'NLP lab')} ${link('models', 'Models')}</td></tr>
        <tr><td>Extract locations with Named Entity Recognition</td><td class="right">${link('lab', 'NLP lab')}</td></tr>
        <tr><td>Assess fault severity</td><td class="right">${link('lab', 'NLP lab')} ${link('tickets', 'Tickets')}</td></tr>
        <tr><td>Identify maintenance hotspots (GIS)</td><td class="right">${link('hotspots', 'Hotspots')}</td></tr>
        <tr><td>Predict recurring failures from history</td><td class="right">${link('predict', 'Predictive')}</td></tr>
        <tr><td>Optimise technician scheduling and resources</td><td class="right">${link('schedule', 'Scheduling')}</td></tr>
        <tr><td>Real-time dashboards with alerts</td><td class="right">${link('dashboard', 'Dashboard')} ${link('alerts', 'Alerts')}</td></tr>
        <tr><td>Role-based access (citizen, technician, admin)</td><td class="right">${link('team', 'Team &amp; access')}</td></tr>
      </tbody></table></div>
    <div class="stack">
      <div class="card"><h3>Who sees what</h3>
        <dl class="kv" style="margin-top:10px;grid-template-columns:110px 1fr">
          <dt><span class="chip c-info">Citizen</span></dt><dd>Reports faults (with live AI preview), confirms existing faults, tracks progress, rates repairs, sees the public city map.</dd>
          <dt><span class="chip c-med">Technician</span></dt><dd>Gets an optimised route, starts and completes jobs with notes and parts, toggles shift.</dd>
          <dt><span class="chip c-crit">Admin</span></dt><dd>Everything above plus triage, review queue, analytics, models, scheduling, users and settings.</dd></dl></div>
      <div class="card"><h3>Technology</h3><div class="tags">${['Python', 'Flask', 'SQLite', 'scikit-learn', 'NumPy', 'DBSCAN', 'Gradient boosting', 'TF-IDF', 'Server-sent events', 'Leaflet', 'Chart.js', 'Vanilla JS modules'].map(t => `<span class="chip c-mute">${t}</span>`).join('')}</div>
        <div class="note info"><span><b>Honest scope.</b> Complaints used for training, the lamp network, 12 weeks of history and accounts are synthetic, generated for this project. The pipeline, models and metrics shown are real and computed on that data. Connect the webhooks and a municipal lamp register to go live.</span></div></div>
      <div class="card"><h3>Team</h3><p class="sub" style="line-height:1.7">Group 6 · NLP course project · SDG 11, Sustainable Cities and Communities<br><b>Gregory, Bharath Rathinasabapathy, Harshwardhan Ahire</b></p></div>
    </div>
  </div>`;
}
