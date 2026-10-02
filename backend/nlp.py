"""NLP pipeline: normalisation -> language detection -> fault classification -> NER -> severity -> geocoding.

* Classifier: TF-IDF (word 1-2 grams + character 2-5 grams) + logistic regression, trained on
  synthetic multilingual complaints (see training_data.py) and re-trainable from admin corrections.
* NER: rule + gazetteer hybrid (pole IDs, landmarks, roads, sectors, durations, fault phrases).
* Severity: transparent rule-weighted score so every point can be explained to a citizen or auditor.
"""
import json
import os
import re
import threading

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.pipeline import FeatureUnion, Pipeline

from . import geo, training_data as td
from .config import DATA_DIR

MODEL_PATH = os.path.join(DATA_DIR, "fault_classifier.joblib")
METRICS_PATH = os.path.join(DATA_DIR, "fault_classifier_metrics.json")

# skills a technician needs: 'hv' = HV-certified electrician, 'bucket' = bucket truck
CLASS_META = {
    "outage":  dict(label="Lamp not working", color="#E5484D", dept="Field maintenance", parts="Lamp / LED driver", base=35, mins=30, needs=[]),
    "flicker": dict(label="Flickering", color="#F28A2E", dept="Field maintenance", parts="Driver, connector check", base=25, mins=25, needs=[]),
    "dayburn": dict(label="Burning in daytime", color="#9B7BFF", dept="Control & automation", parts="Photocell / timer relay", base=15, mins=20, needs=[]),
    "hazard":  dict(label="Electrical / pole hazard", color="#FF4D6A", dept="Electrical safety crew", parts="Cable, junction box, pole clamp", base=75, mins=60, needs=["hv"]),
    "dim":     dict(label="Dim light", color="#D9A800", dept="Field maintenance", parts="Lamp replacement", base=18, mins=25, needs=[]),
    "vandal":  dict(label="Damaged / stolen fixture", color="#2CB89A", dept="Field crew + police intimation", parts="Fixture, cable", base=40, mins=45, needs=[]),
    "timer":   dict(label="Controller / timer fault", color="#5B9BFF", dept="Control & automation", parts="Controller, contactor", base=30, mins=35, needs=[]),
    "cluster": dict(label="Multiple-light outage", color="#E45DB0", dept="Feeder team", parts="Feeder / MCB inspection", base=55, mins=75, needs=["hv", "bucket"]),
    "preventive": dict(label="Preventive inspection", color="#4C8BF5", dept="Predictive maintenance", parts="Inspection, driver swap", base=20, mins=20, needs=[]),
}

_lock = threading.Lock()
_model = None
_metrics = None


# ============================================================ text normalisation
_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿️]+")
_ABBR = {r"\bplz\b": "please", r"\bpls\b": "please", r"\bplss+\b": "please", r"\bu\b": "you", r"\bstn\b": "station",
         r"\bn\b": "and", r"\bnr\b": "near", r"\bopp\b": "opposite", r"\bthx\b": "thanks", r"\bst\.? light\b": "street light",
         r"\bsl\b(?![-\s]?[a-z]{3})": "street light"}


