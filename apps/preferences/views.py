from datetime import datetime, time, timedelta, timezone

from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone as django_timezone
from django.views.decorators.cache import never_cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.catalog.models import Recipe

from .models import UserRecipeState
from .serializers import (
    FavoriteSerializer,
    RecipeStateSerializer,
    RecipeSummarySerializer,
    SwipeSerializer,
)


class RecipePagination:
    default_limit = 30
    max_limit = 100

    def paginate_queryset(self, queryset, request):
        try:
            limit = int(request.query_params.get("limit", self.default_limit))
            offset = int(request.query_params.get("offset", 0))
        except (TypeError, ValueError):
            return None

        if not 1 <= limit <= self.max_limit or offset < 0:
            return None

        self.limit = limit
        self.offset = offset
        self.count = queryset.count()
        return list(queryset[self.offset : self.offset + self.limit])

    def get_paginated_response(self, data):
        next_offset = self.offset + self.limit
        previous_offset = max(self.offset - self.limit, 0)

        return Response(
            {
                "count": self.count,
                "next": next_offset if next_offset < self.count else None,
                "previous": previous_offset if self.offset > 0 else None,
                "results": data,
            }
        )


def _recipe_or_404(recipe_id):
    try:
        return Recipe.objects.get(pk=recipe_id)
    except Recipe.DoesNotExist as exc:
        raise NotFound from exc


def _active_recipe_or_404(recipe_id):
    recipe = _recipe_or_404(recipe_id)
    if not recipe.is_active:
        raise NotFound
    return recipe


def _next_midnight_utc(now):
    utc_now = now.astimezone(timezone.utc)
    tomorrow = utc_now.date() + timedelta(days=1)
    return datetime.combine(tomorrow, time.min, tzinfo=timezone.utc)


def _feed_queryset(user):
    now = django_timezone.now()
    queryset = Recipe.objects.filter(is_active=True)

    if user.is_authenticated:
        own_states = UserRecipeState.objects.filter(
            user=user,
            recipe_id=OuterRef("pk"),
        )
        queryset = queryset.annotate(
            has_like=Exists(own_states.filter(liked_at__isnull=False)),
            has_active_dislike=Exists(own_states.filter(disliked_until__gt=now)),
        ).filter(
            has_like=False,
            has_active_dislike=False,
        )

    return queryset.order_by("id")


def _state_response(state):
    return Response(RecipeStateSerializer(state).data)


@never_cache
@api_view(["GET"])
@permission_classes([AllowAny])
def feed(request):
    queryset = _feed_queryset(request.user)
    paginator = RecipePagination()
    page = paginator.paginate_queryset(queryset, request)

    if page is None:
        return Response(
            {"non_field_errors": ["Invalid pagination parameters."]},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return paginator.get_paginated_response(
        RecipeSummarySerializer(page, many=True).data
    )


@never_cache
@api_view(["POST"])
def swipes(request):
    serializer = SwipeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    recipe = _active_recipe_or_404(serializer.validated_data["recipe_id"])
    action = serializer.validated_data["action"]
    now = django_timezone.now()

    with transaction.atomic():
        state, _ = UserRecipeState.objects.select_for_update().get_or_create(
            user=request.user,
            recipe=recipe,
        )

        if action == "like":
            if state.liked_at is None:
                state.liked_at = now
            state.disliked_until = None
        else:
            state.disliked_until = _next_midnight_utc(now)

        state.save(update_fields=("liked_at", "disliked_until"))

    return _state_response(state)


@never_cache
@api_view(["PUT"])
def favorite(request, recipe_id):
    serializer = FavoriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    recipe = _recipe_or_404(recipe_id)
    is_favorite_value = serializer.validated_data["is_favorite"]

    if is_favorite_value and not recipe.is_active:
        raise NotFound

    with transaction.atomic():
        state, _ = UserRecipeState.objects.select_for_update().get_or_create(
            user=request.user,
            recipe=recipe,
        )
        state.is_favorite = is_favorite_value
        state.save(update_fields=("is_favorite",))

    return _state_response(state)


@never_cache
@api_view(["GET"])
def favorites(request):
    state_queryset = UserRecipeState.objects.filter(
        user=request.user,
        recipe_id=OuterRef("pk"),
        is_favorite=True,
    )
    queryset = (
        Recipe.objects.filter(is_active=True)
        .annotate(is_owned_favorite=Exists(state_queryset))
        .filter(is_owned_favorite=True)
        .order_by("id")
    )

    paginator = RecipePagination()
    page = paginator.paginate_queryset(queryset, request)

    if page is None:
        return Response(
            {"non_field_errors": ["Invalid pagination parameters."]},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return paginator.get_paginated_response(
        RecipeSummarySerializer(page, many=True).data
    )
