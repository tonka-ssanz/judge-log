# SSANZ Judge Log

Phone-first web app for SSANZ judges, hosted at https://tonka-ssanz.github.io/judge-log/

## What's in it
- `index.html`, `app.js`, `styles.css`: the app (log appointments, My record, Stewarding with Intent, Probationary coaching, settings)
- `report.html`: Notify SSANZ (two branches: dog fouled during search, or something else). The email wording is read by the "Judge Concerns Log" Apps Script in the JDSC Gmail; if labels change here, change REPORT_LABELS there too.
- Trial suggestion in Log a search: the app reads the trial calendar (dates, host, venue only) live from the yearly Trials tabs of Judges and Trials (master) through the JDSC helper (`?action=trials`), keeps it on the phone for no-signal venues, and suggests the trial on the day (any day of a multi-day trial). Later searches at the same trial reuse the host and venue of the first one. `trials.js` is only a starting copy for phones that haven't been online yet.
- `sw.js` + `manifest.webmanifest` + icons: offline use and "Add to Home Screen". Bump `VERSION` in sw.js when files are added or removed.
- `privacy.html`: privacy policy

## How it saves
- Entries are stored on the phone first, then written to the judge's own Judging Record (Google Sheet) when they tap Sync.
- It writes to the first empty row of the SSANZ / Dogs NZ / Other tab, columns A–H and J–K. The Pass Rate (I) and Average To Date (L) formulas are left alone, and added if the sheet runs past its pre-filled rows.
- Google permission is drive.file only: the app can open just the spreadsheet the judge picks.
- Training forms and concern reports are emailed to ssanzjdsubcommittee@gmail.com from the judge's own mail app.

## One-off setup in Google Cloud (project "SSANZ Judges Tool")
- APIs & Services > Library > **Google Sheets API** > Enable (needed for Sync).
