from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

MEAL_TYPES = ("breakfast", "lunch", "snack", "dinner")
MEAL_CHOICES = [(meal, meal) for meal in MEAL_TYPES]
ALLOWED_DURATIONS = (1, 3, 7)


def validate_enabled_meals(value):
    if not isinstance(value, list) or not value:
        raise ValidationError("Enabled meals must be a nonempty array.")
    if any(not isinstance(item, str) or item not in MEAL_TYPES for item in value):
        raise ValidationError("Enabled meals contain an unsupported value.")
    if len(value) != len(set(value)):
        raise ValidationError("Enabled meals must not repeat.")


class MealPlan(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="meal_plans",
    )
    start_date = models.DateField()
    duration_days = models.PositiveSmallIntegerField()
    enabled_meals = models.JSONField(validators=[validate_enabled_meals])

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(duration_days__in=list(ALLOWED_DURATIONS)),
                name="planning_duration_in_1_3_7",
            ),
        ]

    def __str__(self):
        return f"MealPlan #{self.pk} ({self.start_date}, {self.duration_days}d)"


class MealPlanSlot(models.Model):
    plan = models.ForeignKey(MealPlan, on_delete=models.CASCADE, related_name="slots")
    day_index = models.PositiveSmallIntegerField()
    meal_type = models.CharField(max_length=16, choices=MEAL_CHOICES)
    recipe = models.ForeignKey(
        "catalog.Recipe",
        on_delete=models.PROTECT,
        related_name="plan_slots",
    )
    servings = models.PositiveSmallIntegerField()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(day_index__gte=0, day_index__lte=6),
                name="planning_day_index_0_6",
            ),
            models.CheckConstraint(
                condition=Q(servings__gte=1, servings__lte=20),
                name="planning_servings_1_20",
            ),
            models.CheckConstraint(
                condition=Q(meal_type__in=list(MEAL_TYPES)),
                name="planning_slot_valid_meal_type",
            ),
            models.UniqueConstraint(
                fields=("plan", "day_index", "meal_type"),
                name="planning_unique_slot",
            ),
        ]

    def __str__(self):
        return f"{self.plan_id}:{self.day_index}:{self.meal_type}"
