import json
from collections import Counter
from io import StringIO
from pathlib import Path
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient

pytestmark = pytest.mark.django_db
MANIFEST = Path(__file__).resolve().parents[2] / "docs/catalog/recipes.json"


def run_import(tmp_path, records, *, dry_run=False):
    manifest = tmp_path / "recipes.json"
    manifest.write_text(json.dumps(records), encoding="utf-8")
    output = StringIO()
    call_command(
        "import_catalog",
        manifest=manifest,
        media_dir=tmp_path,
        dry_run=dry_run,
        stdout=output,
        stderr=StringIO(),
    )
    return output.getvalue()


def test_catalog_manifest_imports_all_meals_and_shares_ingredients(tmp_path):
    records = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for entry in records:
        entry.pop("photo", None)
    assert "created=62" in run_import(tmp_path, records, dry_run=True)
    assert not Recipe.objects.exists()
    assert not Ingredient.objects.exists()
    assert "created=62" in run_import(tmp_path, records)
    recipes = list(Recipe.objects.prefetch_related("ingredient_lines"))
    assert len(recipes) == 62
    assert all(recipe.is_active and recipe.ingredient_lines.exists() for recipe in recipes)
    assert set().union(*(set(recipe.meal_types) for recipe in recipes)) == {
        "breakfast",
        "lunch",
        "snack",
        "dinner",
    }
    usage = Counter(RecipeIngredient.objects.values_list("ingredient_id", flat=True))
    assert sum(count > 1 for count in usage.values()) >= 3
    assert all(recipe.kcal_per_serving is None for recipe in recipes)
    assert not get_user_model().objects.exists()


def test_import_preserves_existing_pk_composition_and_edits(tmp_path):
    records = json.loads(MANIFEST.read_text(encoding="utf-8"))[:2]
    for entry in records:
        entry.pop("photo", None)
    run_import(tmp_path, records)
    recipe = Recipe.objects.get(slug=records[0]["slug"])
    rice = Ingredient.objects.get(slug="rice")
    lines = list(recipe.ingredient_lines.values_list("pk", "ingredient_id", "quantity"))
    assert any(ingredient_id == rice.pk for _, ingredient_id, _ in lines)
    Recipe.objects.filter(pk=recipe.pk).update(description="Редакционная правка")
    assert "skipped=2" in run_import(tmp_path, records)
    recipe.refresh_from_db()
    assert recipe.description == "Редакционная правка"
    assert list(recipe.ingredient_lines.values_list("pk", "ingredient_id", "quantity")) == lines


def test_import_can_resume_after_invalid_photo(tmp_path, recipe_media, photo_upload):
    records = json.loads(MANIFEST.read_text(encoding="utf-8"))[:2]
    for path, entry in zip(("good.webp", "bad.webp"), records, strict=True):
        entry["photo"] = {**entry["photo"], "file": path}
    (tmp_path / "good.webp").write_bytes(photo_upload("good.webp", "WEBP").read())
    (tmp_path / "bad.webp").write_bytes(b"This is not WebP")
    with pytest.raises(CommandError, match="Some recipes were rejected"):
        run_import(tmp_path, records)
    first = Recipe.objects.get(slug=records[0]["slug"])
    assert first.photo and (recipe_media / first.photo.name).is_file()
    assert not Recipe.objects.filter(slug=records[1]["slug"]).exists()
    assert len(list(recipe_media.glob("recipes/*"))) == 1

    (tmp_path / "bad.webp").write_bytes(photo_upload("bad.webp", "WEBP").read())
    assert "created=1, updated=0, skipped=1, rejected=0" in run_import(tmp_path, records)
    assert Recipe.objects.get(pk=first.pk).photo.name == first.photo.name
    assert len(list(recipe_media.glob("recipes/*"))) == 2


def test_import_rejects_unsafe_photo_path_without_creating_records(tmp_path):
    record = json.loads(MANIFEST.read_text(encoding="utf-8"))[0]
    record["photo"]["file"] = f"../{uuid4()}.webp"
    with pytest.raises(CommandError, match="Some recipes were rejected"):
        run_import(tmp_path, [record])
    assert not Recipe.objects.exists()
    assert not Ingredient.objects.exists()
