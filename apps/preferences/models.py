from django.conf import settings
from django.db import models


class UserRecipeState(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="recipe_states",
    )
    recipe = models.ForeignKey(
        "catalog.Recipe",
        on_delete=models.CASCADE,
        related_name="user_states",
    )
    liked_at = models.DateTimeField(null=True, blank=True)
    disliked_until = models.DateTimeField(null=True, blank=True)
    is_favorite = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "recipe"),
                name="preferences_user_recipe_unique",
            ),
        ]
