"""Business logic: ingest complaints from any channel, de-duplicate, triage, dispatch, resolve, alert, report."""
import json
import time
from collections import Counter

from . import db, geo, ml, nlp, scheduler
from .events import hub
from .nlp import CLASS_META

OPEN_STATES = ("open", "review", "assigned", "in_progress")
LIVE_STATES = ("open", "review", "assigned", "in_progress")
CHANNELS = ["WhatsApp", "Web portal", "Call centre", "X / Twitter", "Email", "SMS"]
H = 3600000


# ------------------------------------------------------------------ helpers
def code(tid):
    return f"TKT-{tid}"


def log_event(conn, tid, actor, kind, detail="", ts=None):
    conn.execute("INSERT INTO ticket_events(ticket_id,ts,actor,kind,detail) VALUES(?,?,?,?,?)", (tid, ts or db.now(), actor, kind, detail))


def audit(conn, user, action, detail=""):
    conn.execute("INSERT INTO audit(ts,user_id,user_name,action,detail) VALUES(?,?,?,?,?)",
                 (db.now(), user["id"] if user else None, user["name"] if user else "system", action, detail))


def notify(conn, user_id, title, body="", ticket_id=None):
    if not user_id:
        return
    conn.execute("INSERT INTO notifications(user_id,ts,title,body,ticket_id) VALUES(?,?,?,?,?)", (user_id, db.now(), title, body, ticket_id))
    hub.publish("notify", {"title": title, "body": body, "ticket_id": ticket_id}, roles=(), user_ids=(user_id,))


def sla_state(t, now_ms=None):
    now_ms = now_ms or db.now()
    if t["status"] == "resolved":
        return "met" if (t["resolved_ts"] or now_ms) <= (t["due_ts"] or 0) else "missed"
    if t["status"] == "rejected" or not t["due_ts"]:
        return "none"
    if now_ms > t["due_ts"]:
        return "breached"
    return "at_risk" if t["due_ts"] - now_ms < 2 * H else "ok"


def ticket_dict(conn, r, level="admin", now_ms=None):
    """level: 'admin' (everything), 'owner' (reporter / technician view), 'public' (anonymous summary)."""
    tech = None
    if r["tech_id"]:
        tech = conn.execute("SELECT id,name,color FROM technicians WHERE id=?", (r["tech_id"],)).fetchone()
    meta = CLASS_META.get(r["cls"], CLASS_META["outage"])
    z = geo.ZM.get(r["zone"]) if r["zone"] else None
    d = dict(id=r["id"], code=code(r["id"]), ts=r["ts"], channel=r["channel"], kind=r["kind"], text=r["text"], lang=r["lang"],
             cls=r["cls"], cls_label=meta["label"], color=meta["color"], sev=r["sev"], sev_label=r["sev_label"], zone=r["zone"],
             zone_name=z["name"] if z else None, lat=r["lat"], lng=r["lng"], lamp_id=r["lamp_id"], status=r["status"],
             due_ts=r["due_ts"], reports=r["reports"], tech_name=tech["name"] if tech else None,
             tech_color=tech["color"] if tech else None, eta_ts=r["eta_ts"], resolved_ts=r["resolved_ts"], started_ts=r["started_ts"],
             rating=r["rating"], sla=sla_state(r, now_ms), photo=r["photo"])
    if level == "public":
        d["text"] = None
        return d
    d.update(resolution_note=r["resolution_note"], parts_used=r["parts_used"], feedback=r["feedback"], auto_reply=r["auto_reply"],
             reporter_name=r["reporter_name"], review_reason=r["review_reason"], route_seq=r["route_seq"])
    if level == "admin":
        d.update(clean_text=r["clean_text"], conf=r["conf"], sev_why=json.loads(r["sev_why"]), entities=json.loads(r["entities"]),
                 probs=json.loads(r["probs"]), why_tokens=json.loads(r["why_tokens"]), geo_by=r["geo_by"], geo_conf=r["geo_conf"],
                 tech_id=r["tech_id"], reporter_id=r["reporter_id"], needs=meta["needs"], dept=meta["dept"], parts=meta["parts"],
                 mins=meta["mins"])
    return d


def get_ticket(conn, tid):
    return conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()



def pub_ticket(conn, tid, action, user_ids=(), **extra):
    """Push a ticket change: full detail to admins, owner-level detail to the people involved."""
    row = get_ticket(conn, tid)
    hub.publish("ticket", dict(action=action, ticket=ticket_dict(conn, row, "admin"), **extra))
    uids = tuple(u for u in user_ids if u)
    if uids:
        hub.publish("ticket", dict(action=action, ticket=ticket_dict(conn, row, "owner"), **extra), roles=(), user_ids=uids)


def events_for(conn, tid):
    return [dict(ts=e["ts"], actor=e["actor"], kind=e["kind"], detail=e["detail"])
            for e in conn.execute("SELECT * FROM ticket_events WHERE ticket_id=? ORDER BY ts,id", (tid,))]


