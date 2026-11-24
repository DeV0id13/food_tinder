from datetime import UTC, datetime, time, timedelta
from typing import Literal
from uuid import UUID, uuid4

from django.db import transaction
from django.utils import timezone as django_timezone
from rest_framework import status
from rest_framework.exceptions import APIException

from apps.accounts.models import User
from apps.catalog.selectors import get_recipe

from .models import LastSwipe, UserRecipeState

UNDO_WINDOW = timedelta(seconds=5)


class SwipeUndoConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This swipe can no longer be undone."


def _next_midnight_utc(now: datetime) -> datetime:
    utc_now = now.astimezone(UTC)
    tomorrow = utc_now.date() + timedelta(days=1)
    return datetime.combine(tomorrow, time.min, tzinfo=UTC)


def _lock_preferences(user: User) -> None:
    # Serialize new swipes, undo and bookmark writes even when there is no state row yet.
    User.objects.select_for_update().only("pk").get(pk=user.pk)


def record_swipe(
    user: User, recipe_id: int, action: Literal["like", "dislike"], session_hash: str
) -> tuple[UserRecipeState, UUID, int]:
    recipe = get_recipe(recipe_id)
    with transaction.atomic():
        _lock_preferences(user)
        state, created = UserRecipeState.objects.select_for_update().get_or_create(
            user=user, recipe=recipe
        )
        now = django_timezone.now()
        swipe, _ = LastSwipe.objects.update_or_create(
            user=user,
            defaults={
                "state": state,
                "state_created": created,
                "token": uuid4(),
                "session_hash": session_hash,
                "liked_at": state.liked_at,
                "disliked_until": state.disliked_until,
                "is_favorite": state.is_favorite,
                "favorited_at": state.favorited_at,
                "swiped_at": now,
            },
        )
        if action == "like":
            if state.liked_at is None:
                state.liked_at = now
            state.disliked_until = None
            if not state.is_favorite:
                state.is_favorite = True
                state.favorited_at = now
            state.save(update_fields=("liked_at", "disliked_until", "is_favorite", "favorited_at"))
        else:
            state.disliked_until = _next_midnight_utc(now)
            state.save(update_fields=("disliked_until",))

    remaining_ms = max(0, int((now + UNDO_WINDOW - django_timezone.now()).total_seconds() * 1000))
    return state, swipe.token, remaining_ms


def reverse_swipe(user: User, undo_token: UUID, session_hash: str) -> UserRecipeState:
    with transaction.atomic():
        _lock_preferences(user)
        swipe = LastSwipe.objects.filter(
            user=user,
            token=undo_token,
            session_hash=session_hash,
        ).first()
        state = (
            UserRecipeState.objects.select_for_update().filter(pk=swipe.state_id).first()
            if swipe is not None
            else None
        )
        if (
            swipe is None
            or state is None
            or swipe.swiped_at is None
            or django_timezone.now() >= swipe.swiped_at + UNDO_WINDOW
        ):
            raise SwipeUndoConflict
        state.liked_at = swipe.liked_at
        state.disliked_until = swipe.disliked_until
        state.is_favorite = swipe.is_favorite
        state.favorited_at = swipe.favorited_at
        swipe.delete()
        if swipe.state_created:
            state.delete()
        else:
            state.save(update_fields=("liked_at", "disliked_until", "is_favorite", "favorited_at"))
    return state


def set_favorite(user: User, recipe_id: int, is_favorite: bool) -> UserRecipeState:
    recipe = get_recipe(recipe_id, active_only=is_favorite)

    with transaction.atomic():
        _lock_preferences(user)
        state, _ = UserRecipeState.objects.select_for_update().get_or_create(
            user=user, recipe=recipe
        )
        if state.is_favorite != is_favorite:
            state.is_favorite = is_favorite
            state.favorited_at = django_timezone.now() if is_favorite else None
            state.save(update_fields=("is_favorite", "favorited_at"))
            LastSwipe.objects.filter(user=user, state=state).delete()

    return state
