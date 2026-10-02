"""Flask application: REST API, server-sent events, static frontend. Role-based access: citizen, technician, admin."""
import csv
import io
import json
import os
import queue
import re
import secrets
import time
import uuid
from collections import defaultdict
from functools import wraps

from flask import Flask, Response, abort, g, jsonify, request, send_from_directory, session, stream_with_context
from werkzeug.security import check_password_hash, generate_password_hash

from . import db, geo, ml, nlp, seed, services
from .events import hub
from .nlp import CLASS_META

from .config import ROOT

FRONTEND = os.path.join(ROOT, "frontend")


def create_app():
    app = Flask(__name__, static_folder=None)
    key_path = os.path.join(db.DATA_DIR, "secret.key")
    os.makedirs(db.DATA_DIR, exist_ok=True)
    if not os.path.exists(key_path):
        with open(key_path, "w") as fh:
            fh.write(secrets.token_hex(32))
    app.secret_key = open(key_path).read().strip()
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", MAX_CONTENT_LENGTH=6 * 1024 * 1024,
                      JSON_SORT_KEYS=False)

    conn = db.connect()
    db.init_schema(conn)
    if conn.execute("SELECT COUNT(*) n FROM users").fetchone()["n"] == 0:
        print("First run: generating demo data ...")
        seed.run(conn)
    conn.close()
    nlp.get_model()
    ml.get_risk_model()

    register_routes(app)
    from . import simulator
    simulator.start()
    return app


# ------------------------------------------------------------------ auth helpers
_attempts = defaultdict(list)


def current_user():
    if "user" in g:
        return g.user
    uid = session.get("uid")
    g.user = None
    if uid:
        row = db.get_db().execute("SELECT * FROM users WHERE id=? AND active=1", (uid,)).fetchone()
        g.user = row
    return g.user


def user_dict(u):
    d = dict(id=u["id"], name=u["name"], email=u["email"], role=u["role"], phone=u["phone"])
    if u["role"] == "technician":
        t = db.get_db().execute("SELECT id,name,color,on_shift,skills FROM technicians WHERE user_id=?", (u["id"],)).fetchone()
        if t:
            d["tech"] = dict(id=t["id"], color=t["color"], on_shift=bool(t["on_shift"]), skills=json.loads(t["skills"]))
    d["unread"] = db.get_db().execute("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0", (u["id"],)).fetchone()["n"]
    return d


def role_required(*roles):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            u = current_user()
            if not u:
                return jsonify(error="Please sign in"), 401
            if roles and u["role"] not in roles:
                return jsonify(error="You do not have access to this"), 403
            return fn(*a, **kw)
        return wrapper
    return deco


def actor(u):
    return {"admin": "Admin: ", "technician": "Tech: ", "citizen": "Citizen: "}[u["role"]] + u["name"]


def body():
    return request.get_json(silent=True) or {}


def err(msg, code=400):
    return jsonify(error=msg), code


# ------------------------------------------------------------------ payload builders
def analysis_dict(conn, u, lamp, dup):
    meta = CLASS_META[u["cls"]]
    sla = db.setting(conn, "sla_hours")
    thr = db.setting(conn, "review_threshold")
    g_ = u["geo"]
    review = None
    if not g_:
        review = "No location found"
    elif g_["conf"] < .75:
        review = "Location too vague"
    elif u["conf"] < thr:
        review = "Low classifier confidence"
    geo_out = None
    if g_:
        geo_out = dict(lat=g_["lat"], lng=g_["lng"], zone=g_["zone"], zone_name=geo.ZM[g_["zone"]]["name"], conf=g_["conf"], by=g_["by"])
    return dict(
        raw=u["raw"], text=u["text"], prep=u["prep"], lang=u["lang"], cls=u["cls"], cls_label=meta["label"], color=meta["color"], conf=u["conf"],
        override=u["override"], why_tokens=u["why_tokens"],
        probs=[dict(cls=p["cls"], label=CLASS_META[p["cls"]]["label"], color=CLASS_META[p["cls"]]["color"], p=p["p"]) for p in u["probs"]],
        ents=u["ents"], dur_days=u["dur_days"], sev=u["sev"], sla_hours=sla[u["sev"]["label"]], geo=geo_out,
        lamp=dict(id=lamp["id"], lat=lamp["lat"], lng=lamp["lng"], status=lamp["status"], zone=lamp["zone"]) if lamp else None,
        duplicate=dict(id=dup["id"], code=services.code(dup["id"]), reports=dup["reports"], status=dup["status"]) if dup else None,
        dept=meta["dept"], parts=meta["parts"], mins=meta["mins"], needs=meta["needs"], review=review,
        reply=services.make_reply(u["lang"], "dup" if dup else "review" if review else "ok",
                                  services.code(dup["id"]) if dup else "TKT-####", u["sev"]["label"], sla[u["sev"]["label"]],
                                  f" near {geo.ZM[g_['zone']]['name']}" if g_ else "", (dup["reports"] + 1) if dup else 1))


def can_see_ticket(u, t):
    if u["role"] == "admin":
        return "admin"
    if u["role"] == "technician":
        tech = db.get_db().execute("SELECT id FROM technicians WHERE user_id=?", (u["id"],)).fetchone()
        return "owner" if tech and t["tech_id"] == tech["id"] else None
    if t["reporter_id"] == u["id"]:
        return "owner"
    if db.get_db().execute("SELECT 1 FROM ticket_reports WHERE ticket_id=? AND user_id=?", (t["id"], u["id"])).fetchone():
        return "owner"
    return "public"


