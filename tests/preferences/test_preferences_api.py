from datetime import datetime, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.urls import include, path
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import Recipe
from apps.preferences.models import UserRecipeState
from apps.preferences.selectors import is_favorite

pytestmark = pytest.mark.django_db
BASE = "/api/v1/preferences/"
PASSWORD = "Valid_pass123"
urlpatterns = [path("api/v1/preferences/", include("apps.preferences.urls"))]


@override_settings(ROOT_URLCONF=__name__)
class TestPreferencesAPI:
    def setup_method(self):
        self.client = APIClient()

    def create_user(self, email="reader@example.com"):
        return get_user_model().objects.create_user(email=email, password=PASSWORD)

    def create_recipe(self, *, number=1, is_active=True):
        return Recipe.objects.create(
            slug=f"recipe-{number}", title=f"Recipe {number}",
            description="Test recipe", image_url="", cooking_time_minutes=20,
            difficulty=2, base_servings=2, meal_types=["lunch"],
            steps=["Prepare", "Serve"], is_active=is_active,
            kcal_per_serving=Decimal("100.00"), protein_g_per_serving=Decimal("10.00"),
            fat_g_per_serving=Decimal("5.00"), carbs_g_per_serving=Decimal("12.00"),
            estimated_price_rub_per_serving=Decimal("50.00"),
        )

    def login(self, user):
        self.client.force_login(user)

    def test_feed_is_public_and_returns_active_recipes_only(self):
        active = self.create_recipe()
        self.create_recipe(number=2, is_active=False)
        response = self.client.get(BASE + "feed/")
        assert response.status_code == 200
        assert response.json()["count"] == 1
        assert [x["id"] for x in response.json()["results"]] == [active.id]

    def test_feed_excludes_liked_active_disliked_but_not_favorite(self):
        user = self.create_user()
        liked, disliked = self.create_recipe(), self.create_recipe(number=2)
        favorite, visible = self.create_recipe(number=3), self.create_recipe(number=4)
        UserRecipeState.objects.create(user=user, recipe=liked, liked_at=timezone.now())
        UserRecipeState.objects.create(user=user, recipe=disliked,
            disliked_until=datetime(2026, 9, 26, tzinfo=dt_timezone.utc))
        UserRecipeState.objects.create(user=user, recipe=favorite, is_favorite=True)
        self.login(user)
        response = self.client.get(BASE + "feed/")
        assert response.status_code == 200
        assert [x["id"] for x in response.json()["results"]] == [favorite.id, visible.id]

    def test_like_sets_timestamp_and_clears_dislike(self):
        user, recipe = self.create_user(), self.create_recipe()
        UserRecipeState.objects.create(user=user, recipe=recipe,
            disliked_until=datetime(2026, 9, 26, tzinfo=dt_timezone.utc))
        self.login(user)
        now = datetime(2026, 9, 25, 12, tzinfo=dt_timezone.utc)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("apps.preferences.views.django_timezone.now", lambda: now)
            response = self.client.post(BASE+"swipes/",
                {"recipe_id": recipe.id, "action": "like"}, format="json")
        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.liked_at == now
        assert state.disliked_until is None

    @pytest.mark.parametrize("payload", [
        {}, {"recipe_id": 1}, {"recipe_id": 1, "action": "neutral"},
        {"recipe_id": 0, "action": "like"},
        {"recipe_id": 1, "action": "like", "unknown": True},
        {"recipe_id": 1, "action": "like", "user_id": 999},
    ])
    def test_swipes_reject_invalid_or_unknown_fields(self, payload):
        self.login(self.create_user())
        assert self.client.post(BASE+"swipes/", payload, format="json").status_code == 400

    @pytest.mark.parametrize("payload", [
        {}, {"is_favorite": "yes"}, {"is_favorite": 1},
        {"is_favorite": True, "unknown": True},
        {"is_favorite": False, "user_id": 999},
    ])
    def test_favorite_rejects_non_boolean_or_unknown_fields(self, payload):
        user, recipe = self.create_user(), self.create_recipe()
        self.login(user)
        assert self.client.put(f"{BASE}favorites/{recipe.id}/",
            payload, format="json").status_code == 400

    def test_favorite_is_independent_from_like_and_dislike(self):
        user, recipe = self.create_user(), self.create_recipe()
        liked_at = datetime(2026, 9, 25, 9, tzinfo=dt_timezone.utc)
        disliked_until = datetime(2026, 9, 26, tzinfo=dt_timezone.utc)
        UserRecipeState.objects.create(user=user, recipe=recipe,
            liked_at=liked_at, disliked_until=disliked_until)
        self.login(user)
        response = self.client.put(f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": True}, format="json")
        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.is_favorite is True
        assert state.liked_at == liked_at
        assert state.disliked_until == disliked_until

    def test_favorites_are_scoped_to_user_and_active_recipes(self):
        user, other = self.create_user(), self.create_user("other@example.com")
        first = self.create_recipe()
        inactive = self.create_recipe(number=2, is_active=False)
        foreign = self.create_recipe(number=3)
        UserRecipeState.objects.create(user=user, recipe=first, is_favorite=True)
        UserRecipeState.objects.create(user=user, recipe=inactive, is_favorite=True)
        UserRecipeState.objects.create(user=other, recipe=foreign, is_favorite=True)
        self.login(user)
        response = self.client.get(BASE+"favorites/")
        assert response.status_code == 200
        assert [x["id"] for x in response.json()["results"]] == [first.id]

    def test_pagination_uses_drf_limit_offset_semantics(self):
        user = self.create_user()
        recipes = [self.create_recipe(number=i) for i in range(1, 4)]
        UserRecipeState.objects.bulk_create([
            UserRecipeState(user=user, recipe=recipe, is_favorite=True)
            for recipe in recipes
        ])
        self.login(user)
        response = self.client.get(BASE+"favorites/?limit=2&offset=1")
        data = response.json()
        assert response.status_code == 200
        assert data["count"] == 3
        assert [x["id"] for x in data["results"]] == [recipes[1].id, recipes[2].id]
        assert data["next"].startswith("http")
        assert data["previous"].startswith("http")
        assert "offset=0" in data["previous"]

    def test_limit_above_max_is_capped_by_drf(self):
        for i in range(1, 102):
            self.create_recipe(number=i)
        response = self.client.get(BASE+"feed/?limit=101")
        assert response.status_code == 200
        assert len(response.json()["results"]) == 100

    def test_unique_constraint_raises_integrity_error(self):
        user, recipe = self.create_user(), self.create_recipe()
        UserRecipeState.objects.create(user=user, recipe=recipe)
        with transaction.atomic(), pytest.raises(IntegrityError):
            UserRecipeState.objects.create(user=user, recipe=recipe)

    def test_is_favorite_selector_is_scoped_to_user(self):
        first = self.create_user("first@example.com")
        second = self.create_user("second@example.com")
        recipe = self.create_recipe()
        UserRecipeState.objects.create(user=first, recipe=recipe, is_favorite=True)
        assert is_favorite(user_id=first.id, recipe_id=recipe.id) is True
        assert is_favorite(user_id=second.id, recipe_id=recipe.id) is False
