from collections import Counter
from decimal import Decimal
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient

pytestmark = pytest.mark.django_db


def seed():
    call_command("seed_demo_recipes", stdout=StringIO())


def test_seed_creates_valid_recipes_across_all_meals_and_shared_ingredients():
    seed()
    recipes = list(
        Recipe.objects.filter(slug__startswith="demo-").prefetch_related("ingredient_lines")
    )
    assert len(recipes) >= 12
    assert all(recipe.is_active and recipe.ingredient_lines.exists() for recipe in recipes)
    for recipe in recipes:
        recipe.full_clean()
        assert recipe.meal_types and recipe.steps
    assert set().union(*(set(recipe.meal_types) for recipe in recipes)) == {
        "breakfast",
        "lunch",
        "snack",
        "dinner",
    }
    usage = Counter(
        RecipeIngredient.objects.filter(recipe__in=recipes).values_list("ingredient_id", flat=True)
    )
    assert sum(count > 1 for count in usage.values()) >= 3
    assert not get_user_model().objects.exists()


def test_control_recipes_have_exact_shared_rice_quantities():
    seed()
    a = Recipe.objects.get(slug="demo-rice-chicken")
    b = Recipe.objects.get(slug="demo-rice-milk")
    assert a.is_active and b.is_active
    assert a.base_servings == b.base_servings == 2
    assert {"lunch", "dinner"} <= set(a.meal_types)
    assert {"lunch", "dinner"} <= set(b.meal_types)

    def lines(recipe):
        return {
            (line.ingredient.slug, line.ingredient.unit): line.quantity
            for line in recipe.ingredient_lines.select_related("ingredient")
        }

    assert lines(a) == {("rice", "g"): Decimal("200.000"), ("chicken", "g"): Decimal("300.000")}
    assert lines(b) == {("rice", "g"): Decimal("100.000"), ("milk", "ml"): Decimal("200.000")}
    assert (
        a.ingredient_lines.get(ingredient__slug="rice").ingredient_id
        == b.ingredient_lines.get(ingredient__slug="rice").ingredient_id
    )


def test_second_seed_does_not_duplicate_or_overwrite_existing_records():
    seed()
    recipe = Recipe.objects.get(slug="demo-rice-chicken")
    rice = Ingredient.objects.get(slug="rice")
    Recipe.objects.filter(pk=recipe.pk).update(title="Ручное название")
    Ingredient.objects.filter(pk=rice.pk).update(name="Ручное название риса")
    before = (Recipe.objects.count(), Ingredient.objects.count(), RecipeIngredient.objects.count())
    seed()
    assert (
        Recipe.objects.count(),
        Ingredient.objects.count(),
        RecipeIngredient.objects.count(),
    ) == before
    recipe.refresh_from_db()
    rice.refresh_from_db()
    assert recipe.title == "Ручное название"
    assert rice.name == "Ручное название риса"
    assert recipe.ingredient_lines.count() == 2
    assert not get_user_model().objects.exists()
