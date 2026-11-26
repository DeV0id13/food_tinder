import logging
from uuid import UUID

import pytest
from django.http import HttpResponse
from django.urls import ResolverMatch

from common import observability
from common.logging import ApplicationFormatter

VALID_ID = "01234567-89ab-4def-8abc-0123456789ab"


@pytest.mark.parametrize("supplied", [VALID_ID, 'unsafe"value', ""])
def test_request_id_is_returned_and_available_to_logs(rf, supplied):
    def view(request):
        entry = logging.LogRecord("django.request", logging.INFO, "", 0, "%s", ("secret",), None)
        formatted = ApplicationFormatter(json_output=True).format(entry)
        assert observability.request_id.get() in formatted
        assert "secret" not in formatted
        return HttpResponse()

    response = observability.ObservabilityMiddleware(view)(rf.get("/", HTTP_X_REQUEST_ID=supplied))
    result = response["X-Request-ID"]
    assert str(UUID(result)) == result
    assert (result == supplied) is (supplied == VALID_ID)
    assert observability.request_id.get() is None


def test_request_id_is_cleared_after_failure(rf):
    def failing_view(request):
        raise RuntimeError

    with pytest.raises(RuntimeError):
        observability.ObservabilityMiddleware(failing_view)(rf.get("/"))
    assert observability.request_id.get() is None


def test_api_metrics_use_bounded_labels_and_release_gauge(rf, monkeypatch):
    monkeypatch.setenv("PROMETHEUS_MULTIPROC_DIR", "/unused-for-these-in-memory-metrics")

    def view(request):
        assert observability.IN_FLIGHT._value.get() == 1
        if request.method == "GET":
            request.resolver_match = ResolverMatch(view, (), {}, url_name="recipe-detail")
            return HttpResponse(status=200)
        return HttpResponse(status=404)

    middleware = observability.ObservabilityMiddleware(view)
    middleware(rf.get("/api/v1/recipes/1927/?q=private"))
    middleware(rf.generic("UNUSUAL", "/api/v1/unknown/1901/"))
    assert observability.IN_FLIGHT._value.get() == 0
    assert observability.REQUESTS.labels("recipe-detail", "GET", "2xx")._value.get() >= 1
    assert observability.REQUESTS.labels("unresolved", "OTHER", "4xx")._value.get() >= 1


@pytest.mark.parametrize("ready", [True, False])
def test_internal_metrics_expose_readiness_and_use_no_store(rf, monkeypatch, tmp_path, ready):
    monkeypatch.setenv("PROMETHEUS_MULTIPROC_DIR", str(tmp_path))
    monkeypatch.setattr(observability, "database_ready", lambda: ready)

    def view(request):
        pytest.fail("The scrape must bypass the application and session")

    middleware = observability.ObservabilityMiddleware(view)
    response = middleware(rf.get("/_metrics/"))
    assert response.status_code == 200 and response["Cache-Control"] == "no-store"
    assert f"foodtinder_database_ready {int(ready)}.0".encode() in response.content
    assert middleware(rf.post("/_metrics/")).status_code == 405
