/* SecureWatch · Crystal FM — security patrols, welfare, incidents, SOS, rota and FM tasks */
'use strict';
const C = window.SW_CONFIG || {};
const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true } });
const S = { prof: null, user: null, settings: { welfareMinutes: 60, welfareGraceMinutes: 15 }, tab: 'live', timers: [] };
const $ = (q, el = document) => el.querySelector(q), $$ = (q, el = document) => [...el.querySelectorAll(q)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();
const fmt = (x) => x ? new Date(x).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const tm = (x) => x ? new Date(x).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const chip = (t, c) => `<span class="chip" style="--c:var(${c})">${esc(t)}</span>`;
const SEV = { Low: '--soft', Medium: '--warn', High: '--bad', Critical: '--bad' }, TST = { Open: '--bad', Investigating: '--warn', Resolved: '--ok', Closed: '--soft' }, KST = { Open: '--acc', 'In progress': '--warn', Done: '--ok', Cancelled: '--soft' };
const LOGO = `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="swgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1D5FD1"/><stop offset="1" stop-color="#1E9E5A"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#swgrad)"/><path d="M16 6l9 3.6v6.2c0 5.4-3.8 9.3-9 10.6-5.2-1.3-9-5.2-9-10.6V9.6z" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 16l3 3 5-6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' e' : ''); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 4200); }
function modal(html) { const m = $('#modal'); m.hidden = false; m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`; m.onclick = (e) => { if (e.target === m) closeModal(); }; return m; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }

/* ---------- data: everything is a record (store, id, data) ---------- */
async function list(store, q = (x) => x, limit = 2000) {
  const { data, error } = await q(sb.from('sw_records').select('id,data,updated_at').eq('store', store).eq('deleted', false)).order('updated_at', { ascending: false }).limit(limit);
  if (error) throw error; return data.map((r) => ({ id: r.id, ...r.data, _u: r.updated_at }));
}
async function put(store, obj) {
  const { id = uid(), _u, ...data } = obj;
  // existing item (came from the database) → update; new item → insert. FMs may only update their tasks.
  const { error } = _u ? await sb.from('sw_records').update({ data, deleted: false }).eq('store', store).eq('id', id) : await sb.from('sw_records').upsert({ store, id, data, deleted: false });
  if (error) throw error; return { id, ...data, _u: _u || now() };
}
async function del(store, id) { const { error } = await sb.from('sw_records').update({ deleted: true }).eq('store', store).eq('id', id); if (error) throw error; }
const byId = (arr) => new Map(arr.map((x) => [x.id, x]));
function csv(name, rows) { if (!rows.length) return toast('Nothing to export.', true); const cols = Object.keys(rows[0]); const out = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out], { type: 'text/csv' })); a.download = name + '.csv'; a.click(); }

