from django.utils.crypto import salted_hmac
from django.views.decorators.cache import never_cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.authentication import authenticated_user
from common.pagination import StandardPagination

from .selectors import favorite_recipes, feed_recipes
from .serializers import (
    FavoriteRecipeSerializer,
    FavoriteSerializer,
    RecipeStateSerializer,
    RecipeSummarySerializer,
    SwipeSerializer,
    UndoSwipeSerializer,
)
from .services import record_swipe, reverse_swipe, set_favorite


def _session_hash(request: Request) -> str:
    return salted_hmac(
        "preferences.swipe-undo", request.session.session_key or "", algorithm="sha256"
    ).hexdigest()


@never_cache
@api_view(["GET"])
@permission_classes([AllowAny])
def feed(request: Request) -> Response:
    paginator = StandardPagination()
    page = paginator.paginate_queryset(feed_recipes(request.user), request)
    return paginator.get_paginated_response(RecipeSummarySerializer(page, many=True).data)


@never_cache
@api_view(["POST"])
def swipes(request: Request) -> Response:
    serializer = SwipeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    state, token, remaining_ms = record_swipe(
        authenticated_user(request),
        serializer.validated_data["recipe_id"],
        serializer.validated_data["action"],
        _session_hash(request),
    )
    return Response(
        {
            **RecipeStateSerializer(state).data,
            "undo_token": str(token),
            "undo_remaining_ms": remaining_ms,
        }
    )


@never_cache
@api_view(["POST"])
def undo_swipe(request: Request) -> Response:
    serializer = UndoSwipeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    state = reverse_swipe(
        authenticated_user(request), serializer.validated_data["undo_token"], _session_hash(request)
    )
    return Response(RecipeStateSerializer(state).data)


@never_cache
@api_view(["PUT"])
def favorite(request: Request, recipe_id: int) -> Response:
    serializer = FavoriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    state = set_favorite(
        authenticated_user(request), recipe_id, serializer.validated_data["is_favorite"]
    )
    return Response(RecipeStateSerializer(state).data)


@never_cache
@api_view(["GET"])
def favorites(request: Request) -> Response:
    paginator = StandardPagination()
    page = paginator.paginate_queryset(favorite_recipes(authenticated_user(request)), request)
    return paginator.get_paginated_response(FavoriteRecipeSerializer(page, many=True).data)
