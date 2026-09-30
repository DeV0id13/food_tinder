from datetime import UTC, datetime
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.catalog.models import Recipe
from apps.preferences.models import UserRecipeState
from apps.preferences.selectors import is_favorite

pytestmark = pytest.mark.django_db

BASE = "/api/v1/preferences/"
PASSWORD = "Valid_pass123"
BEFORE_MIDNIGHT = datetime(2026, 9, 25, 12, tzinfo=UTC)
MIDNIGHT = datetime(2026, 9, 26, tzinfo=UTC)


@pytest.fixture(autouse=True)
def preferences_urls(settings):
    settings.ROOT_URLCONF = "tests.preferences.urls"


class TestPreferencesAPI:
    def setup_method(self):
        self.client = APIClient()

    def create_user(self, email="reader@example.com"):
        return get_user_model().objects.create_user(
            email=email,
            password=PASSWORD,
        )

    def create_recipe(self, *, number=1, is_active=True):
        return Recipe.objects.create(
            slug=f"recipe-{number}",
            title=f"Recipe {number}",
            description="Test recipe",
            image_url="",
            cooking_time_minutes=20,
            difficulty=2,
            base_servings=2,
            meal_types=["lunch"],
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
        active = self.create_recipe()
        self.create_recipe(number=2, is_active=False)

        response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert response.json()["count"] == 1
        assert [item["id"] for item in response.json()["results"]] == [active.id]

    def test_feed_is_sorted_by_recipe_id(self):
        user = self.create_user()
        recipes = [self.create_recipe(number=i) for i in range(3, 0, -1)]
        self.login(user)

        response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == sorted(
            recipe.id for recipe in recipes
        )

    def test_feed_excludes_liked_and_active_disliked_but_not_favorite(self):
        user = self.create_user()
        liked = self.create_recipe()
        disliked = self.create_recipe(number=2)
        favorite = self.create_recipe(number=3)
        visible = self.create_recipe(number=4)

        UserRecipeState.objects.create(
            user=user,
            recipe=liked,
            liked_at=BEFORE_MIDNIGHT,
        )
        UserRecipeState.objects.create(
            user=user,
            recipe=disliked,
            disliked_until=MIDNIGHT,
        )
        UserRecipeState.objects.create(
            user=user,
            recipe=favorite,
            is_favorite=True,
        )
        self.login(user)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: BEFORE_MIDNIGHT,
            )
            response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [
            favorite.id,
            visible.id,
        ]

    def test_expired_dislike_is_visible_again(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            disliked_until=MIDNIGHT,
        )
        self.login(user)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: MIDNIGHT,
            )
            response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [recipe.id]

    def test_feed_does_not_exclude_another_users_state(self):
        user = self.create_user()
        other = self.create_user("other@example.com")
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=other,
            recipe=recipe,
            liked_at=BEFORE_MIDNIGHT,
        )
        self.login(user)

        response = self.client.get(BASE + "feed/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [recipe.id]

    def test_swipes_require_authentication(self):
        recipe = self.create_recipe()

        response = self.client.post(
            BASE + "swipes/",
            {"recipe_id": recipe.id, "action": "like"},
            format="json",
        )

        assert response.status_code == 403

    def test_like_sets_timestamp(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.login(user)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: BEFORE_MIDNIGHT,
            )
            response = self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "like"},
                format="json",
            )

        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.liked_at == BEFORE_MIDNIGHT
        assert state.disliked_until is None

    def test_repeated_like_preserves_original_liked_at(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.login(user)
        first = datetime(2026, 9, 25, 10, tzinfo=UTC)
        second = datetime(2026, 9, 25, 11, tzinfo=UTC)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: first,
            )
            first_response = self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "like"},
                format="json",
            )
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: second,
            )
            second_response = self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "like"},
                format="json",
            )

        assert first_response.status_code == 200
        assert second_response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.liked_at == first

    def test_like_clears_dislike(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            disliked_until=MIDNIGHT,
        )
        self.login(user)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: BEFORE_MIDNIGHT,
            )
            response = self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "like"},
                format="json",
            )

        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.liked_at == BEFORE_MIDNIGHT
        assert state.disliked_until is None

    def test_dislike_expires_at_next_midnight_utc(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.login(user)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "apps.preferences.views.django_timezone.now",
                lambda: BEFORE_MIDNIGHT,
            )
            response = self.client.post(
                BASE + "swipes/",
                {"recipe_id": recipe.id, "action": "dislike"},
                format="json",
            )

        assert response.status_code == 200
        state = UserRecipeState.objects.get(user=user, recipe=recipe)
        assert state.disliked_until == MIDNIGHT

    def test_inactive_recipe_cannot_be_swiped(self):
        user = self.create_user()
        recipe = self.create_recipe(is_active=False)
        self.login(user)

        response = self.client.post(
            BASE + "swipes/",
            {"recipe_id": recipe.id, "action": "like"},
            format="json",
        )

        assert response.status_code == 404

    def test_missing_recipe_cannot_be_swiped(self):
        user = self.create_user()
        self.login(user)

        response = self.client.post(
            BASE + "swipes/",
            {"recipe_id": 999999, "action": "like"},
            format="json",
        )

        assert response.status_code == 404

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"recipe_id": 1},
            {"recipe_id": 1, "action": "neutral"},
            {"recipe_id": 0, "action": "like"},
            {"recipe_id": 1, "action": "like", "unknown": True},
            {"recipe_id": 1, "action": "like", "user_id": 999},
        ],
    )
    def test_swipes_reject_invalid_or_unknown_fields(self, payload):
        self.login(self.create_user())

        response = self.client.post(
            BASE + "swipes/",
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

    def test_add_favorite(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": True},
            format="json",
        )

        assert response.status_code == 200
        assert UserRecipeState.objects.get(
            user=user,
            recipe=recipe,
        ).is_favorite is True

    def test_remove_favorite(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            is_favorite=True,
        )
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": False},
            format="json",
        )

        assert response.status_code == 200
        assert UserRecipeState.objects.get(
            user=user,
            recipe=recipe,
        ).is_favorite is False

    def test_remove_favorite_from_inactive_recipe_is_allowed(self):
        user = self.create_user()
        recipe = self.create_recipe(is_active=False)
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            is_favorite=True,
        )
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": False},
            format="json",
        )

        assert response.status_code == 200
        assert UserRecipeState.objects.get(
            user=user,
            recipe=recipe,
        ).is_favorite is False

    def test_inactive_recipe_cannot_be_added_to_favorites(self):
        user = self.create_user()
        recipe = self.create_recipe(is_active=False)
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            {"is_favorite": True},
            format="json",
        )

        assert response.status_code == 404

    def test_missing_recipe_cannot_be_added_to_favorites(self):
        user = self.create_user()
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/999999/",
            {"is_favorite": True},
            format="json",
        )

        assert response.status_code == 404

    def test_favorite_does_not_change_like_or_dislike(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            liked_at=BEFORE_MIDNIGHT,
            disliked_until=MIDNIGHT,
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
        assert state.liked_at == BEFORE_MIDNIGHT
        assert state.disliked_until == MIDNIGHT

    def test_remove_favorite_preserves_like(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=user,
            recipe=recipe,
            liked_at=BEFORE_MIDNIGHT,
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
        assert state.liked_at == BEFORE_MIDNIGHT
        assert state.is_favorite is False

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"is_favorite": "yes"},
            {"is_favorite": 1},
            {"is_favorite": True, "unknown": True},
            {"is_favorite": False, "user_id": 999},
        ],
    )
    def test_favorite_rejects_invalid_or_unknown_fields(self, payload):
        user, recipe = self.create_user(), self.create_recipe()
        self.login(user)

        response = self.client.put(
            f"{BASE}favorites/{recipe.id}/",
            payload,
            format="json",
        )

        assert response.status_code == 400

    def test_favorites_are_scoped_to_user(self):
        user = self.create_user()
        other = self.create_user("other@example.com")
        own_recipe = self.create_recipe()
        other_recipe = self.create_recipe(number=2)
        UserRecipeState.objects.create(
            user=user,
            recipe=own_recipe,
            is_favorite=True,
        )
        UserRecipeState.objects.create(
            user=other,
            recipe=other_recipe,
            is_favorite=True,
        )
        self.login(user)

        response = self.client.get(BASE + "favorites/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [own_recipe.id]

    def test_favorites_exclude_inactive_recipes(self):
        user = self.create_user()
        active = self.create_recipe()
        inactive = self.create_recipe(number=2, is_active=False)
        UserRecipeState.objects.create(
            user=user,
            recipe=active,
            is_favorite=True,
        )
        UserRecipeState.objects.create(
            user=user,
            recipe=inactive,
            is_favorite=True,
        )
        self.login(user)

        response = self.client.get(BASE + "favorites/")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [active.id]

    def test_favorites_pagination_matches_drf_limit_offset(self):
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
        data = response.json()

        assert response.status_code == 200
        assert data["count"] == 4
        assert [item["id"] for item in data["results"]] == [
            recipes[1].id,
            recipes[2].id,
        ]
        assert data["next"].endswith("limit=2&offset=3")
        assert data["previous"].endswith("limit=2")

    def test_limit_above_max_is_capped_by_drf(self):
        for i in range(1, 102):
            self.create_recipe(number=i)

        response = self.client.get(BASE + "feed/?limit=101")

        assert response.status_code == 200
        assert len(response.json()["results"]) == 100

    def test_unique_constraint_raises_integrity_error(self):
        user = self.create_user()
        recipe = self.create_recipe()
        UserRecipeState.objects.create(user=user, recipe=recipe)

        with transaction.atomic(), pytest.raises(IntegrityError):
            UserRecipeState.objects.create(user=user, recipe=recipe)

    def test_is_favorite_selector_is_scoped_to_user(self):
        first = self.create_user("first@example.com")
        second = self.create_user("second@example.com")
        recipe = self.create_recipe()
        UserRecipeState.objects.create(
            user=first,
            recipe=recipe,
            is_favorite=True,
        )

        assert is_favorite(user_id=first.id, recipe_id=recipe.id) is True
        assert is_favorite(user_id=second.id, recipe_id=recipe.id) is False
