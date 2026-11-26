from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model

from common.monitoring_access import monitoring_access


@pytest.mark.django_db
@pytest.mark.parametrize("service", ["grafana", "prometheus"])
def test_guest_redirects_to_admin_login(client, service):
    response = client.get(
        f"/_monitoring_auth/{service}/",
        HTTP_X_FOODTINDER_MONITORING_USER="admin",
        HTTP_X_FORWARDED_URI="//other.example/",
    )
    assert response.status_code == 302
    assert response["Location"] == f"/admin/login/?next=/{service}/"
    assert "no-store" in response["Cache-Control"]
    assert "X-FoodTinder-Monitoring-User" not in response


@pytest.mark.django_db
@pytest.mark.parametrize("staff", [False, True])
def test_staff_session_is_required(client, staff):
    user = get_user_model().objects.create_user(email="monitoring@example.test", is_staff=staff)
    client.force_login(user)
    for service in ("grafana", "prometheus"):
        response = client.get(
            f"/_monitoring_auth/{service}/",
            HTTP_X_FOODTINDER_MONITORING_USER="admin",
        )
        assert response.status_code == (204 if staff else 403)
        assert "no-store" in response["Cache-Control"]
        if staff:
            assert response["X-FoodTinder-Monitoring-User"] == f"foodtinder-staff-{user.pk}"
        else:
            assert "X-FoodTinder-Monitoring-User" not in response
    client.logout()
    assert client.get("/_monitoring_auth/grafana/").status_code == 302


def test_inactive_staff_is_rejected(rf):
    request = rf.get("/_monitoring_auth/grafana/")
    request.user = SimpleNamespace(is_authenticated=True, is_staff=True, is_active=False)
    assert monitoring_access(request, "/grafana/").status_code == 403


def test_authorization_subrequest_rejects_unsafe_methods(client):
    assert client.post("/_monitoring_auth/grafana/").status_code == 405
