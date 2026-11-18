/* SSANZ Judge Log — runs entirely in the judge's browser.
 * Entries are kept on the phone (localStorage) and written to the judge's own
 * Judging Record (Google Sheet) when they tap Sync. Scope: drive.file only, so the
 * app can see just the spreadsheet the judge picks. */
'use strict';

const CONFIG = {
  clientId: '533170210383-h3he3p3qp3vbhfg8i98878fi7p3hk3o0.apps.googleusercontent.com',
  apiKey: 'AIzaSyDzWopanHu4jc-3-sAsvfBq6kipJ5zWimw',
  appId: '533170210383',
  scope: 'https://www.googleapis.com/auth/drive.file',
  jdsc: 'ssanzjdsubcommittee@gmail.com',
  tabs: ['SSANZ', 'Dogs NZ', 'Other'],
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
  home: 'SSANZ Judge Log', settings: 'My details', log: 'Log an appointment', record: 'My record',
  swi: 'Stewarding with Intent', probo: 'Probationary coaching',
};
function route() {
  const [view, arg] = (location.hash.replace(/^#/, '') || 'home').split('/');
  const name = TITLES[view] ? view : 'home';
  $$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== name; });
  $('#backBtn').hidden = name === 'home';
  $('#pageTitle').innerHTML = name === 'home'
    ? 'SSANZ Judge Log<small>Judges Development Sub-Committee</small>' : esc(TITLES[name]);
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'settings') renderSettings();
  if (name === 'log') openLogForm(arg);
  if (name === 'record') renderRecord();
  if (name === 'swi' || name === 'probo') restoreDraft(name === 'swi' ? $('#swiForm') : $('#proboForm'));
}

/* ---------- home ---------- */
function pendingCount() { return entries().filter((e) => e.status !== 'synced').length; }
function renderHome() {
  const s = settings(); const n = pendingCount();
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
  $('#setName').value = s.name || ''; $('#setEmail').value = s.email || '';
  $('#recordCard').innerHTML = s.fileId
    ? `<b>${esc(s.fileName || 'Judging Record')}</b><p class="small muted">Entries are written to this spreadsheet.</p>
       <a class="small" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(s.fileId)}/edit">Open in Google Sheets</a>`
    : `<p>Not chosen yet. Tap the button below, sign in with the Google account your Judging Record is in, then pick your Judging Record.</p>`;
  $('#chooseRecord').textContent = s.fileId ? 'Choose a different Judging Record' : 'Choose my Judging Record';
  $('#signOut').hidden = !accessToken;
}

/* ---------- Google sign-in and file picker ---------- */
let accessToken = null, tokenExpiry = 0, tokenClient = null, pendingTokenResolve = null, pendingTokenReject = null;
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
          accessToken = resp.access_token; tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
          saveSettings({ consented: true });
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
function getToken() {
  if (accessToken && Date.now() < tokenExpiry) return Promise.resolve(accessToken);
  if (!navigator.onLine) return Promise.reject(new Error('offline'));
  if (!gisReady) { loadGoogle(); return Promise.reject(new Error('loading')); }
  return new Promise((resolve, reject) => {
    pendingTokenResolve = resolve; pendingTokenReject = reject;
    const s = settings();
    tokenClient.requestAccessToken({ prompt: s.consented ? '' : 'consent', login_hint: s.email || undefined });
  });
}
function explainTokenError(e) {
  if (e.message === 'offline') toast('No signal. Your entries are safe on this phone; sync when you have signal.');
  else if (e.message === 'loading') toast('Connecting to Google… tap again in a moment.');
  else if (/popup/.test(e.message)) toast('The Google sign-in window was closed or blocked. Tap again and allow pop-ups.');
  else toast('Google sign-in didn\'t finish (' + e.message + ').');
}

