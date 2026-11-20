from unittest.mock import ANY

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
        "/api/v1/meal-plans/",
        "/api/v1/meal-plans/1/",
        "/api/v1/meal-plans/1/slots/0/lunch/",
        "/api/v1/shopping-list/",
        "/api/v1/shopping-list/export/",
    ],
)
def test_ready_modules_are_connected_in_project_urlconf(url):
    assert resolve(url).func is not None


@pytest.mark.django_db
def test_cookie_csrf_full_flow_and_persistence_through_project_routes():
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

    # Real project routes must support every period and the full favorite -> plan -> export flow.
    plans = []
    for duration in (1, 3, 7):
        response = unsafe(
            "post",
            "/api/v1/meal-plans/",
            {"start_date": "2026-11-19", "duration_days": duration, "enabled_meals": ["lunch"]},
        )
        assert response.status_code == 201
        plans.append(response.data)
    plan_id = plans[0]["id"]
    plan_url = f"/api/v1/meal-plans/{plan_id}/"
    slot_url = f"{plan_url}slots/0/lunch/"
    shopping_url = f"/api/v1/shopping-list/?plan_id={plan_id}"
    export_url = f"/api/v1/shopping-list/export/?plan_id={plan_id}"
    assert unsafe("put", slot_url, {"recipe_id": recipe.id, "servings": 3}).status_code == 200
    assert client.get(shopping_url, **origin).data["items"] == [
        {
            "ingredient_id": ingredient.id,
            "name": "Rice",
            "unit": "g",
            "quantity": "300.000",
            "purchased": False,
            "quantity_version": ANY,
        }
    ]
    assert unsafe("put", slot_url, {"recipe_id": recipe.id, "servings": 4}).status_code == 200
    assert client.get(shopping_url, **origin).data["items"][0]["quantity"] == "400.000"
    for file_type in ("csv", "txt"):
        response = client.get(f"{export_url}&file_type={file_type}", **origin)
        assert response.status_code == 200
        assert f"shopping-list-{plan_id}.{file_type}" in response["Content-Disposition"]
        assert "400.000" in response.content.decode("utf-8-sig")

    # A new browser has no runtime/frontend state; logging in must recover database records.
    first_browser = client
    client = APIClient(enforce_csrf_checks=True)
    client.get("/api/v1/auth/session/", **origin)
    assert unsafe("post", "/api/v1/auth/login/", account).status_code == 200
    assert client.get("/api/v1/preferences/favorites/", **origin).data["count"] == 1
    assert client.get("/api/v1/meal-plans/", **origin).data["count"] == 3
    assert client.get(plan_url, **origin).data["slots"][0]["servings"] == 4
    assert client.get(shopping_url, **origin).data["items"][0]["quantity"] == "400.000"

    assert unsafe("put", favorite_url, {"is_favorite": False}).status_code == 200
    assert client.get("/api/v1/preferences/favorites/", **origin).data["count"] == 0
    assert client.get("/api/v1/preferences/feed/", **origin).data["count"] == 0
    assert unsafe("put", slot_url, {"recipe_id": recipe.id, "servings": 2}).status_code == 200
    assert client.get(shopping_url, **origin).data["items"][0]["quantity"] == "200.000"
    assert unsafe("delete", slot_url).status_code == 204
    assert client.get(shopping_url, **origin).data["items"] == []
    assert unsafe("delete", plan_url).status_code == 204
    assert first_browser.get(plan_url, **origin).status_code == 404
    assert unsafe("post", "/api/v1/auth/logout/").status_code == 204
    assert client.get("/api/v1/auth/session/", **origin).data["authenticated"] is False
    assert client.get("/api/v1/preferences/favorites/", **origin).status_code == 403
    assert client.get("/api/v1/meal-plans/", **origin).status_code == 403
    assert client.get(shopping_url, **origin).status_code == 403
    assert client.get(f"{export_url}&file_type=csv", **origin).status_code == 403
