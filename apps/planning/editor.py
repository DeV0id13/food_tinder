from hashlib import sha256
from json import dumps

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError

from apps.catalog.models import Recipe
from apps.preferences.selectors import favorite_recipe_ids

from .models import MealPlan, MealPlanSlot
from .signals import plan_slots_changed


class PlanEditorConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The plan has changed since it was opened."


def _replace_slots(plan, slots, existing):
    desired = {}
    for slot in slots:
        key = (slot["day_index"], slot["meal_type"])
        if key[0] >= plan.duration_days or key[1] not in plan.enabled_meals:
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
            recipe = recipes.get(recipe_id)
            if recipe is None or not recipe.is_active or recipe_id not in favorites:
                raise ValidationError(
                    {"slots": [f"Day {day + 1}, {meal}: choose an active favorite recipe."]}
                )
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


def create_plan(user, config, slots, creation_key):
    digest = ""
    if creation_key is not None:
        # Concurrent retries for the same owner must see the first committed result.
        get_user_model().objects.select_for_update(no_key=True).only("pk").get(pk=user.pk)
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


def update_plan(plan, config, slots, version):
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
        plan.version += 1
        plan.save(update_fields=[*config, "version"])
    if slots_changed:
        plan_slots_changed.send(sender=MealPlan, plan=plan)
