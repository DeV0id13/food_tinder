from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from rest_framework.exceptions import NotFound
from rest_framework.test import APIClient

from apps.catalog.models import Recipe
from apps.planning.models import MealPlan, MealPlanSlot, validate_enabled_meals
from apps.planning.selectors import get_locked_plan_for_user, get_plan_for_user
from apps.preferences.models import UserRecipeState

pytestmark = pytest.mark.django_db

BASE = "/api/v1/meal-plans/"
PASSWORD = "Valid_pass123"
ALL_MEALS = ("breakfast", "lunch", "snack", "dinner")


@pytest.mark.django_db(transaction=True)
class TestPlanningConcurrentSlotPut:
    """Два потока открывают независимые подключения к БД (``connections.close_all()``)
    и одновременно обращаются к конечной точке слота за барьером. 
    """

    def _slot_body(self, plan_id, day_index, meal_type, recipe_id, servings):
        from rest_framework.test import APIRequestFactory, force_authenticate

        from apps.planning.views import meal_plan_slot

        factory = APIRequestFactory()
        request = factory.put(
            f"/api/v1/meal-plans/{plan_id}/slots/{day_index}/{meal_type}/",
            {"recipe_id": recipe_id, "servings": servings},
            format="json",
        )
        force_authenticate(request, user=self.user)
        return meal_plan_slot(request, plan_id, day_index, meal_type)

    def test_concurrent_valid_puts_keep_single_slot_without_500(self):
        import threading

        from django.db import connection, connections

        if connection.vendor != "postgresql":
            pytest.skip("Concurrent slot PUT requires PostgreSQL.")

        self.user = get_user_model().objects.create_user(
            email="racer@example.com", password=PASSWORD
        )
        recipe_one = Recipe.objects.create(
            slug="race-one",
            title="Race One",
            description="Test recipe",
            image_url="",
            cooking_time_minutes=20,
            difficulty=2,
            base_servings=2,
            meal_types=["lunch", "dinner"],
            steps=["Prepare", "Serve"],
            is_active=True,
        )
        recipe_two = Recipe.objects.create(
            slug="race-two",
            title="Race Two",
            description="Test recipe",
            image_url="",
            cooking_time_minutes=20,
            difficulty=2,
            base_servings=2,
            meal_types=["lunch", "dinner"],
            steps=["Prepare", "Serve"],
            is_active=True,
        )
        UserRecipeState.objects.create(user=self.user, recipe=recipe_one, is_favorite=True)
        UserRecipeState.objects.create(user=self.user, recipe=recipe_two, is_favorite=True)
        plan = MealPlan.objects.create(
            user=self.user,
            start_date=date(2026, 10, 1),
            duration_days=1,
            enabled_meals=["lunch", "dinner"],
        )
        plan_id = plan.id
        connections.close_all()

        barrier = threading.Barrier(2)
        outcomes = {}

        def racer(name, recipe_id, servings):
            from django.db import connections as thread_connections

            thread_connections.close_all()
            barrier.wait(timeout=10)
            try:
                response = self._slot_body(
                    plan_id, 0, "lunch", recipe_id, servings
                )
                outcomes[name] = ("ok", response.status_code)
            except Exception as exc:  # noqa: BLE001 - recorded, asserted below
                outcomes[name] = ("error", f"{type(exc).__name__}: {exc}")
            finally:
                thread_connections.close_all()

        first = threading.Thread(
            target=racer, args=("first", recipe_one.id, 2), daemon=True
        )
        second = threading.Thread(
            target=racer, args=("second", recipe_two.id, 6), daemon=True
        )
        first.start()
        second.start()
        first.join(timeout=30)
        second.join(timeout=30)

        assert not first.is_alive() and not second.is_alive()
        assert outcomes["first"] == ("ok", 200), outcomes
        assert outcomes["second"] == ("ok", 200), outcomes

        slots = list(
            MealPlanSlot.objects.filter(
                plan_id=plan_id, day_index=0, meal_type="lunch"
            )
        )
        assert len(slots) == 1
        assert (slots[0].recipe_id, slots[0].servings) in {
            (recipe_one.id, 2),
            (recipe_two.id, 6),
        }


