from runpy import run_path
from types import ModuleType

import pytest
from django.test import Client
from django.urls import Resolver404, resolve

from apps.accounts.models import User
from config import urls


def test_openapi_describes_only_implemented_operations(client):
    response = client.get("/api/schema/?format=json")
    assert response.status_code == 200
    assert "no-store" in response["Cache-Control"]
    schema = response.json()
    paths = schema["paths"]
    assert {
        path.removeprefix("/api/v1/"): set(operations) for path, operations in paths.items()
    } == {
        "auth/session/": {"get"},
        "auth/register/": {"post"},
        "auth/login/": {"post"},
        "auth/logout/": {"post"},
        "auth/profile/": {"get", "patch"},
        "auth/account/": {"get", "patch"},
        "auth/account/email/": {"post"},
        "recipes/": {"get"},
        "recipes/{recipe_id}/": {"get"},
        "preferences/feed/": {"get"},
        "preferences/swipes/": {"post"},
        "preferences/swipes/undo/": {"post"},
        "preferences/favorites/": {"get"},
        "preferences/favorites/{recipe_id}/": {"put"},
        "meal-plans/": {"get", "post"},
        "meal-plans/{plan_id}/": {"get", "put", "delete"},
        "meal-plans/{plan_id}/slots/{day_index}/{meal_type}/": {"put", "delete"},
        "shopping-list/": {"get"},
        "shopping-list/export/": {"get"},
        "shopping-list/{plan_id}/purchases/": {"delete"},
        "shopping-list/{plan_id}/purchases/{ingredient_id}/": {"put"},
        "health/": {"get"},
        "ready/": {"get"},
    }
    cookie_auth = schema["components"]["securitySchemes"]["cookieAuth"]
    assert (cookie_auth["in"], cookie_auth["name"]) == ("cookie", "sessionid")
    login = paths["/api/v1/auth/login/"]["post"]
    assert login["responses"]["429"]["headers"]["Retry-After"]["schema"]["type"] == "integer"
    editor = paths["/api/v1/meal-plans/{plan_id}/"]["put"]
    assert editor["security"] == [{"cookieAuth": []}]
    assert {"400", "403", "404", "409"} <= set(editor["responses"])
    feeds = paths["/api/v1/preferences/feed/"]["get"]
    assert {parameter["name"] for parameter in feeds["parameters"]} == {"limit", "offset"}
    components = schema["components"]["schemas"]
    assert set(components["FeedPage"]["properties"]) == {"count", "previous", "next", "results"}
    assert components["MealPlanDetail"]["properties"]["slots"]["items"]["$ref"].endswith(
        "/MealPlanSlot"
    )
    export = paths["/api/v1/shopping-list/export/"]["get"]
    assert set(export["responses"]["200"]["content"]) == {"text/csv", "text/plain"}
    assert "Content-Disposition" in export["responses"]["200"]["headers"]
    assert "503" in paths["/api/v1/ready/"]["get"]["responses"]


def test_openapi_urls_are_omitted_when_disabled(settings):
    settings.API_DOCS_ENABLED = False
    settings.DEBUG = False
    urlconf = ModuleType("urls_without_api_docs")
    urlconf.urlpatterns = run_path(urls.__file__)["urlpatterns"]
    for path in ("/api/schema/", "/api/docs/", "/api/redoc/"):
        with pytest.raises(Resolver404):
            resolve(path, urlconf)
    assert resolve("/api/v1/ready/", urlconf).url_name == "ready"


@pytest.mark.django_db
def test_swagger_session_uses_rotated_csrf_and_redoc_uses_local_assets():
    client = Client(enforce_csrf_checks=True)
    swagger = client.get("/api/docs/")
    assert swagger.status_code == 200
    document = swagger.content.decode()
    assert "/static/drf_spectacular_sidecar/swagger-ui-dist/swagger-ui-bundle.js" in document
    assert r"X\u002DCSRFTOKEN" in document
    assert "readCsrfCookie()" in document
    assert "same-origin" in document
    redoc = client.get("/api/redoc/")
    assert redoc.status_code == 200
    assert b"/static/drf_spectacular_sidecar/redoc/" in redoc.content
    initial_token = client.cookies["csrftoken"].value

    password = "Documentation_1"
    User.objects.create_user(email="docs@example.test", password=password)
    response = client.post(
        "/api/v1/auth/login/",
        {"email": "docs@example.test", "password": password},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=initial_token,
    )
    assert response.status_code == 200
    token = client.cookies["csrftoken"].value
    assert token != initial_token
    path = "/api/v1/auth/account/"
    payload = {"first_name": "Anna"}
    assert (
        client.patch(
            path, payload, content_type="application/json", HTTP_X_CSRFTOKEN=initial_token
        ).status_code
        == 403
    )
    updated = client.patch(path, payload, content_type="application/json", HTTP_X_CSRFTOKEN=token)
    assert updated.status_code == 200
    assert updated.json()["first_name"] == "Anna"
