def login(client, email, pw):
    r = client.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.get_json()


def test_role_isolation(client):
    assert client.get("/api/admin/overview").status_code == 401
    login(client, "citizen@prakash.demo", "Citizen@123")
    assert client.get("/api/admin/overview").status_code == 403
    assert client.get("/api/tech/jobs").status_code == 403
    assert client.get("/api/my/tickets").status_code == 200
    client.post("/api/auth/logout")
    login(client, "admin@prakash.demo", "Admin@123")
    assert client.get("/api/admin/overview").status_code == 200
    assert client.get("/api/tech/jobs").status_code == 403
    client.post("/api/auth/logout")


def test_registration_creates_citizen_only(client):
    r = client.post("/api/auth/register", json={"name": "Test User", "email": "t@example.com", "password": "secret1", "role": "admin"})
    assert r.status_code == 201 and r.get_json()["user"]["role"] == "citizen"
    assert client.post("/api/auth/register", json={"name": "Dup", "email": "t@example.com", "password": "secret1"}).status_code == 409
    assert client.get("/api/admin/overview").status_code == 403
    client.post("/api/auth/logout")


def test_citizen_cannot_read_other_tickets_in_full(client, conn):
    login(client, "citizen@prakash.demo", "Citizen@123")
    other = conn.execute("SELECT id FROM tickets WHERE reporter_id IS NULL AND status='open' LIMIT 1").fetchone()["id"]
    t = client.get(f"/api/tickets/{other}").get_json()["ticket"]
    assert t["text"] is None
    client.post("/api/auth/logout")


def test_webhook_needs_key(client):
    assert client.post("/api/intake/sms", json={"body": "lamp dead near Belapur Station"}).status_code == 401
    r = client.post("/api/intake/sms", json={"body": "lamp dead near Belapur Station"}, headers={"X-API-Key": "prakash-demo-key"})
    assert r.status_code == 201
