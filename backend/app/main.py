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

    app = FastAPI(title=settings.app_name, version=settings.app_version)

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
