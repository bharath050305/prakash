import os
import sys
import tempfile
import warnings

# isolate test data from the real demo database
_tmp = tempfile.mkdtemp(prefix="prakash-test-")
os.environ["PRAKASH_DATA_DIR"] = _tmp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
warnings.filterwarnings("ignore")

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def conn():
    from backend import db, seed
    c = db.connect()
    db.init_schema(c)
    seed.run(c)
    yield c
    c.close()


@pytest.fixture(scope="session")
def client(conn):
    from backend.app import create_app
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()
