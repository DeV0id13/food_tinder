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
