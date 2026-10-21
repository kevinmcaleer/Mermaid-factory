"""Run the server: ``python -m app``.

Host and port come from the HOST and PORT environment variables.
"""

from __future__ import annotations

import uvicorn

from .config import load_settings_or_exit


def main() -> None:
    settings = load_settings_or_exit()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
        proxy_headers=False,  # handled in-app when TRUST_PROXY=true
        server_header=False,
        access_log=False,
        log_config=None,
    )


if __name__ == "__main__":
    main()
