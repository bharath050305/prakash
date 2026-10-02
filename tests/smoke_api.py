"""End-to-end API smoke test against a running server:  python tests/smoke_api.py [base_url]"""
import json, sys, requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5000"
ok = fail = 0

def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  ok   {name}")
    else: fail += 1; print(f"  FAIL {name} {extra}")

def login(email, pw):
    s = requests.Session()
    r = s.post(BASE + "/api/auth/login", json={"email": email, "password": pw})
    return s, r

print("auth")
s_admin, r = login("admin@prakash.demo", "Admin@123"); check("admin login", r.status_code == 200 and r.json()["user"]["role"] == "admin")
s_cit, r = login("citizen@prakash.demo", "Citizen@123"); check("citizen login", r.status_code == 200)
s_tech, r = login("sneha@prakash.demo", "Tech@123"); check("technician login", r.status_code == 200)
_, r = login("admin@prakash.demo", "wrong"); check("bad password rejected", r.status_code == 401)
check("anonymous blocked", requests.get(BASE + "/api/admin/overview").status_code == 401)

print("role isolation")
check("citizen cannot open admin api", s_cit.get(BASE + "/api/admin/overview").status_code == 403)
check("technician cannot open admin api", s_tech.get(BASE + "/api/admin/tickets").status_code == 403)
check("admin cannot use tech api", s_admin.get(BASE + "/api/tech/jobs").status_code == 403)
check("citizen cannot export", s_cit.get(BASE + "/api/admin/export/tickets.csv").status_code == 403)

print("citizen flow")
r = s_cit.post(BASE + "/api/analyze", json={"text": "Streetlight near Vashi Station is sparking and a wire is hanging", "channel": "Web portal"})
a = r.json()["analysis"]; check("analyze -> hazard", r.status_code == 200 and a["cls"] == "hazard", a.get("cls"))
check("analyze -> location", a["geo"] and a["geo"]["zone"] == "vashi")
r = s_cit.post(BASE + "/api/tickets", json={"text": "Street light pole near Airoli Bridge is leaning dangerously after rain, sparks seen", "channel": "Web portal"})
check("create ticket", r.status_code == 201, r.text[:200]); t = r.json()["ticket"]
check("hazard is high/critical", t["sev_label"] in ("High", "Critical"), t["sev_label"])
tid = t["id"]
mine = s_cit.get(BASE + "/api/my/tickets").json()["items"]; check("listed in my tickets", any(x["id"] == tid for x in mine))
check("citizen can read own ticket", s_cit.get(f"{BASE}/api/tickets/{tid}").status_code == 200)
s_other, _ = login("meera@prakash.demo", "Citizen@123")
d = s_other.get(f"{BASE}/api/tickets/{tid}").json()["ticket"]; check("other citizen only gets public view", d.get("text") is None)
check("tech cannot read unassigned ticket", s_tech.get(f"{BASE}/api/tickets/{tid}").status_code == 403)
check("too-short text rejected", s_cit.post(BASE + "/api/tickets", json={"text": "hi"}).status_code == 400)
r = s_cit.post(BASE + "/api/tickets", json={"text": "Street light pole near Airoli Bridge is leaning dangerously after rain, sparks seen", "channel": "Web portal"})
check("same fault merges instead of duplicating", r.json().get("merged") is True)

print("admin flow")
ov = s_admin.get(BASE + "/api/admin/overview").json(); check("overview kpis", ov["open"] > 0 and ov["lamps_total"] > 0)
lst = s_admin.get(BASE + "/api/admin/tickets?scope=active&limit=5").json(); check("tickets list", lst["total"] > 0 and len(lst["items"]) > 0)
d = s_admin.get(f"{BASE}/api/admin/tickets/{tid}").json()["ticket"]; check("admin sees NLP detail", "probs" in d and "entities" in d and len(d["events"]) > 2)
sch = s_admin.get(BASE + "/api/admin/schedule").json(); o, m = sch["opt"]["metrics"], sch["manual"]["metrics"]
check("optimizer reaches urgent jobs much sooner", (o["avg_high_wait_min"] or 0) < (m["avg_high_wait_min"] or 1e9), f'{o["avg_high_wait_min"]} vs {m["avg_high_wait_min"]} min')
check("optimizer distance is competitive", o["km"] <= m["km"] * 1.15, f'{o["km"]} vs {m["km"]} km')
check("optimizer respects skills", sch["opt"]["metrics"]["skill_mismatch"] == 0)
r = s_admin.post(BASE + "/api/admin/schedule/dispatch", json={}); check("dispatch", r.status_code == 200)
t2 = s_admin.get(f"{BASE}/api/admin/tickets/{tid}").json()["ticket"]; check("ticket assigned after dispatch", t2["status"] == "assigned" and t2["tech_name"], t2["status"])
pr = s_admin.get(BASE + "/api/admin/predictions").json(); check("predictions", len(pr["top"]) > 0 and pr["model"]["auc"] > 0.6)
check("hotspots", len(s_admin.get(BASE + "/api/admin/hotspots").json()["current"]) >= 1)
check("alerts", len(s_admin.get(BASE + "/api/admin/alerts").json()["items"]) >= 1)
check("model metrics", s_admin.get(BASE + "/api/admin/model").json()["nlp"]["accuracy"] > .7)
r = s_admin.post(BASE + "/api/intake/whatsapp", json={"from": "+91 90000 11111", "body": "Nerul station ke paas light band hai 2 din se"}); check("whatsapp webhook", r.status_code == 201 and r.json()["analysis"]["lang"] == "Hinglish", r.text[:160])
r = requests.post(BASE + "/api/intake/sms", json={"body": "lamp dead near Belapur Station"}, headers={"X-API-Key": "prakash-demo-key"}); check("api-key webhook", r.status_code == 201)
check("webhook without key rejected", requests.post(BASE + "/api/intake/sms", json={"body": "x light"}).status_code == 401)
csvr = s_admin.get(BASE + "/api/admin/export/tickets.csv"); check("csv export", csvr.status_code == 200 and csvr.text.startswith("ticket,"))

print("technician flow")
jobs = s_tech.get(BASE + "/api/tech/jobs").json(); check("tech sees jobs", len(jobs["jobs"]) > 0)
mine_job = jobs["jobs"][0]["id"]
check("start job", s_tech.post(f"{BASE}/api/tech/jobs/{mine_job}/start").status_code == 200)
r = s_tech.post(f"{BASE}/api/tech/jobs/{mine_job}/complete", json={"note": "Replaced driver", "parts": "Driver"}); check("complete job", r.status_code == 200)
d = s_admin.get(f"{BASE}/api/admin/tickets/{mine_job}").json()["ticket"]; check("ticket resolved", d["status"] == "resolved")
other = [t["id"] for t in s_admin.get(BASE + "/api/admin/tickets?status=open&limit=3").json()["items"]]
if other: check("tech cannot start someone else's job", s_tech.post(f"{BASE}/api/tech/jobs/{other[0]}/start").status_code == 403)

print(f"\n{ok} passed, {fail} failed"); sys.exit(1 if fail else 0)