# ------------------------------------------------------------------ auto reply
REPLIES = {
    "English": dict(
        ok="Thank you. We logged your report{loc} as {code} ({sev} priority). A crew will visit within {h} hours. We will message you once it is fixed.",
        review="Thank you. We could not tell exactly where the light is. Please reply with a nearby landmark or share your location pin so we can send a crew.",
        dup="Thanks! This fault is already logged as {code}. We added your report to it ({n} citizens have now confirmed it), which raises its priority."),
    "Hinglish": dict(
        ok="Shukriya. Aapki shikayat{loc} {code} ({sev} priority) ke roop me darj ho gayi hai. Crew {h} ghante ke andar aayegi. Theek hone par hum aapko message karenge.",
        review="Shukriya. Hum light ki exact jagah nahi samajh paye. Kripya paas ka landmark ya location pin bhejiye.",
        dup="Shukriya! Yeh fault pehle se {code} me darj hai. Aapki report jod di gayi hai ({n} logon ne confirm kiya)."),
    "Hindi": dict(
        ok="धन्यवाद। आपकी शिकायत{loc} {code} ({sev} प्राथमिकता) के रूप में दर्ज हो गई है। टीम {h} घंटे के भीतर आएगी। ठीक होने पर हम आपको सूचित करेंगे।",
        review="धन्यवाद। हम लाइट की सही जगह नहीं समझ पाए। कृपया पास का लैंडमार्क या लोकेशन पिन भेजें।",
        dup="धन्यवाद! यह खराबी पहले से {code} में दर्ज है। आपकी रिपोर्ट जोड़ दी गई है ({n} नागरिकों ने पुष्टि की)।"),
    "Marathi": dict(
        ok="धन्यवाद. तुमची तक्रार{loc} {code} ({sev} प्राधान्य) म्हणून नोंदवली आहे. पथक {h} तासांत येईल. दुरुस्ती झाल्यावर आम्ही कळवू.",
        review="धन्यवाद. दिव्याचे नेमके ठिकाण समजले नाही. कृपया जवळची खूण किंवा लोकेशन पिन पाठवा.",
        dup="धन्यवाद! हा बिघाड आधीच {code} म्हणून नोंदवला आहे. तुमची तक्रार जोडली आहे ({n} नागरिकांनी पुष्टी केली)."),
}


def make_reply(lang, kind, code_, sev="", hours=0, loc="", n=1):
    t = REPLIES.get(lang, REPLIES["English"])[kind]
    return t.format(code=code_, sev=sev.lower() if lang in ("English", "Hinglish") else sev, h=hours, loc=loc, n=n)


# ------------------------------------------------------------------ lamp snapping / dedupe
def snap_lamp(conn, lat, lng, max_m, prefer_faulty=True):
    best, bd = None, 1e18
    for l in conn.execute("SELECT id,lat,lng,zone,status FROM lamps"):
        d = geo.haversine_m(lat, lng, l["lat"], l["lng"])
        if d > max_m:
            continue
        score = d + (0 if l["status"] != "ok" or not prefer_faulty else 35)
        if score < bd:
            best, bd = l, score
    return best


def find_duplicate(conn, lamp_id, lat, lng, cls, exact=False):
    if lamp_id:
        r = conn.execute(f"SELECT * FROM tickets WHERE lamp_id=? AND kind='complaint' AND status IN ({','.join('?' * len(LIVE_STATES))}) ORDER BY ts DESC LIMIT 1",
                         (lamp_id, *LIVE_STATES)).fetchone()
        if r:
            return r
    if lat is not None and not exact:
        for r in conn.execute(f"SELECT * FROM tickets WHERE kind='complaint' AND lat IS NOT NULL AND cls=? AND status IN ({','.join('?' * len(LIVE_STATES))})",
                              (cls, *LIVE_STATES)):
            if geo.haversine_m(lat, lng, r["lat"], r["lng"]) <= 110:
                return r
    return None


# ------------------------------------------------------------------ ingest
def analyze_preview(conn, text, channel="Web portal", gps=None):
    """Run the whole NLP pipeline without creating anything; also report lamp + duplicate."""
    u = nlp.understand(text, channel, gps)
    lamp, dup = _resolve(conn, u)
    return u, lamp, dup


def _resolve(conn, u):
    lamp, g = None, u["geo"]
    for pid in u["pole_ids"]:
        lamp = conn.execute("SELECT * FROM lamps WHERE id=?", (pid,)).fetchone()
        if lamp:
            u["geo"] = g = dict(lat=lamp["lat"], lng=lamp["lng"], zone=lamp["zone"], conf=0.98, by="Pole ID: " + lamp["id"])
            break
    if not lamp and g:
        radius = 120 if g["conf"] >= .99 else 450 if g["conf"] >= .9 else 700
        lamp = snap_lamp(conn, g["lat"], g["lng"], radius)
    dup = find_duplicate(conn, lamp["id"] if lamp else None, g["lat"] if g else None, g["lng"] if g else None, u["cls"],
                         exact=bool(g and g["conf"] >= .98))
    return lamp, dup


