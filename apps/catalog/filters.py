import re

from django.db.models import QuerySet, Value
from django.db.models.functions import Lower, Replace
from rest_framework import serializers

from .models import Recipe
from .validators import MEAL_TYPES

SORT_ORDERS = {
    "id": ("id",),
    "title": (Lower("title"), "id"),
    "time": ("cooking_time_minutes", "id"),
}


class QueryInteger(serializers.IntegerField):
    def to_internal_value(self, data: object) -> int:
        if not isinstance(data, str) or not re.fullmatch(r"[0-9]{1,10}", data):
            raise serializers.ValidationError("Enter a decimal integer.")
        return super().to_internal_value(data)


class CatalogFilters(serializers.Serializer):
    q = serializers.CharField(required=False, allow_blank=True, max_length=200)
    meal = serializers.ChoiceField(choices=MEAL_TYPES, required=False)
    max_time = QueryInteger(min_value=1, max_value=2_147_483_647, required=False)
    favorites = serializers.ChoiceField(choices=("0", "1"), required=False)
    sort = serializers.ChoiceField(choices=tuple(SORT_ORDERS), required=False)
    limit = QueryInteger(
        min_value=1,
        max_value=2_147_483_647,
        required=False,
        help_text="По умолчанию 30. Значения больше 100 ограничиваются до 100.",
    )
    offset = QueryInteger(
        min_value=0, max_value=2_147_483_647, required=False, help_text="По умолчанию 0."
    )

    def apply(self, recipes: QuerySet[Recipe], user_id: int | None) -> QuerySet[Recipe]:
        filters = self.validated_data
        if query := filters.get("q"):
            recipes = recipes.alias(
                searchable_title=Replace(Lower("title"), Value("ё"), Value("е"))
            ).filter(searchable_title__contains=query.lower().replace("ё", "е"))
        if meal := filters.get("meal"):
            recipes = recipes.filter(meal_types__contains=[meal])
        if max_time := filters.get("max_time"):
            recipes = recipes.filter(cooking_time_minutes__lte=max_time)
        if filters.get("favorites") == "1":
            if user_id is None:
                return recipes.none()
            recipes = recipes.filter(user_states__user_id=user_id, user_states__is_favorite=True)
        return recipes.order_by(*SORT_ORDERS[filters.get("sort", "id")])
