"""Diagram storage: model helpers, JSON API and the dashboard/editor pages."""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from . import db
from .deps import get_db, get_settings, require_api_user, require_user
from .web import render

api = APIRouter(prefix="/api")
pages = APIRouter()

MAX_TITLE = 200
MAX_SOURCE = 1_000_000  # 1 MB of Mermaid is far beyond any real diagram
MAX_TAGS = 20
THEMES = (
    "default",
    "base",
    "dark",
    "forest",
    "neutral",
    "neo",
    "neo-dark",
    "redux",
    "redux-dark",
    "redux-color",
    "redux-dark-color",
)
CONFIG_KEYS = {
    "look": {"classic", "handDrawn", "neo"},
    "layout": {"dagre", "elk"},
    "curve": {
        "basis",
        "linear",
        "cardinal",
        "monotoneX",
        "monotoneY",
        "natural",
        "step",
        "stepBefore",
        "stepAfter",
        "bumpX",
        "bumpY",
        "catmullRom",
    },
    "fontFamily": None,  # free text, length-limited
}

# First keyword of a diagram -> short type slug used for filtering and badges.
# Order matters: longer / more specific keywords first.
TYPE_KEYWORDS: list[tuple[str, str]] = [
    ("flowchart-elk", "flowchart"),
    ("flowchart", "flowchart"),
    ("graph", "flowchart"),
    ("sequenceDiagram", "sequence"),
    ("classDiagram", "class"),
    ("stateDiagram", "state"),
    ("erDiagram", "er"),
    ("journey", "journey"),
    ("gantt", "gantt"),
    ("pie", "pie"),
    ("quadrantChart", "quadrant"),
    ("requirementDiagram", "requirement"),
    ("requirement", "requirement"),
    ("gitGraph", "gitgraph"),
    ("C4Context", "c4"),
    ("C4Container", "c4"),
    ("C4Component", "c4"),
    ("C4Dynamic", "c4"),
    ("C4Deployment", "c4"),
    ("mindmap", "mindmap"),
    ("timeline", "timeline"),
    ("sankey", "sankey"),
    ("xychart", "xychart"),
    ("block", "block"),
    ("packet", "packet"),
    ("kanban", "kanban"),
    ("architecture", "architecture"),
    ("radar", "radar"),
    ("treemap", "treemap"),
    ("venn", "venn"),
    ("ishikawa", "ishikawa"),
    ("wardley", "wardley"),
    ("railroad", "railroad"),
    ("treeView", "treeview"),
    ("usecase", "usecase"),
    ("cynefin", "cynefin"),
    ("swimlane", "swimlane"),
    ("eventmodeling", "eventmodeling"),
    ("agentflow", "agentflow"),
    ("info", "info"),
]
TYPE_LABELS = {
    "flowchart": "Flowchart",
    "sequence": "Sequence",
    "class": "Class",
    "state": "State",
    "er": "Entity relationship",
    "journey": "User journey",
    "gantt": "Gantt",
    "pie": "Pie",
    "quadrant": "Quadrant",
    "requirement": "Requirement",
    "gitgraph": "Git graph",
    "c4": "C4",
    "mindmap": "Mindmap",
    "timeline": "Timeline",
    "sankey": "Sankey",
    "xychart": "XY chart",
    "block": "Block",
    "packet": "Packet",
    "kanban": "Kanban",
    "architecture": "Architecture",
    "radar": "Radar",
    "treemap": "Treemap",
    "venn": "Venn",
    "ishikawa": "Ishikawa",
    "wardley": "Wardley map",
    "railroad": "Railroad",
    "treeview": "Tree view",
    "usecase": "Use case",
    "cynefin": "Cynefin",
    "swimlane": "Swimlane",
    "eventmodeling": "Event modeling",
    "agentflow": "Agent flow",
    "info": "Info",
    "unknown": "Unknown",
}
_WORD_RE = re.compile(r"[A-Za-z0-9_-]+")


