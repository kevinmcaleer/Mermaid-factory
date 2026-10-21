"""Application factory and middleware."""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__, auth, bundle, db, diagrams, gallery
from .config import Settings, load_settings_or_exit
from .deps import ANON_COOKIE, LoginRequired, login_redirect_url, verify_csrf
from .logging_config import configure_logging
from .security import SECURITY_HEADERS, RateLimiter, new_token
from .web import STATIC_DIR, render

access_log = logging.getLogger("mermaid_factory.access")
log = logging.getLogger("mermaid_factory")


def _wants_json(request: Request) -> bool:
    return request.url.path.startswith("/api/") or "application/json" in request.headers.get(
        "accept", ""
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings_or_exit()
    configure_logging(settings.log_level)
    db.init_db(settings.database_path)

    app = FastAPI(
        title="Mermaid Factory",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        dependencies=[Depends(verify_csrf)],
    )
    app.state.settings = settings
    app.state.rate_limiter = RateLimiter(settings.login_rate_limit, settings.login_rate_window)

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.include_router(auth.router)
    app.include_router(gallery.router)  # before diagrams so /diagrams/new wins
    app.include_router(diagrams.pages)
    app.include_router(diagrams.api)
    app.include_router(bundle.router)

    @app.get("/health")
    def health():
        ok = db.check_db(settings.database_path)
        return JSONResponse(
            {
                "status": "ok" if ok else "error",
                "db": "ok" if ok else "error",
                "version": __version__,
            },
            status_code=200 if ok else 503,
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        start = time.perf_counter()
        request_id = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        anon = request.cookies.get(ANON_COOKIE)
        request.state.anon_id = anon or new_token(16)
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error", extra={"request_id": request_id})
            raise
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        response.headers["X-Request-ID"] = request_id
        if request.url.path.startswith(("/api/", "/diagrams", "/settings", "/share/")):
            response.headers.setdefault("Cache-Control", "no-store")
        if not anon:
            response.set_cookie(
                ANON_COOKIE,
                request.state.anon_id,
                httponly=True,
                samesite="lax",
                secure=settings.https or request.url.scheme == "https",
                path="/",
            )
        if request.url.path != "/health" or response.status_code != 200:
            access_log.info(
                "%s %s %s",
                request.method,
                request.url.path,
                response.status_code,
                extra={
                    "request_id": request_id,
                    "user_id": getattr(request.state, "user_id", None),
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                    "client": request.client.host if request.client else None,
                },
            )
        return response

    @app.exception_handler(LoginRequired)
    async def login_required_handler(request: Request, exc: LoginRequired):
        return RedirectResponse(login_redirect_url(exc.next_url), status_code=303)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException):
        if _wants_json(request):
            return JSONResponse(
                {"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers
            )
        titles = {403: "Forbidden", 404: "Not found", 401: "Sign in required"}
        return render(
            request,
            "error.html",
            {
                "title": titles.get(exc.status_code, "Something went wrong"),
                "message": exc.detail if exc.status_code != 404 else "That page doesn't exist.",
            },
            status_code=exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        errors = exc.errors()
        first = errors[0] if errors else {"loc": [], "msg": "Invalid request"}
        field = ".".join(str(p) for p in first["loc"] if p != "body")
        message = f"{field}: {first['msg']}" if field else first["msg"]
        return JSONResponse({"detail": message}, status_code=422)

    if settings.trust_proxy:
        from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

        app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

    log.info(
        "Mermaid Factory %s started",
        __version__,
        extra={"database_path": str(settings.database_path), "env": settings.app_env},
    )
    return app
