/* SSANZ Judge Log — runs entirely in the judge's browser.
 * Entries are kept on the phone (localStorage) and written to the judge's own
 * Judging Record (Google Sheet) when they tap Sync. Scope: drive.file only, so the
 * app can see just the spreadsheet the judge picks. */
'use strict';

const CONFIG = {
  clientId: '533170210383-h3he3p3qp3vbhfg8i98878fi7p3hk3o0.apps.googleusercontent.com',
  apiKey: 'AIzaSyDzWopanHu4jc-3-sAsvfBq6kipJ5zWimw',
  appId: '533170210383',
  scope: 'https://www.googleapis.com/auth/drive.file openid email',
  // Web app address of the JDSC helper script (Deploy > Web app URL). Training records need it.
  apiUrl: 'https://script.google.com/macros/s/AKfycbywCXEqURDAO11M8BgMQ41gxIOAgjFokbFJItgp0q27XqFMa--86rNu3JR1hz3l_iIK-Q/exec',
  jdsc: 'ssanzjdsubcommittee@gmail.com',
  tabs: ['SSANZ', 'Dogs NZ', 'Other', 'Training'],
  trainingTab: 'Training',
};

/* ---------- storage ---------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('jl.' + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('jl.' + key, JSON.stringify(value)); return true; }
    catch (e) { toast('Could not save on this phone — storage may be full.'); return false; }
  },
};
const settings = () => store.get('settings', {});
const saveSettings = (patch) => store.set('settings', Object.assign(settings(), patch));
const entries = () => store.get('entries', []);
const saveEntries = (list) => store.set('entries', list);

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const nzDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || ''); };
const isoDate = (v) => {
  v = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); if (m) return m[0];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- chips (tap-to-pick boxes) ---------- */
function buildChips(root = document) {
  $$('[data-chips]', root).forEach((box, n) => {
    if (box.dataset.built) return;
    const form = box.closest('form');
    const name = box.dataset.chips;
    const prefix = (form ? form.getAttribute('id') : 'x') + '-' + name + '-' + n;
    box.innerHTML = box.dataset.options.split('|').map((opt, i) =>
      `<input type="radio" name="${esc(name)}" id="${prefix}-${i}" value="${esc(opt)}"${opt === box.dataset.default ? ' checked' : ''}>` +
      `<label for="${prefix}-${i}">${esc(opt)}</label>`).join('');
    box.dataset.built = '1';
    box.addEventListener('change', (ev) => {
      const v = ev.target.value;
      if (box.dataset.fill) { const f = document.getElementById(box.dataset.fill); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); }
      if (name === 'element' && form) {
        const other = form.querySelector('[name=elementOther]');
        if (other) { other.hidden = v !== 'Other'; if (v === 'Other') other.focus(); }
      }
    });
  });
}
function chipValue(form, name) { const c = form.querySelector(`input[name="${name}"]:checked`); return c ? c.value : ''; }
function setChip(form, name, value) {
  const inputs = $$(`input[name="${name}"]`, form);
  inputs.forEach((i) => { i.checked = i.value === value; });
  return inputs.some((i) => i.checked);
}
function elementValue(form) {
  const v = chipValue(form, 'element');
  return v === 'Other' ? (form.elementOther.value.trim() || 'Other') : v;
}
function setElement(form, value) {
  const other = form.querySelector('[name=elementOther]');
  if (!value) { setChip(form, 'element', ''); if (other) other.hidden = true; return; }
  if (setChip(form, 'element', value)) { if (other) other.hidden = true; return; }
  setChip(form, 'element', 'Other'); if (other) { other.hidden = false; other.value = value; }
}

/* ---------- voice for reflections / comments ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function addVoice(root = document) {
  $$('textarea[data-voice]', root).forEach((ta) => {
    if (ta.dataset.voiceBuilt) return; ta.dataset.voiceBuilt = '1';
    const hint = document.createElement('p'); hint.className = 'small muted';
    if (!SR) {
      hint.textContent = 'To speak instead of typing, tap the microphone on your keyboard.';
      ta.after(hint); return;
    }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn ghost small mic'; btn.textContent = '🎤 Speak';
    hint.textContent = 'No signal? The microphone on your keyboard may still work.';
    ta.after(btn); btn.after(hint);
    let rec = null;
    btn.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'en-NZ'; rec.continuous = true; rec.interimResults = false;
      rec.onresult = (ev) => {
        let text = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) text += ev.results[i][0].transcript;
        if (!text) return;
        text = text.trim(); text = text.charAt(0).toUpperCase() + text.slice(1);
        ta.value = (ta.value && !/\s$/.test(ta.value) ? ta.value + ' ' : ta.value) + text + (/[.!?]$/.test(text) ? ' ' : '. ');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rec.onerror = (ev) => {
        if (ev.error === 'network') toast('Voice needs signal here. Try the microphone on your keyboard.');
        else if (ev.error === 'not-allowed') toast('Microphone access was blocked. Allow it in your browser settings.');
      };
      rec.onend = () => { rec = null; btn.classList.remove('on'); btn.textContent = '🎤 Speak'; };
      try { rec.start(); btn.classList.add('on'); btn.textContent = '■ Stop'; } catch (e) { rec = null; }
    });
  });
}

/* ---------- views ---------- */
const TITLES = {
  home: 'SSANZ Judge Log', settings: 'My details', log: 'Log a search', record: 'My record', training: 'My training',
  todo: 'To do', review: 'Training record', admin: 'JDSC admin', report: 'Training report',
};
function route() {
  const [view, arg] = (location.hash.replace(/^#/, '') || 'home').split('/');
  const name = TITLES[view] ? view : 'home';
  $$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== name; });
  $('#backBtn').hidden = name === 'home';
  // On a judge's admin page, the top button goes back to the full judges list.
  const toList = name === 'admin' && !!arg;
  $('#backBtn').dataset.to = toList ? 'admin' : 'home';
  $('#backBtn').textContent = toList ? '‹ All judges' : '‹ Home';
  $('#backBtn').setAttribute('aria-label', toList ? 'Back to all judges' : 'Back to home');
  $('#pageTitle').innerHTML = name === 'home'
    ? 'SSANZ Judge Log<small>Judges Development Sub-Committee</small>' : esc(TITLES[name]);
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'settings') renderSettings();
  if (name === 'log') openLogForm(arg);
  if (name === 'record') renderRecord();
  if (name === 'training') renderTraining();
  if (name === 'todo') renderTodo();
  if (name === 'review') renderReview(arg);
  if (name === 'report') renderReport(arg);
  if (name === 'admin') renderAdmin(arg ? decodeURIComponent(arg) : '');
}