def detect_diagram_type(source: str) -> str:
    """Detect the diagram type from the first meaningful line of the source.

    Skips YAML front matter, ``%%{init}%%`` directives, ``%%`` comments and
    blank lines, like mermaid.js does.
    """
    lines = source.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and lines[i].strip() == "---":
        i += 1
        while i < len(lines) and lines[i].strip() != "---":
            i += 1
        i += 1
    in_directive = False
    for line in lines[i:]:
        text = line.strip()
        if in_directive:
            if "}%%" in text:
                in_directive = False
            continue
        if not text:
            continue
        if text.startswith("%%{"):
            in_directive = "}%%" not in text
            continue
        if text.startswith("%%"):
            continue
        match = _WORD_RE.match(text)
        word = match.group(0) if match else ""
        for keyword, slug in TYPE_KEYWORDS:
            if word == keyword or (word.startswith(keyword) and word[len(keyword) :][:1] in "-"):
                return slug
        return "unknown"
    return "unknown"


def has_inline_config(source: str) -> bool:
    """True when the source sets its own theme/config (init directive or front matter)."""
    if re.search(r"%%\{\s*init", source):
        return True
    lines = source.replace("\r\n", "\n").lstrip().split("\n")
    if lines and lines[0].strip() == "---":
        for line in lines[1:]:
            if line.strip() == "---":
                break
            if line.strip().startswith("config:"):
                return True
    return False


def normalise_tags(tags: list[str]) -> list[str]:
    seen: dict[str, str] = {}
    for raw in tags:
        tag = " ".join(str(raw).split())[:40]
        if tag and tag.lower() not in seen:
            seen[tag.lower()] = tag
    return list(seen.values())[:MAX_TAGS]


def clean_config(config: dict[str, Any] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, allowed in CONFIG_KEYS.items():
        value = (config or {}).get(key)
        if not isinstance(value, str) or not value:
            continue
        if allowed is None:
            value = value.strip()[:100]
            if value:
                out[key] = value
        elif value in allowed:
            out[key] = value
    return out


# ----------------------------------------------------------------------- schemas


def _clean_title(value: str | None) -> str | None:
    if value is None:
        return None
    return " ".join(value.split()) or "Untitled diagram"


def _check_theme(value: str | None) -> str | None:
    if value is not None and value not in THEMES:
        raise ValueError(f"theme must be one of {', '.join(THEMES)}")
    return value


class DiagramIn(BaseModel):
    title: str = Field(default="Untitled diagram", max_length=MAX_TITLE)
    source: str = Field(default="", max_length=MAX_SOURCE)
    theme: str = "default"
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)

    _title = field_validator("title")(_clean_title)
    _theme = field_validator("theme")(_check_theme)


class DiagramPatch(BaseModel):
    title: str | None = Field(default=None, max_length=MAX_TITLE)
    source: str | None = Field(default=None, max_length=MAX_SOURCE)
    theme: str | None = None
    config: dict[str, Any] | None = None
    tags: list[str] | None = None

    _title = field_validator("title")(_clean_title)
    _theme = field_validator("theme")(_check_theme)


# ----------------------------------------------------------------------- queries


def tags_for(conn: sqlite3.Connection, diagram_ids: list[int]) -> dict[int, list[str]]:
    if not diagram_ids:
        return {}
    marks = ",".join("?" * len(diagram_ids))
    out: dict[int, list[str]] = {i: [] for i in diagram_ids}
    for row in conn.execute(
        f"SELECT diagram_id, tag FROM diagram_tags WHERE diagram_id IN ({marks}) ORDER BY tag",
        diagram_ids,
    ):
        out[row["diagram_id"]].append(row["tag"])
    return out


def set_tags(conn: sqlite3.Connection, diagram_id: int, tags: list[str]) -> None:
    conn.execute("DELETE FROM diagram_tags WHERE diagram_id = ?", (diagram_id,))
    conn.executemany(
        "INSERT INTO diagram_tags (diagram_id, tag) VALUES (?, ?)",
        [(diagram_id, t) for t in normalise_tags(tags)],
    )


