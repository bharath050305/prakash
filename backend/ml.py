"""Predictive analytics: lamp failure risk (gradient boosting), weekly fault forecast (damped Holt), hotspot clustering (DBSCAN)."""
import json
import math
import os
import threading
import time

import joblib
import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

from . import db, geo
from .nlp import CLASS_META

DATA_DIR = db.DATA_DIR
RISK_PATH = os.path.join(DATA_DIR, "risk_model.joblib")
RISK_META = os.path.join(DATA_DIR, "risk_model_meta.json")

FEATURES = ["age", "faults_90d", "volt_var", "rain_7d", "driver", "burn_hours", "pole_cond"]
FEATURE_LABELS = {
    "age": "Lamp age", "faults_90d": "Faults in last 90 days", "volt_var": "Supply voltage fluctuation",
    "rain_7d": "Rainfall (7-day)", "driver": "Driver / ballast type", "burn_hours": "Burning hours", "pole_cond": "Pole condition",
}
_lock = threading.Lock()
_risk = None
_meta = None


# ------------------------------------------------------------ failure-risk model
def _synth(n, seed):
    """Synthetic training set: the hidden 'physics' is a logistic function of the features plus noise."""
    r = np.random.default_rng(seed)
    age = r.integers(1, 12, n)
    f90 = np.clip(np.round(r.gamma(1.0, 1.1, n)), 0, 8)
    volt = np.clip(r.normal(.38, .2, n), 0, 1)
    rain = np.clip(r.gamma(2.0, 28, n), 0, 400)
    driver = r.choice([0, 1, 2], n, p=[.3, .3, .4])
    burn = r.normal(4200, 350, n)
    pole = np.clip(r.normal(.3 + age * .04, .18, n), 0, 1)
    z = (-7.1 + .24 * age + .62 * f90 + 2.3 * volt + .011 * rain + .75 * (driver == 0) - .5 * (driver == 2)
         + .0012 * (burn - 4000) + 1.5 * pole + r.normal(0, .55, n))
    y = (r.random(n) < 1 / (1 + np.exp(-z))).astype(int)
    return np.column_stack([age, f90, volt, rain, driver, burn, pole]), y


