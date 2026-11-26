from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient
from apps.preferences.models import UserRecipeState

pytestmark = pytest.mark.django_db

SUMMARY_FIELDS = {
    "id",
    "title",
    "image_url",
    "cooking_time_minutes",
    "difficulty",
    "base_servings",
    "meal_types",
    "kcal_per_serving",
    "protein_g_per_serving",
    "fat_g_per_serving",
    "carbs_g_per_serving",
    "estimated_price_rub_per_serving",
}


@pytest.fixture(autouse=True)
def catalog_urls(settings):
    settings.ROOT_URLCONF = "tests.catalog.urls"


def create_recipe(slug, *, active=True, **fields):
    defaults = dict(
        slug=slug,
        title=slug,
        description="Описание",
        image_url="",
        cooking_time_minutes=15,
        difficulty=1,
        base_servings=2,
        meal_types=["lunch"],
        steps=["Приготовьте блюдо."],
        is_active=active,
    )
    return Recipe.objects.create(**(defaults | fields))


def test_guest_list_has_only_active_recipes_in_id_order(client):
    first = create_recipe("first")
    inactive = create_recipe("inactive", active=False)
    second = create_recipe("second")
    response = client.get("/api/v1/recipes/")
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {"count", "next", "previous", "results"}
    assert data["count"] == 2
    assert data["next"] is None and data["previous"] is None
    assert [row["id"] for row in data["results"]] == [first.pk, second.pk]
    assert inactive.pk not in [row["id"] for row in data["results"]]


def test_authenticated_user_can_read_catalog(client):
    get_user_model().objects.create_user("reader@example.com", "Foundation_123")
    assert client.login(email="reader@example.com", password="Foundation_123")
    create_recipe("visible")
    assert client.get("/api/v1/recipes/").status_code == 200


def test_list_summary_exact_fields_and_decimal_strings(client, recipe_line):
    response = client.get("/api/v1/recipes/")
    assert response.status_code == 200
    result = response.json()["results"][0]
    assert set(result) == SUMMARY_FIELDS
    assert result["base_servings"] == recipe_line.recipe.base_servings
    assert result["kcal_per_serving"] == "100.00"
    for field in (
        "protein_g_per_serving",
        "fat_g_per_serving",
        "carbs_g_per_serving",
        "estimated_price_rub_per_serving",
    ):
        assert result[field] is None
    assert "slug" not in result and "is_active" not in result


def test_guest_detail_contains_exact_fields_and_ingredient_quantities(client, recipe_line):
    recipe = recipe_line.recipe
    response = client.get(f"/api/v1/recipes/{recipe.pk}/")
    assert response.status_code == 200
    data = response.json()
    assert set(data) == SUMMARY_FIELDS | {"description", "steps", "ingredients"}
    assert data["description"] == recipe.description
    assert data["steps"] == recipe.steps
    assert data["base_servings"] == 2
    assert data["ingredients"] == [
        {
            "ingredient_id": recipe_line.ingredient.pk,
            "name": "Рис",
            "unit": "g",
            "quantity": "200.000",
        }
    ]
    assert "slug" not in data and "is_active" not in data


def test_detail_hides_inactive_and_missing_recipes(client):
    inactive = create_recipe("inactive", active=False)
    assert client.get(f"/api/v1/recipes/{inactive.pk}/").status_code == 404
    assert client.get(f"/api/v1/recipes/{inactive.pk + 1000}/").status_code == 404


def test_default_limit_is_30_and_offset_works(client):
    Recipe.objects.bulk_create(
        [
            Recipe(
                slug=f"recipe-{index}",
                title=f"Recipe {index}",
                description="Описание",
                cooking_time_minutes=10,
                difficulty=2,
                base_servings=2,
                meal_types=["lunch"],
                steps=["Cook."],
                is_active=True,
            )
            for index in range(35)
        ]
    )
    first = client.get("/api/v1/recipes/").json()
    assert first["count"] == 35
    assert len(first["results"]) == 30
    assert first["previous"] is None
    assert "offset=30" in first["next"]
    second = client.get("/api/v1/recipes/?offset=30").json()
    assert len(second["results"]) == 5
    assert second["next"] is None
    assert second["previous"] is not None
    assert second["results"][0]["id"] > first["results"][-1]["id"]


def test_requested_limit_is_capped_at_100(client):
    Recipe.objects.bulk_create(
        [
            Recipe(
                slug=f"bulk-{index}",
                title="Recipe",
                description="Описание",
                cooking_time_minutes=10,
                difficulty=2,
                base_servings=2,
                meal_types=["lunch"],
                steps=["Cook."],
                is_active=True,
            )
            for index in range(105)
        ]
    )
    data = client.get("/api/v1/recipes/?limit=500").json()
    assert data["count"] == 105
    assert len(data["results"]) == 100
    assert data["next"] is not None


