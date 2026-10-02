// Boot, auth gate, role-based shell and hash router
import { $, $$, esc, api, bus, state, icon, logoSVG, toast, initTheme, setTheme, theme, connectStream, closeStream, destroyCharts, initials, ago, debounce } from './core.js';
import { destroyMaps } from './map.js';
import { renderAuth } from './auth.js';

const app = $('#app');
let cleanup = null, routeTok = 0, off = [];

const ROUTES = {
  citizen: {
    home: ['Welcome', 'Your streetlight reports at a glance', () => import('./pages/citizen.js'), 'home'],
    report: ['Report a faulty light', 'Describe it in your own words. Our AI does the rest', () => import('./pages/citizen.js'), 'report'],
    tickets: ['My reports', 'Track every report from received to fixed', () => import('./pages/citizen.js'), 'tickets'],
    map: ['City light map', 'Live status of every streetlight we maintain', () => import('./pages/citizen.js'), 'cityMap'],
    about: ['How Prakash works', 'The AI pipeline behind every report', () => import('./pages/about.js'), 'about']
  },
  technician: {
    jobs: ['My route', 'Your optimised job list for this shift', () => import('./pages/tech.js'), 'jobs'],
    map: ['City light map', 'Live status of every streetlight', () => import('./pages/citizen.js'), 'cityMap'],
    about: ['How Prakash works', 'The AI pipeline behind every report', () => import('./pages/about.js'), 'about']
  },
  admin: {
    dashboard: ['Operations overview', 'Complaints, faults and crews across the city right now', () => import('./pages/admin_ops.js'), 'dashboard'],
    tickets: ['Tickets', 'Search, triage and manage every complaint', () => import('./pages/admin_ops.js'), 'tickets'],
    review: ['Review queue', 'Human-in-the-loop: confirm what the AI was unsure about', () => import('./pages/admin_ops.js'), 'review'],
    alerts: ['Alerts', 'Things that need someone’s attention today', () => import('./pages/admin_intel.js'), 'alerts'],
    lab: ['NLP lab', 'Watch one message become a classified, located, prioritised ticket', () => import('./pages/admin_nlp.js'), 'lab'],
    hotspots: ['Hotspots', 'Where faults cluster and which areas keep failing', () => import('./pages/admin_intel.js'), 'hotspots'],
    predict: ['Predictive maintenance', 'Which lamps fail next and how many faults to expect', () => import('./pages/admin_intel.js'), 'predict'],
    schedule: ['Crew scheduling', 'Turn open tickets into routes that fix urgent ones first', () => import('./pages/admin_intel.js'), 'schedule'],
    analytics: ['Analytics', 'Service quality, SLA and citizen satisfaction', () => import('./pages/admin_nlp.js'), 'analytics'],
    channels: ['Channels', 'One pipeline for WhatsApp, SMS, email, X, calls and the web', () => import('./pages/admin_nlp.js'), 'channels'],
    models: ['Model performance', 'Measured accuracy of every model, with human-in-the-loop retraining', () => import('./pages/admin_nlp.js'), 'models'],
    team: ['Team & access', 'Technicians, citizens, roles and audit trail', () => import('./pages/admin_team.js'), 'team'],
    system: ['System settings', 'SLA targets, automation, simulator and data tools', () => import('./pages/admin_team.js'), 'system'],
    about: ['System design', 'Architecture and problem-statement coverage', () => import('./pages/about.js'), 'about']
  }
};
const NAV = {
  citizen: [['', [['home', 'Home', 'home'], ['report', 'Report a fault', 'plus'], ['tickets', 'My reports', 'list'], ['map', 'City map', 'map'], ['about', 'How it works', 'layers']]]],
  technician: [['', [['jobs', 'My route', 'truck'], ['map', 'City map', 'map'], ['about', 'How it works', 'layers']]]],
  admin: [
    ['Operate', [['dashboard', 'Dashboard', 'home'], ['tickets', 'Tickets', 'list'], ['review', 'Review queue', 'eye', 'review'], ['alerts', 'Alerts', 'bell', 'alerts']]],
    ['Intelligence', [['lab', 'NLP lab', 'msg'], ['hotspots', 'Hotspots', 'target'], ['predict', 'Predictive', 'trend'], ['schedule', 'Scheduling', 'truck'], ['analytics', 'Analytics', 'chart']]],
    ['Platform', [['channels', 'Channels', 'inbox'], ['models', 'Models', 'cpu'], ['team', 'Team & access', 'users'], ['system', 'System', 'sliders'], ['about', 'System design', 'layers']]]
  ]
};
const HOME = { citizen: 'home', technician: 'jobs', admin: 'dashboard' };

