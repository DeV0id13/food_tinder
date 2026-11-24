from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .calculation import ShoppingItem, format_quantity

MAX_BIGINT = 2**63 - 1
FILE_TYPES = ("csv", "txt")


class ShoppingListQuerySerializer(serializers.Serializer):
    plan_id = serializers.IntegerField(min_value=1, max_value=MAX_BIGINT)


class ShoppingListExportQuerySerializer(ShoppingListQuerySerializer):
    file_type = serializers.ChoiceField(choices=FILE_TYPES)


@extend_schema_field(OpenApiTypes.BOOL)
class PurchaseFlagField(serializers.JSONField):
    pass


class PurchaseSerializer(serializers.Serializer):
    purchased = PurchaseFlagField()
    quantity_version = serializers.RegexField(r"\A[0-9a-f]{64}\Z", trim_whitespace=False)

    def validate_purchased(self, value: object) -> bool:
        if type(value) is not bool:
            raise serializers.ValidationError("Expected a JSON boolean.")
        return value

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        if set(self.initial_data) - set(self.fields):
            raise serializers.ValidationError(
                {"non_field_errors": ["Unknown fields are not allowed."]}
            )
        return attrs


class ShoppingItemSerializer(serializers.Serializer):
    ingredient_id = serializers.IntegerField()
    name = serializers.CharField()
    unit = serializers.CharField()
    quantity = serializers.SerializerMethodField()
    quantity_version = serializers.CharField()

    def get_quantity(self, item: ShoppingItem) -> str:
        return format_quantity(item.quantity)


class ShoppingChecklistItemSerializer(ShoppingItemSerializer):
    purchased = serializers.BooleanField()


class ShoppingChecklistSerializer(serializers.Serializer):
    plan_id = serializers.IntegerField()
    items = ShoppingChecklistItemSerializer(many=True)
