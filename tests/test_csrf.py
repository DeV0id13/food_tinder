import pytest
from django.urls import path
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.test import APIClient

from config.urls import urlpatterns as project_urls


@api_view(["POST"])
def protected_test_view(request):
    return Response({"ok": True})


# This write endpoint exists only in the test URLConf.
urlpatterns = [*project_urls, path("csrf-test/", protected_test_view)]


@pytest.mark.django_db
def test_session_authentication_enforces_csrf(settings, django_user_model):
    settings.ROOT_URLCONF = __name__
    client = APIClient(enforce_csrf_checks=True)
    user = django_user_model.objects.create_user("csrf@example.com", "Foundation_123")
    client.force_login(user)
    assert client.post("/csrf-test/", {}).status_code == 403
    response = client.get("/api/v1/auth/session/")
    assert response.status_code == 200
    assert response.cookies["csrftoken"].value
    token = client.cookies["csrftoken"].value
    assert client.post("/csrf-test/", {}).status_code == 403
    assert client.post("/csrf-test/", {}, HTTP_X_CSRFTOKEN=token).status_code == 200