def ingest(conn, text, channel="Web portal", reporter=None, gps=None, photo=None, actor=None, ts=None, guest_name=None,
           notify_admins=True):
    """The full pipeline for one complaint. Returns dict(ticket, merged, analysis, reply)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Complaint text is empty")
    ts = ts or db.now()
    u = nlp.understand(text, channel, gps)
    lamp, dup = _resolve(conn, u)
    g = u["geo"]
    sla = db.setting(conn, "sla_hours")
    thr = db.setting(conn, "review_threshold")
    who = actor or ("Citizen: " + reporter["name"] if reporter else f"Channel: {channel}")
    rname = reporter["name"] if reporter else (guest_name or "Anonymous")

    # ---- merge into an existing live ticket
    if dup is not None:
        conn.execute("INSERT INTO ticket_reports(ticket_id,user_id,ts,channel,text) VALUES(?,?,?,?,?)",
                     (dup["id"], reporter["id"] if reporter else None, ts, channel, text))
        conn.execute("UPDATE tickets SET reports=reports+1 WHERE id=?", (dup["id"],))
        log_event(conn, dup["id"], who, "merged", f"Another report via {channel}: “{text[:120]}”")
        n = dup["reports"] + 1
        reply = make_reply(u["lang"], "dup", code(dup["id"]), n=n)
        conn.commit()
        t = ticket_dict(conn, get_ticket(conn, dup["id"]))
        hub.publish("ticket", dict(action="merged", ticket=t, channel=channel))
        return dict(ticket=t, merged=True, analysis=u, reply=reply, lamp=dict(lamp) if lamp else None)

    # ---- new ticket
    review_reason = None
    if not g:
        review_reason = "No location could be extracted"
    elif not lamp:
        review_reason = "No lamp found near that location"
    elif g["conf"] < 0.75 and not lamp:
        review_reason = "Location too vague to pick a lamp"
    elif g["conf"] < 0.75:
        review_reason = "Only an area name was found (no landmark, pole ID or GPS)"
    elif u["conf"] < thr:
        review_reason = f"Classifier confidence {round(u['conf'] * 100)}% is below the {round(thr * 100)}% threshold"
    status = "review" if review_reason else "open"
    sev = u["sev"]
    due = ts + sla[sev["label"]] * H
    cur = conn.execute(
        """INSERT INTO tickets(ts,channel,kind,text,clean_text,lang,cls,conf,sev,sev_label,sev_why,entities,probs,why_tokens,zone,lat,lng,lamp_id,
           geo_by,geo_conf,status,due_ts,reporter_id,reporter_name,photo,review_reason)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (ts, channel, "complaint", text, u["text"], u["lang"], u["cls"], u["conf"], sev["score"], sev["label"], json.dumps(sev["why"]),
         json.dumps(u["ents"]), json.dumps([dict(cls=p["cls"], p=round(p["p"], 4)) for p in u["probs"]]), json.dumps(u["why_tokens"]),
         g["zone"] if g else None, g["lat"] if g else None, g["lng"] if g else None, lamp["id"] if lamp else None,
         g["by"] if g else None, g["conf"] if g else None, status, due, reporter["id"] if reporter else None, rname, photo, review_reason))
    tid = cur.lastrowid
    log_event(conn, tid, who, "received", f"Received via {channel} ({u['lang']})", ts=ts)
    for s in u["prep"]:
        log_event(conn, tid, "AI pipeline", "prep", s, ts=ts)
    log_event(conn, tid, "AI pipeline", "classified",
              f"{CLASS_META[u['cls']]['label']} ({round(u['conf'] * 100)}%)" + (f" – {u['override']}" if u["override"] else ""), ts=ts)
    log_event(conn, tid, "AI pipeline", "severity", f"{sev['label']} ({sev['score']}/100)", ts=ts)
    if g:
        log_event(conn, tid, "AI pipeline", "located", g["by"] + (f" → lamp {lamp['id']}" if lamp else ""), ts=ts)
    if review_reason:
        log_event(conn, tid, "AI pipeline", "review", review_reason, ts=ts)
    elif lamp and lamp["status"] == "ok":
        conn.execute("UPDATE lamps SET status='fault' WHERE id=?", (lamp["id"],))
    hours = sla[sev["label"]]
    loc = f" near {geo.ZM[g['zone']]['name']}" if g else ""
    reply = make_reply(u["lang"], "review" if review_reason else "ok", code(tid), sev["label"], hours, loc)
    conn.execute("UPDATE tickets SET auto_reply=? WHERE id=?", (reply, tid))
    log_event(conn, tid, "AI pipeline", "autoreply", f"Reply sent via {channel} (simulated)", ts=ts)
    if reporter:
        notify(conn, reporter["id"], f"Report received: {code(tid)}", reply, tid)
    conn.commit()

    t = ticket_dict(conn, get_ticket(conn, tid))
    hub.publish("ticket", dict(action="created", ticket=t, channel=channel))
    if sev["label"] == "Critical" and status == "open":
        hub.publish("alert", dict(level="Critical", title=f"Critical fault: {t['cls_label']} in {t['zone_name'] or 'unknown zone'}",
                                  detail=f"{t['code']} via {channel}", ticket_id=tid))
        if db.setting(conn, "auto_dispatch_critical"):
            try:
                auto_dispatch(conn, tid)
            except Exception:
                conn.rollback()
        t = ticket_dict(conn, get_ticket(conn, tid))
    return dict(ticket=t, merged=False, analysis=u, reply=reply, lamp=dict(lamp) if lamp else None)


