"""Export all of a user's diagrams as one JSON file, and import it back."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError

from . import __version__, db
from .deps import get_db, get_settings, require_api_user
from .diagrams import MAX_SOURCE, MAX_TITLE, DiagramIn, insert_diagram, tags_for, unique_title

router = APIRouter(prefix="/api")

FORMAT = "mermaid-factory"
FORMAT_VERSION = 1
MAX_IMPORT_BYTES = 50 * 1024 * 1024


class BundleDiagram(BaseModel):
    title: str = Field(max_length=MAX_TITLE)
    source: str = Field(max_length=MAX_SOURCE)
    theme: str = "default"
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    diagram_type: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class Bundle(BaseModel):
    format: str
    version: int
    diagrams: list[BundleDiagram]


@router.get("/export")
def export_all(user=Depends(require_api_user), conn=Depends(get_db)):
    rows = conn.execute(
        "SELECT * FROM diagrams WHERE user_id = ? ORDER BY created_at, id", (user["id"],)
    ).fetchall()
    tag_map = tags_for(conn, [r["id"] for r in rows])
    payload = {
        "format": FORMAT,
        "version": FORMAT_VERSION,
        "app_version": __version__,
        "exported_at": db.utcnow(),
        "username": user["username"],
        "diagrams": [
            {
                "title": r["title"],
                "source": r["source"],
                "diagram_type": r["diagram_type"],
                "theme": r["theme"],
                "config": json.loads(r["config"] or "{}"),
                "tags": tag_map.get(r["id"], []),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ],
    }
    filename = f"mermaid-factory-export-{datetime.now(UTC):%Y-%m-%d}.json"
    return Response(
        json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _timestamp(value: str | None) -> str | None:
    """Keep imported timestamps only if they parse; store them in our format."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _bad(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


@router.post("/import")
async def import_all(
    request: Request,
    user=Depends(require_api_user),
    conn=Depends(get_db),
    settings=Depends(get_settings),
):
    body = await request.body()
    if len(body) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="Import file is too large (max 50 MB)")
    try:
        raw = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise _bad("That file is not valid JSON.") from None
    try:
        bundle = Bundle.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise _bad(
            f"That file is not a Mermaid Factory export ({where}: {first['msg']})."
        ) from None
    if bundle.format != FORMAT:
        raise _bad("That file is not a Mermaid Factory export.")
    if bundle.version > FORMAT_VERSION:
        raise _bad("That export was made by a newer version of Mermaid Factory.")

    # Validate everything before writing anything: all-or-nothing.
    try:
        items = [
            (
                DiagramIn(
                    title=d.title, source=d.source, theme=d.theme, config=d.config, tags=d.tags
                ),
                d,
            )
            for d in bundle.diagrams
        ]
    except ValidationError as exc:
        raise _bad(f"Invalid diagram in file: {exc.errors()[0]['msg']}") from None

    imported = 0
    with db.transaction(conn):
        for data, original in items:
            data.title = unique_title(conn, user["id"], data.title)
            insert_diagram(
                conn,
                user["id"],
                data,
                settings.max_versions,
                created_at=_timestamp(original.created_at),
                updated_at=_timestamp(original.updated_at),
            )
            imported += 1
    return {"imported": imported}
