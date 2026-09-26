from rest_framework import serializers

from apps.catalog.models import Recipe

from .models import UserRecipeState


class RecipeSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Recipe
        fields = (
            "id", "title", "image_url", "cooking_time_minutes", "difficulty",
            "base_servings", "meal_types", "kcal_per_serving",
            "protein_g_per_serving", "fat_g_per_serving", "carbs_g_per_serving",
            "estimated_price_rub_per_serving",
        )


class StrictSerializer(serializers.Serializer):
    def validate(self, attrs):
        unknown_fields = set(self.initial_data) - set(self.fields)
        if unknown_fields:
            raise serializers.ValidationError(
                {"non_field_errors": ["Unknown fields are not allowed."]}
            )
        return attrs


class SwipeSerializer(StrictSerializer):
    recipe_id = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=("like", "dislike"))


class StrictBooleanField(serializers.Field):
    default_error_messages = {"invalid": "Expected a JSON boolean."}

    def to_internal_value(self, data):
        if type(data) is not bool:
            self.fail("invalid")
        return data

    def to_representation(self, value):
        return bool(value)


class FavoriteSerializer(StrictSerializer):
    is_favorite = StrictBooleanField()


class RecipeStateSerializer(serializers.ModelSerializer):
    recipe_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = UserRecipeState
        fields = ("recipe_id", "liked_at", "disliked_until", "is_favorite")
