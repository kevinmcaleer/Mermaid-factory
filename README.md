# Mermaid Factory

[![CI](https://github.com/kevinmcaleer/mermaid-factory/actions/workflows/ci.yml/badge.svg)](https://github.com/kevinmcaleer/mermaid-factory/actions/workflows/ci.yml)

A self-hosted Mermaid diagram editor, in the spirit of mermaid.live / mermaid.ai, with
**no limit on how many diagrams you keep**. Write Mermaid code on the left, see it render
live on the right, and save as many diagrams as you like into a SQLite database that sits
on a plain directory you can back up from outside the container.

- Split-pane editor (CodeMirror 6) with Mermaid highlighting and a live preview
- Clear syntax errors that keep the last good render on screen and highlight the line
- Pan and zoom for big diagrams, Ctrl/⌘+S to save, unsaved-changes warning, draft recovery
- A gallery with a working starter for 28 diagram types, plus a syntax cheat sheet for each
- Every Mermaid theme, plus look (classic / hand-drawn / neo), ELK or dagre layout, curve and font
- Dashboard with thumbnails, search (titles and code), type and tag filters
- Rename, duplicate, delete, tags, and version history with one-click restore
- Copy code or a ```` ```mermaid ```` fence, download SVG or PNG (1x / 2x / 4x, any background)
- Read-only public share links you can revoke
- Export / import all your diagrams as one JSON file
- User accounts (argon2id passwords, server-side sessions), CSRF protection, login rate limiting
- Everything is served locally: mermaid.js is bundled, no CDN, works offline

## Quick start with Docker

```sh
git clone https://github.com/kevinmcaleer/mermaid-factory.git
cd mermaid-factory
cp .env.example .env   # optional: every setting has a sensible default
docker compose up -d --build
```

Open <http://localhost:8000>. On a fresh install you're taken straight to **Create the
owner account**. That first account can always be created, even with
`ALLOW_REGISTRATION=false`, so you can leave registration closed from day one.

`docker compose down && docker compose up -d` keeps everything: the data lives on the host,
not in the container.

## Where your data lives

The database is a single SQLite file on the host at **`./data/mermaid.db`** (mounted into the
container at `/data`). It runs in WAL mode, so you may also see `mermaid.db-wal` and
`mermaid.db-shm` next to it while the app is running.

Files in `./data` are owned by UID/GID `1000` by default (the first user on most Linux
systems, including Raspberry Pi OS). If your user is different, set `PUID` and `PGID` in
`.env` to the output of `id -u` and `id -g`.

## Backup and restore

Don't `cp` the live database: a WAL-mode file copied mid-write can be corrupt. Use the backup
script, which uses SQLite's online backup API and checks the result with
`PRAGMA integrity_check`:

```sh
# While the app is running (writes to ./backups on the host):
docker compose exec -u app mermaid-factory scripts/backup.sh /data/mermaid.db /backups
# or simply
make backup
```

It keeps the newest 14 backups (`KEEP=30 scripts/backup.sh ...` to change). With `sqlite3`
installed on the host you can also run it directly, or use the one-liner:

```sh
sqlite3 data/mermaid.db ".backup backups/mermaid-manual.db"
```

**Nightly backups with cron** (on the host, adjust the path):

```cron
15 2 * * * cd /home/kev/mermaid-factory && docker compose exec -T -u app mermaid-factory scripts/backup.sh /data/mermaid.db /backups >> backups/backup.log 2>&1
```

Copy `./backups` somewhere else (another disk, a NAS, cloud storage) for real safety.

**Restore** a backup:

```sh
scripts/restore.sh backups/mermaid-20260101T021500Z.db
```

This checks the backup's integrity, stops the container, keeps the current database as
`data/mermaid.db.before-restore-<time>`, swaps the backup in, starts the container and
waits for `/health`. To restore onto a brand new machine, clone the repo, create `.env`,
copy the backup to `data/mermaid.db`, and run `docker compose up -d`.

Each user can also download all their diagrams as JSON from **Settings → Export** and import
that file on any Mermaid Factory server.

## Configuration

All settings are environment variables, normally set in `.env` (see `.env.example`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `SECRET_KEY` | *(generated)* | Long random string used to sign CSRF tokens. If unset, one is generated on first start and kept in `./data/.secret_key`. |
| `PORT` | `8000` | Port to listen on (and publish). |
| `BIND_ADDRESS` | `0.0.0.0` | Host address the port is published on. Use `127.0.0.1` behind a local reverse proxy. |
| `DATABASE_PATH` | `./data/mermaid.db` (`/data/mermaid.db` in Docker) | SQLite file. |
| `ALLOW_REGISTRATION` | `true` | Allow new sign-ups. The first account is always allowed. |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`. |
| `HTTPS` | `false` | Set `true` when served over HTTPS: cookies get the `Secure` flag. |
| `TRUST_PROXY` | `false` | Honour `X-Forwarded-For` / `X-Forwarded-Proto` from a reverse proxy. |
| `PUID` / `PGID` | `1000` | Owner of files in `./data` (Docker only). |
| `SESSION_MAX_AGE` | `86400` | Seconds a login lasts. |
| `REMEMBER_ME_MAX_AGE` | `2592000` | Seconds a "remember me" login lasts. |
| `MAX_VERSIONS` | `50` | History entries kept per diagram. |
| `LOGIN_RATE_LIMIT` / `LOGIN_RATE_WINDOW` | `5` / `60` | Login and sign-up attempts allowed per IP per window (seconds). |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Interface the server binds to. |

## Running behind a reverse proxy (HTTPS)

Set these in `.env`, then restart:

```ini
HTTPS=true
TRUST_PROXY=true
BIND_ADDRESS=127.0.0.1   # only if the proxy runs on the same host
```

**Caddy** (gets a certificate automatically):

```caddyfile
diagrams.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

**Traefik** labels, added to the service in `docker-compose.yml`:

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.mermaid.rule=Host(`diagrams.example.com`)
      - traefik.http.routers.mermaid.entrypoints=websecure
      - traefik.http.routers.mermaid.tls.certresolver=letsencrypt
      - traefik.http.services.mermaid.loadbalancer.server.port=8000
```

**nginx**:

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

With `TRUST_PROXY=true` and `HTTPS=true`, cookies carry the `Secure` flag and redirects
use `https://`.

## Logs and health

`docker compose logs -f` shows one JSON line per request with a request id, user id, path,
status and duration. `GET /health` returns `{"status":"ok","db":"ok"}` (503 if the database
can't be opened) and drives the Docker healthcheck.

## Local development

Needs Python 3.12+ and Node 22.

```sh
make install     # virtualenv + Python and JS dependencies
make dev         # builds the frontend if needed, runs on http://127.0.0.1:8000 with reload
make test        # pytest
make lint        # ruff
make check-templates   # renders every gallery template in headless Chromium
```

Run `cd frontend && npm run watch` in another terminal to rebuild the browser bundle as
you edit `frontend/src`. Without `SECRET_KEY`, a key is generated into
`data/.secret_key`, just like in Docker.

## How it's built

**Stack: Python + FastAPI, server-rendered Jinja pages, a small amount of vanilla JS, and
SQLite.** FastAPI gives a typed JSON API for the editor plus plain HTML pages without a
heavyweight SPA. SQLite is a single file, which is exactly what makes "back up the mount
point" work, and it is plenty fast for one person's (or a family's) diagrams. The browser
code (mermaid.js, CodeMirror 6 and the page scripts) is bundled with esbuild into
`app/static/build`, so the app never calls a CDN.

```
app/
  main.py          app factory, middleware (security headers, request logs)
  config.py        every setting, read from environment variables
  db.py            SQLite connection (WAL, foreign keys) and migration runner
  migrations/      numbered .sql files, applied once each on startup
  auth.py          sign-up, login/logout, sessions, account settings
  diagrams.py      diagram model, JSON API, dashboard / editor / share pages
  gallery.py       template gallery and cheat sheets (data-driven)
  bundle.py        JSON export / import
  security.py      password hashing, CSRF, rate limiting, headers
  gallery/         one .mmd file per template + index.json
  cheatsheets/     one Markdown file per diagram type
  templates/       Jinja HTML
  static/          CSS, icons; build/ is generated by the frontend build
frontend/src/      editor, dashboard, gallery, share and export code (ES modules)
scripts/           backup.sh, restore.sh
tests/             pytest suite
data/              the database (git-ignored, mounted in Docker)
```

### Adding a gallery template

1. Add `app/gallery/<slug>.mmd` with a working snippet.
2. Add an entry to `app/gallery/index.json` (`slug`, `name`, `description`, `file`, `docs`).
3. Optionally add `app/cheatsheets/<slug>.md` for the reference panel.
4. Run `make check-templates` to prove it renders.

### Changing the database schema

Add a new file such as `app/migrations/0004_add_folders.sql`. It is applied automatically
on the next start and recorded in `schema_migrations`. Never edit a migration that has
already shipped.

## Releases

Pushing a tag like `v0.1.0` builds a multi-arch image (amd64 and arm64, so it runs on a
Raspberry Pi) and publishes `ghcr.io/kevinmcaleer/mermaid-factory:v0.1.0` and `:latest`.
To run a published image instead of building, use `docker compose pull && docker compose up -d`.
