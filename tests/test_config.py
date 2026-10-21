import pytest

from app.config import ConfigError, load_settings


def test_defaults(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    s = load_settings({})
    assert s.port == 8000
    assert str(s.database_path) == "data/mermaid.db"
    assert s.allow_registration is True


def test_missing_secret_key_is_generated_and_kept(tmp_path):
    env = {"APP_ENV": "production", "DATABASE_PATH": str(tmp_path / "data" / "m.db")}
    first = load_settings(env).secret_key
    key_file = tmp_path / "data" / ".secret_key"
    assert len(first) >= 32
    assert key_file.read_text().strip() == first
    assert key_file.stat().st_mode & 0o777 == 0o600
    assert load_settings(env).secret_key == first  # stable across restarts


def test_explicit_secret_key_wins(tmp_path):
    env = {"SECRET_KEY": "k" * 40, "DATABASE_PATH": str(tmp_path / "m.db")}
    assert load_settings(env).secret_key == "k" * 40
    assert not (tmp_path / ".secret_key").exists()


def test_unwritable_data_dir_gives_clear_error(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("not a directory")
    with pytest.raises(ConfigError, match="SECRET_KEY is not set"):
        load_settings({"DATABASE_PATH": str(blocker / "m.db")})


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


def test_config_error_exits_cleanly(monkeypatch, capsys):
    from app.config import load_settings_or_exit

    monkeypatch.setenv("PORT", "eighty")
    with pytest.raises(SystemExit) as exc:
        load_settings_or_exit()
    assert exc.value.code == 2
    assert "PORT must be an integer" in capsys.readouterr().err
