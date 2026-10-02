"""Paths. Set PRAKASH_DATA_DIR to keep the database and trained models somewhere else (the tests do)."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("PRAKASH_DATA_DIR") or os.path.join(ROOT, "data")
