// Builds Prakash_Presentation_Script.docx  (run: node demo_video/build_script_doc.js)
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, LevelFormat, BorderStyle,
  WidthType, ShadingType, PageBreak, Footer, PageNumber, TableOfContents
} = require('docx');

const INK = '0F1A2E', MUTED = '5B677C', AMBER = 'B36B00', LINE = 'CBD3DF', SOFT = 'F4F6FA', AMBERSOFT = 'FFF0CC', BLUESOFT = 'E0EAFD';
const FONT = 'Calibri';
const W = 9906; // A4 with 1.0" margins: 11906 - 2*1000

const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: 22, color: INK, ...o });
const P = (t, o = {}) => new Paragraph({ spacing: { after: 120, line: 300 }, ...o, children: Array.isArray(t) ? t : [run(t)] });
const B = t => run(t, { bold: true });
const H1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [new TextRun({ text: t, font: FONT, size: 34, bold: true, color: INK })] });
const H2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: t, font: FONT, size: 26, bold: true, color: AMBER })] });
const H3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 }, children: [new TextRun({ text: t, font: FONT, size: 23, bold: true, color: INK })] });
const bullet = (t, lvl = 0) => new Paragraph({ numbering: { reference: 'bul', level: lvl }, spacing: { after: 70, line: 290 }, children: Array.isArray(t) ? t : [run(t)] });
const num = t => new Paragraph({ numbering: { reference: 'num', level: 0 }, spacing: { after: 70, line: 290 }, children: Array.isArray(t) ? t : [run(t)] });
const br = () => new Paragraph({ children: [new PageBreak()] });

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
const cell = (children, w, o = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, borders, margins: { top: 90, bottom: 90, left: 120, right: 120 },
  shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined, verticalAlign: o.v || undefined,
  children: (Array.isArray(children) ? children : [children]).map(c => typeof c === 'string' ? new Paragraph({ spacing: { after: 40, line: 270 }, children: [run(c, { size: o.size || 20, bold: o.bold })] }) : c)
});
function table(widths, header, rows, o = {}) {
  const sum = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: sum, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, borders, margins: { top: 90, bottom: 90, left: 120, right: 120 }, shading: { fill: INK, type: ShadingType.CLEAR, color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: h, font: FONT, size: 20, bold: true, color: 'FFFFFF' })] })] })) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: o.cantSplit !== false, children: r.map((c, i) => cell(c, widths[i], { fill: ri % 2 ? SOFT : undefined, size: o.size })) }))
    ]
  });
}
const callout = (title, lines, fill = AMBERSOFT) => new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [W],
  rows: [new TableRow({ children: [new TableCell({ width: { size: W, type: WidthType.DXA }, borders, shading: { fill, type: ShadingType.CLEAR, color: 'auto' }, margins: { top: 120, bottom: 120, left: 180, right: 180 },
    children: [new Paragraph({ spacing: { after: 60 }, children: [run(title, { bold: true })] }), ...lines.map(l => new Paragraph({ spacing: { after: 60, line: 290 }, children: [run(l, { size: 21 })] }))] })] })]
});
const sp = () => new Paragraph({ spacing: { after: 100 }, children: [] });

/* ------------------------------------------------------------------ content */
const c = [];

// title page
c.push(
  new Paragraph({ spacing: { before: 2400, after: 100 }, children: [new TextRun({ text: 'PRAKASH', font: FONT, size: 88, bold: true, color: AMBER })] }),
  new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'Smart Streetlight Maintenance and Decision Support System', font: FONT, size: 40, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: 'Full presentation script, technology explanation and viva preparation', font: FONT, size: 28, color: MUTED })] }),
  table([2400, 7506], ['Item', 'Detail'], [
    ['Course', 'Natural Language Processing (NLP) course project'],
    ['Group', 'Group 6'],
    ['Team', 'Gregory, Bharath Rathinasabapathy, Harshwardhan Ahire'],
    ['Theme', 'SDG 11: Sustainable Cities and Communities'],
    ['Project topic', 'Smart Streetlight Maintenance Management'],
    ['Demo video', 'demo_video/Prakash_Demo.mp4 (about 8 minutes, narrated)'],
  ]),
  br()
);

// contents
c.push(H1('Contents'), new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }), br());

