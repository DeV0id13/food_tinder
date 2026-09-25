from rest_framework import serializers

from apps.catalog.models import Recipe

from .models import UserRecipeState


class RecipeSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Recipe
        fields = (
            "id",
            "title",
            "image_url",
            "cooking_time_minutes",
            "difficulty",
            "base_servings",
            "meal_types",
            "kcal_per_serving",
            "protein_g_per_serving",
            "fat_g_per_serving",
            "carbs_g_per_serving",
            "estimated_price_rub_per_serving",
        )


class SwipeSerializer(serializers.Serializer):
    recipe_id = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=("like", "dislike"))


class FavoriteSerializer(serializers.Serializer):
    is_favorite = serializers.BooleanField()


class RecipeStateSerializer(serializers.ModelSerializer):
    recipe_id = serializers.IntegerField(source="recipe_id", read_only=True)

    class Meta:
        model = UserRecipeState
        fields = ("recipe_id", "liked_at", "disliked_until", "is_favorite")
