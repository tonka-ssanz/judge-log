/* SSANZ Judge Log — training records: progress dots, the supervisor's To do, the full form view and JDSC admin.
 * Shared training records live with the JDSC helper script (CONFIG.apiUrl), which keeps them in the JDSC's
 * Training Records sheet and fills the trainee's slot in Judges and Trials (master) once the supervisor completes it. */
'use strict';

/* ---------- talking to the JDSC helper ---------- */
async function callApi(action, data = {}) {
  if (!CONFIG.apiUrl) throw new Error('Training records aren\'t switched on yet. Please tell the JDSC.');
  if (!navigator.onLine) throw new Error('No signal. Try again when you\'re back online.');
  const token = await getToken();
  let res;
  try {
    res = await fetch(CONFIG.apiUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, data)) });
  } catch (e) { throw new Error('Couldn\'t reach the JDSC training records. Check your signal and try again.'); }
  let out;
  try { out = await res.json(); } catch (e) { throw new Error('The JDSC training records didn\'t answer properly. Please tell the JDSC.'); }
  if (!out.ok) {
    if (/expired/i.test(out.error)) clearToken();
    throw new Error(out.error);
  }
  return out;
}
const tokenReady = () => !!(accessToken && Date.now() < tokenExpiry);
const cachedMe = () => store.get('me', null);

async function refreshMe() {
  const me = await callApi('me');
  signedInEmail = me.email;
  store.set('me', Object.assign(me, { at: Date.now() }));
  if (navigator.setAppBadge) { try { me.todo.length ? navigator.setAppBadge(me.todo.length) : navigator.clearAppBadge(); } catch (e) { /* not supported */ } }
  return me;
}

/* Send training records that haven't gone to the supervisor yet (or were changed since). */
async function sendTrainingRecords() {
  const s = settings();
  let sent = 0;
  for (const e of entries().filter((x) => TRAINING_FORMS[x.kind] && (!x.sent || x.changed))) {
    const record = Object.assign({}, e.extras || {}, {
      id: e.id, kind: e.kind, date: e.date, host: e.host, location: e.location, level: e.level, element: e.element,
      supervisor: e.supervisor, setter: e.setter, teams: e.teams, passes: e.passes, video: e.video, reflections: e.reflections,
      membership: s.membership || '',
    });
    await callApi('submit', { record });
    const list = entries(); const x = list.find((y) => y.id === e.id);
    if (x) { x.sent = Date.now(); x.changed = false; saveEntries(list); }
    sent++;
  }
  return sent;
}

/* ---------- progress ---------- */
const TRAINING_GROUPS = [
  ['SWI|Novice', 'Stewarding with Intent', 'Novice'],
  ['PJ|Novice', 'Probationary Judging', 'Novice'],
  ['SWI|Intermediate', 'Stewarding with Intent', 'Intermediate'],
  ['PJ|Intermediate', 'Probationary Judging', 'Intermediate'],
  ['Mentoring|Advanced/Excellent', 'Mentoring', 'Advanced/Excellent'],
];
const TRAINING_ELEMENTS = ['Interior', 'Exterior', 'Container', 'Vehicle'];
const KIND_CODE = { 'Stewarding with Intent': 'SWI', 'Probationary Judging': 'PJ', Mentoring: 'Mentoring' };
const normText = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
const groupOf = (kind, level) => (KIND_CODE[kind] === 'Mentoring' ? 'Mentoring|Advanced/Excellent' : `${KIND_CODE[kind]}|${level}`);

