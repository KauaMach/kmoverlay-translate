"""Errors returned as `{ "error": { "code", "message" } }`, the format of the API contract."""

import logging
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

INVALID_REQUEST_CODE = "invalid-request"
INVALID_REQUEST_MESSAGE = "A requisição não segue o contrato da API."
HTTP_ERROR_CODES = {
    HTTPStatus.NOT_FOUND: "not-found",
    HTTPStatus.METHOD_NOT_ALLOWED: "method-not-allowed",
}
GENERIC_HTTP_ERROR_CODE = "http-error"
INTERNAL_ERROR_CODE = "internal-error"
INTERNAL_ERROR_MESSAGE = "Erro interno no servidor."

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """An error the client can act on, with a stable code and a message in Portuguese."""

    def __init__(self, status: HTTPStatus, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    """Builds a response in the error format of the contract."""
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def install_error_handlers(app: FastAPI) -> None:
    """Makes every error, including validation and unknown routes, use the contract format."""

    @app.exception_handler(ApiError)
    async def handle_api_error(_request: Request, error: ApiError) -> JSONResponse:
        return error_response(error.status, error.code, error.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, _error: RequestValidationError
    ) -> JSONResponse:
        return error_response(
            HTTPStatus.UNPROCESSABLE_ENTITY, INVALID_REQUEST_CODE, INVALID_REQUEST_MESSAGE
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_request: Request, error: StarletteHTTPException) -> JSONResponse:
        code = HTTP_ERROR_CODES.get(HTTPStatus(error.status_code), GENERIC_HTTP_ERROR_CODE)
        return error_response(error.status_code, code, str(error.detail))

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, _error: Exception) -> JSONResponse:
        # The traceback goes to the server log; the client only learns that it failed.
        logger.exception("Unexpected error while handling %s %s", request.method, request.url.path)
        return error_response(
            HTTPStatus.INTERNAL_SERVER_ERROR, INTERNAL_ERROR_CODE, INTERNAL_ERROR_MESSAGE
        )
