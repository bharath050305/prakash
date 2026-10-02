"""Demo data: lamp network, accounts, 12 weeks of resolved history and a realistic set of live tickets.

All complaints go through the real NLP pipeline (services.ingest), so the seeded data is consistent with the models.
Lamps, history and accounts are SYNTHETIC.
"""
import json
import math
import random

from werkzeug.security import generate_password_hash

from . import db, geo, services, training_data as td
from .nlp import CLASS_META

DEMO_ACCOUNTS = [
    # name, email, password, role
    ("Control Room Admin", "admin@prakash.demo", "Admin@123", "admin"),
    ("Aarav Sharma", "citizen@prakash.demo", "Citizen@123", "citizen"),
    ("Meera Iyer", "meera@prakash.demo", "Citizen@123", "citizen"),
    ("Ravi Patil", "ravi@prakash.demo", "Tech@123", "technician"),
    ("Sneha Kulkarni", "sneha@prakash.demo", "Tech@123", "technician"),
    ("Imran Shaikh", "imran@prakash.demo", "Tech@123", "technician"),
    ("Priya Nair", "priya@prakash.demo", "Tech@123", "technician"),
    ("Arjun Mehta", "arjun@prakash.demo", "Tech@123", "technician"),
]
TECHS = [
    ("ravi@prakash.demo", ["hv"], "#5B9BFF", "vashi"),
    ("sneha@prakash.demo", [], "#2CD3B5", "nerul"),
    ("imran@prakash.demo", ["hv", "bucket"], "#FFB454", "belapur"),
    ("priya@prakash.demo", [], "#C58BFF", "airoli"),
    ("arjun@prakash.demo", ["hv"], "#FF7A9C", "kharghar"),
]
WEEKLY_TARGET = [19, 21, 18, 24, 22, 27, 31, 29, 26, 24, 28, 3]  # last value: only ~4 days of history, live tickets fill the rest
H = 3600000
DAY = 86400000

_HI = dict(airoli="ऐरोली", ghansoli="घनसोली", vashi="वाशी", sanpada="सानपाडा", nerul="नेरुल", seawoods="सीवुड्स", belapur="बेलापुर", kharghar="खारघर")
_MR = dict(_HI, nerul="नेरूळ", seawoods="सीवूड्स", belapur="बेलापूर")
_LM_BY_ZONE = {}
for _n, _re, _z, _la, _ln in geo.LANDMARKS:
    _LM_BY_ZONE.setdefault(_z, []).append(_n)

RES_NOTES = {
    "outage": ("Replaced lamp and tested driver", "LED lamp"), "flicker": ("Replaced loose connector and driver", "Driver"),
    "dayburn": ("Reset photocell and timer relay", "Photocell"), "hazard": ("Re-insulated cable, secured junction box, pole clamped", "Cable, clamp"),
    "dim": ("Replaced ageing lamp", "LED lamp"), "vandal": ("Installed new fixture and cable", "Fixture, cable"),
    "timer": ("Replaced controller contactor", "Contactor"), "cluster": ("Reset feeder MCB, replaced burnt fuse", "MCB, fuse"),
}


def place_for(rnd, zone_id, lang="en"):
    z = geo.ZM[zone_id]
    if lang == "hi":
        return f"{_HI[zone_id]} स्टेशन"
    if lang == "mr":
        return f"{_MR[zone_id]} स्टेशन"
    opts = _LM_BY_ZONE.get(zone_id, []) + [f"{z['name']} Station", f"Sector {rnd.choice([3, 5, 12, 17, 44])} {z['name']}"]
    return rnd.choice(opts)


def gen_text(rnd, cls, zone_id, lang=None, with_place=True):
    lang = lang or rnd.choices(["en", "hinglish", "hi", "mr"], weights=[68, 18, 7, 7])[0]
    phrase = rnd.choice(td.TRAIN[lang][cls])
    n = rnd.randint(2, 8)
    if not with_place:
        place = rnd.choice(["the temple", "my building", "the school gate", "the petrol pump", "the main gate"])
        place_hi, place_mr = "मंदिर", "मंदिर"
    else:
        place = place_for(rnd, zone_id, "en")
        place_hi, place_mr = place_for(rnd, zone_id, "hi"), place_for(rnd, zone_id, "mr")
    if lang == "en":
        body = f"{phrase} {rnd.choice(td.PREP_EN).format(p=place)}" + rnd.choice(td.DUR_EN).format(n=n)
        return (rnd.choice(td.OPENERS_EN) + body + "." + rnd.choice(td.CLOSERS_EN)).strip()
    if lang == "hinglish":
        return f"{place} ke paas {phrase}{rnd.choice(td.DUR_HINGLISH).format(n=n)}.{rnd.choice(td.CLOSERS_HINGLISH)}"
    if lang == "hi":
        return f"{place_hi} के पास {phrase}{rnd.choice(td.DUR_HI).format(n=n)}।{rnd.choice(td.CLOSERS_HI)}"
    return f"{place_mr} जवळ {phrase}{rnd.choice(td.DUR_MR).format(n=n)}.{rnd.choice(td.CLOSERS_MR)}"


