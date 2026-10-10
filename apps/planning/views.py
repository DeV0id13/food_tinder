from django.db import transaction
from django.views.decorators.cache import never_cache
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from apps.catalog.models import Recipe
from apps.preferences.selectors import is_favorite

from .models import MEAL_TYPES, MealPlanSlot
from .selectors import get_locked_plan_for_user, get_plan_for_user
from .serializers import (
    MealPlanCreateSerializer,
    MealPlanDetailSerializer,
    MealPlanSlotSerializer,
    MealPlanSummarySerializer,
    SlotWriteSerializer,
)


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
        queryset = MealPlan.objects.filter(user=request.user).order_by("-id")
        paginator = MealPlanPagination()
        page = paginator.paginate_queryset(queryset, request, view=None)
        return paginator.get_paginated_response(MealPlanSummarySerializer(page, many=True).data)

    serializer = MealPlanCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    plan = MealPlan.objects.create(
        user=request.user,
        start_date=serializer.validated_data["start_date"],
        duration_days=serializer.validated_data["duration_days"],
        enabled_meals=serializer.validated_data["enabled_meals"],
    )
    return Response(MealPlanDetailSerializer(plan).data, status=status.HTTP_201_CREATED)


@never_cache
@api_view(["GET", "DELETE"])
def meal_plan_detail(request, plan_id):
    if request.method == "DELETE":
        with transaction.atomic():
            plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
            plan.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    plan = get_plan_for_user(user=request.user, plan_id=plan_id)
    return Response(MealPlanDetailSerializer(plan).data)


@never_cache
@api_view(["PUT", "DELETE"])
def meal_plan_slot(request, plan_id, day_index, meal_type):
    if request.method == "DELETE":
        with transaction.atomic():
            plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
            _validate_slot_target(plan, day_index, meal_type)
            MealPlanSlot.objects.filter(
                plan=plan, day_index=day_index, meal_type=meal_type
            ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = SlotWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    recipe_id = serializer.validated_data["recipe_id"]
    servings = serializer.validated_data["servings"]

    with transaction.atomic():
        plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
        _validate_slot_target(plan, day_index, meal_type)
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

    return Response(MealPlanSlotSerializer(slot).data)