// 1 How to use
c.push(
  H1('1. How to use this document'),
  P('This document contains everything you need to present Prakash to the examiner: what to say, what to click, how each technology works, and answers to the questions that are likely to be asked. It is organised so you can read it in order the night before, and use Part 5 (the live demo script) next to your laptop during the presentation.'),
  table([1700, 8206], ['Part', 'Use it for'], [
    ['2. Opening script', 'The first 90 seconds: problem, objective, solution.'],
    ['3. Technology stack', 'What each tool is, why we chose it and where it appears in the project. Read this before the viva.'],
    ['4. How it works', 'Plain-language explanation of every NLP step, model and algorithm, with the numbers we measured.'],
    ['5. Live demo script', 'Word-for-word narration and exact clicks, scene by scene (about 10 minutes).'],
    ['6. Results and honesty', 'Accuracy, what the numbers mean, limitations. Say these before the examiner asks.'],
    ['7. Questions and answers', 'Twenty likely questions with short, safe answers.'],
    ['8. Setup and troubleshooting', 'Commands, demo accounts location, what to do if something fails.'],
  ]),
  sp(),
  callout('Delivery tips', [
    'Speak slowly. Pause after each screen change so the examiner can read it.',
    'Share the work: one person presents the problem and the NLP, one runs the demo, one handles technology and questions.',
    'Always say "synthetic data" when you mention accuracy. It shows you understand the limits, and examiners reward that.',
    'Run python run.py --reset about 10 minutes before you start, and check the map loads on the room network.',
  ]),
  br()
);

// 2 Opening
c.push(
  H1('2. Opening script (about 90 seconds)'),
  H3('Say'),
  P([run('"Good morning, ma\'am. Our project is '), B('Prakash'), run(', a smart streetlight maintenance and decision support system. It supports Sustainable Development Goal 11, sustainable cities and communities.')]),
  P('"In most cities, when a streetlight stops working, a citizen complains by phone, WhatsApp, email or social media. Someone reads the message, decides how urgent it is, finds the lamp, and calls a technician, all by hand. That causes three problems: repairs are delayed, crews are scheduled inefficiently, and dark streets become a safety risk, especially for women, students and elderly people at night."'),
  P('"Our objective was to build an AI-driven system that takes a complaint from any channel and carries it all the way to a finished repair. It collects requests from many channels. It classifies the fault type. It extracts the location using named entity recognition. It assesses how severe the fault is. It finds maintenance hotspots with GIS. It predicts recurring failures from history. It optimises technician scheduling. And it shows everything on a live dashboard with alerts."'),
  P('"We built it as a real web application, not just a notebook: it has a backend, a database, live updates and three user roles, citizen, technician and admin. I will now show the demo, then explain the technology."'),
  H3('The problem statement, mapped to what we built'),
  table([4300, 5606], ['Requirement in the problem statement', 'Where it is in Prakash'], [
    ['Collect maintenance requests from multiple channels', 'WhatsApp, SMS, email, X/Twitter, call-centre transcripts, web portal, bulk CSV import: one pipeline, real webhook endpoints'],
    ['Automatically classify fault types', 'TF-IDF + logistic regression, 8 fault classes, English / Hindi / Marathi / Hinglish'],
    ['Extract streetlight locations using NER', 'Rule and gazetteer named entity recognition: pole ID, landmark, road, sector, duration, fault phrase'],
    ['Assess fault severity', 'Explainable 0-100 score with every point justified'],
    ['Identify maintenance hotspots (GIS)', 'DBSCAN clustering on lamp coordinates, plus 90-day repeat-failure clusters'],
    ['Predict recurring failures from history', 'Gradient-boosted 14-day lamp failure risk and Holt weekly forecast'],
    ['Optimise technician scheduling and resources', 'Skill- and priority-aware route optimiser, compared with a manual baseline'],
    ['Real-time dashboards with alerts', 'Live dashboard over server-sent events, critical-fault alerts, SLA alerts, hotspot alerts'],
  ]),
  br()
);

