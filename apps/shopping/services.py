from django.db.models import prefetch_related_objects

from apps.planning.selectors import get_plan_for_user

from .calculation import PlannedLine, ShoppingItem, aggregate_shopping_items


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
