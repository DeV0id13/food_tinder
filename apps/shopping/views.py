from collections.abc import Iterable

from django.db import transaction
from django.http import HttpResponse
from django.views.decorators.cache import never_cache
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.decorators import api_view, content_negotiation_class, parser_classes
from rest_framework.exceptions import ValidationError
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.parsers import BaseParser, JSONParser
from rest_framework.renderers import BaseRenderer
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.authentication import authenticated_user
from apps.planning.selectors import get_locked_plan_for_user
from common.schema import (
    NOT_FOUND,
    PLAN_ID,
    SESSION_REQUIRED,
    VALIDATION_ERROR,
    DetailErrorSerializer,
)

from .exporters import render_csv, render_txt
from .serializers import (
    PurchaseSerializer,
    ShoppingChecklistSerializer,
    ShoppingItemSerializer,
    ShoppingListExportQuerySerializer,
    ShoppingListQuerySerializer,
)
from .services import checklist, get_shopping_list_for_user, set_purchased

EXPORTERS = {
    "csv": (render_csv, "text/csv; charset=utf-8"),
    "txt": (render_txt, "text/plain; charset=utf-8"),
}


class FileTypeContentNegotiation(BaseContentNegotiation):
    """Формат файла задаёт ``file_type``, поэтому ``Accept`` клиента не приводит к 406.

    Готовый файл возвращается как ``HttpResponse`` в обход renderer; ошибки валидации
    и доступа рендерятся первым настроенным renderer (JSON).
    """

    def select_parser(self, request: Request, parsers: Iterable[BaseParser]) -> BaseParser | None:
        return next(iter(parsers), None)

    def select_renderer(
        self, request: Request, renderers: Iterable[BaseRenderer], format_suffix: str | None = None
    ) -> tuple[BaseRenderer, str]:
        renderer = next(iter(renderers))
        return renderer, renderer.media_type


@never_cache
@extend_schema(
    parameters=[ShoppingListQuerySerializer],
    responses={
        200: ShoppingChecklistSerializer,
        400: VALIDATION_ERROR,
        403: SESSION_REQUIRED,
        404: NOT_FOUND,
    },
    summary="Покупки выбранного рациона с отметками",
)
@api_view(["GET"])
def shopping_list(request: Request) -> Response:
    query = ShoppingListQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    plan_id = query.validated_data["plan_id"]
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=authenticated_user(request), plan_id=plan_id)
        items, purchased = checklist(plan)
    rows = ShoppingItemSerializer(items, many=True).data
    return Response(
        {
            "plan_id": plan_id,
            "items": [{**row, "purchased": row["ingredient_id"] in purchased} for row in rows],
        }
    )


@never_cache
@extend_schema(
    request=PurchaseSerializer,
    parameters=[
        PLAN_ID,
        OpenApiParameter("ingredient_id", OpenApiTypes.INT64, OpenApiParameter.PATH, required=True),
    ],
    responses={
        204: None,
        400: VALIDATION_ERROR,
        403: SESSION_REQUIRED,
        404: NOT_FOUND,
        409: DetailErrorSerializer,
        415: DetailErrorSerializer,
    },
    summary="Изменить отметку при совпадении версии количества",
)
@api_view(["PUT"])
@parser_classes([JSONParser])
def purchase(request: Request, plan_id: int, ingredient_id: int) -> Response:
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=authenticated_user(request), plan_id=plan_id)
        serializer = PurchaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        set_purchased(plan, ingredient_id, **serializer.validated_data)
    return Response(status=status.HTTP_204_NO_CONTENT)


@never_cache
@extend_schema(
    parameters=[PLAN_ID],
    responses={
        204: None,
        400: VALIDATION_ERROR,
        403: SESSION_REQUIRED,
        404: NOT_FOUND,
        415: DetailErrorSerializer,
    },
    summary="Снять все отметки с покупок рациона",
)
@api_view(["DELETE"])
@parser_classes([JSONParser])
def clear_purchases(request: Request, plan_id: int) -> Response:
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=authenticated_user(request), plan_id=plan_id)
        if request.data != {}:
            raise ValidationError({"non_field_errors": ["This request does not take a body."]})
        plan.purchased_ingredients.all().delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@never_cache
@extend_schema(
    parameters=[
        ShoppingListExportQuerySerializer,
        OpenApiParameter(
            "Content-Disposition",
            OpenApiTypes.STR,
            OpenApiParameter.HEADER,
            response=[200],
            description="Вложение с именем shopping-list-{plan_id}.csv или .txt.",
        ),
    ],
    responses={
        (200, "text/csv"): OpenApiResponse(OpenApiTypes.BINARY, "CSV в UTF-8 с BOM."),
        (200, "text/plain"): OpenApiResponse(OpenApiTypes.BINARY, "TXT в UTF-8."),
        400: VALIDATION_ERROR,
        403: SESSION_REQUIRED,
        404: NOT_FOUND,
    },
    summary="Скачать покупки в выбранном формате",
)
@api_view(["GET"])
@content_negotiation_class(FileTypeContentNegotiation)
def shopping_list_export(request: Request) -> HttpResponse:
    query = ShoppingListExportQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    plan_id, items = get_shopping_list_for_user(
        user=authenticated_user(request), plan_id=query.validated_data["plan_id"]
    )
    file_type = query.validated_data["file_type"]
    render, content_type = EXPORTERS[file_type]
    response = HttpResponse(render(items), content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="shopping-list-{plan_id}.{file_type}"'
    return response