// 3 Tech stack
c.push(
  H1('3. Technology stack'),
  P('The stack is deliberately small and explainable. Every piece has one job, and we can say why we chose it.'),
  H2('3.1 Overview'),
  table([1700, 2500, 3300, 2406], ['Layer', 'Technology', 'What it does in Prakash', 'Files'], [
    ['Language', 'Python 3.13', 'All backend logic, NLP and machine learning', 'backend/*.py'],
    ['Web server / API', 'Flask', 'REST API, sessions, role checks, static files, server-sent events', 'backend/app.py'],
    ['Database', 'SQLite (WAL mode)', 'Users, lamps, tickets, events, notifications, corrections, settings, audit log', 'backend/db.py'],
    ['NLP', 'scikit-learn, regular expressions', 'Text clean-up, language ID, classifier, NER, severity, geocoding', 'backend/nlp.py'],
    ['Machine learning', 'scikit-learn, NumPy', 'Gradient boosting failure model, DBSCAN, Holt forecast', 'backend/ml.py'],
    ['Optimisation', 'Pure Python', 'Route insertion heuristic with 2-opt and or-opt', 'backend/scheduler.py'],
    ['Live updates', 'Server-Sent Events (SSE)', 'Pushes new tickets, alerts and notifications to browsers', 'backend/events.py'],
    ['Frontend', 'Vanilla JavaScript (ES modules), HTML, CSS', 'Single-page app for three roles, no build step', 'frontend/'],
    ['Maps', 'Leaflet + Esri street tiles', 'Lamp map, heat, hotspots, routes, pins', 'frontend/js/map.js'],
    ['Charts', 'Chart.js', 'Dashboard and analytics charts', 'frontend/js/pages/'],
    ['Security', 'Werkzeug password hashing, signed cookie sessions', 'Sign-in, role-based access control', 'backend/app.py'],
    ['Quality', 'pytest', '24 automated tests plus an end-to-end API check', 'tests/'],
  ], { size: 19 }),
  H2('3.2 Why these choices'),
  bullet([B('Python and scikit-learn. '), run('They are the standard for NLP coursework, well documented, and run on any laptop with no GPU.')]),
  bullet([B('Logistic regression instead of BERT. '), run('We had no labelled real data and needed a model that trains in one second, handles typos and Hindi/Hinglish through character n-grams, and can explain itself by showing the words behind each decision. The code is structured so the classifier can be swapped for DistilBERT or MuRIL when real data exists.')]),
  bullet([B('SQLite. '), run('Zero installation, a single file, perfect for a demo. The schema maps directly to PostgreSQL with PostGIS for a production version.')]),
  bullet([B('Server-sent events instead of WebSockets. '), run('Our updates only flow from server to browser, SSE is simpler, works over normal HTTP and reconnects automatically.')]),
  bullet([B('Vanilla JavaScript. '), run('No build tools or Node server are needed, so the project starts with one command.')]),
  bullet([B('Leaflet with bundled libraries. '), run('Charts, icons and logic are stored locally, so only the map background needs internet.')]),
  H2('3.3 Architecture in five stages'),
  table([1100, 2200, 6606], ['Stage', 'Name', 'What happens'], [
    ['1', 'Collect', 'A message arrives from WhatsApp, SMS, email, X, a call transcript or the web form. Each channel has its own clean-up (strip email signatures and quoted replies, remove hashtags, @mentions, emojis and speech fillers, expand SMS shorthand).'],
    ['2', 'Understand', 'Language identification, fault classification, named entity recognition and severity scoring.'],
    ['3', 'Locate', 'Geocode the entities (GPS pin, pole ID, landmark, station, sector, area), snap to the nearest lamp, detect duplicate reports.'],
    ['4', 'Predict and decide', 'Hotspot clustering, failure-risk prediction, weekly forecast and crew route optimisation.'],
    ['5', 'Act', 'Live dashboard, alerts, automatic dispatch of critical faults, technician route, automatic reply and status updates to the citizen, human review queue that feeds retraining.'],
  ]),
  H2('3.4 Roles and security'),
  table([1700, 4200, 4006], ['Role', 'Can do', 'Cannot do'], [
    ['Citizen', 'Register, report faults, see a live AI preview, confirm existing faults, track and rate own tickets, view the public city map, receive notifications', 'See other people\'s complaint text, open any admin or technician function'],
    ['Technician', 'See own optimised route, start and complete own jobs with notes and parts, toggle shift', 'See jobs assigned to others, use admin functions'],
    ['Admin', 'Dashboard, tickets, review queue, NLP lab, channels, hotspots, predictions, scheduling, analytics, models, users, settings, audit log', 'Nothing is hidden, but own account cannot be disabled'],
  ]),
  P('Access rules are enforced on the server for every API route, not only hidden in the interface, and are covered by automated tests. Passwords are stored as salted hashes, sessions use HttpOnly cookies, login attempts are rate-limited, uploads are restricted to images, and all text is escaped before it is shown.'),
  br()
);

