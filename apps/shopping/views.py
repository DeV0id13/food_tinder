from django.http import HttpResponse
from django.views.decorators.cache import never_cache
from rest_framework.decorators import api_view, content_negotiation_class
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.response import Response

from .exporters import render_csv, render_txt
from .serializers import (
    ShoppingItemSerializer,
    ShoppingListExportQuerySerializer,
    ShoppingListQuerySerializer,
)
from .services import get_shopping_list_for_user

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
    plan_id, items = get_shopping_list_for_user(
        user=request.user, plan_id=query.validated_data["plan_id"]
    )
    return Response({"plan_id": plan_id, "items": ShoppingItemSerializer(items, many=True).data})


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
