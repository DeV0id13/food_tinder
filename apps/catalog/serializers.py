from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Recipe, RecipeIngredient
from .validators import MEAL_TYPES


def recipe_image_url(recipe: Recipe) -> str:
    return recipe.photo.url if recipe.photo else recipe.image_url


@extend_schema_field({"type": "array", "items": {"type": "string", "enum": list(MEAL_TYPES)}})
class RecipeMealsField(serializers.JSONField):
    pass


@extend_schema_field({"type": "array", "items": {"type": "string"}})
class RecipeStepsField(serializers.JSONField):
    pass


class RecipeSummarySerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    meal_types = RecipeMealsField(read_only=True)

    class Meta:
        model = Recipe
        fields: tuple[str, ...] = (
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
        read_only_fields: tuple[str, ...] = fields

    def get_image_url(self, recipe: Recipe) -> str:
        return recipe_image_url(recipe)


class RecipeIngredientSerializer(serializers.ModelSerializer):
    ingredient_id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(source="ingredient.name", read_only=True)
    unit = serializers.CharField(source="ingredient.unit", read_only=True)

    class Meta:
        model = RecipeIngredient
        fields = ("ingredient_id", "name", "unit", "quantity")
        read_only_fields = fields


class RecipeDetailSerializer(RecipeSummarySerializer):
    steps = RecipeStepsField(read_only=True)
    ingredients = RecipeIngredientSerializer(source="ingredient_lines", many=True, read_only=True)

    class Meta(RecipeSummarySerializer.Meta):
        fields = (*RecipeSummarySerializer.Meta.fields, "description", "steps", "ingredients")
        read_only_fields = fields
