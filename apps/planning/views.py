from django.db import transaction
from django.db.models import prefetch_related_objects
from django.views.decorators.cache import never_cache
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from apps.catalog.models import Recipe
from apps.preferences.selectors import is_favorite

from .editor import create_plan, update_plan
from .models import MEAL_TYPES, MealPlan, MealPlanSlot
from .selectors import get_locked_plan_for_user
from .serializers import (
    EditorCreateSerializer,
    EditorUpdateSerializer,
    MealPlanDetailSerializer,
    MealPlanSlotSerializer,
    MealPlanSummarySerializer,
    SlotWriteSerializer,
)
from .signals import plan_slots_changed


class MealPlanPagination(LimitOffsetPagination):
    default_limit = 30
    max_limit = 100


def _active_recipe_or_404(recipe_id):
    recipe = Recipe.objects.filter(pk=recipe_id).first()
    if recipe is None or not recipe.is_active:
        raise NotFound
    return recipe


def _slot_error(field, message):
    raise serializers.ValidationError({field: [message]})


def _validate_slot_target(plan, day_index, meal_type):
    errors = {}
    if day_index < 0 or day_index >= plan.duration_days:
        errors["day_index"] = ["Day index is outside the plan period."]
    if meal_type not in MEAL_TYPES:
        errors["meal_type"] = ["Unknown meal type."]
    elif meal_type not in plan.enabled_meals:
        errors["meal_type"] = ["This meal is not enabled for the plan."]
    if errors:
        raise serializers.ValidationError(errors)


@never_cache
@api_view(["GET", "POST"])
def meal_plans(request):
    if request.method == "GET":
        queryset = (
            MealPlan.objects.filter(user=request.user).prefetch_related("slots").order_by("-id")
        )
        paginator = MealPlanPagination()
        page = paginator.paginate_queryset(queryset, request, view=None)
        return paginator.get_paginated_response(MealPlanSummarySerializer(page, many=True).data)

    serializer = EditorCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    config = serializer.validated_data.copy()
    slots = config.pop("slots", [])
    creation_key = config.pop("creation_key", None)
    with transaction.atomic():
        plan, created = create_plan(request.user, config, slots, creation_key)
        prefetch_related_objects([plan], "slots__recipe")
        data = MealPlanDetailSerializer(plan).data
    return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@never_cache
@api_view(["GET", "PUT", "DELETE"])
def meal_plan_detail(request, plan_id):
    # Read the version and slots under the same lock used by all plan writers.
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
        if request.method == "DELETE":
            plan.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        if request.method == "PUT":
            serializer = EditorUpdateSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            config = serializer.validated_data.copy()
            version = config.pop("version")
            slots = config.pop("slots")
            update_plan(plan, config, slots, version)
        prefetch_related_objects([plan], "slots__recipe")
        data = MealPlanDetailSerializer(plan).data
    return Response(data)


@never_cache
@api_view(["PUT", "DELETE"])
def meal_plan_slot(request, plan_id, day_index, meal_type):
    if request.method == "DELETE":
        with transaction.atomic():
            plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
            _validate_slot_target(plan, day_index, meal_type)
            deleted, _ = MealPlanSlot.objects.filter(
                plan=plan, day_index=day_index, meal_type=meal_type
            ).delete()
            if deleted:
                plan.version += 1
                plan.save(update_fields=["version"])
                plan_slots_changed.send(sender=MealPlan, plan=plan)
        return Response(status=status.HTTP_204_NO_CONTENT)

    with transaction.atomic():
        plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
        _validate_slot_target(plan, day_index, meal_type)
        serializer = SlotWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        recipe_id = serializer.validated_data["recipe_id"]
        servings = serializer.validated_data["servings"]
        existing = MealPlanSlot.objects.filter(
            plan=plan, day_index=day_index, meal_type=meal_type
        ).first()
        if existing is not None and existing.recipe_id == recipe_id:
            recipe = existing.recipe
        else:
            recipe = _active_recipe_or_404(recipe_id)
            if not is_favorite(user_id=request.user.id, recipe_id=recipe_id):
                _slot_error("recipe_id", "Recipe is not in favorites.")
        if meal_type not in recipe.meal_types:
            _slot_error("meal_type", "Recipe is not suitable for this meal.")
        slot, _ = MealPlanSlot.objects.update_or_create(
            plan=plan,
            day_index=day_index,
            meal_type=meal_type,
            defaults={"recipe": recipe, "servings": servings},
        )
        if existing is None or (existing.recipe_id, existing.servings) != (recipe_id, servings):
            plan.version += 1
            plan.save(update_fields=["version"])
        plan_slots_changed.send(sender=MealPlan, plan=plan)

    return Response(MealPlanSlotSerializer(slot).data)
