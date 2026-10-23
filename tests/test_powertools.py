from __future__ import annotations

from conftest import Client, make_settings

from app.config import load_settings
from app.main import create_app
from app.powertools import BUNDLED_APPS, PowerToolApp, PowerTools, parse_apps


def entry(app_id: str, url: str, **extra):
    return {"id": app_id, "name": app_id.title(), "url": url, **extra}


def test_bundled_list_has_every_app():
    assert [a.id for a in BUNDLED_APPS] == ["puddle", "mermaid-factory", "wellyboot-bi"]
    assert next(a for a in BUNDLED_APPS if a.id == "wellyboot-bi").status == "soon"


def test_parse_keeps_only_https_on_kevspowertools():
    apps = parse_apps(
        {
            "apps": [
                entry("a", "https://a.kevspowertools.com/"),
                entry("home", "https://kevspowertools.com/"),
                entry("b", "http://b.kevspowertools.com/"),
                entry("c", "https://evil.example/kevspowertools.com"),
                entry("d", "https://kevspowertools.com.evil.example/"),
                entry("e", "javascript:alert(1)"),
            ]
        }
    )
    assert [a.id for a in apps] == ["a", "home"]


def test_parse_drops_bad_and_repeated_entries_and_reads_status():
    apps = parse_apps(
        {
            "apps": [
                None,
                "x",
                {"name": "No id", "url": "https://a.kevspowertools.com/"},
                entry("b", "https://b.kevspowertools.com/", status="beta", description=" Hi "),
                entry("b", "https://b.kevspowertools.com/again"),
                entry("c", "https://c.kevspowertools.com/", status="soon"),
            ]
        }
    )
    assert apps == [
        PowerToolApp("b", "B", "https://b.kevspowertools.com/", "Hi", "live"),
        PowerToolApp("c", "C", "https://c.kevspowertools.com/", "", "soon"),
    ]
    assert parse_apps(None) == [] and parse_apps({"apps": "no"}) == []


def test_reads_the_shared_list_and_caches_it():
    calls = []
    now = [0.0]

    def fetch(url):
        calls.append(url)
        return {"apps": [entry("new", "https://new.kevspowertools.com/")]}

    tools = PowerTools("https://kevspowertools.com/apps.json", fetch=fetch, clock=lambda: now[0])
    assert [a.id for a in tools.apps()] == ["new"]
    tools.apps()
    assert calls == ["https://kevspowertools.com/apps.json"]
    now[0] = 301
    tools.apps()
    assert len(calls) == 2


def test_falls_back_to_bundled_list_and_caches_the_failure():
    calls = []

    def fail(url):
        calls.append(url)
        raise TimeoutError("down")

    tools = PowerTools("https://kevspowertools.com/apps.json", fetch=fail, clock=lambda: 0.0)
    assert tools.apps() is BUNDLED_APPS
    assert tools.apps() is BUNDLED_APPS
    assert len(calls) == 1
    nonsense = PowerTools("x", fetch=lambda url: {"apps": []}, clock=lambda: 0.0)
    assert nonsense.apps() is BUNDLED_APPS


def test_empty_url_never_fetches():
    def boom(url):
        raise AssertionError("fetched")

    assert PowerTools("", fetch=boom).apps() is BUNDLED_APPS


def test_setting_defaults_to_the_landing_page(tmp_path):
    env = {"SECRET_KEY": "x" * 40, "DATABASE_PATH": str(tmp_path / "m.db")}
    assert load_settings(env).powertools_apps_url == "https://kevspowertools.com/apps.json"
    assert load_settings({**env, "POWERTOOLS_APPS_URL": ""}).powertools_apps_url == ""


def test_every_page_has_the_switcher(client):
    html = client.get("/login", follow_redirects=True).text
    assert 'aria-label="Switch app"' in html
    assert '<a href="https://puddle.kevspowertools.com/">Puddle' in html
    # This app is marked as the current one, and an app that's coming soon isn't a link.
    assert '<a href="/" aria-current="page"><strong>Mermaid Factory</strong>' in html
    assert "wellyboot.kevspowertools.com" not in html
    assert "Coming soon" in html
    assert 'href="https://kevspowertools.com/"' in html


def test_switcher_shows_the_shared_list(tmp_path):
    app = create_app(make_settings(tmp_path))
    app.state.powertools = PowerTools(
        "https://kevspowertools.com/apps.json",
        fetch=lambda url: {"apps": [entry("new-tool", "https://new.kevspowertools.com/")]},
    )
    with Client(app, base_url="http://testserver") as c:
        assert (
            '<a href="https://new.kevspowertools.com/">New-Tool'
            in c.get("/login", follow_redirects=True).text
        )