// 4 How it works
c.push(
  H1('4. How it works'),
  H2('4.1 The NLP pipeline, step by step'),
  P('Example message: "Sparks coming from the pole near Vashi Station and a wire is hanging!"'),
  table([700, 2100, 7106], ['#', 'Step', 'What it does and what comes out'], [
    ['1', 'Text clean-up', 'Removes channel noise. Email: headers, quoted replies, signatures. Twitter: @mentions, hashtags split into words (#NerulStreetlight becomes Nerul Streetlight), emojis. Call: "uh", "um". SMS: expands plz, stn, nr. Output: clean text and a list of the fixes applied.'],
    ['2', 'Language identification', 'Script check for Devanagari, then word lists to separate Hindi from Marathi, and common romanised Hindi words to spot Hinglish. Output: English, Hindi, Marathi or Hinglish.'],
    ['3', 'Fault classification', 'TF-IDF features (word 1-2 grams and character 2-5 grams) into a logistic regression. Output: probability for each of 8 classes, plus the words that pushed the decision (coefficient times TF-IDF weight). A safety rule forces "electrical hazard" when words such as spark, live wire, shock or smoke appear, so danger is never treated as routine.'],
    ['4', 'Named entity recognition', 'Regular expressions plus a gazetteer of landmarks, stations, roads and zones, in English and Devanagari. Entity types: POLE_ID, LOCATION, LANDMARK, DURATION, FAULT. Overlaps are resolved by keeping the earliest, longest match.'],
    ['5', 'Severity scoring', 'Base score by fault type, plus points for electrical-danger words (+25), busy places such as schools, stations or hospitals (+10), public-safety words (+12), vulnerable people (+4), night-time (+3) and duration (+8 for 3 days, +14 for 7 days). Levels: Critical 75+, High 55+, Medium 30+, Low below 30.'],
    ['6', 'Geocoding and lamp snapping', 'Order of trust: GPS pin, pole ID, landmark, "zone + station", sector, area name. The location is snapped to the nearest lamp with the haversine distance formula, preferring lamps that are already faulty.'],
    ['7', 'Duplicate detection', 'If the same lamp already has an open ticket, the new report is merged into it and raises its priority. Two different lamps reported with exact GPS stay separate tickets.'],
    ['8', 'Triage decision', 'If the location is missing or vague, or classifier confidence is below 55%, the ticket goes to the human review queue. Otherwise it becomes an open ticket with an SLA deadline, and the citizen receives an automatic reply in their own language.'],
  ], { size: 19 }),
  H2('4.2 Machine learning models'),
  H3('Fault classifier'),
  bullet('Model: TF-IDF (word n-grams 1-2 and character n-grams 2-5) followed by multinomial logistic regression (C = 12).'),
  bullet('Why character n-grams: they survive spelling mistakes, transliteration (batti / bati) and Devanagari without a language-specific tokenizer.'),
  bullet('Training data: 1,360 synthetic complaints composed from phrase banks in four languages, with random typos, openers, closers, durations and place names.'),
  bullet('Test data: 480 complaints built from different paraphrases that never appear in training, plus 24 hand-written realistic messages.'),
  bullet('Active learning: corrections made by the admin are stored and added to the training set (weighted x6) when the admin presses Retrain.'),
  H3('Lamp failure-risk model'),
  bullet('Model: gradient boosting classifier (140 trees, depth 3).'),
  bullet('Features: lamp age, faults in the last 90 days (computed live from tickets), supply voltage fluctuation, rainfall in the last 7 days, driver type (magnetic ballast, electronic, LED), burning hours, pole condition.'),
  bullet('Output: probability that the lamp fails in the next 14 days, and the feature that contributes most to each lamp (found by replacing each feature with the fleet median).'),
  bullet('Rainfall what-if: the admin drags a slider and the whole network is re-scored instantly.'),
  H3('Weekly fault forecast'),
  bullet('Damped-trend Holt exponential smoothing. The smoothing parameters (alpha, beta, phi) are chosen by grid search on one-step-ahead error.'),
  bullet('The 80% prediction band is built from the spread of past forecast errors, widening with the horizon.'),
  H3('Hotspot clustering'),
  bullet('DBSCAN with haversine distance. Current hotspots: faulty lamps within 170 m of each other, at least 3. Repeat-failure hotspots: 90 days of complaint locations, 75 m, at least 8.'),
  bullet('Why DBSCAN: it needs no preset number of clusters, finds clusters of any shape and labels isolated faults as noise.'),
  H2('4.3 Crew scheduling'),
  P('Every open ticket gets a priority: severity + ageing (up to 25 points) + SLA pressure (up to 25 points when the deadline is near) + citizen confirmations (up to 15 points).'),
  P('The optimiser then builds one route per on-shift technician:'),
  num('Sort jobs by priority, highest first.'),
  num('For each job, try every allowed technician and every position in their route (cheapest insertion). A technician is allowed only if they have the required skills (hazards need an HV-certified electrician; multi-light outages need HV plus a bucket truck) and the shift length is not exceeded.'),
  num('Route cost = travel kilometres + 2.2 x sum of (priority weight x hours until the job is reached). So the cost rewards short routes and reaching urgent jobs early.'),
  num('Improve each route with 2-opt (reverse a segment) and or-opt (move one job) until no move lowers the cost.'),
  num('Jobs that do not fit in any shift are deferred to the next shift.'),
  P('We compare this with a realistic manual baseline: oldest complaint first, nearest depot, visit in arrival order, skills not checked. On the fresh demo data the optimiser reduced travel distance by about 30% (22.9 km against 32.9 km) and reduced the average time to reach Critical and High jobs from 105 to 12 minutes.'),
  H2('4.4 Live updates and alerts'),
  bullet('Server-sent events push changes to each browser. Admins receive every event; citizens and technicians receive only events about their own tickets.'),
  bullet('A critical ticket triggers a red alert on every admin screen and, if auto-dispatch is enabled, is assigned to the nearest qualified technician at the front of their route.'),
  bullet('Alerts are recalculated from live data: critical faults, tickets past or near their SLA, unassigned high-priority tickets, hotspots of four or more lamps, zones with high predicted risk, and the review queue.'),
  br()
);