/* ---------- the JDSC account ----------
 * The JDSC Gmail is an admin account, not a judge: it has no Judging Record,
 * so the app doesn't ask it to choose one or show judge-only screens. */
const isJdscEmail = (e) => String(e || '').trim().toLowerCase() === CONFIG.jdsc;
function isJdscAccount() {
  const me = store.get('me', null);
  return !!((me && (me.isAdmin || isJdscEmail(me.email))) || isJdscEmail(signedInEmail) || isJdscEmail(settings().email));
}
function signOutGoogle() {
  if (accessToken && window.google) google.accounts.oauth2.revoke(accessToken, () => {});
  clearToken(); signedInEmail = ''; store.set('me', null);
  const s = settings();
  // If the JDSC address was typed into My details, take it out again.
  if (isJdscEmail(s.email)) saveSettings({ email: '', consented2: false }); else saveSettings({ consented2: false });
  // ...and the committee's name, if it was typed in as "your name".
  if (/judges development|\bjdsc\b/i.test(settings().name || '')) saveSettings({ name: '' });
}
/* ---------- home ---------- */
function pendingCount() {
  const fileId = settings().fileId;
  return entries().filter((e) => (TRAINING_FORMS[e.kind] && CONFIG.apiUrl && (!e.sent || e.changed)) || (fileId && e.status !== 'synced') || (!fileId && !TRAINING_FORMS[e.kind])).length;
}
/* Who is using the app, and their status from the SSANZ judges list (judges.js).
 * Matched on the email in My details first, then on the name. */
async function judgeCode(text) {
  const norm = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!norm || !(window.crypto && crypto.subtle)) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ssanz-judge-log|' + norm));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
async function findJudge(s) {
  if (typeof JUDGES === 'undefined') return null;
  const e = await judgeCode(s.email), n = await judgeCode(s.name);
  return (e && JUDGES.find((j) => j.e === e)) || (n && JUDGES.find((j) => j.n === n)) || null;
}
/* Opening page: who the judge is and their current level.
 * Uses the live JDSC record for the Google account they signed in with, if we have it,
 * otherwise the judges list on the phone (matched on My details). */
async function renderWho() {
  const box = $('#homeWho'); const s = settings();
  if (!box) return;
  const me = store.get('me', null);
  const live = me && me.person && me.person.level ? me.person : null;
  const j = live ? null : await findJudge(s);
  const name = (live && live.name) || s.name;
  const level = live ? live.level : j && j.l;
  const st = live ? live.status : j && j.s;
  if (!name && !level) { box.innerHTML = ''; return; }
  let body;
  if (level) {
    const lv = typeof levelName === 'function' ? levelName(level) : level;
    const cls = st === 'Active' ? 'ok' : st === 'Resigned' ? 'bad' : 'warn';
    body = `<div class="who-current"><span class="muted small">Current level</span><span class="who-level">${esc(lv)}</span></div>` +
      `<div class="who-status">${st ? `<span class="pill ${cls}">${esc(st)}</span>` : ''}` +
      ((j && j.m) || (live && live.canBeMentored) ? ` <span class="pill">Can be mentored</span>` : '') + `</div>`;
  } else {
    body = `<div class="who-status"><span class="muted small">Not found on the SSANZ judges list. Check your name and email under <a href="#settings">My details</a>, or ask the JDSC.</span></div>`;
  }
  const asAt = live ? `From the JDSC records, updated ${new Date(me.at).toLocaleDateString('en-NZ', { dateStyle: 'medium' })}`
    : j && typeof JUDGES_AS_AT !== 'undefined' ? `Judges list as at ${esc(JUDGES_AS_AT)}` : '';
  box.innerHTML = `<div class="card who"><b class="who-name">${esc(name || '')}</b>${body}` +
    (asAt ? `<div class="muted tiny">${asAt}</div>` : '') + `</div>`;
}