/* Offline fallback: the snapshot in training.js, unlocked with the email in My details. */
let trainingCache = { email: null, data: null };
async function loadSnapshot() {
  const email = normText(settings().email);
  if (trainingCache.email === email) return trainingCache.data;
  let data = null;
  try {
    if (email && typeof TRAINING !== 'undefined' && window.crypto && crypto.subtle) {
      const enc = new TextEncoder();
      const idBuf = await crypto.subtle.digest('SHA-256', enc.encode('ssanz-training-id|' + email));
      const id = Array.from(new Uint8Array(idBuf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
      if (TRAINING[id]) {
        const base = await crypto.subtle.importKey('raw', enc.encode(email), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('ssanz-judge-log-training'), iterations: TRAINING_ITER, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const raw = Uint8Array.from(atob(TRAINING[id]), (c) => c.charCodeAt(0));
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
        data = JSON.parse(new TextDecoder().decode(plain));
      }
    }
  } catch (e) { data = null; }
  trainingCache = { email, data };
  return data;
}
/* Live progress from the JDSC helper if we have it, otherwise the snapshot. */
async function loadTraining() {
  const me = cachedMe();
  if (me && me.progress) return Object.assign({ live: true, at: me.at }, me.progress);
  const snap = await loadSnapshot();
  return snap ? Object.assign({ live: false }, snap) : null;
}

/* Training happens in stages: SWIs first, then Probationary or Mentoring once every SWI is signed off.
 * The JDSC helper works this out; this copy is for the offline snapshot. */
function trainingLevelOf(level) {
  const l = String(level || '').trim().toLowerCase();
  if (!/trainee/.test(l)) return null;
  return /^nov/.test(l) ? 'Novice' : /^int/.test(l) ? 'Intermediate' : 'Advanced/Excellent';
}
const STAGE_GROUPS = {
  Novice: { first: 'SWI|Novice', second: 'PJ|Novice' },
  Intermediate: { first: 'SWI|Intermediate', second: 'PJ|Intermediate' },
  'Advanced/Excellent': { first: null, second: 'Mentoring|Advanced/Excellent' },
};
const kindsForOption = (o) => (o === 'Either' ? ['Probationary Judging', 'Mentoring'] : o === 'Mentoring' ? ['Mentoring'] : ['Probationary Judging']);
function stageOf(data) {
  if (data.stage !== undefined) return data.stage;
  const tl = trainingLevelOf(data.level); if (!tl) return null;
  const sg = STAGE_GROUPS[tl];
  const option = 'Probationary';
  const settled = (c) => ['done', 'credit', 'na'].includes(c[0]);
  const swiDone = !sg.first || !data.grid[sg.first] || TRAINING_ELEMENTS.every((el) => data.grid[sg.first][el].every(settled));
  return swiDone ? { name: 'second', group: sg.second, kinds: kindsForOption(option), option, trainingLevel: tl, firstGroup: sg.first }
    : { name: 'SWI', group: sg.first, kinds: ['Stewarding with Intent'], option, trainingLevel: tl, secondGroup: sg.second };
}
/* The JDSC's sign-off for the stage on screen. */
function stageSignoffHtml(st, isSwi) {
  if (!st) return '';
  if (isSwi) {
    if (st.swiApproved) return `<p class="small signoff ok">SWIs approved by the JDSC: ${esc(st.swiApproved)}</p>`;
    if (st.swiColumn && st.allSwiSettled) return `<p class="small signoff warn">All SWIs done. Waiting for the JDSC to approve them.</p>`;
    return st.swiColumn ? `<p class="small muted signoff">The JDSC approves the SWIs once they're all done. The next stage opens then.</p>` : '';
  }
  return st.promoted ? `<p class="small signoff ok">Promoted: ${esc(st.promoted)}</p>` : '';
}
/* Every sign-off the JDSC has entered for this person, all levels. */
function signoffsHtml(progress) {
  const so = (progress && progress.signoffs) || {};
  const rows = ['Novice', 'Intermediate', 'Advanced/Excellent'].filter((lv) => so[lv] && (so[lv].swi || so[lv].promoted));
  if (!rows.length) return '';
  return `<h2>JDSC sign-offs</h2><div class="card">` + rows.map((lv) =>
    `<div class="entry"><div class="top"><span>${esc(lv)}</span></div><div class="meta">` +
    [so[lv].swi ? `SWI's approved ${esc(so[lv].swi)}` : '', so[lv].promoted ? `Promoted ${esc(so[lv].promoted)}` : ''].filter(String).join(' · ') +
    `</div></div>`).join('') + `</div>`;
}
/* Title for a stage, e.g. "Probationary or Mentoring – Intermediate". */
function stageTitle(stage, group) {
  const tl = stage ? stage.trainingLevel : '';
  if (group && group.startsWith('SWI')) return `Stewarding with Intent – ${tl}`;
  const k = stage ? stage.kinds : [];
  const what = k.length === 2 ? 'Probationary or Mentoring' : k[0] === 'Mentoring' ? 'Mentoring' : 'Probationary Judging';
  return `${what} – ${tl}`;
}
/* Training kinds this person can log right now. */
async function allowedKinds() {
  const data = await loadTraining();
  const st = data ? stageOf(data) : null;
  return st ? st.kinds : [];
}

function trainingView(data) {
  const stage = stageOf(data);
  const current = stage ? [stage.group] : [];
  const grid = JSON.parse(JSON.stringify(data.grid));
  // Records saved on this phone but not yet sent take the next empty slot.
  const sentIds = new Set(((cachedMe() || {}).records || []).map((r) => r.id));
  entries().filter((e) => TRAINING_FORMS[e.kind] && !sentIds.has(e.id) && !(data.live && e.sent))
    .sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
      const tl = stage && stage.trainingLevel; if (!tl) return;
      const g = e.kind === 'Stewarding with Intent' ? STAGE_GROUPS[tl].first : STAGE_GROUPS[tl].second;
      if (!g) return;
      if (!grid[g] || !grid[g][e.element]) return;
      let i = grid[g][e.element].findIndex((c) => c[0] === 'todo');
      const extra = i < 0;
      if (extra) i = grid[g][e.element].findIndex((c) => c[0] === 'na');
      if (i >= 0) grid[g][e.element][i] = [e.sent ? 'waiting' : 'logged', [e.host, nzDate(e.date), e.supervisor].filter(Boolean).join(' · '), null, e.kind, extra];
    });
  // Only the stage the person is currently training for.
  const groups = TRAINING_GROUPS.filter(([g]) => grid[g] && current.includes(g)).map(([g]) => [g, stageTitle(stage, g)]);
  let need = 0, got = 0, waiting = 0;
  groups.filter(([g]) => current.includes(g)).forEach(([g]) => TRAINING_ELEMENTS.forEach((el) => grid[g][el].forEach((c) => {
    if (c[0] === 'na' || c[4]) return; need++;
    if (c[0] === 'done' || c[0] === 'credit') got++;
    if (c[0] === 'waiting' || c[0] === 'logged') waiting++;
  })));
  return { grid, groups, current, need, got, waiting, stage };
}

const DOT_LABEL = { done: 'Done', waiting: 'Waiting for supervisor', logged: 'Saved, not sent yet', booked: 'Booked', credit: 'Waived', check: 'Needs checking', todo: 'Still to do', na: 'Not needed' };
function dotHtml(c, el, n) {
  const label = `${el} ${n}: ${c[4] ? 'Extra – ' : ''}${DOT_LABEL[c[0]]}${c[1] ? ' – ' + c[1] : ''}`;
  const dot = `<span class="dot ${c[0]}${c[4] ? ' extra' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}"></span>`;
  return c[2] ? `<a href="#review/${encodeURIComponent(c[2])}" class="dotlink">${dot}</a>` : dot;
}
function gridHtml(v, opts = {}) {
  let html = '';
  v.groups.forEach(([g, title]) => {
    const cur = v.current.includes(g);
    const rows = TRAINING_ELEMENTS.map((el) => {
      const cells = v.grid[g][el];
      const body = cells.every((c) => c[0] === 'na') ? '<span class="muted small">Not needed</span>' : cells.map((c, i) => dotHtml(c, el, i + 1)).join('');
      return `<div class="prow"><span class="el">${esc(el)}</span><span class="dots">${body}</span></div>`;
    }).join('');
    const details = [];
    TRAINING_ELEMENTS.forEach((el) => v.grid[g][el].forEach((c, i) => {
      if (c[1]) details.push(`<li><b>${esc(el)} ${i + 1}</b>${c[4] ? ' (extra)' : ''} · ${esc(DOT_LABEL[c[0]])}${categoryOf(g, c) ? ` (${categoryOf(g, c)})` : ''}${c[1] !== DOT_LABEL[c[0]] ? ': ' + esc(c[1]) : ''}</li>`);
    }));
    html += `<div class="card prog"><h3>${esc(title)}</h3>${opts.stageNote || ''}${rows}` +
      (details.length ? `<details><summary class="small">Details</summary><ul class="small plain">${details.join('')}</ul></details>` : '') + `</div>`;
  });
  return html;
}
/* Probationary or Mentoring, for appointments in the second stage. */
function categoryOf(g, c) {
  if (g.startsWith('SWI') || ['na', 'todo', 'credit'].includes(c[0])) return '';
  if (c[3]) return c[3] === 'Mentoring' ? 'Mentoring' : 'Probationary';
  return /\(mentor\)/i.test(c[1] || '') || g.startsWith('Mentoring') ? 'Mentoring' : 'Probationary';
}
const legendHtml = () => `<div class="legend small">${['done', 'waiting', 'logged', 'booked', 'credit', 'todo'].map((k) => `<span><span class="dot ${k}"></span> ${DOT_LABEL[k]}</span>`).join('')}<span><span class="dot done extra"></span> Extra (more than required)</span></div>`;

async function renderTraining() {
  const box = $('#trainingBody'); const s = settings();
  box.innerHTML = '<p class="muted">Loading…</p>';
  const data = await loadTraining();
  const me = cachedMe();
  if (!data) {
    box.innerHTML = (!s.email && !me)
      ? `<div class="status warn"><span class="grow">Add your email under My details, then tap Sync now to see your training progress.</span><a class="btn small" href="#settings">Add</a></div>`
      : `<div class="status warn"><span class="grow">No training progress found for <b>${esc((me && me.email) || s.email)}</b>. Check this is the email the JDSC has for you, or ask the JDSC.</span></div>`;
    box.innerHTML += `<div class="actions"><button class="btn ghost block" data-sync>Sync now</button></div>`;
    return;
  }
  const v = trainingView(data);
  if (!v.groups.length) {
    box.innerHTML = `<div class="card"><p>Training progress is shown for judges who are currently training for a level. The JDSC records show you as <b>${esc(levelName(data.level))}</b>.</p></div>`;
    return;
  }
  let html = '';
  if (v.need) html += `<div class="card"><b class="big">${v.got} of ${v.need}</b> ${v.stage && v.stage.name === 'SWI' ? 'SWIs' : 'training searches'} signed off for your current stage` +
    (v.waiting ? `<p class="small" style="margin:6px 0 0">${v.waiting} more waiting for a supervisor's comments.</p>` : '') + `</div>`;
  const st = v.stage;
  const next = st && st.secondGroup ? stageTitle(Object.assign({}, st, { kinds: kindsForOption(st.option) }), st.secondGroup).replace(/ – .*/, '') : '';
  const note = st && st.name === 'SWI' && st.secondGroup
    ? (st.swiColumn && st.allSwiSettled
      ? `<p class="small signoff warn" style="margin:0 0 6px">All your SWIs are done. ${esc(next)} opens once the JDSC approves them.</p>`
      : `<p class="small muted" style="margin:0 0 6px">Once all your SWIs are signed off${st.swiColumn ? ' and approved by the JDSC' : ''}, ${esc(next)} opens.</p>`)
    : (st && st.swiApproved ? `<p class="small signoff ok" style="margin:0 0 6px">SWIs approved by the JDSC: ${esc(st.swiApproved)}</p>` : '') +
      (st && st.kinds.length === 2 ? `<p class="small muted" style="margin:0 0 6px">The JDSC has approved you for Probationary Judging or Mentoring. Choose which when you log each one.</p>` : '');
  html += legendHtml() + gridHtml(v, { stageNote: note });
  html += data.live
    ? `<p class="small muted">From the JDSC's records, updated ${new Date(data.at).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })}. A dot fills in once your supervisor has added their comments.</p>`
    : `<p class="small muted">From the JDSC's records as at ${esc(TRAINING_AS_AT)}. Tap Sync now for the latest.</p>`;
  html += `<div class="actions"><a class="btn block" href="#log/new-training">Log a training search</a><button class="btn ghost block" data-sync>Sync now</button></div>`;
  html += appointmentsHtml(me);
  // The trainee's own records, newest first.
  const sentIds = new Set(((me || {}).records || []).map((r) => r.id));
  const unsent = entries().filter((e) => TRAINING_FORMS[e.kind] && !sentIds.has(e.id));
  const recs = unsent.map((e) => ({ id: e.id, local: true, kind: e.kind, level: e.level, element: e.element, date: e.date, host: e.host,
    supervisor: e.supervisor, status: e.sent ? 'Waiting for supervisor' : 'Not sent yet' }))
    .concat((me && me.records) || []);
  if (recs.length) {
    html += `<h2>My training records</h2><div class="card">` + recs.map((r) => recordRow(r, r.local ? `#log/${encodeURIComponent(r.id)}` : `#review/${encodeURIComponent(r.id)}`)).join('') + `</div>`;
  }
  if (me && me.records) html += reportsHtml(me.records, 'me');
  box.innerHTML = html;
}
/* Approved appointments from the JDSC's yearly Trials tabs. */
const APPT_CLASS = { Upcoming: '', 'Signed off': 'ok', 'Waiting for supervisor': 'warn', 'Record to send': 'bad', Completed: '' };
function appointmentsHtml(me, admin) {
  const list = (me && me.appointments) || [];
  if (!me) return '';
  const heading = admin ? 'Approved appointments' : 'My approved appointments';
  if (!list.length) return `<h2>${heading}</h2><div class="card"><p class="small muted">No approved training appointments at ${admin ? 'their' : 'your'} current level in the JDSC's trial lists yet.</p></div>`;
  const row = (a) => {
    const i = list.indexOf(a);
    const action = a.status === 'Record to send' && !admin ? `<a class="btn small" href="#log/appt-${i}">Log it</a>`
      : a.recordId ? `<a class="small" href="#review/${encodeURIComponent(a.recordId)}">Open record</a>` : '';
    return `<div class="entry"><div class="top"><span>${esc(a.kind)}: ${esc(a.level)} ${esc(a.element || a.elementText)}</span><span>${esc(nzDate(a.date))}</span></div>
      <div class="meta">${esc(a.host)}${a.venue && a.venue !== 'TBC' ? ' · ' + esc(a.venue) : ''}${a.supervisor ? ' · ' + esc(a.supervisor) : ''}</div>
      <div class="row-actions"><span class="pill ${APPT_CLASS[a.status] || ''}">${esc(a.status)}</span>${action}</div></div>`;
  };
  const upcoming = list.filter((a) => a.status === 'Upcoming').reverse();
  const past = list.filter((a) => a.status !== 'Upcoming');
  let html = `<h2>${heading}</h2>`;
  html += upcoming.length ? `<h3 class="sub">Coming up</h3><div class="card">${upcoming.map(row).join('')}</div>` : '';
  html += past.length ? `<h3 class="sub">Done</h3><div class="card">${past.map(row).join('')}</div>
    <p class="small muted">“Completed” means it was done before the Judge Log was used for training, so the JDSC records it from the paper form.</p>` : '';
  return html;
}
function statusPill(status) {
  const cls = status === 'Complete' ? 'ok' : status === 'Withdrawn' ? 'bad' : 'warn';
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}
function recordRow(r, href, who) {
  return `<a class="entry linkrow" href="${href}"><div class="top"><span>${esc(r.kind)}: ${esc(r.level)} ${esc(r.element)}</span><span>${esc(nzDate(r.date))}</span></div>
    <div class="meta">${who ? esc(who) + ' · ' : ''}${esc(r.host || '')}${r.supervisor ? ' · ' + esc(r.supervisor) : ''}</div>
    <div style="margin-top:6px">${statusPill(r.status)}</div></a>`;
}

async function renderTrainingTile() {
  const tile = $('#trainingTile'); if (!tile) return;
  const data = await loadTraining();
  const j = await findJudge(settings());
  const me = cachedMe();
  const level = (me && me.person && me.person.level) || (j && j.l) || (data && data.level) || '';
  const v = data ? trainingView(data) : null;
  tile.hidden = isJdscAccount() || !/trainee/i.test(level);
  $('#trainingTileText').textContent = v && v.need
    ? `${v.got} of ${v.need} complete${v.waiting ? `, ${v.waiting} waiting` : ''}`
    : 'Your SWI, Probationary and Mentoring progress';
}

/* ---------- home: To do card, admin tile, quiet refresh ---------- */
let refreshing = false;
function renderHomeTodo() {
  const me = cachedMe();
  const n = me && me.todo ? me.todo.length : 0;
  $('#homeTodo').innerHTML = n ? `<a class="status todo" href="#todo"><span class="grow"><b>To do:</b> ${n} training record${n > 1 ? 's' : ''} waiting for your comments.</span><span class="btn small">Open</span></a>` : '';
  $('#adminTile').hidden = !(me && me.isAdmin);
  if (me && me.isAdmin) $('#adminTileText').textContent = me.waitingCount ? `${me.waitingCount} record${me.waitingCount > 1 ? 's' : ''} waiting for supervisors` : 'Trainee requirements and records';
  // If we're already signed in, refresh quietly (no pop-up).
  if (CONFIG.apiUrl && tokenReady() && navigator.onLine && !refreshing && (!me || Date.now() - (me.at || 0) > 60000)) {
    refreshing = true;
    refreshMe().then(() => { if (!$('[data-view=home]').hidden) { renderHomeTodo(); renderTrainingTile(); if (!isJdscAccount()) renderWho(); } }).catch(() => {}).finally(() => { refreshing = false; });
  }
}

/* ---------- To do (supervising judge) ---------- */
function signInPrompt(box, why, after, hint) {
  box.innerHTML = `<div class="card"><p>${esc(why)}</p><button class="btn block" data-signin>Sign in with Google</button></div>`;
  const btn = $('[data-signin]', box);
  btn.addEventListener('click', () => {
    if (btn.dataset.busy) return;            // ignore a second tap while signing in
    btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Signing in…';
    const reset = () => { delete btn.dataset.busy; btn.disabled = false; btn.textContent = 'Sign in with Google'; };
    getToken(hint ? { hint } : {}).then(() => {
      btn.textContent = 'Checking your account…';
      const me = cachedMe();
      // JDSC admin: we already know it's the JDSC account, so carry on straight away and refresh in the background.
      if (hint && me && me.isAdmin) { refreshMe().catch(() => {}); return after(); }
      return refreshMe().then(after);
    }).catch((e) => { reset(); (e.message === 'offline' || e.message === 'loading' || /popup/.test(e.message) ? explainTokenError(e) : toast(e.message, 6000)); });
  });
}
function renderTodo() {
  const box = $('#todoBody'); const me = cachedMe();
  if (!me) { signInPrompt(box, 'Sign in to see training records waiting for your comments.', renderTodo); return; }
  let html = '';
  html += me.todo.length
    ? `<p class="muted small">Trainees who named you as their coaching or mentoring judge. Open one to read their part and add your comments.</p><div class="card">${me.todo.map((r) => recordRow(r, `#review/${encodeURIComponent(r.id)}`, r.trainee)).join('')}</div>`
    : `<div class="card"><p>Nothing waiting for you. 🎉</p></div>`;
  if (me.supervised && me.supervised.length) html += `<h2>Completed by you</h2><div class="card">${me.supervised.map((r) => recordRow(r, `#review/${encodeURIComponent(r.id)}`, r.trainee)).join('')}</div>`;
  html += `<div class="actions"><button class="btn ghost block" data-sync>Refresh</button></div>`;
  box.innerHTML = html;
}

/* ---------- one training record ---------- */
function findCachedRecord(id) {
  const me = cachedMe() || {};
  const all = [].concat(me.todo || [], me.records || [], me.supervised || [], (adminState.person && adminState.person.records) || [], adminState.waiting || []);
  return all.find((r) => r.id === id) || null;
}
async function renderReview(id) {
  id = decodeURIComponent(id || '');
  const box = $('#reviewBody');
  const local = entries().find((e) => e.id === id && !e.sent);
  if (local) { location.hash = 'log/' + encodeURIComponent(id); return; }
  let rec = findCachedRecord(id), canComplete = false;
  if (tokenReady() || !rec) {
    if (!tokenReady() && !cachedMe()) { signInPrompt(box, 'Sign in with Google to open this training record.', () => renderReview(id)); return; }
    box.innerHTML = rec ? box.innerHTML : '<p class="muted">Loading…</p>';
    try { const out = await callApi('get', { id }); rec = out.record; canComplete = out.canComplete; }
    catch (e) {
      if (!rec) { signInPrompt(box, e.message, () => renderReview(id)); return; }
    }
  }
  if (!rec) { box.innerHTML = '<div class="card"><p>That training record could not be found.</p></div>'; return; }
  if (!canComplete && rec.status === 'Waiting for supervisor') {
    const me = cachedMe() || {};
    canComplete = me.isAdmin || (me.todo || []).some((r) => r.id === rec.id);
  }
  box.innerHTML = reviewHtml(rec, canComplete);
  addVoice(box);
  const form = $('#supForm', box);
  if (form) {
    const key = 'draft.review.' + rec.id;
    const d = store.get(key, null);
    if (d) { $$('[data-area]', form).forEach((el, i) => { const a = (d.areas || [])[i] || {}; el.checked = !!a.ticked; }); $$('[data-note]', form).forEach((el, i) => { el.value = ((d.areas || [])[i] || {}).note || ''; }); form.comments.value = d.comments || ''; }
    const read = () => ({ areas: $$('[data-area]', form).map((el, i) => ({ ticked: el.checked, note: $$('[data-note]', form)[i].value.trim() })), comments: form.comments.value.trim() });
    form.addEventListener('input', () => store.set(key, read()));
    form.addEventListener('change', () => store.set(key, read()));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const part = read();
      if (!part.comments) { toast('Please add your comments.'); return; }
      if (!confirm(`Complete and sign this record for ${rec.trainee}?\n\nYour name and Google account stand in for your signature. It can't be changed afterwards.`)) return;
      const btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Saving…';
      callApi('complete', { id: rec.id, supervisorPart: part })
        .then(() => { localStorage.removeItem('jl.' + key); toast(`Done. ${rec.trainee} has been emailed and their record updated.`, 5000); return refreshMe(); })
        .then(() => { location.hash = 'todo'; })
        .catch((e) => { toast(e.message, 6000); btn.disabled = false; btn.textContent = 'Complete and sign'; });
    });
  }
  const wd = $('[data-withdraw]', box);
  if (wd) wd.addEventListener('click', () => {
    if (!confirm('Withdraw this training record? Your supervisor will no longer see it.')) return;
    callApi('withdraw', { id: rec.id }).then(() => refreshMe()).then(() => { toast('Withdrawn.'); location.hash = 'training'; }).catch((e) => toast(e.message, 6000));
  });
}
function reviewHtml(rec, canComplete, printing) {
  const t = rec.traineePart || {};
  const formDef = TRAINING_FORMS[rec.kind] || { areas: [], supervisorTitle: 'Supervising judge', title: rec.kind };
  const row = (k, v) => (v === '' || v == null || v === false ? '' : `<div class="kv"><span>${esc(k)}</span><div>${esc(v === true ? 'Yes' : v)}</div></div>`);
  const me = cachedMe() || {};
  const mine = me.person && normText(me.person.name) === normText(rec.trainee);
  let html = `<div class="card"><div class="top"><b>${esc(formDef.title)}</b></div>${statusPill(rec.status)}
    <h3>Trainee</h3>` +
    row('Name', rec.trainee) + row('SSANZ membership no.', t.membership) + row('Date', nzDate(rec.date)) + row('Host organisation', rec.host) + row('Venue', rec.venue) +
    row('Level', rec.level) + row('Element', [t.element || rec.element, t.placement ? `(${t.placement})` : ''].join(' ').trim()) + row('Who set the hide(s)', t.setter) +
    row('Teams entered (E)', t.teams) + row('Sourced in time (S)', t.passes) + row('Major faults awarded', t.majorFaults) + row('Minor faults awarded', t.minorFaults) +
    row('Photo taken', t.photoTaken) + row('Video taken', t.videoTaken) +
    (t.video ? `<div class="kv"><span>Photo/video</span><div><a href="${esc(t.video)}" target="_blank" rel="noopener">Open link</a></div></div>` : '') +
    row('Search area review & preparation', t.areaPrep) + row('Environmental factors', t.environment) + row('Search design', t.searchDesign) +
    row(formDef.supervisorTitle, rec.supervisor) + row('Trainee learning / reflections', t.reflections) + `</div>`;
  const s = rec.supervisorPart;
  if (s) {
    html += `<div class="card"><h3>${esc(formDef.supervisorTitle)}</h3>`;
    if (formDef.areas.length) {
      let group = '';
      html += formDef.areas.map(([g, title], i) => {
        const a = (s.areas || [])[i] || {};
        const head = g !== group ? `<h4>${esc(g)}</h4>` : ''; group = g;
        return `${head}<div class="area-done"><span class="tickmark">${a.ticked ? '✓' : '–'}</span><div><b>${esc(title)}</b>${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}</div></div>`;
      }).join('');
    }
    html += `<h4>Comments</h4><p class="refl">${esc(s.comments || '')}</p>
      <p class="small muted">Signed in the Judge Log by ${esc(s.signedBy || '')} on ${esc(nzDate(String(s.signedAt || '').slice(0, 10)))}.</p>` +
      (rec.pdf && me.isAdmin ? `<p class="small"><a href="${esc(rec.pdf)}" target="_blank" rel="noopener">PDF copy in Drive</a></p>` : '') + `</div>`;
  } else if (canComplete) {
    let group = '';
    html += `<form id="supForm" class="card" autocomplete="off"><h3>${esc(formDef.supervisorTitle)} to complete</h3>` +
      (formDef.intro ? `<p class="small muted">${esc(formDef.intro)}</p>` : '') +
      formDef.areas.map(([g, title, desc], i) => {
        const head = g !== group ? `<h4>${esc(g)}</h4>` : ''; group = g;
        return `${head}<div class="area"><label class="tick"><input type="checkbox" data-area="${i}"><span><b>${esc(title)}</b><span>${esc(desc)}</span></span></label>
          <input type="text" data-note="${i}" placeholder="Comment (optional)"></div>`;
      }).join('') +
      `<label class="f" for="supComments">${esc(formDef.supervisorTitle)}'s comments</label>
      <textarea id="supComments" name="comments" data-voice required></textarea>
      <div class="actions"><button class="btn block" type="submit">Complete and sign</button></div>
      <p class="small muted">Your name and Google account stand in for your signature. ${esc(rec.trainee)} and the JDSC get a copy, and the trainee's record in the JDSC master sheet is updated.</p></form>`;
  } else if (rec.status === 'Waiting for supervisor') {
    html += `<div class="card"><p>Waiting for <b>${esc(rec.supervisor)}</b> to add their comments.</p>` +
      (mine && !printing ? `<p class="small muted">Need to change something? Open it under Log a search on the phone you sent it from, or withdraw it and send a new one.</p><button class="btn ghost small" data-withdraw>Withdraw</button>` : '') + `</div>`;
  }
  return html;
}

