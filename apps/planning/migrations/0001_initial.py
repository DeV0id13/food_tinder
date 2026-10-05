import apps.planning.models
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("catalog", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="MealPlan",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("start_date", models.DateField()),
                ("duration_days", models.PositiveSmallIntegerField()),
                (
                    "enabled_meals",
                    models.JSONField(validators=[apps.planning.models.validate_enabled_meals]),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="meal_plans",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("duration_days__in", [1, 3, 7])),
                        name="planning_duration_in_1_3_7",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="MealPlanSlot",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("day_index", models.PositiveSmallIntegerField()),
                (
                    "meal_type",
                    models.CharField(
                        choices=[
                            ("breakfast", "breakfast"),
                            ("lunch", "lunch"),
                            ("snack", "snack"),
                            ("dinner", "dinner"),
                        ],
                        max_length=16,
                    ),
                ),
                ("servings", models.PositiveSmallIntegerField()),
                (
                    "plan",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="slots",
                        to="planning.mealplan",
                    ),
                ),
                (
                    "recipe",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="plan_slots",
                        to="catalog.recipe",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("day_index__gte", 0), ("day_index__lte", 6)),
                        name="planning_day_index_0_6",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("servings__gte", 1), ("servings__lte", 20)),
                        name="planning_servings_1_20",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("meal_type__in", ["breakfast", "lunch", "snack", "dinner"])
                        ),
                        name="planning_slot_valid_meal_type",
                    ),
                    models.UniqueConstraint(
                        fields=("plan", "day_index", "meal_type"),
                        name="planning_unique_slot",
                    ),
                ],
            },
        ),
    ]