function renderHome() {
  const s = settings(); const n = pendingCount();
  const jdsc = isJdscAccount();
  ['#logTile', '#recordTile', '#concernTile', '#syncBtnHome', '#detailsBtnHome'].forEach((id) => { $(id).hidden = jdsc; });
  $('#jdscSignOutHome').hidden = !jdsc;
  $('#adminTile').classList.toggle('primary', jdsc);
  renderHomeTodo();
  if (jdsc) {
    $('#trainingTile').hidden = true;
    $('#homeWho').innerHTML = '';
    $('#homeStatus').innerHTML = n
      ? `<div class="status warn"><span class="grow">Your own judging entries are safe on this phone. Sign out of the JDSC account to get back to them.</span></div>` : '';
    return;
  }
  renderWho(); renderTrainingTile();
  let html = '';
  if (!s.name) html += `<div class="status warn"><span class="grow">Welcome! Start by adding your name and choosing your Judging Record.</span><a class="btn small" href="#settings">Set up</a></div>`;
  else if (!s.fileId) html += `<div class="status warn"><span class="grow">Choose your Judging Record so entries can be saved to it.</span><a class="btn small" href="#settings">Choose</a></div>`;
  if (n) html += `<div class="status warn"><span class="grow"><b>${n}</b> ${n === 1 ? 'entry is' : 'entries are'} saved on this phone and waiting to sync.</span></div>`;
  else if (s.fileId && s.lastSync) html += `<div class="status ok"><span class="grow">Everything is synced to your Judging Record.</span></div>`;
  if (!navigator.onLine) html += `<div class="status warn"><span class="grow">No signal right now. You can keep logging; sync later.</span></div>`;
  $('#homeStatus').innerHTML = html;
}

/* ---------- settings ---------- */
function renderSettings() {
  const s = settings();
  $('#setName').value = s.name || ''; $('#setEmail').value = s.email || ''; $('#setMember').value = s.membership || '';
  $('#signedInAs').textContent = signedInEmail ? `Signed in to Google as ${signedInEmail}.` : '';
  $('#recordCard').innerHTML = s.fileId
    ? `<b>${esc(s.fileName || 'Judging Record')}</b><p class="small muted">Entries are written to this spreadsheet.</p>
       <a class="small" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(s.fileId)}/edit">Open in Google Sheets</a>`
    : `<p>Not chosen yet. Tap the button below, sign in with the Google account your Judging Record is in, then pick your Judging Record.</p>`;
  $('#chooseRecord').textContent = s.fileId ? 'Choose a different Judging Record' : 'Choose my Judging Record';
  $('#signOut').hidden = !accessToken;
  const jdsc = isJdscAccount();
  $('#chooseRecord').hidden = jdsc;
  if (jdsc) {
    $('#recordCard').innerHTML = `<p>You're signed in with the JDSC account. It's an admin account, so it doesn't have a Judging Record.</p>
      <p class="small muted">To log your own searches, sign out of the JDSC account and sign in with your own Google account.</p>`;
    $('#signOut').hidden = false; $('#signOut').textContent = 'Sign out of the JDSC account';
  } else $('#signOut').textContent = 'Sign out of Google on this phone';
}

/* ---------- Google sign-in and file picker ---------- */
let signedInEmail = '';
let accessToken = null, tokenExpiry = 0, tokenClient = null, pendingTokenResolve = null, pendingTokenReject = null;
/* Keep the Google sign-in on this phone until it expires (about an hour), so reopening the app
 * or reloading the page doesn't ask again. */
function keepToken(token, expiry) {
  accessToken = token; tokenExpiry = expiry;
  try { localStorage.setItem('jl.tok', JSON.stringify({ t: token, x: expiry })); } catch (e) { /* storage off */ }
}
function clearToken() {
  accessToken = null; tokenExpiry = 0;
  try { localStorage.removeItem('jl.tok'); } catch (e) { /* storage off */ }
}
try {
  const kept = JSON.parse(localStorage.getItem('jl.tok') || 'null');
  if (kept && kept.t && kept.x > Date.now()) { accessToken = kept.t; tokenExpiry = kept.x; }
} catch (e) { /* nothing kept */ }
let gisReady = false, pickerReady = false;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
function loadGoogle() {
  if (!navigator.onLine) return;
  loadScript('https://accounts.google.com/gsi/client').then(() => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.clientId, scope: CONFIG.scope,
      callback: (resp) => {
        if (resp.error) { if (pendingTokenReject) pendingTokenReject(new Error(resp.error)); }
        else {
          keepToken(resp.access_token, Date.now() + (resp.expires_in - 60) * 1000);
          saveSettings({ consented2: true });
          if (pendingTokenResolve) pendingTokenResolve(accessToken);
        }
        pendingTokenResolve = pendingTokenReject = null;
      },
      error_callback: (err) => { if (pendingTokenReject) pendingTokenReject(new Error(err.type || 'popup_closed')); pendingTokenResolve = pendingTokenReject = null; },
    });
    gisReady = true;
  }).catch(() => {});
  loadScript('https://apis.google.com/js/api.js').then(() => {
    gapi.load('picker', () => { pickerReady = true; });
  }).catch(() => {});
}
/* Must be called straight from a tap, so phones allow the sign-in pop-up. */
function getToken(opts = {}) {
  if (!opts.chooseAccount && accessToken && Date.now() < tokenExpiry) return Promise.resolve(accessToken);
  if (!navigator.onLine) return Promise.reject(new Error('offline'));
  const ask = () => new Promise((resolve, reject) => {
    pendingTokenResolve = resolve; pendingTokenReject = reject;
    const s = settings();
    if (opts.chooseAccount) { clearToken(); signedInEmail = ''; }
    // On the JDSC account, always point Google at the JDSC Gmail (not the judge's own email in My details).
    const hint = opts.hint || (isJdscAccount() ? CONFIG.jdsc : s.email) || undefined;
    tokenClient.requestAccessToken({ prompt: opts.chooseAccount ? 'select_account' : (s.consented2 ? '' : 'consent'), login_hint: hint });
  });
  if (gisReady) return ask();
  // Google's sign-in code is still loading: wait a moment (up to 3 seconds) instead of failing the first tap.
  loadGoogle();
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (gisReady) { ask().then(resolve, reject); return; }
      if (Date.now() - start > 3000) { reject(new Error('loading')); return; }
      setTimeout(tick, 100);
    };
    tick();
  });
}
function explainTokenError(e) {
  if (e.message === 'offline') toast('No signal. Your entries are safe on this phone; sync when you have signal.');
  else if (e.message === 'loading') toast('Connecting to Google… tap again in a moment.');
  else if (/popup/.test(e.message)) toast('The Google sign-in window was closed or blocked. Tap again and allow pop-ups.');
  else toast('Google sign-in didn\'t finish (' + e.message + ').');
}