def normalize(text, channel="Web portal"):
    """Clean channel noise. Returns (clean_text, [steps applied])."""
    steps, t = [], text or ""
    orig = t

    def sub(pattern, repl, label, flags=re.I | re.M):
        nonlocal t
        n = re.sub(pattern, repl, t, flags=flags)
        if n != t:
            steps.append(label)
            t = n

    ch = channel.lower()
    if "email" in ch:
        sub(r"^(from|to|cc|sent|date):.*$", "", "Stripped email headers")
        sub(r"^subject:\s*", "", "Merged email subject into body")
        sub(r"^>.*$", "", "Removed quoted reply text")
        t2 = re.split(r"\n\s*(--|regards|thanks\s*&?\s*regards|best regards|sent from my)", t, flags=re.I)[0]
        if t2 != t:
            steps.append("Removed email signature")
            t = t2
    if "twitter" in ch or "x /" in ch:
        sub(r"\bRT\b\s*", "", "Removed retweet marker", flags=re.M)
        sub(r"@\w+", "", "Removed @mentions")
        sub(r"#(\w+)", lambda m: re.sub(r"(?<=[a-z])(?=[A-Z])", " ", m.group(1)), "Split hashtags into words", flags=re.M)
    if "call" in ch:
        sub(r"\b(uh+|um+|hmm+|you know|like i said)\b[, ]*", "", "Removed speech fillers")
    sub(r"https?://\S+", "", "Removed URLs")
    t2 = _EMOJI.sub(" ", t)
    if t2 != t:
        steps.append("Removed emojis")
        t = t2
    changed = False
    for pat, rep in _ABBR.items():
        n = re.sub(pat, rep, t, flags=re.I)
        changed |= n != t
        t = n
    if changed:
        steps.append("Expanded SMS shorthand")
    t = re.sub(r"\s+", " ", t).strip()
    if t != orig.strip() and not steps:
        steps.append("Collapsed whitespace")
    return t, steps


# ============================================================ language detection
_MR_WORDS = ["आहे", "आहेत", "नाही", "जवळ", "खूप", "आपोआप", "दिवा", "दिवे", "खांब", "रस्त्यावर", "पासून", "सारखा", "सारखी",
             "लाईट", "होतोय", "आहेत", "वाकला", "फुटली", "चोरली", "पडला"]
_HI_WORDS = ["है", "हैं", "नहीं", "के पास", "रहा", "रही", "में", "को", "बंद", "लाइट", "बत्ती", "खंभा", "खंभे", "सड़क", "कृपया"]
_HINGLISH = re.compile(r"\b(hai|hain|nahi|nahin|band|andhera|batti|kripya|paas|raat|din|mein|me|kharab|jal|rahi|raha|ho|hoti|"
                       r"karo|kar|ke|ki|ka|bahut|kam|roshni|sabhi|saari|poori|kisi|ne|gaya|gayi|toot|chori|khamba|girne|wala|"
                       r"subah|shaam|dopahar|jhilmil|latak)\b", re.I)


def detect_language(t):
    if re.search(r"[ऀ-ॿ]", t):
        mr = sum(w in t for w in _MR_WORDS)
        hi = sum(w in t for w in _HI_WORDS)
        return "Marathi" if mr > hi else "Hindi"
    hits = len(_HINGLISH.findall(t))
    if hits >= 2:
        return "Hinglish"
    return "English"


# ============================================================ classifier
def _build_pipeline():
    tok = r"[^\s,.;:!?()\"'।\-/]+"
    union = FeatureUnion([
        ("word", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, token_pattern=tok, lowercase=True, min_df=1)),
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, lowercase=True, min_df=2)),
    ])
    return Pipeline([("tfidf", union), ("clf", LogisticRegression(C=12, max_iter=2000))])


def _apply_safety(text, p):
    """Electrical-danger words must never be routed to a routine queue."""
    if _DANGER.search(text) and max(p, key=p.get) != "hazard":
        boost = max(p["hazard"], 0.55)
        scale = (1 - boost) / ((1 - p["hazard"]) or 1)
        return {k: (boost if k == "hazard" else v * scale) for k, v in p.items()}, "electrical-danger safety rule"
    return p, None


def _predict_batch(model, texts):
    probas = model.predict_proba(texts)
    out = []
    for text, row in zip(texts, probas):
        p, _ = _apply_safety(text, dict(zip(model.classes_, row)))
        out.append(max(p, key=p.get))
    return out


