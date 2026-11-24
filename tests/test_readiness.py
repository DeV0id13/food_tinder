import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic

import pytest
from django.db import connections
from psycopg import OperationalError

from common import readiness
from common.readiness import database_ready


@pytest.fixture(autouse=True)
def reset_probe_cache(monkeypatch):
    monkeypatch.setattr(readiness, "_last_probe", None)


def test_health_ignores_database_and_keeps_public_response(client, monkeypatch):
    def fail(*args, **kwargs):
        pytest.fail("Liveness should not use PostgreSQL")

    monkeypatch.setattr(connections["default"], "cursor", fail)
    monkeypatch.setattr("common.views.database_ready", fail)
    client.cookies["sessionid"] = "previous-session"
    response = client.get("/api/v1/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_ready_checks_real_postgresql(client):
    response = client.get("/api/v1/ready/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "no-store" in response["Cache-Control"]


def test_ready_handles_database_error_without_exposing_details(client, monkeypatch):
    async def refuse(conninfo):
        raise OperationalError("user=someone password=private hostname=internal")

    monkeypatch.setattr("common.readiness.AsyncConnection.connect", refuse)
    response = client.get("/api/v1/ready/")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert "no-store" in response["Cache-Control"]


def test_readiness_deadline_cancels_a_stalled_connect(monkeypatch):
    async def stall(conninfo):
        await asyncio.sleep(15)

    monkeypatch.setattr("common.readiness.AsyncConnection.connect", stall)
    monkeypatch.setattr("common.readiness.PROBE_TIMEOUT_SECONDS", 0.02)
    started = monotonic()
    assert not database_ready()
    assert monotonic() - started < 1


def test_readiness_reuses_success_and_failure_until_the_ttl_expires(client, monkeypatch):
    clock = 10.0
    result = True
    probes = []
    monkeypatch.setattr(readiness, "monotonic", lambda: clock)

    def probe():
        probes.append(clock)
        return result

    monkeypatch.setattr(readiness, "_check_database", probe)

    def check(expected):
        response = client.get("/api/v1/ready/")
        assert response.status_code == expected
        assert "no-store" in response["Cache-Control"]

    check(200)
    result = False
    check(200)
    clock += readiness.PROBE_CACHE_SECONDS
    check(503)
    result = True
    check(503)
    clock += readiness.PROBE_CACHE_SECONDS
    check(200)
    assert probes == [10, 11, 12]


def test_parallel_readiness_requests_share_one_probe(monkeypatch):
    started = Event()
    release = Event()
    attempts = []
    monkeypatch.setattr(readiness, "monotonic", lambda: 10.0)

    def probe():
        attempts.append(1)
        started.set()
        assert release.wait(timeout=5)
        return True

    monkeypatch.setattr(readiness, "_check_database", probe)
    with ThreadPoolExecutor(max_workers=4) as pool:
        requests = [pool.submit(database_ready) for _ in range(4)]
        assert started.wait(timeout=5)
        release.set()
        assert all(request.result(timeout=5) for request in requests)
    assert attempts == [1]
