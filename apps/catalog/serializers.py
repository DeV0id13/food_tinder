from rest_framework import serializers

from .models import Recipe, RecipeIngredient


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
        read_only_fields = fields


class RecipeIngredientSerializer(serializers.ModelSerializer):
    ingredient_id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(source="ingredient.name", read_only=True)
    unit = serializers.CharField(source="ingredient.unit", read_only=True)

    class Meta:
        model = RecipeIngredient
        fields = ("ingredient_id", "name", "unit", "quantity")
        read_only_fields = fields


class RecipeDetailSerializer(RecipeSummarySerializer):
    ingredients = RecipeIngredientSerializer(source="ingredient_lines", many=True, read_only=True)

    class Meta(RecipeSummarySerializer.Meta):
        fields = (*RecipeSummarySerializer.Meta.fields, "description", "steps", "ingredients")
        read_only_fields = fields
