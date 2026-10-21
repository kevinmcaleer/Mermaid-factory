import json

from test_diagrams import FLOW, create


def test_share_link_lifecycle(alice, new_client):
    d = create(alice, title="Shared one", theme="forest")
    r = alice.api("POST", f"/api/diagrams/{d['id']}/share").json()
    assert len(r["share_token"]) >= 32
    again = alice.api("POST", f"/api/diagrams/{d['id']}/share").json()
    assert again["share_token"] == r["share_token"]

    visitor = new_client()
    page = visitor.get(r["url"])
    assert page.status_code == 200
    assert "Shared one" in page.text and "read-only" in page.text
    assert "/edit" not in page.text and 'id="save-btn"' not in page.text
    assert page.headers["x-robots-tag"] == "noindex"
    # A visitor can't write through the API.
    assert visitor.api("PUT", f"/api/diagrams/{d['id']}", json={"title": "x"}).status_code == 401
    assert visitor.get(f"/api/diagrams/{d['id']}").status_code == 401

    assert alice.api("DELETE", f"/api/diagrams/{d['id']}/share").status_code == 204
    assert visitor.get(r["url"]).status_code == 404
    assert alice.get(f"/api/diagrams/{d['id']}").json()["share_token"] is None


def test_unknown_share_token_404(client):
    assert client.get("/share/" + "x" * 43).status_code == 404
    assert client.get("/share/short").status_code == 404


def test_export_import_round_trip(alice, bob):
    sources = [FLOW, "sequenceDiagram\r\nA->>B: ü\r\n", 'pie\n"a": 1\n']
    for i, s in enumerate(sources):
        create(
            alice, title=f"D{i}", source=s, theme="dark", tags=["t"], config={"look": "handDrawn"}
        )
    r = alice.get("/api/export")
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    bundle = r.json()
    assert bundle["format"] == "mermaid-factory" and len(bundle["diagrams"]) == 3

    imported = bob.api(
        "POST",
        "/api/import",
        content=r.content,
        headers={"Content-Type": "application/json", "X-CSRF-Token": bob.csrf("/settings")},
    )
    assert imported.json() == {"imported": 3}
    items = bob.get("/api/diagrams").json()["items"]
    by_title = {i["title"]: i for i in items}
    for i, s in enumerate(sources):
        full = bob.get(f"/api/diagrams/{by_title[f'D{i}']['id']}").json()
        assert full["source"] == s
        assert (
            full["theme"] == "dark"
            and full["tags"] == ["t"]
            and full["config"] == {"look": "handDrawn"}
        )

    # Importing again into the same account suffixes duplicate titles.
    bob.api(
        "POST",
        "/api/import",
        content=r.content,
        headers={"Content-Type": "application/json", "X-CSRF-Token": bob.csrf("/settings")},
    )
    titles = {i["title"] for i in bob.get("/api/diagrams").json()["items"]}
    assert {"D0", "D0 (2)"} <= titles


def test_malformed_import_rejected_without_partial_write(alice):
    def post(payload):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        return alice.api(
            "POST",
            "/api/import",
            content=body,
            headers={"Content-Type": "application/json", "X-CSRF-Token": alice.csrf("/settings")},
        )

    assert post(b"not json").status_code == 400
    assert post({"hello": "world"}).status_code == 400
    assert post({"format": "other", "version": 1, "diagrams": []}).status_code == 400
    bad = {
        "format": "mermaid-factory",
        "version": 1,
        "diagrams": [
            {"title": "ok", "source": FLOW},
            {"title": "bad", "source": FLOW, "theme": "nope"},
        ],
    }
    r = post(bad)
    assert r.status_code == 400 and "theme" in r.json()["detail"]
    assert alice.get("/api/diagrams").json()["total"] == 0
