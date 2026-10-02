"""SQLite storage. One connection per request/thread, WAL mode so the live simulator can write concurrently."""
import json
import os
import sqlite3
import threading
import time

from .config import DATA_DIR
DB_PATH = os.path.join(DATA_DIR, "prakash.db")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('citizen','admin','technician')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS technicians(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL,
  depot_zone TEXT NOT NULL,
  depot_lat REAL NOT NULL,
  depot_lng REAL NOT NULL,
  on_shift INTEGER NOT NULL DEFAULT 1,
  capacity_min INTEGER NOT NULL DEFAULT 480
);
CREATE TABLE IF NOT EXISTS lamps(
  id TEXT PRIMARY KEY,
  lat REAL NOT NULL, lng REAL NOT NULL, zone TEXT NOT NULL,
  age INTEGER NOT NULL,
  volt_var REAL NOT NULL, driver INTEGER NOT NULL, burn_hours INTEGER NOT NULL, pole_cond REAL NOT NULL,
  wattage INTEGER NOT NULL DEFAULT 70,
  status TEXT NOT NULL DEFAULT 'ok'
);
CREATE TABLE IF NOT EXISTS tickets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'complaint',
  text TEXT NOT NULL,
  clean_text TEXT,
  lang TEXT,
  cls TEXT NOT NULL,
  conf REAL NOT NULL DEFAULT 0,
  sev INTEGER NOT NULL DEFAULT 0,
  sev_label TEXT NOT NULL DEFAULT 'Low',
  sev_why TEXT NOT NULL DEFAULT '[]',
  entities TEXT NOT NULL DEFAULT '[]',
  probs TEXT NOT NULL DEFAULT '[]',
  why_tokens TEXT NOT NULL DEFAULT '[]',
  zone TEXT, lat REAL, lng REAL, lamp_id TEXT,
  geo_by TEXT, geo_conf REAL,
  status TEXT NOT NULL DEFAULT 'open',
  due_ts INTEGER,
  reporter_id INTEGER REFERENCES users(id),
  reporter_name TEXT,
  reports INTEGER NOT NULL DEFAULT 1,
  tech_id INTEGER REFERENCES technicians(id),
  route_seq INTEGER,
  eta_ts INTEGER,
  started_ts INTEGER,
  resolved_ts INTEGER,
  resolution_note TEXT,
  parts_used TEXT,
  photo TEXT,
  rating INTEGER,
  feedback TEXT,
  review_reason TEXT,
  auto_reply TEXT
);
CREATE INDEX IF NOT EXISTS ix_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS ix_tickets_lamp ON tickets(lamp_id);
CREATE INDEX IF NOT EXISTS ix_tickets_ts ON tickets(ts);
CREATE TABLE IF NOT EXISTS ticket_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS ticket_reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER, ts INTEGER NOT NULL, channel TEXT, text TEXT
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ts INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, ticket_id INTEGER, read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS alert_acks(key TEXT PRIMARY KEY, ts INTEGER NOT NULL, user_id INTEGER);
CREATE TABLE IF NOT EXISTS corrections(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, text TEXT NOT NULL, label TEXT NOT NULL, ticket_id INTEGER, user_id INTEGER
);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, user_id INTEGER, user_name TEXT, action TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

DEFAULT_SETTINGS = {
    "sla_hours": {"Critical": 4, "High": 12, "Medium": 48, "Low": 96},
    "simulator_on": False,
    "simulator_interval": 25,
    "auto_dispatch_critical": True,
    "review_threshold": 0.55,
    "rain_mm": 45,
    "api_key": "prakash-demo-key",
}

_local = threading.local()


def connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_db():
    """Connection bound to the current request (flask.g) or, outside a request, to the current thread."""
    try:
        from flask import g, has_app_context
        if has_app_context():
            if "db" not in g:
                g.db = connect()
            return g.db
    except ImportError:
        pass
    if not hasattr(_local, "conn"):
        _local.conn = connect()
    return _local.conn


def init_schema(conn):
    conn.executescript(SCHEMA)
    for k, v in DEFAULT_SETTINGS.items():
        conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, json.dumps(v)))
    conn.commit()


def setting(conn, key):
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else DEFAULT_SETTINGS.get(key)


def set_setting(conn, key, value):
    conn.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                 (key, json.dumps(value)))
    conn.commit()


def now():
    return int(time.time() * 1000)  # epoch milliseconds everywhere
