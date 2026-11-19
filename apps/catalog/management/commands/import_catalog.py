import json
from collections import Counter
from contextlib import suppress
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient
from apps.catalog.validators import validate_recipe_photo

FIELDS = (
    "title",
    "description",
    "cooking_time_minutes",
    "difficulty",
    "base_servings",
    "meal_types",
    "steps",
    "is_active",
)


def read_manifest(path):
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CommandError(f"Cannot read catalog manifest: {exc}") from exc
    if not isinstance(entries, list) or not entries:
        raise CommandError("Expected a nonempty JSON list of recipes.")
    return entries


def check_photo(photo, directory):
    for key in ("source", "license"):
        url = urlsplit(photo[key])
        if url.scheme != "https" or not url.hostname:
            raise ValueError(f"Photo {key} must be an HTTPS URL.")
    if not photo["author"].strip():
        raise ValueError("Photo author is required.")
    relative = Path(photo["file"])
    path = (directory / relative).resolve()
    if relative.is_absolute() or not path.is_relative_to(directory):
        raise ValueError("Photo must be inside the media directory.")
    with path.open("rb") as source:
        validate_recipe_photo(File(source, name=path.name))
    return path


def prepare_ingredients(entries):
    result = {}
    quantity_field = RecipeIngredient._meta.get_field("quantity")
    for line in entries:
        slug = line["slug"]
        if slug in result:
            raise ValueError(f"Repeated ingredient: {slug}")
        ingredient = Ingredient.objects.filter(slug=slug).first()
        if ingredient is None:
            ingredient = Ingredient(slug=slug, name=line["name"], unit=line["unit"])
            ingredient.full_clean()
        if ingredient.unit != line["unit"]:
            raise ValueError(f"Unit differs from the existing ingredient: {slug}")
        quantity = quantity_field.clean(line["quantity"], None)
        if ingredient.unit == Ingredient.Unit.PIECE and quantity != quantity.to_integral_value():
            raise ValueError(f"Piece quantities must be whole numbers: {slug}")
        result[slug] = (ingredient, quantity)
    return result.values()


def import_recipe(entry, directory, *, dry_run):
    slug = entry["slug"]
    fields = {name: entry[name] for name in FIELDS}
    new_photo = None
    try:
        with transaction.atomic():
            recipe = Recipe.objects.select_for_update().filter(slug=slug).first()
            if recipe is None and Recipe.objects.filter(title__iexact=fields["title"]).exists():
                return "skipped", "skipped", "existing title"

            existing = recipe is not None
            if not existing:
                recipe = Recipe(slug=slug, **fields)
            assert recipe is not None
            if existing and recipe.title != fields["title"]:
                return "skipped", "skipped", "existing title has been edited"

            update = existing and entry.get("previous") == {
                "description": recipe.description,
                "steps": recipe.steps,
                "cooking_time_minutes": recipe.cooking_time_minutes,
            }
            content = None
            if not existing:
                content = list(prepare_ingredients(entry["ingredients"]))
                if recipe.is_active and not content:
                    raise ValueError("An active recipe needs ingredients.")
            if update:
                recipe.description = fields["description"]
                recipe.steps = fields["steps"]
                recipe.cooking_time_minutes = fields["cooking_time_minutes"]
            recipe.full_clean()

            path = None
            photo_status = "skipped"
            photo_name = recipe.photo.name
            missing_photo = photo_name and not recipe.photo.storage.exists(photo_name)
            if missing_photo:
                if not entry.get("photo"):
                    raise ValueError("Existing photo is missing from storage.")
                recipe.photo = ""
            if (missing_photo or not photo_name and not recipe.image_url) and entry.get("photo"):
                path = check_photo(entry["photo"], directory)
                photo_status = "updated" if existing else "created"

            status = "updated" if existing and (update or path) else "skipped"
            if not existing:
                status = "created"
            if dry_run:
                return status, photo_status, ""

            update_fields: list[str] = []
            if update:
                update_fields.extend(("description", "steps", "cooking_time_minutes"))
            if path:
                with path.open("rb") as source:
                    recipe.photo.save(path.name, File(source), save=False)
                new_photo = recipe.photo
                if not new_photo.name or not new_photo.storage.exists(new_photo.name):
                    raise OSError("Photo was not written to storage.")
                update_fields.append("photo")
            if not existing or update_fields:
                recipe.save(update_fields=update_fields if existing else None)
            if content:
                for ingredient, quantity in content:
                    if ingredient.pk is None:
                        ingredient.save()
                    RecipeIngredient.objects.create(
                        recipe=recipe, ingredient=ingredient, quantity=quantity
                    )
            return status, photo_status, ""
    except Exception:
        if new_photo is not None and new_photo.name:
            with suppress(OSError):
                new_photo.storage.delete(new_photo.name)
        raise


class Command(BaseCommand):
    help = "Import reviewed recipes and local photographs without overwriting edited records."

    def add_arguments(self, parser):
        parser.add_argument("--manifest", required=True, type=Path)
        parser.add_argument("--media-dir", required=True, type=Path)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        entries = read_manifest(options["manifest"])
        directory = options["media_dir"].resolve()
        if not directory.is_dir():
            raise CommandError("Media directory does not exist.")
        recipes: Counter[str] = Counter()
        photos: Counter[str] = Counter()
        seen = set()
        for entry in entries:
            label = entry.get("slug", "(missing slug)") if isinstance(entry, dict) else "(entry)"
            try:
                if not isinstance(entry, dict) or not isinstance(label, str) or label in seen:
                    raise ValueError("Recipe entries need unique slugs.")
                seen.add(label)
                status, photo, reason = import_recipe(entry, directory, dry_run=options["dry_run"])
            except (
                ValidationError,
                IntegrityError,
                OSError,
                KeyError,
                TypeError,
                ValueError,
            ) as exc:
                status = "rejected"
                photo = "rejected" if isinstance(entry, dict) and entry.get("photo") else "skipped"
                self.stderr.write(f"{label}: {exc}")
                reason = ""
            recipes[status] += 1
            photos[photo] += 1
            if reason:
                self.stdout.write(f"{label}: {reason}")
        for label, counts in (("Recipes", recipes), ("Photos", photos)):
            summary = ", ".join(
                f"{key}={counts[key]}" for key in ("created", "updated", "skipped", "rejected")
            )
            prefix = "Dry run. " if options["dry_run"] else ""
            self.stdout.write(f"{prefix}{label}: {summary}")
        if recipes["rejected"]:
            raise CommandError("Some recipes were rejected. Fix those entries and run again.")
