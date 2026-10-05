from rest_framework import serializers

from .models import ALLOWED_DURATIONS, MEAL_TYPES, MealPlan, MealPlanSlot

MEAL_ORDER = {meal: index for index, meal in enumerate(MEAL_TYPES)}


class StrictSerializer(serializers.Serializer):
    def validate(self, attrs):
        if isinstance(self.initial_data, dict):
            unknown_fields = set(self.initial_data) - set(self.fields)
            if unknown_fields:
                raise serializers.ValidationError(
                    {"non_field_errors": ["Unknown fields are not allowed."]}
                )
        return attrs


class MealPlanCreateSerializer(StrictSerializer):
    start_date = serializers.DateField()
    duration_days = serializers.IntegerField()
    enabled_meals = serializers.ListField(
        child=serializers.ChoiceField(choices=MEAL_TYPES),
        allow_empty=False,
    )

    def validate_duration_days(self, value):
        if value not in ALLOWED_DURATIONS:
            raise serializers.ValidationError("Duration must be 1, 3 or 7 days.")
        return value

    def validate_enabled_meals(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Enabled meals must not repeat.")
        return value


class SlotWriteSerializer(StrictSerializer):
    recipe_id = serializers.IntegerField(min_value=1)
    servings = serializers.IntegerField(min_value=1, max_value=20)


class MealPlanSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = MealPlan
        fields = ("id", "start_date", "duration_days", "enabled_meals")
        read_only_fields = fields


class MealPlanSlotSerializer(serializers.ModelSerializer):
    recipe_id = serializers.IntegerField(read_only=True)
    recipe_title = serializers.CharField(source="recipe.title", read_only=True)

    class Meta:
        model = MealPlanSlot
        fields = ("day_index", "meal_type", "recipe_id", "recipe_title", "servings")
        read_only_fields = fields


class MealPlanDetailSerializer(MealPlanSummarySerializer):
    slots = serializers.SerializerMethodField()

    class Meta(MealPlanSummarySerializer.Meta):
        fields = (*MealPlanSummarySerializer.Meta.fields, "slots")
        read_only_fields = fields

    def get_slots(self, obj):
        slots = sorted(
            obj.slots.all(),
            key=lambda slot: (slot.day_index, MEAL_ORDER.get(slot.meal_type, len(MEAL_ORDER))),
        )
        return MealPlanSlotSerializer(slots, many=True).data