def ticket_detail(conn, t, level):
    d = services.ticket_dict(conn, t, level)
    ev = services.events_for(conn, t["id"])
    if level != "admin":
        ev = [e for e in ev if e["kind"] not in ("prep", "severity", "corrected", "confirmed", "reviewed")]
    d["events"] = ev
    if level == "admin":
        d["reporters"] = [dict(ts=r["ts"], channel=r["channel"], text=r["text"]) for r in
                          conn.execute("SELECT * FROM ticket_reports WHERE ticket_id=? ORDER BY ts", (t["id"],))]
    return d


# ------------------------------------------------------------------ routes
def register_routes(app):
    @app.teardown_appcontext
    def close_db(_exc):
        c = g.pop("db", None)
        if c is not None:
            c.close()

    @app.after_request
    def headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    # ---------------------------------------------------------- static
    @app.get("/")
    def index():
        return send_from_directory(FRONTEND, "index.html")

    @app.get("/<path:path>")
    def static_files(path):
        if path.startswith("api/"):
            abort(404)
        return send_from_directory(FRONTEND, path)

    @app.get("/uploads/<name>")
    @role_required()
    def uploads(name):
        return send_from_directory(db.UPLOAD_DIR, name)

    # ---------------------------------------------------------- auth
    @app.post("/api/auth/login")
    def login():
        b = body()
        email, pw = (b.get("email") or "").strip().lower(), b.get("password") or ""
        key = f"{request.remote_addr}|{email}"
        recent = [t for t in _attempts[key] if time.time() - t < 300]
        _attempts[key] = recent
        if len(recent) >= 8:
            return err("Too many attempts. Try again in a few minutes.", 429)
        conn = db.get_db()
        u = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not u or not check_password_hash(u["password_hash"], pw):
            _attempts[key].append(time.time())
            return err("Incorrect email or password", 401)
        if not u["active"]:
            return err("This account has been disabled. Contact the control room.", 403)
        session.clear()
        session["uid"] = u["id"]
        session.permanent = True
        conn.execute("UPDATE users SET last_login=? WHERE id=?", (db.now(), u["id"]))
        conn.commit()
        g.user = u
        return jsonify(user=user_dict(u))

    @app.post("/api/auth/register")
    def register():
        b = body()
        name, email, pw = (b.get("name") or "").strip(), (b.get("email") or "").strip().lower(), b.get("password") or ""
        if len(name) < 2:
            return err("Please enter your name")
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            return err("Please enter a valid email address")
        if len(pw) < 6:
            return err("Password must be at least 6 characters")
        conn = db.get_db()
        if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            return err("An account with this email already exists", 409)
        cur = conn.execute("INSERT INTO users(name,email,password_hash,role,phone,created_at) VALUES(?,?,?,?,?,?)",
                           (name, email, generate_password_hash(pw), "citizen", (b.get("phone") or "")[:20], db.now()))
        conn.commit()
        session.clear()
        session["uid"] = cur.lastrowid
        u = conn.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
        g.user = u
        services.notify(conn, u["id"], "Welcome to Prakash", "Report a faulty streetlight and track it until it is fixed.")
        conn.commit()
        return jsonify(user=user_dict(u)), 201

    @app.post("/api/auth/logout")
    def logout():
        session.clear()
        return jsonify(ok=True)

    @app.get("/api/auth/me")
    def me():
        u = current_user()
        return jsonify(user=user_dict(u) if u else None)

    @app.post("/api/auth/password")
    @role_required()
    def change_password():
        b = body()
        u = current_user()
        if not check_password_hash(u["password_hash"], b.get("current") or ""):
            return err("Current password is incorrect")
        if len(b.get("new") or "") < 6:
            return err("New password must be at least 6 characters")
        conn = db.get_db()
        conn.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(b["new"]), u["id"]))
        conn.commit()
        return jsonify(ok=True)

    # ---------------------------------------------------------- shared
    @app.get("/api/meta")
    def meta():
        conn = db.get_db()
        return jsonify(classes={k: dict(label=v["label"], color=v["color"], dept=v["dept"], needs=v["needs"]) for k, v in CLASS_META.items()},
                       zones=[dict(id=z["id"], name=z["name"], lat=z["lat"], lng=z["lng"]) for z in geo.ZONES],
                       landmarks=[dict(name=l[0], lat=l[3], lng=l[4], zone=l[2]) for l in geo.LANDMARKS],
                       channels=services.CHANNELS, sla=db.setting(conn, "sla_hours"))

    @app.get("/api/stream")
    @role_required()
    def stream():
        u = current_user()
        sub = hub.subscribe(u["role"], u["id"])

        def gen():
            try:
                yield "retry: 3000\n\n"
                while True:
                    try:
                        yield f"data: {sub.q.get(timeout=15)}\n\n"
                    except queue.Empty:
                        yield ": ping\n\n"
            finally:
                hub.unsubscribe(sub)
        return Response(stream_with_context(gen()), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/analyze")
    @role_required()
    def analyze():
        b = body()
        text = (b.get("text") or "").strip()
        if not text:
            return err("Type a complaint first")
        if len(text) > 2000:
            return err("That message is too long (2000 characters max)")
        gps = (float(b["lat"]), float(b["lng"])) if b.get("lat") is not None and b.get("lng") is not None else None
        u, lamp, dup = services.analyze_preview(db.get_db(), text, b.get("channel") or "Web portal", gps)
        return jsonify(analysis=analysis_dict(db.get_db(), u, lamp, dup))

    @app.get("/api/notifications")
    @role_required()
    def notifications():
        u = current_user()
        rows = db.get_db().execute("SELECT * FROM notifications WHERE user_id=? ORDER BY ts DESC LIMIT 40", (u["id"],)).fetchall()
        return jsonify(items=[dict(id=r["id"], ts=r["ts"], title=r["title"], body=r["body"], ticket_id=r["ticket_id"], read=bool(r["read"])) for r in rows])

    @app.post("/api/notifications/read")
    @role_required()
    def notifications_read():
        conn = db.get_db()
        conn.execute("UPDATE notifications SET read=1 WHERE user_id=?", (current_user()["id"],))
        conn.commit()
        return jsonify(ok=True)

    # ---------------------------------------------------------- citizen
    @app.post("/api/tickets")
    @role_required("citizen", "admin")
    def create_ticket():
        u = current_user()
        conn = db.get_db()
        if request.content_type and request.content_type.startswith("multipart/"):
            f = request.form
            text, lat, lng, channel = f.get("text", ""), f.get("lat"), f.get("lng"), f.get("channel") or "Web portal"
            photo = request.files.get("photo")
        else:
            b = body()
            text, lat, lng, channel, photo = b.get("text", ""), b.get("lat"), b.get("lng"), b.get("channel") or "Web portal", None
        text = (text or "").strip()
        if len(text) < 6:
            return err("Please describe the problem in a few words")
        if len(text) > 2000:
            return err("That message is too long (2000 characters max)")
        if channel not in services.CHANNELS:
            channel = "Web portal"
        gps = None
        try:
            if lat not in (None, "") and lng not in (None, ""):
                gps = (float(lat), float(lng))
                if not (18.5 < gps[0] < 19.5 and 72.5 < gps[1] < 73.5):
                    gps = None  # outside the service area
        except ValueError:
            gps = None
        photo_name = None
        if photo and photo.filename:
            ext = os.path.splitext(photo.filename)[1].lower()
            if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif") or not (photo.mimetype or "").startswith("image/"):
                return err("Photo must be a JPG, PNG, WEBP or GIF image")
            photo_name = uuid.uuid4().hex + ext
            photo.save(os.path.join(db.UPLOAD_DIR, photo_name))
            photo_name = "/uploads/" + photo_name
        res = services.ingest(conn, text, channel, reporter=u, gps=gps, photo=photo_name, actor=None)
        return jsonify(ticket=res["ticket"], merged=res["merged"], reply=res["reply"], analysis=analysis_dict(conn, res["analysis"], res["lamp"], None)), 201

    @app.get("/api/my/tickets")
    @role_required("citizen")
    def my_tickets():
        u, conn = current_user(), db.get_db()
        rows = conn.execute("""SELECT * FROM tickets WHERE reporter_id=? OR id IN (SELECT ticket_id FROM ticket_reports WHERE user_id=?)
                               ORDER BY ts DESC""", (u["id"], u["id"])).fetchall()
        items = [services.ticket_dict(conn, r, "owner") for r in rows]
        for it, r in zip(items, rows):
            it["mine"] = r["reporter_id"] == u["id"]
        return jsonify(items=items)

    @app.get("/api/tickets/<int:tid>")
    @role_required()
    def ticket_get(tid):
        u, conn = current_user(), db.get_db()
        t = services.get_ticket(conn, tid)
        if not t:
            return err("Ticket not found", 404)
        level = can_see_ticket(u, t)
        if not level:
            return err("You do not have access to this ticket", 403)
        d = ticket_detail(conn, t, level)
        if u["role"] == "citizen":
            d["i_confirmed"] = bool(conn.execute("SELECT 1 FROM ticket_reports WHERE ticket_id=? AND user_id=?", (tid, u["id"])).fetchone()) or t["reporter_id"] == u["id"]
        return jsonify(ticket=d)

    @app.post("/api/tickets/<int:tid>/confirm")
    @role_required("citizen")
    def ticket_confirm(tid):
        try:
            services.confirm_report(db.get_db(), tid, current_user())
        except ValueError as e:
            return err(str(e))
        return jsonify(ok=True)

    @app.post("/api/tickets/<int:tid>/rate")
    @role_required("citizen")
    def ticket_rate(tid):
        b = body()
        try:
            services.rate(db.get_db(), tid, current_user(), b.get("rating") or 0, b.get("feedback") or "")
        except (ValueError, TypeError) as e:
            return err(str(e))
        return jsonify(ok=True)

    @app.get("/api/nearby")
    @role_required()
    def nearby():
        try:
            lat, lng = float(request.args["lat"]), float(request.args["lng"])
        except (KeyError, ValueError):
            return err("lat and lng are required")
        conn = db.get_db()
        out = []
        for r in conn.execute("SELECT * FROM tickets WHERE kind='complaint' AND lat IS NOT NULL AND status IN ('open','assigned','in_progress')"):
            d = geo.haversine_m(lat, lng, r["lat"], r["lng"])
            if d <= 400:
                x = services.ticket_dict(conn, r, "public")
                x["distance_m"] = round(d)
                out.append(x)
        return jsonify(items=sorted(out, key=lambda x: x["distance_m"])[:6])

    @app.get("/api/city/map")
    @role_required()
    def city_map():
        conn = db.get_db()
        lamps = [dict(id=l["id"], lat=l["lat"], lng=l["lng"], status=l["status"], zone=l["zone"]) for l in conn.execute("SELECT * FROM lamps")]
        live = conn.execute("SELECT * FROM tickets WHERE status IN ('open','assigned','in_progress') AND lamp_id IS NOT NULL AND kind='complaint'").fetchall()
        tk = {r["lamp_id"]: services.ticket_dict(conn, r, "public") for r in live}
        return jsonify(lamps=lamps, tickets=tk, stats=services.public_stats(conn))

    # ---------------------------------------------------------- technician
    def _tech(conn):
        return conn.execute("SELECT * FROM technicians WHERE user_id=?", (current_user()["id"],)).fetchone()

    @app.get("/api/tech/jobs")
    @role_required("technician")
    def tech_jobs():
        conn = db.get_db()
        t = _tech(conn)
        if not t:
            return err("No technician profile linked to this account", 404)
        rows = conn.execute("SELECT * FROM tickets WHERE tech_id=? AND status IN ('in_progress','assigned') ORDER BY (status='in_progress') DESC, route_seq", (t["id"],)).fetchall()
        done = conn.execute("SELECT * FROM tickets WHERE tech_id=? AND status='resolved' ORDER BY resolved_ts DESC LIMIT 10", (t["id"],)).fetchall()
        since = db.now() - 86400000
        stats = conn.execute("SELECT COUNT(*) n, AVG(resolved_ts-started_ts) d, AVG(rating) r FROM tickets WHERE tech_id=? AND status='resolved' AND resolved_ts>=?", (t["id"], since)).fetchone()
        allstats = conn.execute("SELECT COUNT(*) n, AVG(rating) r FROM tickets WHERE tech_id=? AND status='resolved'", (t["id"],)).fetchone()
        return jsonify(tech=dict(id=t["id"], name=t["name"], color=t["color"], on_shift=bool(t["on_shift"]), skills=json.loads(t["skills"]),
                                 depot=dict(lat=t["depot_lat"], lng=t["depot_lng"], zone=t["depot_zone"])),
                       jobs=[services.ticket_dict(conn, r, "owner") for r in rows], history=[services.ticket_dict(conn, r, "owner") for r in done],
                       stats=dict(done_24h=stats["n"], avg_repair_min=round((stats["d"] or 0) / 60000), total_done=allstats["n"],
                                  rating=round(allstats["r"], 2) if allstats["r"] else None))

    @app.post("/api/tech/shift")
    @role_required("technician")
    def tech_shift():
        conn = db.get_db()
        t = _tech(conn)
        on = 1 if body().get("on") else 0
        conn.execute("UPDATE technicians SET on_shift=? WHERE id=?", (on, t["id"]))
        services.audit(conn, current_user(), "shift", "on" if on else "off")
        conn.commit()
        return jsonify(on_shift=bool(on))

    @app.post("/api/tech/jobs/<int:tid>/start")
    @role_required("technician")
    def tech_start(tid):
        conn = db.get_db()
        try:
            services.start_job(conn, tid, _tech(conn))
        except ValueError as e:
            return err(str(e), 403)
        return jsonify(ok=True)

    @app.post("/api/tech/jobs/<int:tid>/complete")
    @role_required("technician")
    def tech_complete(tid):
        conn = db.get_db()
        b = body()
        try:
            services.complete_job(conn, tid, _tech(conn), (b.get("note") or "")[:400], (b.get("parts") or "")[:200])
        except ValueError as e:
            return err(str(e), 403)
        return jsonify(ok=True)

    # ---------------------------------------------------------- admin: dashboards
    @app.get("/api/admin/overview")
    @role_required("admin")
    def admin_overview():
        conn = db.get_db()
        o = services.overview(conn)
        o["sim"] = dict(on=db.setting(conn, "simulator_on"), interval=db.setting(conn, "simulator_interval"))
        o["online"] = hub.count()
        return jsonify(o)

    @app.get("/api/admin/badges")
    @role_required("admin")
    def admin_badges():
        conn = db.get_db()
        al = [a for a in services.compute_alerts(conn) if not a["ack"] and a["level"] in ("Critical", "High")]
        return jsonify(alerts=len(al), review=conn.execute("SELECT COUNT(*) n FROM tickets WHERE status='review'").fetchone()["n"],
                       sim=db.setting(conn, "simulator_on"))

    @app.get("/api/admin/map")
    @role_required("admin")
    def admin_map():
        conn = db.get_db()
        risk = ml.score_lamps(conn)
        live = {r["lamp_id"]: r for r in conn.execute("SELECT * FROM tickets WHERE status IN ('open','assigned','in_progress','review') AND lamp_id IS NOT NULL")}
        lamps = []
        for l in risk:
            t = live.get(l["id"])
            lamps.append(dict(id=l["id"], lat=l["lat"], lng=l["lng"], zone=l["zone"], status=l["status"], age=l["age"], risk=round(l["risk"], 3), reason=l["reason"],
                              faults_90d=l["faults_90d"], ticket=dict(id=t["id"], code=services.code(t["id"]), cls_label=CLASS_META[t["cls"]]["label"], sev_label=t["sev_label"], status=t["status"]) if t else None))
        hs = ml.hotspots(conn, risk)
        return jsonify(lamps=lamps, hotspots=hs["current"], techs=[dict(id=t["id"], name=t["name"], color=t["color"], lat=t["depot_lat"], lng=t["depot_lng"], on_shift=bool(t["on_shift"]))
                                                                    for t in conn.execute("SELECT * FROM technicians")])

    @app.get("/api/admin/tickets")
    @role_required("admin")
    def admin_tickets():
        conn = db.get_db()
        a = request.args
        where, args = ["1=1"], []
        if a.get("status"):
            sts = a["status"].split(",")
            where.append(f"status IN ({','.join('?' * len(sts))})")
            args += sts
        elif a.get("scope") == "active":
            where.append("status IN ('open','review','assigned','in_progress')")
        for k in ("cls", "zone", "channel", "sev_label"):
            if a.get(k):
                where.append(f"{k}=?")
                args.append(a[k])
        if a.get("tech_id"):
            where.append("tech_id=?")
            args.append(int(a["tech_id"]))
        if a.get("q"):
            q = f"%{a['q']}%"
            where.append("(text LIKE ? OR lamp_id LIKE ? OR reporter_name LIKE ? OR CAST(id AS TEXT) LIKE ?)")
            args += [q, q, q, q]
        if a.get("sla") == "breached":
            where.append("status IN ('open','review','assigned','in_progress') AND due_ts<?")
            args.append(db.now())
        order = {"newest": "ts DESC", "oldest": "ts ASC", "severity": "sev DESC, ts ASC", "sla": "due_ts ASC"}.get(a.get("sort"), "ts DESC")
        limit = min(int(a.get("limit", 40)), 200)
        offset = max(int(a.get("offset", 0)), 0)
        total = conn.execute(f"SELECT COUNT(*) n FROM tickets WHERE {' AND '.join(where)}", args).fetchone()["n"]
        rows = conn.execute(f"SELECT * FROM tickets WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ? OFFSET ?", (*args, limit, offset)).fetchall()
        return jsonify(total=total, items=[services.ticket_dict(conn, r, "admin") for r in rows])

    @app.get("/api/admin/tickets/<int:tid>")
    @role_required("admin")
    def admin_ticket(tid):
        conn = db.get_db()
        t = services.get_ticket(conn, tid)
        if not t:
            return err("Ticket not found", 404)
        return jsonify(ticket=ticket_detail(conn, t, "admin"))

    @app.post("/api/admin/tickets/<int:tid>/assign")
    @role_required("admin")
    def admin_assign(tid):
        b = body()
        try:
            services.assign(db.get_db(), tid, int(b.get("tech_id")), actor(current_user()))
        except (ValueError, TypeError) as e:
            return err(str(e))
        return jsonify(ticket=ticket_detail(db.get_db(), services.get_ticket(db.get_db(), tid), "admin"))

    @app.post("/api/admin/tickets/<int:tid>/status")
    @role_required("admin")
    def admin_status(tid):
        b = body()
        conn = db.get_db()
        try:
            services.set_status(conn, tid, b.get("status"), actor(current_user()), (b.get("note") or "")[:400])
            services.audit(conn, current_user(), "ticket_status", f"{services.code(tid)} -> {b.get('status')}")
            conn.commit()
        except ValueError as e:
            return err(str(e))
        return jsonify(ticket=ticket_detail(conn, services.get_ticket(conn, tid), "admin"))

    @app.post("/api/admin/tickets/<int:tid>/review")
    @role_required("admin")
    def admin_review(tid):
        b = body()
        try:
            services.review_fix(db.get_db(), tid, current_user(), cls=b.get("cls"), lamp_id=(b.get("lamp_id") or "").strip().upper() or None, approve=True)
        except ValueError as e:
            return err(str(e))
        return jsonify(ticket=ticket_detail(db.get_db(), services.get_ticket(db.get_db(), tid), "admin"))

    @app.post("/api/admin/tickets/<int:tid>/note")
    @role_required("admin")
    def admin_note(tid):
        conn = db.get_db()
        text = (body().get("note") or "").strip()[:400]
        if not text or not services.get_ticket(conn, tid):
            return err("Write a note first")
        services.log_event(conn, tid, actor(current_user()), "note", text)
        conn.commit()
        return jsonify(ok=True)

    @app.get("/api/admin/lamps/<lamp_id>")
    @role_required("admin")
    def admin_lamp(lamp_id):
        conn = db.get_db()
        l = conn.execute("SELECT * FROM lamps WHERE id=?", (lamp_id,)).fetchone()
        if not l:
            return err("Lamp not found", 404)
        risk = next((r for r in ml.score_lamps(conn) if r["id"] == lamp_id), None)
        hist = conn.execute("SELECT * FROM tickets WHERE lamp_id=? ORDER BY ts DESC LIMIT 12", (lamp_id,)).fetchall()
        return jsonify(lamp=dict(l), risk=risk, tickets=[services.ticket_dict(conn, r, "owner") for r in hist])

    @app.get("/api/admin/hotspots")
    @role_required("admin")
    def admin_hotspots():
        conn = db.get_db()
        risk = ml.score_lamps(conn)
        hs = ml.hotspots(conn, risk)
        hs["lamps"] = [dict(id=l["id"], lat=l["lat"], lng=l["lng"], status=l["status"], risk=round(l["risk"], 3), zone=l["zone"], f90=l["faults_90d"]) for l in risk]
        return jsonify(hs)

    @app.get("/api/admin/predictions")
    @role_required("admin")
    def admin_predictions():
        conn = db.get_db()
        rain = request.args.get("rain")
        rain = float(rain) if rain not in (None, "") else None
        risk = ml.score_lamps(conn, rain_mm=rain)
        fc = ml.forecast(conn)
        meta_ = ml.risk_meta()
        risk.sort(key=lambda x: -x["risk"])
        pending = {r["lamp_id"] for r in conn.execute("SELECT lamp_id FROM tickets WHERE status IN ('open','assigned','in_progress','review') AND lamp_id IS NOT NULL")}
        zones = {}
        for r in risk:
            z = zones.setdefault(r["zone"], dict(zone=r["zone"], name=geo.ZM[r["zone"]]["name"], n=0, sum=0.0, high=0))
            z["n"] += 1
            z["sum"] += r["risk"]
            z["high"] += 1 if r["risk"] >= .55 else 0
        return jsonify(rain=rain if rain is not None else db.setting(conn, "rain_mm"), forecast=fc, model=meta_,
                       high_risk=sum(1 for r in risk if r["risk"] >= .55), total=len(risk),
                       expected_failures=round(sum(r["risk"] for r in risk)),
                       zones=[dict(zone=z["zone"], name=z["name"], avg=z["sum"] / z["n"], high=z["high"], n=z["n"]) for z in zones.values()],
                       top=[dict(r, risk=round(r["risk"], 3), pending=r["id"] in pending) for r in risk[:40]],
                       lamps=[dict(id=r["id"], lat=r["lat"], lng=r["lng"], risk=round(r["risk"], 3), status=r["status"]) for r in risk])

    @app.post("/api/admin/preventive")
    @role_required("admin")
    def admin_preventive():
        ids = body().get("lamp_ids") or []
        made = services.create_preventive(db.get_db(), [str(i) for i in ids][:50], current_user())
        return jsonify(created=len(made))

    @app.get("/api/admin/schedule")
    @role_required("admin")
    def admin_schedule():
        conn = db.get_db()
        return jsonify(opt=services.plan(conn, "opt"), manual=services.plan(conn, "manual"),
                       assigned=conn.execute("SELECT COUNT(*) n FROM tickets WHERE status IN ('assigned','in_progress')").fetchone()["n"],
                       pool=len(services.planning_pool(conn)),
                       needs_location=conn.execute("SELECT COUNT(*) n FROM tickets WHERE status='review'").fetchone()["n"])

    @app.post("/api/admin/schedule/dispatch")
    @role_required("admin")
    def admin_dispatch():
        p = services.dispatch(db.get_db(), current_user())
        return jsonify(plan=p)

    # ---------------------------------------------------------- admin: people
    @app.get("/api/admin/technicians")
    @role_required("admin")
    def admin_techs():
        conn = db.get_db()
        out = []
        for t in conn.execute("SELECT * FROM technicians"):
            s = conn.execute("SELECT COUNT(*) n, AVG(resolved_ts-ts) d, AVG(rating) r FROM tickets WHERE tech_id=? AND status='resolved'", (t["id"],)).fetchone()
            cur = conn.execute("SELECT COUNT(*) n FROM tickets WHERE tech_id=? AND status IN ('assigned','in_progress')", (t["id"],)).fetchone()["n"]
            u = conn.execute("SELECT email FROM users WHERE id=?", (t["user_id"],)).fetchone()
            out.append(dict(id=t["id"], name=t["name"], color=t["color"], skills=json.loads(t["skills"]), on_shift=bool(t["on_shift"]), depot_zone=t["depot_zone"],
                            capacity_min=t["capacity_min"], current=cur, done=s["n"], avg_resolution_h=round((s["d"] or 0) / 3.6e6, 1), rating=round(s["r"], 2) if s["r"] else None,
                            email=u["email"] if u else None))
        return jsonify(items=out)

    @app.post("/api/admin/technicians")
    @role_required("admin")
    def admin_tech_create():
        b = body()
        conn = db.get_db()
        name, email, pw = (b.get("name") or "").strip(), (b.get("email") or "").strip().lower(), b.get("password") or ""
        zone = b.get("zone") if b.get("zone") in geo.ZM else "vashi"
        skills = [s for s in (b.get("skills") or []) if s in ("hv", "bucket")]
        if len(name) < 2 or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) or len(pw) < 6:
            return err("Name, a valid email and a password of 6+ characters are required")
        if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            return err("That email is already registered", 409)
        cur = conn.execute("INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,'technician',?)", (name, email, generate_password_hash(pw), db.now()))
        z = geo.ZM[zone]
        colors = ["#5B9BFF", "#2CD3B5", "#FFB454", "#C58BFF", "#FF7A9C", "#7BD88F", "#F2C94C"]
        n = conn.execute("SELECT COUNT(*) n FROM technicians").fetchone()["n"]
        conn.execute("INSERT INTO technicians(user_id,name,skills,color,depot_zone,depot_lat,depot_lng) VALUES(?,?,?,?,?,?,?)",
                     (cur.lastrowid, name, json.dumps(skills), colors[n % len(colors)], z["name"], z["lat"] + .001, z["lng"] + .001))
        services.audit(conn, current_user(), "technician_created", name)
        conn.commit()
        return jsonify(ok=True), 201

    @app.patch("/api/admin/technicians/<int:tid>")
    @role_required("admin")
    def admin_tech_update(tid):
        b = body()
        conn = db.get_db()
        if "on_shift" in b:
            conn.execute("UPDATE technicians SET on_shift=? WHERE id=?", (1 if b["on_shift"] else 0, tid))
        if "skills" in b:
            conn.execute("UPDATE technicians SET skills=? WHERE id=?", (json.dumps([s for s in b["skills"] if s in ("hv", "bucket")]), tid))
        services.audit(conn, current_user(), "technician_updated", str(tid))
        conn.commit()
        return jsonify(ok=True)

    @app.get("/api/admin/users")
    @role_required("admin")
    def admin_users():
        conn = db.get_db()
        rows = conn.execute("""SELECT u.*, (SELECT COUNT(*) FROM tickets t WHERE t.reporter_id=u.id) reports FROM users u ORDER BY u.role, u.name""").fetchall()
        return jsonify(items=[dict(id=u["id"], name=u["name"], email=u["email"], role=u["role"], active=bool(u["active"]), created_at=u["created_at"],
                                   last_login=u["last_login"], reports=u["reports"]) for u in rows])

    @app.patch("/api/admin/users/<int:uid>")
    @role_required("admin")
    def admin_user_update(uid):
        b = body()
        conn = db.get_db()
        me_ = current_user()
        if uid == me_["id"]:
            return err("You cannot change your own account here")
        if "active" in b:
            conn.execute("UPDATE users SET active=? WHERE id=?", (1 if b["active"] else 0, uid))
        if b.get("role") in ("citizen", "admin"):
            conn.execute("UPDATE users SET role=? WHERE id=? AND role!='technician'", (b["role"], uid))
        services.audit(conn, me_, "user_updated", f"{uid} {json.dumps(b)}")
        conn.commit()
        return jsonify(ok=True)

    # ---------------------------------------------------------- admin: alerts / analytics / model
    @app.get("/api/admin/alerts")
    @role_required("admin")
    def admin_alerts():
        return jsonify(items=services.compute_alerts(db.get_db()))

    @app.post("/api/admin/alerts/ack")
    @role_required("admin")
    def admin_ack():
        conn = db.get_db()
        b = body()
        keys = [a["key"] for a in services.compute_alerts(conn)] if b.get("all") else [b.get("key")]
        for k in keys:
            if k:
                conn.execute("INSERT OR REPLACE INTO alert_acks(key,ts,user_id) VALUES(?,?,?)", (k, db.now(), current_user()["id"]))
        conn.commit()
        return jsonify(ok=True)

    @app.get("/api/admin/analytics")
    @role_required("admin")
    def admin_analytics():
        conn = db.get_db()
        now = db.now()
        res = conn.execute("SELECT cls, COUNT(*) n, AVG(resolved_ts-ts) d, AVG(CASE WHEN resolved_ts<=due_ts THEN 1.0 ELSE 0 END) sla FROM tickets WHERE status='resolved' AND kind='complaint' GROUP BY cls").fetchall()
        weeks = []
        for i in range(11, -1, -1):
            s, e = now - (i + 1) * 7 * 86400000, now - i * 7 * 86400000
            r = conn.execute("SELECT COUNT(*) n, AVG(CASE WHEN resolved_ts<=due_ts THEN 1.0 ELSE 0 END) sla, AVG(resolved_ts-ts) d FROM tickets WHERE status='resolved' AND kind='complaint' AND ts>=? AND ts<?", (s, e)).fetchone()
            weeks.append(dict(end=e, n=r["n"], sla=round((r["sla"] or 0) * 100), hours=round((r["d"] or 0) / 3.6e6, 1)))
        ch = conn.execute("SELECT channel, COUNT(*) n, AVG(conf) c, AVG(CASE WHEN status='review' THEN 1.0 ELSE 0 END) rv FROM tickets WHERE kind='complaint' GROUP BY channel").fetchall()
        langs = conn.execute("SELECT lang, COUNT(*) n FROM tickets WHERE kind='complaint' GROUP BY lang").fetchall()
        ratings = conn.execute("SELECT rating, COUNT(*) n FROM tickets WHERE rating IS NOT NULL GROUP BY rating ORDER BY rating").fetchall()
        zone = conn.execute("SELECT zone, COUNT(*) n, AVG(resolved_ts-ts) d FROM tickets WHERE kind='complaint' AND zone IS NOT NULL AND status='resolved' GROUP BY zone").fetchall()
        return jsonify(
            by_class=[dict(cls=r["cls"], label=CLASS_META[r["cls"]]["label"], color=CLASS_META[r["cls"]]["color"], n=r["n"], hours=round(r["d"] / 3.6e6, 1), sla=round(r["sla"] * 100)) for r in res],
            weeks=weeks, channels=[dict(channel=r["channel"], n=r["n"], conf=round(r["c"], 3), review=round(r["rv"] * 100)) for r in ch],
            langs=[dict(lang=r["lang"], n=r["n"]) for r in langs], ratings=[dict(rating=r["rating"], n=r["n"]) for r in ratings],
            zones=[dict(zone=geo.ZM[r["zone"]]["name"], n=r["n"], hours=round(r["d"] / 3.6e6, 1)) for r in zone])

    @app.get("/api/admin/model")
    @role_required("admin")
    def admin_model():
        conn = db.get_db()
        return jsonify(nlp=nlp.get_metrics(), risk=ml.risk_meta(), corrections=conn.execute("SELECT COUNT(*) n FROM corrections").fetchone()["n"],
                       recent=[dict(text=r["text"], label=r["label"], ts=r["ts"]) for r in conn.execute("SELECT * FROM corrections ORDER BY ts DESC LIMIT 8")],
                       classes={k: v["label"] for k, v in CLASS_META.items()})

    @app.post("/api/admin/model/retrain")
    @role_required("admin")
    def admin_retrain():
        conn = db.get_db()
        before = nlp.get_metrics()
        rows = conn.execute("SELECT text,label FROM corrections").fetchall()
        after = nlp.train([(r["text"], r["label"]) for r in rows])
        services.audit(conn, current_user(), "model_retrain", f"{len(rows)} corrections")
        conn.commit()
        return jsonify(before=dict(accuracy=before["accuracy"], macro_f1=before["macro_f1"]), after=after, corrections=len(rows))

    # ---------------------------------------------------------- admin: channels / import / export
    @app.post("/api/intake/<channel>")
    def intake(channel):
        """Webhook for external channels. Authenticated by an admin session or the X-API-Key header."""
        conn = db.get_db()
        u = current_user()
        key_ok = request.headers.get("X-API-Key") == db.setting(conn, "api_key")
        if not (key_ok or (u and u["role"] == "admin")):
            return err("Unauthorised: send X-API-Key or sign in as admin", 401)
        b = body()
        channel = channel.lower()
        names = {"whatsapp": "WhatsApp", "sms": "SMS", "email": "Email", "twitter": "X / Twitter", "x": "X / Twitter", "call": "Call centre", "web": "Web portal"}
        if channel not in names:
            return err("Unknown channel. Use whatsapp, sms, email, twitter, call or web.", 404)
        ch = names[channel]
        gps, who = None, None
        if channel == "whatsapp":
            text, who = b.get("body") or "", b.get("from")
            loc = b.get("location") or {}
            if loc.get("lat") is not None:
                gps = (float(loc["lat"]), float(loc["lng"]))
        elif channel == "sms":
            text, who = b.get("body") or "", b.get("from")
        elif channel == "email":
            text, who = f"Subject: {b.get('subject', '')}\n{b.get('body', '')}", b.get("from")
        elif channel in ("twitter", "x"):
            text, who = b.get("text") or "", b.get("user")
        elif channel == "call":
            text, who = b.get("transcript") or "", b.get("caller")
        else:
            text, who = b.get("text") or "", b.get("name")
            if b.get("channel") in services.CHANNELS:
                ch = b["channel"]
        if len(text.strip()) < 4:
            return err("Empty message")
        res = services.ingest(conn, text[:2000], ch, gps=gps, guest_name=(who or "Anonymous")[:60])
        return jsonify(ticket=res["ticket"], merged=res["merged"], reply=res["reply"],
                       analysis=analysis_dict(conn, res["analysis"], res["lamp"], None)), 201

    @app.post("/api/admin/import")
    @role_required("admin")
    def admin_import():
        conn = db.get_db()
        if request.files.get("file"):
            raw = request.files["file"].read().decode("utf-8-sig", errors="replace")
        else:
            raw = body().get("csv") or ""
        rows = list(csv.DictReader(io.StringIO(raw)))
        if not rows or "text" not in (rows[0].keys()):
            return err("CSV needs a header row with at least a 'text' column (optional: channel, lat, lng)")
        created = merged = review = 0
        for r in rows[:300]:
            t = (r.get("text") or "").strip()
            if not t:
                continue
            ch = r.get("channel") if r.get("channel") in services.CHANNELS else "Web portal"
            gps = None
            try:
                if r.get("lat") and r.get("lng"):
                    gps = (float(r["lat"]), float(r["lng"]))
            except ValueError:
                gps = None
            res = services.ingest(conn, t[:2000], ch, gps=gps, guest_name="Bulk import")
            if res["merged"]:
                merged += 1
            else:
                created += 1
                review += 1 if res["ticket"]["status"] == "review" else 0
        services.audit(conn, current_user(), "bulk_import", f"{created} created, {merged} merged")
        conn.commit()
        return jsonify(created=created, merged=merged, review=review, rows=len(rows))

    @app.get("/api/admin/export/tickets.csv")
    @role_required("admin")
    def admin_export():
        conn = db.get_db()
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["ticket", "created", "channel", "language", "fault_type", "confidence", "severity", "severity_score", "zone", "lamp", "status",
                    "reports", "technician", "sla_due", "resolved", "rating", "text"])
        fmt = lambda ms: time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000)) if ms else ""
        for t in conn.execute("SELECT * FROM tickets ORDER BY ts DESC"):
            tech = conn.execute("SELECT name FROM technicians WHERE id=?", (t["tech_id"],)).fetchone() if t["tech_id"] else None
            w.writerow([services.code(t["id"]), fmt(t["ts"]), t["channel"], t["lang"], CLASS_META[t["cls"]]["label"], round(t["conf"], 3), t["sev_label"], t["sev"],
                        t["zone"] or "", t["lamp_id"] or "", t["status"], t["reports"], tech["name"] if tech else "", fmt(t["due_ts"]), fmt(t["resolved_ts"]), t["rating"] or "", t["text"]])
        return Response(out.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=prakash_tickets.csv"})

    @app.get("/api/admin/audit")
    @role_required("admin")
    def admin_audit():
        rows = db.get_db().execute("SELECT * FROM audit ORDER BY ts DESC LIMIT 60").fetchall()
        return jsonify(items=[dict(ts=r["ts"], user=r["user_name"], action=r["action"], detail=r["detail"]) for r in rows])

    # ---------------------------------------------------------- admin: settings / simulator / reset
    @app.get("/api/admin/settings")
    @role_required("admin")
    def admin_settings():
        conn = db.get_db()
        return jsonify({k: db.setting(conn, k) for k in db.DEFAULT_SETTINGS})

    @app.put("/api/admin/settings")
    @role_required("admin")
    def admin_settings_put():
        conn = db.get_db()
        b = body()
        if "sla_hours" in b:
            s = {k: max(1, min(500, int(b["sla_hours"].get(k, 1)))) for k in ("Critical", "High", "Medium", "Low")}
            db.set_setting(conn, "sla_hours", s)
        if "review_threshold" in b:
            db.set_setting(conn, "review_threshold", max(0.2, min(0.95, float(b["review_threshold"]))))
        if "auto_dispatch_critical" in b:
            db.set_setting(conn, "auto_dispatch_critical", bool(b["auto_dispatch_critical"]))
        if "rain_mm" in b:
            db.set_setting(conn, "rain_mm", max(0, min(400, float(b["rain_mm"]))))
        if "simulator_on" in b:
            db.set_setting(conn, "simulator_on", bool(b["simulator_on"]))
        if "simulator_interval" in b:
            db.set_setting(conn, "simulator_interval", max(5, min(300, int(b["simulator_interval"]))))
        services.audit(conn, current_user(), "settings", json.dumps(b)[:200])
        conn.commit()
        return jsonify({k: db.setting(conn, k) for k in db.DEFAULT_SETTINGS})

    @app.post("/api/admin/simulator/burst")
    @role_required("admin")
    def sim_burst():
        from . import simulator
        n = max(1, min(10, int(body().get("n") or 1)))
        made = [simulator.one(db.get_db()) for _ in range(n)]
        return jsonify(created=len([m for m in made if m]))

    @app.post("/api/admin/reset")
    @role_required("admin")
    def admin_reset():
        conn = db.get_db()
        if body().get("confirm") != "RESET":
            return err("Send confirm: 'RESET' to wipe and regenerate demo data")
        me_email = current_user()["email"]
        seed.run(conn)
        u = conn.execute("SELECT id FROM users WHERE email=?", (me_email,)).fetchone()
        session["uid"] = u["id"] if u else conn.execute("SELECT id FROM users WHERE role='admin'").fetchone()["id"]
        hub.publish("reset", {}, roles=("admin", "citizen", "technician"))
        return jsonify(ok=True)

    @app.errorhandler(404)
    def nf(_e):
        if request.path.startswith("/api/"):
            return err("Not found", 404)
        return send_from_directory(FRONTEND, "index.html")

    @app.errorhandler(413)
    def too_big(_e):
        return err("That file is too large (6 MB max)", 413)

    @app.errorhandler(Exception)
    def boom(e):
        from werkzeug.exceptions import HTTPException
        if isinstance(e, HTTPException):
            return e
        import traceback
        traceback.print_exc()
        return err("Something went wrong on the server", 500)