function choosePicker() {
  if (isJdscAccount()) { toast('The JDSC account doesn\'t have a Judging Record. Sign out of it first.', 5000); return; }
  getToken().then((token) => {
    if (!pickerReady) { toast('Connecting to Google… tap again in a moment.'); return; }
    const P = google.picker;
    const mine = new P.DocsView(P.ViewId.SPREADSHEETS).setMode(P.DocsViewMode.LIST).setQuery('Judging Record');
    const shared = new P.DocsView(P.ViewId.SPREADSHEETS).setMode(P.DocsViewMode.LIST).setOwnedByMe(false);
    const all = new P.DocsView(P.ViewId.SPREADSHEETS).setMode(P.DocsViewMode.LIST);
    new P.PickerBuilder()
      .setTitle('Choose your Judging Record')
      .addView(mine).addView(shared).addView(all)
      .setOAuthToken(token).setDeveloperKey(CONFIG.apiKey).setAppId(CONFIG.appId)
      .setCallback((data) => {
        if (data.action !== P.Action.PICKED) return;
        const doc = data.docs[0];
        checkRecord(doc.id).then((tabs) => {
          saveSettings({ fileId: doc.id, fileName: doc.name, tabs });
          store.set('history', {});
          toast('Judging Record connected.');
          renderSettings(); renderHome();
          if (pendingCount()) syncNow();
        }).catch((e) => toast(e.message, 6000));
      })
      .build().setVisible(true);
  }).catch(explainTokenError);
}

/* ---------- Sheets API ---------- */
async function api(path, opts = {}) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + path, {
    method: opts.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + accessToken }, opts.body ? { 'Content-Type': 'application/json' } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.ok) return res.json();
  let msg = ''; try { msg = (await res.json()).error.message; } catch (e) { /* ignore */ }
  if (res.status === 401) { clearToken(); throw new Error('Google sign-in expired. Tap Sync again.'); }
  if (/has not been used|is disabled/i.test(msg)) throw new Error('The Google Sheets API is not switched on for the Judge Log yet. Please tell the JDSC.');
  if (res.status === 403 || res.status === 404) throw new Error('The Judge Log can\'t open that Judging Record. Choose it again under My details.');
  throw new Error('Google Sheets said: ' + (msg || res.status));
}
const q = (tab) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);

async function checkRecord(fileId) {
  const meta = await api(`${fileId}?fields=sheets.properties(sheetId,title,gridProperties)`);
  const titles = meta.sheets.map((s) => s.properties.title);
  const tabs = CONFIG.tabs.filter((t) => titles.includes(t));
  if (!tabs.includes('SSANZ')) throw new Error('That spreadsheet has no "SSANZ" tab. Is it your Judging Record?');
  const head = await api(`${fileId}/values/${q('SSANZ')}!A1:L1`);
  const h = (head.values && head.values[0]) || [];
  if (h[0] !== 'Date' || h[6] !== 'Teams') throw new Error('That spreadsheet doesn\'t look like a Judging Record (row 1 should start "Date, Host Organisation…").');
  return tabs;
}

const textCell = (v) => { v = String(v || ''); return /^[=+\-@]/.test(v) ? "'" + v : v; };
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const TRAINING_HEADER = ['Date', 'Host Organisation', 'Trial Location', 'Who Set the Hide(s)?', 'Level', 'Element', 'Teams',
  'Passes *', 'Pass Rate', 'Photo/Video Link', 'Reflections', 'Training Type', 'Supervising Judge'];
