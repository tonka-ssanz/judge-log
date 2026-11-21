/* SSANZ trial calendar for the Judge Log, as at 21 Nov 2026.
 * Built from Judges and Trials (master), yearly Trials tabs (rows 1–3: date, host, venue).
 * Used to suggest the trial when a judge logs a search. Dates are the first and last day of each trial.
 * Trials with no exact date yet (e.g. "Dec 2026") are left out until the date is filled in. */
const TRIALS_AS_AT = "21 Nov 2026";
const TRIALS = [
  { start: "2026-01-03", end: "2026-01-04", host: "K9 Scentcraft", venue: "Globe Theatre, Palmerston North" },
  { start: "2026-01-31", end: "2026-02-01", host: "ACE", venue: "Hutt Intermediate School" },
  { start: "2026-02-06", end: "2026-02-06", host: "K9 Scent Seekers", venue: "Upper Atiamuri School" },
  { start: "2026-05-02", end: "2026-05-03", host: "TNT", venue: "Mount Maunganui" },
  { start: "2026-05-09", end: "2026-05-10", host: "K9 Kitea", venue: "" },
  { start: "2026-06-07", end: "2026-06-07", host: "Canine.NZ", venue: "Corban Estate" },
  { start: "2026-06-13", end: "2026-06-14", host: "Sniffing with Canines", venue: "Levin Intermediate" },
  { start: "2026-07-11", end: "2026-07-12", host: "ACE", venue: "" },
  { start: "2026-07-18", end: "2026-07-18", host: "Canine.NZ", venue: "Layher Scaffolding, South Auckland" },
  { start: "2026-08-08", end: "2026-08-09", host: "Canine.NZ", venue: "Stanhope School, Ellerslie" },
  { start: "2026-08-22", end: "2026-08-22", host: "Noseworx", venue: "Rerewhakaitu" },
  { start: "2026-09-12", end: "2026-09-12", host: "Canine.NZ", venue: "RDA Henderson" },
  { start: "2026-09-12", end: "2026-09-13", host: "K9 Scentcraft", venue: "Woodville Racecourse" },
  { start: "2026-09-26", end: "2026-09-27", host: "Taupo Scentwork", venue: "Tauhara College" },
  { start: "2026-10-17", end: "2026-10-18", host: "Dogs First", venue: "Layher Scaffolding, Lower Hutt" },
  { start: "2026-10-24", end: "2026-10-25", host: "K9 Kitea", venue: "Ngatea" },
  { start: "2026-10-31", end: "2026-11-01", host: "Sniffing with K9's", venue: "Horowhenua College" },
  { start: "2026-11-07", end: "2026-11-08", host: "K9 Scent Seekers", venue: "Forest View High School, Tokoroa" },
  { start: "2026-11-14", end: "2026-11-14", host: "Scentways", venue: "Heretaunga College, Upper Hutt" },
  { start: "2026-11-21", end: "2026-11-22", host: "K9 Kitea", venue: "Te Rapa Primary" },
  { start: "2027-01-09", end: "2027-01-10", host: "K9 Scentcraft", venue: "" },
  { start: "2027-04-17", end: "2027-04-18", host: "TNT", venue: "" },
];