def _evaluate(model):
    Xt, yt = td.test_set()
    pred = _predict_batch(model, Xt)
    p, r, f, s = precision_recall_fscore_support(yt, pred, labels=td.CLASSES, zero_division=0)
    Xh, yh = zip(*td.EVAL_HANDWRITTEN)
    ph = _predict_batch(model, list(Xh))
    base_pred = [rule_classify(x) for x in Xt]
    base_h = [rule_classify(x) for x in Xh]
    return {
        "labels": td.CLASSES,
        "accuracy": float(accuracy_score(yt, pred)),
        "macro_f1": float(np.mean(f)),
        "per_class": [dict(cls=c, precision=float(p[i]), recall=float(r[i]), f1=float(f[i]), support=int(s[i]))
                      for i, c in enumerate(td.CLASSES)],
        "confusion": confusion_matrix(yt, pred, labels=td.CLASSES).tolist(),
        "n_test": len(yt),
        "handwritten_accuracy": float(accuracy_score(yh, ph)),
        "n_handwritten": len(yh),
        "baseline_accuracy": float(accuracy_score(yt, base_pred)),
        "baseline_handwritten_accuracy": float(accuracy_score(yh, base_h)),
        "handwritten_errors": [dict(text=x, truth=t, pred=str(p_)) for x, t, p_ in zip(Xh, yh, ph) if t != p_],
    }