function choosePicker() {
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
  if (res.status === 401) { accessToken = null; throw new Error('Google sign-in expired. Tap Sync again.'); }
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

async function syncTab(fileId, tab, list, sheetProps) {
  const rowCount = sheetProps.gridProperties.rowCount;
  const got = await api(`${fileId}/values/${q(tab)}!A1:L${rowCount}?valueRenderOption=FORMULA`);
  const rows = got.values || [];
  let last = 0; // last row (1-based) with data the judge typed
  rows.forEach((r, i) => { if (i > 0 && [0, 1, 2, 3, 4, 5, 6, 7, 9, 10].some((c) => r[c] !== undefined && r[c] !== '')) last = i + 1; });
  let next = Math.max(last + 1, 2);

  const data = []; const done = [];
  for (const e of list) {
    // Already written on an earlier sync whose reply was lost? Don't add it twice.
    const dup = rows.findIndex((r, i) => i > 0 && same(r[1], e.host) && same(r[4], e.level) && same(r[5], e.element) &&
      String(r[6]) === String(e.teams) && String(r[7]) === String(e.passes) && same(r[10], e.reflections));
    if (dup > 0) { done.push([e, dup + 1]); continue; }
    const r = next++;
    const existing = rows[r - 1] || [];
    data.push({ range: `'${tab}'!A${r}:H${r}`, values: [[e.date, textCell(e.host), textCell(e.location), textCell(e.setter), e.level, textCell(e.element), Number(e.teams), Number(e.passes)]] });
    data.push({ range: `'${tab}'!J${r}:K${r}`, values: [[textCell(e.video), textCell(e.reflections)]] });
    if (!existing[8]) data.push({ range: `'${tab}'!I${r}`, values: [[`=(H${r}/G${r})`]] });
    if (!existing[11]) data.push({ range: `'${tab}'!L${r}`, values: [[r === 2 ? '=I2' : `=AVERAGE($I$2:I${r})`]] });
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
  const ranges = tabs.map((t) => 'ranges=' + q(t) + '!A2:L').join('&');
  const got = await api(`${fileId}/values:batchGet?${ranges}`);
  const history = {};
  got.valueRanges.forEach((vr, i) => {
    history[tabs[i]] = (vr.values || []).map((r, j) => ({ row: j + 2, r })).filter((x) => x.r[0]);
  });
  store.set('history', history); saveSettings({ historyAt: Date.now() });
  return history;
}

let syncing = false;
function syncNow() {
  const s = settings();
  if (!s.fileId) { toast('Choose your Judging Record first.'); location.hash = 'settings'; return; }
  if (syncing) return;
  getToken().then(async () => {
    syncing = true; setSyncButtons('Syncing…');
    try {
      const meta = await api(`${s.fileId}?fields=sheets.properties(sheetId,title,gridProperties)`);
      const props = {}; meta.sheets.forEach((sh) => { props[sh.properties.title] = sh.properties; });
      const tabs = CONFIG.tabs.filter((t) => props[t]);
      const pending = entries().filter((e) => e.status !== 'synced');
      let written = 0;
      for (const tab of new Set(pending.map((e) => e.tab))) {
        if (!props[tab]) { toast(`Your Judging Record has no "${tab}" tab — those entries are still on this phone.`, 6000); continue; }
        const done = await syncTab(s.fileId, tab, pending.filter((e) => e.tab === tab), props[tab]);
        const list = entries();
        done.forEach(([e, row]) => { const x = list.find((y) => y.id === e.id); if (x) { x.status = 'synced'; x.row = row; } });
        saveEntries(list); written += done.length;
      }
      // Keep the phone tidy: forget synced entries once they're in the sheet.
      saveEntries(entries().filter((e) => e.status !== 'synced'));
      await fetchHistory(s.fileId, tabs);
      saveSettings({ lastSync: Date.now(), tabs });
      toast(written ? `Synced ${written} ${written === 1 ? 'entry' : 'entries'} to your Judging Record.` : 'Your record is up to date.');
    } catch (e) {
      toast(e.message, 6000);
    } finally {
      syncing = false; setSyncButtons(); renderHome();
      if (!$('[data-view=record]').hidden) renderRecord();
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
  const e = id ? entries().find((x) => x.id === id) : null;
  const draft = !e && store.get('draft.log', null);
  const v = e || draft || {};
  f.reset();
  f.entryId.value = e ? e.id : '';
  setChip(f, 'tab', v.tab || settings().lastTab || 'SSANZ');
  f.date.value = v.date || today();
  ['host', 'location', 'setter', 'teams', 'passes', 'video', 'reflections'].forEach((k) => { f[k].value = v[k] == null ? '' : v[k]; });
  setChip(f, 'level', v.level || ''); setElement(f, v.element || '');
  $('#deleteEntry').hidden = !e;
  updateRate();
}
function readLogForm() {
  const f = logForm();
  return {
    id: f.entryId.value || uid(), tab: chipValue(f, 'tab') || 'SSANZ', date: f.date.value, host: f.host.value.trim(), location: f.location.value.trim(),
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

  const rates = [], all = hist.map((x) => ({ teams: +x.r[6] || 0, passes: +x.r[7] || 0 }));
  all.forEach((x) => { if (x.teams) rates.push(x.passes / x.teams); });
  const teams = all.reduce((a, x) => a + x.teams, 0);
  const avg = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) + '%' : '–';
  $('#recordStats').innerHTML =
    `<div class="stat"><b>${hist.length}</b><span>Appointments</span></div>` +
    `<div class="stat"><b>${teams}</b><span>Teams judged</span></div>` +
    `<div class="stat"><b>${avg}</b><span>Average pass rate</span></div>`;

  const rowHtml = (d) => `<div class="entry">
      <div class="top"><span>${esc(d.level)} ${esc(d.element)}</span><span>${esc(d.dateText)}</span></div>
      <div class="meta">${esc([d.host, d.location].filter(Boolean).join(' · '))}${d.teams !== '' ? ` · ${esc(d.passes)}/${esc(d.teams)} passed` : ''}${d.setter ? ` · Hides: ${esc(d.setter)}` : ''}</div>
      ${d.video ? `<div class="small"><a href="${esc(d.video)}" target="_blank" rel="noopener">Video</a></div>` : ''}
      ${d.reflections ? `<div class="refl">${esc(d.reflections)}</div>` : ''}
      ${d.pending ? `<div style="margin-top:8px"><span class="pill">Waiting to sync</span> <a class="small" href="#log/${esc(d.id)}">Edit</a></div>` : ''}
    </div>`;
  const items = pend.map((e) => ({ ...e, dateText: nzDate(e.date), pending: true }))
    .concat(hist.slice().reverse().map((x) => ({ dateText: x.r[0], host: x.r[1], location: x.r[2], setter: x.r[3], level: x.r[4], element: x.r[5], teams: x.r[6] || '', passes: x.r[7] || '', video: /^https?:/.test(x.r[9] || '') ? x.r[9] : '', reflections: x.r[10] })));
  $('#recordList').innerHTML = items.length ? items.map(rowHtml).join('') : '<p class="muted">Nothing here yet.</p>';
  const open = $('#openSheet');
  open.hidden = !s.fileId;
  if (s.fileId) open.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(s.fileId)}/edit`;
}

/* ---------- training forms (emailed to JDSC) ---------- */
const SWI_QUESTIONS = [
  'Assist the judge to set up the search area?',
  'Ask relevant questions about the search area / hide placement?',
  'Know how to use a stopwatch?',
  'Explain clearly the parameters of the search area and give relevant information concisely, without unnecessary delay?',
  'Show a friendly demeanour that allowed handlers to ask questions?',
  'Give teams space?',
  'Stand consistently at the start and during the search?',
  'Keep a neutral stance and minimise movement?',
  'Appear actively interested in watching the search teams?',
  'Overall, were you happy with their stewarding?',
  'Were there any issues or areas for improvement?',
];
const PROBO_AREAS = [
  ['Set-Up', 'Review & preparation of search area', 'e.g. check size, address any potential hazards, mark boundaries, "staging" or setting out containers.'],
  ['Set-Up', 'Hide placement', 'Odour hygiene. Selection, testing and setting of hide vessel & location taking into account environmental factors. Deciding on the "yes" zone.'],
  ['Set-Up', 'Search readiness', 'Discuss and agree expectations with Steward, including where to stand, & familiarity with stopwatch. Have contingency plans for fouling & damage.'],
  ['During', 'Judging', 'Make appropriate decisions regarding any faults. Make confident and timely calls for "correct". Accurate completion of judging sheets.'],
  ['During', 'Focus & consistency', 'Maintain attention and ensure consistency from first team to last. Minimise movement while teams are searching.'],
  ['During', 'Fouling incident', 'Management of a fouling incident.'],
  ['During', 'Other event', 'Awareness and management of dropped food, and/or other event that compromises the search area, including but not limited to container hygiene.'],
  ['After', 'Packing up', 'Removal and disposal of hide vessel with q-tip(s). Separation and identification of any "hot" gear from others.'],
];
function buildTrainingForms() {
  $('#swiQuestions').innerHTML = SWI_QUESTIONS.map((qText, i) =>
    `<div class="q"><p>${esc(qText)}</p><div class="chips" data-chips="q${i}" data-options="Yes|No"></div></div>`).join('');
  let group = '';
  $('#proboAreas').innerHTML = PROBO_AREAS.map(([g, title, desc], i) => {
    const head = g !== group ? `<h3>${esc(g)}</h3>` : ''; group = g;
    return `${head}<label class="tick"><input type="checkbox" name="area${i}"><span><b>${esc(title)}</b><span>${esc(desc)}</span></span></label>`;
  }).join('');
  $$('#proboAreas h3 + label').forEach((l) => { l.style.marginTop = '0'; });
  $('#proboAreas').classList.add('ticks');
}

function mailto(to, cc, subject, body) {
  let url = 'mailto:' + to + '?subject=' + encodeURIComponent(subject);
  if (cc) url += '&cc=' + encodeURIComponent(cc);
  return url + '&body=' + encodeURIComponent(body);
}
function judgeSignature() {
  const s = settings();
  return `${s.name || '(name not set)'}${s.email ? ' <' + s.email + '>' : ''}`;
}
function sendSwi(f) {
  if (!settings().name) { toast('Add your name under My details first.'); return; }
  const missing = SWI_QUESTIONS.filter((_, i) => !chipValue(f, 'q' + i)).length;
  if (missing && !confirm(`${missing} question${missing > 1 ? 's have' : ' has'} no Yes/No answer. Send anyway?`)) return;
  const level = chipValue(f, 'level'), element = elementValue(f);
  const body = [
    'SSANZ STEWARDING WITH INTENT ASSESSMENT', '',
    'Name: ' + f.trainee.value.trim(),
    'Judge: ' + judgeSignature(),
    'Hosting club: ' + f.host.value.trim(),
    'Date: ' + nzDate(f.date.value),
    'Level: ' + (level || '-'),
    'Element: ' + (element || '-'),
    'No. of participants: ' + (f.participants.value || '-'), '',
    'Did they…',
    ...SWI_QUESTIONS.map((qq, i) => `- ${qq}  ${(chipValue(f, 'q' + i) || '-').toUpperCase()}`), '',
    'Comments:', f.comments.value.trim() || '-', '',
    '--- end of assessment ---',
  ].join('\n');
  const subject = `[SWI Assessment] ${f.trainee.value.trim()} – ${[level, element].filter(Boolean).join(' ')} – ${nzDate(f.date.value)}`;
  finishForm(f, 'swi', mailto(CONFIG.jdsc, f.traineeEmail.value.trim(), subject, body));
}
function sendProbo(f) {
  if (!settings().name) { toast('Add your name under My details first.'); return; }
  const stage = chipValue(f, 'stage') || 'Novice', element = elementValue(f);
  const ticked = PROBO_AREAS.map((a, i) => [a, f['area' + i].checked]);
  const body = [
    `SSANZ ${stage.toUpperCase()} PROBATIONARY JUDGE COACHING FORM`, '',
    'Trainee: ' + f.trainee.value.trim(),
    'SSANZ membership no.: ' + (f.membership.value.trim() || '-'),
    'Date: ' + nzDate(f.date.value),
    'Host organisation: ' + f.host.value.trim(),
    'Element judged: ' + (element || '-'),
    'Teams entered (E): ' + (f.entered.value || '-'),
    'Teams that sourced the hide in time (S): ' + (f.sourced.value || '-'),
    'Coaching judge: ' + judgeSignature(), '',
    'Coaching and guidance given (ticked):',
    ...['Set-Up', 'During', 'After'].flatMap((g) => [g + ':', ...ticked.filter(([a]) => a[0] === g).map(([a, on]) => `  [${on ? 'x' : ' '}] ${a[1]}`)]), '',
    "Coaching judge's comments:", f.comments.value.trim() || '-', '',
    '--- end of coaching form ---',
  ].join('\n');
  const subject = `[Probationary Coaching] ${f.trainee.value.trim()} – ${stage} ${element} – ${nzDate(f.date.value)}`;
  finishForm(f, 'probo', mailto(CONFIG.jdsc, f.traineeEmail.value.trim(), subject, body));
}
function finishForm(f, key, url) {
  const sent = store.get('formsSent', []);
  sent.unshift({ kind: key, trainee: f.trainee.value.trim(), date: f.date.value, at: Date.now() });
  store.set('formsSent', sent.slice(0, 50));
  location.href = url;
  setTimeout(() => {
    if (confirm('Did your mail app open with the email ready to send?\n\nOK clears this form. Cancel keeps it so you can try again.')) {
      clearForm(f);
      location.hash = 'home';
    }
  }, 1500);
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
  buildTrainingForms();
  buildChips(); addVoice();
  window.addEventListener('hashchange', route);
  $('#backBtn').addEventListener('click', () => { location.hash = 'home'; });

  $('#saveDetails').addEventListener('click', () => {
    saveSettings({ name: $('#setName').value.trim(), email: $('#setEmail').value.trim() });
    toast('Details saved.');
  });
  $('#chooseRecord').addEventListener('click', () => {
    const name = $('#setName').value.trim(), email = $('#setEmail').value.trim();
    if (name || email) saveSettings({ name, email });
    choosePicker();
  });
  $('#signOut').addEventListener('click', () => {
    if (accessToken && window.google) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null; saveSettings({ consented: false }); renderSettings(); toast('Signed out of Google on this phone.');
  });
  $('#syncBtnHome').addEventListener('click', syncNow);
  $('#syncBtnRecord').addEventListener('click', syncNow);
  $('[data-view=record]').addEventListener('change', (e) => { if (e.target.name === 'recordTab') renderRecord(); });

  const f = logForm();
  f.addEventListener('input', () => { updateRate(); saveDraft(f); });
  f.addEventListener('change', () => saveDraft(f));
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const e = readLogForm();
    if (!e.level) { toast('Tap a Level.'); return; }
    if (!e.element) { toast('Tap an Element.'); return; }
    if (+e.passes > +e.teams) { toast('Passes can\'t be more than teams.'); return; }
    const list = entries(); const i = list.findIndex((x) => x.id === e.id);
    e.status = 'pending'; e.savedAt = Date.now();
    if (i >= 0) list[i] = e; else list.push(e);
    if (!saveEntries(list)) return;
    localStorage.removeItem('jl.draft.log');
    saveSettings({ lastTab: e.tab });
    toast(navigator.onLine && settings().fileId ? 'Saved. Tap Sync now to add it to your Judging Record.' : 'Saved on this phone. Sync when you have signal.');
    location.hash = 'home';
  });
  $('#deleteEntry').addEventListener('click', () => {
    const id = f.entryId.value; if (!id || !confirm('Delete this entry from this phone?')) return;
    saveEntries(entries().filter((x) => x.id !== id)); toast('Entry deleted.'); location.hash = 'record';
  });

  [$('#swiForm'), $('#proboForm')].forEach((tf) => {
    tf.addEventListener('input', () => saveDraft(tf));
    tf.addEventListener('change', () => saveDraft(tf));
    $('[data-clear]', tf).addEventListener('click', () => { if (confirm('Clear this form?')) clearForm(tf); });
  });
  $('#swiForm').addEventListener('submit', (ev) => { ev.preventDefault(); sendSwi(ev.target); });
  $('#proboForm').addEventListener('submit', (ev) => { ev.preventDefault(); sendProbo(ev.target); });

  window.addEventListener('online', () => { loadGoogle(); renderHome(); });
  window.addEventListener('offline', renderHome);
  loadGoogle();
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});
