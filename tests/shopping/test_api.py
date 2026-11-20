import csv
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Barrier
from unittest.mock import ANY

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections
from rest_framework.test import APIClient

# До слияния FT-04 в master модели planning отсутствуют: ORM/API-проверки пропускаются.
planning_models = pytest.importorskip("apps.planning.models")

from apps.catalog.models import Ingredient, Recipe, RecipeIngredient  # noqa: E402
from apps.preferences.models import UserRecipeState  # noqa: E402
from apps.shopping.models import PurchasedIngredient  # noqa: E402

MealPlan = planning_models.MealPlan
MealPlanSlot = planning_models.MealPlanSlot

pytestmark = pytest.mark.django_db

SHOPPING = "/api/v1/shopping-list/"
EXPORT = SHOPPING + "export/"
PLANS = "/api/v1/meal-plans/"
PASSWORD = "Valid_pass123"


@pytest.fixture(autouse=True)
def shopping_urls(settings):
    settings.ROOT_URLCONF = "tests.shopping.urls"


def create_user(email):
    return get_user_model().objects.create_user(email=email, password=PASSWORD)


def create_ingredient(slug, name, unit):
    return Ingredient.objects.create(slug=slug, name=name, unit=unit)


def create_recipe(slug, *, base_servings=2, lines=(), meal_types=("lunch", "dinner")):
    recipe = Recipe.objects.create(
        slug=slug,
        title=slug.title(),
        description="Test recipe",
        image_url="",
        cooking_time_minutes=20,
        difficulty=2,
        base_servings=base_servings,
        meal_types=list(meal_types),
        steps=["Prepare", "Serve"],
        is_active=True,
    )
    for ingredient, quantity in lines:
        RecipeIngredient.objects.create(
            recipe=recipe, ingredient=ingredient, quantity=Decimal(quantity)
        )
    return recipe


def create_plan(user, *, duration_days=1, enabled_meals=("lunch", "dinner")):
    return MealPlan.objects.create(
        user=user,
        start_date=date(2026, 10, 1),
        duration_days=duration_days,
        enabled_meals=list(enabled_meals),
    )


def add_slot(plan, recipe, *, day_index=0, meal_type="lunch", servings=1):
    return MealPlanSlot.objects.create(
        plan=plan, day_index=day_index, meal_type=meal_type, recipe=recipe, servings=servings
    )


def json_rows(response):
    return [(item["name"], item["quantity"], item["unit"]) for item in response.json()["items"]]


def csv_rows(response):
    return list(csv.reader(io.StringIO(response.content.decode("utf-8-sig")), delimiter=";"))[1:]


def txt_rows(response):
    lines = response.content.decode("utf-8").splitlines()
    rows = []
    for line in lines:
        name, rest = line.removeprefix("[ ] ").rsplit(" — ", 1)
        quantity, unit = rest.split(" ")
        rows.append((name, quantity, unit))
    return rows


@pytest.fixture
def owner():
    return create_user("owner@example.com")


@pytest.fixture
def client(owner):
    api_client = APIClient()
    api_client.force_login(owner)
    return api_client


@pytest.fixture
def contract_catalog():
    rice = create_ingredient("rice", "Рис", "g")
    chicken = create_ingredient("chicken", "Курица", "g")
    milk = create_ingredient("milk", "Молоко", "ml")
    recipe_a = create_recipe("recipe-a", lines=[(rice, "200.000"), (chicken, "300.000")])
    recipe_b = create_recipe("recipe-b", lines=[(rice, "100.000"), (milk, "200.000")])
    return recipe_a, recipe_b


def purchase_url(plan, ingredient_id):
    return f"{SHOPPING}{plan.id}/purchases/{ingredient_id}/"


def checklist_items(client, plan):
    response = client.get(SHOPPING, {"plan_id": plan.id})
    assert response.status_code == 200
    return response.json()["items"]


