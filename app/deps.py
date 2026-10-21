"""Request-scoped dependencies: database, current user, CSRF and auth guards."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from urllib.parse import quote

from fastapi import Depends, HTTPException, Request

from . import db
from .config import Settings
from .security import csrf_token, csrf_valid, token_digest

SESSION_COOKIE = "mf_session"
ANON_COOKIE = "mf_anon"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


class LoginRequired(Exception):
    """Raised by page routes; turned into a redirect to /login."""

    def __init__(self, next_url: str) -> None:
        self.next_url = next_url


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    # Reuse the connection if a middleware or another dependency opened one.
    conn = getattr(request.state, "db", None)
    if conn is not None:
        yield conn
        return
    conn = db.connect(request.app.state.settings.database_path)
    request.state.db = conn
    try:
        yield conn
    finally:
        request.state.db = None
        conn.close()


def load_user(request: Request, conn: sqlite3.Connection) -> sqlite3.Row | None:
    """Resolve the session cookie to a user row (cached on request.state)."""
    if hasattr(request.state, "user"):
        return request.state.user
    user = None
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        user = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
            " WHERE s.id = ? AND s.expires_at > ?",
            (token_digest(token), db.utcnow()),
        ).fetchone()
    request.state.user = user
    request.state.user_id = user["id"] if user else None
    return user


def current_user(
    request: Request, conn: sqlite3.Connection = Depends(get_db)
) -> sqlite3.Row | None:
    return load_user(request, conn)


def _next_url(request: Request) -> str:
    url = request.url.path
    if request.url.query:
        url += "?" + request.url.query
    return url


def require_user(request: Request, user: sqlite3.Row | None = Depends(current_user)) -> sqlite3.Row:
    """Guard for HTML pages: anonymous visitors are sent to the login page."""
    if user is None:
        raise LoginRequired(_next_url(request))
    return user


def require_api_user(user: sqlite3.Row | None = Depends(current_user)) -> sqlite3.Row:
    """Guard for JSON API routes: anonymous requests get a 401."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def csrf_binding(request: Request) -> str | None:
    return request.cookies.get(SESSION_COOKIE) or getattr(request.state, "anon_id", None)


def csrf_token_for(request: Request) -> str:
    return csrf_token(request.app.state.settings.secret_key, csrf_binding(request) or "")


async def verify_csrf(request: Request) -> None:
    """Applied app-wide: every state-changing request needs a valid token.

    API calls send it in the ``X-CSRF-Token`` header; HTML forms send a
    ``csrf_token`` field.
    """
    if request.method in SAFE_METHODS:
        return
    supplied = request.headers.get("x-csrf-token")
    if not supplied:
        content_type = request.headers.get("content-type", "")
        if content_type.startswith(("application/x-www-form-urlencoded", "multipart/form-data")):
            form = await request.form()
            value = form.get("csrf_token")
            supplied = value if isinstance(value, str) else None
    if not csrf_valid(request.app.state.settings.secret_key, csrf_binding(request), supplied):
        raise HTTPException(status_code=403, detail="Invalid or missing CSRF token")


def login_redirect_url(next_url: str) -> str:
    return "/login?next=" + quote(next_url, safe="/")
