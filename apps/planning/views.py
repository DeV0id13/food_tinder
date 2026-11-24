from django.db import transaction
from django.db.models import prefetch_related_objects
from django.views.decorators.cache import never_cache
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.authentication import authenticated_user
from common.pagination import StandardPagination
from common.schema import (
    NOT_FOUND,
    PAGE_PARAMETERS,
    PLAN_ID,
    SESSION_REQUIRED,
    VALIDATION_ERROR,
    DetailErrorSerializer,
    paginated_schema,
)

from .editor import create_plan, remove_slot, update_plan, validate_slot_target, write_slot
from .models import MealPlan
from .selectors import get_locked_plan_for_user
from .serializers import (
    EditorCreateSerializer,
    EditorUpdateSerializer,
    MealPlanDetailSerializer,
    MealPlanSlotSerializer,
    MealPlanSummarySerializer,
    SlotWriteSerializer,
)

SLOT_ADDRESS = [
    PLAN_ID,
    OpenApiParameter(
        "day_index",
        OpenApiTypes.INT,
        OpenApiParameter.PATH,
        required=True,
        description="Индекс от 0 до duration_days - 1.",
    ),
    OpenApiParameter(
        "meal_type",
        OpenApiTypes.STR,
        OpenApiParameter.PATH,
        required=True,
        description="Один из включённых приёмов пищи: breakfast, lunch, snack или dinner.",
    ),
]


@never_cache
@extend_schema(
    methods=["GET"],
    parameters=PAGE_PARAMETERS,
    responses={
        200: paginated_schema("MealPlanPage", MealPlanSummarySerializer),
        403: SESSION_REQUIRED,
    },
    operation_id="listMealPlans",
    summary="Список рационов текущего пользователя",
)
@extend_schema(
    methods=["POST"],
    request=EditorCreateSerializer,
    responses={
        200: MealPlanDetailSerializer,
        201: MealPlanDetailSerializer,
        400: VALIDATION_ERROR,
        403: SESSION_REQUIRED,
        409: DetailErrorSerializer,
    },
    summary="Создать рацион или вернуть результат повторного запроса",
    description="Если переданы slots, нужен creation_key. Повтор ключа с другими данными даёт 409.",
)
@api_view(["GET", "POST"])
def meal_plans(request: Request) -> Response:
    if request.method == "GET":
        queryset = (
            MealPlan.objects.filter(user=authenticated_user(request))
            .prefetch_related("slots")
            .order_by("-id")
        )
        paginator = StandardPagination()
        page = paginator.paginate_queryset(queryset, request, view=None)
        return paginator.get_paginated_response(MealPlanSummarySerializer(page, many=True).data)

    serializer = EditorCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    config = serializer.validated_data.copy()
    slots = config.pop("slots", [])
    creation_key = config.pop("creation_key", None)
    with transaction.atomic():
        plan, created = create_plan(authenticated_user(request), config, slots, creation_key)
        prefetch_related_objects([plan], "slots__recipe")
        data = MealPlanDetailSerializer(plan).data
    return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@never_cache
@extend_schema(
    methods=["GET"],
    parameters=[PLAN_ID],
    responses={200: MealPlanDetailSerializer, 403: SESSION_REQUIRED, 404: NOT_FOUND},
)
@extend_schema(
    methods=["PUT"],
    parameters=[PLAN_ID],
    request=EditorUpdateSerializer,
    responses={
        200: MealPlanDetailSerializer,
        400: VALIDATION_ERROR,
        403: SESSION_REQUIRED,
        404: NOT_FOUND,
        409: DetailErrorSerializer,
    },
    summary="Атомарно сохранить весь рацион с проверкой версии",
)
@extend_schema(
    methods=["DELETE"],
    parameters=[PLAN_ID],
    responses={204: None, 403: SESSION_REQUIRED, 404: NOT_FOUND},
)
@api_view(["GET", "PUT", "DELETE"])
def meal_plan_detail(request: Request, plan_id: int) -> Response:
    # Read the version and slots under the same lock used by all plan writers.
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=authenticated_user(request), plan_id=plan_id)
        if request.method == "DELETE":
            plan.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        if request.method == "PUT":
            serializer = EditorUpdateSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            config = serializer.validated_data.copy()
            version = config.pop("version")
            slots = config.pop("slots")
            update_plan(plan, config, slots, version)
        prefetch_related_objects([plan], "slots__recipe")
        data = MealPlanDetailSerializer(plan).data
    return Response(data)


@never_cache
@extend_schema(
    methods=["PUT"],
    parameters=SLOT_ADDRESS,
    request=SlotWriteSerializer,
    responses={
        200: MealPlanSlotSerializer,
        400: VALIDATION_ERROR,
        403: SESSION_REQUIRED,
        404: NOT_FOUND,
    },
)
@extend_schema(
    methods=["DELETE"],
    parameters=SLOT_ADDRESS,
    responses={204: None, 400: VALIDATION_ERROR, 403: SESSION_REQUIRED, 404: NOT_FOUND},
)
@api_view(["PUT", "DELETE"])
def meal_plan_slot(request: Request, plan_id: int, day_index: int, meal_type: str) -> Response:
    with transaction.atomic():
        plan = get_locked_plan_for_user(user=authenticated_user(request), plan_id=plan_id)
        validate_slot_target(plan, day_index, meal_type)
        if request.method == "DELETE":
            remove_slot(plan, day_index, meal_type)
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = SlotWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        slot = write_slot(
            plan,
            day_index,
            meal_type,
            serializer.validated_data["recipe_id"],
            serializer.validated_data["servings"],
        )
    return Response(MealPlanSlotSerializer(slot).data)
