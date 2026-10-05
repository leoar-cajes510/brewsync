from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.database.connection import DatabaseNotConfigured
from app.routers import core, health, operations
from app.routers.api import app_error_handler, db_not_configured_handler, request_validation_handler


def create_app() -> FastAPI:
    settings = get_settings()

    from app.core.config import is_production
    # The interactive API docs describe every endpoint; they are for development only.
    docs = {} if not is_production(settings) else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title=settings.app_name, version=settings.app_version, **docs)

    @app.middleware("http")
    async def _require_bearer(request, call_next):  # type: ignore[no-untyped-def]
        """Every API route except the public allowlist needs a bearer token. Checked before body
        validation so an anonymous caller gets 401, never a validation error describing the API.
        (The token itself is verified per request by authenticate().)"""
        from fastapi.responses import JSONResponse

        from app.routers.api import PUBLIC_API_PATHS, bearer
        path = request.url.path
        if (request.method != "OPTIONS" and path.startswith("/api/v1/") and path not in PUBLIC_API_PATHS
                and not bearer(request)):
            return JSONResponse(status_code=401, content={"error": {"code": "UNAUTHENTICATED",
                                                                    "message": "Missing bearer token", "details": {}}})
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(core.router)
    app.include_router(operations.router)
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(DatabaseNotConfigured, db_not_configured_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, request_validation_handler)  # type: ignore[arg-type]

    from sqlalchemy.exc import DBAPIError, IntegrityError

    from app.routers.api import conflict_error_handler, database_error_handler, unexpected_error_handler
    app.add_exception_handler(IntegrityError, conflict_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(DBAPIError, database_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unexpected_error_handler)  # type: ignore[arg-type]

    @app.on_event("startup")
    def _start_scheduler() -> None:  # opt-in automatic archive job (AUTO_ARCHIVE_ENABLED)
        from app.services.archive_scheduler import start

        app.state.archive_stop = start()

    @app.on_event("shutdown")
    def _stop_scheduler() -> None:
        stop = getattr(app.state, "archive_stop", None)
        if stop is not None:
            stop.set()

    return app


app = create_app()
