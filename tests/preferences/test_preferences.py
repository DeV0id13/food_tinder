from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APIClient

from apps.preferences.models import UserRecipeState

pytestmark = pytest.mark.django_db

BASE = "/api/v1/preferences/"
PASSWORD = "Valid_pass123"


def create_user(email):
    return get_user_model().objects.create_user(email=email, password=PASSWORD)


def client_for(user=None):
    client = APIClient()
    if user is not None:
        client.force_login(user)
    return client


def test_state_is_unique_per_user_recipe():
    user = create_user("a@example.com")
    state = UserRecipeState.objects.create(user=user, recipe_id=1)
    assert UserRecipeState.objects.filter(user=user, recipe_id=1).count() == 1
    assert state.is_favorite is False


def test_like_is_idempotent_and_clears_dislike():
    user = create_user("a@example.com")
    client = client_for(user)

    with patch("apps.preferences.views._active_recipe_or_404") as recipe:
        recipe.return_value.id = 10
        with patch("apps.preferences.views.django_timezone.now") as now:
            now.return_value = datetime(2026, 9, 25, 10, 0, tzinfo=timezone.utc)
            first = client.post(f"{BASE}swipes/", {"recipe_id": 10, "action": "like"}, format="json")
            second = client.post(f"{BASE}swipes/", {"recipe_id": 10, "action": "like"}, format="json")

    assert first.status_code == 200
    assert second.status_code == 200
    state = UserRecipeState.objects.get(user=user, recipe_id=10)
    assert state.liked_at == datetime(2026, 9, 25, 10, 0, tzinfo=timezone.utc)
    assert state.disliked_until is None


def test_dislike_ends_at_next_utc_midnight():
    user = create_user("a@example.com")
    client = client_for(user)

    with patch("apps.preferences.views._active_recipe_or_404") as recipe:
        recipe.return_value.id = 10
        with patch("apps.preferences.views.django_timezone.now") as now:
            now.return_value = datetime(2026, 9, 25, 23, 59, tzinfo=timezone.utc)
            response = client.post(
                f"{BASE}swipes/",
                {"recipe_id": 10, "action": "dislike"},
                format="json",
            )

    assert response.status_code == 200
    state = UserRecipeState.objects.get(user=user, recipe_id=10)
    assert state.disliked_until == datetime(2026, 9, 26, 0, 0, tzinfo=timezone.utc)


def test_favorite_does_not_like_and_can_be_removed_without_removing_like():
    user = create_user("a@example.com")
    client = client_for(user)

    with patch("apps.preferences.views._recipe_or_404") as recipe:
        recipe.return_value.id = 10
        recipe.return_value.is_active = True
        with patch("apps.preferences.views.UserRecipeState.objects.select_for_update") as manager:
            pass

    state = UserRecipeState.objects.create(user=user, recipe_id=10, liked_at=datetime.now(timezone.utc))
    assert state.is_favorite is False
