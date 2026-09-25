from datetime import datetime, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
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

urlpatterns = [
    path("api/v1/preferences/", include("apps.preferences.urls")),
]


@override_settings(ROOT_URLCONF=__name__)
class TestPreferencesAPI:
    def setup_method(self):
        self.client = APIClient()

    def create_user(self, email="reader@example.com"):
        return get_user_model().objects.create_user(email=email, password=PASSWORD)

    def create_recipe(
        self,
        *,
        number=1,
        title=None,
        is_active=True,
        meal_types=None,
    ):
        return Recipe.objects.create(
            slug=f"recipe-{number}",
            title=title or f"Recipe {number}",
            description="Test recipe",
            image_url="",
            cooking_time_minutes=20,
            difficulty=2,
            base_servings=2,
            meal_types=meal_types or ["lunch"],
            steps=["Prepare", "Serve"],
            is_active=is_active,
            kcal_per_serving=Decimal("100.00"),
            protein_g_per_serving=Decimal("10.00"),
            fat_g_per_serving=Decimal("5.00"),
            carbs_g_per_serving=Decimal("12.00"),
            estimated_price_rub_per_serving=Decimal("50.00"),
        )

    def login(self, user):
        self.client.force_login(user)

    def test_feed_is_public_and_returns_active_recipes_only(self):
        active = self.create_recipe(number=1)
        self.create_recipe(number=2, is_active=False)

        response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert response.json()["count"] == 1
        assert [item["id"] for item in response.json()["results"]] == [active.id]

    def test_feed_is_sorted_by_recipe_id(self):
        first = self.create_recipe(number=1)
        second = self.create_recipe(number=2)

        response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [first.id, second.id]

    def test_feed_excludes_liked_and_active_disliked_but_not_favorite(self):
        user = self.create_user()
        liked = self.create_recipe(number=1)
        disliked = self.create_recipe(number=2)
        favorite = self.create_recipe(number=3)
        visible = self.create_recipe(number=4)

        UserRecipeState.objects.create(user=user, recipe=liked, liked_at=timezone.now())
        UserRecipeState.objects.create(
            user=user,
            recipe=disliked,
            disliked_until=datetime(2026, 9, 26, tzinfo=dt_timezone.utc),
        )
        UserRecipeState.objects.create(user=user, recipe=favorite, is_favorite=True)

        self.login(user)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: datetime(2026, 9, 25, 12, tzinfo=dt_timezone.utc),
            )
            response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [favorite.id, visible.id]

    def test_expired_dislike_is_visible_again(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            disliked_until=datetime(2026, 9, 25, 0, 0, tzinfo=dt_timezone.utc),
        )

        self.login(user)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: datetime(2026, 9, 25, 0, 1, tzinfo=dt_timezone.utc),
            )
            response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [recipe.id]

    def test_like_sets_liked_at_and_does_not_add_favorite(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.login(user)

        now = datetime(2026, 9, 25, 12, 34, tzinfo=dt_timezone.utc)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("apps.preferences.views.django_timezone.now", lambda: now)
            response = self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "like"},
                format="json",
            )

        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.liked_at == now
        assert state.disliked_until is None
        assert state.is_favorite is False
        assert response.json()["recipe_id"] == recipe.id

    def test_repeated_like_keeps_original_timestamp(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.login(user)

        first_time = datetime(2026, 9, 25, 10, tzinfo=dt_timezone.utc)
        second_time = datetime(2026, 9, 25, 11, tzinfo=dt_timezone.utc)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("apps.preferences.views.django_timezone.now", lambda: first_time)
            assert self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "like"},
                format="json",
            ).status_code == 200

            mp.setattr("apps.preferences.views.django_timezone.now", lambda: second_time)
            assert self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "like"},
                format="json",
            ).status_code == 200

        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.liked_at == first_time
        assert UserRecipeState.objects.filter(user=user, recipe=recipe).count() == 1

    def test_like_clears_active_dislike(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            disliked_until=datetime(2026, 9, 26, tzinfo=dt_timezone.utc),
        )
        self.login(user)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: datetime(2026, 9, 25, 12, tzinfo=dt_timezone.utc),
            )
            response = self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "like"},
                format="json",
            )

        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.liked_at is not None
        assert state.disliked_until is None

    def test_dislike_is_valid_until_next_utc_midnight(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.login(user)

        now = datetime(2026, 9, 25, 23, 59, tzinfo=dt_timezone.utc)
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("apps.preferences.views.django_timezone.now", lambda: now)
            response = self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "dislike"},
                format="json",
            )

        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.disliked_until == datetime(
            2026, 9, 26, 0, 0, tzinfo=dt_timezone.utc
        )

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"recipe_id": 1},
            {"recipe_id": 1, "action": "neutral"},
            {"recipe_id": 0, "action": "like"},
            {"recipe_id": 1, "action": "like", "unknown": True},
        ],
    )
    def test_swipes_reject_invalid_payload(self, payload):
        user = self.create_user()
        self.login(user)

        response = self.client.post(BASE + "swipes/", payload, format="json")

        assert response.status_code == 400

    def test_swipe_requires_authentication(self):
        recipe = self.create_recipe()

        response = self.client.post(
            BASE + "swipes/",
            {"recipe_id": recipe.id, "action": "like"},
            format="json",
        )

        assert response.status_code == 403
        assert not UserRecipeState.objects.exists()

    def test_swipe_missing_recipe_returns_404(self):
        user = self.create_user()
        self.login(user)

        response = self.client.post(
            BASE + "swipes/",
            {"recipe_id": 999999, "action": "like"},
            format="json",
        )

        assert response.status_code == 404

    def test_swipe_inactive_recipe_returns_404(self):
        user = self.create_user()
        recipe = self.create_recipe(is_active=False)
        self.login(user)

        response = self.client.post(
            BASE + "swipes/",
            {"recipe_id": recipe.id, "action": "like"},
            format="json",
        )

        assert response.status_code == 404
        assert not UserRecipeState.objects.exists()

    def test_favorite_true_does_not_change_like_or_dislike(self):
        user = self.create_user()
        recipe = self.create_recipe()
        liked_at = datetime(2026, 9, 25, 9, tzinfo=dt_timezone.utc)
        disliked_until = datetime(2026, 9, 26, tzinfo=dt_timezone.utc)
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            liked_at=liked_at,
            disliked_until=disliked_until,
        )
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": True},
            format="json",
        )

        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.is_favorite is True
        assert state.liked_at == liked_at
        assert state.disliked_until == disliked_until

    def test_favorite_can_be_removed_without_removing_like(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            liked_at=timezone.now(),
            is_favorite=True,
        )
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": False},
            format="json",
        )

        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.is_favorite is False
        assert state.liked_at is not None

    def test_favorite_true_for_inactive_recipe_returns_404(self):
        user = self.create_user()
        recipe = self.create_recipe(is_active=False)
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": True},
            format="json",
        )

        assert response.status_code == 404

    def test_favorite_false_for_inactive_recipe_is_allowed(self):
        user = self.create_user()
        recipe = self.create_recipe(is_active=False)
        UserRecipeState.objects.create(user=user, recipe=recipe, is_favorite=True)
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": False},
            format="json",
        )

        assert response.status_code == 200
        assert not UserRecipeState.objects.get(user=user, recipe=recipe).is_favorite

    def test_favorites_list_contains_only_current_users_active_favorites(self):
        user = self.create_user()
        other = self.create_user("other@example.com")
        first = self.create_recipe(number=1)
        second = self.create_recipe(number=2)
        inactive = self.create_recipe(number=3, is_active=False)
        foreign = self.create_recipe(number=4)

        UserRecipeState.objects.create(user=user, recipe=first, is_favorite=True)
        UserRecipeState.objects.create(user=user, recipe=inactive, is_favorite=True)
        UserRecipeState.objects.create(user=other, recipe=foreign, is_favorite=True)

        self.login(user)
        response = self.client.get(BASE + "favorites/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [first.id]
        assert second.id not in [item["id"] for item in response.json()["results"]]

    def test_favorites_are_sorted_and_paginated(self):
        user = self.create_user()
        recipes = [self.create_recipe(number=i) for i in range(1, 5)]
        UserRecipeState.objects.bulk_create(
            [
                UserRecipeState(user=user, recipe=recipe, is_favorite=True)
                for recipe in recipes
            ]
        )
        self.login(user)

        response = self.client.get(BASE + "favorites/?limit=2&offset=1")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 4
        assert data["results"] and [item["id"] for item in data["results"]] == [
            recipes[1].id,
            recipes[2].id,
        ]
        assert data["previous"] == 0
        assert data["next"] == 3

    @pytest.mark.parametrize(
        "query",
        ["limit=0", "limit=101", "limit=-1", "offset=-1", "limit=abc", "offset=abc"],
    )
    def test_invalid_pagination_returns_400(self, query):
        response = self.client.get(f"{BASE}feed/?{query}")
        assert response.status_code == 400

    def test_pagination_defaults_to_30_and_returns_next_offset(self):
        for number in range(1, 32):
            self.create_recipe(number=number)

        response = self.client.get(BASE + "feed/?limit=30")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 31
        assert len(data["results"]) == 30
        assert data["next"] == 30
        assert data["previous"] is None

    def test_pagination_next_and_previous_are_offsets(self):
        for number in range(1, 5):
            self.create_recipe(number=number)

        response = self.client.get(BASE + "feed/?limit=2&offset=2")

        assert response.status_code == 200
        data = response.json()
        assert [item["id"] for item in data["results"]] == [3, 4]
        assert data["previous"] == 0
        assert data["next"] is None

    def test_users_have_isolated_states(self):
        first_user = self.create_user("first@example.com")
        second_user = self.create_user("second@example.com")
        recipe = self.create_recipe()

        UserRecipeState.objects.create(user=first_user, recipe=recipe, is_favorite=True)

        self.login(second_user)
        response = self.client.get(BASE + "favorites/")

        assert response.status_code == 200
        assert response.json()["results"] == []

    def test_is_favorite_selector_is_scoped_to_user(self):
        first_user = self.create_user("first@example.com")
        second_user = self.create_user("second@example.com")
        recipe = self.create_recipe()

        UserRecipeState.objects.create(user=first_user, recipe=recipe, is_favorite=True)

        assert is_favorite(user_id=first_user.id, recipe_id=recipe.id) is True
        assert is_favorite(user_id=second_user.id, recipe_id=recipe.id) is False

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"is_favorite": "yes"},
            {"is_favorite": 1, "unknown": True},
        ],
    )
    def test_favorite_rejects_invalid_payload(self, payload):
        user = self.create_user()
        recipe = self.create_recipe()
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            payload,
            format="json",
        )

        assert response.status_code == 400

    def test_favorite_requires_authentication(self):
        recipe = self.create_recipe()

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": True},
            format="json",
        )

        assert response.status_code == 403

    def test_favorite_missing_recipe_returns_404(self):
        user = self.create_user()
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/999999/",
            {"is_favorite": True},
            format="json",
        )

        assert response.status_code == 404

    def test_recipe_state_unique_constraint(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(user=user, recipe=recipe)

        with pytest.raises(Exception):
            UserRecipeState.objects.create(user=user, recipe=recipe)

    def test_feed_for_guest_does_not_use_any_user_state(self):
        recipe = self.create_recipe()
        user = self.create_user()
        UserRecipeState.objects.create(user=user, recipe=recipe, liked_at=timezone.now())

        response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [recipe.id]
