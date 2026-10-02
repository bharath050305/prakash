"""Live-intake simulator: posts realistic citizen complaints through the real pipeline so dashboards stay alive during a demo."""
import random
import threading
import time

from . import db, geo, seed, services, training_data as td

_rnd = random.Random()
_started = False


def one(conn=None):
    """Create one simulated complaint. ~12% have no place name, ~15% carry a GPS pin, ~15% repeat a live fault (duplicate)."""
    own = conn is None
    conn = conn or db.connect()
    try:
        ch = _rnd.choices(services.CHANNELS, weights=[36, 22, 14, 12, 8, 8])[0]
        r = _rnd.random()
        live = conn.execute("SELECT * FROM tickets WHERE status IN ('open','assigned') AND lamp_id IS NOT NULL AND kind='complaint' ORDER BY RANDOM() LIMIT 1").fetchone()
        if r < .15 and live:
            # someone else reports the same lamp again
            text = f"Same problem here, {live['text'][:120]}"
            gps = (live["lat"], live["lng"])
            res = services.ingest(conn, live["text"], ch, gps=gps, guest_name="Another citizen")
        else:
            zone = _rnd.choice(geo.ZONES)["id"]
            cls = _rnd.choices(td.CLASSES, weights=[30, 18, 8, 12, 10, 8, 8, 10])[0]
            text = seed.gen_text(_rnd, cls, zone, with_place=_rnd.random() > .12)
            gps = None
            if _rnd.random() < .15:
                lamp = conn.execute("SELECT lat,lng FROM lamps WHERE zone=? ORDER BY RANDOM() LIMIT 1", (zone,)).fetchone()
                gps = (lamp["lat"], lamp["lng"])
            res = services.ingest(conn, text, ch, gps=gps, guest_name=_rnd.choice(["Anonymous", "WhatsApp user", "Walk-in caller"]))
        return res
    except Exception:
        conn.rollback()
        import traceback
        traceback.print_exc()
        return None
    finally:
        if own:
            conn.close()


def _loop():
    conn = db.connect()
    due = 0.0
    while True:
        time.sleep(2)
        try:
            if not db.setting(conn, "simulator_on"):
                due = 0.0          # switching it on fires the first complaint immediately
                continue
            if time.time() >= due:
                one(conn)
                due = time.time() + max(5, db.setting(conn, "simulator_interval") or 25)
        except Exception:
            time.sleep(5)


def start():
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, daemon=True, name="intake-simulator").start()
