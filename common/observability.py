import os
import re
from collections.abc import Callable
from contextvars import ContextVar
from time import monotonic
from uuid import uuid4

from django.http import HttpRequest, HttpResponse, HttpResponseNotAllowed
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.metrics_core import Metric

from .readiness import database_ready

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
UUID = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")
METHODS = frozenset(("GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"))

REQUESTS = Counter(
    "foodtinder_api_requests",
    "Completed Django API requests.",
    ("route", "method", "status"),
    registry=None,
)
LATENCY = Histogram(
    "foodtinder_api_duration_seconds",
    "Time spent in Django for an API request.",
    ("route",),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16),
    registry=None,
)
IN_FLIGHT = Gauge(
    "foodtinder_api_in_flight",
    "API requests currently executing in Django.",
    multiprocess_mode="livesum",
    registry=None,
)


class ReadinessCollector:
    def collect(self) -> list[Metric]:
        return [
            GaugeMetricFamily(
                "foodtinder_database_ready", "Database readiness as 0 or 1.", int(database_ready())
            )
        ]


def metrics() -> HttpResponse:
    registry = CollectorRegistry()
    multiprocess.MultiProcessCollector(registry)
    registry.register(ReadinessCollector())
    return HttpResponse(
        generate_latest(registry),
        content_type=CONTENT_TYPE_LATEST,
        headers={"Cache-Control": "no-store"},
    )


class ObservabilityMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response
        self.collect_metrics = bool(os.environ.get("PROMETHEUS_MULTIPROC_DIR"))

    def __call__(self, request: HttpRequest) -> HttpResponse:
        supplied = request.headers.get("X-Request-ID", "")
        token = request_id.set(supplied if UUID.fullmatch(supplied) else str(uuid4()))
        try:
            if self.collect_metrics and request.path_info == "/_metrics/":
                response = (
                    metrics()
                    if request.method in {"GET", "HEAD"}
                    else HttpResponseNotAllowed(["GET", "HEAD"])
                )
            elif self.collect_metrics and request.path_info.startswith("/api/"):
                response = self.observe_api(request)
            else:
                response = self.get_response(request)
            response["X-Request-ID"] = request_id.get() or ""
            return response
        finally:
            request_id.reset(token)

    def observe_api(self, request: HttpRequest) -> HttpResponse:
        started = monotonic()
        with IN_FLIGHT.track_inprogress():
            response = self.get_response(request)
        match = request.resolver_match
        route = match.view_name if match and match.url_name else "unresolved"
        method = request.method if request.method in METHODS else "OTHER"
        status = f"{response.status_code // 100}xx"
        REQUESTS.labels(route, method, status).inc()
        LATENCY.labels(route).observe(monotonic() - started)
        return response