async function addTrainingTab(fileId) {
  const res = await api(`${fileId}:batchUpdate`, { method: 'POST', body: { requests: [{ addSheet: { properties: {
    title: CONFIG.trainingTab, gridProperties: { rowCount: 200, columnCount: 13, frozenRowCount: 1 } } } }] } });
  await api(`${fileId}/values/${q(CONFIG.trainingTab)}!A1:M1?valueInputOption=RAW`, { method: 'PUT', body: { values: [TRAINING_HEADER] } });
  const sheetId = res.replies[0].addSheet.properties.sheetId;
  await api(`${fileId}:batchUpdate`, { method: 'POST', body: { requests: [{ repeatCell: {
    range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }] } });
  return res.replies[0].addSheet.properties;
}

async function syncTab(fileId, tab, list, sheetProps) {
  const training = tab === CONFIG.trainingTab;
  const rowCount = sheetProps.gridProperties.rowCount;
  const got = await api(`${fileId}/values/${q(tab)}!A1:M${rowCount}?valueRenderOption=FORMULA`);
  const rows = got.values || [];
  let last = 0; // last row (1-based) with data the judge typed
  const typed = training ? [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12] : [0, 1, 2, 3, 4, 5, 6, 7, 9, 10];
  rows.forEach((r, i) => { if (i > 0 && typed.some((c) => r[c] !== undefined && r[c] !== '')) last = i + 1; });
  let next = Math.max(last + 1, 2);

  const data = []; const done = [];
  for (const e of list) {
    // Already written on an earlier sync whose reply was lost? Don't add it twice.
    const dup = rows.findIndex((r, i) => i > 0 && same(r[1], e.host) && same(r[4], e.level) && same(r[5], e.element) &&
      String(r[6] ?? '') === String(e.teams) && String(r[7] ?? '') === String(e.passes) && same(r[10], e.reflections) &&
      (!training || same(r[11], e.kind)));
    if (dup > 0) { done.push([e, dup + 1]); continue; }
    const r = next++;
    const existing = rows[r - 1] || [];
    const num = (v) => (v === '' || v == null ? '' : Number(v));
    data.push({ range: `'${tab}'!A${r}:H${r}`, values: [[e.date, textCell(e.host), textCell(e.location), textCell(e.setter), e.level, textCell(e.element), num(e.teams), num(e.passes)]] });
    data.push({ range: `'${tab}'!J${r}:K${r}`, values: [[textCell(e.video), textCell(e.reflections)]] });
    if (training) {
      data.push({ range: `'${tab}'!L${r}:M${r}`, values: [[e.kind, textCell(e.supervisor)]] });
      data.push({ range: `'${tab}'!I${r}`, values: [[`=IF(AND(ISNUMBER(G${r}),G${r}>0,ISNUMBER(H${r})),H${r}/G${r},"")`]] });
    } else {
      if (!existing[8]) data.push({ range: `'${tab}'!I${r}`, values: [[`=(H${r}/G${r})`]] });
      if (!existing[11]) data.push({ range: `'${tab}'!L${r}`, values: [[r === 2 ? '=I2' : `=AVERAGE($I$2:I${r})`]] });
    }
    done.push([e, r]);
  }
  const needRows = next - 1 - rowCount;
  if (needRows > 0) {
    await api(`${fileId}:batchUpdate`, { method: 'POST', body: { requests: [{ appendDimension: { sheetId: sheetProps.sheetId, dimension: 'ROWS', length: needRows + 20 } }] } });
  }
  if (data.length) await api(`${fileId}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data } });
  return done;
}

async function fetchHistory(fileId, tabs) {
  const ranges = tabs.map((t) => 'ranges=' + q(t) + '!A2:M').join('&');
  const got = await api(`${fileId}/values:batchGet?${ranges}`);
  const history = {};
  got.valueRanges.forEach((vr, i) => {
    history[tabs[i]] = (vr.values || []).map((r, j) => ({ row: j + 2, r })).filter((x) => x.r[0]);
  });
  store.set('history', history); saveSettings({ historyAt: Date.now() });
  return history;
}

let syncing = false;
/* Sync: send training records to supervisors, write searches to the Judging Record, refresh To do and progress.
 * Must start from a tap, so the Google sign-in pop-up is allowed. */
function syncNow() {
  const s = settings();
  if (!s.fileId && !CONFIG.apiUrl) { toast('Choose your Judging Record first.'); location.hash = 'settings'; return; }
  if (syncing) return;
  getToken().then(async () => {
    syncing = true; setSyncButtons('Syncing…');
    const notes = [];
    try {
      if (CONFIG.apiUrl) {
        const sent = await sendTrainingRecords();
        if (sent) notes.push(`${sent} training record${sent > 1 ? 's' : ''} sent to your supervisor`);
      }
      if (s.fileId) {
        const meta = await api(`${s.fileId}?fields=sheets.properties(sheetId,title,gridProperties)`);
        const props = {}; meta.sheets.forEach((sh) => { props[sh.properties.title] = sh.properties; });
        const tabs = CONFIG.tabs.filter((t) => props[t]);
        const pending = entries().filter((e) => e.status !== 'synced');
        let written = 0;
        if (pending.some((e) => e.tab === CONFIG.trainingTab) && !props[CONFIG.trainingTab]) {
          props[CONFIG.trainingTab] = await addTrainingTab(s.fileId);
          tabs.push(CONFIG.trainingTab);
        }
        for (const tab of new Set(pending.map((e) => e.tab))) {
          if (!props[tab]) { toast(`Your Judging Record has no "${tab}" tab — those entries are still on this phone.`, 6000); continue; }
          const done = await syncTab(s.fileId, tab, pending.filter((e) => e.tab === tab), props[tab]);
          const list = entries();
          done.forEach(([e, row]) => { const x = list.find((y) => y.id === e.id); if (x) { x.status = 'synced'; x.row = row; } });
          saveEntries(list); written += done.length;
        }
        await fetchHistory(s.fileId, tabs);
        saveSettings({ lastSync: Date.now(), tabs });
        if (written) notes.push(`${written} ${written === 1 ? 'entry' : 'entries'} added to your Judging Record`);
      }
      // Keep the phone tidy: forget entries once they're in the sheet (and, for training, sent to the supervisor).
      saveEntries(entries().filter((e) => e.status !== 'synced' || (TRAINING_FORMS[e.kind] && CONFIG.apiUrl && !e.sent)));
      if (CONFIG.apiUrl) await refreshMe();
      toast(notes.length ? notes.join('. ') + '.' : 'Everything is up to date.', 5000);
    } catch (e) {
      toast(e.message, 6000);
    } finally {
      syncing = false; setSyncButtons(); renderHome();
      if (!$('[data-view=record]').hidden) renderRecord();
      if (!$('[data-view=training]').hidden) renderTraining();
    }
  }).catch(explainTokenError);
}
function setSyncButtons(label) {
  $('#syncBtnHome').textContent = label || 'Sync now';
  $('#syncBtnRecord').textContent = label || 'Sync and refresh';
  $('#syncBtnHome').disabled = $('#syncBtnRecord').disabled = !!label;
}

/* ---------- log form ---------- */
const logForm = () => $('#logForm');
function fillDatalists() {
  const hist = store.get('history', {});
  const hosts = new Set(), locs = new Set();
  Object.values(hist).flat().forEach((x) => { if (x.r[1]) hosts.add(x.r[1]); if (x.r[2]) locs.add(x.r[2]); });
  entries().forEach((e) => { if (e.host) hosts.add(e.host); if (e.location) locs.add(e.location); });
  $('#hostList').innerHTML = [...hosts].sort().map((h) => `<option value="${esc(h)}">`).join('');
  $('#locList').innerHTML = [...locs].sort().map((h) => `<option value="${esc(h)}">`).join('');
}
function openLogForm(id) {
  const f = logForm(); fillDatalists();
  const newTraining = id === 'new-training';
  const apptMatch = /^appt-(\d+)$/.exec(id || '');
  const e = id && !newTraining && !apptMatch ? entries().find((x) => x.id === id) : null;
  const draft = !e && !apptMatch && store.get('draft.log', null);
  let v = e || draft || {};
  if (apptMatch) {
    // Pre-fill from an approved appointment in the JDSC's trial list.
    const a = ((cachedMe() || {}).appointments || [])[+apptMatch[1]];
    if (a) v = { kind: a.kind, date: a.date, host: a.host, location: a.venue && a.venue !== 'TBC' ? a.venue : '', level: a.level, element: a.element, supervisor: a.supervisor, extras: {} };
  }
  if (newTraining && (!v.kind || v.kind === 'Judging')) v = Object.assign({}, v, { kind: '' });
  // Only offer the training the JDSC has approved for this stage.
  allowedKinds().then((kinds) => {
    const keep = e ? e.kind : null;
    $$('[data-chips=kind] input', f).forEach((inp) => {
      const show = inp.value === 'Judging' || kinds.includes(inp.value) || inp.value === keep;
      inp.hidden = !show; const lab = f.querySelector(`label[for="${inp.id}"]`); if (lab) lab.hidden = !show;
    });
    if (newTraining && !chipValue(f, 'kind') || (newTraining && chipValue(f, 'kind') === 'Judging' && kinds.length)) { setChip(f, 'kind', kinds[0] || 'Judging'); showKind(); }
  });
  f.reset();
  f.entryId.value = e ? e.id : '';
  setChip(f, 'kind', v.kind || 'Judging');
  setChip(f, 'tab', (v.kind && v.kind !== 'Judging') ? (settings().lastTab || 'SSANZ') : (v.tab || settings().lastTab || 'SSANZ'));
  f.supervisor.value = v.supervisor || '';
  f.date.value = v.date || today();
  ['host', 'location', 'setter', 'teams', 'passes', 'video', 'reflections'].forEach((k) => { f[k].value = v[k] == null ? '' : v[k]; });
  setChip(f, 'level', v.level || ''); setElement(f, v.element || '');
  $('#deleteEntry').hidden = !e || e.sent;
  showKind(v.extras || {}); updateRate();
}
function showKind(values) {
  const f = logForm(); const kind = chipValue(f, 'kind') || 'Judging'; const form = TRAINING_FORMS[kind];
  const training = !!form;
  $('#judgingOnly').hidden = training; $('#trainingOnly').hidden = !training;
  $('#locLabel').textContent = training ? 'Venue' : 'Trial location';
  $('#teamsLabel').textContent = training ? 'Teams entered (E)' : 'Teams';
  $('#passesLabel').innerHTML = training ? 'Sourced in time (S)<span class="hint">Teams that sourced the hide within the time allowed</span>' : 'Passes<span class="hint">Correct calls on all hides in time</span>';
  $('#reflLabel').textContent = training ? 'Trainee learning / reflections' : 'Reflections';
  $('#fSup').previousElementSibling.textContent = form ? form.supervisorTitle : 'Supervising judge';
  const box = $('#trainingExtras');
  const keep = values || readExtras();
  box.hidden = !form || !form.traineeExtras.length;
  box.innerHTML = form ? form.traineeExtras.map(([key, label, type, hint]) => {
    const h = hint ? `<span class="hint">${esc(hint)}</span>` : '';
    const v = keep[key] == null ? '' : keep[key];
    if (type === 'tick') return `<label class="tick inline"><input type="checkbox" data-x="${key}"${v ? ' checked' : ''}><span><b>${esc(label)}</b></span></label>`;
    if (type === 'number') return `<label class="f" for="x_${key}">${esc(label)}</label><input type="number" inputmode="numeric" min="0" id="x_${key}" data-x="${key}" value="${esc(v)}">`;
    if (type.startsWith('chips:')) return `<label class="f">${esc(label)}${h}</label><div class="chips">${type.slice(6).split('|').map((o, i) =>
      `<input type="radio" name="x_${key}" id="x_${key}_${i}" data-x="${key}" value="${esc(o)}"${v === o ? ' checked' : ''}><label for="x_${key}_${i}">${esc(o)}</label>`).join('')}</div>`;
    return `<label class="f" for="x_${key}">${esc(label)}${h}</label><textarea id="x_${key}" data-x="${key}" data-voice>${esc(v)}</textarea>`;
  }).join('') : '';
  addVoice(box);
}
function readExtras() {
  const out = {};
  $$('#trainingExtras [data-x]').forEach((el) => {
    const k = el.dataset.x;
    if (el.type === 'checkbox') out[k] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[k] = el.value; }
    else out[k] = el.value.trim();
  });
  return out;
}
/* Supervising judge suggestions: active judges only (status from the SSANZ judges list). */
async function fillSupervisors() {
  const names = typeof JUDGE_NAMES !== 'undefined' ? JUDGE_NAMES : [];
  const active = [];
  for (const n of names) {
    const code = await judgeCode(n);
    const j = typeof JUDGES !== 'undefined' && JUDGES.find((x) => x.n === code);
    if (j && j.s === 'Active') active.push(n);
  }
  $('#supList').innerHTML = active.map((n) => `<option value="${esc(n)}">`).join('');
}
function readLogForm() {
  const f = logForm();
  const kind = chipValue(f, 'kind') || 'Judging';
  return {
    id: f.entryId.value || uid(), kind, tab: kind === 'Judging' ? (chipValue(f, 'tab') || 'SSANZ') : CONFIG.trainingTab,
    supervisor: kind === 'Judging' ? '' : f.supervisor.value.trim(), extras: kind === 'Judging' ? {} : readExtras(), date: f.date.value, host: f.host.value.trim(), location: f.location.value.trim(),
    setter: f.setter.value.trim(), level: chipValue(f, 'level'), element: elementValue(f), teams: f.teams.value, passes: f.passes.value,
    video: f.video.value.trim(), reflections: f.reflections.value.trim(),
  };
}
function updateRate() {
  const f = logForm(); const t = +f.teams.value, p = +f.passes.value;
  let note = '';
  if (t > 0 && f.passes.value !== '') note = p > t ? 'Passes can\'t be more than teams.' : `Pass rate ${Math.round((p / t) * 100)}%`;
  $('#rateNote').textContent = note;
}

/* ---------- record view ---------- */
let recordItems = [];
function renderRecord() {
  const s = settings(); const f = $('[data-view=record]');
  buildChips(f);
  const tab = chipValue(f, 'recordTab') || 'SSANZ';
  const hist = (store.get('history', {})[tab]) || [];
  const pend = entries().filter((e) => e.tab === tab && e.status !== 'synced');
  let status = '';
  if (!s.fileId) status = `<div class="status warn"><span class="grow">Choose your Judging Record to see your history.</span><a class="btn small" href="#settings">Choose</a></div>`;
  else if (s.historyAt) status = `<p class="small muted">Copy from your Judging Record, last refreshed ${new Date(s.historyAt).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })}.</p>`;
  else status = `<p class="small muted">Tap “Sync and refresh” to load your history.</p>`;
  $('#recordStatus').innerHTML = status;

  const isTraining = tab === CONFIG.trainingTab;
  const rates = [], all = hist.map((x) => ({ teams: +x.r[6] || 0, passes: +x.r[7] || 0 }));
  all.forEach((x) => { if (x.teams) rates.push(x.passes / x.teams); });
  const teams = all.reduce((a, x) => a + x.teams, 0);
  const avg = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) + '%' : '–';
  $('#recordStats').innerHTML =
    `<div class="stat"><b>${hist.length}</b><span>${isTraining ? 'Training searches' : 'Searches judged'}</span></div>` +
    `<div class="stat"><b>${teams}</b><span>Teams</span></div>` +
    `<div class="stat"><b>${avg}</b><span>Average pass rate</span></div>`;

  const rowHtml = (d) => `<div class="entry">
      <div class="top"><span>${d.kind && d.kind !== 'Judging' ? esc(d.kind) + ': ' : ''}${esc(d.level)} ${esc(d.element)}</span><span>${esc(d.dateText)}</span></div>
      <div class="meta">${esc([d.host, d.location].filter(Boolean).join(' · '))}${d.teams !== '' ? ` · ${d.passes !== '' ? esc(d.passes) + '/' + esc(d.teams) + ' passed' : esc(d.teams) + ' teams'}` : ''}${d.setter ? ` · Hides: ${esc(d.setter)}` : ''}${d.supervisor ? ` · Supervising judge: ${esc(d.supervisor)}` : ''}</div>
      ${d.video ? `<div class="small"><a href="${esc(d.video)}" target="_blank" rel="noopener">Video</a></div>` : ''}
      ${d.reflections ? `<div class="refl">${esc(d.reflections)}</div>` : ''}
      ${d.pending ? `<div style="margin-top:8px"><span class="pill">Waiting to sync</span> <a class="small" href="#log/${esc(d.id)}">Edit</a></div>` : ''}
      ${d.kind && d.kind !== 'Judging' ? `<div style="margin-top:8px"><a class="small" href="#training">See supervisor comments in My training</a></div>` : ''}
    </div>`;
  const items = pend.map((e) => ({ ...e, dateText: nzDate(e.date), pending: true }))
    .concat(hist.slice().reverse().map((x) => ({ date: isoDate(x.r[0]), dateText: x.r[0], host: x.r[1], location: x.r[2], setter: x.r[3], level: x.r[4], element: x.r[5], teams: x.r[6] ?? '', passes: x.r[7] ?? '', video: /^https?:/.test(x.r[9] || '') ? x.r[9] : '', reflections: x.r[10],
      kind: isTraining ? (x.r[11] || 'Training') : 'Judging', supervisor: isTraining ? x.r[12] : '' })));
  items.forEach((d, i) => { d.idx = i; });
  recordItems = items;
  $('#recordList').innerHTML = items.length ? items.map(rowHtml).join('') : `<p class="muted">${isTraining ? 'No training searches logged yet.' : 'Nothing here yet.'}</p>`;
  const open = $('#openSheet');
  open.hidden = !s.fileId;
  if (s.fileId) open.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(s.fileId)}/edit`;
}

