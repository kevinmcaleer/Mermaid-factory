from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

PASSWORD = "correct horse battery"
CSRF_RE = re.compile(r'<meta name="csrf-token" content="([^"]+)">')


def make_settings(tmp_path, **overrides):
    env = {
        "APP_ENV": "test",
        "SECRET_KEY": "test-secret-key-that-is-long-enough-0123456789",
        "DATABASE_PATH": str(tmp_path / "data" / "mermaid.db"),
        "LOG_LEVEL": "WARNING",
        "LOGIN_RATE_LIMIT": "1000",
        # Tests never reach the landing page; the switcher shows its bundled list.
        "POWERTOOLS_APPS_URL": "",
    }
    env.update({k: str(v) for k, v in overrides.items()})
    return load_settings(env)


class Client(TestClient):
    """TestClient that knows how to fetch a CSRF token and log in."""

    def csrf(self, path: str = "/login") -> str:
        html = self.get(path, follow_redirects=True).text
        match = CSRF_RE.search(html)
        assert match, "no csrf meta tag on page"
        return match.group(1)

    def register(self, username: str, password: str = PASSWORD, **extra):
        token = self.csrf("/register")
        return self.post(
            "/register",
            data={
                "csrf_token": token,
                "username": username,
                "password": password,
                "confirm_password": extra.pop("confirm_password", password),
                **extra,
            },
            follow_redirects=False,
        )

    def login(self, username: str, password: str = PASSWORD, **extra):
        token = self.csrf("/login")
        return self.post(
            "/login",
            data={"csrf_token": token, "username": username, "password": password, **extra},
            follow_redirects=False,
        )

    def api(self, method: str, url: str, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.setdefault("X-CSRF-Token", self.csrf("/settings"))
        return self.request(method, url, headers=headers, **kwargs)


@pytest.fixture
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with Client(app, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def new_client(app):
    """Factory for extra independent browser sessions on the same app."""
    clients = []

    def factory():
        c = Client(app, base_url="http://testserver")
        clients.append(c)
        return c

    yield factory
    for c in clients:
        c.close()


@pytest.fixture
def alice(client):
    assert client.register("alice").status_code == 303
    return client


@pytest.fixture
def bob(new_client, alice):
    c = new_client()
    assert c.register("bob").status_code == 303
    return c
