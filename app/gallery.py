"""Template gallery and syntax cheat sheets, loaded from data files.

To add a template: drop ``<slug>.mmd`` into ``app/gallery/`` and add an entry
to ``app/gallery/index.json``. To add a cheat sheet: add
``app/cheatsheets/<diagram_type>.md``. No code changes needed.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import markdown
from fastapi import APIRouter, Depends, HTTPException, Request

from .deps import require_api_user, require_user
from .web import render

GALLERY_DIR = Path(__file__).parent / "gallery"
CHEATSHEET_DIR = Path(__file__).parent / "cheatsheets"

router = APIRouter()


@lru_cache(maxsize=1)
def load_gallery() -> list[dict]:
    entries = json.loads((GALLERY_DIR / "index.json").read_text(encoding="utf-8"))
    out = []
    for entry in entries:
        source = (GALLERY_DIR / entry["file"]).read_text(encoding="utf-8")
        out.append({**entry, "source": source})
    return out


def get_template(slug: str) -> dict | None:
    return next((t for t in load_gallery() if t["slug"] == slug), None)


@lru_cache(maxsize=64)
def load_cheatsheet(diagram_type: str) -> str | None:
    if not diagram_type.isalnum():
        return None
    path = CHEATSHEET_DIR / f"{diagram_type}.md"
    if not path.is_file():
        return None
    return markdown.markdown(path.read_text(encoding="utf-8"), extensions=["fenced_code", "tables"])


@router.get("/diagrams/new")
def gallery_page(request: Request, user=Depends(require_user)):
    return render(request, "gallery.html", {"templates": load_gallery()})


@router.get("/api/templates")
def list_templates(user=Depends(require_api_user)):
    return {"items": load_gallery()}


@router.get("/api/cheatsheets")
def list_cheatsheets(user=Depends(require_api_user)):
    return {"types": sorted(p.stem for p in CHEATSHEET_DIR.glob("*.md"))}


@router.get("/api/cheatsheets/{diagram_type}")
def cheatsheet(diagram_type: str, user=Depends(require_api_user)):
    html = load_cheatsheet(diagram_type)
    if html is None:
        raise HTTPException(status_code=404, detail="No cheat sheet for that diagram type")
    return {"type": diagram_type, "html": html}