def serialise(row: sqlite3.Row, tags: list[str] | None = None, full: bool = True) -> dict:
    data = {
        "id": row["id"],
        "title": row["title"],
        "diagram_type": row["diagram_type"],
        "theme": row["theme"],
        "config": json.loads(row["config"] or "{}"),
        "tags": tags or [],
        "shared": row["share_token"] is not None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if full:
        data["source"] = row["source"]
        data["share_token"] = row["share_token"]
    return data


def get_owned(conn: sqlite3.Connection, user_id: int, diagram_id: int) -> sqlite3.Row:
    """Fetch a diagram owned by the user, or 404 (never 403, to avoid leaking ids)."""
    row = conn.execute(
        "SELECT * FROM diagrams WHERE id = ? AND user_id = ?", (diagram_id, user_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Diagram not found")
    return row


def record_version(conn: sqlite3.Connection, row: sqlite3.Row, max_versions: int) -> None:
    conn.execute(
        "INSERT INTO diagram_versions (diagram_id, title, source, theme, config, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (row["id"], row["title"], row["source"], row["theme"], row["config"], row["updated_at"]),
    )
    conn.execute(
        "DELETE FROM diagram_versions WHERE diagram_id = ? AND id NOT IN ("
        " SELECT id FROM diagram_versions WHERE diagram_id = ? ORDER BY id DESC LIMIT ?)",
        (row["id"], row["id"], max(1, max_versions)),
    )


def insert_diagram(
    conn: sqlite3.Connection,
    user_id: int,
    data: DiagramIn,
    max_versions: int,
    created_at: str | None = None,
    updated_at: str | None = None,
) -> sqlite3.Row:
    now = db.utcnow()
    cur = conn.execute(
        "INSERT INTO diagrams (user_id, title, source, diagram_type, theme, config,"
        " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            user_id,
            data.title,
            data.source,
            detect_diagram_type(data.source),
            data.theme,
            json.dumps(clean_config(data.config)),
            created_at or now,
            updated_at or now,
        ),
    )
    set_tags(conn, cur.lastrowid, data.tags)
    row = conn.execute("SELECT * FROM diagrams WHERE id = ?", (cur.lastrowid,)).fetchone()
    record_version(conn, row, max_versions)
    return row


def update_diagram(
    conn: sqlite3.Connection, row: sqlite3.Row, patch: DiagramPatch, max_versions: int
) -> sqlite3.Row:
    fields: dict[str, Any] = {}
    if patch.title is not None and patch.title != row["title"]:
        fields["title"] = patch.title
    if patch.source is not None and patch.source != row["source"]:
        fields["source"] = patch.source
        fields["diagram_type"] = detect_diagram_type(patch.source)
    if patch.theme is not None and patch.theme != row["theme"]:
        fields["theme"] = patch.theme
    if patch.config is not None:
        config = json.dumps(clean_config(patch.config))
        if config != row["config"]:
            fields["config"] = config
    if patch.tags is not None:
        set_tags(conn, row["id"], patch.tags)
    if not fields and patch.tags is None:
        return row
    fields["updated_at"] = db.utcnow()
    assignments = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE diagrams SET {assignments} WHERE id = ?", [*fields.values(), row["id"]])
    new_row = conn.execute("SELECT * FROM diagrams WHERE id = ?", (row["id"],)).fetchone()
    # Only content changes are worth a history entry; renames and tags are not.
    if fields.keys() & {"source", "theme", "config"}:
        record_version(conn, new_row, max_versions)
    return new_row


def unique_title(conn: sqlite3.Connection, user_id: int, title: str) -> str:
    existing = {
        r[0].lower()
        for r in conn.execute("SELECT title FROM diagrams WHERE user_id = ?", (user_id,))
    }
    if title.lower() not in existing:
        return title
    n = 2
    while f"{title} ({n})".lower() in existing:
        n += 1
    return f"{title} ({n})"[:MAX_TITLE]


# --------------------------------------------------------------------------- API


@api.get("/diagrams")
def list_diagrams(
    q: str = "",
    type: str = "",
    tag: str = "",
    page: int = 1,
    per_page: int = 50,
    user=Depends(require_api_user),
    conn=Depends(get_db),
):
    page = max(1, page)
    per_page = min(max(1, per_page), 200)
    where = ["d.user_id = ?"]
    params: list[Any] = [user["id"]]
    if q.strip():
        like = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append("(d.title LIKE ? ESCAPE '\\' OR d.source LIKE ? ESCAPE '\\')")
        params += [like, like]
    if type:
        where.append("d.diagram_type = ?")
        params.append(type)
    if tag:
        where.append(
            "EXISTS (SELECT 1 FROM diagram_tags t WHERE t.diagram_id = d.id AND t.tag = ?)"
        )
        params.append(tag)
    clause = " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM diagrams d WHERE {clause}", params).fetchone()[0]
    rows = conn.execute(
        f"SELECT d.* FROM diagrams d WHERE {clause}"
        " ORDER BY d.updated_at DESC, d.id DESC LIMIT ? OFFSET ?",
        [*params, per_page, (page - 1) * per_page],
    ).fetchall()
    tag_map = tags_for(conn, [r["id"] for r in rows])
    types = [
        {"type": r[0], "label": TYPE_LABELS.get(r[0], r[0]), "count": r[1]}
        for r in conn.execute(
            "SELECT diagram_type, COUNT(*) FROM diagrams WHERE user_id = ?"
            " GROUP BY diagram_type ORDER BY diagram_type",
            (user["id"],),
        )
    ]
    all_tags = [
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT t.tag FROM diagram_tags t JOIN diagrams d ON d.id = t.diagram_id"
            " WHERE d.user_id = ? ORDER BY t.tag COLLATE NOCASE",
            (user["id"],),
        )
    ]
    return {
        "items": [
            {**serialise(r, tag_map.get(r["id"]), full=False), "source": r["source"]} for r in rows
        ],
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": max(1, -(-total // per_page)),
        "types": types,
        "tags": all_tags,
    }


