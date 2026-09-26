from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient

pytestmark = pytest.mark.django_db


def test_ingredient_units_and_unique_slug(ingredient):
    assert set(Ingredient.Unit.values) == {"g", "ml", "pcs"}
    for unit in Ingredient.Unit.values:
        Ingredient(slug=f"product-{unit}", name="Продукт", unit=unit).full_clean()
    with pytest.raises(ValidationError):
        Ingredient(slug="bad", name="Продукт", unit="kg").full_clean()
    with pytest.raises(ValidationError):
        Ingredient.objects.create(slug=ingredient.slug, name="Другой", unit="g")
    with transaction.atomic(), pytest.raises(IntegrityError):
        Ingredient.objects.bulk_create([Ingredient(slug="raw", name="X", unit="kg")])


def test_used_ingredient_unit_is_immutable_and_delete_is_protected(recipe_line):
    ingredient = recipe_line.ingredient
    ingredient.unit = Ingredient.Unit.MILLILITER
    with pytest.raises(ValidationError) as error:
        ingredient.save()
    assert "unit" in error.value.message_dict
    ingredient.refresh_from_db()
    assert ingredient.unit == Ingredient.Unit.GRAM
    with pytest.raises(ProtectedError):
        ingredient.delete()


def test_unused_ingredient_can_change_unit(ingredient):
    ingredient.unit = Ingredient.Unit.MILLILITER
    ingredient.save()
    ingredient.refresh_from_db()
    assert ingredient.unit == Ingredient.Unit.MILLILITER


def test_recipe_delete_cascades_to_ingredient_lines(recipe_line):
    recipe_line.recipe.delete()
    assert not RecipeIngredient.objects.filter(pk=recipe_line.pk).exists()
    assert Ingredient.objects.filter(pk=recipe_line.ingredient_id).exists()


def test_quantity_positive_and_unique_pair(recipe_line):
    other = Ingredient.objects.create(slug="milk", name="Молоко", unit="ml")
    for quantity in (Decimal("0.000"), Decimal("-1.000")):
        with pytest.raises(ValidationError):
            RecipeIngredient(
                recipe=recipe_line.recipe, ingredient=other, quantity=quantity
            ).full_clean()
        with transaction.atomic(), pytest.raises(IntegrityError):
            RecipeIngredient.objects.bulk_create(
                [
                    RecipeIngredient(
                        recipe=recipe_line.recipe,
                        ingredient=other,
                        quantity=quantity,
                    )
                ]
            )
    with pytest.raises(ValidationError):
        RecipeIngredient.objects.create(
            recipe=recipe_line.recipe, ingredient=recipe_line.ingredient, quantity=Decimal("1.000")
        )
    with transaction.atomic(), pytest.raises(IntegrityError):
        RecipeIngredient.objects.bulk_create(
            [
                RecipeIngredient(
                    recipe=recipe_line.recipe,
                    ingredient=recipe_line.ingredient,
                    quantity=Decimal("1.000"),
                )
            ]
        )


def test_piece_quantity_must_be_integral(recipe):
    egg = Ingredient.objects.create(slug="egg", name="Яйцо", unit=Ingredient.Unit.PIECE)
    with pytest.raises(ValidationError) as error:
        RecipeIngredient.objects.create(recipe=recipe, ingredient=egg, quantity=Decimal("1.500"))
    assert "quantity" in error.value.message_dict
    with pytest.raises(ValidationError):
        RecipeIngredient(recipe=recipe, ingredient=egg, quantity="not-a-decimal").full_clean()
    line = RecipeIngredient.objects.create(recipe=recipe, ingredient=egg, quantity=Decimal("2.000"))
    assert line.quantity == Decimal("2.000")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("cooking_time_minutes", 0),
        ("difficulty", 0),
        ("difficulty", 6),
        ("base_servings", 0),
    ],
)
def test_recipe_numeric_bounds(recipe, field, value):
    setattr(recipe, field, value)
    with pytest.raises(ValidationError):
        recipe.save()
    with transaction.atomic(), pytest.raises(IntegrityError):
        Recipe.objects.filter(pk=recipe.pk).update(**{field: value})


@pytest.mark.parametrize(
    "field",
    [
        "kcal_per_serving",
        "protein_g_per_serving",
        "fat_g_per_serving",
        "carbs_g_per_serving",
        "estimated_price_rub_per_serving",
    ],
)
def test_optional_metrics_reject_negative_and_allow_null(recipe, field):
    setattr(recipe, field, Decimal("-0.01"))
    with pytest.raises(ValidationError):
        recipe.save()
    with transaction.atomic(), pytest.raises(IntegrityError):
        Recipe.objects.filter(pk=recipe.pk).update(**{field: Decimal("-0.01")})
    setattr(recipe, field, None)
    recipe.save()
    recipe.refresh_from_db()
    assert getattr(recipe, field) is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("meal_types", []),
        ("meal_types", ["breakfast", "invalid"]),
        ("meal_types", ["lunch", "lunch"]),
        ("meal_types", "lunch"),
        ("steps", []),
        ("steps", ["Cut", ""]),
        ("steps", ["Cut", "  "]),
        ("steps", ["Cut", 12]),
    ],
)
def test_recipe_json_validation(recipe, field, value):
    setattr(recipe, field, value)
    with pytest.raises(ValidationError) as error:
        recipe.save()
    assert field in error.value.message_dict