/* ---------------- boot ---------------- */
async function boot() {
  initTheme();
  bus.on('unauth', () => { if (state.user) { state.user = null; start(); toast('Your session expired. Please sign in again.'); } });
  await start();
}
async function start() {
  teardown();
  try { state.user = (await api.get('/api/auth/me', { quiet: true })).user; } catch (e) { state.user = null; }
  if (!state.user) { closeStream(); renderAuth(app, async () => { await start(); }); return; }
  try { state.meta = await api.get('/api/meta'); } catch (e) { /* retried on navigation */ }
  renderShell();
  connectStream();
  window.onhashchange = route;
  route();
}
function teardown() { if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; } off.forEach(f => f()); off = []; destroyCharts(); destroyMaps(); }

/* ---------------- shell ---------------- */
function renderShell() {
  const u = state.user, role = u.role;
  const nav = NAV[role].map(([g, items]) => (g ? `<div class="navgroup">${g}</div>` : '') + `<nav class="nav" aria-label="${g || 'Main'}">${items.map(([k, l, ic, badge]) =>
    `<a href="#/${k}" data-k="${k}">${icon(ic)}<span>${l}</span>${badge ? `<span class="badge hide" data-badge="${badge}"></span>` : ''}</a>`).join('')}</nav>`).join('');
  app.innerHTML = `<div class="shell">
    <aside class="side" id="side" aria-label="Main navigation">
      <div class="brand"><div class="logo">${logoSVG}</div><div><b>Prakash</b><span>Streetlight maintenance</span></div></div>
      ${nav}
      <div class="side-foot"><div class="usercard"><div class="avatar">${esc(initials(u.name))}</div><div class="grow"><b>${esc(u.name)}</b><small>${role === 'admin' ? 'Control room admin' : role}</small></div><button id="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button></div></div>
    </aside>
    <div class="content">
      <header class="topbar" id="topbar">
        <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu">${icon('menu')}</button>
        <div class="grow"><h1 id="pgTitle"></h1><p class="sub" id="pgSub"></p></div>
        <div class="tools">
          ${role === 'admin' ? `<button class="pill off" id="liveBtn" title="Simulate citizens reporting faults in real time"><span class="dot"></span><span id="liveTxt">Live intake</span></button>` : ''}
          <div style="position:relative"><button class="icon-btn" id="bellBtn" aria-label="Notifications">${icon('bell')}<span class="dotn hide" id="bellN"></span></button><div class="dropdown hide" id="bellDrop"></div></div>
          <button class="icon-btn" id="themeBtn" aria-label="Switch colour theme"></button>
        </div>
      </header>
      <main id="view" tabindex="-1"></main>
    </div></div>`;
  const tb = $('#themeBtn'); const paintTheme = () => tb.innerHTML = icon(theme() === 'dark' ? 'sun' : 'moon');
  paintTheme(); tb.onclick = () => { setTheme(theme() === 'dark' ? 'light' : 'dark'); paintTheme(); };
  $('#logout').onclick = async () => { await api.post('/api/auth/logout'); location.hash = ''; state.user = null; start(); };
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  $$('#side a').forEach(a => a.addEventListener('click', () => $('#side').classList.remove('open')));
  window.addEventListener('scroll', () => $('#topbar') && $('#topbar').classList.toggle('scrolled', scrollY > 6), { passive: true });
  setupBell(); if (role === 'admin') setupAdmin();
  off.push(bus.on('notify', n => { state.user.unread++; paintBell(); toast(n.title + (n.body ? ' — ' + n.body.slice(0, 80) : '')); }));
  off.push(bus.on('toast', d => toast(d.msg)));
  off.push(bus.on('reset', () => { toast('Demo data was reset'); setTimeout(() => location.reload(), 600); }));
}
const paintBell = () => { const n = $('#bellN'); if (!n) return; const c = state.user.unread; n.textContent = c > 9 ? '9+' : c; n.classList.toggle('hide', !c); };
function setupBell() {
  paintBell();
  const drop = $('#bellDrop');
  $('#bellBtn').onclick = async e => {
    e.stopPropagation();
    if (!drop.classList.contains('hide')) { drop.classList.add('hide'); return; }
    drop.classList.remove('hide'); drop.innerHTML = '<div class="spinner"></div>';
    const { items } = await api.get('/api/notifications');
    drop.innerHTML = `<div class="dh"><b>Notifications</b><button class="btn small ghost" id="readAll">Mark all read</button></div><div class="dl">${items.length ? items.map(n => `<button class="notif ${n.read ? '' : 'unread'}" data-t="${n.ticket_id || ''}"><b>${esc(n.title)}</b><span>${esc(n.body || '')}</span><div class="sub">${ago(n.ts)}</div></button>`).join('') : '<div class="empty">Nothing yet</div>'}</div>`;
    $('#readAll').onclick = async () => { await api.post('/api/notifications/read'); state.user.unread = 0; paintBell(); drop.classList.add('hide'); };
    $$('.notif', drop).forEach(b => b.onclick = () => { drop.classList.add('hide'); if (b.dataset.t) location.hash = state.user.role === 'citizen' ? `#/tickets/${b.dataset.t}` : state.user.role === 'admin' ? `#/tickets/${b.dataset.t}` : '#/jobs'; });
  };
  document.addEventListener('click', e => { if (!e.target.closest('#bellDrop') && !e.target.closest('#bellBtn')) drop && drop.classList.add('hide'); });
}
function setupAdmin() {
  const paint = b => {
    $$('[data-badge]').forEach(el => { const n = b[el.dataset.badge] || 0; el.textContent = n; el.classList.toggle('hide', !n); el.classList.toggle('amber', el.dataset.badge === 'review'); });
    const lb = $('#liveBtn'); if (lb) { lb.classList.toggle('off', !b.sim); $('#liveTxt').textContent = b.sim ? 'Live intake on' : 'Live intake off'; lb.dataset.on = b.sim ? '1' : ''; }
  };
  const refresh = debounce(async () => { try { paint(await api.get('/api/admin/badges', { quiet: true })); } catch (e) { /* ignore */ } }, 1200);
  refresh();
  off.push(bus.on('ticket', refresh));
  off.push(bus.on('alert', a => { toast(`${a.title} (${a.detail})`, 'crit'); refresh(); }));
  const iv = setInterval(refresh, 30000); off.push(() => clearInterval(iv));
  $('#liveBtn').onclick = async () => { const on = !$('#liveBtn').dataset.on; await api.put('/api/admin/settings', { simulator_on: on }); paint(await api.get('/api/admin/badges')); toast(on ? 'Live intake started: a new complaint arrives every ~25 s' : 'Live intake paused'); };
  bus.emit('badges-ready');
}