class TestPlanningAPI:
    def setup_method(self):
        self.client = APIClient()

    def create_user(self, email="planner@example.com"):
        return get_user_model().objects.create_user(email=email, password=PASSWORD)

    def create_recipe(
        self,
        *,
        number=1,
        is_active=True,
        meal_types=("lunch", "dinner"),
        base_servings=2,
    ):
        return Recipe.objects.create(
            slug=f"recipe-{number}",
            title=f"Recipe {number}",
            description="Test recipe",
            image_url="",
            cooking_time_minutes=20,
            difficulty=2,
            base_servings=base_servings,
            meal_types=list(meal_types),
            steps=["Prepare", "Serve"],
            is_active=is_active,
        )

    def make_favorite(self, user, recipe):
        return UserRecipeState.objects.create(user=user, recipe=recipe, is_favorite=True)

    def login(self, user):
        self.client.force_login(user)

    def create_plan(
        self,
        user,
        *,
        start_date=date(2026, 10, 1),
        duration_days=1,
        enabled_meals=("lunch", "dinner"),
    ):
        return MealPlan.objects.create(
            user=user,
            start_date=start_date,
            duration_days=duration_days,
            enabled_meals=list(enabled_meals),
        )

    def put_slot(self, plan, day_index, meal_type, recipe_id, servings):
        return self.client.put(
            f"{BASE}{plan.id}/slots/{day_index}/{meal_type}/",
            {"recipe_id": recipe_id, "servings": servings},
            format="json",
        )

    def delete_slot(self, plan, day_index, meal_type):
        return self.client.delete(f"{BASE}{plan.id}/slots/{day_index}/{meal_type}/")

    def test_create_plan_returns_detail_with_empty_slots(self):
        user = self.create_user()
        self.login(user)

        response = self.client.post(
            BASE,
            {
                "start_date": "2026-10-01",
                "duration_days": 1,
                "enabled_meals": ["lunch", "dinner"],
            },
            format="json",
        )

        assert response.status_code == 201
        data = response.json()
        assert data["start_date"] == "2026-10-01"
        assert data["duration_days"] == 1
        assert data["enabled_meals"] == ["lunch", "dinner"]
        assert data["slots"] == []
        plan = MealPlan.objects.get(pk=data["id"])
        assert plan.user == user

    @pytest.mark.parametrize("duration", [1, 3, 7])
    def test_create_plan_allows_1_3_7_days(self, duration):
        self.login(self.create_user())

        response = self.client.post(
            BASE,
            {
                "start_date": "2026-10-01",
                "duration_days": duration,
                "enabled_meals": ["lunch"],
            },
            format="json",
        )

        assert response.status_code == 201
        assert response.json()["duration_days"] == duration

    @pytest.mark.parametrize("duration", [0, 2, 5, 8, -1])
    def test_create_plan_rejects_other_durations(self, duration):
        self.login(self.create_user())

        response = self.client.post(
            BASE,
            {
                "start_date": "2026-10-01",
                "duration_days": duration,
                "enabled_meals": ["lunch"],
            },
            format="json",
        )

        assert response.status_code == 400
        assert "duration_days" in response.json()

    @pytest.mark.parametrize(
        "enabled_meals",
        [[], ["brunch"], ["lunch", "lunch"], "lunch", None],
    )
    def test_create_plan_rejects_bad_enabled_meals(self, enabled_meals):
        self.login(self.create_user())

        response = self.client.post(
            BASE,
            {
                "start_date": "2026-10-01",
                "duration_days": 1,
                "enabled_meals": enabled_meals,
            },
            format="json",
        )

        assert response.status_code == 400
        assert "enabled_meals" in response.json()

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"duration_days": 1, "enabled_meals": ["lunch"]},
            {
                "start_date": "2026-10-01",
                "duration_days": 1,
                "enabled_meals": ["lunch"],
                "unknown": True,
            },
            {
                "start_date": "2026-10-01",
                "duration_days": 1,
                "enabled_meals": ["lunch"],
                "user_id": 999,
            },
        ],
    )
    def test_create_plan_rejects_missing_unknown_or_owner_fields(self, payload):
        self.login(self.create_user())

        response = self.client.post(BASE, payload, format="json")

        assert response.status_code == 400

    def test_create_plan_requires_authentication(self):
        response = self.client.post(
            BASE,
            {
                "start_date": "2026-10-01",
                "duration_days": 1,
                "enabled_meals": ["lunch"],
            },
            format="json",
        )

        assert response.status_code == 403

    def test_list_is_scoped_to_user_and_sorted_by_id_desc(self):
        user = self.create_user()
        other = self.create_user("other@example.com")
        first = self.create_plan(user)
        second = self.create_plan(user, start_date=date(2026, 10, 2))
        self.create_plan(other)
        self.login(user)

        response = self.client.get(BASE)

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert [item["id"] for item in data["results"]] == [second.id, first.id]
        assert set(data["results"][0]) == {"id", "start_date", "duration_days", "enabled_meals"}

    def test_list_requires_authentication(self):
        assert self.client.get(BASE).status_code == 403

    def test_list_pagination_matches_drf_limit_offset(self):
        user = self.create_user()
        plans = [self.create_plan(user, start_date=date(2026, 10, day)) for day in range(1, 5)]
        self.login(user)

        response = self.client.get(BASE + "?limit=2&offset=1")
        data = response.json()

        assert response.status_code == 200
        assert data["count"] == 4
        assert [item["id"] for item in data["results"]] == [plans[2].id, plans[1].id]
        assert data["next"].endswith("limit=2&offset=3")
        assert data["previous"].endswith("limit=2")

    def test_detail_orders_slots_by_day_then_meal(self):
        user = self.create_user()
        recipe = self.create_recipe(meal_types=ALL_MEALS)
        self.make_favorite(user, recipe)
        plan = self.create_plan(user, duration_days=3, enabled_meals=ALL_MEALS)
        self.login(user)
        self.put_slot(plan, 2, "lunch", recipe.id, 1)
        self.put_slot(plan, 0, "dinner", recipe.id, 1)
        self.put_slot(plan, 0, "breakfast", recipe.id, 1)
        self.put_slot(plan, 1, "lunch", recipe.id, 1)

        response = self.client.get(f"{BASE}{plan.id}/")

        assert response.status_code == 200
        slots = response.json()["slots"]
        assert [(slot["day_index"], slot["meal_type"]) for slot in slots] == [
            (0, "breakfast"),
            (0, "dinner"),
            (1, "lunch"),
            (2, "lunch"),
        ]

    def test_detail_of_other_users_plan_returns_404(self):
        owner = self.create_user()
        intruder = self.create_user("intruder@example.com")
        plan = self.create_plan(owner)
        self.login(intruder)

        assert self.client.get(f"{BASE}{plan.id}/").status_code == 404

    def test_detail_of_missing_plan_returns_404(self):
        self.login(self.create_user())

        assert self.client.get(f"{BASE}999999/").status_code == 404

    def test_delete_plan_removes_slots_and_is_scoped(self):
        user = self.create_user()
        other = self.create_user("other@example.com")
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        MealPlanSlot.objects.create(
            plan=plan, day_index=0, meal_type="lunch", recipe=recipe, servings=2
        )
        other_plan = self.create_plan(other)
        self.login(user)

        response = self.client.delete(f"{BASE}{plan.id}/")

        assert response.status_code == 204
        assert not MealPlan.objects.filter(pk=plan.id).exists()
        assert not MealPlanSlot.objects.filter(plan_id=plan.id).exists()
        assert MealPlan.objects.filter(pk=other_plan.id).exists()
        assert self.client.delete(f"{BASE}{other_plan.id}/").status_code == 404

    def test_multiple_plans_with_same_dates_are_allowed(self):
        user = self.create_user()
        self.create_plan(user)
        self.create_plan(user)
        self.login(user)

        assert self.client.get(BASE).json()["count"] == 2

    def test_get_plan_for_user_selector(self):
        owner = self.create_user()
        other = self.create_user("other@example.com")
        plan = self.create_plan(owner)

        assert get_plan_for_user(user=owner, plan_id=plan.id) == plan
        with pytest.raises(NotFound):
            get_plan_for_user(user=other, plan_id=plan.id)
        with pytest.raises(NotFound):
            get_plan_for_user(user=owner, plan_id=999999)

    def test_put_slot_creates_slot(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)

        response = self.put_slot(plan, 0, "lunch", recipe.id, 3)

        assert response.status_code == 200
        assert response.json() == {
            "day_index": 0,
            "meal_type": "lunch",
            "recipe_id": recipe.id,
            "recipe_title": recipe.title,
            "servings": 3,
        }
        slot = MealPlanSlot.objects.get(plan=plan, day_index=0, meal_type="lunch")
        assert slot.recipe == recipe
        assert slot.servings == 3

    def test_put_slot_is_idempotent_and_updates_servings(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)

        first = self.put_slot(plan, 0, "lunch", recipe.id, 1)
        second = self.put_slot(plan, 0, "lunch", recipe.id, 4)

        assert first.status_code == 200
        assert second.status_code == 200
        assert MealPlanSlot.objects.filter(plan=plan).count() == 1
        assert MealPlanSlot.objects.get(plan=plan).servings == 4

    def test_put_slot_replaces_existing_recipe(self):
        user = self.create_user()
        first_recipe = self.create_recipe()
        second_recipe = self.create_recipe(number=2)
        self.make_favorite(user, first_recipe)
        self.make_favorite(user, second_recipe)
        plan = self.create_plan(user)
        self.login(user)

        self.put_slot(plan, 0, "lunch", first_recipe.id, 2)
        response = self.put_slot(plan, 0, "lunch", second_recipe.id, 2)

        assert response.status_code == 200
        assert MealPlanSlot.objects.get(plan=plan).recipe == second_recipe

    def test_put_slot_rejects_non_favorite_recipe(self):
        user = self.create_user()
        recipe = self.create_recipe()
        plan = self.create_plan(user)
        self.login(user)

        response = self.put_slot(plan, 0, "lunch", recipe.id, 1)

        assert response.status_code == 400
        assert "recipe_id" in response.json()

    def test_put_slot_rejects_inactive_recipe(self):
        user = self.create_user()
        recipe = self.create_recipe(is_active=False)
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)

        assert self.put_slot(plan, 0, "lunch", recipe.id, 1).status_code == 404

    def test_put_slot_rejects_missing_recipe(self):
        user = self.create_user()
        plan = self.create_plan(user)
        self.login(user)

        assert self.put_slot(plan, 0, "lunch", 999999, 1).status_code == 404

    def test_put_slot_rejects_recipe_incompatible_with_meal(self):
        user = self.create_user()
        recipe = self.create_recipe(meal_types=("dinner",))
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)

        response = self.put_slot(plan, 0, "lunch", recipe.id, 1)

        assert response.status_code == 400
        assert "meal_type" in response.json()

    def test_put_slot_rejects_day_outside_period(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user, duration_days=1)
        self.login(user)

        response = self.put_slot(plan, 1, "lunch", recipe.id, 1)

        assert response.status_code == 400
        assert "day_index" in response.json()

    def test_put_slot_rejects_negative_day_index(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)

        response = self.put_slot(plan, -1, "lunch", recipe.id, 2)

        assert response.status_code == 400
        assert list(response.json()) == ["day_index"]
        assert not MealPlanSlot.objects.filter(plan=plan).exists()

    def test_delete_slot_rejects_negative_day_index(self):
        user = self.create_user()
        plan = self.create_plan(user)
        self.login(user)

        response = self.delete_slot(plan, -1, "lunch")

        assert response.status_code == 400
        assert list(response.json()) == ["day_index"]

    def test_negative_day_index_on_foreign_plan_returns_404(self):
        owner = self.create_user(email="owner@example.com")
        stranger = self.create_user(email="stranger@example.com")
        recipe = self.create_recipe()
        self.make_favorite(stranger, recipe)
        plan = self.create_plan(owner)
        self.login(stranger)

        put_response = self.put_slot(plan, -1, "lunch", recipe.id, 2)
        delete_response = self.delete_slot(plan, -1, "lunch")

        assert put_response.status_code == 404
        assert delete_response.status_code == 404

    def test_put_slot_rejects_disabled_meal(self):
        user = self.create_user()
        recipe = self.create_recipe(meal_types=ALL_MEALS)
        self.make_favorite(user, recipe)
        plan = self.create_plan(user, enabled_meals=("lunch",))
        self.login(user)

        response = self.put_slot(plan, 0, "dinner", recipe.id, 1)

        assert response.status_code == 400
        assert "meal_type" in response.json()

    def test_put_slot_rejects_unknown_meal_type(self):
        user = self.create_user()
        recipe = self.create_recipe(meal_types=ALL_MEALS)
        self.make_favorite(user, recipe)
        plan = self.create_plan(user, enabled_meals=ALL_MEALS)
        self.login(user)

        assert self.put_slot(plan, 0, "brunch", recipe.id, 1).status_code == 400

    @pytest.mark.parametrize("servings", [0, 21, -1, "two", None, 1.5])
    def test_put_slot_rejects_invalid_servings(self, servings):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)

        response = self.put_slot(plan, 0, "lunch", recipe.id, servings)

        assert response.status_code == 400
        assert "servings" in response.json()

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"recipe_id": 1},
            {"servings": 2},
            {"recipe_id": 1, "servings": 2, "unknown": True},
            {"recipe_id": 1, "servings": 2, "user_id": 999},
        ],
    )
    def test_put_slot_rejects_missing_unknown_or_owner_fields(self, payload):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)

        response = self.client.put(f"{BASE}{plan.id}/slots/0/lunch/", payload, format="json")

        assert response.status_code == 400

    def test_put_slot_requires_authentication(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)

        assert self.put_slot(plan, 0, "lunch", recipe.id, 1).status_code == 403

    def test_slot_survives_unfavorite_and_servings_can_change(self):
        user = self.create_user()
        recipe = self.create_recipe()
        state = self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)
        self.put_slot(plan, 0, "lunch", recipe.id, 2)

        state.is_favorite = False
        state.save(update_fields=("is_favorite",))
        response = self.put_slot(plan, 0, "lunch", recipe.id, 5)

        assert response.status_code == 200
        slot = MealPlanSlot.objects.get(plan=plan)
        assert slot.recipe == recipe
        assert slot.servings == 5

    def test_other_user_cannot_change_foreign_slot(self):
        owner = self.create_user()
        intruder = self.create_user("intruder@example.com")
        recipe = self.create_recipe()
        self.make_favorite(owner, recipe)
        self.make_favorite(intruder, recipe)
        plan = self.create_plan(owner)
        MealPlanSlot.objects.create(
            plan=plan, day_index=0, meal_type="lunch", recipe=recipe, servings=1
        )
        self.login(intruder)

        assert self.put_slot(plan, 0, "lunch", recipe.id, 3).status_code == 404
        assert self.delete_slot(plan, 0, "lunch").status_code == 404

    def test_delete_slot_is_idempotent_for_valid_slot(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)
        self.put_slot(plan, 0, "lunch", recipe.id, 2)

        first = self.delete_slot(plan, 0, "lunch")
        second = self.delete_slot(plan, 0, "lunch")

        assert first.status_code == 204
        assert second.status_code == 204
        assert not MealPlanSlot.objects.filter(plan=plan).exists()

    def test_delete_slot_rejects_invalid_target(self):
        user = self.create_user()
        plan = self.create_plan(user, duration_days=1, enabled_meals=("lunch",))
        self.login(user)

        assert self.delete_slot(plan, 1, "lunch").status_code == 400
        assert self.delete_slot(plan, 0, "dinner").status_code == 400
        assert self.delete_slot(plan, 0, "brunch").status_code == 400

    def test_slot_changes_are_visible_on_later_get(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)
        self.put_slot(plan, 0, "lunch", recipe.id, 2)

        updated = self.client.get(f"{BASE}{plan.id}/")
        assert updated.json()["slots"][0]["servings"] == 2

        self.put_slot(plan, 0, "lunch", recipe.id, 6)
        changed = self.client.get(f"{BASE}{plan.id}/")
        assert changed.json()["slots"][0]["servings"] == 6

        self.delete_slot(plan, 0, "lunch")
        emptied = self.client.get(f"{BASE}{plan.id}/")
        assert emptied.json()["slots"] == []

    def test_slot_unique_constraint_raises_integrity_error(self):
        user = self.create_user()
        recipe = self.create_recipe()
        plan = self.create_plan(user)
        MealPlanSlot.objects.create(
            plan=plan, day_index=0, meal_type="lunch", recipe=recipe, servings=1
        )

        with transaction.atomic(), pytest.raises(IntegrityError):
            MealPlanSlot.objects.create(
                plan=plan, day_index=0, meal_type="lunch", recipe=recipe, servings=2
            )

    def test_model_rejects_empty_enabled_meals_via_validation(self):
        with pytest.raises(ValidationError):
            validate_enabled_meals([])
        with pytest.raises(ValidationError):
            validate_enabled_meals(["lunch", "lunch"])
        with pytest.raises(ValidationError):
            validate_enabled_meals(["brunch"])

    def test_put_slot_with_invalid_body_to_foreign_plan_returns_404(self):
        owner = self.create_user()
        intruder = self.create_user("intruder@example.com")
        plan = self.create_plan(owner)
        self.login(intruder)

        url = f"{BASE}{plan.id}/slots/0/lunch/"
        cases = [
            {},
            {"servings": 2},
            {"recipe_id": 1, "servings": 0},
            {"recipe_id": 1, "servings": 21},
        ]
        for payload in cases:
            assert self.client.put(url, payload, format="json").status_code == 404

    def test_put_slot_with_invalid_body_to_missing_plan_returns_404(self):
        self.login(self.create_user())

        url = f"{BASE}999999/slots/0/lunch/"
        cases = [
            {},
            {"servings": 2},
            {"recipe_id": 1, "servings": 0},
            {"recipe_id": 1, "servings": 21},
        ]
        for payload in cases:
            assert self.client.put(url, payload, format="json").status_code == 404

    def test_put_slot_with_invalid_body_to_own_plan_returns_400(self):
        user = self.create_user()
        plan = self.create_plan(user)
        self.login(user)

        url = f"{BASE}{plan.id}/slots/0/lunch/"
        cases = [
            {},
            {"servings": 2},
            {"recipe_id": 1, "servings": 0},
            {"recipe_id": 1, "servings": 21},
        ]
        for payload in cases:
            assert self.client.put(url, payload, format="json").status_code == 400
        self.put_slot(plan, 0, "lunch", plan.recipe.id, 2)

    def test_put_slot_with_missing_favorite_returns_400(self):
        user = self.create_user()
        plan = self.create_plan(user)
        self.login(user)

        url = f"{BASE}{plan.id}/slots/0/lunch/"
        response = self.client.put(
            url, {"recipe_id": 1, "servings": 2}, format="json"
        )
        assert response.status_code == 400
        self.put_slot(plan, 0, "lunch", plan.recipe.id, 2)


    def test_delete_plan_returns_404_for_missing_plan(self):
        user = self.create_user()
        self.login(user)

        assert self.client.delete(f"{BASE}999999/").status_code == 404

    def test_slot_operation_on_deleted_plan_returns_404(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        plan_id = plan.id
        plan.delete()
        self.login(user)

        assert self.put_slot(plan_id, 0, "lunch", recipe.id, 2).status_code == 404
        assert self.delete_slot(plan_id, 0, "lunch").status_code == 404
        assert self.client.delete(f"{BASE}{plan_id}/").status_code == 404

    def test_plan_delete_and_slot_operations_share_plan_first_lock_order(self):
        user = self.create_user()
        recipe = self.create_recipe()
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        plan_id = plan.id
        self.login(user)

        with transaction.atomic():
            locked = get_locked_plan_for_user(user=user, plan_id=plan_id)
            locked.delete()
            # Same lock order as slot PUT/DELETE: the plan row is already
            # locked in this transaction, so re-fetching it under lock sees
            # the same (deleted) state instead of racing with a concurrent
            # slot operation that would lock the plan first as well.
            with pytest.raises(NotFound):
                get_locked_plan_for_user(user=user, plan_id=plan_id)

        assert self.put_slot(plan, 0, "lunch", recipe.id, 2).status_code == 404
        assert self.delete_slot(plan, 0, "lunch").status_code == 404
        assert self.client.get(f"{BASE}{plan_id}/").status_code == 404

    def test_servings_only_update_rejects_recipe_turned_incompatible(self):
        user = self.create_user()
        recipe = self.create_recipe(meal_types=("lunch", "dinner"))
        self.make_favorite(user, recipe)
        plan = self.create_plan(user)
        self.login(user)
        assert self.put_slot(plan, 0, "lunch", recipe.id, 2).status_code == 200

        recipe.meal_types = ["dinner"]
        recipe.save()

        response = self.put_slot(plan, 0, "lunch", recipe.id, 5)
        assert response.status_code == 400
        assert list(response.json()) == ["meal_type"]
        slot = MealPlanSlot.objects.get(plan=plan, day_index=0, meal_type="lunch")
        assert slot.recipe_id == recipe.id
        assert slot.servings == 2
