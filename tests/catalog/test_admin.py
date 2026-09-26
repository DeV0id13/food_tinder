import pytest
from django.urls import reverse

from apps.catalog.models import Recipe, RecipeIngredient

pytestmark = pytest.mark.django_db


def recipe_form_data(*, active=False, ingredient=None, quantity="200.000"):
    data = {
        "slug": "admin-recipe",
        "title": "Рецепт из админки",
        "description": "Описание",
        "image_url": "",
        "cooking_time_minutes": "20",
        "difficulty": "2",
        "base_servings": "2",
        "meal_types": '["lunch", "dinner"]',
        "steps": '["Подготовьте продукты.", "Приготовьте блюдо."]',
        "ingredient_lines-TOTAL_FORMS": "1",
        "ingredient_lines-INITIAL_FORMS": "0",
        "ingredient_lines-MIN_NUM_FORMS": "0",
        "ingredient_lines-MAX_NUM_FORMS": "1000",
        "_save": "Save",
    }
    if active:
        data["is_active"] = "on"
    if ingredient:
        data["ingredient_lines-0-ingredient"] = str(ingredient.pk)
        data["ingredient_lines-0-quantity"] = quantity
    return data


def test_inactive_recipe_can_be_created_without_lines(admin_client):
    response = admin_client.post(reverse("admin:catalog_recipe_add"), recipe_form_data())
    assert response.status_code == 302
    recipe = Recipe.objects.get(slug="admin-recipe")
    assert not recipe.is_active
    assert not recipe.ingredient_lines.exists()


def test_active_recipe_without_lines_is_rejected(admin_client):
    response = admin_client.post(reverse("admin:catalog_recipe_add"), recipe_form_data(active=True))
    assert response.status_code == 200
    assert "at least one ingredient line" in response.content.decode()
    assert not Recipe.objects.filter(slug="admin-recipe").exists()


def test_active_recipe_with_first_inline_is_saved(admin_client, ingredient):
    response = admin_client.post(
        reverse("admin:catalog_recipe_add"), recipe_form_data(active=True, ingredient=ingredient)
    )
    assert response.status_code == 302
    recipe = Recipe.objects.get(slug="admin-recipe", is_active=True)
    assert recipe.ingredient_lines.count() == 1
    assert recipe.ingredient_lines.get().ingredient == ingredient


@pytest.mark.parametrize("quantity", ["0.000", "-1.000"])
def test_invalid_inline_quantity_is_rejected(admin_client, ingredient, quantity):
    response = admin_client.post(
        reverse("admin:catalog_recipe_add"),
        recipe_form_data(active=True, ingredient=ingredient, quantity=quantity),
    )
    assert response.status_code == 200
    assert not Recipe.objects.filter(slug="admin-recipe").exists()
    assert not RecipeIngredient.objects.exists()


def test_admin_rejects_fractional_piece_quantity(admin_client):
    from apps.catalog.models import Ingredient

    egg = Ingredient.objects.create(slug="egg", name="Яйцо", unit=Ingredient.Unit.PIECE)
    data = recipe_form_data(active=True, ingredient=egg, quantity="1.500")
    data["slug"] = "admin-recipe"
    response = admin_client.post(reverse("admin:catalog_recipe_add"), data)
    assert response.status_code == 200
    assert not Recipe.objects.filter(slug="admin-recipe").exists()


def test_admin_rejects_used_ingredient_unit_change(admin_client, recipe_line):
    ingredient = recipe_line.ingredient
    response = admin_client.post(
        reverse("admin:catalog_ingredient_change", args=[ingredient.pk]),
        {"slug": ingredient.slug, "name": ingredient.name, "unit": "ml", "_save": "Save"},
    )
    assert response.status_code == 200
    assert "unit" in response.context["adminform"].form.errors
    ingredient.refresh_from_db()
    assert ingredient.unit == "g"


def test_admin_rejects_removing_last_line_from_active_recipe(admin_client, recipe_line):
    recipe = recipe_line.recipe
    data = recipe_form_data(active=True)
    data["slug"] = recipe.slug
    data["title"] = recipe.title
    data["ingredient_lines-TOTAL_FORMS"] = "2"
    data["ingredient_lines-INITIAL_FORMS"] = "1"
    data["ingredient_lines-0-id"] = str(recipe_line.pk)
    data["ingredient_lines-0-ingredient"] = str(recipe_line.ingredient_id)
    data["ingredient_lines-0-quantity"] = "200.000"
    data["ingredient_lines-0-DELETE"] = "on"
    response = admin_client.post(reverse("admin:catalog_recipe_change", args=[recipe.pk]), data)
    assert response.status_code == 200
    assert "at least one ingredient line" in response.content.decode()
    assert recipe.ingredient_lines.count() == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("meal_types", "[]"),
        ("meal_types", '["lunch", "lunch"]'),
        ("steps", "[]"),
        ("steps", '["Cook", ""]'),
    ],
)
def test_admin_rejects_invalid_json_fields(admin_client, field, value):
    data = recipe_form_data(active=False)
    data[field] = value
    response = admin_client.post(reverse("admin:catalog_recipe_add"), data)
    assert response.status_code == 200
    assert not Recipe.objects.filter(slug="admin-recipe").exists()