def mark_purchased(client, plan, item, purchased=True):
    return client.put(
        purchase_url(plan, item["ingredient_id"]),
        {"purchased": purchased, "quantity_version": item["quantity_version"]},
        format="json",
    )


def test_purchases_survive_a_new_session_and_clear_only_the_selected_plan(
    client, owner, contract_catalog
):
    first, second = create_plan(owner), create_plan(owner)
    for plan in (first, second):
        add_slot(plan, contract_catalog[0])
        item, _ = checklist_items(client, plan)
        assert item["purchased"] is False
        assert mark_purchased(client, plan, item).status_code == 204
        assert mark_purchased(client, plan, item).status_code == 204

    second_session = APIClient()
    second_session.force_login(owner)
    assert checklist_items(second_session, first)[0]["purchased"] is True
    assert second_session.delete(f"{SHOPPING}{first.id}/purchases/").status_code == 204
    assert not any(item["purchased"] for item in checklist_items(client, first))
    assert checklist_items(client, second)[0]["purchased"] is True
    second_item = checklist_items(client, second)[0]
    assert mark_purchased(client, second, second_item, purchased=False).status_code == 204
    assert PurchasedIngredient.objects.count() == 0


def test_slot_changes_clear_changed_and_removed_items_without_resurrecting_marks(client, owner):
    rice = create_ingredient("rice", "Рис", "g")
    milk = create_ingredient("milk", "Молоко", "ml")
    main = create_recipe("a", base_servings=10, lines=[(rice, "0.001")])
    side = create_recipe("b", lines=[(milk, "20")])
    for recipe in (main, side):
        UserRecipeState.objects.create(user=owner, recipe=recipe, is_favorite=True)
    plan = create_plan(owner)
    add_slot(plan, main)
    add_slot(plan, side, meal_type="dinner")
    rice_item, milk_item = checklist_items(client, plan)
    assert mark_purchased(client, plan, rice_item).status_code == 204
    assert mark_purchased(client, plan, milk_item).status_code == 204

    slot = f"{PLANS}{plan.id}/slots/0/lunch/"
    assert client.put(slot, {"recipe_id": main.id, "servings": 2}, format="json").status_code == 200
    changed, unchanged = checklist_items(client, plan)
    assert changed["quantity"] == rice_item["quantity"]
    assert changed["purchased"] is False
    assert unchanged["purchased"] is True
    assert mark_purchased(client, plan, rice_item).status_code == 409
    # Return to the original quantity before visiting the list again.
    assert client.put(slot, {"recipe_id": main.id, "servings": 1}, format="json").status_code == 200
    assert checklist_items(client, plan)[0]["purchased"] is False
    assert client.delete(f"{PLANS}{plan.id}/slots/0/dinner/").status_code == 204
    assert mark_purchased(client, plan, milk_item).status_code == 404
    assert PurchasedIngredient.objects.filter(plan=plan).count() == 0


def test_purchase_endpoints_enforce_plan_access_csrf_and_strict_payload(
    client, owner, contract_catalog
):
    plan = create_plan(owner)
    add_slot(plan, contract_catalog[0])
    item = checklist_items(client, plan)[0]
    url = purchase_url(plan, item["ingredient_id"])
    clear = f"{SHOPPING}{plan.id}/purchases/"
    payload = {"purchased": True, "quantity_version": item["quantity_version"]}
    outsider = APIClient()
    assert outsider.put(url, payload, format="json").status_code == 403
    outsider.force_login(create_user("outsider@example.com"))
    assert outsider.put(url, payload, format="json").status_code == 404
    assert outsider.delete(clear).status_code == 404
    for invalid in (
        {**payload, "purchased": "true"},
        {**payload, "ingredient_id": item["ingredient_id"]},
        {**payload, "quantity_version": "bad"},
        {"quantity_version": item["quantity_version"]},
    ):
        assert client.put(url, invalid, format="json").status_code == 400
    assert client.delete(clear, {"plan_id": plan.id}, format="json").status_code == 400

    client.handler.enforce_csrf_checks = True
    assert client.put(url, payload, format="json").status_code == 403
    assert client.delete(clear).status_code == 403
    client.get("/api/v1/auth/session/")
    csrf = client.cookies["csrftoken"].value
    assert client.put(url, payload, format="json", HTTP_X_CSRFTOKEN=csrf).status_code == 204
    assert client.delete(clear, HTTP_X_CSRFTOKEN=csrf).status_code == 204