// 5 live demo script
const scene = (time, title, say, doit) => [time + '\n' + title, say, doit];
c.push(
  H1('5. Live demo script (about 10 minutes)'),
  P('Left column: what to say. Right column: what to do on screen. The narrated video follows the same order. Before you start, run python run.py --reset and open http://localhost:5000. The sign-in page has one-click buttons for Admin, Citizen and Technician.'),
  (() => {
    const rows = [
      ['0:00\nProblem', '"This is Prakash. Faulty streetlights reported by citizens are handled by hand: slow repairs, poor scheduling, unsafe streets. Prakash automates the journey from complaint to repair using NLP, machine learning and GIS."', 'Stay on the sign-in page. Point at the four languages and six channels.'],
      ['1:00\nRoles', '"There are three roles: citizen, technician and admin. The server checks the role on every request. I will start as a citizen."', 'Click the Citizen demo button.'],
      ['1:30\nCitizen home', '"The citizen sees their active reports with a live progress tracker, and the status of every lamp in the city."', 'Scroll the home page slowly.'],
      ['2:00\nReport a fault', '"The citizen writes in their own words: sparks coming from the pole near Vashi Station and a wire is hanging. While they type, our NLP pipeline runs live. It detects the language, classifies an electrical hazard, scores it critical, extracts the landmark with named entity recognition and matches the exact lamp."', 'Report a fault. Type the sentence. Point at the AI panel: fault type, Critical, entities, matched lamp, danger warning.'],
      ['3:00\nMultilingual', '"It works in Hindi, Marathi and Hinglish too."', 'Click the Hindi example chip, let the panel update, then click the Danger chip to go back.'],
      ['3:30\nSubmit', '"On submit the citizen gets a reference number and an automatic reply in their own language. The ticket is stored, merged if a duplicate exists, and because it is critical the control room is alerted immediately."', 'Press Submit report. Show the success card and the reply.'],
      ['4:00\nTracking', '"Under My reports the citizen sees the full timeline: received, AI verified, crew assigned, repairing, fixed. After the repair they can rate it."', 'Open My reports, click a ticket, scroll the timeline.'],
      ['4:30\nAdmin dashboard', '"Now the control room. Key indicators: open tickets, critical faults, lamps working, tickets the AI triaged by itself, average fix time, citizen rating. The map shows lamps, heat and hotspot clusters."', 'Sign out, click the Admin demo button. Hover the KPI cards, toggle the Heat layer.'],
      ['5:15\nLive intake', '"With live intake on, complaints arrive from every channel, are classified and located, and appear without a refresh. A critical fault raises a red alert and is automatically dispatched to the nearest qualified technician."', 'Click Live intake. Click Simulate 3 incoming complaints. Watch the feed and the red toast.'],
      ['6:00\nTicket detail', '"Opening a ticket shows how the AI decided: highlighted entities, class probabilities, the words behind the decision, and a severity score where every point is explained."', 'Click a complaint in the feed. Scroll the drawer. Mention Assign, Correct type, Resolve.'],
      ['6:30\nReview queue', '"When the AI is unsure, for example no location, it does not guess. It asks a human. Each correction becomes a training example."', 'Open Review queue. Choose zone and lamp, click Approve and release.'],
      ['7:00\nNLP lab', '"The lab shows the pipeline step by step. Emails and tweets are cleaned first: quoted replies, signatures, hashtags and emojis are removed."', 'Open NLP lab. Click Hinglish, scroll the results, then the Email and Hindi chips.'],
      ['7:45\nChannels', '"The same pipeline serves WhatsApp, SMS, email, X and calls through real webhooks. I send a Hindi WhatsApp message and the bot replies in Hindi."', 'Open Channels. Type the Hindi message, press send.'],
      ['8:15\nHotspots', '"DBSCAN finds clusters of faulty lamps. They often share one feeder, so one crew clears many tickets. Repeat failures show where repairs keep coming back."', 'Open Hotspots. Click Repeat failures, then Predicted risk.'],
      ['8:45\nPrediction', '"Gradient boosting estimates each lamp\'s chance of failing in 14 days, and Holt smoothing forecasts weekly faults with a band. I drag the rainfall slider and the whole network is re-scored. Risky lamps can become preventive work orders."', 'Open Predictive. Drag the rainfall slider. Tick two lamps and press Create preventive work orders.'],
      ['9:30\nScheduling', '"The optimiser respects skills and shift length and sends urgent jobs first. Against a manual dispatcher it cuts distance and the time to reach critical jobs. One click dispatches the plan."', 'Open Scheduling. Toggle Manual and AI optimised, press Dispatch, confirm.'],
      ['10:15\nTechnician', '"The technician sees the optimised route and job list, starts work and marks it fixed with notes and parts. The citizen is notified at once."', 'Sign out, click the Technician demo button. Start work, Mark fixed, type a note, confirm.'],
      ['11:00\nEvidence', '"The Models page is our evidence: accuracy against the old keyword rules, precision and recall per class, the confusion matrix and retraining from human corrections. The data is synthetic and we say so openly."', 'Sign in as Admin again if needed. Open Models. Scroll, optionally press Retrain.'],
      ['11:45\nClose', '"In summary, Prakash reads complaints in four languages from six channels, finds the exact lamp, scores danger, predicts failures, optimises crews and learns from feedback. Thank you. We are happy to take questions."', 'Open System design to show the architecture and the problem-statement coverage table.'],
    ].map(r => [r[0].split('\n').map((t, i) => new Paragraph({ spacing: { after: 30 }, children: [run(t, { bold: i === 1, size: 19, color: i === 0 ? MUTED : INK })] })), r[1], r[2]]);
    return table([1400, 5106, 3400], ['When', 'Say', 'Do on screen'], rows, { size: 19 });
  })(),
  sp(),
  callout('If you only have 5 minutes', [
    'Do scenes 2:00 (report a fault), 5:15 (live intake), 6:00 (ticket detail), 9:30 (scheduling) and 11:00 (evidence). Skip the rest and show the System design page as your closing slide.',
  ], BLUESOFT),
  br()
);