/* ---------- combined reports: every record for one trainee and stage ---------- */
function bundleKey(r) {
  if (r.kind === 'Stewarding with Intent') return `SWI|${r.level}`;
  const lvl = ['Advanced', 'Excellent'].includes(r.level) ? 'Advanced/Excellent' : r.level;
  return `Second|${lvl}`;
}
function bundles(records) {
  const order = ['SWI|Novice', 'Second|Novice', 'SWI|Intermediate', 'Second|Intermediate', 'Second|Advanced/Excellent'];
  const map = {};
  (records || []).filter((r) => r.status !== 'Withdrawn').forEach((r) => { (map[bundleKey(r)] = map[bundleKey(r)] || []).push(r); });
  return Object.keys(map).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((key) => {
    const recs = map[key].slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const [k, lvl] = key.split('|');
    const kinds = new Set(recs.map((r) => r.kind));
    const what = k === 'SWI' ? 'Stewarding with Intent' : kinds.size > 1 ? 'Probationary and Mentoring' : [...kinds][0];
    return { key, title: `${what} – ${lvl}`, records: recs, done: recs.filter((r) => r.status === 'Complete').length };
  });
}
function reportsHtml(records, who) {
  const list = bundles(records);
  if (!list.length) return '';
  return `<h2>Reports</h2><div class="card">` + list.map((b) => `<a class="entry linkrow" href="#report/${encodeURIComponent(who + '|' + b.key)}">
    <div class="top"><span>${esc(b.title)}</span><span>›</span></div><div class="meta">${b.records.length} record${b.records.length > 1 ? 's' : ''}, ${b.done} signed off · print or save as one document</div></a>`).join('') + `</div>`;
}
async function renderReport(arg) {
  const box = $('#reportBody');
  const [who, ...rest] = decodeURIComponent(arg || '').split('|');
  const key = rest.join('|');
  let records, person;
  if (who === 'me') {
    const me = cachedMe();
    if (!me) { signInPrompt(box, 'Sign in to see your training reports.', () => renderReport(arg)); return; }
    records = me.records; person = me.person;
  } else {
    if (!adminState.person || adminState.person.person.email !== who) {
      if (!tokenReady()) { signInPrompt(box, 'Sign in again with the JDSC account to continue.', () => renderReport(arg), CONFIG.jdsc); return; }
      box.innerHTML = '<p class="muted">Loading…</p>';
      try { adminState.person = await callApi('adminPerson', { email: who }); } catch (e) { box.innerHTML = `<div class="status warn"><span class="grow">${esc(e.message)}</span></div>`; return; }
    }
    records = adminState.person.records; person = adminState.person.person;
  }
  const b = bundles(records).find((x) => x.key === key);
  if (!b) { box.innerHTML = '<div class="card"><p>No training records for that stage.</p></div>'; return; }
  const first = b.records[0], last = b.records[b.records.length - 1];
  let html = `<div class="card report-cover"><div class="small muted">Scent Sport Association of New Zealand · Judges Development Sub-Committee</div>
    <h2 style="margin:6px 0 4px">${esc(b.title)}</h2><b class="who-name">${esc(person ? person.name : '')}</b>
    <p class="small">${b.records.length} record${b.records.length > 1 ? 's' : ''}, ${b.done} signed off · ${esc(nzDate(first.date))} to ${esc(nzDate(last.date))}</p>
    <table class="summary">${b.records.map((r) => `<tr><td>${esc(nzDate(r.date))}</td><td>${esc(r.kind === 'Stewarding with Intent' ? 'SWI' : r.kind === 'Mentoring' ? 'Mentoring' : 'Probationary')} · ${esc(r.element)}</td><td>${esc(r.host || '')}</td><td>${esc(r.supervisor || '')}</td><td>${esc(r.status)}</td></tr>`).join('')}</table>
    <div class="actions no-print"><button class="btn block" data-print>Print or save as PDF</button>` +
    (who !== 'me' ? `<button class="btn ghost block" data-drive-pdf>Save PDF to the trainee's Drive folder</button>` : '') + `</div></div>`;
  html += b.records.map((r) => `<div class="report-rec">${reviewHtml(r, false, true)}</div>`).join('');
  box.innerHTML = html;
  $('[data-print]', box).addEventListener('click', () => window.print());
  const d = $('[data-drive-pdf]', box);
  if (d) d.addEventListener('click', () => {
    d.disabled = true; d.textContent = 'Saving…';
    callApi('adminBundlePdf', { email: who, ids: b.records.map((r) => r.id), title: b.title })
      .then((out) => { d.outerHTML = `<a class="btn ghost block" href="${esc(out.url)}" target="_blank" rel="noopener">Open the PDF in Drive</a>`; toast('Saved in the trainee\'s folder in the JDSC Drive.'); })
      .catch((e) => { toast(e.message, 6000); d.disabled = false; d.textContent = 'Save PDF to the trainee\'s Drive folder'; });
  });
}