@pytest.mark.django_db(transaction=True)
def test_purchase_and_slot_resize_cannot_leave_a_stale_mark(client, owner, contract_catalog):
    plan = create_plan(owner)
    recipe = contract_catalog[0]
    add_slot(plan, recipe)
    item = checklist_items(client, plan)[0]
    cookie = client.cookies["sessionid"].value
    ready = Barrier(2, timeout=10)

    def run(operation):
        close_old_connections()
        try:
            contender = APIClient()
            contender.cookies["sessionid"] = cookie
            ready.wait()
            return operation(contender).status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        purchase = pool.submit(run, lambda browser: mark_purchased(browser, plan, item))
        resize = pool.submit(
            run,
            lambda browser: browser.put(
                f"{PLANS}{plan.id}/slots/0/lunch/",
                {"recipe_id": recipe.id, "servings": 2},
                format="json",
            ),
        )
        assert purchase.result(timeout=15) in (204, 409)
        assert resize.result(timeout=15) == 200
    assert not PurchasedIngredient.objects.filter(plan=plan).exists()
    assert checklist_items(client, plan)[0]["purchased"] is False


class TestControlExampleThroughApi:
    """Сквозной пример контракта: план и слоты меняются только через API planning."""

    def put_slot(self, client, plan_id, meal_type, recipe, servings):
        response = client.put(
            f"{PLANS}{plan_id}/slots/0/{meal_type}/",
            {"recipe_id": recipe.id, "servings": servings},
            format="json",
        )
        assert response.status_code == 200, response.json()

    def test_shopping_list_follows_plan_changes(self, client, owner, contract_catalog):
        recipe_a, recipe_b = contract_catalog
        for recipe in contract_catalog:
            UserRecipeState.objects.create(user=owner, recipe=recipe, is_favorite=True)
        response = client.post(
            PLANS,
            {"start_date": "2026-10-01", "duration_days": 1, "enabled_meals": ["lunch", "dinner"]},
            format="json",
        )
        assert response.status_code == 201
        plan_id = response.json()["id"]
        self.put_slot(client, plan_id, "lunch", recipe_a, 3)
        self.put_slot(client, plan_id, "dinner", recipe_b, 2)

        response = client.get(SHOPPING, {"plan_id": plan_id})

        assert response.status_code == 200
        assert response.json() == {
            "plan_id": plan_id,
            "items": [
                {
                    "ingredient_id": recipe_a.ingredient_lines.get(
                        ingredient__slug="rice"
                    ).ingredient_id,
                    "name": "Рис",
                    "unit": "g",
                    "quantity": "400.000",
                    "purchased": False,
                    "quantity_version": ANY,
                },
                {
                    "ingredient_id": recipe_a.ingredient_lines.get(
                        ingredient__slug="chicken"
                    ).ingredient_id,
                    "name": "Курица",
                    "unit": "g",
                    "quantity": "450.000",
                    "purchased": False,
                    "quantity_version": ANY,
                },
                {
                    "ingredient_id": recipe_b.ingredient_lines.get(
                        ingredient__slug="milk"
                    ).ingredient_id,
                    "name": "Молоко",
                    "unit": "ml",
                    "quantity": "200.000",
                    "purchased": False,
                    "quantity_version": ANY,
                },
            ],
        }

        self.put_slot(client, plan_id, "lunch", recipe_a, 1)
        assert json_rows(client.get(SHOPPING, {"plan_id": plan_id})) == [
            ("Рис", "200.000", "g"),
            ("Курица", "150.000", "g"),
            ("Молоко", "200.000", "ml"),
        ]

        assert client.delete(f"{PLANS}{plan_id}/slots/0/dinner/").status_code == 204
        expected = [("Рис", "100.000", "g"), ("Курица", "150.000", "g")]
        assert json_rows(client.get(SHOPPING, {"plan_id": plan_id})) == expected
        assert csv_rows(client.get(EXPORT, {"plan_id": plan_id, "file_type": "csv"})) == [
            list(row) for row in expected
        ]
        assert txt_rows(client.get(EXPORT, {"plan_id": plan_id, "file_type": "txt"})) == expected


