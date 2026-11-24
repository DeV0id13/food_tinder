import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from django.db import connection, connections
from django.test import Client
from django.urls import reverse
from rest_framework.exceptions import Throttled
from rest_framework.request import Request
from rest_framework.test import APIClient, APIRequestFactory

from apps.accounts.models import AuthRateBucket, User
from apps.accounts.rate_limit import client_ip, limit_auth_attempt

BASE = "/api/v1/auth/"
pytestmark = pytest.mark.django_db


def post(client, path, payload, **headers):
    return client.post(
        f"{BASE}{path}/",
        payload,
        format="json",
        HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        **headers,
    )


@pytest.fixture
def browser(settings):
    settings.AUTH_RATE_LIMITS = {"login": (2, 60), "register": (1, 300)}
    client = APIClient(enforce_csrf_checks=True)
    client.get(f"{BASE}session/")
    return client


def test_login_limit_has_retry_header_and_expiry(browser, monkeypatch, caplog):
    monkeypatch.setattr(logging.getLogger("foodtinder.auth"), "propagate", True)
    clock = datetime(2026, 11, 24, tzinfo=UTC)
    monkeypatch.setattr("apps.accounts.rate_limit.timezone.now", lambda: clock)
    bad = {"email": "missing@example.test", "password": "Invalid_123"}
    assert post(browser, "login", bad).status_code == 400
    clock += timedelta(seconds=12, milliseconds=1)
    assert post(browser, "login", bad).status_code == 400
    for _ in range(2):
        response = post(browser, "login", bad)
        assert response.status_code == 429
        assert response["Retry-After"] == "48"
        assert "missing@example.test" not in response.content.decode()
        assert "no-store" in response["Cache-Control"]
    auth_events = [record for record in caplog.records if record.name == "foodtinder.auth"]
    assert [record.getMessage() for record in auth_events] == ["auth_rate_limited"]

    clock += timedelta(seconds=48)
    assert post(browser, "login", bad).status_code == 400
    assert AuthRateBucket.objects.get().attempts == 1


def test_operation_and_address_are_independent(browser):
    payload = {
        "first_name": "Anna",
        "email": "anna@example.test",
        "password": f"Local_{uuid4().hex}9",
    }
    assert post(browser, "register", payload, REMOTE_ADDR="192.0.2.1").status_code == 201
    assert post(browser, "register", payload, REMOTE_ADDR="192.0.2.1").status_code == 429
    other = {**payload, "email": "other@example.test"}
    assert post(browser, "register", other, REMOTE_ADDR="192.0.2.2").status_code == 201
    credentials = {key: payload[key] for key in ("email", "password")}
    assert post(browser, "login", credentials, REMOTE_ADDR="192.0.2.1").status_code == 200
    assert User.objects.count() == 2


def test_missing_csrf_does_not_use_a_bucket(browser):
    payload = {"email": "missing@example.test", "password": "Invalid_123"}
    for path in ("login", "register"):
        assert browser.post(f"{BASE}{path}/", payload, format="json").status_code == 403
    assert not AuthRateBucket.objects.exists()
    assert post(browser, "login", payload).status_code == 400


def test_proxy_headers_and_mapped_ips(browser, settings):
    bad = {"email": "missing@example.test", "password": "Invalid_123"}
    settings.AUTH_RATE_LIMITS["login"] = (1, 60)
    meta = {"REMOTE_ADDR": "172.20.0.2", "HTTP_X_FORWARDED_FOR": "192.0.2.10"}
    assert post(browser, "login", bad, **meta).status_code == 400
    meta["HTTP_X_FOODTINDER_CLIENT_IP"] = "192.0.2.11"
    assert post(browser, "login", bad, **meta).status_code == 429

    settings.AUTH_RATE_LIMIT_TRUST_PROXY = True
    assert post(browser, "login", bad, **meta).status_code == 400
    meta["HTTP_X_FOODTINDER_CLIENT_IP"] = "::ffff:192.0.2.11"
    assert post(browser, "login", bad, **meta).status_code == 429
    meta["HTTP_X_FOODTINDER_CLIENT_IP"] = "192.0.2.11, 192.0.2.12"
    assert post(browser, "login", bad, **meta).status_code == 429
    meta["HTTP_X_FOODTINDER_CLIENT_IP"] = "2001:db8::1"
    assert post(browser, "login", bad, **meta).status_code == 400


