"""Setup, auth, staff, terminals, settings and audit endpoints (API.md)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request

from app.domain.identity import AuthMethod, SessionEndReason
from app.routers.api import authed, respond, tx
from app.schemas.requests import (
    ChangeCredentialRequest, LoginRequest, SettingsUpdate, SetupCompleteRequest, TerminalActivateRequest,
)
from app.services import (
    audit_service, auth_service, permission_service, settings_service, setup_service, staff_service, terminal_service,
)

router = APIRouter(prefix="/api/v1")


# --- setup (unauthenticated; guarded by setup state) -------------------------------------------------------
@router.get("/setup/status", tags=["setup"])
def setup_status():  # type: ignore[no-untyped-def]
    return respond(tx(setup_service.status))


@router.post("/setup/complete", tags=["setup"])
def setup_complete(body: SetupCompleteRequest, request: Request):  # type: ignore[no-untyped-def]
    setup_service.require_setup_token(request.headers.get("x-setup-token"))
    return respond(tx(lambda s: setup_service.complete(s, body.model_dump(exclude_none=True))), 201)


@router.post("/setup/first-terminal", tags=["setup"])
def setup_first_terminal(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    """Re-issue the first terminal's one-time code (setup token; only while no terminal is active)."""
    setup_service.require_setup_token(request.headers.get("x-setup-token"))
    return respond(tx(lambda s: setup_service.reissue_first_terminal(s, body)), 201)


# --- auth --------------------------------------------------------------------------------------------------------------
@router.post("/auth/login", tags=["auth"])
def login(body: LoginRequest, request: Request):  # type: ignore[no-untyped-def]
    device = request.headers.get("x-device-credential")
    return respond(tx(lambda s: auth_service.login(s, body.username, body.credential, device)))


@router.get("/auth/me", tags=["auth"])
def me(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, auth_service.me, allow_credential_change=True))


@router.patch("/auth/me", tags=["auth"])
def update_me(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: auth_service.update_me(s, a, body)))


@router.post("/auth/logout", tags=["auth"])
def logout(request: Request):  # type: ignore[no-untyped-def]
    authed(request, lambda s, a: auth_service.end_session(s, a, SessionEndReason.LOGOUT), allow_credential_change=True)
    return respond({"ok": True})


@router.post("/auth/lock", tags=["auth"])
def lock(request: Request):  # type: ignore[no-untyped-def]
    authed(request, lambda s, a: auth_service.end_session(s, a, SessionEndReason.LOCK), allow_credential_change=True)
    return respond({"ok": True})


@router.post("/auth/change-password", tags=["auth"])
def change_password(body: ChangeCredentialRequest, request: Request):  # type: ignore[no-untyped-def]
    authed(request, lambda s, a: auth_service.change_credential(s, a, body.current, body.new, AuthMethod.PASSWORD),
           allow_credential_change=True)
    return respond({"ok": True})


@router.post("/auth/change-pin", tags=["auth"])
def change_pin(body: ChangeCredentialRequest, request: Request):  # type: ignore[no-untyped-def]
    authed(request, lambda s, a: auth_service.change_credential(s, a, body.current, body.new, AuthMethod.PIN),
           allow_credential_change=True)
    return respond({"ok": True})


# --- staff ---------------------------------------------------------------------------------------------------------------
@router.get("/staff", tags=["staff"])
def list_staff(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, staff_service.list_staff))


@router.post("/staff", tags=["staff"])
def create_staff(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: staff_service.create_staff(s, a, body)), 201)


@router.patch("/staff/{user_id}", tags=["staff"])
def update_staff(user_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: staff_service.update_staff(s, a, user_id, body)))


@router.post("/staff/{user_id}/activate", tags=["staff"])
def activate_staff(user_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: staff_service.set_staff_status(s, a, user_id, True)))


@router.post("/staff/{user_id}/deactivate", tags=["staff"])
def deactivate_staff(user_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: staff_service.set_staff_status(s, a, user_id, False)))


@router.post("/staff/{user_id}/reset-credential", tags=["staff"])
def reset_staff_credential(user_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: staff_service.reset_credential(s, a, user_id, body)))


# --- terminals -------------------------------------------------------------------------------------------------------------
@router.get("/terminals", tags=["terminals"])
def list_terminals(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, terminal_service.list_terminals))


@router.post("/terminals", tags=["terminals"])
def register_terminal(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: terminal_service.register(s, a, body)), 201)


@router.post("/terminals/activate", tags=["terminals"])
def activate_terminal(body: TerminalActivateRequest):  # type: ignore[no-untyped-def]
    return respond(tx(lambda s: terminal_service.activate(s, body.terminal_code, body.activation_code)))


@router.post("/terminals/{terminal_id}/deactivate", tags=["terminals"])
def deactivate_terminal(terminal_id: str, request: Request):  # type: ignore[no-untyped-def]
    from app.services.base import parse_uuid
    return respond(authed(request, lambda s, a: terminal_service.deactivate(s, a, parse_uuid(terminal_id, "terminal"))))


@router.patch("/terminals/{terminal_id}", tags=["terminals"])
def rename_terminal(terminal_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    from app.services.base import parse_uuid
    return respond(authed(request, lambda s, a: terminal_service.rename(s, a, parse_uuid(terminal_id, "terminal"), body)))


@router.post("/terminals/{terminal_id}/reset-activation", tags=["terminals"])
def reset_terminal(terminal_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    from app.services.base import parse_uuid
    return respond(authed(request, lambda s, a: terminal_service.reset_activation(
        s, a, parse_uuid(terminal_id, "terminal"), body.get("activation_code_minutes"))))


# --- settings ------------------------------------------------------------------------------------------------------------------
@router.get("/settings", tags=["settings"])
def list_settings(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, settings_service.list_sections))


@router.get("/settings/operational", tags=["settings"])
def operational_settings(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, settings_service.operational))


# Before /settings/{section}: role grants have their own endpoints (PERMISSIONS §4).
@router.get("/settings/permissions", tags=["settings"])
def get_permissions(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, permission_service.get_permissions))


@router.put("/settings/permissions", tags=["settings"])
def put_permissions(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: permission_service.put_permissions(s, a, body)))


@router.get("/settings/{section}", tags=["settings"])
def get_settings_section(section: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: settings_service.get_section(s, a, section)))


@router.put("/settings/{section}", tags=["settings"])
def put_settings_section(section: str, body: SettingsUpdate, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: settings_service.put_section(s, a, section, body.data, body.version)))


# --- audit ------------------------------------------------------------------------------------------------------------------------
@router.get("/audit", tags=["audit"])
def list_audit(request: Request, entity_type: str | None = None, action: str | None = None,  # type: ignore[no-untyped-def]
               limit: int = 100):
    return respond(authed(request, lambda s, a: audit_service.list_audit(s, a, entity_type, action, limit)))


@router.get("/staff/{user_id}/activity", tags=["staff"])
def staff_activity(user_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: audit_service.staff_activity(s, a, user_id)))
