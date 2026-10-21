import sqlite3

from app import db


def test_init_creates_file_and_schema(tmp_path):
    path = tmp_path / "nested" / "dir" / "m.db"
    db.init_db(path)
    assert path.exists()
    conn = db.connect(path)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"users", "diagrams", "sessions", "diagram_versions", "diagram_tags"} <= tables
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_restart_does_not_reapply_or_lose_data(tmp_path):
    path = tmp_path / "m.db"
    db.init_db(path)
    conn = db.connect(path)
    conn.execute(
        "INSERT INTO users (username, password_hash, created_at, updated_at) VALUES ('a','h','t','t')"
    )
    conn.close()
    conn = db.connect(path)
    assert db.migrate(conn) == []
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1


def test_new_migration_is_applied(tmp_path):
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_first.sql").write_text("CREATE TABLE t (id INTEGER PRIMARY KEY);")
    conn = db.connect(tmp_path / "m.db")
    assert db.migrate(conn, migrations) == ["0001_first"]

    (migrations / "0002_add_column.sql").write_text("ALTER TABLE t ADD COLUMN name TEXT;")
    assert db.migrate(conn, migrations) == ["0002_add_column"]
    cols = [r[1] for r in conn.execute("PRAGMA table_info(t)")]
    assert cols == ["id", "name"]
    assert db.migrate(conn, migrations) == []


def test_failed_migration_rolls_back(tmp_path):
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_bad.sql").write_text("CREATE TABLE ok (id INTEGER); THIS IS NOT SQL;")
    conn = db.connect(tmp_path / "m.db")
    try:
        db.migrate(conn, migrations)
    except sqlite3.Error:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected failure")
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "ok" not in tables
    assert db.applied_migrations(conn) == set()


def test_check_db(tmp_path):
    assert db.check_db(tmp_path / "missing.db") is False
    db.init_db(tmp_path / "m.db")
    assert db.check_db(tmp_path / "m.db") is True