@api.post("/diagrams", status_code=201)
def create_diagram(
    data: DiagramIn,
    user=Depends(require_api_user),
    conn=Depends(get_db),
    settings=Depends(get_settings),
):
    with db.transaction(conn):
        row = insert_diagram(conn, user["id"], data, settings.max_versions)
    return serialise(row, tags_for(conn, [row["id"]])[row["id"]])


@api.get("/diagrams/{diagram_id}")
def read_diagram(diagram_id: int, user=Depends(require_api_user), conn=Depends(get_db)):
    row = get_owned(conn, user["id"], diagram_id)
    return serialise(row, tags_for(conn, [row["id"]])[row["id"]])


@api.put("/diagrams/{diagram_id}")
def put_diagram(
    diagram_id: int,
    patch: DiagramPatch,
    user=Depends(require_api_user),
    conn=Depends(get_db),
    settings=Depends(get_settings),
):
    with db.transaction(conn):
        row = get_owned(conn, user["id"], diagram_id)
        row = update_diagram(conn, row, patch, settings.max_versions)
    return serialise(row, tags_for(conn, [row["id"]])[row["id"]])


@api.delete("/diagrams/{diagram_id}", status_code=204)
def delete_diagram(diagram_id: int, user=Depends(require_api_user), conn=Depends(get_db)):
    with db.transaction(conn):
        get_owned(conn, user["id"], diagram_id)
        conn.execute("DELETE FROM diagrams WHERE id = ? AND user_id = ?", (diagram_id, user["id"]))
    return Response(status_code=204)


@api.post("/diagrams/{diagram_id}/duplicate", status_code=201)
def duplicate_diagram(
    diagram_id: int,
    user=Depends(require_api_user),
    conn=Depends(get_db),
    settings=Depends(get_settings),
):
    with db.transaction(conn):
        row = get_owned(conn, user["id"], diagram_id)
        tags = tags_for(conn, [row["id"]])[row["id"]]
        copy = DiagramIn(
            title=unique_title(conn, user["id"], f"Copy of {row['title']}"[:MAX_TITLE]),
            source=row["source"],
            theme=row["theme"],
            config=json.loads(row["config"] or "{}"),
            tags=tags,
        )
        new_row = insert_diagram(conn, user["id"], copy, settings.max_versions)
    return serialise(new_row, tags)


@api.get("/diagrams/{diagram_id}/versions")
def list_versions(diagram_id: int, user=Depends(require_api_user), conn=Depends(get_db)):
    get_owned(conn, user["id"], diagram_id)
    rows = conn.execute(
        "SELECT id, title, source, theme, config, created_at FROM diagram_versions"
        " WHERE diagram_id = ? ORDER BY id DESC",
        (diagram_id,),
    ).fetchall()
    total = len(rows)
    return {
        "items": [
            {
                "id": r["id"],
                "number": total - i,
                "title": r["title"],
                "source": r["source"],
                "theme": r["theme"],
                "config": json.loads(r["config"] or "{}"),
                "created_at": r["created_at"],
            }
            for i, r in enumerate(rows)
        ]
    }


