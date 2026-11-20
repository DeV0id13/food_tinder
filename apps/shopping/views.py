from django.db import transaction
from django.http import HttpResponse
from django.views.decorators.cache import never_cache
from rest_framework import status
from rest_framework.decorators import api_view, content_negotiation_class, parser_classes
from rest_framework.exceptions import ValidationError
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.parsers import JSONParser
from rest_framework.response import Response

from apps.planning.selectors import get_locked_plan_for_user

from .exporters import render_csv, render_txt
from .serializers import (
    PurchaseSerializer,
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

    def select_parser(self, request, parsers):
        return parsers[0] if parsers else None

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


@never_cache
@api_view(["GET"])
def shopping_list(request):
    query = ShoppingListQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    plan_id = query.validated_data["plan_id"]
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
        items, purchased = checklist(plan)
    rows = ShoppingItemSerializer(items, many=True).data
    return Response(
        {
            "plan_id": plan_id,
            "items": [{**row, "purchased": row["ingredient_id"] in purchased} for row in rows],
        }
    )


@never_cache
@api_view(["PUT"])
@parser_classes([JSONParser])
def purchase(request, plan_id, ingredient_id):
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
        serializer = PurchaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        set_purchased(plan, ingredient_id, **serializer.validated_data)
    return Response(status=status.HTTP_204_NO_CONTENT)


@never_cache
@api_view(["DELETE"])
@parser_classes([JSONParser])
def clear_purchases(request, plan_id):
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=request.user, plan_id=plan_id)
        if request.data != {}:
            raise ValidationError({"non_field_errors": ["This request does not take a body."]})
        plan.purchased_ingredients.all().delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@never_cache
@api_view(["GET"])
@content_negotiation_class(FileTypeContentNegotiation)
def shopping_list_export(request):
    query = ShoppingListExportQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    plan_id, items = get_shopping_list_for_user(
        user=request.user, plan_id=query.validated_data["plan_id"]
    )
    file_type = query.validated_data["file_type"]
    render, content_type = EXPORTERS[file_type]
    response = HttpResponse(render(items), content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="shopping-list-{plan_id}.{file_type}"'
    return response
