def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok" and r.json()["db"] == "ok"


def test_health_reports_broken_db(client, settings):
    settings.database_path.unlink()
    for suffix in ("-wal", "-shm"):
        p = settings.database_path.with_name(settings.database_path.name + suffix)
        if p.exists():
            p.unlink()
    r = client.get("/health")
    assert r.status_code == 503
    assert r.json() == {"status": "error", "db": "error", "version": r.json()["version"]}


def test_security_headers(client):
    r = client.get("/login", follow_redirects=True)
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "same-origin"
    assert r.headers["x-request-id"]
