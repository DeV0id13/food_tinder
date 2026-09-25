from django.core.exceptions import ValidationError

MEAL_TYPES = ("breakfast", "lunch", "snack", "dinner")


def validate_meal_types(value):
    if not isinstance(value, list) or not value:
        raise ValidationError("Meal types must be a nonempty array.")
    if any(not isinstance(item, str) or item not in MEAL_TYPES for item in value):
        raise ValidationError("Meal types contain an unsupported value.")
    if len(value) != len(set(value)):
        raise ValidationError("Meal types must not repeat.")


def validate_steps(value):
    if not isinstance(value, list) or not value:
        raise ValidationError("Steps must be a nonempty array.")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValidationError("Each step must be a nonempty string.")