def _wipe(conn):
    for t in ["ticket_events", "ticket_reports", "notifications", "alert_acks", "corrections", "audit", "tickets", "technicians", "lamps", "users"]:
        conn.execute(f"DELETE FROM {t}")
    conn.execute("DELETE FROM sqlite_sequence")
    conn.execute("INSERT INTO sqlite_sequence(name,seq) VALUES('tickets',1040)")  # first ticket is TKT-1041
    conn.commit()


def _hazard(l, zone_w):
    return math.exp(0.22 * l["age"] + 1.3 * l["volt_var"] + (0.6 if l["driver"] == 0 else 0) + 1.0 * l["pole_cond"] + 0.5 * zone_w)


def run(conn, seed=5):
    rnd = random.Random(seed)
    _wipe(conn)
    db.init_schema(conn)
    now = db.now()

    # ---------------- lamps
    lamps = geo.generate_lamps()
    conn.executemany("INSERT INTO lamps(id,lat,lng,zone,age,volt_var,driver,burn_hours,pole_cond,wattage) VALUES(:id,:lat,:lng,:zone,:age,:volt_var,:driver,:burn_hours,:pole_cond,:wattage)", lamps)

    # ---------------- accounts
    ids = {}
    for name, email, pw, role in DEMO_ACCOUNTS:
        cur = conn.execute("INSERT INTO users(name,email,password_hash,role,phone,created_at) VALUES(?,?,?,?,?,?)",
                           (name, email, generate_password_hash(pw), role, f"+91 98{rnd.randint(10000000, 99999999)}", now - rnd.randint(20, 90) * DAY))
        ids[email] = cur.lastrowid
    tech_ids = []
    for email, skills, color, zone in TECHS:
        u = conn.execute("SELECT name FROM users WHERE id=?", (ids[email],)).fetchone()
        z = geo.ZM[zone]
        cur = conn.execute("INSERT INTO technicians(user_id,name,skills,color,depot_zone,depot_lat,depot_lng) VALUES(?,?,?,?,?,?,?)",
                           (ids[email], u["name"], json.dumps(skills), color, z["name"], z["lat"] + .001, z["lng"] + .001))
        tech_ids.append(cur.lastrowid)
    conn.commit()
    citizens = [conn.execute("SELECT * FROM users WHERE id=?", (ids[e],)).fetchone() for e in ("citizen@prakash.demo", "meera@prakash.demo")]
    techs = [dict(r, skills=json.loads(r["skills"])) for r in conn.execute("SELECT * FROM technicians")]
    sla = db.setting(conn, "sla_hours")

    weights = [_hazard(l, geo.ZM[l["zone"]]["w"]) for l in lamps]
    cls_w = [30, 18, 8, 10, 10, 8, 8, 0]  # cluster outages are created explicitly below
    classes = td.CLASSES

    def pick_lamp():
        return rnd.choices(lamps, weights=weights)[0]

    def channel():
        return rnd.choices(services.CHANNELS, weights=[36, 22, 14, 10, 8, 10])[0]

    # ---------------- history (resolved)
    for wi, n in enumerate(WEEKLY_TARGET):
        start = now - (12 - wi) * 7 * DAY
        end = start + 7 * DAY
        if wi == 11:
            end = now - 3.2 * DAY
        ts_list = sorted(rnd.uniform(start, end) for _ in range(n))
        for ts in ts_list:
            l = pick_lamp()
            cls = rnd.choices(classes, weights=[30, 18, 8, 10, 10, 8, 8, 6])[0]
            text = gen_text(rnd, cls, l["zone"])
            rep = rnd.choice(citizens) if rnd.random() < .06 else None
            res = services.ingest(conn, text, channel(), reporter=rep, gps=(l["lat"], l["lng"]), ts=int(ts), guest_name=rnd.choice(["Anonymous", "Walk-in caller", "WhatsApp user"]), notify_admins=False)
            t = res["ticket"]
            if res["merged"]:
                continue
            tid = t["id"]
            if rnd.random() < .03:
                conn.execute("UPDATE tickets SET status='rejected', resolution_note='Duplicate of an older report / spam' WHERE id=?", (tid,))
                services.log_event(conn, tid, "Admin: Control Room Admin", "rejected", "Duplicate of an older report / spam", ts=int(ts + 2 * H))
                services._lamp_refresh(conn, t["lamp_id"])
                continue
            tech = rnd.choice([x for x in techs if set(CLASS_META[t["cls"]]["needs"]) <= set(x["skills"])])
            sla_h = sla[t["sev_label"]]
            dur_h = sla_h * rnd.lognormvariate(-0.3, 0.5)
            dur_h = max(0.8, dur_h)
            assigned, started, resolved = ts + 0.15 * dur_h * H, ts + 0.75 * dur_h * H, ts + dur_h * H
            note, parts = RES_NOTES[t["cls"]]
            breached = resolved > t["due_ts"]
            rating = None
            if rnd.random() < .6:
                rating = max(1, min(5, round(rnd.gauss(3.0 if breached else 4.4, 0.9))))
            conn.execute("UPDATE tickets SET status='resolved', tech_id=?, resolved_ts=?, started_ts=?, eta_ts=?, resolution_note=?, parts_used=?, rating=? WHERE id=?",
                         (tech["id"], int(resolved), int(started), int(ts + .4 * dur_h * H), note, parts, rating, tid))
            services.log_event(conn, tid, "Admin: Control Room Admin", "assigned", f"Assigned to {tech['name']}", ts=int(assigned))
            services.log_event(conn, tid, "Tech: " + tech["name"], "started", "Work started on site", ts=int(started))
            services.log_event(conn, tid, "Tech: " + tech["name"], "resolved", note, ts=int(resolved))
            services._lamp_refresh(conn, t["lamp_id"])
        conn.commit()

    # ---------------- give the demo citizens a few of their own tickets (resolved, rated)
    conn.execute("UPDATE tickets SET reporter_id=?, reporter_name=? WHERE id IN (SELECT id FROM tickets WHERE status='resolved' AND reporter_id IS NULL ORDER BY ts DESC LIMIT 3 OFFSET 4)", (citizens[0]["id"], citizens[0]["name"]))
    conn.execute("UPDATE tickets SET reporter_id=?, reporter_name=? WHERE id IN (SELECT id FROM tickets WHERE status='resolved' AND reporter_id IS NULL ORDER BY ts DESC LIMIT 2 OFFSET 12)", (citizens[1]["id"], citizens[1]["name"]))
    conn.execute("UPDATE tickets SET rating=NULL, feedback=NULL WHERE id=(SELECT id FROM tickets WHERE reporter_id=? AND status='resolved' ORDER BY ts DESC LIMIT 1)", (citizens[0]["id"],))
    conn.execute("DELETE FROM notifications")
    conn.commit()

    # ---------------- live tickets (last ~3 days), all through the real pipeline
    def live(text, ch, minutes_ago, gps_lamp=None, reporter=None):
        gps = (gps_lamp["lat"], gps_lamp["lng"]) if gps_lamp else None
        return services.ingest(conn, text, ch, reporter=reporter, gps=gps, ts=int(now - minutes_ago * 60000),
                               guest_name=rnd.choice(["Anonymous", "WhatsApp user", "Walk-in caller"]), notify_admins=False)

    used = set()
    by_zone = {}
    for l in lamps:
        by_zone.setdefault(l["zone"], []).append(l)

    # two explicit hotspots: a run of adjacent lamps failing together (shared feeder)
    for zone_id, channels in (("nerul", ["WhatsApp", "Web portal", "Call centre", "WhatsApp", "X / Twitter"]), ("kharghar", ["WhatsApp", "Email", "Web portal", "WhatsApp"])):
        zl = by_zone[zone_id]
        while True:  # a run of physically adjacent lamps on one road
            k = rnd.randrange(3, len(zl) - 8)
            if geo.haversine_m(zl[k]["lat"], zl[k]["lng"], zl[k + len(channels) - 1]["lat"], zl[k + len(channels) - 1]["lng"]) < 330:
                break
        for i, ch in enumerate(channels):
            l = zl[k + i]
            used.add(l["id"])
            live(gen_text(rnd, "outage", zone_id, lang="en"), ch, rnd.randint(40, 2400), l)

    # a scatter of individual faults weighted by latent hazard
    scatter = 14
    n_done = 0
    while n_done < scatter:
        l = pick_lamp()
        if l["id"] in used:
            continue
        used.add(l["id"])
        cls = rnd.choices(classes[:7], weights=cls_w[:7])[0]
        minutes = int(20 + rnd.random() ** 2 * 4300)
        live(gen_text(rnd, cls, l["zone"]), channel(), minutes, l)
        n_done += 1

    # a couple of repeat reports so the "people confirmed" counter and merge logic have something to show
    for row in conn.execute("SELECT id FROM tickets WHERE status='open' ORDER BY RANDOM() LIMIT 3").fetchall():
        conn.execute("UPDATE tickets SET reports=reports+? WHERE id=?", (rnd.randint(1, 3), row["id"]))

    # two that need a human: no usable location
    live("Street light not working near the temple, please fix ASAP", "Email", 95)
    live("Light is off in our lane since 2 days. Kindly fix.", "Web portal", 62)

    # ---------------- personal tickets for the demo citizen (one of each lifecycle stage)
    c1 = citizens[0]
    zone_n = by_zone["nerul"]
    stage_lamps = [l for l in zone_n if l["id"] not in used][:3]
    for l in stage_lamps:
        used.add(l["id"])
    r1 = live("The light near SIES College Nerul keeps flickering on and off since 3 days. Students walk here at night, very unsafe.", "Web portal", 300, stage_lamps[0], reporter=c1)
    r2 = live("Street light is not working near Nerul Station, it is very dark at night.", "Web portal", 700, stage_lamps[1], reporter=c1)
    r3 = live("Lamp post is dead outside Seawoods Grand Central. Women feel unsafe.", "Web portal", 1500, [x for x in by_zone["seawoods"] if x["id"] not in used][0], reporter=c1)

    conn.commit()

    # ---------------- dispatch roughly half of the queue so technicians have jobs on first login
    p = services.plan(conn, "opt")
    admin = conn.execute("SELECT * FROM users WHERE role='admin' LIMIT 1").fetchone()
    demo_ids = {r1["ticket"]["id"], r2["ticket"]["id"], r3["ticket"]["id"]}
    for tr in p["techs"]:
        seq = 0
        for s_ in tr["stops"]:
            if s_["ticket_id"] in demo_ids or seq >= 3:
                continue
            seq += 1
            conn.execute("UPDATE tickets SET status='assigned', tech_id=?, route_seq=?, eta_ts=? WHERE id=?", (tr["tech_id"], seq, s_["eta_ts"], s_["ticket_id"]))
            services.log_event(conn, s_["ticket_id"], "Admin: " + admin["name"], "assigned", f"Optimised plan: stop {seq} for {tr['name']}", ts=now - rnd.randint(5, 40) * 60000)
    conn.commit()
    tech_sneha = next(t for t in techs if t["name"] == "Sneha Kulkarni")
    # staged demo citizen tickets: r1 being repaired, r2 crew assigned, r3 still waiting
    for tid, st, at in ((r1["ticket"]["id"], "in_progress", 25), (r2["ticket"]["id"], "assigned", 18)):
        conn.execute("UPDATE tickets SET status=?, tech_id=?, route_seq=0 WHERE id=?", (st, tech_sneha["id"], tid))
        services.log_event(conn, tid, "Admin: " + admin["name"], "assigned", f"Assigned to {tech_sneha['name']}", ts=now - at * 60000)
    conn.execute("UPDATE tickets SET started_ts=? WHERE id=?", (now - 9 * 60000, r1["ticket"]["id"]))
    services.log_event(conn, r1["ticket"]["id"], "Tech: " + tech_sneha["name"], "started", "Work started on site", ts=now - 9 * 60000)
    # one other job already in progress
    row = conn.execute("SELECT * FROM tickets WHERE status='assigned' AND tech_id!=? AND route_seq=1 ORDER BY sev DESC LIMIT 1", (tech_sneha["id"],)).fetchone()
    if row:
        conn.execute("UPDATE tickets SET status='in_progress', started_ts=? WHERE id=?", (now - 12 * 60000, row["id"]))
        services.log_event(conn, row["id"], "Tech", "started", "Work started on site", ts=now - 12 * 60000)
    for r in conn.execute("SELECT DISTINCT lamp_id FROM tickets WHERE status IN ('assigned','in_progress') AND lamp_id IS NOT NULL").fetchall():
        conn.execute("UPDATE lamps SET status='assigned' WHERE id=?", (r["lamp_id"],))
    for tid in [r["tech_id"] for r in conn.execute("SELECT DISTINCT tech_id FROM tickets WHERE tech_id IS NOT NULL AND status IN ('assigned','in_progress')")]:
        services.recompute_route(conn, tid)
    conn.commit()

    # notifications for the demo citizen
    t_c = services.get_ticket(conn, r2["ticket"]["id"])
    services.notify(conn, c1["id"], f"{services.code(t_c['id'])}: crew assigned", f"{tech_sneha['name']} is assigned to your report.", t_c["id"])
    services.notify(conn, c1["id"], f"Report received: {services.code(r1['ticket']['id'])}", "We logged your report. A crew will visit soon.", r1["ticket"]["id"])
    services.audit(conn, None, "seed", "Demo data generated")
    conn.commit()
    # tickets table sequence: next live ticket id continues after the seeded ones
    return dict(lamps=len(lamps), tickets=conn.execute("SELECT COUNT(*) n FROM tickets").fetchone()["n"])