@api.post("/diagrams/{diagram_id}/versions/{version_id}/restore")
def restore_version(
    diagram_id: int,
    version_id: int,
    user=Depends(require_api_user),
    conn=Depends(get_db),
    settings=Depends(get_settings),
):
    with db.transaction(conn):
        row = get_owned(conn, user["id"], diagram_id)
        version = conn.execute(
            "SELECT * FROM diagram_versions WHERE id = ? AND diagram_id = ?",
            (version_id, diagram_id),
        ).fetchone()
        if version is None:
            raise HTTPException(status_code=404, detail="Version not found")
        now = db.utcnow()
        conn.execute(
            "UPDATE diagrams SET source = ?, diagram_type = ?, theme = ?, config = ?,"
            " updated_at = ? WHERE id = ?",
            (
                version["source"],
                detect_diagram_type(version["source"]),
                version["theme"],
                version["config"],
                now,
                row["id"],
            ),
        )
        new_row = conn.execute("SELECT * FROM diagrams WHERE id = ?", (row["id"],)).fetchone()
        # Restoring is itself a save, so history is never rewritten.
        record_version(conn, new_row, settings.max_versions)
    return serialise(new_row, tags_for(conn, [row["id"]])[row["id"]])


@api.post("/diagrams/{diagram_id}/share")
def share_diagram(diagram_id: int, user=Depends(require_api_user), conn=Depends(get_db)):
    with db.transaction(conn):
        row = get_owned(conn, user["id"], diagram_id)
        token = row["share_token"]
        if token is None:
            token = secrets.token_urlsafe(32)
            conn.execute("UPDATE diagrams SET share_token = ? WHERE id = ?", (token, row["id"]))
    return {"share_token": token, "url": f"/share/{token}"}


@api.delete("/diagrams/{diagram_id}/share", status_code=204)
def unshare_diagram(diagram_id: int, user=Depends(require_api_user), conn=Depends(get_db)):
    with db.transaction(conn):
        row = get_owned(conn, user["id"], diagram_id)
        conn.execute("UPDATE diagrams SET share_token = NULL WHERE id = ?", (row["id"],))
    return Response(status_code=204)


# ------------------------------------------------------------------------- pages


@pages.get("/diagrams")
def dashboard(request: Request, user=Depends(require_user)):
    return render(request, "dashboard.html", {"type_labels": TYPE_LABELS})


def _editor(request: Request, diagram: dict, is_new: bool):
    return render(
        request,
        "editor.html",
        {
            "diagram": diagram,
            "is_new": is_new,
            "themes": THEMES,
            "type_labels": TYPE_LABELS,
        },
    )


@pages.get("/diagrams/new/edit")
def new_diagram_editor(request: Request, template: str = "", user=Depends(require_user)):
    from .gallery import get_template

    tpl = get_template(template) if template else None
    diagram = {
        "id": None,
        "title": tpl["name"] if tpl else "Untitled diagram",
        "source": tpl["source"] if tpl else "",
        "theme": "default",
        "config": {},
        "tags": [],
        "share_token": None,
        "diagram_type": detect_diagram_type(tpl["source"]) if tpl else "unknown",
    }
    return _editor(request, diagram, is_new=True)


@pages.get("/diagrams/{diagram_id}/edit")
def edit_diagram(
    request: Request, diagram_id: int, user=Depends(require_user), conn=Depends(get_db)
):
    row = get_owned(conn, user["id"], diagram_id)
    return _editor(request, serialise(row, tags_for(conn, [row["id"]])[row["id"]]), is_new=False)


@pages.get("/share/{token}")
def shared_view(request: Request, token: str, conn=Depends(get_db)):
    if len(token) < 32:
        raise HTTPException(status_code=404, detail="Not found")
    row = conn.execute(
        "SELECT d.*, u.username FROM diagrams d JOIN users u ON u.id = d.user_id"
        " WHERE d.share_token = ?",
        (token,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    response = render(
        request,
        "share.html",
        {
            "diagram": serialise(row, full=True) | {"share_token": None},
            "owner": row["username"],
            "type_labels": TYPE_LABELS,
        },
    )
    response.headers["X-Robots-Tag"] = "noindex"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