def train_risk():
    global _risk, _meta
    X, y = _synth(6000, 7)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=.25, random_state=3, stratify=y)
    m = GradientBoostingClassifier(n_estimators=140, max_depth=3, learning_rate=.08, subsample=.85, random_state=3).fit(Xtr, ytr)
    p = m.predict_proba(Xte)[:, 1]
    top = np.argsort(-p)[: len(p) // 10]
    meta = dict(
        auc=float(roc_auc_score(yte, p)), accuracy=float(accuracy_score(yte, p > .5)), brier=float(brier_score_loss(yte, p)),
        base_rate=float(y.mean()), precision_top10=float(yte[top].mean()), n_train=len(ytr), n_test=len(yte),
        importance=[dict(feature=f, label=FEATURE_LABELS[f], value=float(v)) for f, v in
                    sorted(zip(FEATURES, m.feature_importances_), key=lambda x: -x[1])],
        trained_at=int(time.time()),
    )
    joblib.dump(m, RISK_PATH)
    with open(RISK_META, "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    with _lock:
        _risk, _meta = m, meta
    return meta


def get_risk_model():
    global _risk, _meta
    if _risk is None:
        with _lock:
            if _risk is None and os.path.exists(RISK_PATH) and os.path.exists(RISK_META):
                _risk = joblib.load(RISK_PATH)
                with open(RISK_META, encoding="utf-8") as fh:
                    _meta = json.load(fh)
        if _risk is None:
            train_risk()
    return _risk


def risk_meta():
    get_risk_model()
    return _meta


_ZONE_RAIN = {"airoli": 1.0, "ghansoli": 1.05, "vashi": 1.0, "sanpada": 0.95, "nerul": 1.1, "seawoods": 1.15, "belapur": 1.05, "kharghar": 0.9}


def score_lamps(conn, rain_mm=None, now_ms=None):
    """Failure probability within 14 days for every lamp, plus the dominant driver of each score."""
    model = get_risk_model()
    now_ms = now_ms or db.now()
    if rain_mm is None:
        rain_mm = db.setting(conn, "rain_mm")
    lamps = conn.execute("SELECT * FROM lamps ORDER BY id").fetchall()
    since = now_ms - 90 * 86400000
    f90 = {r["lamp_id"]: r["n"] for r in conn.execute(
        "SELECT lamp_id, COUNT(*) n FROM tickets WHERE lamp_id IS NOT NULL AND kind='complaint' AND ts>=? GROUP BY lamp_id", (since,))}
    X = np.array([[l["age"], f90.get(l["id"], 0), l["volt_var"], rain_mm * _ZONE_RAIN.get(l["zone"], 1), l["driver"],
                   l["burn_hours"], l["pole_cond"]] for l in lamps], dtype=float)
    if not len(X):
        return []
    p = model.predict_proba(X)[:, 1]
    # attribution: swap each feature for the fleet median and see how far the risk drops
    med = np.median(X, axis=0)
    drops = np.zeros_like(X)
    for j in range(X.shape[1]):
        Xj = X.copy()
        Xj[:, j] = med[j]
        drops[:, j] = p - model.predict_proba(Xj)[:, 1]
    out = []
    for i, l in enumerate(lamps):
        j = int(np.argmax(drops[i]))
        f = FEATURES[j]
        reason = {
            "age": f"Lamp is {int(X[i, 0])} years old",
            "faults_90d": f"{int(X[i, 1])} fault(s) in the last 90 days",
            "volt_var": "Unstable supply voltage on this circuit",
            "rain_7d": "Heavy recent rainfall",
            "driver": "Old magnetic-ballast driver" if l["driver"] == 0 else "Driver type",
            "burn_hours": "Very high burning hours",
            "pole_cond": "Corroded pole / poor pole condition",
        }[f]
        out.append(dict(id=l["id"], lat=l["lat"], lng=l["lng"], zone=l["zone"], age=l["age"], status=l["status"],
                        faults_90d=int(X[i, 1]), risk=float(p[i]), reason=reason, driver_feature=f,
                        driver_type=["Magnetic ballast", "Electronic", "LED"][l["driver"]]))
    return out


# ------------------------------------------------------------ forecasting
def weekly_counts(conn, weeks=12, now_ms=None):
    now_ms = now_ms or db.now()
    week = 7 * 86400000
    rows = conn.execute("SELECT ts FROM tickets WHERE kind='complaint' AND ts>=?", (now_ms - weeks * week,)).fetchall()
    counts = [0] * weeks
    for r in rows:
        idx = weeks - 1 - int((now_ms - r["ts"]) // week)
        if 0 <= idx < weeks:
            counts[idx] += 1
    return counts


def holt_forecast(y, horizon=6):
    """Damped-trend Holt smoothing; alpha/beta/phi grid-searched on one-step-ahead error. 80% interval from residual spread."""
    y = np.asarray(y, dtype=float)
    best = None
    for a in (.2, .35, .5, .65, .8):
        for b in (.05, .15, .3):
            for phi in (.8, .9, .98):
                l, t = y[0], y[1] - y[0] if len(y) > 1 else 0
                sse, res = 0.0, []
                for v in y[1:]:
                    pred = l + phi * t
                    res.append(v - pred)
                    sse += (v - pred) ** 2
                    ln = a * v + (1 - a) * (l + phi * t)
                    t = b * (ln - l) + (1 - b) * phi * t
                    l = ln
                if best is None or sse < best[0]:
                    best = (sse, a, b, phi, l, t, res)
    sse, a, b, phi, l, t, res = best
    sigma = float(np.std(res)) if len(res) > 2 else max(1.0, float(np.std(y)))
    fc, lo, hi, damp = [], [], [], 0.0
    for h in range(1, horizon + 1):
        damp += phi ** h
        f = max(0.0, l + damp * t)
        w = 1.28 * sigma * math.sqrt(1 + .35 * (h - 1))
        fc.append(f)
        lo.append(max(0.0, f - w))
        hi.append(f + w)
    mape = float(np.mean([abs(r) / max(1, abs(v)) for r, v in zip(res, y[1:])])) if res else 0.0
    return dict(fcst=[round(float(x), 1) for x in fc], lo=[round(float(x), 1) for x in lo], hi=[round(float(x), 1) for x in hi],
                params=dict(alpha=a, beta=b, phi=phi), sigma=round(sigma, 2), mape=round(mape, 3))


def forecast(conn, weeks=12, horizon=6):
    y = weekly_counts(conn, weeks)
    out = holt_forecast(y, horizon)
    out["actual"] = y
    out["next14"] = round(sum(out["fcst"][:2]), 0)
    out["next14_band"] = round((sum(out["hi"][:2]) - sum(out["lo"][:2])) / 2, 0)
    return out


# ------------------------------------------------------------ hotspots
def _dbscan(points, eps_m, min_samples):
    if len(points) < min_samples:
        return np.array([-1] * len(points))
    rad = np.radians(np.array(points))
    return DBSCAN(eps=eps_m / 6371000.0, min_samples=min_samples, metric="haversine", algorithm="ball_tree").fit(rad).labels_


def hotspots(conn, risk=None, now_ms=None):
    """Current hotspots (faulty lamps now), recurring hotspots (90-day ticket history) and per-zone statistics."""
    now_ms = now_ms or db.now()
    faulty = conn.execute("SELECT * FROM lamps WHERE status!='ok'").fetchall()
    cur = []
    labels = _dbscan([(l["lat"], l["lng"]) for l in faulty], 170, 3)
    for lab in sorted(set(labels) - {-1}):
        members = [l for l, x in zip(faulty, labels) if x == lab]
        clat = sum(m["lat"] for m in members) / len(members)
        clng = sum(m["lng"] for m in members) / len(members)
        rad = max(geo.haversine_m(clat, clng, m["lat"], m["lng"]) for m in members) + 40
        ids = [m["id"] for m in members]
        tk = conn.execute(f"SELECT id,cls,sev FROM tickets WHERE lamp_id IN ({','.join('?' * len(ids))}) AND status NOT IN ('resolved','rejected')", ids).fetchall()
        zone = geo.nearest_zone(clat, clng)
        cause = ("Probable shared cause: feeder pillar / MCB trip serving this stretch. One inspection may clear several tickets."
                 if len(members) >= 4 else "Several adjacent lamps failing: check the common supply cable and junction box.")
        cur.append(dict(lat=clat, lng=clng, radius=rad, n=len(members), lamps=ids, zone=zone["id"], zone_name=zone["name"],
                        tickets=[t["id"] for t in tk], avg_sev=round(sum(t["sev"] for t in tk) / len(tk)) if tk else 0, cause=cause))
    cur.sort(key=lambda c: -c["n"])

    since = now_ms - 90 * 86400000
    hist = conn.execute("SELECT id,lat,lng,lamp_id,cls FROM tickets WHERE kind='complaint' AND lat IS NOT NULL AND ts>=?", (since,)).fetchall()
    rec = []
    labels = _dbscan([(t["lat"], t["lng"]) for t in hist], 75, 8)
    for lab in sorted(set(labels) - {-1}):
        members = [t for t, x in zip(hist, labels) if x == lab]
        clat = sum(m["lat"] for m in members) / len(members)
        clng = sum(m["lng"] for m in members) / len(members)
        rad = max(geo.haversine_m(clat, clng, m["lat"], m["lng"]) for m in members) + 40
        zone = geo.nearest_zone(clat, clng)
        counts = {}
        for m in members:
            counts[m["cls"]] = counts.get(m["cls"], 0) + 1
        top = max(counts, key=counts.get)
        lamps = len({m["lamp_id"] for m in members if m["lamp_id"]})
        rec.append(dict(lat=clat, lng=clng, radius=rad, n=len(members), zone=zone["id"], zone_name=zone["name"], lamps=lamps,
                        top_class=top, top_label=CLASS_META[top]["label"],
                        action="Replace the driver / re-cable this stretch instead of repeating spot repairs."
                        if counts[top] >= 0.5 * len(members) else "Audit the circuit: repeated faults of mixed types."))
    rec.sort(key=lambda c: -c["n"])

    risk = risk if risk is not None else score_lamps(conn)
    f90 = {}
    for r in conn.execute("SELECT zone, COUNT(*) n FROM tickets WHERE kind='complaint' AND ts>=? AND zone IS NOT NULL GROUP BY zone", (since,)):
        f90[r["zone"]] = r["n"]
    zones = []
    for z in geo.ZONES:
        L = [x for x in risk if x["zone"] == z["id"]]
        zones.append(dict(id=z["id"], name=z["name"], lat=z["lat"], lng=z["lng"], lamps=len(L),
                          open=sum(1 for x in L if x["status"] != "ok"), f90=f90.get(z["id"], 0),
                          avg_risk=float(np.mean([x["risk"] for x in L])) if L else 0.0,
                          high_risk=sum(1 for x in L if x["risk"] >= .55)))
    zones.sort(key=lambda z: (-z["open"], -z["f90"]))
    return dict(current=cur, recurring=rec, zones=zones)
