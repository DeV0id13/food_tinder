"""Чистый расчёт количеств для списка покупок; ORM здесь не используется."""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from math import lcm

QUANTITY_STEP = Decimal("0.001")


@dataclass(frozen=True)
class PlannedLine:
    """Строка состава рецепта, стоящего в одном слоте плана."""

    ingredient_id: int
    name: str
    unit: str
    quantity: Decimal
    servings: int
    base_servings: int


@dataclass(frozen=True)
class ShoppingItem:
    ingredient_id: int
    name: str
    unit: str
    quantity: Decimal


def aggregate_shopping_items(lines: Iterable[PlannedLine]) -> list[ShoppingItem]:
    """Суммирует ``quantity × servings / base_servings`` по ingredient_id.

    Произведения ``quantity × servings`` точны в Decimal, поэтому копятся отдельно
    для каждого base_servings. Деление выполняется один раз на ингредиент через общий
    знаменатель, округление до 3 знаков ROUND_HALF_UP — только после суммирования.
    Результат отсортирован по ingredient_id.
    """
    sums: dict[int, dict[int, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    meta: dict[int, tuple[str, str]] = {}

    for line in lines:
        if line.servings <= 0 or line.base_servings <= 0:
            raise ValueError("servings and base_servings must be positive.")
        sums[line.ingredient_id][line.base_servings] += line.quantity * line.servings
        meta.setdefault(line.ingredient_id, (line.name, line.unit))

    items = []
    for ingredient_id in sorted(sums):
        by_base = sums[ingredient_id]
        denominator = lcm(*by_base)
        numerator = sum(
            (total * (denominator // base) for base, total in by_base.items()), Decimal()
        )
        name, unit = meta[ingredient_id]
        items.append(
            ShoppingItem(
                ingredient_id=ingredient_id,
                name=name,
                unit=unit,
                quantity=(numerator / denominator).quantize(QUANTITY_STEP, ROUND_HALF_UP),
            )
        )
    return items


def format_quantity(quantity: Decimal) -> str:
    """Единое строковое представление количества для JSON, CSV и TXT."""
    return format(quantity.quantize(QUANTITY_STEP, ROUND_HALF_UP), "f")
