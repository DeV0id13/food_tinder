from datetime import UTC, datetime, time, timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone as django_timezone
from django.utils.crypto import salted_hmac
from django.views.decorators.cache import never_cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.catalog.models import Recipe

from .models import LastSwipe, UserRecipeState
from .serializers import (
    FavoriteSerializer,
    RecipeStateSerializer,
    RecipeSummarySerializer,
    SwipeSerializer,
    UndoSwipeSerializer,
)


class RecipePagination(LimitOffsetPagination):
    default_limit = 30
    max_limit = 100


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
    utc_now = now.astimezone(UTC)
    tomorrow = utc_now.date() + timedelta(days=1)
    return datetime.combine(tomorrow, time.min, tzinfo=UTC)


def _feed_queryset(user):
    now = django_timezone.now()
    queryset = Recipe.objects.filter(is_active=True)

    if user.is_authenticated:
        own_states = UserRecipeState.objects.filter(user=user, recipe_id=OuterRef("pk"))
        queryset = queryset.annotate(
            has_like=Exists(own_states.filter(liked_at__isnull=False)),
            has_active_dislike=Exists(own_states.filter(disliked_until__gt=now)),
        ).filter(has_like=False, has_active_dislike=False)

    return queryset.order_by("id")


def _state_response(state):
    return Response(RecipeStateSerializer(state).data)


def _lock_preferences(user):
    # Serialize new swipes, undo and bookmark writes even when there is no state row yet.
    get_user_model().objects.select_for_update().only("pk").get(pk=user.pk)


def _session_hash(request):
    return salted_hmac(
        "preferences.swipe-undo", request.session.session_key or "", algorithm="sha256"
    ).hexdigest()


@never_cache
@api_view(["GET"])
@permission_classes([AllowAny])
def feed(request):
    paginator = RecipePagination()
    page: list[Recipe] | None = paginator.paginate_queryset(
        _feed_queryset(request.user), request, view=None
    )
    return paginator.get_paginated_response(RecipeSummarySerializer(page, many=True).data)


@never_cache
@api_view(["POST"])
def swipes(request):
    serializer = SwipeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    recipe = _active_recipe_or_404(serializer.validated_data["recipe_id"])
    action = serializer.validated_data["action"]
    with transaction.atomic():
        _lock_preferences(request.user)
        state, created = UserRecipeState.objects.select_for_update().get_or_create(
            user=request.user, recipe=recipe
        )
        swipe, _ = LastSwipe.objects.update_or_create(
            user=request.user,
            defaults={
                "state": state,
                "state_created": created,
                "token": uuid4(),
                "session_hash": _session_hash(request),
                "liked_at": state.liked_at,
                "disliked_until": state.disliked_until,
                "is_favorite": state.is_favorite,
            },
        )
        now = django_timezone.now()
        if action == "like":
            if state.liked_at is None:
                state.liked_at = now
            state.disliked_until = None
            state.is_favorite = True
            state.save(update_fields=("liked_at", "disliked_until", "is_favorite"))
        else:
            state.disliked_until = _next_midnight_utc(now)
            state.save(update_fields=("disliked_until",))

    return Response({**RecipeStateSerializer(state).data, "undo_token": str(swipe.token)})


@never_cache
@api_view(["POST"])
def undo_swipe(request):
    serializer = UndoSwipeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        _lock_preferences(request.user)
        swipe = LastSwipe.objects.filter(
            user=request.user,
            token=serializer.validated_data["undo_token"],
            session_hash=_session_hash(request),
        ).first()
        state = (
            UserRecipeState.objects.select_for_update().filter(pk=swipe.state_id).first()
            if swipe is not None
            else None
        )
        if swipe is None or state is None:
            return Response(
                {"detail": "This swipe can no longer be undone."},
                status=status.HTTP_409_CONFLICT,
            )
        state.liked_at = swipe.liked_at
        state.disliked_until = swipe.disliked_until
        state.is_favorite = swipe.is_favorite
        swipe.delete()
        if swipe.state_created:
            state.delete()
        else:
            state.save(update_fields=("liked_at", "disliked_until", "is_favorite"))
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
        _lock_preferences(request.user)
        state, _ = UserRecipeState.objects.select_for_update().get_or_create(
            user=request.user, recipe=recipe
        )
        if state.is_favorite != is_favorite_value:
            state.is_favorite = is_favorite_value
            state.save(update_fields=("is_favorite",))
            LastSwipe.objects.filter(user=request.user, state=state).delete()

    return _state_response(state)


@never_cache
@api_view(["GET"])
def favorites(request):
    state_queryset = UserRecipeState.objects.filter(
        user=request.user, recipe_id=OuterRef("pk"), is_favorite=True
    )
    queryset = (
        Recipe.objects.filter(is_active=True)
        .annotate(is_owned_favorite=Exists(state_queryset))
        .filter(is_owned_favorite=True)
        .order_by("id")
    )
    paginator = RecipePagination()
    page: list[Recipe] | None = paginator.paginate_queryset(queryset, request, view=None)
    return paginator.get_paginated_response(RecipeSummarySerializer(page, many=True).data)
