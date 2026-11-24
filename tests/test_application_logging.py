import json
import logging
import sys

from django.test import RequestFactory
from django.urls import resolve

from common.logging import ApplicationFormatter


def test_production_log_keeps_safe_exception_context_only():
    private = "user@example.test private-password private-token"
    request = RequestFactory().post(f"/api/v1/auth/login/?secret={private}", {"password": private})
    request.COOKIES["sessionid"] = private
    request.resolver_match = resolve(request.path)
    try:
        raise ValueError(private)
    except ValueError:
        record = logging.getLogger("django.request").makeRecord(
            "django.request",
            logging.ERROR,
            __file__,
            1,
            "Failed request %s",
            (request.get_full_path(),),
            sys.exc_info(),
            extra={"request": request, "status_code": 500},
        )
    output = ApplicationFormatter(json_output=True).format(record)
    event = json.loads(output)
    assert event["event"] == "http_response"
    assert event["status"] == 500
    assert event["view"] == "accounts:login"
    assert event["exception"] == "ValueError"
    assert event["stack"]
    assert all(value not in output for value in private.split())
    assert "ValueError" in ApplicationFormatter().format(record)


def test_logging_keeps_operational_codes_and_redacts_security_messages():
    formatter = ApplicationFormatter(json_output=True)
    auth = logging.LogRecord(
        "foodtinder.auth", logging.WARNING, __file__, 1, "auth_rate_limited", (), None
    )
    auth.operation = "login"
    assert json.loads(formatter.format(auth))["operation"] == "login"
    assert json.loads(formatter.format(auth))["event"] == "auth_rate_limited"
    security = logging.LogRecord(
        "django.security.DisallowedHost", logging.ERROR, __file__, 1, "bad private host", (), None
    )
    assert json.loads(formatter.format(security))["event"] == "DisallowedHost"
    assert "private" not in formatter.format(security)
    runserver = logging.LogRecord(
        "django.server", logging.INFO, __file__, 1, "private URL", (), None
    )
    runserver.status_code = 200
    assert ApplicationFormatter().format(runserver) == "INFO django.server HTTP 200"
