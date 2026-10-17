import pytest
from django.urls import resolve
from rest_framework.test import APIClient

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient


@pytest.mark.parametrize(
    "url",
    [
        "/api/v1/auth/session/",
        "/api/v1/auth/register/",
        "/api/v1/auth/login/",
        "/api/v1/auth/logout/",
        "/api/v1/recipes/",
        "/api/v1/recipes/1/",
        "/api/v1/preferences/feed/",
        "/api/v1/preferences/swipes/",
        "/api/v1/preferences/favorites/",
        "/api/v1/preferences/favorites/1/",
    ],
)
def test_ready_modules_are_connected_in_project_urlconf(url):
    assert resolve(url).func is not None


@pytest.mark.django_db
def test_cookie_csrf_catalog_preferences_flow_through_project_routes():
    recipe = Recipe.objects.create(
        slug="integration-lunch",
        title="Integration lunch",
        description="Local integration fixture",
        cooking_time_minutes=15,
        difficulty=1,
        base_servings=2,
        meal_types=["lunch"],
        steps=["Cook"],
        is_active=False,
    )
    ingredient = Ingredient.objects.create(slug="integration-rice", name="Rice", unit="g")
    RecipeIngredient.objects.create(recipe=recipe, ingredient=ingredient, quantity="200.000")
    recipe.is_active = True
    recipe.save()
    client = APIClient(enforce_csrf_checks=True)
    origin = {"HTTP_HOST": "localhost:5173", "HTTP_ORIGIN": "http://localhost:5173"}

    assert client.get("/api/v1/recipes/", **origin).data["count"] == 1
    assert client.get(f"/api/v1/recipes/{recipe.id}/", **origin).status_code == 200
    assert client.get("/api/v1/preferences/feed/", **origin).data["count"] == 1
    assert client.get("/api/v1/auth/session/", **origin).data["authenticated"] is False

    account = {"email": "integration@example.com", "password": "ReadyFlow_7259"}
    assert (
        client.post("/api/v1/auth/register/", account, format="json", **origin).status_code == 403
    )

    def unsafe(method, path, payload=None):
        return getattr(client, method)(
            path,
            payload or {},
            format="json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            **origin,
        )

    assert unsafe("post", "/api/v1/auth/register/", account).status_code == 201
    assert client.get("/api/v1/auth/session/", **origin).data["authenticated"] is False
    assert unsafe("post", "/api/v1/auth/login/", account).data["authenticated"] is True
    assert "sessionid" in client.cookies
    assert client.get("/api/v1/auth/session/", **origin).data["authenticated"] is True

    favorite_url = f"/api/v1/preferences/favorites/{recipe.id}/"
    assert unsafe("put", favorite_url, {"is_favorite": True}).status_code == 200
    assert client.get("/api/v1/preferences/feed/", **origin).data["count"] == 1
    assert client.get("/api/v1/preferences/favorites/", **origin).data["count"] == 1

    for action in ("dislike", "like"):
        response = unsafe(
            "post", "/api/v1/preferences/swipes/", {"recipe_id": recipe.id, "action": action}
        )
        assert response.status_code == 200
        assert client.get("/api/v1/preferences/feed/", **origin).data["count"] == 0
    assert unsafe("put", favorite_url, {"is_favorite": False}).status_code == 200
    assert client.get("/api/v1/preferences/favorites/", **origin).data["count"] == 0
    assert client.get("/api/v1/preferences/feed/", **origin).data["count"] == 0
    assert unsafe("post", "/api/v1/auth/logout/").status_code == 204
    assert client.get("/api/v1/auth/session/", **origin).data["authenticated"] is False
    assert client.get("/api/v1/preferences/favorites/", **origin).status_code == 403
