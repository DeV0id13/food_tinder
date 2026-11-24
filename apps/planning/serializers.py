from __future__ import annotations

from datetime import date, timedelta
from typing import cast

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.serializers import recipe_image_url

from .editor import PlanConfig
from .models import ALLOWED_DURATIONS, MEAL_TYPES, MealPlan, MealPlanSlot

MEAL_ORDER = {meal: index for index, meal in enumerate(MEAL_TYPES)}


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data: object) -> dict[str, object]:
        if isinstance(data, dict):
            unknown_fields = set(data) - set(self.fields)
            if unknown_fields:
                raise serializers.ValidationError(
                    {"non_field_errors": ["Unknown fields are not allowed."]}
                )
        return super().to_internal_value(data)


class MealPlanCreateSerializer(StrictSerializer):
    title = serializers.CharField(max_length=120, allow_blank=True, default="")
    start_date = serializers.DateField()
    duration_days = serializers.IntegerField()
    enabled_meals = serializers.ListField(
        child=serializers.ChoiceField(choices=MEAL_TYPES),
        allow_empty=False,
    )

    def validate(self, attrs: PlanConfig) -> PlanConfig:
        if attrs["start_date"] > date.max - timedelta(days=attrs["duration_days"] - 1):
            raise serializers.ValidationError(
                {"start_date": ["The plan ends outside the calendar."]}
            )
        return attrs

    def validate_duration_days(self, value: int) -> int:
        if value not in ALLOWED_DURATIONS:
            raise serializers.ValidationError("Duration must be 1, 3 or 7 days.")
        return value

    def validate_enabled_meals(self, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Enabled meals must not repeat.")
        return value


class SlotWriteSerializer(StrictSerializer):
    recipe_id = serializers.IntegerField(min_value=1)
    servings = serializers.IntegerField(min_value=1, max_value=20)


class EditorSlotSerializer(SlotWriteSerializer):
    recipe_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1)
    day_index = serializers.IntegerField(min_value=0, max_value=6)
    meal_type = serializers.ChoiceField(choices=MEAL_TYPES)


class EditorCreateSerializer(MealPlanCreateSerializer):
    slots: serializers.ListSerializer[list[dict[str, int | str]]] = serializers.ListSerializer(
        child=EditorSlotSerializer(), max_length=28, required=False
    )
    creation_key = serializers.UUIDField(required=False)

    def validate(self, attrs: PlanConfig) -> PlanConfig:
        attrs = super().validate(attrs)
        if "slots" in attrs and "creation_key" not in attrs:
            raise serializers.ValidationError({"creation_key": ["A creation key is required."]})
        return attrs


class EditorUpdateSerializer(MealPlanCreateSerializer):
    slots: serializers.ListSerializer[list[dict[str, int | str]]] = serializers.ListSerializer(
        child=EditorSlotSerializer(), max_length=28
    )
    version = serializers.IntegerField(min_value=1, max_value=2**63 - 1)


@extend_schema_field({"type": "array", "items": {"type": "string", "enum": list(MEAL_TYPES)}})
class PlanMealsField(serializers.JSONField):
    pass


class MealPlanSummarySerializer(serializers.ModelSerializer):
    filled_slots = serializers.SerializerMethodField()
    enabled_meals = PlanMealsField(read_only=True)

    class Meta:
        model = MealPlan
        fields: tuple[str, ...] = (
            "id",
            "start_date",
            "duration_days",
            "enabled_meals",
            "title",
            "version",
            "filled_slots",
        )
        read_only_fields: tuple[str, ...] = fields

    def get_filled_slots(self, plan: MealPlan) -> int:
        return sum(
            slot.day_index < plan.duration_days and slot.meal_type in plan.enabled_meals
            for slot in plan.slots.all()
        )


class MealPlanSlotSerializer(serializers.ModelSerializer):
    recipe_id = serializers.IntegerField(read_only=True)
    recipe_title = serializers.CharField(source="recipe.title", read_only=True)
    recipe_image_url = serializers.SerializerMethodField()

    class Meta:
        model = MealPlanSlot
        fields = (
            "day_index",
            "meal_type",
            "recipe_id",
            "recipe_title",
            "servings",
            "recipe_image_url",
        )
        read_only_fields = fields

    def get_recipe_image_url(self, slot: MealPlanSlot) -> str:
        return recipe_image_url(slot.recipe)


class MealPlanDetailSerializer(MealPlanSummarySerializer):
    slots = serializers.SerializerMethodField()

    class Meta(MealPlanSummarySerializer.Meta):
        fields = (*MealPlanSummarySerializer.Meta.fields, "slots")
        read_only_fields = fields

    @extend_schema_field(MealPlanSlotSerializer(many=True))
    def get_slots(self, obj: MealPlan) -> list[dict[str, object]]:
        slots = sorted(
            obj.slots.all(),
            key=lambda slot: (slot.day_index, MEAL_ORDER.get(slot.meal_type, len(MEAL_ORDER))),
        )
        return cast(list[dict[str, object]], MealPlanSlotSerializer(slots, many=True).data)
