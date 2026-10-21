import sqlite3

import pytest
from conftest import PASSWORD, make_settings

from app import db
from app.auth import UserError, authenticate, create_user
from app.security import hash_password, verify_password

# --------------------------------------------------------------- user model


def test_hash_round_trip():
    h = hash_password("a long enough password")
    assert h.startswith("$argon2id$")
    assert verify_password(h, "a long enough password")
    assert not verify_password(h, "wrong password!!")
    assert not verify_password(None, "anything at all")
    assert not verify_password("not-a-hash", "anything at all")


def test_create_user_rules(tmp_path):
    conn = db.connect(tmp_path / "m.db")
    db.migrate(conn)
    uid = create_user(conn, "Kev", PASSWORD)
    assert uid
    stored = conn.execute("SELECT password_hash FROM users").fetchone()[0]
    assert PASSWORD not in stored
    with pytest.raises(UserError, match="taken"):
        create_user(conn, "kev", PASSWORD)  # case-insensitive
    with pytest.raises(UserError, match="at least 12"):
        create_user(conn, "short", "tiny")
    with pytest.raises(UserError, match="Username"):
        create_user(conn, "no spaces allowed", PASSWORD)
    assert authenticate(conn, "KEV", PASSWORD)["id"] == uid
    assert authenticate(conn, "kev", "wrong password!") is None
    assert authenticate(conn, "nobody", PASSWORD) is None


# ------------------------------------------------------------ registration


def test_fresh_install_redirects_login_to_register(client):
    r = client.get("/login", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/register"


def test_register_logs_in(client):
    r = client.register("alice")
    assert r.status_code == 303 and r.headers["location"] == "/diagrams"
    assert "mf_session" in r.cookies
    page = client.get("/diagrams")
    assert page.status_code == 200 and "alice" in page.text


def test_register_errors_inline(alice, new_client):
    c = new_client()
    r = c.register("alice")
    assert r.status_code == 400 and "already taken" in r.text
    r = c.register("carol", confirm_password="something else entirely")
    assert r.status_code == 400 and "do not match" in r.text


def test_first_user_allowed_when_registration_disabled(tmp_path):
    from conftest import Client

    from app.main import create_app

    app = create_app(make_settings(tmp_path, ALLOW_REGISTRATION="false"))
    with Client(app, base_url="http://testserver") as c:
        assert c.get("/register").status_code == 200
        assert c.register("owner").status_code == 303
    with Client(app, base_url="http://testserver") as c2:
        r = c2.get("/register")
        assert r.status_code == 403 and "Registration disabled" in r.text
        assert c2.register("intruder").status_code == 403


# ---------------------------------------------------------------- sessions


def test_login_logout(alice, new_client):
    c = new_client()
    r = c.login("alice")
    assert r.status_code == 303 and r.headers["location"] == "/diagrams"
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie.replace("Lax", "lax")
    assert "Max-Age" not in cookie  # session cookie unless "remember me"
    assert c.get("/diagrams", follow_redirects=False).status_code == 200

    token = c.csrf("/diagrams")
    r = c.post("/logout", data={"csrf_token": token}, follow_redirects=False)
    assert r.status_code == 303
    r = c.get("/diagrams", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/login")


def test_logged_out_session_token_is_dead(alice, new_client):
    c = new_client()
    c.login("alice")
    stolen = c.cookies.get("mf_session")
    c.post("/logout", data={"csrf_token": c.csrf("/diagrams")})
    attacker = new_client()
    attacker.cookies.set("mf_session", stolen)
    assert attacker.get("/diagrams", follow_redirects=False).status_code == 303


def test_remember_me_sets_max_age(alice, new_client):
    r = new_client().login("alice", remember="1")
    assert "Max-Age=2592000" in r.headers["set-cookie"]


def test_generic_login_error(alice, new_client):
    c = new_client()
    r1 = c.login("alice", "wrong password!!")
    r2 = c.login("nobody", "wrong password!!")
    assert r1.status_code == r2.status_code == 401
    assert "Invalid username or password" in r1.text and "Invalid username or password" in r2.text


def test_login_next_param_is_local_only(alice, new_client):
    c = new_client()
    assert c.login("alice", next="/diagrams/new").headers["location"] == "/diagrams/new"
    c = new_client()
    assert c.login("alice", next="https://evil.example/").headers["location"] == "/diagrams"
    c = new_client()
    assert c.login("alice", next="//evil.example/").headers["location"] == "/diagrams"


def test_secure_cookie_when_https(tmp_path):
    from conftest import Client

    from app.main import create_app

    app = create_app(make_settings(tmp_path, HTTPS="true"))
    with Client(app, base_url="http://testserver") as c:
        r = c.register("owner")
        assert "Secure" in r.headers["set-cookie"]


# ------------------------------------------------------------- protection


def test_protected_pages_redirect(client):
    for path in ("/diagrams", "/diagrams/new", "/diagrams/1/edit", "/settings"):
        r = client.get(path, follow_redirects=False)
        assert r.status_code == 303, path
        assert r.headers["location"].startswith("/login?next=")


def test_api_returns_401_json(client):
    r = client.get("/api/diagrams")
    assert r.status_code == 401 and r.json() == {"detail": "Authentication required"}


# --------------------------------------------------------------- settings


def test_change_password_invalidates_other_sessions(alice, new_client):
    other = new_client()
    other.login("alice")
    assert other.get("/diagrams", follow_redirects=False).status_code == 200

    token = alice.csrf("/settings")
    r = alice.post(
        "/settings/password",
        data={
            "csrf_token": token,
            "current_password": PASSWORD,
            "new_password": "a brand new password",
            "confirm_password": "a brand new password",
        },
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert alice.get("/diagrams", follow_redirects=False).status_code == 200  # still in
    assert other.get("/diagrams", follow_redirects=False).status_code == 303  # signed out
    assert new_client().login("alice", "a brand new password").status_code == 303


def test_change_password_requires_current(alice):
    r = alice.post(
        "/settings/password",
        data={
            "csrf_token": alice.csrf("/settings"),
            "current_password": "not my password",
            "new_password": "a brand new password",
            "confirm_password": "a brand new password",
        },
    )
    assert r.status_code == 400 and "incorrect" in r.text


def test_delete_account_cascades(alice, settings):
    alice.api("POST", "/api/diagrams", json={"title": "x", "source": "graph TD; a-->b"})
    r = alice.post(
        "/settings/delete",
        data={"csrf_token": alice.csrf("/settings"), "confirm_username": "wrong"},
    )
    assert r.status_code == 400
    r = alice.post(
        "/settings/delete",
        data={"csrf_token": alice.csrf("/settings"), "confirm_username": "alice"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    conn = sqlite3.connect(settings.database_path)
    for table in ("users", "diagrams", "diagram_versions", "sessions"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0, table