class TestShoppingList:
    def test_ingredient_from_several_days_is_one_row(self, client, owner):
        rice = create_ingredient("rice", "Рис", "g")
        recipe = create_recipe("rice-bowl", base_servings=3, lines=[(rice, "100.000")])
        plan = create_plan(owner, duration_days=3)
        for day_index in range(3):
            add_slot(plan, recipe, day_index=day_index, servings=1)

        response = client.get(SHOPPING, {"plan_id": plan.id})

        assert response.status_code == 200
        assert response.json()["items"] == [
            {
                "ingredient_id": rice.id,
                "name": "Рис",
                "unit": "g",
                "quantity": "100.000",
                "purchased": False,
                "quantity_version": ANY,
            }
        ]

    def test_rows_are_ordered_by_ingredient_id(self, client, owner):
        first = create_ingredient("salt", "Соль", "g")
        second = create_ingredient("apple", "Яблоко", "pcs")
        recipe = create_recipe("snack", lines=[(second, "3.000"), (first, "5.000")])
        plan = create_plan(owner)
        add_slot(plan, recipe, servings=1)

        response = client.get(SHOPPING, {"plan_id": plan.id})

        assert [item["ingredient_id"] for item in response.json()["items"]] == [
            first.id,
            second.id,
        ]
        assert response.json()["items"][1]["quantity"] == "1.500"

    def test_empty_plan(self, client, owner):
        plan = create_plan(owner)

        response = client.get(SHOPPING, {"plan_id": plan.id})

        assert response.status_code == 200
        assert response.json() == {"plan_id": plan.id, "items": []}

    def test_catalog_change_affects_next_request(self, client, owner):
        rice = create_ingredient("rice", "Рис", "g")
        recipe = create_recipe("rice-bowl", lines=[(rice, "100.000")])
        plan = create_plan(owner)
        add_slot(plan, recipe, servings=2)
        assert json_rows(client.get(SHOPPING, {"plan_id": plan.id})) == [("Рис", "100.000", "g")]

        RecipeIngredient.objects.filter(recipe=recipe).update(quantity=Decimal("150.000"))

        assert json_rows(client.get(SHOPPING, {"plan_id": plan.id})) == [("Рис", "150.000", "g")]

    def test_query_count_does_not_grow_with_slots(
        self, client, owner, django_assert_max_num_queries
    ):
        rice = create_ingredient("rice", "Рис", "g")
        plan = create_plan(owner, duration_days=7, enabled_meals=("lunch", "dinner"))
        for day_index in range(7):
            for meal_type in ("lunch", "dinner"):
                recipe = create_recipe(f"r-{day_index}-{meal_type}", lines=[(rice, "10.000")])
                add_slot(plan, recipe, day_index=day_index, meal_type=meal_type)

        # 2 auth, 2 savepoint, 5 загрузок плана и состава, 1 запрос отметок.
        with django_assert_max_num_queries(10):
            response = client.get(SHOPPING, {"plan_id": plan.id})

        assert json_rows(response) == [("Рис", "70.000", "g")]

    @pytest.mark.parametrize(
        "params", [{}, {"plan_id": ""}, {"plan_id": "abc"}, {"plan_id": "1.5"}]
    )
    def test_missing_or_non_integer_plan_id_is_400(self, client, params):
        response = client.get(SHOPPING, params)

        assert response.status_code == 400
        assert "plan_id" in response.json()

    @pytest.mark.parametrize("plan_id", ["0", "-1", str(2**63)])
    def test_out_of_range_plan_id_is_400(self, client, plan_id):
        assert client.get(SHOPPING, {"plan_id": plan_id}).status_code == 400

    def test_unknown_plan_is_404(self, client):
        assert client.get(SHOPPING, {"plan_id": 999999}).status_code == 404

    def test_response_is_not_cached(self, client, owner):
        response = client.get(SHOPPING, {"plan_id": create_plan(owner).id})

        assert "no-store" in response["Cache-Control"]
        assert "private" in response["Cache-Control"]


