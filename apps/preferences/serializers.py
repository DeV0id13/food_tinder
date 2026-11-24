from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.serializers import RecipeSummarySerializer as RecipeSummarySerializer

from .models import UserRecipeState


class StrictSerializer(serializers.Serializer):
    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        unknown_fields = set(self.initial_data) - set(self.fields)
        if unknown_fields:
            raise serializers.ValidationError(
                {"non_field_errors": ["Unknown fields are not allowed."]}
            )
        return attrs


class SwipeSerializer(StrictSerializer):
    recipe_id = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=("like", "dislike"))


class UndoSwipeSerializer(StrictSerializer):
    undo_token = serializers.UUIDField()


@extend_schema_field(OpenApiTypes.BOOL)
class StrictBooleanField(serializers.Field):
    default_error_messages = {"invalid": "Expected a JSON boolean."}

    def to_internal_value(self, data: object) -> bool:
        if type(data) is not bool:
            self.fail("invalid")
        return data

    def to_representation(self, value: object) -> bool:
        return bool(value)


class FavoriteSerializer(StrictSerializer):
    is_favorite = StrictBooleanField()


class RecipeStateSerializer(serializers.ModelSerializer):
    recipe_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = UserRecipeState
        fields: tuple[str, ...] = ("recipe_id", "liked_at", "disliked_until", "is_favorite")


class FavoriteRecipeSerializer(RecipeSummarySerializer):
    favorited_at = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta(RecipeSummarySerializer.Meta):
        fields = (*RecipeSummarySerializer.Meta.fields, "favorited_at")


class SwipeResultSerializer(RecipeStateSerializer):
    undo_token = serializers.UUIDField()
    undo_remaining_ms = serializers.IntegerField(min_value=0)

    class Meta(RecipeStateSerializer.Meta):
        fields = (*RecipeStateSerializer.Meta.fields, "undo_token", "undo_remaining_ms")
