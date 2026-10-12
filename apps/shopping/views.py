from django.http import HttpResponse
from django.views.decorators.cache import never_cache
from rest_framework.decorators import api_view
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
