from decimal import Decimal
from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient


@pytest.fixture
def ingredient():
    return Ingredient.objects.create(slug="rice", name="Рис", unit=Ingredient.Unit.GRAM)


@pytest.fixture
def recipe():
    return Recipe.objects.create(
        slug="rice-dish",
        title="Рисовое блюдо",
        description="Описание блюда",
        image_url="",
        cooking_time_minutes=20,
        difficulty=2,
        base_servings=2,
        meal_types=["lunch", "dinner"],
        steps=["Промойте рис.", "Сварите рис."],
        is_active=True,
        kcal_per_serving=Decimal("100.00"),
    )


@pytest.fixture
def recipe_line(recipe, ingredient):
    return RecipeIngredient.objects.create(
        recipe=recipe, ingredient=ingredient, quantity=Decimal("200.000")
    )


@pytest.fixture
def recipe_media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    return settings.MEDIA_ROOT


@pytest.fixture
def photo_upload():
    def make(filename="recipe.png", image_format="PNG"):
        content = BytesIO()
        with Image.new("RGB", (16, 12), "olive") as image:
            image.save(content, format=image_format)
        return SimpleUploadedFile(filename, content.getvalue())

    return make
