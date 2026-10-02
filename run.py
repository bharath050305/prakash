"""Start Prakash:  python run.py   ->  http://localhost:5000"""
import argparse
import warnings

warnings.filterwarnings("ignore")

from backend.app import create_app  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to let phones on the same Wi-Fi connect")
    ap.add_argument("--port", type=int, default=5000)
    ap.add_argument("--reset", action="store_true", help="wipe data/ and regenerate the demo data")
    a = ap.parse_args()
    if a.reset:
        import os
        from backend import db
        for f in ("prakash.db", "prakash.db-wal", "prakash.db-shm"):
            p = os.path.join(db.DATA_DIR, f)
            if os.path.exists(p):
                os.remove(p)
    app = create_app()
    print(f"\n  Prakash is running at  http://{'localhost' if a.host == '127.0.0.1' else a.host}:{a.port}\n")
    app.run(host=a.host, port=a.port, threaded=True, debug=False)
