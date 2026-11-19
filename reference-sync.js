/* Keeps the latest Beyond the Sniff on the phone for the Search page.
 * The JDSC helper turns the Google Doc into sections; this saves them, and the pictures,
 * in the phone's cache so Search works with no signal. Used by reference.html and the home page. */
(function () {
  const API = 'https://script.google.com/macros/s/AKfycbywCXEqURDAO11M8BgMQ41gxIOAgjFokbFJItgp0q27XqFMa--86rNu3JR1hz3l_iIK-Q/exec';
  const CACHE = 'judge-log-ref';
  const JSON_KEY = 'ref-live/bts.json';
  const IMG = (k) => 'ref-live/img/' + encodeURIComponent(k);
  const CHECKED = 'jl.refChecked';
  const urls = {};
  let running = null;

  const open = () => (self.caches ? caches.open(CACHE) : Promise.reject(new Error('No cache')));

  async function load() {
    try { const r = await (await open()).match(JSON_KEY); return r ? await r.json() : null; } catch (e) { return null; }
  }

  async function imageUrl(key) {
    if (urls[key]) return urls[key];
    try {
      const r = await (await open()).match(IMG(key));
      if (!r) return null;
      urls[key] = URL.createObjectURL(await r.blob());
      return urls[key];
    } catch (e) { return null; }
  }

  function b64ToBlob(data, type) {
    const bin = atob(data); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type });
  }

  async function getJson(params) {
    const res = await fetch(API + '?' + new URLSearchParams(params).toString());
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'The helper could not send Beyond the Sniff.');
    return j;
  }

  /* Check for a newer Beyond the Sniff and download any missing pictures.
   * opts.onChange(data) – new text saved; opts.onImage(key) – a picture saved; opts.onStatus(text). */
  function sync(opts) {
    opts = opts || {};
    if (running) return running;
    running = (async () => {
      const say = (t) => { if (opts.onStatus) opts.onStatus(t); };
      if (navigator.onLine === false) { say('offline'); return; }
      const c = await open();
      let cur = await load();
      say('checking');
      const j = await getJson({ action: 'bts', since: cur ? cur.modified : '' });
      if (!j.same) {
        cur = { modified: j.modified, title: j.title, sections: j.sections, images: j.images, saved: Date.now() };
        await c.put(JSON_KEY, new Response(JSON.stringify(cur), { headers: { 'Content-Type': 'application/json' } }));
        if (opts.onChange) opts.onChange(cur);
      }
      try { localStorage.setItem(CHECKED, String(Date.now())); } catch (e) {}
      const keys = Object.keys(cur.images || {});
      for (const k of keys) {
        if (await c.match(IMG(k))) continue;
        say('pictures');
        try {
          const im = await getJson({ action: 'btsimg', k: k });
          await c.put(IMG(k), new Response(b64ToBlob(im.data, im.type), { headers: { 'Content-Type': im.type } }));
          if (opts.onImage) opts.onImage(k);
        } catch (e) { /* try again next time */ }
      }
      // Remove pictures no longer in the Doc.
      for (const req of await c.keys()) {
        const m = req.url.match(/ref-live\/img\/([^/?#]+)$/);
        if (m && keys.indexOf(decodeURIComponent(m[1])) < 0) await c.delete(req);
      }
      say('done');
    })().catch((e) => { if (opts.onStatus) opts.onStatus('error', e); }).finally(() => { running = null; });
    return running;
  }

  /* Quiet background check from the home page, at most every few hours. */
  function syncIfDue(hours) {
    try { if (Date.now() - Number(localStorage.getItem(CHECKED) || 0) < (hours || 6) * 3600e3) return; } catch (e) {}
    sync({});
  }

  window.RefSync = { load, sync, syncIfDue, imageUrl };
})();
