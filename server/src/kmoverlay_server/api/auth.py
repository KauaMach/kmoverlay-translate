"""Bearer token check shared by every `/v1` endpoint."""

import secrets
from collections.abc import Awaitable, Callable
from http import HTTPStatus
from typing import Annotated

from fastapi import Header

from kmoverlay_server.api.errors import ApiError

UNAUTHORIZED_CODE = "unauthorized"
UNAUTHORIZED_MESSAGE = "Token ausente ou inválido."
BEARER_PREFIX = "Bearer "


def create_token_dependency(token: str) -> Callable[[str | None], Awaitable[None]]:
    """FastAPI dependency that accepts only `Authorization: Bearer <token>`."""
    expected = f"{BEARER_PREFIX}{token}".encode()

    async def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
        # Constant-time comparison, so response times do not reveal the token.
        if authorization is None or not secrets.compare_digest(authorization.encode(), expected):
            raise ApiError(HTTPStatus.UNAUTHORIZED, UNAUTHORIZED_CODE, UNAUTHORIZED_MESSAGE)

    return require_token
