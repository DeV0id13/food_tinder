from datetime import date
from hashlib import sha256
from json import dumps
from typing import TypedDict
from uuid import UUID

from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError

from apps.accounts.models import User
from apps.catalog.models import Recipe
from apps.catalog.selectors import get_recipe
from apps.preferences.selectors import favorite_recipe_ids, is_favorite

from .models import MEAL_TYPES, MealPlan, MealPlanSlot
from .signals import plan_slots_changed


class PlanEditorConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The plan has changed since it was opened."


class PlanConfig(TypedDict):
    title: str
    start_date: date
    duration_days: int
    enabled_meals: list[str]


class SlotData(TypedDict):
    day_index: int
    meal_type: str
    recipe_id: int
    servings: int


def _day_enabled(plan: MealPlan, day_index: int) -> bool:
    return 0 <= day_index < plan.duration_days


def _meal_enabled(plan: MealPlan, meal_type: str) -> bool:
    return meal_type in MEAL_TYPES and meal_type in plan.enabled_meals


def validate_slot_target(plan: MealPlan, day_index: int, meal_type: str) -> None:
    errors = {}
    if not _day_enabled(plan, day_index):
        errors["day_index"] = ["Day index is outside the plan period."]
    if meal_type not in MEAL_TYPES:
        errors["meal_type"] = ["Unknown meal type."]
    elif not _meal_enabled(plan, meal_type):
        errors["meal_type"] = ["This meal is not enabled for the plan."]
    if errors:
        raise ValidationError(errors)


def _increment_version(plan: MealPlan, *fields: str) -> None:
    plan.version += 1
    plan.save(update_fields=[*fields, "version"])


def write_slot(
    plan: MealPlan, day_index: int, meal_type: str, recipe_id: int, servings: int
) -> MealPlanSlot:
    """Write to a validated address under the caller's plan lock."""
    slots = plan.slots.filter(day_index=day_index, meal_type=meal_type)
    existing = slots.first()
    if existing is not None and existing.recipe_id == recipe_id:
        recipe = existing.recipe
    else:
        recipe = get_recipe(recipe_id)
        if not is_favorite(user_id=plan.user_id, recipe_id=recipe_id):
            raise ValidationError({"recipe_id": ["Recipe is not in favorites."]})
    if meal_type not in recipe.meal_types:
        raise ValidationError({"meal_type": ["Recipe is not suitable for this meal."]})
    slot, _ = plan.slots.update_or_create(
        day_index=day_index, meal_type=meal_type, defaults={"recipe": recipe, "servings": servings}
    )
    if existing is None or (existing.recipe_id, existing.servings) != (recipe_id, servings):
        _increment_version(plan)
    plan_slots_changed.send(sender=MealPlan, plan=plan)
    return slot


def remove_slot(plan: MealPlan, day_index: int, meal_type: str) -> None:
    """Remove a validated address under the caller's plan lock."""
    deleted, _ = plan.slots.filter(day_index=day_index, meal_type=meal_type).delete()
    if deleted:
        _increment_version(plan)
        plan_slots_changed.send(sender=MealPlan, plan=plan)


def _replace_slots(
    plan: MealPlan, slots: list[SlotData], existing: dict[tuple[int, str], MealPlanSlot]
) -> bool:
    desired: dict[tuple[int, str], tuple[int, int]] = {}
    for slot in slots:
        key = (slot["day_index"], slot["meal_type"])
        if not _day_enabled(plan, key[0]) or not _meal_enabled(plan, key[1]):
            raise ValidationError({"slots": ["A slot is outside the enabled meals or days."]})
        if key in desired:
            raise ValidationError({"slots": ["A meal can contain only one recipe."]})
        desired[key] = (slot["recipe_id"], slot["servings"])

    new_recipes = {
        recipe_id
        for key, (recipe_id, _) in desired.items()
        if key not in existing or existing[key].recipe_id != recipe_id
    }
    recipes = Recipe.objects.in_bulk(new_recipes)
    favorites = favorite_recipe_ids(user_id=plan.user_id, recipe_ids=new_recipes)
    for key, (recipe_id, servings) in desired.items():
        day, meal = key
        old = existing.get(key)
        if old is not None and old.recipe_id == recipe_id:
            if old.servings == servings:
                continue
            recipe = old.recipe
        else:
            candidate = recipes.get(recipe_id)
            if candidate is None or not candidate.is_active or recipe_id not in favorites:
                raise ValidationError(
                    {"slots": [f"Day {day + 1}, {meal}: choose an active favorite recipe."]}
                )
            recipe = candidate
        if meal not in recipe.meal_types:
            raise ValidationError(
                {"slots": [f"Day {day + 1}, {meal}: the recipe is unsuitable for this meal."]}
            )

    removed = [slot.pk for key, slot in existing.items() if key not in desired]
    if removed:
        plan.slots.filter(pk__in=removed).delete()
    changed = []
    created = []
    for key, (recipe_id, servings) in desired.items():
        old = existing.get(key)
        if old is None:
            created.append(
                MealPlanSlot(
                    plan=plan,
                    day_index=key[0],
                    meal_type=key[1],
                    recipe_id=recipe_id,
                    servings=servings,
                )
            )
        elif (old.recipe_id, old.servings) != (recipe_id, servings):
            old.recipe_id = recipe_id
            old.servings = servings
            changed.append(old)
    MealPlanSlot.objects.bulk_create(created)
    MealPlanSlot.objects.bulk_update(changed, ["recipe", "servings"])
    return bool(removed or created or changed)


def create_plan(
    user: User, config: PlanConfig, slots: list[SlotData], creation_key: UUID | None
) -> tuple[MealPlan, bool]:
    """Create a plan or replay a matching request within the caller's transaction."""
    digest = ""
    if creation_key is not None:
        # Concurrent retries for the same owner must see the first committed result.
        User.objects.select_for_update(no_key=True).only("pk").get(pk=user.pk)
        digest = sha256(dumps([config, slots], sort_keys=True, default=str).encode()).hexdigest()
        existing = (
            MealPlan.objects.select_for_update()
            .filter(user=user, creation_key=creation_key)
            .first()
        )
        if existing is not None:
            if existing.creation_digest != digest:
                raise PlanEditorConflict("This creation key was already used with different data.")
            return existing, False

    plan = MealPlan.objects.create(
        user=user, creation_key=creation_key, creation_digest=digest, **config
    )
    if slots:
        _replace_slots(plan, slots, {})
    return plan, True


def update_plan(plan: MealPlan, config: PlanConfig, slots: list[SlotData], version: int) -> None:
    """Apply the editor snapshot under the caller's plan lock."""
    existing = {
        (slot.day_index, slot.meal_type): slot for slot in plan.slots.select_related("recipe")
    }
    config_changed = any(getattr(plan, field) != value for field, value in config.items())
    if plan.version != version:
        current_slots = {
            (day, meal, slot.recipe_id, slot.servings) for (day, meal), slot in existing.items()
        }
        desired_slots = {
            (slot["day_index"], slot["meal_type"], slot["recipe_id"], slot["servings"])
            for slot in slots
        }
        # A retry of an already applied write can return the saved representation.
        if (
            version + 1 != plan.version
            or config_changed
            or current_slots != desired_slots
            or len(desired_slots) != len(slots)
        ):
            raise PlanEditorConflict()
        return

    for field, value in config.items():
        setattr(plan, field, value)
    slots_changed = _replace_slots(plan, slots, existing)
    if config_changed or slots_changed:
        _increment_version(plan, *config)
    if slots_changed:
        plan_slots_changed.send(sender=MealPlan, plan=plan)
