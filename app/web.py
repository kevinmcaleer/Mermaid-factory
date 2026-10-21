"""Jinja2 templating helpers shared by the page routes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.templating import Jinja2Templates

from . import __version__
from .deps import csrf_token_for

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


def static_url(path: str) -> str:
    """URL for a static asset with a cache-busting version query."""
    return f"/static/{path}?v={__version__}"


templates.env.globals["static_url"] = static_url
templates.env.globals["app_version"] = __version__


def render(
    request: Request, name: str, context: dict[str, Any] | None = None, status_code: int = 200
):
    ctx = {
        "current_user": getattr(request.state, "user", None),
        "csrf_token": csrf_token_for(request),
        **(context or {}),
    }
    return templates.TemplateResponse(request, name, ctx, status_code=status_code)
