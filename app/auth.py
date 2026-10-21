"""Accounts: registration, login/logout, sessions and account settings."""

from __future__ import annotations

import re
import sqlite3
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse, Response

from . import db
from .deps import (
    SESSION_COOKIE,
    current_user,
    get_db,
    get_settings,
    require_user,
)
from .security import (
    hash_password,
    needs_rehash,
    new_token,
    password_problem,
    token_digest,
    verify_password,
)
from .web import render

router = APIRouter()

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UserError(ValueError):
    pass


# --------------------------------------------------------------------------- users


def user_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def create_user(
    conn: sqlite3.Connection, username: str, password: str, email: str | None = None
) -> int:
    """Create a user and return its id. Raises UserError on invalid input."""
    username = username.strip()
    email = (email or "").strip() or None
    if not USERNAME_RE.match(username):
        raise UserError("Username must be 3-32 characters: letters, numbers, '.', '_' or '-'.")
    if email and not EMAIL_RE.match(email):
        raise UserError("That email address doesn't look right.")
    problem = password_problem(password)
    if problem:
        raise UserError(problem)
    now = db.utcnow()
    try:
        cur = conn.execute(
            "INSERT INTO users (username, email, password_hash, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (username, email, hash_password(password), now, now),
        )
    except sqlite3.IntegrityError as exc:
        if "email" in str(exc):
            raise UserError("That email address is already registered.") from None
        raise UserError("That username is already taken.") from None
    return cur.lastrowid


def authenticate(conn: sqlite3.Connection, username: str, password: str) -> sqlite3.Row | None:
    user = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
    if not verify_password(user["password_hash"] if user else None, password):
        return None
    if needs_rehash(user["password_hash"]):
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), user["id"])
        )
    return user


def registration_open(conn: sqlite3.Connection, allow_registration: bool) -> bool:
    """Registration is always open on a fresh install so the owner can sign up."""
    return allow_registration or user_count(conn) == 0


# ------------------------------------------------------------------------ sessions


def start_session(
    request: Request, response: Response, conn: sqlite3.Connection, user_id: int, remember: bool
) -> None:
    settings = get_settings(request)
    max_age = settings.remember_me_max_age if remember else settings.session_max_age
    token = new_token()
    now = datetime.now(UTC)
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (db.utcnow(),))
    conn.execute(
        "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            token_digest(token),
            user_id,
            db.utcnow(),
            (now + timedelta(seconds=max_age))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            request.headers.get("user-agent", "")[:255],
        ),
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age if remember else None,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(request),
        path="/",
    )


