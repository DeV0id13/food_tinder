from apps.preferences.models import UserRecipeState


def is_favorite(*, user_id: int, recipe_id: int) -> bool:
    return UserRecipeState.objects.filter(
        user_id=user_id,
        recipe_id=recipe_id,
        is_favorite=True,
    ).exists()
