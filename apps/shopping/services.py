from django.db.models import prefetch_related_objects
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound

from apps.planning.models import MealPlan
from apps.planning.selectors import get_plan_for_user

from .calculation import PlannedLine, ShoppingItem, aggregate_shopping_items
from .models import PurchasedIngredient


def collect_plan_lines(plan) -> list[PlannedLine]:
    prefetch_related_objects([plan], "slots__recipe__ingredient_lines__ingredient")
    return [
        PlannedLine(
            ingredient_id=line.ingredient.id,
            name=line.ingredient.name,
            unit=line.ingredient.unit,
            quantity=line.quantity,
            servings=slot.servings,
            base_servings=slot.recipe.base_servings,
        )
        for slot in plan.slots.all()
        for line in slot.recipe.ingredient_lines.all()
    ]


def get_shopping_list_for_user(*, user, plan_id: int) -> tuple[int, list[ShoppingItem]]:
    """Возвращает id плана и покупки. Чужой или несуществующий план — NotFound."""
    plan = get_plan_for_user(user=user, plan_id=plan_id)
    return plan.id, aggregate_shopping_items(collect_plan_lines(plan))


class StaleShoppingQuantity(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The shopping quantity has changed."


def checklist(plan: MealPlan) -> tuple[list[ShoppingItem], set[int]]:
    items = aggregate_shopping_items(collect_plan_lines(plan))
    marks = dict(plan.purchased_ingredients.values_list("ingredient_id", "quantity_version"))
    return items, {
        item.ingredient_id
        for item in items
        if marks.get(item.ingredient_id) == item.quantity_version
    }


def invalidate_purchases(sender, plan, **kwargs):
    if plan.purchased_ingredients.exists():
        _, valid = checklist(plan)
        plan.purchased_ingredients.exclude(ingredient_id__in=valid).delete()


def set_purchased(plan: MealPlan, ingredient_id: int, *, purchased: bool, quantity_version: str):
    items = aggregate_shopping_items(collect_plan_lines(plan))
    item = next((item for item in items if item.ingredient_id == ingredient_id), None)
    if item is None:
        raise NotFound
    if quantity_version != item.quantity_version:
        raise StaleShoppingQuantity
    marks = PurchasedIngredient.objects.filter(plan=plan, ingredient_id=ingredient_id)
    if purchased:
        marks.update_or_create(
            plan=plan, ingredient_id=ingredient_id, defaults={"quantity_version": quantity_version}
        )
    else:
        marks.delete()
