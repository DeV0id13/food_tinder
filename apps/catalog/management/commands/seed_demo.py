import json
import os
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient

MANIFEST = Path(__file__).with_name("demo_catalog.json")


class Command(BaseCommand):
    help = "Add the sample recipes to an explicitly enabled demo database."

    @transaction.atomic
    def handle(self, *args: Any, **options: Any) -> None:
        if os.environ.get("FOODTINDER_DEMO") != "1":
            raise CommandError("Use make demo to seed the isolated demo database.")

        catalog = json.loads(MANIFEST.read_text(encoding="utf-8"))
        ingredients = {
            key: Ingredient.objects.get_or_create(
                slug=f"demo-{key}", defaults={"name": name, "unit": unit}
            )[0]
            for key, name, unit in catalog["ingredients"]
        }

        created_count = 0
        for slug, title, meals, minutes, lines, steps in catalog["recipes"]:
            recipe, created = Recipe.objects.get_or_create(
                slug=f"demo-{slug}",
                defaults={
                    "title": title,
                    "description": steps[0],
                    "meal_types": meals,
                    "cooking_time_minutes": minutes,
                    "base_servings": 2,
                    "difficulty": 1 if minutes <= 20 else 2,
                    "steps": steps,
                    "is_active": True,
                },
            )
            if created:
                for key, quantity in lines:
                    RecipeIngredient.objects.create(
                        recipe=recipe, ingredient=ingredients[key], quantity=quantity
                    )
                created_count += 1

        self.stdout.write(f"Created {created_count} demo recipes.")