// 6 results and honesty
c.push(
  H1('6. Results and honesty'),
  H2('6.1 Measured results'),
  table([4200, 1700, 4006], ['Measure', 'Result', 'How it was measured'], [
    ['Fault classifier accuracy', '87.5%', '480 held-out synthetic paraphrases, wording not seen in training'],
    ['Macro F1 (8 classes)', '0.875', 'Same test set'],
    ['Hand-written realistic messages', '91.7% (22 of 24)', '24 messages we wrote ourselves in four languages'],
    ['Old keyword-rule baseline', '42.7% and 75.0%', 'Same two test sets, rules from the first prototype'],
    ['Failure-risk model AUC', '0.80', '1,500 held-out synthetic lamps (base failure rate 15%)'],
    ['Failure-risk accuracy', '85.6%', 'Same hold-out set'],
    ['Forecast error (MAPE)', 'about 10%', 'Holt one-step-ahead error on 12 weeks of history'],
    ['Route distance, optimiser vs manual', 'about 30% shorter', 'Fresh demo data: 22.9 km against 32.9 km'],
    ['Time to reach Critical/High jobs', '12 min against 105 min', 'Same comparison'],
    ['Automated tests', '24 pytest tests + 40-step API check', 'tests/ folder'],
  ]),
  H2('6.2 Strongest and weakest classes'),
  P('Best F1: electrical hazard 0.93, controller/timer fault 0.93, multiple-light outage 0.93, damaged/stolen fixture 0.92. Weakest: "lamp not working" 0.73, because it is the most generic phrase and other classes such as dim or flickering are sometimes described with similar words. The confusion matrix on the Models page shows this.'),
  H2('6.3 Limitations you should state yourselves'),
  bullet([B('Synthetic data. '), run('Training complaints, the lamp network, 12 weeks of history, ratings and accounts were generated by us. There is no public labelled streetlight-complaint dataset. So the accuracy shows the pipeline works, not how it would perform on real citizen messages.')]),
  bullet([B('Simple model by design. '), run('Logistic regression on n-grams is fast and explainable but cannot understand deep context. A transformer would likely do better on real data.')]),
  bullet([B('Rule-based NER and severity. '), run('They are transparent but limited to the gazetteer and rules we wrote. A trained NER model (for example spaCy) is a next step.')]),
  bullet([B('Simulated channels. '), run('The webhooks are real endpoints, but we did not connect a paid WhatsApp Business account.')]),
  bullet([B('Approximate geography. '), run('Zone and landmark coordinates are approximate real places in Navi Mumbai; lamp positions are generated.')]),
  bullet([B('Demo server. '), run('Flask\'s development server is fine for a demo. A deployment needs a production server, HTTPS and real secrets.')]),
  br()
);

