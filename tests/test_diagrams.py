import sqlite3

import pytest

from app.diagrams import detect_diagram_type, has_inline_config

FLOW = "flowchart TD\n    A --> B\n"


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("flowchart LR\n a-->b", "flowchart"),
        ("graph TD\n a-->b", "flowchart"),
        ("  \n%% comment\nsequenceDiagram\n A->>B: hi", "sequence"),
        ("%%{init: {'theme': 'dark'}}%%\nclassDiagram\n A <|-- B", "class"),
        ("%%{\n  init: {}\n}%%\nerDiagram\n", "er"),
        ("---\ntitle: Hello\nconfig:\n  theme: dark\n---\nstateDiagram-v2\n[*] --> A", "state"),
        ("xychart-beta\n", "xychart"),
        ("architecture-beta\n", "architecture"),
        ("C4Container\n", "c4"),
        ("requirementDiagram\n", "requirement"),
        ("gitGraph\n commit", "gitgraph"),
        ("venn-beta\n", "venn"),
        ("not a diagram", "unknown"),
        ("", "unknown"),
    ],
)
def test_detect_type(source, expected):
    assert detect_diagram_type(source) == expected


def test_inline_config_detection():
    assert has_inline_config("%%{init: {'theme':'dark'}}%%\ngraph TD")
    assert has_inline_config("---\nconfig:\n  look: handDrawn\n---\ngraph TD")
    assert not has_inline_config("---\ntitle: x\n---\ngraph TD")
    assert not has_inline_config("graph TD\n a-->b")