/* ---------- email helper ---------- */
function mailto(to, cc, subject, body) {
  let url = 'mailto:' + to + '?subject=' + encodeURIComponent(subject);
  if (cc) url += '&cc=' + encodeURIComponent(cc);
  return url + '&body=' + encodeURIComponent(body);
}
/* ---------- drafts (so nothing is lost if the phone closes the app) ---------- */
function draftKey(f) { return 'draft.' + f.getAttribute('id').replace('Form', ''); }
function saveDraft(f) {
  if (f.getAttribute('id') === 'logForm') { if (!f.entryId.value) store.set('draft.log', readLogForm()); return; }
  const d = {};
  Array.from(f.elements).forEach((el) => {
    if (!el.name) return;
    if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
    else if (el.type === 'checkbox') d[el.name] = el.checked;
    else d[el.name] = el.value;
  });
  store.set(draftKey(f), d);
}
function restoreDraft(f) {
  buildChips(f);
  const d = store.get(draftKey(f), null);
  if (!d) { if (f.date && !f.date.value) f.date.value = today(); return; }
  Array.from(f.elements).forEach((el) => {
    if (!el.name || !(el.name in d)) return;
    if (el.type === 'radio') el.checked = d[el.name] === el.value;
    else if (el.type === 'checkbox') el.checked = !!d[el.name];
    else el.value = d[el.name];
  });
  const other = f.querySelector('[name=elementOther]'); if (other) other.hidden = chipValue(f, 'element') !== 'Other';
}
function clearForm(f) {
  f.reset(); localStorage.removeItem('jl.' + draftKey(f));
  const other = f.querySelector('[name=elementOther]'); if (other) other.hidden = true;
  $$('[data-chips][data-default]', f).forEach((box) => setChip(f, box.dataset.chips, box.dataset.default));
  if (f.date) f.date.value = today();
}

