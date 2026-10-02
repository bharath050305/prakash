import pytest

from backend import ml, services


def test_ingest_merges_duplicates_and_flags_review(conn):
    a = services.ingest(conn, "Street light not working near Vashi Station since 2 days", "WhatsApp", guest_name="t1")
    assert not a["merged"] and a["ticket"]["lamp_id"]
    b = services.ingest(conn, "vashi station ke paas light band hai", "WhatsApp", guest_name="t2")
    assert b["merged"] and b["ticket"]["id"] == a["ticket"]["id"] and b["ticket"]["reports"] == 2
    vague = services.ingest(conn, "street light is off in our lane", "Email", guest_name="t3")
    assert vague["ticket"]["status"] == "review"


def test_exact_gps_reports_on_different_lamps_do_not_merge(conn):
    lamps = conn.execute("SELECT * FROM lamps WHERE zone='airoli' AND status='ok' LIMIT 2").fetchall()
    ids = set()
    for lamp in lamps:
        r = services.ingest(conn, "lamp post is dead", "WhatsApp", gps=(lamp["lat"], lamp["lng"]), guest_name="g")
        assert not r["merged"]
        ids.add(r["ticket"]["id"])
    assert len(ids) == 2


def test_lifecycle_updates_lamp_status(conn):
    lamp = conn.execute("SELECT * FROM lamps WHERE zone='seawoods' AND status='ok' LIMIT 1").fetchone()
    r = services.ingest(conn, "Street light not working", "Web portal", gps=(lamp["lat"], lamp["lng"]), guest_name="g")
    tid = r["ticket"]["id"]
    status = lambda: conn.execute("SELECT status FROM lamps WHERE id=?", (lamp["id"],)).fetchone()["status"]  # noqa: E731
    assert status() == "fault"
    tech = conn.execute("SELECT id FROM technicians WHERE skills='[]' LIMIT 1").fetchone()
    services.assign(conn, tid, tech["id"], "test")
    assert status() == "assigned"
    services.set_status(conn, tid, "resolved", "test", "fixed")
    assert status() == "ok"


def test_assign_rejects_unqualified_technician(conn):
    lamp = conn.execute("SELECT * FROM lamps WHERE zone='belapur' AND status='ok' LIMIT 1").fetchone()
    r = services.ingest(conn, "Sparks and a hanging wire on the pole", "Call centre", gps=(lamp["lat"], lamp["lng"]), guest_name="g")
    plain = conn.execute("SELECT id FROM technicians WHERE skills='[]' LIMIT 1").fetchone()
    with pytest.raises(ValueError):
        services.assign(conn, r["ticket"]["id"], plain["id"], "test")


def test_predictions_and_forecast(conn):
    risk = ml.score_lamps(conn)
    assert len(risk) == conn.execute("SELECT COUNT(*) n FROM lamps").fetchone()["n"]
    assert all(0 <= r["risk"] <= 1 for r in risk)
    wet = sum(r["risk"] for r in ml.score_lamps(conn, rain_mm=250))
    dry = sum(r["risk"] for r in ml.score_lamps(conn, rain_mm=0))
    assert wet > dry  # more rain, more predicted failures
    fc = ml.forecast(conn)
    assert len(fc["fcst"]) == 6 and all(lo <= f <= hi for lo, f, hi in zip(fc["lo"], fc["fcst"], fc["hi"]))


def test_hotspots_cluster_faulty_lamps(conn):
    hs = ml.hotspots(conn)
    assert hs["current"] and all(c["n"] >= 3 for c in hs["current"])
    assert len(hs["zones"]) == 8


def test_review_queue_human_correction_releases_ticket(conn):
    r = services.ingest(conn, "street light is off in our lane, please fix", "Email", guest_name="v")
    assert r["ticket"]["status"] == "review"
    admin = conn.execute("SELECT * FROM users WHERE role='admin'").fetchone()
    lamp = conn.execute("SELECT * FROM lamps WHERE zone='ghansoli' AND status='ok' LIMIT 1").fetchone()
    t = services.review_fix(conn, r["ticket"]["id"], admin, cls="flicker", lamp_id=lamp["id"])
    assert t["status"] == "open" and t["cls"] == "flicker" and t["lamp_id"] == lamp["id"]
    assert conn.execute("SELECT COUNT(*) n FROM corrections WHERE ticket_id=?", (t["id"],)).fetchone()["n"] == 1
