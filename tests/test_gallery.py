import json

from app.gallery import CHEATSHEET_DIR, GALLERY_DIR, load_gallery


def test_index_entries_have_files():
    entries = json.loads((GALLERY_DIR / "index.json").read_text())
    slugs = [e["slug"] for e in entries]
    assert len(slugs) == len(set(slugs))
    for e in entries:
        assert (GALLERY_DIR / e["file"]).is_file(), e["file"]
        assert e["name"] and e["description"]
    # Every .mmd file is listed (nothing orphaned).
    assert {p.name for p in GALLERY_DIR.glob("*.mmd")} == {e["file"] for e in entries}


def test_gallery_covers_core_types():
    from app.diagrams import detect_diagram_type

    types = {detect_diagram_type(t["source"]) for t in load_gallery()}
    required = {
        "flowchart",
        "sequence",
        "class",
        "state",
        "er",
        "journey",
        "gantt",
        "pie",
        "quadrant",
        "requirement",
        "gitgraph",
        "c4",
        "mindmap",
        "timeline",
        "sankey",
        "xychart",
        "block",
        "packet",
        "kanban",
        "architecture",
    }
    assert required <= types
    for t in load_gallery():
        assert detect_diagram_type(t["source"]) == t["slug"], t["slug"]


def test_every_template_type_has_a_cheatsheet():
    sheets = {p.stem for p in CHEATSHEET_DIR.glob("*.md")}
    assert {t["slug"] for t in load_gallery()} <= sheets


def test_gallery_page_and_api(alice):
    page = alice.get("/diagrams/new")
    assert page.status_code == 200 and "Sequence diagram" in page.text
    items = alice.get("/api/templates").json()["items"]
    assert any(i["slug"] == "flowchart" for i in items)


def test_cheatsheet_api(alice):
    r = alice.get("/api/cheatsheets/sequence")
    assert r.status_code == 200 and "<table>" in r.json()["html"]
    assert "sequence" in alice.get("/api/cheatsheets").json()["types"]
    assert alice.get("/api/cheatsheets/nope").status_code == 404
    assert alice.get("/api/cheatsheets/..%2Fsecret").status_code == 404