/* ---------- start ---------- */
async function boot() {
  if (!C.SUPABASE_URL || /YOUR-/.test(C.SUPABASE_URL)) { $('#app').innerHTML = `<div class="center"><div class="card login"><h1>Setup needed</h1><p class="muted">Add your Supabase Project URL and publishable key to config.js.</p></div></div>`; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return login();
  S.user = session.user;
  const { data: prof } = await sb.from('sw_profiles').select('*').eq('id', S.user.id).maybeSingle();
  if (!prof || !prof.active) { await sb.auth.signOut(); return login('This login has no SecureWatch access. Ask your supervisor.'); }
  S.prof = prof;
  if (!S.user.user_metadata?.pw_set) return setPassword();
  try { const st = await list('settings'); if (st[0]) S.settings = { ...S.settings, ...st[0] }; } catch (_) {}
  if (prof.role === 'guard') return guardHome();
  if (prof.role === 'fm') return fmHome();
  return staffHome();
}
function login(msg = '') {
  clearTimers(); document.body.classList.remove('g');
  $('#app').innerHTML = `<div class="center"><form class="card login" id="lf"><div class="brand" style="color:var(--text)">${LOGO}<div>SecureWatch<small style="color:var(--soft)">Crystal Facilities Management</small></div></div>
    <h1>Sign in</h1><label class="f">Email<input name="email" type="email" autocomplete="username" required></label><label class="f">Password<input name="password" type="password" autocomplete="current-password" required></label>
    <p class="err" id="lm" role="alert">${esc(msg)}</p><button class="btn pri big">Sign in</button></form></div>`;
  $('#lf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const b = e.target.querySelector('button'); b.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password }); if (error) { $('#lm').textContent = 'Email or password not right.'; b.disabled = false; return; } boot(); };
}
function setPassword() {
  $('#app').innerHTML = `<div class="center"><form class="card login" id="pf"><h1>Choose your password</h1><p class="muted">At least 10 characters. You'll use it every time you sign in.</p>
    <label class="f">New password<input name="p1" type="password" minlength="10" autocomplete="new-password" required></label><label class="f">Type it again<input name="p2" type="password" minlength="10" required></label><p class="err" id="pm"></p><button class="btn pri big">Save</button></form></div>`;
  $('#pf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (f.p1 !== f.p2) return ($('#pm').textContent = 'The two passwords are different.');
    const { error } = await sb.auth.updateUser({ password: f.p1, data: { pw_set: true } }); if (error) return ($('#pm').textContent = error.message); toast('Password saved.'); boot(); };
}
const topbar = (sub) => `<header class="bar"><div class="brand">${LOGO}<div>SecureWatch<small>${esc(sub)}</small></div></div><div class="sp"></div><button class="btn sm" id="out">Sign out</button></header>`;
const bindOut = () => ($('#out').onclick = async () => { clearTimers(); await sb.auth.signOut(); login(); });

/* =====================================================================
   GUARD
   ===================================================================== */
/* guard app: dark mobile layout with bottom tabs (Home · Patrol · Incident · More) */
S.gtab = 'home';
const gps = { acc: null, watch: null };
function startGps() { if (gps.watch != null || !navigator.geolocation) return; gps.watch = navigator.geolocation.watchPosition((p) => { gps.acc = Math.round(p.coords.accuracy); const c = $('#gpsChip'); if (c) c.textContent = `GPS ±${gps.acc} m`; }, () => { const c = $('#gpsChip'); if (c) c.textContent = 'GPS off'; }, { enableHighAccuracy: true, maximumAge: 15000 }); }
const dmy = (x) => new Date(x).toLocaleDateString('en-GB');
async function guardHome() {
  clearTimers(); document.body.classList.add('g'); startGps();
  const me = S.prof.ref_id;
  $('#app').innerHTML = `<header class="gbar"><div><b>${esc(S.prof.name.split(' ')[0])}</b><small id="gSite">SecureWatch</small></div><div class="gchips"><span class="gchip" id="gpsChip">${gps.acc ? `GPS ±${gps.acc} m` : 'GPS…'}</span><span class="gchip" id="netChip"><i></i>${navigator.onLine ? 'Online' : 'Offline'}</span></div></header>
    <main class="gwrap" id="gmain"><div class="center" style="min-height:40vh"><div class="spin"></div></div></main>
    <nav class="gnav">${[['home', 'Home', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'], ['patrol', 'Patrol', '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>'], ['incident', 'Incident', '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>'], ['more', 'More', '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>']].map(([k, l, ic]) => `<button data-g="${k}" class="${S.gtab === k ? 'on' : ''}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>${l}</button>`).join('')}</nav>`;
  $$('[data-g]').forEach((b) => (b.onclick = () => { S.gtab = b.dataset.g; guardHome(); }));
  const net = () => { const c = $('#netChip'); if (c) { c.innerHTML = `<i></i>${navigator.onLine ? 'Online' : 'Offline'}`; c.classList.toggle('off', !navigator.onLine); } };
  window.onoffline = window.ononline = net; net();
  const g = $('#gmain');
  if (!me) { g.innerHTML = `<div class="gcard"><h2>Your login isn't linked to a guard profile</h2><p class="gmuted">Ask your supervisor to link it in People.</p></div>`; return; }
  const from = new Date(Date.now() - 16 * 36e5).toISOString(), to = new Date(Date.now() + 36 * 36e5).toISOString();
  const [sites, shifts, welfare, patrols, incs] = await Promise.all([list('sites'), list('shifts', (q) => q.gte('data->>endAt', from).lte('data->>startAt', to)), list('welfareChecks', (q) => q.eq('data->>status', 'Due')), list('patrols', (q) => q.gte('data->>startAt', dayStart())), list('incidents', (q) => q.gte('data->>at', new Date(Date.now() - 7 * 864e5).toISOString()))]);
  const SM = byId(sites), active = shifts.find((s) => s.actualStart && !s.actualEnd);
  const next = shifts.filter((s) => !s.actualStart && new Date(s.endAt) > new Date()).sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
  const cur = active || next, site = cur ? SM.get(cur.siteId) : null;
  if (site) $('#gSite').textContent = site.name;
  const due = active ? welfare.filter((w) => w.shiftId === active.id).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] : null;
  const locked = (what) => `<div class="gcard"><h2>${what}</h2><div class="ginfo">Patrols, checkpoint scans and incident reports unlock once the shift has started.</div><button class="gbtn" data-go-home>Go to shift</button></div>`;
  const bindHome = () => $$('[data-go-home]').forEach((b) => (b.onclick = () => { S.gtab = 'home'; guardHome(); }));

  if (S.gtab === 'home') {
    if (!cur) { g.innerHTML = `<div class="gcard"><div class="gk">Hello</div><h1>${esc(S.prof.name)}</h1><p class="gmuted">No shift on the rota for you in the next day and a half.</p></div>
      <div class="gcard"><h2>Start an unplanned shift</h2><label class="gf">Site<select id="us"><option value="">Choose site</option>${sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><label class="gf">Ends at<input type="time" id="ue" value="${new Date(Date.now() + 8 * 36e5).toTimeString().slice(0, 5)}"></label><button class="gbtn pri" id="ust">Start unplanned shift</button></div>`;
      $('#ust').onclick = async () => { const sid = $('#us').value; if (!sid) return toast('Choose a site.', true); const [h, m] = $('#ue').value.split(':').map(Number); const end = new Date(); end.setHours(h, m, 0, 0); if (end < new Date()) end.setDate(end.getDate() + 1); startShift(await put('shifts', { guardId: me, siteId: sid, startAt: now(), endAt: end.toISOString(), unplanned: true })); };
      return; }
    const openFrom = new Date(new Date(cur.startAt).getTime() - 60 * 60000), canStart = !active && new Date() >= openFrom;
    const status = active ? ['On shift', 'ok'] : canStart ? ['Ready', 'warn'] : ['Not started', 'idle'];
    const overdue = due && new Date(due.dueAt) < new Date();
    g.innerHTML = `<section class="gcard">
        <div class="grow2"><div><div class="gk">Site</div><div class="gsite">${esc(site?.name || 'Site')}</div></div><span class="gpill ${status[1]}">${status[0]}</span></div>
        <div class="ggrid"><div><div class="gk">Guard</div><div class="gv">${esc(S.prof.name)}</div></div><div><div class="gk">Now</div><div class="gv mono" id="gclock">${new Date().toLocaleTimeString('en-GB')}</div></div>
        <div><div class="gk">Shift start</div><div class="gv">${tm(cur.startAt)}</div><div class="gd">${dmy(cur.startAt)}</div></div><div><div class="gk">Shift end</div><div class="gv">${tm(cur.endAt)}</div><div class="gd">${dmy(cur.endAt)}</div></div></div>
        ${active ? `<div class="gd" style="margin-top:4px">Started at ${tm(active.actualStart)}</div>` : ''}</section>
      ${active ? `<button class="gsos" id="sos">SOS · I need help</button>
        <section class="gcard ${overdue ? 'galert' : ''}"><div class="grow2"><div><div class="gk">Welfare check</div><div class="gv">${due ? (overdue ? `<span class="gbad">Overdue since ${tm(due.dueAt)}</span>` : `Next at ${tm(due.dueAt)}`) : 'No check due'}</div></div></div><button class="gbtn ok" id="wok">I'm OK</button></section>
        <button class="gbtn" id="end">End shift</button>`
      : `<button class="gbtn big ${canStart ? 'ok' : ''}" id="st" ${canStart ? '' : 'disabled'}>START SHIFT</button>
        ${canStart ? '' : `<p class="gcenter gmuted">You can start this shift from ${tm(openFrom)} on ${dmy(openFrom)}.</p>`}
        <div class="ginfo">Patrols, checkpoint scans and incident reports unlock once the shift has started.</div>`}
      <button class="gbtn" id="instr">VIEW SITE INSTRUCTIONS</button>`;
    S.timers.push(setInterval(() => { const c = $('#gclock'); if (c) c.textContent = new Date().toLocaleTimeString('en-GB'); if (!active && !canStart && new Date() >= openFrom) guardHome(); if (overdue === false && due && new Date(due.dueAt) < new Date()) guardHome(); }, 1000));
    if ($('#st')) $('#st').onclick = () => startShift(cur);
    if ($('#sos')) $('#sos').onclick = () => sos(active);
    if ($('#wok')) $('#wok').onclick = () => welfareOk(active, due);
    if ($('#end')) $('#end').onclick = async () => { if (!confirm('End your shift now?')) return; await put('shifts', { ...active, actualEnd: now() }); for (const w of welfare.filter((x) => x.shiftId === active.id)) await put('welfareChecks', { ...w, status: 'Cancelled' }); toast('Shift ended. Thank you.'); guardHome(); };
    $('#instr').onclick = () => modal(`<h2>${esc(site?.name || 'Site')} · instructions</h2><div style="white-space:pre-line">${esc(site?.instructions || 'No instructions added yet. Your supervisor can add them in Sites & checkpoints.')}</div>${site?.address ? `<p class="soft">${esc(site.address)}</p>` : ''}<button class="btn pri" onclick="closeModal()">Close</button>`);
    return;
  }
  if (S.gtab === 'patrol') {
    if (!active) { g.innerHTML = locked('Patrol'); bindHome(); return; }
    g.innerHTML = `<section class="gcard"><div class="gk">Site</div><div class="gsite">${esc(site?.name || '')}</div><button class="gbtn pri big" id="pat">START PATROL</button></section>
      <section class="gcard"><h2>Today's patrols</h2>${patrols.length ? patrols.map((p) => `<div class="glist"><span>${tm(p.startAt)} · ${esc(p.area || site?.name || '')}</span><span class="gpill ${p.status !== 'Completed' ? 'warn' : (p.missed || []).length ? 'bad' : 'ok'}">${p.status !== 'Completed' ? esc(p.status) : (p.missed || []).length ? p.missed.length + ' missed' : 'Complete'}</span></div>`).join('') : '<p class="gmuted">None yet today.</p>'}</section>`;
    $('#pat').onclick = () => patrol(active, site);
    return;
  }
  if (S.gtab === 'incident') {
    if (!active) { g.innerHTML = locked('Incident'); bindHome(); return; }
    g.innerHTML = `<button class="gbtn pri big" id="inc">REPORT AN INCIDENT</button><section class="gcard"><h2>My reports (7 days)</h2>${incs.length ? incs.sort((a, b) => b.at.localeCompare(a.at)).map((i) => `<div class="glist"><span>${esc(i.type)}<br><span class="gd">${fmt(i.at)}</span></span><span class="gpill ${i.status === 'Open' ? 'bad' : 'ok'}">${esc(i.status)}</span></div>`).join('') : '<p class="gmuted">No reports this week.</p>'}</section>`;
    $('#inc').onclick = () => incidentForm(active);
    return;
  }
  g.innerHTML = `<section class="gcard"><div class="gk">Signed in as</div><div class="gsite">${esc(S.prof.name)}</div><div class="gd">${esc(S.prof.email || '')}</div></section>
    <button class="gbtn" id="instr2">Site instructions</button><button class="gbtn" id="pw">Change password</button><button class="gbtn" id="out">Sign out</button>
    <p class="gcenter gd">SecureWatch · Crystal Facilities Management</p>`;
  $('#instr2').onclick = () => modal(`<h2>${esc(site?.name || 'Site')} · instructions</h2><div style="white-space:pre-line">${esc(site?.instructions || 'No instructions added yet.')}</div><button class="btn pri" onclick="closeModal()">Close</button>`);
  $('#pw').onclick = setPassword;
  $('#out').onclick = async () => { clearTimers(); document.body.classList.remove('g'); await sb.auth.signOut(); login(); };
}
async function startShift(sh) {
  const mins = +(S.settings.welfareMinutes || 60), loc = await where();
  const s = await put('shifts', { ...sh, actualStart: now(), startLat: loc?.lat ?? null, startLng: loc?.lng ?? null });
  await put('welfareChecks', { guardId: S.prof.ref_id, siteId: s.siteId, shiftId: s.id, dueAt: new Date(Date.now() + mins * 60000).toISOString(), status: 'Due' });
  toast('Shift started. Stay safe.'); S.gtab = 'home'; guardHome();
}
async function welfareOk(sh, due) {
  const mins = +(S.settings.welfareMinutes || 60);
  if (due) await put('welfareChecks', { ...due, status: 'Done', doneAt: now() });
  else await put('welfareChecks', { guardId: S.prof.ref_id, siteId: sh.siteId, shiftId: sh.id, dueAt: now(), doneAt: now(), status: 'Done' });
  await put('welfareChecks', { guardId: S.prof.ref_id, siteId: sh.siteId, shiftId: sh.id, dueAt: new Date(Date.now() + mins * 60000).toISOString(), status: 'Due' });
  toast(`Thanks. Next check in ${mins} minutes.`); guardHome();
}
function where() { return new Promise((ok) => { if (!navigator.geolocation) return ok(null); navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok(null), { timeout: 6000, maximumAge: 60000 }); }); }
async function sos(sh) {
  if (!confirm('Send an SOS alert to your supervisor now?')) return;
  const loc = await where();
  await put('sosEvents', { guardId: S.prof.ref_id, siteId: sh.siteId, shiftId: sh.id, at: now(), status: 'Open', lat: loc?.lat ?? null, lng: loc?.lng ?? null });
  modal(`<h1 class="err">SOS sent</h1><p>Your supervisor has been alerted${loc ? ' with your location' : ''}.</p><p><b>If you are in danger, call 999 now.</b></p><a class="btn bad big" href="tel:999">Call 999</a><button class="btn big" onclick="closeModal()">Close</button>`);
}
async function patrol(sh, site) {
  const all = (await list('checkpoints', (q) => q.eq('data->>siteId', sh.siteId))).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!all.length) return toast('This site has no checkpoints yet. Ask your supervisor.', true);
  const areas = [...new Set(all.map((c) => c.area).filter(Boolean))];
  let area = null;
  if (areas.length > 1) {
    area = await new Promise((ok) => { modal(`<h2>Which building are you patrolling?</h2>${areas.map((a) => `<button class="btn big" data-area="${esc(a)}">${esc(a)} <span class="soft">(${all.filter((c) => c.area === a).length} points)</span></button>`).join('')}<button class="btn pri big" data-area="">Whole site (${all.length} points)</button><button class="btn" data-area="__x">Cancel</button>`);
      $$('[data-area]').forEach((b) => (b.onclick = () => { closeModal(); ok(b.dataset.area); })); });
    if (area === '__x') return;
  }
  const cps = area ? all.filter((c) => c.area === area) : all;
  const p = await put('patrols', { guardId: S.prof.ref_id, siteId: sh.siteId, shiftId: sh.id, area: area || null, startAt: now(), status: 'In progress', scanned: [], missed: [] });
  const done = new Set(); let qr = null;
  const draw = () => {
    $('#gmain').innerHTML = `<div class="gcard"><h1>Patrol · ${esc(area || site?.name || '')}</h1><p class="gmuted" style="margin:0">${done.size} of ${cps.length} checkpoints · started ${tm(p.startAt)}</p></div>
      <div class="gcard"><div id="reader"></div><div class="row"><button class="btn pri grow" id="scan">${qr ? 'Stop camera' : 'Scan checkpoint'}</button></div><div class="row"><input id="code" placeholder="Or type the checkpoint code" autocomplete="off" class="grow"><button class="btn" id="add">Add</button></div></div>
      <div class="gcard"><div style="display:flex;flex-direction:column;gap:8px">${cps.map((c) => `<div class="cp ${done.has(c.id) ? 'done' : ''}"><span class="dot">${done.has(c.id) ? '✓' : ''}</span><div class="grow"><b>${esc(c.name)}</b><div class="soft">${esc(c.code)}</div></div></div>`).join('')}</div></div>
      <button class="gbtn ok big" id="fin">FINISH PATROL</button><button class="gbtn" id="can">Cancel patrol</button>`;
    $('#scan').onclick = toggleCam; $('#add').onclick = () => hit($('#code').value); $('#code').onkeydown = (e) => { if (e.key === 'Enter') hit(e.target.value); };
    $('#fin').onclick = finish; $('#can').onclick = async () => { if (!confirm('Cancel this patrol?')) return; await stopCam(); await put('patrols', { ...p, status: 'Cancelled', endAt: now() }); guardHome(); };
  };
  const hit = async (raw) => {
    const norm = (v) => String(v || '').trim().replace(/^SW:/i, '').toUpperCase(); const code = norm(raw); if (!code) return;
    const c = cps.find((x) => norm(x.id) === code || norm(x.code) === code);
    if (!c) return toast(all.some((x) => norm(x.code) === code || norm(x.id) === code) ? 'That checkpoint is in a different building from this patrol.' : 'That code is not a checkpoint on this site.', true);
    if (done.has(c.id)) return toast(`${c.name} already scanned.`);
    done.add(c.id); if (navigator.vibrate) navigator.vibrate(120);
    await put('checkpointScans', { patrolId: p.id, checkpointId: c.id, guardId: S.prof.ref_id, siteId: sh.siteId, at: now() });
    toast(`✓ ${c.name}`); const wasCam = !!qr; draw(); if (wasCam) { qr = null; toggleCam(); }
  };
  const toggleCam = async () => {
    if (qr) { await stopCam(); draw(); return; }
    if (!window.Html5Qrcode) return toast('Camera scanner unavailable. Type the code instead.', true);
    qr = new Html5Qrcode('reader');
    try { await qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 }, (txt) => { if (!hit.busy) { hit.busy = true; hit(txt).finally(() => setTimeout(() => (hit.busy = false), 1500)); } }); $('#scan').textContent = 'Stop camera'; }
    catch (e) { qr = null; toast('Camera blocked. Allow camera access, or type the code.', true); }
  };
  const stopCam = async () => { if (qr) { try { await qr.stop(); } catch (_) {} qr = null; } };
  const finish = async () => {
    const missed = cps.filter((c) => !done.has(c.id)).map((c) => c.id);
    let explanation = '';
    if (missed.length) { explanation = prompt(`${missed.length} checkpoint(s) not scanned:\n${cps.filter((c) => missed.includes(c.id)).map((c) => '• ' + c.name).join('\n')}\n\nWhy? (required)`) || ''; if (!explanation.trim()) return toast('Please explain the missed checkpoints.', true); }
    const notes = prompt('Anything to report from this patrol? (optional)\ne.g. Transtech & Tool Room locked and alarmed, rear barrier activated') || '';
    await stopCam();
    await put('patrols', { ...p, status: 'Completed', endAt: now(), scanned: [...done], missed, explanation: explanation.trim(), notes: notes.trim() });
    toast(missed.length ? 'Patrol saved with missed checkpoints.' : 'Patrol complete. Well done.'); S.gtab = 'patrol'; guardHome();
  };
  draw();
}
function incidentForm(sh) {
  modal(`<h2>Report an incident</h2><form id="if" style="display:flex;flex-direction:column;gap:10px">
    <label class="f">Type<select name="type">${['Suspicious person', 'Intruder', 'Theft', 'Damage / vandalism', 'Fire alarm', 'Medical', 'Health & safety hazard', 'Access / door issue', 'Anti-social behaviour', 'Other'].map((t) => `<option>${t}</option>`).join('')}</select></label>
    <label class="f">Severity<select name="severity"><option>Low</option><option selected>Medium</option><option>High</option><option>Critical</option></select></label>
    <label class="f">What happened?<textarea name="description" required placeholder="Who, what, where, when, what you did"></textarea></label>
    <label class="f">Photo (optional)<input type="file" name="photo" accept="image/*" capture="environment"></label>
    <div class="row"><button type="button" class="btn grow" onclick="closeModal()">Cancel</button><button class="btn pri grow">Send report</button></div></form>`);
  $('#if').onsubmit = async (e) => { e.preventDefault(); const b = e.target.querySelector('.pri'); b.disabled = true; const fd = new FormData(e.target), f = fd.get('photo');
    let photoPath = null;
    try {
      if (f && f.size) { if (f.size > 10 * 1024 * 1024) throw new Error('Photo is over 10 MB.'); photoPath = `${S.prof.ref_id}/${Date.now()}-${(f.name || 'photo.jpg').replace(/[^\w.\-]+/g, '_')}`; const { error } = await sb.storage.from('sw-evidence').upload(photoPath, f, { contentType: f.type }); if (error) throw error; }
      const loc = await where();
      await put('incidents', { guardId: S.prof.ref_id, siteId: sh.siteId, shiftId: sh.id, at: now(), type: fd.get('type'), severity: fd.get('severity'), description: String(fd.get('description')).slice(0, 4000), status: 'Open', photoPath, lat: loc?.lat ?? null, lng: loc?.lng ?? null });
      closeModal(); toast('Incident reported. Your supervisor can see it now.');
    } catch (er) { toast(er.message, true); b.disabled = false; }
  };
}