// 7 Q&A
const qa = [
  ['Which NLP techniques did you use?', 'Text normalisation, language identification, TF-IDF with word and character n-grams, logistic regression for classification, rule-and-gazetteer named entity recognition, rule-weighted severity scoring, and geocoding of extracted entities. We also use model explanation: the words that drove each decision.'],
  ['What is TF-IDF?', 'Term frequency times inverse document frequency. A word scores high if it appears often in one message but rarely across all messages, so distinctive words like "flickering" or "sparks" get more weight than common words like "the". We use sublinear term frequency and both word and character n-grams.'],
  ['Why logistic regression and not BERT or another deep model?', 'No labelled real data, need for fast training on a laptop, explainability, and robustness to typos and Hinglish through character n-grams. The pipeline is modular, so a transformer can replace the classifier once real labelled data exists.'],
  ['How does your NER work? Is it machine learning?', 'It is a hybrid of regular expressions and a gazetteer of landmarks, stations, roads and zones in English and Devanagari. It finds pole IDs, locations, landmarks, durations and fault phrases, and resolves overlaps by keeping the earliest and longest match. It is rule-based on purpose, because we have no annotated data; a trained NER model is future work.'],
  ['How do you handle Hindi, Marathi and Hinglish?', 'The language identifier uses the Devanagari script plus word lists to separate Hindi and Marathi, and romanised Hindi words to spot Hinglish. The classifier uses character n-grams, which work without a language-specific tokenizer. Training data includes all four languages, and the automatic replies are also written in each language.'],
  ['How did you measure accuracy without real data?', 'We generated training and test complaints from separate phrase banks, so the test set contains paraphrases the model has never seen. We also wrote 24 realistic messages by hand. We compared against the keyword-rule approach of our first prototype. We clearly label the data as synthetic.'],
  ['Is 87.5% accuracy good?', 'On this held-out synthetic test it shows the pipeline generalises beyond memorised phrases, and it is about twice the keyword baseline on the same set. It is not a claim about real-world accuracy; that needs real labelled complaints. The system is designed to retrain from human corrections for exactly this reason.'],
  ['How is severity calculated?', 'A transparent score: base level by fault type, plus points for electrical danger, busy places, public-safety words, vulnerable people, night-time and how long the fault has lasted, capped at 100. Every point is listed on screen, so a citizen or auditor can see why.'],
  ['What happens when the AI is unsure?', 'If the location is missing or vague, or confidence is below 55%, the ticket goes to the review queue instead of guessing. The admin confirms the fault type and lamp, and the correction is saved as a training example for the next retraining.'],
  ['How do you detect duplicate complaints?', 'Reports about the same lamp, identified by pole ID, GPS pin or snapped landmark, are merged into one ticket, and the report count raises its priority. Two different lamps reported with exact GPS remain separate tickets.'],
  ['What is DBSCAN and why did you use it?', 'Density-based clustering. It groups points that have at least a minimum number of neighbours within a radius, finds clusters of any shape, does not need the number of clusters in advance, and marks isolated points as noise. That suits faults clustered along a road because they share a feeder.'],
  ['How does the failure prediction work?', 'A gradient-boosted tree model takes lamp age, recent faults, voltage fluctuation, rainfall, driver type, burning hours and pole condition, and outputs the probability of failure in 14 days. The faults-in-90-days feature is computed live from real tickets. The rainfall slider lets the admin test what-if scenarios.'],
  ['Is the prediction model trained on real data?', 'No, on synthetic lamp data generated from a logistic relationship plus noise. Its AUC of 0.80 measures how well it recovers that relationship on held-out lamps. On real maintenance records the same code would be retrained.'],
  ['What is the scheduling algorithm?', 'Priority-ordered cheapest insertion into technician routes, with hard constraints for skills and shift length, then 2-opt and or-opt improvement. The cost combines travel distance and priority-weighted waiting time. It is a heuristic for the vehicle routing problem; an exact solver such as OR-Tools is a possible upgrade.'],
  ['How does real-time work?', 'The browser opens a server-sent events stream. When a ticket is created or changed, the server publishes an event and each connected user receives only what their role allows. The dashboard updates without a refresh.'],
  ['How is access controlled?', 'Every API route checks the role on the server. Citizens see their own tickets in full and only a public summary of others. Technicians see only their assigned jobs. Only admins reach the admin API. Automated tests check these rules.'],
  ['How would this work in a real city?', 'Connect a WhatsApp Business number and an SMS gateway to the webhooks, import the municipal lamp register, train on real labelled complaints, switch to PostgreSQL with PostGIS, use real road travel times for routing, and deploy behind HTTPS with a production server.'],
  ['What would you improve next?', 'Collect and label real complaints, replace the classifier with DistilBERT or MuRIL, train a proper NER model, add image analysis on the citizen photos, use road-network routing, and add a mobile app for technicians.'],
  ['What is the most important thing your team learned?', 'That a good AI system is not only a model: it needs explainability, a human review loop, clean data handling across channels, and a workflow that connects predictions to real actions.'],
];
c.push(H1('7. Likely questions and answers'), P('Keep answers short. If you do not know something, say what you would do to find out; do not invent numbers.'));
qa.forEach((x, i) => {
  c.push(new Paragraph({ keepNext: true, spacing: { before: 140, after: 40 }, children: [run(`Q${i + 1}. ${x[0]}`, { bold: true, color: AMBER })] }), P(x[1]));
});
c.push(br());