/* ---------- wiring ---------- */
document.addEventListener('DOMContentLoaded', () => {
  buildChips(); addVoice();
  fillSupervisors();
  window.addEventListener('hashchange', route);
  $('#backBtn').addEventListener('click', () => { location.hash = $('#backBtn').dataset.to || 'home'; });

  $('#saveDetails').addEventListener('click', () => {
    saveSettings({ name: $('#setName').value.trim(), email: $('#setEmail').value.trim(), membership: $('#setMember').value.trim() });
    toast('Details saved.');
  });
  $('#chooseRecord').addEventListener('click', () => {
    const name = $('#setName').value.trim(), email = $('#setEmail').value.trim();
    if (name || email) saveSettings({ name, email });
    choosePicker();
  });
  $('#signOut').addEventListener('click', () => {
    const wasJdsc = isJdscAccount();
    signOutGoogle(); toast(wasJdsc ? 'Signed out of the JDSC account.' : 'Signed out of Google on this phone.');
    if (wasJdsc) location.hash = 'admin'; else renderSettings();
  });
  $('#jdscSignOutHome').addEventListener('click', () => {
    signOutGoogle(); toast('Signed out of the JDSC account.'); location.hash = 'admin';   // back to the admin sign-in page
  });
  $('#syncBtnHome').addEventListener('click', syncNow);
  $('#syncBtnRecord').addEventListener('click', syncNow);
  $('[data-view=record]').addEventListener('change', (e) => { if (e.target.name === 'recordTab') renderRecord(); });

  const f = logForm();
  f.addEventListener('change', (ev) => { if (ev.target.name === 'kind') showKind(); });
  f.addEventListener('input', () => { updateRate(); saveDraft(f); });
  f.addEventListener('change', () => saveDraft(f));
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const e = readLogForm();
    if (!e.level) { toast('Tap a Level.'); return; }
    if (!e.element) { toast('Tap an Element.'); return; }
    if (e.passes !== '' && +e.passes > +e.teams) { toast('Passes can\'t be more than teams.'); return; }
    if (e.kind === 'Judging' && e.passes === '') { toast('Add the number of passes.'); return; }
    const form = TRAINING_FORMS[e.kind];
    if (form) {
      if (!e.supervisor) { toast(`Add your ${form.supervisorTitle.toLowerCase()}.`); return; }
      if (!form.levels.includes(e.level)) { toast(`${e.kind} is for ${form.levels.join(' or ')} level.`); return; }
      if (!['Interior', 'Exterior', 'Container', 'Vehicle'].includes(e.element)) { toast('Training is recorded for Interior, Exterior, Container or Vehicle.'); return; }
      const old = entries().find((x) => x.id === e.id);
      if (old && old.sent) { e.sent = old.sent; e.changed = true; }
      if (old && old.status === 'synced') e.status = 'synced';
    }
    const list = entries(); const i = list.findIndex((x) => x.id === e.id);
    if (e.status !== 'synced') e.status = 'pending';
    e.savedAt = Date.now();
    if (i >= 0) list[i] = e; else list.push(e);
    if (!saveEntries(list)) return;
    localStorage.removeItem('jl.draft.log');
    if (e.kind === 'Judging') saveSettings({ lastTab: e.tab });
    if (form) toast(navigator.onLine ? `Saved. Tap Sync now to send it to ${e.supervisor}.` : `Saved on this phone. Sync when you have signal to send it to ${e.supervisor}.`, 5000);
    else toast(navigator.onLine && settings().fileId ? 'Saved. Tap Sync now to add it to your Judging Record.' : 'Saved on this phone. Sync when you have signal.');
    location.hash = form ? 'training' : 'home';
  });
  $('#deleteEntry').addEventListener('click', () => {
    const id = f.entryId.value; if (!id || !confirm('Delete this entry from this phone?')) return;
    saveEntries(entries().filter((x) => x.id !== id)); toast('Entry deleted.'); location.hash = 'record';
  });

  window.addEventListener('online', () => { loadGoogle(); renderHome(); });
  window.addEventListener('offline', renderHome);
  loadGoogle();
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});