def train(extra=None):
    """Train (or retrain with admin-corrected labels). extra = [(text, label), ...]"""
    global _model, _metrics
    X, y = td.train_set()
    n_extra = 0
    if extra:
        for text, label in extra:
            if label in td.CLASSES:
                X.extend([text] * 6)  # corrections are scarce, weight them up
                y.extend([label] * 6)
                n_extra += 1
    model = _build_pipeline().fit(X, y)
    m = _evaluate(model)
    m["n_train"] = len(X) - 5 * n_extra
    m["n_corrections"] = n_extra
    m["trained_at"] = int(__import__("time").time())
    os.makedirs(DATA_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    with open(METRICS_PATH, "w", encoding="utf-8") as fh:
        json.dump(m, fh)
    with _lock:
        _model, _metrics = model, m
    return m


def get_model():
    global _model, _metrics
    if _model is None:
        with _lock:
            if _model is None:
                if os.path.exists(MODEL_PATH) and os.path.exists(METRICS_PATH):
                    _model = joblib.load(MODEL_PATH)
                    with open(METRICS_PATH, encoding="utf-8") as fh:
                        _metrics = json.load(fh)
        if _model is None:
            train()
    return _model


def get_metrics():
    get_model()
    return _metrics


_DANGER = re.compile(r"spark|live wire|exposed wire|electrocut|electric shock|got a shock|shock lag|short[- ]?circuit|smok(e|ing)|"
                     r"चिंगारी|करंट|ठिणग्या|current aa|naked wire|dangling", re.I)


def classify(text):
    """Return (probs sorted desc [{cls,p}], override_flag, explanation tokens)."""
    model = get_model()
    proba = model.predict_proba([text])[0]
    classes = list(model.classes_)
    p, override = _apply_safety(text, dict(zip(classes, proba)))
    probs = sorted(({"cls": k, "p": float(v)} for k, v in p.items()), key=lambda x: -x["p"])
    return probs, override, _explain(text, probs[0]["cls"])


def _explain(text, cls):
    """Top word/bigram features pushing the prediction towards `cls` (coef * tf-idf)."""
    try:
        model = get_model()
        union, lr = model.named_steps["tfidf"], model.named_steps["clf"]
        wv = union.transformer_list[0][1]
        row = wv.transform([text])
        k = list(lr.classes_).index(cls)
        coef = lr.coef_[k][: len(wv.vocabulary_)]
        contrib = row.multiply(coef).tocoo()
        names = wv.get_feature_names_out()
        items = sorted(((names[j], float(v)) for j, v in zip(contrib.col, contrib.data) if v > 0), key=lambda x: -x[1])
        return [dict(token=t, weight=round(w, 3)) for t, w in items[:6]]
    except Exception:
        return []


# keyword-rule baseline (the approach the original static prototype used), kept for comparison
_LEX = {
    "outage": [(r"not (working|glowing|lit|burning|on\b)|no light|isn'?t (working|on)|is (off|dead|out)|went off|gone off|switched off|not lighting", 1.6),
               (r"band (hai|pada)|nahi (jal|chal)|andhera|अंधे?र|अंधार|बंद|नहीं जल", 1.8), (r"\bdark\b|darkness", .8)],
    "flicker": [(r"flicker|blink|on[- ]and[- ]off|on[- ]off|intermittent|strobe|jhilmil|fluctuat|flashing|flashes", 2.4)],
    "dayburn": [(r"day ?time|during the day|in the day|daylight|all day|24 ?(hrs|hours|x ?7)", 1.8),
                (r"(burning|glowing|lit)\b.{0,30}(day|morning)|(day|morning).{0,30}(burning|glowing)|not (switching|turning) off|always on|wasting (power|electricity)|din mein", 2.2)],
    "hazard": [(r"spark|exposed|live wire|hanging wire|wire (is )?hanging|hanging from|shock|electrocut|short[- ]?circuit|\bfire\b|smoke|burnt", 2.6),
               (r"(pole|post).{0,25}(lean|tilt|fall|fell|collaps|rust|broken|bent|damaged)|(leaning|tilted|fallen|collapsed|bent)\b.{0,25}(pole|post)", 2.4)],
    "dim": [(r"\bdim\b|dimly|low light|faint|barely (visible|lit)|weak light|poor (light|illumination)|kam roshni|yellowish|insufficient", 2.4)],
    "vandal": [(r"broken (glass|cover|fixture|lamp)|glass (is )?broken|smash|stolen|theft|stole|vandal|missing (cover|lamp|fixture|cable)|cable (is )?(cut|stolen)|cover missing|chori", 2.6)],
    "timer": [(r"timer|photocell|sensor|controller|panel|feeder|\bmcb\b|not (turning|switching) on|automatic(ally)?|schedule|contactor", 2.2)],
    "cluster": [(r"\b(whole|entire)\b|all (the )?(street ?)?(lights|lamps|poles)|multiple|several|row of|stretch|\b\d{1,2} (street ?)?(lights|lamps|poles)\b|sabhi|saari|पूरी|सभी", 2.3)],
}


def rule_classify(text):
    sc = {}
    for k, rules in _LEX.items():
        sc[k] = sum(w for pat, w in rules if re.search(pat, text, re.I))
    sc["outage"] += .6
    return max(sc, key=sc.get)


# ============================================================ duration / severity
_W = {"a": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7}
_UNIT = r"(hours?|days?|nights?|weeks?|months?|din|दिन|दिवस(?:ांपासून)?|घंटे|तास|ghante)"


def parse_duration_days(t):
    d = 0.0
    for m in re.finditer(r"\b(\d+|a|one|two|three|four|five|six|seven)\s+" + _UNIT, t, re.I):
        raw = m.group(1).lower()
        n = int(raw) if raw.isdigit() else _W[raw]
        u = m.group(2).lower()
        if u.startswith("week"):
            d = max(d, n * 7)
        elif u.startswith("month"):
            d = max(d, n * 30)
        elif u.startswith(("hour", "ghante", "घंटे", "तास")):
            d = max(d, n / 24)
        else:
            d = max(d, n)
    if re.search(r"since (yesterday|last night)|kal raat|कल रात|काल रात्री", t, re.I):
        d = max(d, 1)
    if re.search(r"last week|for a week", t, re.I):
        d = max(d, 7)
    return d


def severity(text, cls, dur):
    s = CLASS_META[cls]["base"]
    why = [f"Base level for “{CLASS_META[cls]['label']}”: {s}"]

    def add(pat, n, msg):
        nonlocal s
        if re.search(pat, text, re.I):
            s += n
            why.append(f"{msg}: +{n}")

    if cls != "hazard":
        add(r"spark|exposed|live wire|shock|\bfire\b|smoke|electrocut|चिंगारी|करंट", 25, "Electrical-danger words")
    add(r"school|college|hospital|clinic|station|bus ?stop|crossing|junction|flyover|bridge|highway|market|temple|mall|stadium|स्टेशन", 10, "High-footfall or critical location")
    add(r"women|girls|ladies|unsafe|dangerous|robbery|snatch|accident|crime|harass|theft|chori|danger|khatarnak|खतरा|धोका", 12, "Public-safety concern")
    add(r"child|kids|senior|elderly|patients?|students?", 4, "Vulnerable road users")
    add(r"night|evening|after dark|raat|अंधे?र|अंधार|रात", 3, "Night-time impact")
    if dur >= 7:
        s += 14
        why.append(f"Unresolved for {round(dur)}+ days: +14")
    elif dur >= 3:
        s += 8
        why.append(f"Unresolved for {round(dur)} days: +8")
    s = min(100, s)
    label = "Critical" if s >= 75 else "High" if s >= 55 else "Medium" if s >= 30 else "Low"
    return {"score": s, "label": label, "why": why}


# ============================================================ NER
_STOP = set("keeps keep stopped goes going gone does doesn't dont is are was were has have had light lights lamp lamps streetlight "
            "streetlights street pole poles since for from not no and but which that please kindly plz it its on off working broken "
            "dark very too also as when because so".split())
_ZONE_RES = [(z, re.compile(z["re"], re.I)) for z in geo.ZONES]
_LM_RES = [(lm, re.compile(lm[1], re.I)) for lm in geo.LANDMARKS]
_POLE = re.compile(r"\b(?:SL|LP|PL)[-\s#]?[A-Z]{0,3}[-\s]?\d{2,5}\b|\bpole\s*(?:no\.?|number|#)?\s*\d{1,5}\b", re.I)
_SECTOR = re.compile(r"\bsec(?:tor)?[\s.-]*(\d{1,2})[A-Z]?\b", re.I)
_ROAD = re.compile(r"\b(?:[A-Z][a-z]+\s){1,3}(?:Road|Rd|Marg|Chowk|Circle|Junction|Naka|Bridge|Flyover|Highway|Lane)\b")
_NEAR = re.compile(r"\b(?:near|opposite|opp|behind|beside|outside|in front of|next to|adjacent to|close to)\s+([\w&'-]+(?:\s+[\w&'-]+){0,3})", re.I)
_DUR = re.compile(r"\b(?:since |for |past )?(?:\d+|a|one|two|three|four|five|six|seven)\s+" + _UNIT + r"\b|"
                  r"\bsince (?:yesterday|last (?:night|week|month))\b|\b\d+\s*(?:दिन|दिवसांपासून)\s*(?:से)?|कल रात से|काल रात्रीपासून|kal raat se", re.I)
_FAULT = re.compile(r"flicker\w*|not working|not glowing|sparks?|sparking|exposed wires?|hanging wire|dangling|leaning|tilted|\bdim\b|"
                    r"broken \w+|stolen|band hai|timer|no lights?|darkness|andhera|not (?:switching|turning) (?:on|off)|wire hanging|"
                    r"बंद|अंधे?रा|अंधार|चिंगारी|टिमटिमा\w*|लुकलुकत\w*", re.I)
_TYPE = {"POLE_ID": "POLE", "LOCATION": "LOC", "LANDMARK": "LMK", "DURATION": "TIME", "FAULT": "FAULT"}


def ner(t):
    sp = []

    def add(s, e, label):
        if e > s:
            sp.append({"s": s, "e": e, "label": label, "text": t[s:e]})

    for m in _POLE.finditer(t):
        add(m.start(), m.end(), "POLE_ID")
    for z, rx in _ZONE_RES:
        for m in rx.finditer(t):
            add(m.start(), m.end(), "LOCATION")
    for m in _SECTOR.finditer(t):
        add(m.start(), m.end(), "LOCATION")
    for m in _ROAD.finditer(t):
        add(m.start(), m.end(), "LOCATION")
    for lm, rx in _LM_RES:
        for m in rx.finditer(t):
            add(m.start(), m.end(), "LANDMARK")
    for z, rx in _ZONE_RES:  # "<zone> station"
        for m in re.finditer(rf"(?:{z['re']})\s+{geo.STATION_RE}", t, re.I):
            add(m.start(), m.end(), "LANDMARK")
    for m in _NEAR.finditer(t):
        cap = m.group(1)
        base = m.end() - len(cap)
        first, end, up = -1, -1, False
        for w in re.finditer(r"[\w&'-]+", cap):
            lw = w.group(0).lower()
            if first < 0 and lw in ("the", "a"):
                continue
            if lw in _STOP:
                break
            if first < 0:
                up = bool(re.match(r"[A-Z]", w.group(0)))
            elif up and not re.match(r"[A-Z]", w.group(0)) and lw not in ("of", "and", "&"):
                break
            if first < 0:
                first = w.start()
            end = w.end()
        if first >= 0:
            add(base + first, base + end, "LANDMARK")
    for m in _DUR.finditer(t):
        add(m.start(), m.end(), "DURATION")
    for m in _FAULT.finditer(t):
        add(m.start(), m.end(), "FAULT")
    sp.sort(key=lambda x: (x["s"], -(x["e"] - x["s"])))
    out, end = [], -1
    for x in sp:
        if x["s"] >= end:
            out.append(x)
            end = x["e"]
    return out


# ============================================================ geocoding
def _sector_point(zone, sector):
    bearing = (sector * 47) % 360
    dist = 160 + (sector * 23) % 520
    return geo.offset(zone["lat"], zone["lng"], bearing, dist)


def geocode(t, gps=None):
    """Resolve text to a point. Returns dict(lat,lng,zone,conf,by) or None."""
    if gps:
        z = geo.nearest_zone(*gps)
        return dict(lat=gps[0], lng=gps[1], zone=z["id"], conf=0.99, by="GPS pin shared by the citizen")
    for lm, rx in _LM_RES:
        if rx.search(t):
            return dict(lat=lm[3], lng=lm[4], zone=lm[2], conf=0.95, by="Landmark: " + lm[0])
    for z, _ in _ZONE_RES:
        if re.search(rf"(?:{z['re']})\s+{geo.STATION_RE}", t, re.I):
            return dict(lat=z["station"][0], lng=z["station"][1], zone=z["id"], conf=0.93, by=f"Landmark: {z['name']} Station")
    sec = _SECTOR.search(t)
    for z, rx in _ZONE_RES:
        if rx.search(t):
            if sec:
                lat, lng = _sector_point(z, int(sec.group(1)))
                return dict(lat=round(lat, 6), lng=round(lng, 6), zone=z["id"], conf=0.78, by=f"Sector {sec.group(1)}, {z['name']}")
            return dict(lat=z["lat"], lng=z["lng"], zone=z["id"], conf=0.72, by="Area name: " + z["name"])
    return None


def extract_pole_ids(t):
    return [re.sub(r"[\s#]+", "-", m.group(0).upper()) for m in re.finditer(r"\bSL[-\s]?([A-Z]{3})[-\s]?(\d{3})\b", t, re.I)]


# ============================================================ public entry point
def understand(text, channel="Web portal", gps=None):
    clean, prep = normalize(text, channel)
    lang = detect_language(clean)
    probs, override, why = classify(clean) if clean else ([{"cls": "outage", "p": 1.0}], None, [])
    cls = probs[0]["cls"]
    dur = parse_duration_days(clean)
    sev = severity(clean, cls, dur)
    geo_hit = geocode(clean, gps)
    poles = []
    for m in re.finditer(r"\bSL[-\s]?([A-Z]{3})[-\s]?(\d{3})\b", clean, re.I):
        poles.append(f"SL-{m.group(1).upper()}-{m.group(2)}")
    return dict(raw=text, text=clean, prep=prep, lang=lang, probs=probs, cls=cls, conf=probs[0]["p"], override=override,
                why_tokens=why, ents=ner(clean), dur_days=dur, sev=sev, geo=geo_hit, pole_ids=poles)
