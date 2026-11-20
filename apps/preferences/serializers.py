from rest_framework import serializers

from apps.catalog.serializers import RecipeSummarySerializer as RecipeSummarySerializer

from .models import UserRecipeState


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


class UndoSwipeSerializer(StrictSerializer):
    undo_token = serializers.UUIDField()


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