/* ---------- JDSC admin ---------- */
const adminState = { people: null, waiting: null, person: null };
const LEVEL_NAMES = { 'Nov Trainee': 'Novice Trainee', 'Int Trainee': 'Intermediate Trainee', 'Adv/Exc Trainee': 'Advanced/Excellent Trainee' };
const levelName = (l) => LEVEL_NAMES[l] || l;
async function renderAdmin(email) {
  const box = $('#adminBody');
  const me = cachedMe();
  if (!me || !me.isAdmin) {
    // The admin sign-in page: bookmark https://tonka-ssanz.github.io/judge-log/#admin
    box.innerHTML = `<div class="card"><h2 style="margin-top:0">JDSC admin</h2>
      <p>Sign in with the JDSC Gmail (${esc(CONFIG.jdsc)}) to see judges, trainees and training records.</p>` +
      (me && me.email ? `<p class="small muted">This browser is signed in to the Judge Log as ${esc(me.email)}.</p>` : '') +
      `<button class="btn block" data-admin-signin>Sign in with the JDSC account</button></div>`;
    $('[data-admin-signin]', box).addEventListener('click', (ev) => {
      const b = ev.currentTarget; if (b.dataset.busy) return;
      b.dataset.busy = '1'; b.disabled = true; b.textContent = 'Signing in…';
      getToken({ chooseAccount: true, hint: CONFIG.jdsc }).then(() => { b.textContent = 'Checking your account…'; return refreshMe(); }).then((m) => {
        if (!m.isAdmin) toast(`${m.email} isn't the JDSC account. Choose ${CONFIG.jdsc}.`, 6000);
        renderAdmin(email);
      }).catch((e) => {
        delete b.dataset.busy; b.disabled = false; b.textContent = 'Sign in with the JDSC account';
        (/^(offline|loading)$/.test(e.message) || /popup/.test(e.message) ? explainTokenError(e) : toast(e.message, 6000));
      });
    });
    return;
  }
  if (!tokenReady()) { signInPrompt(box, 'Sign in again with the JDSC account to continue.', () => renderAdmin(email), CONFIG.jdsc); return; }
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (email) {
      adminState.person = await callApi('adminPerson', { email });
      box.innerHTML = adminPersonHtml(adminState.person);
    } else {
      const out = await callApi('adminPeople');
      adminState.people = out.people; adminState.waiting = out.waiting;
      box.innerHTML = adminListHtml(out);
    }
  } catch (e) { box.innerHTML = `<div class="status warn"><span class="grow">${esc(e.message)}</span></div>`; }
}
/* Active judges by level (highest first), then name. */
const LEVEL_ORDER = ['excellent', 'advanced', 'intermediate', 'novice'];
const levelRank = (l) => { const t = String(levelName(l) || '').toLowerCase(); const i = LEVEL_ORDER.findIndex((x) => t.startsWith(x)); return i < 0 ? 99 : i; };
const byLevel = (a, b) => levelRank(a.level) - levelRank(b.level) || String(a.name).localeCompare(String(b.name));
function adminListHtml(out) {
  const active = out.people.filter((p) => p.status === 'Active').sort(byLevel);
  const trainees = active.filter((p) => /trainee/i.test(p.level));
  let only = false; try { only = localStorage.getItem('jl.adminTraineesOnly') === '1'; } catch (e) { /* storage off */ }
  const personRow = (p) => `<a class="entry linkrow" href="#admin/${encodeURIComponent(p.email)}"${/trainee/i.test(p.level) ? ' data-trainee' : ''}><div class="top"><span>${esc(p.name)}</span><span>${esc(levelName(p.level))}</span></div>
    ${p.waiting ? `<div class="meta">${p.waiting} waiting for supervisor</div>` : ''}</a>`;
  let html = `<p class="small muted">Signed in as ${esc((cachedMe() || {}).email || '')}. Changes are made in Judges and Trials (master).</p>`;
  if (out.waiting.length) html += `<h2>Waiting for supervisors</h2><div class="card">${out.waiting.map((r) => recordRow(r, `#review/${encodeURIComponent(r.id)}`, r.trainee)).join('')}</div>`;
  html += `<h2>Judges</h2><div class="chips" role="group" aria-label="Show">` +
    `<button type="button" class="chipbtn" data-judges="all" aria-pressed="${!only}">All judges (${active.length})</button>` +
    `<button type="button" class="chipbtn" data-judges="trainees" aria-pressed="${only}">Trainees only (${trainees.length})</button></div>`;
  html += `<div class="card${only ? ' trainees-only' : ''}" id="judgeList">${active.map(personRow).join('')}</div>`;
  const others = out.people.filter((p) => p.status !== 'Active').sort(byLevel);
  const otherRow = (p) => `<a class="entry linkrow" href="#admin/${encodeURIComponent(p.email)}"><div class="top"><span>${esc(p.name)}</span><span>${esc(levelName(p.level))}</span></div>
    <div class="meta"><span class="pill ${p.status === 'Resigned' ? 'bad' : 'warn'}">${esc(p.status)}</span></div></a>`;
  if (others.length) html += `<details class="card others"><summary>Inactive and resigned (${others.length})</summary>${others.map(otherRow).join('')}</details>`;
  html += `<p class="small muted">Active judges, highest level first. To change someone's level or status, edit their row in Judges and Trials (master): Level column for their level (for example "Nov Trainee" to start training); colour of their name for status (yellow = currently inactive, pink = resigned, green = approved for mentoring).</p>`;
  return html;
}
/* All judges / Trainees only, on the admin list. */
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-judges]'); if (!b) return;
  const only = b.dataset.judges === 'trainees';
  const list = $('#judgeList'); if (list) list.classList.toggle('trainees-only', only);
  $$('[data-judges]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  try { localStorage.setItem('jl.adminTraineesOnly', only ? '1' : '0'); } catch (e) { /* storage off */ }
});
function adminPersonHtml(out) {
  const st = out.progress.stage;
  let html = `<div class="card"><b class="who-name">${esc(out.person.name)}</b><div class="who-status"><span class="who-level">${esc(levelName(out.person.level))}</span> <span class="pill ${out.person.status === 'Active' ? 'ok' : out.person.status === 'Resigned' ? 'bad' : 'warn'}">${esc(out.person.status)}</span></div></div>`;
  if (!st) return html + `<div class="card"><p>Not currently training. To start their training, change their Level in the master sheet (for example to "Nov Trainee").</p></div><div class="actions"><a class="btn ghost block" href="#admin">Back to all judges</a></div>`;
  const stages = [st.firstGroup || (st.name === 'SWI' ? st.group : null), st.secondGroup || (st.name === 'second' ? st.group : null)].filter(Boolean);
  stages.forEach((g, idx) => {
    const grid = out.progress.grid[g]; if (!grid) return;
    const isSwi = g.startsWith('SWI');
    const current = g === st.group;
    const slots = Math.max(...TRAINING_ELEMENTS.map((el) => grid[el].length));
    let sets = 0;
    for (let n = 1; n <= slots; n++) if (TRAINING_ELEMENTS.some((el) => grid[el][n - 1] && grid[el][n - 1][0] !== 'na' && !grid[el][n - 1][4])) sets = n;
    const title = isSwi ? `Stewarding with Intent – ${st.trainingLevel}` : stageTitle(Object.assign({}, st, { kinds: kindsForOption(st.option) }), g);
    html += `<div class="card prog"><h3>${idx + 1}. ${esc(title)}${current ? ' <span class="pill ok">Current stage</span>' : ''}</h3>`;
    html += `<div class="setsrow"><span>Sets required<span class="hint">One set = Interior, Exterior, Container and Vehicle</span></span><b>${sets}</b></div>`;
    html += TRAINING_ELEMENTS.map((el) => `<div class="prow"><span class="el">${esc(el)}</span><span class="dots">` +
      grid[el].map((c, i) => [c, i]).filter(([c, i]) => (i < sets && c[0] !== 'na') || c[4]).map(([c, i]) => {
        const label = `${el} ${i + 1}: ${c[4] ? 'Extra – ' : ''}${DOT_LABEL[c[0]]}${c[1] ? ' – ' + c[1] : ''}${categoryOf(g, c) ? ' (' + categoryOf(g, c) + ')' : ''}`;
        const dot = `<span class="dot ${c[0]}${c[4] ? ' extra' : ''}" title="${esc(label)}" role="img" aria-label="${esc(label)}"></span>`;
        return c[2] ? `<a href="#review/${encodeURIComponent(c[2])}" class="dotlink">${dot}</a>` : dot;
      }).join('') + `</span></div>`).join('');
    if (!isSwi && st.trainingLevel !== 'Novice') html += `<p class="small muted signoff">${out.person.canBeMentored ? 'Approved for Probationary or Mentoring.' : 'Probationary only.'}</p>`;
    html += stageSignoffHtml(st, isSwi) + `</div>`;
  });
  html += signoffsHtml(out.progress);
  if (out.masterUrl) html += `<div class="actions"><a class="btn block" target="_blank" rel="noopener" href="${esc(out.masterUrl)}">Open their row in the master sheet</a></div>
    <p class="small muted">Make all changes in Judges and Trials (master): "-" = not required, "Waived" = waived, a date in "Date SWI's Approved" opens the next stage, a date in "Date Promoted" when they pass. Then change their Level.</p>`;
  html += appointmentsHtml(out.person && out.appointments ? { appointments: out.appointments } : null, true);
  html += reportsHtml(out.records, out.person.email);
  if (out.records.length) html += `<h2>Training records</h2><div class="card">${out.records.map((r) => recordRow(r, `#review/${encodeURIComponent(r.id)}`)).join('')}</div>`;
  html += `<div class="actions"><a class="btn ghost block" href="#admin">Back to all judges</a></div>`;
  return html;
}
/* Any "Sync now" button inside these screens. */
document.addEventListener('click', (ev) => { if (ev.target.closest('[data-sync]')) syncNow(); });