class TestExport:
    @pytest.fixture
    def plan(self, owner, contract_catalog):
        recipe_a, recipe_b = contract_catalog
        plan = create_plan(owner)
        add_slot(plan, recipe_a, meal_type="lunch", servings=3)
        add_slot(plan, recipe_b, meal_type="dinner", servings=2)
        return plan

    def test_csv_export(self, client, plan):
        response = client.get(EXPORT, {"plan_id": plan.id, "file_type": "csv"})

        assert response.status_code == 200
        assert response["Content-Type"] == "text/csv; charset=utf-8"
        assert (
            response["Content-Disposition"] == f'attachment; filename="shopping-list-{plan.id}.csv"'
        )
        assert "no-store" in response["Cache-Control"]
        assert response.content.startswith(b"\xef\xbb\xbf")
        assert response.content.decode("utf-8-sig").splitlines() == [
            "ingredient;quantity;unit",
            "Рис;400.000;g",
            "Курица;450.000;g",
            "Молоко;200.000;ml",
        ]

    def test_txt_export(self, client, plan):
        response = client.get(EXPORT, {"plan_id": plan.id, "file_type": "txt"})

        assert response.status_code == 200
        assert response["Content-Type"] == "text/plain; charset=utf-8"
        assert (
            response["Content-Disposition"] == f'attachment; filename="shopping-list-{plan.id}.txt"'
        )
        assert response.content.decode("utf-8") == (
            "[ ] Рис — 400.000 g\n[ ] Курица — 450.000 g\n[ ] Молоко — 200.000 ml\n"
        )

    @pytest.mark.parametrize(
        ("file_type", "accept", "content_type"),
        [
            ("csv", "text/csv", "text/csv; charset=utf-8"),
            ("txt", "text/plain", "text/plain; charset=utf-8"),
            ("csv", "application/json", "text/csv; charset=utf-8"),
            ("txt", "*/*", "text/plain; charset=utf-8"),
        ],
    )
    def test_export_ignores_client_accept_header(
        self, client, plan, file_type, accept, content_type
    ):
        response = client.get(
            EXPORT, {"plan_id": plan.id, "file_type": file_type}, HTTP_ACCEPT=accept
        )

        assert response.status_code == 200
        assert response["Content-Type"] == content_type
        assert (
            response["Content-Disposition"]
            == f'attachment; filename="shopping-list-{plan.id}.{file_type}"'
        )
        assert "400.000" in response.content.decode("utf-8-sig")

    def test_export_errors_stay_json_with_file_accept_header(self, client, owner):
        response = client.get(
            EXPORT, {"plan_id": "abc", "file_type": "csv"}, HTTP_ACCEPT="text/csv"
        )

        assert response.status_code == 400
        assert response["Content-Type"] == "application/json"
        assert "plan_id" in response.json()

    def test_all_formats_have_same_quantities(self, client, plan):
        json_result = json_rows(client.get(SHOPPING, {"plan_id": plan.id}))
        csv_result = csv_rows(client.get(EXPORT, {"plan_id": plan.id, "file_type": "csv"}))
        txt_result = txt_rows(client.get(EXPORT, {"plan_id": plan.id, "file_type": "txt"}))

        assert [list(row) for row in json_result] == csv_result
        assert json_result == txt_result

    def test_empty_plan_exports(self, client, owner):
        plan = create_plan(owner)

        csv_response = client.get(EXPORT, {"plan_id": plan.id, "file_type": "csv"})
        txt_response = client.get(EXPORT, {"plan_id": plan.id, "file_type": "txt"})

        assert csv_response.status_code == 200
        assert csv_response.content == "ingredient;quantity;unit\r\n".encode("utf-8-sig")
        assert txt_response.status_code == 200
        assert txt_response.content.decode("utf-8") == "Список покупок пуст\n"

    def test_dangerous_names_are_escaped_in_csv(self, client, owner):
        names = ['=HYPERLINK("http://evil";"x")', "Соус; «Острый»", 'Сыр "Гауда"', "@cmd"]
        ingredients = [
            create_ingredient(f"item-{index}", name, "g") for index, name in enumerate(names)
        ]
        recipe = create_recipe("tricky", lines=[(item, "1.000") for item in ingredients])
        plan = create_plan(owner)
        add_slot(plan, recipe, servings=2)

        response = client.get(EXPORT, {"plan_id": plan.id, "file_type": "csv"})

        assert csv_rows(response) == [
            ["'" + names[0], "1.000", "g"],
            [names[1], "1.000", "g"],
            [names[2], "1.000", "g"],
            ["'" + names[3], "1.000", "g"],
        ]

    @pytest.mark.parametrize("file_type", [None, "", "xlsx", "CSV", "json"])
    def test_unknown_file_type_is_400(self, client, plan, file_type):
        params = {"plan_id": plan.id}
        if file_type is not None:
            params["file_type"] = file_type

        response = client.get(EXPORT, params)

        assert response.status_code == 400
        assert "file_type" in response.json()

    def test_non_integer_plan_id_is_400(self, client):
        response = client.get(EXPORT, {"plan_id": "abc", "file_type": "csv"})

        assert response.status_code == 400
        assert "plan_id" in response.json()