// 8 setup
c.push(
  H1('8. Setup and troubleshooting'),
  H2('8.1 Commands'),
  table([4300, 5606], ['Command', 'What it does'], [
    ['pip install -r requirements.txt', 'Installs Flask, scikit-learn, NumPy, SciPy (once)'],
    ['python run.py', 'Starts the app at http://localhost:5000 (first start takes about 10 seconds)'],
    ['python run.py --reset', 'Wipes the database and regenerates fresh demo data. Use before presenting.'],
    ['python run.py --host 0.0.0.0', 'Lets phones on the same Wi-Fi open the app at http://<PC-IP>:5000'],
    ['python run.py --port 8080', 'Uses another port if 5000 is busy'],
    ['python -m pytest tests -q', 'Runs the 24 automated tests'],
    ['python tests/smoke_api.py', 'End-to-end API check against a running server'],
  ]),
  H2('8.2 Accounts'),
  P('The sign-in page shows three one-click demo buttons: Admin, Citizen and Technician. The accounts are created in backend/seed.py. Change or remove them before any real deployment.'),
  H2('8.3 If something goes wrong'),
  table([3000, 6906], ['Problem', 'What to do'], [
    ['Map background is grey or blank', 'No internet or the tile server is blocked. Lamps, heat, routes and labels still work. Switch to a mobile hotspot if possible.'],
    ['Page looks stale after a change', 'Hard refresh with Ctrl+F5.'],
    ['Port 5000 already in use', 'Run python run.py --port 8080 and open http://localhost:8080.'],
    ['You want a clean start', 'System page then Reset demo data, or stop the server and run python run.py --reset.'],
    ['Live intake too fast or slow', 'System page, Live intake simulator interval.'],
    ['Demo video will not play', 'Open it with VLC, or use the live app and this script instead.'],
  ]),
  H2('8.4 Project files'),
  table([3300, 6606], ['Path', 'Purpose'], [
    ['run.py', 'Starts the server'],
    ['backend/nlp.py', 'Text cleaning, language ID, classifier, NER, severity, geocoding'],
    ['backend/training_data.py', 'Synthetic multilingual training and test complaints'],
    ['backend/ml.py', 'Failure-risk model, forecast, DBSCAN hotspots'],
    ['backend/scheduler.py', 'Route optimiser and manual baseline'],
    ['backend/services.py', 'Ingest pipeline, duplicates, ticket lifecycle, alerts, dashboard numbers'],
    ['backend/app.py', 'API, roles, live stream'],
    ['frontend/', 'The single-page application'],
    ['tests/', 'Automated tests'],
    ['demo_video/', 'Demo video and the script that records it'],
    ['README.md, DEMO_GUIDE.md', 'Setup notes and the short demo guide'],
  ]),
);

const doc = new Document({
  creator: 'Group 6', title: 'Prakash presentation script', description: 'Presentation script and technology explanation for Prakash',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, font: FONT }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: FONT }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, font: FONT }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }, { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1000, hanging: 270 } } } }] },
      { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
    ]
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1100, left: 1000, right: 1000 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Prakash · Group 6 · NLP project · page ', font: FONT, size: 18, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: MUTED })] })] }) },
    children: c
  }]
});

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, 'Prakash_Presentation_Script.docx');
  fs.writeFileSync(out, buf);
  console.log('wrote', out);
});
