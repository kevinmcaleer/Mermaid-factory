"""The backup script must produce a valid copy while the app is writing."""

import shutil
import sqlite3
import subprocess
import threading
from pathlib import Path

import pytest
from test_diagrams import FLOW, create

SCRIPT = Path(__file__).parent.parent / "scripts" / "backup.sh"


@pytest.mark.skipif(shutil.which("sh") is None, reason="needs a POSIX shell")
def test_backup_during_writes(alice, settings, tmp_path):
    for i in range(20):
        create(alice, title=f"seed {i}")
    stop = threading.Event()

    def writer():
        conn = sqlite3.connect(settings.database_path, timeout=15)
        uid = conn.execute("SELECT id FROM users").fetchone()[0]
        i = 0
        while not stop.is_set():
            conn.execute(
                "INSERT INTO diagrams (user_id, title, source, created_at, updated_at)"
                " VALUES (?, ?, ?, 'now', 'now')",
                (uid, f"live {i}", FLOW * 50),
            )
            conn.commit()
            i += 1
        conn.close()

    thread = threading.Thread(target=writer)
    thread.start()
    try:
        backups = tmp_path / "backups"
        for _ in range(3):
            result = subprocess.run(
                ["sh", str(SCRIPT), str(settings.database_path), str(backups)],
                capture_output=True,
                text=True,
                env={"PATH": "/usr/bin:/bin:/usr/local/bin", "KEEP": "2"},
                timeout=60,
            )
            assert result.returncode == 0, result.stderr
    finally:
        stop.set()
        thread.join()

    files = sorted(backups.glob("mermaid-*.db"))
    assert 1 <= len(files) <= 2  # retention honoured (same-second runs share a name)
    copy = sqlite3.connect(files[-1])
    assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert copy.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    assert copy.execute("SELECT COUNT(*) FROM diagrams").fetchone()[0] >= 20