class TestAccess:
    @pytest.fixture
    def foreign_plan(self, owner, contract_catalog):
        plan = create_plan(owner)
        add_slot(plan, contract_catalog[0], servings=3)
        return plan

    @pytest.fixture
    def other_client(self):
        api_client = APIClient()
        api_client.force_login(create_user("other@example.com"))
        return api_client

    def test_other_user_gets_404_for_list(self, other_client, foreign_plan):
        response = other_client.get(SHOPPING, {"plan_id": foreign_plan.id})

        assert response.status_code == 404
        assert "Рис" not in response.content.decode()

    @pytest.mark.parametrize("file_type", ["csv", "txt"])
    def test_other_user_gets_404_for_export(self, other_client, foreign_plan, file_type):
        response = other_client.get(EXPORT, {"plan_id": foreign_plan.id, "file_type": file_type})

        assert response.status_code == 404
        assert "Content-Disposition" not in response
        assert "Рис" not in response.content.decode()

    def test_other_user_gets_404_for_export_with_file_accept_header(
        self, other_client, foreign_plan
    ):
        response = other_client.get(
            EXPORT, {"plan_id": foreign_plan.id, "file_type": "csv"}, HTTP_ACCEPT="text/csv"
        )

        assert response.status_code == 404
        assert "Content-Disposition" not in response
        assert "Рис" not in response.content.decode()

    @pytest.mark.parametrize("url", [SHOPPING, EXPORT])
    def test_guest_is_forbidden(self, foreign_plan, url):
        response = APIClient().get(url, {"plan_id": foreign_plan.id, "file_type": "csv"})

        assert response.status_code == 403
