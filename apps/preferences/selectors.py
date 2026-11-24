from django.contrib.auth.models import AnonymousUser
from django.db.models import Exists, OuterRef, QuerySet, Subquery
from django.utils import timezone as django_timezone

from apps.accounts.models import User
from apps.catalog.models import Recipe
from apps.preferences.models import UserRecipeState


def is_favorite(*, user_id: int, recipe_id: int) -> bool:
    return UserRecipeState.objects.filter(
        user_id=user_id,
        recipe_id=recipe_id,
        is_favorite=True,
    ).exists()


def favorite_recipe_ids(*, user_id: int, recipe_ids: set[int]) -> set[int]:
    return set(
        UserRecipeState.objects.filter(
            user_id=user_id, recipe_id__in=recipe_ids, is_favorite=True
        ).values_list("recipe_id", flat=True)
    )


def feed_recipes(user: User | AnonymousUser) -> QuerySet[Recipe]:
    now = django_timezone.now()
    queryset = Recipe.objects.filter(is_active=True)

    if user.is_authenticated:
        own_states = UserRecipeState.objects.filter(user=user, recipe_id=OuterRef("pk"))
        queryset = queryset.annotate(
            has_like=Exists(own_states.filter(liked_at__isnull=False)),
            has_active_dislike=Exists(own_states.filter(disliked_until__gt=now)),
        ).filter(has_like=False, has_active_dislike=False)

    return queryset.order_by("id")


def favorite_recipes(user: User) -> QuerySet[Recipe]:
    state_queryset = UserRecipeState.objects.filter(
        user=user, recipe_id=OuterRef("pk"), is_favorite=True
    )
    return (
        Recipe.objects.filter(is_active=True)
        .alias(is_owned_favorite=Exists(state_queryset))
        .annotate(favorited_at=Subquery(state_queryset.values("favorited_at")[:1]))
        .filter(is_owned_favorite=True)
        .order_by("id")
    )
