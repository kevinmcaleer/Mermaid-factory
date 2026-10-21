"""Runtime configuration, read once from environment variables.

Every setting the app uses lives here; nothing else reads ``os.environ``.
See ``.env.example`` for the documented list.
"""

from __future__ import annotations

import os
import secrets
import sys
from dataclasses import dataclass
from pathlib import Path

TRUE_VALUES = {"1", "true", "yes", "on"}


class ConfigError(RuntimeError):
    """Raised when the configuration is invalid."""


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in TRUE_VALUES


def _int(name: str, value: str | None, default: int) -> int:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {value!r}") from exc


@dataclass(frozen=True)
class Settings:
    app_env: str
    secret_key: str
    database_path: Path
    host: str
    port: int
    allow_registration: bool
    log_level: str
    https: bool
    trust_proxy: bool
    session_max_age: int
    remember_me_max_age: int
    max_versions: int
    login_rate_limit: int
    login_rate_window: int
    reload: bool = False

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


def load_settings(env: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ if env is None else env)
    app_env = env.get("APP_ENV", "development").strip().lower()

    secret_key = env.get("SECRET_KEY", "").strip()
    if not secret_key:
        if app_env == "production":
            raise ConfigError(
                "SECRET_KEY is not set. Generate one with\n"
                '    python -c "import secrets; print(secrets.token_urlsafe(48))"\n'
                "and put it in your .env file (see .env.example)."
            )
        # Development only: an ephemeral key means sessions reset on restart.
        secret_key = secrets.token_urlsafe(48)
    elif app_env == "production" and len(secret_key) < 32:
        raise ConfigError("SECRET_KEY must be at least 32 characters long.")

    log_level = env.get("LOG_LEVEL", "INFO").strip().upper()
    if log_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise ConfigError(f"LOG_LEVEL must be one of DEBUG/INFO/WARNING/ERROR, got {log_level!r}")

    return Settings(
        app_env=app_env,
        secret_key=secret_key,
        database_path=Path(env.get("DATABASE_PATH", "./data/mermaid.db")),
        host=env.get("HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=_int("PORT", env.get("PORT"), 8000),
        allow_registration=_bool(env.get("ALLOW_REGISTRATION"), True),
        log_level=log_level,
        https=_bool(env.get("HTTPS"), False),
        trust_proxy=_bool(env.get("TRUST_PROXY"), False),
        session_max_age=_int("SESSION_MAX_AGE", env.get("SESSION_MAX_AGE"), 60 * 60 * 24),
        remember_me_max_age=_int(
            "REMEMBER_ME_MAX_AGE", env.get("REMEMBER_ME_MAX_AGE"), 60 * 60 * 24 * 30
        ),
        max_versions=_int("MAX_VERSIONS", env.get("MAX_VERSIONS"), 50),
        login_rate_limit=_int("LOGIN_RATE_LIMIT", env.get("LOGIN_RATE_LIMIT"), 5),
        login_rate_window=_int("LOGIN_RATE_WINDOW", env.get("LOGIN_RATE_WINDOW"), 60),
        reload=_bool(env.get("RELOAD"), False),
    )


def load_settings_or_exit() -> Settings:
    """Load settings, printing a friendly message instead of a traceback."""
    try:
        return load_settings()
    except ConfigError as exc:
        print(f"\nConfiguration error: {exc}\n", file=sys.stderr)
        raise SystemExit(2) from None
