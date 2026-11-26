from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.catalog.models import Recipe, RecipeIngredient


@pytest.mark.django_db
def test_demo_seed_is_explicit_and_preserves_existing_edits(monkeypatch):
    monkeypatch.delenv("FOODTINDER_DEMO", raising=False)
    with pytest.raises(CommandError, match="isolated demo"):
        call_command("seed_demo")
    monkeypatch.setenv("FOODTINDER_DEMO", "1")
    call_command("seed_demo", stdout=StringIO())

    assert Recipe.objects.filter(is_active=True).count() == 24
    assert not Recipe.objects.filter(ingredient_lines__isnull=True).exists()
    assert {
        meal for meals in Recipe.objects.values_list("meal_types", flat=True) for meal in meals
    } == {
        "breakfast",
        "lunch",
        "snack",
        "dinner",
    }
    recipe = Recipe.objects.get(slug="demo-cheese-omelette")
    recipe.title = "Мой омлет"
    recipe.save()
    lines = RecipeIngredient.objects.count()
    call_command("seed_demo", stdout=StringIO())
    assert Recipe.objects.count() == 24
    assert RecipeIngredient.objects.count() == lines
    recipe.refresh_from_db()
    assert recipe.title == "Мой омлет"