def end_session(request: Request, response: Response | None, conn: sqlite3.Connection) -> None:
    """Delete the current session row, and clear the cookie if a response is given."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        conn.execute("DELETE FROM sessions WHERE id = ?", (token_digest(token),))
    if response is not None:
        response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax")


def cookie_secure(request: Request) -> bool:
    settings = get_settings(request)
    return settings.https or request.url.scheme == "https"


def safe_next(next_url: str | None) -> str:
    """Only allow local redirects after login (no open redirects)."""
    if not next_url:
        return "/diagrams"
    parts = urlsplit(next_url)
    if parts.scheme or parts.netloc or not next_url.startswith("/") or next_url.startswith("//"):
        return "/diagrams"
    if "\\" in next_url:
        return "/diagrams"
    return next_url


def _rate_limited(request: Request, bucket: str):
    limiter = request.app.state.rate_limiter
    ip = request.client.host if request.client else "unknown"
    allowed, retry_after = limiter.hit(f"{bucket}:{ip}")
    if allowed:
        return None
    response = render(
        request,
        "error.html",
        {
            "title": "Too many attempts",
            "message": f"Too many attempts. Please wait {retry_after} seconds and try again.",
        },
        status_code=429,
    )
    response.headers["Retry-After"] = str(retry_after)
    return response


# -------------------------------------------------------------------------- routes


@router.get("/")
def index(user=Depends(current_user)):
    return RedirectResponse("/diagrams" if user else "/login", status_code=303)


@router.get("/register")
def register_page(
    request: Request,
    conn=Depends(get_db),
    user=Depends(current_user),
    settings=Depends(get_settings),
):
    if user:
        return RedirectResponse("/diagrams", status_code=303)
    is_open = registration_open(conn, settings.allow_registration)
    return render(
        request,
        "register.html",
        {
            "registration_open": is_open,
            "first_user": user_count(conn) == 0,
            "errors": [],
            "form": {},
        },
        status_code=200 if is_open else 403,
    )


@router.post("/register")
def register_submit(
    request: Request,
    username: str = Form(""),
    email: str = Form(""),
    password: str = Form(""),
    confirm_password: str = Form(""),
    conn=Depends(get_db),
    settings=Depends(get_settings),
):
    limited = _rate_limited(request, "register")
    if limited:
        return limited
    if not registration_open(conn, settings.allow_registration):
        return render(
            request,
            "register.html",
            {"registration_open": False, "first_user": False, "errors": [], "form": {}},
            status_code=403,
        )
    errors = []
    if password != confirm_password:
        errors.append("Passwords do not match.")
    user_id = None
    if not errors:
        try:
            with db.transaction(conn):
                # Re-check inside the write lock so two racing first sign-ups
                # cannot both slip through a closed registration.
                if not registration_open(conn, settings.allow_registration):
                    raise UserError("Registration is disabled.")
                user_id = create_user(conn, username, password, email)
        except UserError as exc:
            errors.append(str(exc))
    if errors:
        return render(
            request,
            "register.html",
            {
                "registration_open": True,
                "first_user": user_count(conn) == 0,
                "errors": errors,
                "form": {"username": username, "email": email},
            },
            status_code=400,
        )
    response = RedirectResponse("/diagrams", status_code=303)
    start_session(request, response, conn, user_id, remember=False)
    return response


@router.get("/login")
def login_page(
    request: Request,
    next: str = "",
    conn=Depends(get_db),
    user=Depends(current_user),
    settings=Depends(get_settings),
):
    if user:
        return RedirectResponse(safe_next(next), status_code=303)
    if user_count(conn) == 0:
        return RedirectResponse("/register", status_code=303)
    return render(
        request,
        "login.html",
        {
            "next": next,
            "error": None,
            "form": {},
            "registration_open": registration_open(conn, settings.allow_registration),
        },
    )


@router.post("/login")
def login_submit(
    request: Request,
    username: str = Form(""),
    password: str = Form(""),
    remember: str = Form(""),
    next: str = Form(""),
    conn=Depends(get_db),
    settings=Depends(get_settings),
):
    limited = _rate_limited(request, "login")
    if limited:
        return limited
    user = authenticate(conn, username, password)
    if user is None:
        return render(
            request,
            "login.html",
            {
                "next": next,
                "error": "Invalid username or password.",
                "form": {"username": username},
                "registration_open": registration_open(conn, settings.allow_registration),
            },
            status_code=401,
        )
    response = RedirectResponse(safe_next(next), status_code=303)
    end_session(request, None, conn)  # don't let a stale session linger
    start_session(request, response, conn, user["id"], remember=bool(remember))
    return response


@router.post("/logout")
def logout(request: Request, conn=Depends(get_db)):
    response = RedirectResponse("/login", status_code=303)
    end_session(request, response, conn)
    return response


@router.get("/settings")
def settings_page(request: Request, user=Depends(require_user), conn=Depends(get_db)):
    count = conn.execute(
        "SELECT COUNT(*) FROM diagrams WHERE user_id = ?", (user["id"],)
    ).fetchone()[0]
    return render(
        request,
        "settings.html",
        {"user": user, "diagram_count": count, "message": request.query_params.get("msg")},
    )


@router.post("/settings/password")
def change_password(
    request: Request,
    current_password: str = Form(""),
    new_password: str = Form(""),
    confirm_password: str = Form(""),
    user=Depends(require_user),
    conn=Depends(get_db),
):
    error = None
    if not verify_password(user["password_hash"], current_password):
        error = "Your current password is incorrect."
    elif new_password != confirm_password:
        error = "New passwords do not match."
    else:
        error = password_problem(new_password)
    if error:
        count = conn.execute(
            "SELECT COUNT(*) FROM diagrams WHERE user_id = ?", (user["id"],)
        ).fetchone()[0]
        return render(
            request,
            "settings.html",
            {"user": user, "diagram_count": count, "password_error": error},
            status_code=400,
        )
    response = RedirectResponse("/settings?msg=password-changed", status_code=303)
    with db.transaction(conn):
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (hash_password(new_password), db.utcnow(), user["id"]),
        )
        # Sign out every other session, then start a fresh one here.
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        start_session(request, response, conn, user["id"], remember=False)
    return response


@router.post("/settings/delete")
def delete_account(
    request: Request,
    confirm_username: str = Form(""),
    user=Depends(require_user),
    conn=Depends(get_db),
):
    if confirm_username.strip().lower() != user["username"].lower():
        count = conn.execute(
            "SELECT COUNT(*) FROM diagrams WHERE user_id = ?", (user["id"],)
        ).fetchone()[0]
        return render(
            request,
            "settings.html",
            {
                "user": user,
                "diagram_count": count,
                "delete_error": "Type your username exactly to confirm.",
            },
            status_code=400,
        )
    with db.transaction(conn):
        # ON DELETE CASCADE removes diagrams, versions, tags and sessions.
        conn.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
