from app.security import RateLimiter


def test_form_post_without_csrf_is_rejected(alice):
    r = alice.post("/logout", data={}, follow_redirects=False)
    assert r.status_code == 403


def test_api_write_without_csrf_is_rejected(alice):
    r = alice.post("/api/diagrams", json={"title": "x"})
    assert r.status_code == 403
    r = alice.post("/api/diagrams", json={"title": "x"}, headers={"X-CSRF-Token": "nope"})
    assert r.status_code == 403


def test_csrf_token_is_bound_to_session(alice, bob):
    token = bob.csrf("/settings")
    r = alice.post("/api/diagrams", json={"title": "x"}, headers={"X-CSRF-Token": token})
    assert r.status_code == 403


def test_login_rate_limited(tmp_path):
    from conftest import Client, make_settings

    from app.main import create_app

    app = create_app(make_settings(tmp_path, LOGIN_RATE_LIMIT="5", LOGIN_RATE_WINDOW="60"))
    with Client(app, base_url="http://testserver") as c:
        c.register("owner")
    with Client(app, base_url="http://testserver") as c:
        codes = [c.login("owner", "wrong password!!").status_code for _ in range(6)]
        assert codes == [401] * 5 + [429]
        assert c.login("owner").status_code == 429  # even the right password


def test_rate_limiter_window():
    now = [0.0]
    limiter = RateLimiter(2, 60, clock=lambda: now[0])
    assert limiter.hit("ip")[0] and limiter.hit("ip")[0]
    allowed, retry = limiter.hit("ip")
    assert not allowed and retry > 0
    assert limiter.hit("other")[0]
    now[0] = 61
    assert limiter.hit("ip")[0]


def test_script_title_is_escaped(alice):
    evil = "<script>alert(1)</script>"
    d = alice.api("POST", "/api/diagrams", json={"title": evil, "source": "graph TD; a-->b"}).json()
    page = alice.get(f"/diagrams/{d['id']}/edit").text
    assert evil not in page
    assert "&lt;script&gt;" in page or "\\u003cscript\\u003e" in page
    share = alice.api("POST", f"/api/diagrams/{d['id']}/share").json()
    public = alice.get(share["url"]).text
    assert evil not in public


def test_opener_kept_only_on_the_handoff_pages(alice, new_client):
    # "Open in Mermaid Factory" sends a diagram back through window.opener,
    # which Cross-Origin-Opener-Policy: same-origin would cut.
    assert alice.get("/diagrams/new/edit").headers["cross-origin-opener-policy"] == "unsafe-none"
    assert new_client().get("/login").headers["cross-origin-opener-policy"] == "unsafe-none"
    assert alice.get("/diagrams").headers["cross-origin-opener-policy"] == "same-origin"