def create_preventive(conn, lamp_ids, user):
    now = db.now()
    sla = db.setting(conn, "sla_hours")
    made = []
    risk = {r["id"]: r for r in ml.score_lamps(conn)}
    for lid in lamp_ids:
        l = conn.execute("SELECT * FROM lamps WHERE id=?", (lid,)).fetchone()
        if not l or conn.execute("SELECT 1 FROM tickets WHERE lamp_id=? AND status IN ('open','assigned','in_progress','review')", (lid,)).fetchone():
            continue
        r = risk.get(lid)
        txt = f"Preventive inspection: predicted {round(r['risk'] * 100)}% failure risk in 14 days ({r['reason']})." if r else "Preventive inspection"
        cur = conn.execute(
            """INSERT INTO tickets(ts,channel,kind,text,clean_text,lang,cls,conf,sev,sev_label,zone,lat,lng,lamp_id,geo_by,geo_conf,status,due_ts,reporter_name)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (now, "Predictive AI", "preventive", txt, txt, "English", "preventive", 1.0, 25, "Low", l["zone"], l["lat"], l["lng"], lid,
             "Lamp register", 1.0, "open", now + sla["Low"] * H, "Predictive model"))
        log_event(conn, cur.lastrowid, "Predictive AI", "received", txt)
        audit(conn, user, "preventive_ticket", lid)
        made.append(cur.lastrowid)
    conn.commit()
    for tid in made:
        hub.publish("ticket", dict(action="created", ticket=ticket_dict(conn, get_ticket(conn, tid)), channel="Predictive AI"))
    return made


# ------------------------------------------------------------------ lifecycle
def _lamp_refresh(conn, lamp_id):
    if not lamp_id:
        return
    live = conn.execute("SELECT status FROM tickets WHERE lamp_id=? AND status IN ('open','assigned','in_progress','review')", (lamp_id,)).fetchall()
    if not live:
        st = "ok"
    elif any(r["status"] in ("assigned", "in_progress") for r in live):
        st = "assigned"
    else:
        st = "fault"
    conn.execute("UPDATE lamps SET status=? WHERE id=?", (st, lamp_id))


def recompute_route(conn, tech_id):
    tech = conn.execute("SELECT * FROM technicians WHERE id=?", (tech_id,)).fetchone()
    rows = conn.execute("SELECT * FROM tickets WHERE tech_id=? AND status IN ('assigned','in_progress') ORDER BY route_seq", (tech_id,)).fetchall()
    jobs = [dict(id=r["id"], lat=r["lat"], lng=r["lng"], cls=r["cls"]) for r in rows]
    t = dict(depot_lat=tech["depot_lat"], depot_lng=tech["depot_lng"])
    _, _, times = scheduler.simulate(jobs, t, db.now())
    for i, (r, (eta, _fin)) in enumerate(zip(rows, times), 1):
        conn.execute("UPDATE tickets SET route_seq=?, eta_ts=? WHERE id=?", (i, int(eta), r["id"]))


def _tech_dict(r):
    d = dict(r)
    d["skills"] = json.loads(d["skills"])
    d["on_shift"] = bool(d["on_shift"])
    return d


def assign(conn, tid, tech_id, actor, front=False):
    t = get_ticket(conn, tid)
    tech = conn.execute("SELECT * FROM technicians WHERE id=?", (tech_id,)).fetchone()
    if not t or not tech:
        raise ValueError("Unknown ticket or technician")
    if t["lat"] is None:
        raise ValueError("Ticket has no location yet. Fix the location first.")
    need = set(CLASS_META[t["cls"]]["needs"])
    if not need <= set(json.loads(tech["skills"])):
        raise ValueError(f"{tech['name']} lacks the required skills: {', '.join(sorted(need))}")
    mx = conn.execute("SELECT COALESCE(MAX(route_seq),0) m, COALESCE(MIN(route_seq),1) n FROM tickets WHERE tech_id=? AND status IN ('assigned','in_progress')", (tech_id,)).fetchone()
    seq = (mx["n"] - 1) if front else mx["m"] + 1
    prev_tech = t["tech_id"]
    conn.execute("UPDATE tickets SET status='assigned', tech_id=?, route_seq=? WHERE id=?", (tech_id, seq, tid))
    log_event(conn, tid, actor, "assigned", f"Assigned to {tech['name']}")
    _lamp_refresh(conn, t["lamp_id"])
    recompute_route(conn, tech_id)
    if prev_tech and prev_tech != tech_id:
        recompute_route(conn, prev_tech)
    conn.commit()
    _announce(conn, tid, tech)


def _announce(conn, tid, tech):
    t = get_ticket(conn, tid)
    if t["reporter_id"]:
        eta = time.strftime("%I:%M %p", time.localtime((t["eta_ts"] or db.now()) / 1000))
        notify(conn, t["reporter_id"], f"{code(tid)}: crew assigned", f"{tech['name']} is assigned and expected around {eta}.", tid)
    if tech["user_id"]:
        notify(conn, tech["user_id"], f"New job {code(tid)}", f"{CLASS_META[t['cls']]['label']} · {t['sev_label']} priority", tid)
    pub_ticket(conn, tid, "updated", user_ids=(tech["user_id"], t["reporter_id"]))


def auto_dispatch(conn, tid):
    """Emergency path: a critical ticket goes straight to the nearest eligible on-shift technician, at the front of their route."""
    t = get_ticket(conn, tid)
    best, bd = None, 1e18
    for r in conn.execute("SELECT * FROM technicians WHERE on_shift=1"):
        tech = _tech_dict(r)
        if not scheduler.eligible(tech, dict(cls=t["cls"])):
            continue
        d = geo.haversine_m(tech["depot_lat"], tech["depot_lng"], t["lat"], t["lng"])
        load = conn.execute("SELECT COUNT(*) n FROM tickets WHERE tech_id=? AND status IN ('assigned','in_progress')", (tech["id"],)).fetchone()["n"]
        if d + load * 600 < bd:
            best, bd = tech, d + load * 600
    if best:
        assign(conn, tid, best["id"], "AI dispatcher", front=True)
        hub.publish("toast", dict(msg=f"Critical {code(tid)} auto-dispatched to {best['name']}"))
        return best
    return None


def set_status(conn, tid, status, actor, note=""):
    t = get_ticket(conn, tid)
    if not t:
        raise ValueError("Ticket not found")
    now = db.now()
    if status == "resolved":
        conn.execute("UPDATE tickets SET status='resolved', resolved_ts=?, resolution_note=COALESCE(NULLIF(?,''),resolution_note) WHERE id=?", (now, note, tid))
        log_event(conn, tid, actor, "resolved", note or "Marked resolved")
        if t["reporter_id"]:
            notify(conn, t["reporter_id"], f"{code(tid)} resolved", "The streetlight has been repaired. Please rate the service.", tid)
        for rep in conn.execute("SELECT DISTINCT user_id FROM ticket_reports WHERE ticket_id=? AND user_id IS NOT NULL", (tid,)):
            notify(conn, rep["user_id"], f"{code(tid)} resolved", "The streetlight you reported has been repaired.", tid)
    elif status == "rejected":
        conn.execute("UPDATE tickets SET status='rejected', resolution_note=? WHERE id=?", (note, tid))
        log_event(conn, tid, actor, "rejected", note or "Rejected")
        if t["reporter_id"]:
            notify(conn, t["reporter_id"], f"{code(tid)} closed", note or "This report was closed by the control room.", tid)
    elif status == "open":
        conn.execute("UPDATE tickets SET status='open', tech_id=NULL, route_seq=NULL, eta_ts=NULL, resolved_ts=NULL, review_reason=NULL WHERE id=?", (tid,))
        log_event(conn, tid, actor, "reopened", note or "Moved back to the open queue")
    elif status in ("assigned", "in_progress", "review"):
        conn.execute("UPDATE tickets SET status=? WHERE id=?", (status, tid))
        log_event(conn, tid, actor, status, note)
    else:
        raise ValueError("Invalid status")
    _lamp_refresh(conn, t["lamp_id"])
    if t["tech_id"]:
        recompute_route(conn, t["tech_id"])
    conn.commit()
    pub_ticket(conn, tid, "updated", user_ids=(t["reporter_id"],))


def start_job(conn, tid, tech_row):
    t = get_ticket(conn, tid)
    if not t or t["tech_id"] != tech_row["id"]:
        raise ValueError("Not your job")
    conn.execute("UPDATE tickets SET status='in_progress', started_ts=? WHERE id=?", (db.now(), tid))
    log_event(conn, tid, "Tech: " + tech_row["name"], "started", "Work started on site")
    if t["reporter_id"]:
        notify(conn, t["reporter_id"], f"{code(tid)}: work started", f"{tech_row['name']} is at the location.", tid)
    conn.commit()
    pub_ticket(conn, tid, "updated", user_ids=(t["reporter_id"],))


def complete_job(conn, tid, tech_row, note, parts):
    t = get_ticket(conn, tid)
    if not t or t["tech_id"] != tech_row["id"]:
        raise ValueError("Not your job")
    conn.execute("UPDATE tickets SET parts_used=? WHERE id=?", (parts, tid))
    set_status(conn, tid, "resolved", "Tech: " + tech_row["name"], note or "Repaired on site")


def review_fix(conn, tid, user, cls=None, lamp_id=None, approve=True):
    """Human-in-the-loop: confirm or correct the AI's reading, moving the ticket from review -> open. Corrections feed retraining."""
    t = get_ticket(conn, tid)
    if not t:
        raise ValueError("Ticket not found")
    actor = "Admin: " + user["name"]
    if cls and cls in CLASS_META and cls != t["cls"]:
        meta = CLASS_META[cls]
        sla = db.setting(conn, "sla_hours")
        u = nlp.severity(t["clean_text"] or t["text"], cls, nlp.parse_duration_days(t["text"]))
        conn.execute("UPDATE tickets SET cls=?, sev=?, sev_label=?, sev_why=?, due_ts=? WHERE id=?",
                     (cls, u["score"], u["label"], json.dumps(u["why"]), t["ts"] + sla[u["label"]] * H, tid))
        log_event(conn, tid, actor, "corrected", f"Fault type changed {CLASS_META[t['cls']]['label']} → {meta['label']}")
        conn.execute("INSERT INTO corrections(ts,text,label,ticket_id,user_id) VALUES(?,?,?,?,?)", (db.now(), t["clean_text"] or t["text"], cls, tid, user["id"]))
    elif approve and t["status"] == "review":
        conn.execute("INSERT INTO corrections(ts,text,label,ticket_id,user_id) VALUES(?,?,?,?,?)", (db.now(), t["clean_text"] or t["text"], t["cls"], tid, user["id"]))
        log_event(conn, tid, actor, "confirmed", "AI classification confirmed by a human")
    if lamp_id:
        l = conn.execute("SELECT * FROM lamps WHERE id=?", (lamp_id,)).fetchone()
        if not l:
            raise ValueError("Unknown lamp id")
        conn.execute("UPDATE tickets SET lamp_id=?, lat=?, lng=?, zone=?, geo_by=?, geo_conf=1.0 WHERE id=?", (l["id"], l["lat"], l["lng"], l["zone"], f"Set by {user['name']}", tid))
        log_event(conn, tid, actor, "located", f"Location set to lamp {l['id']}")
    t2 = get_ticket(conn, tid)
    if t2["status"] == "review" and t2["lat"] is not None and t2["lamp_id"]:
        conn.execute("UPDATE tickets SET status='open', review_reason=NULL WHERE id=?", (tid,))
        log_event(conn, tid, actor, "reviewed", "Released from review queue")
        _lamp_refresh(conn, t2["lamp_id"])
    audit(conn, user, "review_ticket", code(tid))
    conn.commit()
    pub_ticket(conn, tid, "updated", user_ids=(t["reporter_id"],))
    return ticket_dict(conn, get_ticket(conn, tid))


def confirm_report(conn, tid, user):
    """'Me too': a citizen confirms an existing ticket instead of filing a duplicate."""
    t = get_ticket(conn, tid)
    if not t or t["status"] in ("resolved", "rejected"):
        raise ValueError("This ticket is closed")
    if conn.execute("SELECT 1 FROM ticket_reports WHERE ticket_id=? AND user_id=?", (tid, user["id"])).fetchone() or t["reporter_id"] == user["id"]:
        raise ValueError("You already reported this fault")
    conn.execute("INSERT INTO ticket_reports(ticket_id,user_id,ts,channel,text) VALUES(?,?,?,?,?)", (tid, user["id"], db.now(), "Web portal", "Citizen confirmation"))
    conn.execute("UPDATE tickets SET reports=reports+1 WHERE id=?", (tid,))
    log_event(conn, tid, "Citizen: " + user["name"], "merged", "Confirmed the fault (“me too”)")
    conn.commit()
    hub.publish("ticket", dict(action="merged", ticket=ticket_dict(conn, get_ticket(conn, tid)), channel="Web portal"))


def rate(conn, tid, user, rating, feedback):
    t = get_ticket(conn, tid)
    if not t or t["reporter_id"] != user["id"]:
        raise ValueError("Only the reporter can rate a ticket")
    if t["status"] != "resolved":
        raise ValueError("You can rate a ticket once it is resolved")
    conn.execute("UPDATE tickets SET rating=?, feedback=? WHERE id=?", (max(1, min(5, int(rating))), (feedback or "")[:500], tid))
    log_event(conn, tid, "Citizen: " + user["name"], "rated", f"{rating}/5" + (f" – {feedback[:100]}" if feedback else ""))
    conn.commit()


# ------------------------------------------------------------------ dispatch plans
def planning_pool(conn):
    rows = conn.execute("SELECT * FROM tickets WHERE status IN ('open','assigned') AND lat IS NOT NULL AND lamp_id IS NOT NULL").fetchall()
    return [dict(id=r["id"], lat=r["lat"], lng=r["lng"], cls=r["cls"], sev=r["sev"], sev_label=r["sev_label"], ts=r["ts"], due_ts=r["due_ts"],
                 reports=r["reports"], zone=r["zone"]) for r in rows]


def techs_for_planning(conn):
    out = []
    for r in conn.execute("SELECT * FROM technicians"):
        d = _tech_dict(r)
        busy = conn.execute("SELECT COUNT(*) n FROM tickets WHERE tech_id=? AND status='in_progress'", (d["id"],)).fetchone()["n"]
        d["capacity_min"] = max(60, d["capacity_min"] - 45 * busy)
        out.append(d)
    return out


def plan(conn, mode="opt"):
    return scheduler.build_plan(planning_pool(conn), techs_for_planning(conn), db.now(), mode)


def dispatch(conn, user):
    p = plan(conn, "opt")
    # everything in the pool is re-planned; clear old unstarted assignments first
    conn.execute("UPDATE tickets SET tech_id=NULL, route_seq=NULL, eta_ts=NULL, status='open' WHERE status='assigned'")
    n = 0
    touched = []
    for tr in p["techs"]:
        for s in tr["stops"]:
            conn.execute("UPDATE tickets SET status='assigned', tech_id=?, route_seq=?, eta_ts=? WHERE id=?", (tr["tech_id"], s["seq"], s["eta_ts"], s["ticket_id"]))
            log_event(conn, s["ticket_id"], "Admin: " + user["name"], "assigned", f"Optimised plan: stop {s['seq']} for {tr['name']}")
            touched.append((s["ticket_id"], tr["tech_id"]))
            n += 1
    conn.execute("UPDATE lamps SET status='fault' WHERE status='assigned'")
    for r in conn.execute("SELECT DISTINCT lamp_id FROM tickets WHERE status IN ('assigned','in_progress') AND lamp_id IS NOT NULL").fetchall():
        conn.execute("UPDATE lamps SET status='assigned' WHERE id=?", (r["lamp_id"],))
    audit(conn, user, "dispatch_plan", f"{n} jobs")
    conn.commit()
    for tid, tech_id in touched:
        tech = conn.execute("SELECT * FROM technicians WHERE id=?", (tech_id,)).fetchone()
        _announce(conn, tid, tech)
    hub.publish("toast", dict(msg=f"Optimised plan dispatched: {n} jobs"))
    return p


# ------------------------------------------------------------------ alerts
def compute_alerts(conn, now_ms=None):
    now_ms = now_ms or db.now()
    A = []
    live = conn.execute("SELECT * FROM tickets WHERE status IN ('open','assigned','in_progress','review') AND kind='complaint'").fetchall()
    for t in [x for x in live if x["sev_label"] == "Critical" and x["status"] != "review"][:8]:
        z = geo.ZM.get(t["zone"], {}).get("name", "unknown zone")
        A.append(dict(key=f"crit-{t['id']}", level="Critical", title=f"{CLASS_META[t['cls']]['label']} in {z}",
                      detail=f"{code(t['id'])} · {t['channel']} · {'crew assigned' if t['tech_id'] else 'no crew assigned yet'}.",
                      page="tickets", cta="Open ticket", ticket_id=t["id"]))
    late = [t for t in live if t["due_ts"] and t["due_ts"] < now_ms and t["status"] != "review"]
    if late:
        oldest = min(late, key=lambda x: x["due_ts"])
        A.append(dict(key=f"late-{len(late)}", level="High", title=f"{len(late)} ticket(s) are past their SLA",
                      detail=f"Oldest: {code(oldest['id'])}, {round((now_ms - oldest['ts']) / H)} h old.", page="schedule", cta="Plan crews"))
    soon = [t for t in live if t["due_ts"] and 0 <= t["due_ts"] - now_ms < 2 * H and t["status"] in ("open",)]
    if soon:
        A.append(dict(key=f"soon-{len(soon)}", level="Medium", title=f"{len(soon)} open ticket(s) reach their SLA within 2 hours",
                      detail="Assign them before the deadline passes.", page="schedule", cta="Plan crews"))
    hs = ml.hotspots(conn)
    for c in hs["current"]:
        if c["n"] >= 4:
            A.append(dict(key=f"hot-{c['zone']}-{c['n']}", level="High", title=f"Hotspot near {c['zone_name']}: {c['n']} faulty lamps",
                          detail=c["cause"], page="hotspots", cta="See hotspot"))
    for z in sorted(hs["zones"], key=lambda z: -z["avg_risk"])[:2]:
        if z["avg_risk"] >= .2:
            A.append(dict(key=f"risk-{z['id']}", level="Medium", title=f"{z['name']} has a high predicted failure risk",
                          detail=f"Average 14-day risk {round(z['avg_risk'] * 100)}% across {z['lamps']} lamps ({z['high_risk']} above 55%). Consider a preventive round.",
                          page="predict", cta="See predictions"))
    rev = [t for t in live if t["status"] == "review"]
    if rev:
        A.append(dict(key=f"rev-{len(rev)}", level="Low", title=f"{len(rev)} complaint(s) waiting for human review",
                      detail="Location or fault type was unclear, so the AI asked a human to confirm.", page="review", cta="Open review queue"))
    unassigned = [t for t in live if t["status"] == "open" and now_ms - t["ts"] > 3 * H and t["sev_label"] in ("High", "Critical")]
    if unassigned:
        A.append(dict(key=f"unas-{len(unassigned)}", level="High", title=f"{len(unassigned)} high-priority ticket(s) unassigned for 3+ hours",
                      detail="No crew has been sent. Run the optimiser.", page="schedule", cta="Plan crews"))
    acked = {r["key"] for r in conn.execute("SELECT key FROM alert_acks")}
    order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    for a in A:
        a["ack"] = a["key"] in acked
    return sorted(A, key=lambda a: (a["ack"], order[a["level"]]))


# ------------------------------------------------------------------ dashboards
def overview(conn):
    now_ms = db.now()
    live = conn.execute("SELECT * FROM tickets WHERE status IN ('open','assigned','in_progress','review')").fetchall()
    hi = [t for t in live if t["sev_label"] in ("Critical", "High")]
    late = [t for t in live if t["due_ts"] and t["due_ts"] < now_ms and t["status"] != "review"]
    lamps = conn.execute("SELECT status, COUNT(*) n FROM lamps GROUP BY status").fetchall()
    total = sum(r["n"] for r in lamps)
    ok = next((r["n"] for r in lamps if r["status"] == "ok"), 0)
    allc = conn.execute("SELECT COUNT(*) n, SUM(CASE WHEN status='review' THEN 0 WHEN geo_conf>=0.75 AND conf>=? THEN 1 ELSE 0 END) auto FROM tickets WHERE kind='complaint'",
                        (db.setting(conn, "review_threshold"),)).fetchone()
    last_h = conn.execute("SELECT COUNT(*) n FROM tickets WHERE ts>=? AND kind='complaint'", (now_ms - H,)).fetchone()["n"]
    res = conn.execute("SELECT ts, resolved_ts, due_ts FROM tickets WHERE status='resolved' AND resolved_ts IS NOT NULL AND resolved_ts>=? AND kind='complaint'", (now_ms - 30 * 86400000,)).fetchall()
    avg_res = sum((r["resolved_ts"] - r["ts"]) for r in res) / len(res) / H if res else 0
    met = sum(1 for r in res if r["resolved_ts"] <= r["due_ts"]) / len(res) if res else 0
    csat = conn.execute("SELECT AVG(rating) a, COUNT(rating) n FROM tickets WHERE rating IS NOT NULL").fetchone()
    by_cls = Counter(t["cls"] for t in live if t["kind"] == "complaint")
    by_ch = Counter(r["channel"] for r in conn.execute("SELECT channel FROM tickets WHERE ts>=?", (now_ms - 30 * 86400000,)))
    days = []
    for i in range(13, -1, -1):
        s = now_ms - (i + 1) * 86400000
        e = now_ms - i * 86400000
        n = conn.execute("SELECT COUNT(*) n FROM tickets WHERE ts>=? AND ts<? AND kind='complaint'", (s, e)).fetchone()["n"]
        days.append(dict(ts=e, n=n))
    by_sev = Counter(t["sev_label"] for t in live)
    return dict(
        open=len(live), last_hour=last_h, critical_high=len(hi), past_sla=len(late), review=sum(1 for t in live if t["status"] == "review"),
        unassigned=sum(1 for t in live if t["status"] == "open"), lamps_total=total, lamps_ok=ok, lamps_faulty=total - ok,
        lamps_online_pct=round(ok / total * 100) if total else 0, auto_triage_pct=round((allc["auto"] or 0) / max(1, allc["n"]) * 100),
        avg_resolution_h=round(avg_res, 1), sla_met_pct=round(met * 100), csat=round(csat["a"], 2) if csat["a"] else None, csat_n=csat["n"],
        by_class=[dict(cls=k, label=CLASS_META[k]["label"], color=CLASS_META[k]["color"], n=v) for k, v in by_cls.most_common()],
        by_channel=[dict(channel=k, n=v) for k, v in by_ch.most_common()], by_severity=dict(by_sev), daily=days,
        techs_on_shift=conn.execute("SELECT COUNT(*) n FROM technicians WHERE on_shift=1").fetchone()["n"],
        techs_total=conn.execute("SELECT COUNT(*) n FROM technicians").fetchone()["n"])


def public_stats(conn):
    o = overview(conn)
    return dict(lamps_total=o["lamps_total"], lamps_ok=o["lamps_ok"], lamps_online_pct=o["lamps_online_pct"], open=o["open"],
                avg_resolution_h=o["avg_resolution_h"], sla_met_pct=o["sla_met_pct"], csat=o["csat"])
