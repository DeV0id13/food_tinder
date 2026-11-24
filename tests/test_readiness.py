import asyncio
from time import monotonic

import pytest
from django.db import connections
from psycopg import OperationalError

from common.readiness import database_ready


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
