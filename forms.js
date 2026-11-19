/* SSANZ training forms, as used by the Judge Log.
 * Wording follows the paper forms: SWI Coaching Form, Probationary Judge Coaching Form and
 * Trainee Judge Mentoring Form. The same list is copied into the JDSC helper script (for the PDF copy),
 * so change both if the wording changes. */
const SETUP_REVIEW = ['Set-Up', 'Review & preparation of search area', 'e.g. check size, address any potential hazards, mark boundaries, "staging" or setting out containers.'];
const SETUP_HIDE = ['Set-Up', 'Hide placement', 'Odour hygiene. Selection, testing and setting of hide vessel & location taking into account environmental factors. Deciding on the "yes" zone.'];
const FOULING = ['During', 'Fouling incident', 'Management of a fouling incident.'];
const OTHER_EVENT = ['During', 'Other event', 'Awareness and management of dropped food, and/or other event that compromises the search area, including but not limited to container hygiene.'];
const PACKING_UP = ['After', 'Packing up', 'Removal and disposal of hide vessel with q-tip(s). Separation and identification of any "hot" gear from others.'];

const TRAINING_FORMS = {
  'Stewarding with Intent': {
    code: 'SWI', title: 'SWI Coaching Form', levels: ['Novice', 'Intermediate'], supervisorTitle: 'Coaching judge',
    intro: 'Tick any areas where you involved the trainee, sharing insights from your knowledge and experience, through to creating opportunities for them to gain hands-on experience under your supervision. For SWIs, the emphasis is on explaining and demonstrating.',
    areas: [
      SETUP_REVIEW, SETUP_HIDE,
      ['Set-Up', 'Search readiness', 'Discuss and agree expectations, where to stand, ensure familiarity with stopwatch etc. Contingency plans for fouling and damage.'],
      ['During', 'Participant briefings', 'Clearly explain parameters of the search area, and provide all necessary information concisely, in a friendly manner.'],
      ['During', 'Focus & consistency', 'Maintain attention and ensure consistency from first team to last. Accurate time-keeping. Minimise movement while teams are searching.'],
      FOULING, OTHER_EVENT, PACKING_UP,
    ],
    traineeExtras: [],
  },
  'Probationary Judging': {
    code: 'PJ', title: 'Probationary Judge Coaching Form', levels: ['Novice', 'Intermediate', 'Advanced', 'Excellent'], supervisorTitle: 'Coaching judge',
    intro: 'Tick any areas where you provided coaching and guidance to the trainee, through to allowing them to take the lead under your supervision. At Probationary Judging, the emphasis is on growing the trainee\'s confidence through supervised, practical experience.',
    areas: [
      SETUP_REVIEW, SETUP_HIDE,
      ['Set-Up', 'Search readiness', 'Discuss and agree expectations with Steward, including where to stand, & familiarity with stopwatch. Have contingency plans for fouling & damage.'],
      ['During', 'Judging', 'Make appropriate decisions regarding any faults. Make confident and timely calls for "correct". Accurate completion of judging sheets.'],
      ['During', 'Focus & consistency', 'Maintain attention and ensure consistency from first team to last. Minimise movement while teams are searching.'],
      FOULING, OTHER_EVENT, PACKING_UP,
    ],
    traineeExtras: [],
  },
  Mentoring: {
    code: 'Mentoring', title: 'Trainee Judge Mentoring Form', levels: ['Intermediate', 'Advanced', 'Excellent'], supervisorTitle: 'Mentoring judge',
    intro: '',
    areas: [],
    traineeExtras: [
      ['placement', 'Inside or outside?', 'chips:Inside|Outside', 'For containers and vehicles'],
      ['photoTaken', 'Photo taken', 'tick'],
      ['videoTaken', 'Video taken', 'tick'],
      ['areaPrep', 'Search area review & preparation', 'text', 'Confirm size, address any potential hazards, mark boundaries, organise any "staging" or setting out of containers.'],
      ['environment', 'Environmental factors', 'text', 'The environmental factors you anticipate may influence odour movement and availability.'],
      ['searchDesign', 'Search design', 'text', 'What hide placement have you selected and why? Details of the vessel and number of tips used, with your reasoning. What is your yes zone?'],
      ['majorFaults', 'Major faults awarded', 'number'],
      ['minorFaults', 'Minor faults awarded', 'number'],
    ],
  },
};
const TRAINING_KINDS = Object.keys(TRAINING_FORMS);
