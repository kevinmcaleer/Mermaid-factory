import pytest

from app.config import ConfigError, load_settings


def test_defaults():
    s = load_settings({})
    assert s.port == 8000
    assert str(s.database_path) == "data/mermaid.db"
    assert s.allow_registration is True
    assert s.secret_key  # ephemeral key generated in development


def test_production_requires_secret_key():
    with pytest.raises(ConfigError, match="SECRET_KEY is not set"):
        load_settings({"APP_ENV": "production"})


def test_production_rejects_short_secret():
    with pytest.raises(ConfigError, match="at least 32"):
        load_settings({"APP_ENV": "production", "SECRET_KEY": "short"})


def test_env_parsing():
    s = load_settings(
        {
            "SECRET_KEY": "x" * 40,
            "PORT": "9000",
            "ALLOW_REGISTRATION": "false",
            "DATABASE_PATH": "/data/m.db",
            "HTTPS": "true",
            "LOG_LEVEL": "debug",
        }
    )
    assert (s.port, s.allow_registration, str(s.database_path), s.https, s.log_level) == (
        9000,
        False,
        "/data/m.db",
        True,
        "DEBUG",
    )


def test_bad_integer():
    with pytest.raises(ConfigError, match="PORT"):
        load_settings({"PORT": "eighty"})


def test_missing_secret_exits_cleanly(monkeypatch, capsys):
    from app.config import load_settings_or_exit

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(SystemExit) as exc:
        load_settings_or_exit()
    assert exc.value.code == 2
    assert "SECRET_KEY is not set" in capsys.readouterr().err