def test_malformed_peer_address_uses_a_shared_bucket():
    request = Request(APIRequestFactory().post("/", REMOTE_ADDR="fe80::1%eth0"))
    assert client_ip(request) == "unknown"


def test_expired_buckets_are_purged_on_new_window(browser, monkeypatch):
    clock = datetime(2026, 11, 24, tzinfo=UTC)
    monkeypatch.setattr("apps.accounts.rate_limit.timezone.now", lambda: clock)
    AuthRateBucket.objects.create(key="expired", expires_at=clock, attempts=1)
    AuthRateBucket.objects.create(key="active", expires_at=clock + timedelta(seconds=1))
    post(browser, "login", {})
    assert not AuthRateBucket.objects.filter(key="expired").exists()
    assert AuthRateBucket.objects.filter(key="active").exists()


@pytest.mark.django_db(transaction=True)
def test_workers_share_one_atomic_limit(settings):
    settings.AUTH_RATE_LIMITS = {"login": (2, 60), "register": (1, 300)}
    started = Barrier(4)

    def attempt():
        try:
            request = Request(APIRequestFactory().post("/", REMOTE_ADDR="192.0.2.19"))
            connection.ensure_connection()
            started.wait(timeout=10)
            limit_auth_attempt(request, "login")
        except Throttled:
            return False
        finally:
            connections.close_all()
        return True

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: attempt(), range(4)))
    assert results.count(True) == 2
    assert AuthRateBucket.objects.get().attempts == 3


def test_admin_login_keeps_csrf_and_normal_staff_session(settings):
    settings.AUTH_RATE_LIMITS = {**settings.AUTH_RATE_LIMITS, "admin_login": (2, 60)}
    admin = Client(enforce_csrf_checks=True)
    login = reverse("admin:login")
    password = f"Local_{uuid4().hex}9"
    staff = User.objects.create_user("teacher@example.test", password, is_staff=True)
    payload = {"username": staff.email, "password": password, "next": reverse("admin:index")}

    assert admin.get(login).status_code == 200
    assert admin.post(login, payload).status_code == 403
    assert not AuthRateBucket.objects.exists()

    token = admin.cookies["csrftoken"].value
    response = admin.post(login, payload, HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 302
    assert response["Location"] == reverse("admin:index")
    assert admin.session["_auth_user_id"] == str(staff.pk)
    assert admin.get(reverse("admin:index")).status_code == 200


def test_admin_limit_is_separate_and_uses_trusted_proxy(browser, settings, monkeypatch):
    settings.AUTH_RATE_LIMITS = {**settings.AUTH_RATE_LIMITS, "admin_login": (1, 60)}
    clock = datetime(2026, 11, 24, tzinfo=UTC)
    monkeypatch.setattr("apps.accounts.rate_limit.timezone.now", lambda: clock)
    admin = Client(enforce_csrf_checks=True)
    login = reverse("admin:login")
    payload = {"username": "missing@example.test", "password": "invalid"}
    assert admin.get(login).status_code == 200
    meta = {
        "REMOTE_ADDR": "172.20.0.2",
        "HTTP_X_CSRFTOKEN": admin.cookies["csrftoken"].value,
        "HTTP_X_FOODTINDER_CLIENT_IP": "192.0.2.10",
        "HTTP_X_FORWARDED_FOR": "192.0.2.10",
    }
    assert admin.post(login, payload, **meta).status_code == 200
    meta["HTTP_X_FORWARDED_FOR"] = "192.0.2.11"
    meta["HTTP_X_FOODTINDER_CLIENT_IP"] = "192.0.2.11"
    response = admin.post(login, payload, **meta)
    assert response.status_code == 429
    assert response["Retry-After"] == "60"
    assert "no-store" in response["Cache-Control"]
    assert payload["username"] not in response.content.decode()
    assert (
        post(
            browser,
            "login",
            {"email": payload["username"], "password": payload["password"]},
            REMOTE_ADDR=meta["REMOTE_ADDR"],
        ).status_code
        == 400
    )

    settings.AUTH_RATE_LIMIT_TRUST_PROXY = True
    assert admin.post(login, payload, **meta).status_code == 200
    meta["HTTP_X_FORWARDED_FOR"] = "192.0.2.12"
    assert admin.post(login, payload, **meta).status_code == 429
    clock += timedelta(seconds=60)
    assert admin.post(login, payload, **meta).status_code == 200