/* ---------------- router ---------------- */
async function route() {
  const role = state.user.role, table = ROUTES[role];
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  let key = parts[0] || HOME[role];
  if (!table[key]) { location.hash = '#/' + HOME[role]; return; }
  const tok = ++routeTok;
  if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
  destroyCharts(); destroyMaps();
  $$('.drawer, .scrim, .modal').forEach(n => n.remove());
  const [title, sub, loader, fn] = table[key];
  $('#pgTitle').textContent = title; $('#pgSub').textContent = sub; document.title = `${title} · Prakash`;
  $$('#side a').forEach(a => a.classList.toggle('on', a.dataset.k === key));
  const view = $('#view'); view.innerHTML = '<div class="spinner"></div>';
  try {
    const mod = await loader();
    if (tok !== routeTok) return;
    view.innerHTML = '';
    view.classList.remove('fade'); void view.offsetWidth; view.classList.add('fade');
    const c = await mod[fn]({ el: view, params: parts.slice(1), user: state.user, setTitle: (t, s) => { $('#pgTitle').textContent = t; if (s !== undefined) $('#pgSub').textContent = s; } });
    if (tok === routeTok) cleanup = typeof c === 'function' ? c : null; else if (typeof c === 'function') c();
    scrollTo(0, 0); view.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    if (tok === routeTok) view.innerHTML = `<div class="card empty"><b>Could not load this page</b>${esc(e.message)}<div style="margin-top:14px"><button class="btn primary" onclick="location.reload()">Reload</button></div></div>`;
  }
}

boot();
