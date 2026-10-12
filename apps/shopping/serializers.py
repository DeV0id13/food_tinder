from rest_framework import serializers

from .calculation import format_quantity

MAX_BIGINT = 2**63 - 1
FILE_TYPES = ("csv", "txt")


class ShoppingListQuerySerializer(serializers.Serializer):
    plan_id = serializers.IntegerField(min_value=1, max_value=MAX_BIGINT)


class ShoppingListExportQuerySerializer(ShoppingListQuerySerializer):
    file_type = serializers.ChoiceField(choices=FILE_TYPES)


class ShoppingItemSerializer(serializers.Serializer):
    ingredient_id = serializers.IntegerField()
    name = serializers.CharField()
    unit = serializers.CharField()
    quantity = serializers.SerializerMethodField()

    def get_quantity(self, item):
        return format_quantity(item.quantity)
