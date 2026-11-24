from rest_framework.exceptions import NotFound

from .models import Recipe


def get_recipe(recipe_id: int, *, active_only: bool = True) -> Recipe:
    recipes = Recipe.objects.all()
    if active_only:
        recipes = recipes.filter(is_active=True)
    try:
        return recipes.get(pk=recipe_id)
    except Recipe.DoesNotExist as exc:
        raise NotFound from exc
