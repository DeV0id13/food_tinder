from uuid import uuid4

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
    favorited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "recipe"),
                name="preferences_user_recipe_unique",
            ),
        ]


class LastSwipe(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    state = models.ForeignKey(UserRecipeState, on_delete=models.CASCADE)
    state_created = models.BooleanField()
    token = models.UUIDField(default=uuid4, editable=False)
    session_hash = models.CharField(max_length=64)
    liked_at = models.DateTimeField(null=True)
    disliked_until = models.DateTimeField(null=True)
    is_favorite = models.BooleanField()
    favorited_at = models.DateTimeField(null=True)
    swiped_at = models.DateTimeField(null=True)
