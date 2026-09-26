from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient

INGREDIENTS = (
    ("rice", "Рис", "g"),
    ("chicken", "Курица", "g"),
    ("milk", "Молоко", "ml"),
    ("oats", "Овсяные хлопья", "g"),
    ("banana", "Банан", "pcs"),
    ("egg", "Яйцо", "pcs"),
    ("cheese", "Сыр", "g"),
    ("tomato", "Помидор", "g"),
    ("pasta", "Макароны", "g"),
    ("carrot", "Морковь", "g"),
    ("potato", "Картофель", "g"),
    ("yogurt", "Йогурт", "g"),
    ("apple", "Яблоко", "pcs"),
    ("bread", "Хлеб", "g"),
    ("fish", "Рыба", "g"),
    ("cucumber", "Огурец", "g"),
)

# Each quantity is for the full recipe, not one serving.
RECIPES = (
    (
        "demo-rice-chicken",
        "Рис с курицей",
        ("lunch", "dinner"),
        ("Отварите рис до готовности.", "Приготовьте курицу и подайте с рисом."),
        (("rice", "200.000"), ("chicken", "300.000")),
    ),
    (
        "demo-rice-milk",
        "Молочная рисовая каша",
        ("lunch", "dinner"),
        ("Промойте рис.", "Варите рис в молоке до мягкости."),
        (("rice", "100.000"), ("milk", "200.000")),
    ),
    (
        "demo-oatmeal-banana",
        "Овсянка с бананом",
        ("breakfast",),
        ("Сварите овсяные хлопья в молоке.", "Добавьте нарезанный банан."),
        (("oats", "120.000"), ("milk", "300.000"), ("banana", "1.000")),
    ),
    (
        "demo-cheese-omelet",
        "Омлет с сыром",
        ("breakfast",),
        ("Взбейте яйца с молоком.", "Приготовьте омлет и добавьте сыр."),
        (("egg", "4.000"), ("milk", "100.000"), ("cheese", "60.000")),
    ),
    (
        "demo-tomato-pasta",
        "Паста с помидорами",
        ("lunch", "dinner"),
        ("Отварите макароны.", "Потушите помидоры и смешайте с пастой и сыром."),
        (("pasta", "200.000"), ("tomato", "200.000"), ("cheese", "40.000")),
    ),
    (
        "demo-chicken-soup",
        "Куриный суп",
        ("lunch",),
        ("Нарежьте курицу и овощи.", "Варите ингредиенты до готовности."),
        (("chicken", "250.000"), ("carrot", "100.000"), ("potato", "200.000")),
    ),
    (
        "demo-yogurt-apple",
        "Йогурт с яблоком",
        ("snack", "breakfast"),
        ("Нарежьте яблоко.", "Добавьте его в йогурт."),
        (("yogurt", "300.000"), ("apple", "1.000")),
    ),
    (
        "demo-egg-sandwich",
        "Сэндвич с яйцом",
        ("breakfast", "snack"),
        ("Приготовьте яйца.", "Соберите сэндвич из хлеба, яиц и сыра."),
        (("egg", "2.000"), ("bread", "120.000"), ("cheese", "40.000")),
    ),
    (
        "demo-fish-potato",
        "Рыба с картофелем",
        ("lunch", "dinner"),
        ("Нарежьте картофель.", "Запеките рыбу вместе с картофелем."),
        (("fish", "300.000"), ("potato", "300.000")),
    ),
    (
        "demo-vegetable-rice",
        "Рис с овощами",
        ("lunch", "dinner"),
        ("Отварите рис.", "Потушите овощи и смешайте с рисом."),
        (("rice", "180.000"), ("carrot", "100.000"), ("tomato", "150.000")),
    ),
    (
        "demo-banana-smoothie",
        "Банановый смузи",
        ("snack",),
        ("Очистите банан.", "Взбейте банан, молоко и йогурт."),
        (("banana", "2.000"), ("milk", "200.000"), ("yogurt", "100.000")),
    ),
    (
        "demo-chicken-salad",
        "Салат с курицей",
        ("lunch", "dinner"),
        ("Приготовьте курицу.", "Нарежьте овощи и смешайте с курицей."),
        (("chicken", "250.000"), ("tomato", "150.000"), ("cucumber", "150.000")),
    ),
)


class Command(BaseCommand):
    help = "Create demonstration ingredients and recipes without changing existing records."

    @transaction.atomic
    def handle(self, *args, **options):
        ingredients = {}
        for slug, name, unit in INGREDIENTS:
            ingredient, _ = Ingredient.objects.get_or_create(
                slug=slug, defaults={"name": name, "unit": unit}
            )
            if ingredient.unit != unit:
                raise CommandError(f"Ingredient {slug!r} has a different canonical unit.")
            ingredients[slug] = ingredient

        created_count = 0
        for slug, title, meal_types, steps, lines in RECIPES:
            recipe, created = Recipe.objects.get_or_create(
                slug=slug,
                defaults={
                    "title": title,
                    "description": f"Демонстрационный рецепт: {title.lower()}.",
                    "image_url": "",
                    "cooking_time_minutes": 20,
                    "difficulty": 2,
                    "base_servings": 2,
                    "meal_types": list(meal_types),
                    "steps": list(steps),
                    "is_active": True,
                },
            )
            if not created:
                continue
            for ingredient_slug, quantity in lines:
                RecipeIngredient.objects.create(
                    recipe=recipe,
                    ingredient=ingredients[ingredient_slug],
                    quantity=Decimal(quantity),
                )
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f"Created {created_count} demo recipes."))
