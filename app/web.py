"""Jinja2 templating helpers shared by the page routes."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.templating import Jinja2Templates

from . import __version__
from .deps import csrf_token_for
from .powertools import BUNDLED_APPS, CURRENT_APP_ID, HOME_URL

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@lru_cache(maxsize=None)
def _asset_hash(path: str) -> str:
    try:
        return hashlib.sha256((STATIC_DIR / path).read_bytes()).hexdigest()[:12]
    except OSError:
        return __version__


def static_url(path: str) -> str:
    """URL for a static asset with a content-hash query, so a changed file is never served stale."""
    return f"/static/{path}?v={_asset_hash(path)}"


templates.env.globals["static_url"] = static_url
templates.env.globals["app_version"] = __version__
templates.env.globals["powertools_current"] = CURRENT_APP_ID
templates.env.globals["powertools_home"] = HOME_URL


def _powertools_apps(request: Request):
    tools = getattr(request.app.state, "powertools", None)
    return tools.apps() if tools else BUNDLED_APPS


def render(
    request: Request, name: str, context: dict[str, Any] | None = None, status_code: int = 200
):
    ctx = {
        "current_user": getattr(request.state, "user", None),
        "csrf_token": csrf_token_for(request),
        "powertools_apps": _powertools_apps(request),
        **(context or {}),
    }
    return templates.TemplateResponse(request, name, ctx, status_code=status_code)
