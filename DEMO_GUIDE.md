# Presentation guide (about 10 minutes)

**Before you start:** run `python run.py --reset`, open http://localhost:5000, and check the map loads (needs internet). Use the **light theme on a projector** and the **dark theme on a laptop screen**. Zoom the browser to 110% if the room is large. Keep a second tab open on the citizen account if you want to show two roles side by side.

Sign-in page: click the **Admin**, **Citizen** or **Technician** button. No typing needed.

## The story in one sentence

"A citizen sends a message in any language, the system understands it, finds the exact lamp, decides how urgent it is, sends the right technician by the shortest route, and learns from the operator's corrections."

## Running order

### 1. The problem (30 s) · sign-in page
Read the headline. Point out the four languages and six channels.

### 2. Citizen reports a fault (2 min) · sign in as **Citizen**
1. **Home**: active reports with a progress tracker, live city status map.
2. **Report a fault**: click the **हिन्दी** example chip, or type: *"Sparks coming from the pole near Vashi Station and a wire is hanging!"*
3. Watch the right panel update live: language, fault type, **Critical** severity, the lamp it matched, and the danger warning. Mention: *"This is the same NLP pipeline, running as the citizen types."*
4. Click the map to drop a pin (or **Use my location**), add a photo if you want, press **Submit report**.
5. Show the automatic reply (it comes back in the citizen's language).
6. **My reports** → open a ticket: progress stepper, timeline, map, ETA. Open the **bell** for notifications.

### 3. Admin sees it instantly (2 min) · sign in as **Admin** (second tab or sign out)
1. **Dashboard**: click **Live intake** (top right) and keep talking. New complaints appear in the feed, on the map and in the charts without a refresh. Critical ones pop up as red alerts.
2. Click a complaint → the **ticket drawer**: entities highlighted, class probabilities, the words that drove the decision, severity gauge with every point explained, location map, full timeline.
3. **Review queue**: the AI parked vague messages here instead of guessing. Approve one (pick zone and lamp). Say: *"Every correction becomes a training example."*

### 4. The NLP in detail (2 min) · **NLP lab**
Click the chips one after another: **Hinglish**, **हिन्दी**, **Tweet**, **Email**, **No location**.
Show the seven pipeline steps, the cleaned text, entities, probabilities, severity reasons, and the duplicate check. The **Email** and **Tweet** samples show channel clean-up (quoted replies, signatures, hashtags, emojis).

Then **Channels**: type a WhatsApp message in Hindi, press send, and watch the bot reply in Hindi. Show the webhook `curl` snippet and say the same endpoint serves a real WhatsApp gateway.

### 5. Decisions (2 min)
* **Hotspots**: DBSCAN clusters of faulty lamps with a probable cause; the *Repeat failures* tab for "fix the cause, not the symptom".
* **Predictive**: forecast chart with prediction band, feature importance, then **drag the rainfall slider** and watch the risk map and numbers change. Select a few risky lamps and create preventive work orders.
* **Scheduling**: comparison table, **manual vs AI optimised** (distance, time to reach critical jobs, skill mismatches). Press **Dispatch optimised plan**.

### 6. Technician closes the loop (1 min) · sign in as **Technician**
**My route** shows the numbered route. **Start work**, then **Mark fixed** with a note. Switch back to the citizen tab: the notification arrived and the ticket is resolved, ready to rate.

### 7. Proof it is real (30 s) · **Models**
Accuracy against the old keyword rules, per-class F1, confusion matrix, **Retrain with human corrections**. Close with **System design** (problem statement coverage) and the honesty note about synthetic data.

## Likely questions and answers

**Which NLP techniques did you use?** Text normalisation, language identification, TF-IDF with word and character n-grams, logistic regression for classification, rule-and-gazetteer named entity recognition, rule-weighted severity scoring, and geocoding of extracted entities.

**Why not a transformer like BERT?** With no labelled real data and a demo laptop, a linear model on character n-grams handles typos, Hinglish and Devanagari well, trains in a second, and is explainable (we show the words that drove each decision). The code is structured so the classifier can be swapped for DistilBERT/MuRIL once real data exists.

**Is the accuracy real?** The pipeline and the measurement are real; the data is synthetic. We test on paraphrases that never appear in training and on 24 hand-written messages, and we say so on the Models page. On real data the number would differ, which is why retraining from operator corrections is built in.

**How does severity work?** A transparent score: base level by fault type, plus points for electrical danger, busy places (school, station, hospital), public-safety words, vulnerable people, night-time and how long it has been faulty. Every point is listed, so a citizen or auditor can see why.

**How are duplicates handled?** Reports about the same lamp (by pole ID, GPS pin or snapped landmark) merge into one ticket and raise its priority. Two different lamps reported with exact GPS stay separate tickets.

**What is the scheduling algorithm?** Priority = severity + ageing + SLA pressure + citizen confirmations. Jobs are placed by cheapest insertion into the route that adds least travel and delay, with hard limits for skills (HV-certified, bucket truck) and shift length, then improved with 2-opt and or-opt. It is compared against a realistic manual baseline (oldest first, nearest depot).

**What about real-time?** Server-sent events push ticket changes, alerts and notifications to each role. Admins get everything; citizens and technicians only their own events.

**How is access controlled?** Every route checks the role on the server. A citizen only sees their own tickets in full, technicians only their assigned jobs, and only admins reach the admin API. This is covered by automated tests.

**What would you do next?** Collect and label real complaints, swap in a transformer classifier, connect a WhatsApp Business number and the municipal lamp register, add route times from a real road network, and move to PostgreSQL/PostGIS.

## If something goes wrong

* **Map is grey:** no internet. Everything else still works (lamps, heat, routes, labels are drawn locally).
* **Want a clean slate:** *System → Reset demo data*, or stop the server and run `python run.py --reset`.
* **Port busy:** `python run.py --port 8080`.
* **Live intake too fast or slow:** *System → Live intake simulator* interval.
