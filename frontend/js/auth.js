// Sign-in / sign-up page with demo accounts
import { $, $$, esc, api, icon, logoSVG, toast, btnBusy, theme, setTheme } from './core.js';

const DEMOS = [
  { role: 'Admin', sub: 'Control room', icon: 'shield', email: 'admin@prakash.demo', pw: 'Admin@123' },
  { role: 'Citizen', sub: 'Reports faults', icon: 'user', email: 'citizen@prakash.demo', pw: 'Citizen@123' },
  { role: 'Technician', sub: 'Field crew', icon: 'truck', email: 'sneha@prakash.demo', pw: 'Tech@123' }
];

function skyline() {
  let r = 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  let b = '', lights = '', x = 0;
  while (x < 820) {
    const w = 34 + rnd() * 48, h = 60 + rnd() * 150;
    b += `<rect x="${x.toFixed(0)}" y="${(300 - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#0A1530" opacity="${(.55 + rnd() * .4).toFixed(2)}"/>`;
    for (let wy = 300 - h + 10; wy < 290; wy += 14) for (let wx = x + 6; wx < x + w - 8; wx += 12) if (rnd() > .72) b += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="4" height="6" fill="#FFD27A" opacity="${(.25 + rnd() * .5).toFixed(2)}"/>`;
    x += w + 2;
  }
  for (let i = 0; i < 9; i++) {
    const px = 40 + i * 92, h = 78 + (i % 3) * 8, flick = i === 4 ? ' flick' : '';
    lights += `<g class="glow${flick}"><circle cx="${px + 16}" cy="${300 - h}" r="46" fill="url(#lg)"/></g><path d="M${px} 300V${300 - h}H${px + 16}" stroke="#2A3B63" stroke-width="3" fill="none"/><circle cx="${px + 16}" cy="${300 - h + 2}" r="4.5" fill="#FFE199"/>`;
  }
  return `<svg class="skyline" viewBox="0 0 820 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><defs><radialGradient id="lg"><stop offset="0" stop-color="#FFC24A" stop-opacity=".9"/><stop offset=".4" stop-color="#FFB21F" stop-opacity=".25"/><stop offset="1" stop-color="#FFB21F" stop-opacity="0"/></radialGradient></defs>${b}<rect x="0" y="292" width="820" height="10" fill="#050A15"/>${lights}</svg>`;
}

export function renderAuth(root, onDone) {
  let mode = 'login';
  root.innerHTML = `<div class="auth">
    <section class="auth-hero" aria-label="About Prakash">
      <div class="brand"><div class="logo">${logoSVG}</div><div><b>Prakash</b><span>Smart streetlight maintenance</span></div></div>
      <h1>Every dark street gets fixed <em>faster</em>.</h1>
      <p class="lead">Citizens report in any language, on any channel. AI reads the message, finds the lamp, scores the danger and sends the right crew by the shortest route.</p>
      <div class="auth-stats"><div><b>4 languages</b><span>English, Hindi, Marathi, Hinglish</span></div><div><b>6 channels</b><span>WhatsApp, SMS, email, X, call, web</span></div><div><b>SDG 11</b><span>Sustainable cities &amp; communities</span></div></div>
      ${skyline()}
    </section>
    <section class="auth-panel">
      <div class="auth-card">
        <div class="row between" style="margin-bottom:22px"><div class="row" style="gap:9px"><div class="logo" style="width:32px;height:32px">${logoSVG}</div><b style="font:700 20px var(--head)">Prakash</b></div>
          <button class="icon-btn" id="thm" aria-label="Switch theme"></button></div>
        <h2 id="ttl">Welcome back</h2><p class="muted" id="sub" style="margin:6px 0 22px">Sign in to continue.</p>
        <form id="form" novalidate>
          <div class="field hide" id="fName"><label for="name">Full name</label><input class="input" id="name" autocomplete="name" placeholder="Aarav Sharma"></div>
          <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autocomplete="username" placeholder="you@example.com" required></div>
          <div class="field"><label for="pw">Password</label><input class="input" id="pw" type="password" autocomplete="current-password" placeholder="At least 6 characters" required></div>
          <div class="note bad hide" id="err" role="alert"></div>
          <button class="btn primary big" style="width:100%;margin-top:14px" id="go" type="submit">Sign in</button>
        </form>
        <p class="muted" style="text-align:center;margin-top:16px" id="swap">New citizen? <a href="#" id="swapA">Create an account</a></p>
        <div style="margin-top:26px;padding-top:20px;border-top:1px solid var(--line)">
          <div class="row between"><b style="font-size:13px">Demo accounts</b><span class="sub">one click to sign in</span></div>
          <div class="demo-grid">${DEMOS.map((d, i) => `<button type="button" data-i="${i}">${icon(d.icon, 'lg')}${d.role}<small>${d.sub}</small></button>`).join('')}</div>
        </div>
      </div></section></div>`;
  const tb = $('#thm'); const paint = () => tb.innerHTML = icon(theme() === 'dark' ? 'sun' : 'moon'); paint();
  tb.onclick = () => { setTheme(theme() === 'dark' ? 'light' : 'dark'); paint(); };
  const setMode = m => {
    mode = m; const reg = m === 'register';
    $('#fName').classList.toggle('hide', !reg); $('#ttl').textContent = reg ? 'Create your account' : 'Welcome back';
    $('#sub').textContent = reg ? 'Report streetlight faults and track them until they are fixed.' : 'Sign in to continue.';
    $('#go').textContent = reg ? 'Create account' : 'Sign in'; $('#pw').autocomplete = reg ? 'new-password' : 'current-password';
    $('#swap').innerHTML = reg ? 'Already registered? <a href="#" id="swapA">Sign in</a>' : 'New citizen? <a href="#" id="swapA">Create an account</a>';
    $('#swapA').onclick = ev => { ev.preventDefault(); setMode(reg ? 'login' : 'register'); }; $('#err').classList.add('hide');
  };
  $('#swapA').onclick = ev => { ev.preventDefault(); setMode('register'); };
  const submit = async (email, pw, name) => {
    const errBox = $('#err'); errBox.classList.add('hide');
    try {
      await api.post(mode === 'register' && !email.demo ? '/api/auth/register' : '/api/auth/login', mode === 'register' && !email.demo ? { name, email: email.v, password: pw } : { email: email.v, password: pw }, { quiet: true });
      location.hash = ''; await onDone();
    } catch (e) { errBox.innerHTML = icon('warn') + `<span>${esc(e.message)}</span>`; errBox.classList.remove('hide'); }
  };
  $('#form').onsubmit = ev => { ev.preventDefault(); btnBusy($('#go'), () => submit({ v: $('#email').value.trim() }, $('#pw').value, $('#name').value.trim())); };
  $$('.demo-grid button').forEach(b => b.onclick = () => {
    const d = DEMOS[b.dataset.i]; $('#email').value = d.email; $('#pw').value = d.pw; mode = 'login';
    btnBusy(b, () => submit({ v: d.email, demo: true }, d.pw, ''));
  });
}