def test_detail_prefetches_multiple_ingredients(client, recipe, ingredient):
    milk = Ingredient.objects.create(slug="milk", name="Молоко", unit="ml")
    RecipeIngredient.objects.create(
        recipe=recipe, ingredient=ingredient, quantity=Decimal("100.000")
    )
    RecipeIngredient.objects.create(recipe=recipe, ingredient=milk, quantity=Decimal("50.000"))
    response = client.get(f"/api/v1/recipes/{recipe.pk}/")
    assert {item["ingredient_id"] for item in response.json()["ingredients"]} == {
        ingredient.pk,
        milk.pk,
    }


def test_catalog_has_no_write_methods(client, recipe_line):
    assert client.post("/api/v1/recipes/", data={}).status_code == 405
    assert client.patch(f"/api/v1/recipes/{recipe_line.recipe.pk}/", data={}).status_code == 405
    assert client.delete(f"/api/v1/recipes/{recipe_line.recipe.pk}/").status_code == 405


def test_catalog_search_meal_and_inclusive_time_work_individually_and_together(client):
    first = create_recipe("first", title="Ёжики", meal_types=["lunch", "dinner"])
    long = create_recipe("long", title="Гречневые ёжики", cooking_time_minutes=16)
    dinner = create_recipe("dinner", title="Ёжики", meal_types=["dinner"])
    unmatched = create_recipe("unmatched", title="Борщ")
    create_recipe("hidden", active=False, title="Ёжики")

    def ids(**params):
        page = client.get("/api/v1/recipes/", params).json()
        assert page["count"] == len(page["results"])
        return [row["id"] for row in page["results"]]

    assert ids(q="  ЕЖИКИ ") == [first.pk, long.pk, dinner.pk]
    assert ids(meal="dinner") == [first.pk, dinner.pk]
    assert ids(max_time=15) == [first.pk, dinner.pk, unmatched.pk]
    assert ids(q="ежики", meal="lunch", max_time=15) == [first.pk]
    assert ids(q="%") == []


def test_favorites_filter_is_private_and_works_with_other_filters(client):
    user = get_user_model().objects.create_user("owner@example.test")
    other = get_user_model().objects.create_user("other@example.test")
    matching = create_recipe("matching", title="Суп")
    unrelated = create_recipe("unrelated", title="Суп")
    inactive = create_recipe("inactive", active=False, title="Суп")
    excluded = create_recipe("excluded", title="Каша", meal_types=["breakfast"])
    for recipe in (matching, inactive, excluded):
        UserRecipeState.objects.create(user=user, recipe=recipe, is_favorite=True)
    UserRecipeState.objects.create(user=other, recipe=unrelated, is_favorite=True)
    url = "/api/v1/recipes/?q=суп&meal=lunch&favorites=1"

    assert client.get(url).json() == {"count": 0, "next": None, "previous": None, "results": []}
    client.force_login(user)
    assert [row["id"] for row in client.get(url).json()["results"]] == [matching.pk]
    assert client.get("/api/v1/recipes/?favorites=0").json()["count"] == 3


@pytest.mark.parametrize("sort", ["time", "title", "id"])
def test_catalog_sort_and_tie_breaker_are_stable_across_pages(client, sort):
    first = create_recipe("first", title="Bravo")
    tied = create_recipe("tied", title="BRAVO")
    earlier = create_recipe("earlier", title="Alpha", cooking_time_minutes=10)
    expected = [first.pk, tied.pk, earlier.pk] if sort == "id" else [earlier.pk, first.pk, tied.pk]
    observed = []
    url = f"/api/v1/recipes/?sort={sort}&limit=1"
    for _ in expected:
        page = client.get(url).json()
        assert page["count"] == 3
        observed.append(page["results"][0]["id"])
        url = page["next"]
    assert url is None
    assert observed == expected
    page = client.get("/api/v1/recipes/?offset=2147483647").json()
    assert page["count"] == 3 and page["results"] == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("meal", "Lunch"),
        ("max_time", "0"),
        ("favorites", "true"),
        ("sort", "bogus"),
        ("limit", "0"),
        ("limit", "1.0"),
        ("limit", "2147483648"),
        ("offset", "-1"),
        ("offset", ""),
        ("q", "а" * 201),
    ],
)
def test_catalog_invalid_query_returns_400(client, field, value):
    response = client.get("/api/v1/recipes/", {field: value})
    assert response.status_code == 400
    assert field in response.json()