def create(c, **body):
    body.setdefault("title", "Test")
    body.setdefault("source", FLOW)
    r = c.api("POST", "/api/diagrams", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_crud(alice):
    d = create(alice, title="  My   flow ", tags=["Work", "work", " robots "])
    assert d["title"] == "My flow"
    assert d["diagram_type"] == "flowchart"
    assert d["tags"] == ["robots", "Work"] or sorted(d["tags"]) == ["Work", "robots"]

    r = alice.get(f"/api/diagrams/{d['id']}")
    assert r.json()["source"] == FLOW

    r = alice.api("PUT", f"/api/diagrams/{d['id']}", json={"source": "sequenceDiagram\nA->>B: hi"})
    assert r.json()["diagram_type"] == "sequence"
    assert r.json()["title"] == "My flow"

    r = alice.api("DELETE", f"/api/diagrams/{d['id']}")
    assert r.status_code == 204
    assert alice.get(f"/api/diagrams/{d['id']}").status_code == 404


def test_source_round_trip_is_byte_exact(alice):
    source = 'flowchart LR\r\n    a["Ünïcödé ✓ 🚀"] --> b\r\n\t%% tab\r\n\r\n   trailing   \r\n'
    d = create(alice, source=source)
    assert alice.get(f"/api/diagrams/{d['id']}").json()["source"] == source
    page = alice.get(f"/diagrams/{d['id']}/edit").text
    assert "\\u00dcn\\u00efc\\u00f6d\\u00e9" in page or "Ünïcödé" in page


def test_validation(alice):
    r = alice.api("POST", "/api/diagrams", json={"title": "x", "theme": "purple"})
    assert r.status_code == 422 and "theme" in r.json()["detail"]
    r = alice.api("POST", "/api/diagrams", json={"title": "x" * 201})
    assert r.status_code == 422


def test_config_is_whitelisted(alice):
    d = create(alice, config={"look": "handDrawn", "layout": "elk", "evil": "x", "curve": "nope"})
    assert d["config"] == {"look": "handDrawn", "layout": "elk"}


def test_cross_user_access_is_404(alice, bob):
    d = create(alice)
    assert bob.get(f"/api/diagrams/{d['id']}").status_code == 404
    assert bob.api("PUT", f"/api/diagrams/{d['id']}", json={"title": "pwned"}).status_code == 404
    assert bob.api("DELETE", f"/api/diagrams/{d['id']}").status_code == 404
    assert bob.api("POST", f"/api/diagrams/{d['id']}/duplicate").status_code == 404
    assert bob.api("POST", f"/api/diagrams/{d['id']}/share").status_code == 404
    assert bob.get(f"/api/diagrams/{d['id']}/versions").status_code == 404
    assert bob.get(f"/diagrams/{d['id']}/edit").status_code == 404
    assert bob.get("/api/diagrams").json()["total"] == 0
    assert alice.get(f"/api/diagrams/{d['id']}").json()["title"] == "Test"


def test_list_pagination_and_many_diagrams(alice, settings):
    # Insert 1000 diagrams directly for speed, then exercise the API.
    user_id = sqlite3.connect(settings.database_path).execute("SELECT id FROM users").fetchone()[0]
    conn = sqlite3.connect(settings.database_path)
    conn.executemany(
        "INSERT INTO diagrams (user_id, title, source, diagram_type, theme, created_at, updated_at)"
        " VALUES (?, ?, ?, 'flowchart', 'default', ?, ?)",
        [
            (
                user_id,
                f"D{i:04}",
                FLOW,
                f"2026-01-01T00:00:{i % 60:02}.{i:03}Z",
                f"2026-01-01T{i // 60 % 24:02}:{i % 60:02}:00.000Z",
            )
            for i in range(1000)
        ],
    )
    conn.commit()
    r = alice.get("/api/diagrams?per_page=50&page=1").json()
    assert r["total"] == 1000 and r["pages"] == 20 and len(r["items"]) == 50
    last = alice.get("/api/diagrams?per_page=50&page=20").json()
    assert len(last["items"]) == 50
    ids = {i["id"] for i in r["items"]} & {i["id"] for i in last["items"]}
    assert not ids
    create(alice, title="Newest")
    assert alice.get("/api/diagrams").json()["items"][0]["title"] == "Newest"


def test_search_and_filters(alice):
    create(alice, title="Robot wiring", source=FLOW, tags=["robots"])
    create(alice, title="Login flow", source="sequenceDiagram\nA->>B: login")
    create(alice, title="100% done_ish", source='pie\n"a": 1')
    titles = lambda q: sorted(i["title"] for i in alice.get(f"/api/diagrams?{q}").json()["items"])  # noqa: E731
    assert titles("q=robot") == ["Robot wiring"]
    assert titles("q=LOGIN") == ["Login flow"]  # case-insensitive, matches source too
    assert titles("type=sequence") == ["Login flow"]
    assert titles("tag=robots") == ["Robot wiring"]
    assert titles("q=100%25") == ["100% done_ish"]  # LIKE wildcards are escaped
    assert titles("q=_") == ["100% done_ish"]
    data = alice.get("/api/diagrams").json()
    assert {t["type"] for t in data["types"]} == {"flowchart", "sequence", "pie"}
    assert data["tags"] == ["robots"]


def test_duplicate_is_independent(alice):
    d = create(alice, title="Original", theme="forest", tags=["a"])
    copy = alice.api("POST", f"/api/diagrams/{d['id']}/duplicate").json()
    assert (
        copy["title"] == "Copy of Original" and copy["theme"] == "forest" and copy["tags"] == ["a"]
    )
    alice.api("PUT", f"/api/diagrams/{copy['id']}", json={"source": 'pie\n"x": 1'})
    assert alice.get(f"/api/diagrams/{d['id']}").json()["source"] == FLOW
    second = alice.api("POST", f"/api/diagrams/{d['id']}/duplicate").json()
    assert second["title"] == "Copy of Original (2)"


def test_rename_persists(alice):
    d = create(alice)
    alice.api("PUT", f"/api/diagrams/{d['id']}", json={"title": "Renamed"})
    assert alice.get(f"/api/diagrams/{d['id']}").json()["title"] == "Renamed"


def test_theme_saved(alice):
    d = create(alice)
    alice.api("PUT", f"/api/diagrams/{d['id']}", json={"theme": "dark"})
    assert alice.get(f"/api/diagrams/{d['id']}").json()["theme"] == "dark"


def test_user_delete_cascades(alice, settings):
    create(alice)
    conn = sqlite3.connect(settings.database_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("DELETE FROM users")
    conn.commit()
    assert conn.execute("SELECT COUNT(*) FROM diagrams").fetchone()[0] == 0


# ---------------------------------------------------------------- history


def test_version_history_and_restore(alice):
    d = create(alice, source="graph TD\n v1")
    alice.api("PUT", f"/api/diagrams/{d['id']}", json={"source": "graph TD\n v2"})
    alice.api("PUT", f"/api/diagrams/{d['id']}", json={"source": "graph TD\n v3"})
    alice.api("PUT", f"/api/diagrams/{d['id']}", json={"title": "rename only"})  # no new version
    versions = alice.get(f"/api/diagrams/{d['id']}/versions").json()["items"]
    assert [v["number"] for v in versions] == [3, 2, 1]
    assert versions[-1]["source"] == "graph TD\n v1"

    restored = alice.api(
        "POST", f"/api/diagrams/{d['id']}/versions/{versions[-1]['id']}/restore"
    ).json()
    assert restored["source"] == "graph TD\n v1"
    versions = alice.get(f"/api/diagrams/{d['id']}/versions").json()["items"]
    assert len(versions) == 4 and versions[0]["number"] == 4
    assert versions[0]["source"] == "graph TD\n v1"


def test_history_is_capped(tmp_path):
    from conftest import Client, make_settings

    from app.main import create_app

    app = create_app(make_settings(tmp_path, MAX_VERSIONS="3"))
    with Client(app, base_url="http://testserver") as c:
        c.register("owner")
        d = create(c, source="graph TD\n 0")
        for i in range(1, 6):
            c.api("PUT", f"/api/diagrams/{d['id']}", json={"source": f"graph TD\n {i}"})
        items = c.get(f"/api/diagrams/{d['id']}/versions").json()["items"]
        assert [v["source"][-1] for v in items] == ["5", "4", "3"]


def test_restore_other_diagrams_version_is_404(alice):
    a = create(alice)
    b = create(alice)
    va = alice.get(f"/api/diagrams/{a['id']}/versions").json()["items"][0]["id"]
    r = alice.api("POST", f"/api/diagrams/{b['id']}/versions/{va}/restore")
    assert r.status_code == 404


# ------------------------------------------------------------------- pages


def test_dashboard_and_editor_pages(alice):
    assert alice.get("/diagrams").status_code == 200
    d = create(alice, title="Page test")
    page = alice.get(f"/diagrams/{d['id']}/edit")
    assert page.status_code == 200 and "Page test" in page.text
    assert alice.get("/diagrams/999999/edit").status_code == 404


def test_new_from_template(alice):
    page = alice.get("/diagrams/new/edit?template=sequence")
    assert page.status_code == 200 and "sequenceDiagram" in page.text
    assert alice.get("/diagrams/new/edit?template=nope").status_code == 200