/* =====================================================================
   FACILITIES MANAGER
   ===================================================================== */
async function fmHome() {
  clearTimers();
  $('#app').innerHTML = topbar(S.prof.name + ' · Facilities') + `<main class="wrap" id="fmain"><div class="spin"></div></main>`; bindOut();
  const [tasks, sites] = await Promise.all([list('tasks'), list('sites')]); const SM = byId(sites);
  const open = tasks.filter((t) => !['Done', 'Cancelled'].includes(t.status)).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))), done = tasks.filter((t) => t.status === 'Done').slice(0, 15);
  $('#fmain').innerHTML = `<div class="grid"><div class="kpi" style="--c:var(--acc)"><span>Open tasks</span><b>${open.length}</b></div><div class="kpi" style="--c:var(--bad)"><span>Overdue</span><b>${open.filter((t) => t.dueAt && new Date(t.dueAt) < new Date()).length}</b></div><div class="kpi" style="--c:var(--ok)"><span>Done (recent)</span><b>${done.length}</b></div></div>
    <div class="card"><h2>My tasks</h2>${open.length ? open.map((t) => taskRow(t, SM, true)).join('') : '<p class="soft">Nothing open. 👏</p>'}</div>
    <div class="card"><h2>Recently completed</h2>${done.map((t) => taskRow(t, SM, false)).join('') || '<p class="soft">None yet.</p>'}</div>`;
  bindTaskRows(tasks, fmHome);
  S.timers.push(setInterval(fmHome, 120000));
}
const taskRow = (t, SM, act) => { const od = t.dueAt && new Date(t.dueAt) < new Date() && !['Done', 'Cancelled'].includes(t.status);
  return `<div class="card" style="box-shadow:none;background:var(--panel2)" data-t="${t.id}"><div class="row" style="align-items:center"><div class="grow"><b>${esc(t.title)}</b><div class="soft">${esc(SM.get(t.siteId)?.name || '')} · due ${fmt(t.dueAt)} ${od ? '<b class="err">overdue</b>' : ''}</div></div>${chip(t.priority || 'Normal', t.priority === 'High' || t.priority === 'Urgent' ? '--bad' : '--soft')} ${chip(t.status || 'Open', KST[t.status] || '--acc')}</div>
    ${t.description ? `<p style="margin:0">${esc(t.description)}</p>` : ''}${t.notes ? `<p class="soft" style="margin:0;white-space:pre-line">${esc(t.notes)}</p>` : ''}
    ${act ? `<div class="row"><select data-ts style="max-width:180px">${['Open', 'In progress', 'Done'].map((s) => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><input data-tn placeholder="Add a note (optional)" class="grow"><button class="btn sm pri" data-tsave>Update</button></div>` : ''}</div>`; };
function bindTaskRows(tasks, back) {
  $$('[data-tsave]').forEach((b) => (b.onclick = async () => { const box = b.closest('[data-t]'), t = tasks.find((x) => x.id === box.dataset.t), st = $('[data-ts]', box).value, note = $('[data-tn]', box).value.trim();
    await put('tasks', { ...t, status: st, completedAt: st === 'Done' ? now() : t.completedAt || null, notes: note ? `${t.notes ? t.notes + '\n' : ''}${new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} ${S.prof.name}: ${note}` : t.notes });
    toast('Task updated.'); back(); }));
}

/* =====================================================================
   SUPERVISOR / ADMIN
   ===================================================================== */
const TABS = [['live', 'Live'], ['incidents', 'Incidents'], ['patrols', 'Patrols'], ['tasks', 'FM tasks'], ['rota', 'Rota'], ['sites', 'Sites & checkpoints'], ['people', 'People'], ['settings', 'Settings']];
async function staffHome() {
  clearTimers();
  $('#app').innerHTML = topbar(`${S.prof.name} · ${S.prof.role === 'admin' ? 'Admin' : 'Supervisor'}`) + `<nav class="tabs" role="tablist">${TABS.filter(([k]) => k !== 'settings' || S.prof.role === 'admin').map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav><main class="wrap" id="m"><div class="spin"></div></main>`;
  bindOut(); $$('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; staffHome(); }));
  try { await ({ live, incidents, patrols: patrolsTab, tasks: tasksTab, rota, sites: sitesTab, people, settings: settingsTab })[S.tab](); }
  catch (e) { $('#m').innerHTML = `<div class="card"><h2>Couldn't load</h2><p class="err">${esc(e.message)}</p></div>`; }
}
function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.value = 0.08; o.start(); setTimeout(() => { o.frequency.value = 660; }, 250); setTimeout(() => { o.stop(); a.close(); }, 600); } catch (_) {} }
async function live() {
  const grace = +(S.settings.welfareGraceMinutes || 15) * 60000, from = new Date(Date.now() - 16 * 36e5).toISOString();
  const [sites, guards, shifts, pats, incs, wel, sos, tasks] = await Promise.all([list('sites'), list('guards'), list('shifts', (q) => q.gte('data->>endAt', from)), list('patrols', (q) => q.gte('data->>startAt', dayStart())), list('incidents', (q) => q.gte('data->>at', new Date(Date.now() - 7 * 864e5).toISOString())), list('welfareChecks', (q) => q.eq('data->>status', 'Due')), list('sosEvents', (q) => q.eq('data->>status', 'Open')), list('tasks')]);
  // overdue welfare checks become "Missed"
  const missedNow = wel.filter((w) => new Date(w.dueAt).getTime() + grace < Date.now());
  for (const w of missedNow) await put('welfareChecks', { ...w, status: 'Missed', missedAt: now() });
  const SM = byId(sites), GM = byId(guards), n = (id) => GM.get(id)?.name || 'Guard', sn = (id) => SM.get(id)?.name || 'Site';
  const on = shifts.filter((s) => s.actualStart && !s.actualEnd), late = shifts.filter((s) => !s.actualStart && new Date(s.startAt) < new Date(Date.now() - 15 * 60000) && new Date(s.endAt) > new Date());
  const missedPts = pats.reduce((t, p) => t + (p.missed || []).length, 0), openInc = incs.filter((i) => !['Resolved', 'Closed'].includes(i.status)), openTasks = tasks.filter((t) => !['Done', 'Cancelled'].includes(t.status));
  if (sos.length) beep();
  const k = (l, v, sub, c) => `<div class="kpi" style="--c:var(${c})"><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
  $('#m').innerHTML = `${sos.length ? `<div class="card alert"><h2 class="err">🚨 SOS – ${sos.length} open</h2>${sos.map((s) => `<div class="row" style="align-items:center"><div class="grow"><b>${esc(n(s.guardId))}</b> · ${esc(sn(s.siteId))} · ${tm(s.at)} ${s.lat ? `· <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${s.lat},${s.lng}">map</a>` : ''}</div><a class="btn sm" href="tel:${esc(GM.get(s.guardId)?.phone || '')}">Call</a><button class="btn sm ok" data-sosr="${s.id}">Resolved</button></div>`).join('')}</div>` : ''}
    <div class="grid">${k('On shift now', on.length, `${late.length} late to start`, late.length ? '--warn' : '--ok')}${k('Patrols today', pats.filter((p) => p.status === 'Completed').length, `${missedPts} missed checkpoints`, missedPts ? '--bad' : '--acc')}${k('Open incidents', openInc.length, `${incs.length} in 7 days`, openInc.length ? '--bad' : '--ok')}${k('Welfare missed', missedNow.length, 'just now', missedNow.length ? '--bad' : '--ok')}${k('FM tasks open', openTasks.length, `${openTasks.filter((t) => t.dueAt && new Date(t.dueAt) < new Date()).length} overdue`, '--acc')}</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"><div class="card"><h2>On shift</h2>${on.length ? `<div class="list">${on.map((s) => `<div><span><b>${esc(n(s.guardId))}</b><br><span class="soft">${esc(sn(s.siteId))} · since ${tm(s.actualStart)}</span></span><span class="soft">ends ${tm(s.endAt)}</span></div>`).join('')}</div>` : '<p class="soft">Nobody on shift.</p>'}
      ${late.length ? `<h3 class="err" style="margin-top:8px">Late to start</h3><div class="list">${late.map((s) => `<div><span>${esc(n(s.guardId))} · ${esc(sn(s.siteId))}</span><span class="err">due ${tm(s.startAt)}</span></div>`).join('')}</div>` : ''}</div>
    <div class="card"><h2>Today's patrols</h2>${pats.length ? `<div class="list">${pats.map((p) => `<div><span>${tm(p.startAt)} · <b>${esc(n(p.guardId))}</b><br><span class="soft">${esc(sn(p.siteId))}${p.area ? ' · ' + esc(p.area) : ''}${p.explanation ? ' · ' + esc(p.explanation) : ''}${p.notes ? ' · ' + esc(p.notes) : ''}</span></span>${p.status !== 'Completed' ? chip(p.status, '--warn') : (p.missed || []).length ? chip(`${p.missed.length} missed`, '--bad') : chip('Complete', '--ok')}</div>`).join('')}</div>` : '<p class="soft">No patrols yet today.</p>'}</div>
    <div class="card"><h2>Open incidents</h2>${openInc.length ? `<div class="list">${openInc.slice(0, 10).map((i) => `<div><span>${chip(i.severity, SEV[i.severity] || '--soft')} <b>${esc(i.type)}</b><br><span class="soft">${esc(sn(i.siteId))} · ${esc(n(i.guardId))} · ${fmt(i.at)}</span></span></div>`).join('')}</div>` : '<p class="soft">None. 👏</p>'}</div></div>
    <p class="soft">Refreshes every 20 seconds.</p>`;
  $$('[data-sosr]').forEach((b) => (b.onclick = async () => { const s = sos.find((x) => x.id === b.dataset.sosr); await put('sosEvents', { ...s, status: 'Resolved', resolvedAt: now(), resolvedBy: S.prof.name }); toast('SOS marked resolved.'); live(); }));
  S.timers.push(setInterval(() => { if (S.tab === 'live' && $('#modal').hidden) live().catch(() => {}); }, 20000));
}
async function incidents() {
  const [incs, sites, guards] = await Promise.all([list('incidents'), list('sites'), list('guards')]); const SM = byId(sites), GM = byId(guards); let f = 'open';
  const draw = () => { const L = incs.filter((i) => f === 'all' || (f === 'open' ? !['Resolved', 'Closed'].includes(i.status) : i.status === f)).sort((a, b) => b.at.localeCompare(a.at));
    $('#m').innerHTML = `<div class="row"><label class="f">Show<select id="fi">${[['open', 'Open'], ['Resolved', 'Resolved'], ['Closed', 'Closed'], ['all', 'All']].map(([v, l]) => `<option value="${v}" ${f === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><div class="grow"></div><button class="btn" id="ix">Export CSV</button></div>
      <div class="tw"><table><thead><tr><th>When</th><th>Site</th><th>Guard</th><th>Type</th><th>Severity</th><th>Status</th><th></th></tr></thead><tbody>${L.map((i) => `<tr><td>${fmt(i.at)}</td><td>${esc(SM.get(i.siteId)?.name || '')}</td><td>${esc(GM.get(i.guardId)?.name || '')}</td><td>${esc(i.type)}</td><td>${chip(i.severity, SEV[i.severity] || '--soft')}</td><td>${chip(i.status, TST[i.status] || '--soft')}</td><td><button class="btn sm" data-i="${i.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="7" class="soft">Nothing here.</td></tr>'}</tbody></table></div>`;
    $('#fi').onchange = (e) => { f = e.target.value; draw(); };
    $('#ix').onclick = () => csv('incidents', L.map((i) => ({ When: fmt(i.at), Site: SM.get(i.siteId)?.name || '', Guard: GM.get(i.guardId)?.name || '', Type: i.type, Severity: i.severity, Status: i.status, Description: i.description, Notes: i.notes || '' })));
    $$('[data-i]').forEach((b) => (b.onclick = async () => { const i = incs.find((x) => x.id === b.dataset.i); let img = '';
      if (i.photoPath) { const { data } = await sb.storage.from('sw-evidence').createSignedUrl(i.photoPath, 300); if (data) img = `<img src="${data.signedUrl}" alt="Incident photo" style="max-width:100%;border-radius:10px">`; }
      modal(`<h2>${esc(i.type)} · ${chip(i.severity, SEV[i.severity] || '--soft')}</h2><p class="soft" style="margin:0">${esc(SM.get(i.siteId)?.name || '')} · ${esc(GM.get(i.guardId)?.name || '')} · ${fmt(i.at)}${i.lat ? ` · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${i.lat},${i.lng}">location</a>` : ''}</p><p style="white-space:pre-line">${esc(i.description)}</p>${img}${i.notes ? `<p class="soft" style="white-space:pre-line">${esc(i.notes)}</p>` : ''}
        <label class="f">Status<select id="is">${['Open', 'Investigating', 'Resolved', 'Closed'].map((s) => `<option ${i.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label class="f">Add a note<textarea id="in" placeholder="Action taken, client informed, police ref…"></textarea></label>
        <div class="row"><button class="btn grow" onclick="closeModal()">Close</button><button class="btn pri grow" id="isv">Save</button></div>`);
      $('#isv').onclick = async () => { const note = $('#in').value.trim(); Object.assign(i, await put('incidents', { ...i, status: $('#is').value, notes: note ? `${i.notes ? i.notes + '\n' : ''}${new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} ${S.prof.name}: ${note}` : i.notes || '' })); closeModal(); toast('Saved.'); draw(); }; })); };
  draw();
}
async function patrolsTab() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [pats, sites, guards, cps] = await Promise.all([list('patrols', (q) => q.gte('data->>startAt', since)), list('sites'), list('guards'), list('checkpoints')]); const SM = byId(sites), GM = byId(guards), CM = byId(cps);
  const L = pats.sort((a, b) => b.startAt.localeCompare(a.startAt));
  $('#m').innerHTML = `<div class="row"><h2 class="grow">Patrols · last 7 days</h2><button class="btn" id="px">Export CSV</button></div><div class="tw"><table><thead><tr><th>Start</th><th>End</th><th>Site</th><th>Guard</th><th>Scanned</th><th>Missed</th><th>Explanation</th><th>Notes</th></tr></thead><tbody>${L.map((p) => `<tr><td>${fmt(p.startAt)}</td><td>${tm(p.endAt)}</td><td>${esc(SM.get(p.siteId)?.name || '')}${p.area ? `<div class="soft">${esc(p.area)}</div>` : ''}</td><td>${esc(GM.get(p.guardId)?.name || '')}</td><td>${(p.scanned || []).length}</td><td class="${(p.missed || []).length ? 'err' : ''}">${(p.missed || []).map((x) => esc(CM.get(x)?.name || x)).join(', ') || (p.status === 'Completed' ? '—' : esc(p.status))}</td><td>${esc(p.explanation || '')}</td><td>${esc(p.notes || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="soft">No patrols.</td></tr>'}</tbody></table></div>`;
  $('#px').onclick = () => csv('patrols', L.map((p) => ({ Start: fmt(p.startAt), End: fmt(p.endAt), Site: SM.get(p.siteId)?.name || '', Building: p.area || '', Guard: GM.get(p.guardId)?.name || '', Status: p.status, Scanned: (p.scanned || []).length, Missed: (p.missed || []).map((x) => CM.get(x)?.name || x).join('; '), Explanation: p.explanation || '', Notes: p.notes || '' })));
}
async function tasksTab() {
  const [tasks, sites, fms] = await Promise.all([list('tasks'), list('sites'), list('fms')]); const SM = byId(sites), FM = byId(fms);
  const open = tasks.filter((t) => !['Done', 'Cancelled'].includes(t.status)).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  $('#m').innerHTML = `<div class="row"><h2 class="grow">FM tasks</h2><button class="btn pri" id="tn">New task</button></div>
    <div class="tw"><table><thead><tr><th>Task</th><th>Site</th><th>Assigned to</th><th>Priority</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${[...open, ...tasks.filter((t) => ['Done', 'Cancelled'].includes(t.status)).slice(0, 30)].map((t) => `<tr><td><b>${esc(t.title)}</b>${t.notes ? `<div class="soft" style="white-space:pre-line">${esc(t.notes.split('\n').slice(-1)[0])}</div>` : ''}</td><td>${esc(SM.get(t.siteId)?.name || '')}</td><td>${esc(FM.get(t.assigneeId)?.name || '—')}</td><td>${esc(t.priority || 'Normal')}</td><td class="${t.dueAt && new Date(t.dueAt) < new Date() && !['Done', 'Cancelled'].includes(t.status) ? 'err' : ''}">${fmt(t.dueAt)}</td><td>${chip(t.status || 'Open', KST[t.status] || '--acc')}</td><td><button class="btn sm" data-te="${t.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="7" class="soft">No tasks yet.</td></tr>'}</tbody></table></div>`;
  const form = (t = {}) => { modal(`<h2>${t.id ? 'Edit' : 'New'} task</h2><form id="tf" style="display:flex;flex-direction:column;gap:10px"><label class="f">Task<input name="title" required value="${esc(t.title || '')}"></label><label class="f">Details<textarea name="description">${esc(t.description || '')}</textarea></label>
      <div class="row"><label class="f grow">Site<select name="siteId">${sites.map((s) => `<option value="${s.id}" ${t.siteId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label><label class="f grow">Assign to<select name="assigneeId"><option value="">—</option>${fms.map((f) => `<option value="${f.id}" ${t.assigneeId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label></div>
      <div class="row"><label class="f grow">Priority<select name="priority">${['Low', 'Normal', 'High', 'Urgent'].map((p) => `<option ${(t.priority || 'Normal') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label><label class="f grow">Due<input type="datetime-local" name="due" value="${t.dueAt ? new Date(new Date(t.dueAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}"></label><label class="f grow">Status<select name="status">${['Open', 'In progress', 'Done', 'Cancelled'].map((s) => `<option ${(t.status || 'Open') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
      <div class="row"><button type="button" class="btn grow" onclick="closeModal()">Cancel</button><button class="btn pri grow">Save</button></div></form>`);
    $('#tf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await put('tasks', { ...t, title: f.title, description: f.description, siteId: f.siteId, assigneeId: f.assigneeId || null, priority: f.priority, status: f.status, dueAt: f.due ? new Date(f.due).toISOString() : null, createdAt: t.createdAt || now(), completedAt: f.status === 'Done' ? t.completedAt || now() : null }); closeModal(); toast('Task saved.'); tasksTab(); }; };
  $('#tn').onclick = () => (sites.length ? form() : toast('Add a site first.', true));
  $$('[data-te]').forEach((b) => (b.onclick = () => form(tasks.find((t) => t.id === b.dataset.te))));
}
async function rota() {
  const from = dayStart(), to = new Date(Date.now() + 14 * 864e5).toISOString();
  const [shifts, sites, guards] = await Promise.all([list('shifts', (q) => q.gte('data->>startAt', from).lte('data->>startAt', to)), list('sites'), list('guards')]); const SM = byId(sites), GM = byId(guards);
  const L = shifts.sort((a, b) => a.startAt.localeCompare(b.startAt));
  $('#m').innerHTML = `<div class="card"><h2>Add shifts</h2><form id="rf" class="row"><label class="f grow">Guard<select name="g" required>${guards.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label><label class="f grow">Site<select name="s" required>${sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
    <label class="f">First date<input type="date" name="d" required value="${new Date().toISOString().slice(0, 10)}"></label><label class="f">Start<input type="time" name="a" required value="19:00"></label><label class="f">End<input type="time" name="b" required value="07:00"></label><label class="f">Repeat for<select name="n">${[1, 2, 3, 4, 5, 6, 7, 14].map((x) => `<option value="${x}">${x} day${x > 1 ? 's' : ''}</option>`).join('')}</select></label><button class="btn pri">Add</button></form></div>
    <div class="tw"><table><thead><tr><th>Start</th><th>End</th><th>Guard</th><th>Site</th><th>Status</th><th></th></tr></thead><tbody>${L.map((s) => `<tr><td>${fmt(s.startAt)}</td><td>${fmt(s.endAt)}</td><td>${esc(GM.get(s.guardId)?.name || '')}</td><td>${esc(SM.get(s.siteId)?.name || '')}</td><td>${s.actualEnd ? chip('Finished', '--soft') : s.actualStart ? chip('On shift', '--ok') : chip('Planned', '--acc')}</td><td>${s.actualStart ? '' : `<button class="btn sm" data-rd="${s.id}">Remove</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="soft">No shifts in the next 14 days.</td></tr>'}</tbody></table></div>`;
  $('#rf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.g || !f.s) return toast('Add guards and sites first.', true);
    for (let i = 0; i < +f.n; i++) { const st = new Date(`${f.d}T${f.a}`); st.setDate(st.getDate() + i); const en = new Date(`${f.d}T${f.b}`); en.setDate(en.getDate() + i); if (en <= st) en.setDate(en.getDate() + 1); await put('shifts', { guardId: f.g, siteId: f.s, startAt: st.toISOString(), endAt: en.toISOString() }); }
    toast(`${f.n} shift(s) added.`); rota(); };
  $$('[data-rd]').forEach((b) => (b.onclick = async () => { if (!confirm('Remove this shift?')) return; await del('shifts', b.dataset.rd); rota(); }));
}
async function sitesTab() {
  const [sites, cps] = await Promise.all([list('sites'), list('checkpoints')]);
  const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
  $('#m').innerHTML = `<div class="card"><h2>Add a site</h2><form id="sf" class="row"><label class="f grow">Site name<input name="name" required></label><label class="f grow">Address<input name="address"></label><label class="f">Welfare check every (min)<input name="w" type="number" min="15" max="240" value="${S.settings.welfareMinutes || 60}"></label><button class="btn pri">Add site</button></form></div>
    ${sites.sort((a, b) => a.name.localeCompare(b.name)).map((s) => { const mine = cps.filter((c) => c.siteId === s.id).sort((a, b) => (a.order || 0) - (b.order || 0));
      return `<div class="card" data-s="${s.id}"><div class="row" style="align-items:center"><div class="grow"><h2>${esc(s.name)}</h2><span class="soft">${esc(s.address || '')}</span></div><button class="btn sm" data-ins>Guard instructions</button><button class="btn sm" data-qr>Print QR codes</button><button class="btn sm" data-sdel>Remove site</button></div>
        <div class="list">${mine.map((c) => `<div><span><b>${esc(c.order || '')}. ${esc(c.name)}</b>${c.area ? ` ${chip(c.area, '--acc')}` : ''} <span class="soft">${esc(String(c.code).slice(0, 40))}${c.oldSticker ? ' · old sticker' : ''}</span></span><button class="btn sm" data-cdel="${c.id}">Remove</button></div>`).join('') || '<p class="soft" style="margin:0">No checkpoints yet.</p>'}</div>
        <div class="row"><input data-cn placeholder="New checkpoint, e.g. Rear fire exit" class="grow"><input data-ca placeholder="Building (optional)" style="max-width:180px"><input data-cc placeholder="Old sticker code (optional)" style="max-width:260px"><button class="btn sm pri" data-cadd>Add checkpoint</button></div><p class="soft" style="margin:0">Reusing an old sticker? Scan it with the phone camera, copy the text it shows, and paste it into "Old sticker code".</p></div>`; }).join('') || '<p class="soft">No sites yet.</p>'}`;
  $('#sf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await put('sites', { name: f.name.trim(), address: f.address.trim(), welfareMinutes: +f.w || 60 }); toast('Site added.'); sitesTab(); };
  $$('[data-s]').forEach((box) => { const sid = box.dataset.s, s = sites.find((x) => x.id === sid), mine = cps.filter((c) => c.siteId === sid);
    $('[data-cadd]', box).onclick = async () => { const name = $('[data-cn]', box).value.trim(); if (!name) return; const old = $('[data-cc]', box).value.trim(); if (old && cps.some((c) => String(c.code).trim().toUpperCase() === old.toUpperCase())) return toast('That sticker code is already used by another checkpoint.', true); await put('checkpoints', { siteId: sid, name, code: old || code(), order: mine.length + 1, oldSticker: !!old, area: $('[data-ca]', box).value.trim() || null }); sitesTab(); };
    $('[data-ins]', box).onclick = () => { modal(`<h2>Instructions for guards · ${esc(s.name)}</h2><p class="soft" style="margin:0">Shown on the guard's phone under "View site instructions".</p><textarea id="insT" style="min-height:220px">${esc(s.instructions || '')}</textarea><div class="row"><button class="btn grow" onclick="closeModal()">Cancel</button><button class="btn pri grow" id="insS">Save</button></div>`); $('#insS').onclick = async () => { await put('sites', { ...s, instructions: $('#insT').value }); closeModal(); toast('Instructions saved.'); sitesTab(); }; };
    $('[data-sdel]', box).onclick = async () => { if (!confirm(`Remove ${s.name}? History is kept.`)) return; await del('sites', sid); sitesTab(); };
    $$('[data-cdel]', box).forEach((b) => (b.onclick = async () => { if (!confirm('Remove this checkpoint?')) return; await del('checkpoints', b.dataset.cdel); sitesTab(); }));
    $('[data-qr]', box).onclick = () => { if (!mine.length) return toast('Add checkpoints first.', true); const w = window.open('', '_blank'); w.document.write(`<title>${esc(s.name)} checkpoints</title><style>body{font-family:system-ui;padding:20px}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}.g div{border:1px dashed #94A3B8;padding:16px;text-align:center;break-inside:avoid}h3{margin:8px 0 2px}</style><h2>${esc(s.name)} · patrol checkpoints</h2><div class="g">${mine.map((c, i) => `<div><div id="q${i}" style="display:inline-block"></div><h3>${esc(c.name)}</h3><div>Code: <b>${esc(c.code)}</b></div><small>SecureWatch · Crystal FM</small></div>`).join('')}</div>`); w.document.close();
      const s2 = w.document.createElement('script'); s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s2.onload = () => { mine.forEach((c, i) => new w.QRCode(w.document.getElementById('q' + i), { text: c.oldSticker ? c.code : 'SW:' + c.id, width: 180, height: 180 })); setTimeout(() => w.print(), 500); }; w.document.head.appendChild(s2); };
  });
}
async function people() {
  const [guards, fms, profs] = await Promise.all([list('guards'), list('fms'), sb.from('sw_profiles').select('*').order('name').then((r) => r.data || [])]);
  const admin = S.prof.role === 'admin', hasLogin = (ref) => profs.find((p) => p.ref_id === ref);
  const expSoon = (d) => d && (new Date(d) - Date.now()) / 864e5 < 60;
  $('#m').innerHTML = `<div class="card"><h2>Guards</h2><form id="gf" class="row"><label class="f grow">Name<input name="name" required></label><label class="f">SIA licence no.<input name="sia"></label><label class="f">SIA expiry<input type="date" name="exp"></label><label class="f">Mobile<input name="phone" type="tel"></label><label class="f grow">Email<input name="email" type="email"></label><button class="btn pri">Add guard</button></form>
      <div class="tw"><table><thead><tr><th>Name</th><th>SIA</th><th>Expiry</th><th>Mobile</th><th>Login</th><th></th></tr></thead><tbody>${guards.sort((a, b) => a.name.localeCompare(b.name)).map((g) => `<tr><td><b>${esc(g.name)}</b></td><td>${esc(g.sia || '')}</td><td class="${expSoon(g.siaExpiry) ? 'err' : ''}">${g.siaExpiry ? new Date(g.siaExpiry).toLocaleDateString('en-GB') : '—'}</td><td>${esc(g.phone || '')}</td><td>${hasLogin(g.id) ? chip(hasLogin(g.id).active ? 'Has login' : 'Switched off', hasLogin(g.id).active ? '--ok' : '--soft') : admin ? `<button class="btn sm" data-login="guard|${g.id}">Create login</button>` : '—'}</td><td><button class="btn sm" data-gdel="${g.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6" class="soft">No guards yet.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Facilities managers</h2><form id="ff" class="row"><label class="f grow">Name<input name="name" required></label><label class="f">Mobile<input name="phone" type="tel"></label><label class="f grow">Email<input name="email" type="email"></label><button class="btn pri">Add FM</button></form>
      <div class="list">${fms.map((f) => `<div><span><b>${esc(f.name)}</b> <span class="soft">${esc(f.phone || '')} ${esc(f.email || '')}</span></span><span>${hasLogin(f.id) ? chip('Has login', '--ok') : admin ? `<button class="btn sm" data-login="fm|${f.id}">Create login</button>` : ''} <button class="btn sm" data-fdel="${f.id}">Remove</button></span></div>`).join('') || '<p class="soft" style="margin:0">No FMs yet.</p>'}</div></div>
    ${admin ? `<div class="card"><h2>Logins</h2><div class="row"><button class="btn" data-login="supervisor|">Add supervisor login</button><button class="btn" data-login="admin|">Add admin login</button></div>
      <div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${profs.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.email || '')}</td><td>${esc(p.role)}</td><td>${p.active ? chip('Active', '--ok') : chip('Off', '--soft')}</td><td>${p.id === S.user.id ? '' : `<button class="btn sm" data-reset="${p.id}">Reset password</button> <button class="btn sm" data-act="${p.id}|${p.active ? 0 : 1}">${p.active ? 'Switch off' : 'Switch on'}</button>`}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  $('#gf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await put('guards', { name: f.name.trim(), sia: f.sia.trim(), siaExpiry: f.exp || null, phone: f.phone.trim(), email: f.email.trim().toLowerCase() }); toast('Guard added.'); people(); };
  $('#ff').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await put('fms', { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim().toLowerCase() }); toast('FM added.'); people(); };
  $$('[data-gdel]').forEach((b) => (b.onclick = async () => { if (!confirm('Remove this guard? History is kept.')) return; await del('guards', b.dataset.gdel); people(); }));
  $$('[data-fdel]').forEach((b) => (b.onclick = async () => { if (!confirm('Remove this FM?')) return; await del('fms', b.dataset.fdel); people(); }));
  const fn = async (body) => { const { data, error } = await sb.functions.invoke('sw-admin', { body }); if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (_) {} throw new Error(m); } return data; };
  $$('[data-login]').forEach((b) => (b.onclick = async () => { const [role, ref] = b.dataset.login.split('|'), rec = [...guards, ...fms].find((x) => x.id === ref);
    const name = rec?.name || prompt('Full name'); if (!name) return; const email = (rec?.email || prompt('Email for the login') || '').trim(); if (!email) return toast('An email is needed for a login.', true);
    try { const r = await fn({ action: 'create', name, email, role, ref_id: ref || null }); modal(`<h2>Login created</h2><p>Give these to <b>${esc(name)}</b> privately:</p><div class="card" style="box-shadow:none;background:var(--panel2)"><div>Website: <b>${esc(location.origin + location.pathname)}</b></div><div>Email: <b>${esc(r.email)}</b></div><div>Temporary password: <b style="font-family:monospace;font-size:17px">${esc(r.password)}</b></div></div><p class="soft">They'll choose their own password the first time they sign in.</p><button class="btn pri" onclick="closeModal()">Done</button>`); people(); } catch (e) { toast(e.message, true); } }));
  $$('[data-reset]').forEach((b) => (b.onclick = async () => { if (!confirm('Create a new temporary password?')) return; try { const r = await fn({ action: 'reset', id: b.dataset.reset }); modal(`<h2>New temporary password</h2><p style="font-family:monospace;font-size:18px"><b>${esc(r.password)}</b></p><button class="btn pri" onclick="closeModal()">Done</button>`); } catch (e) { toast(e.message, true); } }));
  $$('[data-act]').forEach((b) => (b.onclick = async () => { const [id, on] = b.dataset.act.split('|'); try { await fn({ action: 'active', id, active: on === '1' }); toast('Updated.'); people(); } catch (e) { toast(e.message, true); } }));
}
async function settingsTab() {
  const st = S.settings;
  $('#m').innerHTML = `<div class="card"><h2>Settings</h2><form id="stf" class="row"><label class="f grow">Company name<input name="company" value="${esc(st.company || 'Crystal Facilities Management')}"></label><label class="f">Welfare check every (min)<input name="w" type="number" min="15" max="240" value="${st.welfareMinutes || 60}"></label><label class="f">Grace before "missed" (min)<input name="g" type="number" min="5" max="60" value="${st.welfareGraceMinutes || 15}"></label><button class="btn pri">Save</button></form></div>`;
  $('#stf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); S.settings = await put('settings', { ...st, id: 'main', company: f.company, welfareMinutes: +f.w, welfareGraceMinutes: +f.g }); toast('Saved.'); };
}

window.closeModal = closeModal;
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') login(); });
boot().catch((e) => { $('#app').innerHTML = `<div class="center"><div class="card login"><h2>Something went wrong</h2><p class="err">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`; });
