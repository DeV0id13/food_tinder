"""Shared OpenAPI shapes for the DRF response envelopes used by this API."""

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, inline_serializer
from rest_framework import serializers


class DetailErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()


class HealthStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=("ok", "unavailable"))


VALIDATION_ERROR = OpenApiResponse(
    response={
        "type": "object",
        "additionalProperties": {
            "oneOf": [{"type": "array", "items": {}}, {"type": "string"}],
        },
    },
    description="Ошибки по полям, включая вложенные слоты, non_field_errors или detail.",
)
SESSION_REQUIRED = OpenApiResponse(
    DetailErrorSerializer, "Требуется сессия или корректный CSRF-токен для изменяющего запроса."
)
CSRF_REQUIRED = OpenApiResponse(DetailErrorSerializer, "Требуется корректный CSRF-токен.")
NOT_FOUND = OpenApiResponse(DetailErrorSerializer, "Ресурс отсутствует или недоступен.")
RATE_LIMITED = OpenApiResponse(DetailErrorSerializer, "Лимит попыток исчерпан.")
RETRY_AFTER = OpenApiParameter(
    "Retry-After",
    OpenApiTypes.INT,
    OpenApiParameter.HEADER,
    response=[429],
    description="Секунды до следующей попытки.",
)
PAGE_PARAMETERS = [
    OpenApiParameter(
        "limit",
        OpenApiTypes.INT,
        description="Размер страницы. По умолчанию 30, максимум 100.",
    ),
    OpenApiParameter("offset", OpenApiTypes.INT, description="Смещение. По умолчанию 0."),
]
PLAN_ID = OpenApiParameter("plan_id", OpenApiTypes.INT64, OpenApiParameter.PATH, required=True)
RECIPE_ID = OpenApiParameter("recipe_id", OpenApiTypes.INT64, OpenApiParameter.PATH, required=True)


def paginated_schema(name: str, item: type[serializers.Serializer]) -> serializers.Serializer:
    return inline_serializer(
        name=name,
        fields={
            "count": serializers.IntegerField(),
            "next": serializers.URLField(allow_null=True),
            "previous": serializers.URLField(allow_null=True),
            "results": item(many=True),
        },
    )
