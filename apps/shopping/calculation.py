"""Чистый расчёт количеств для списка покупок; ORM здесь не используется."""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

QUANTITY_STEP = Decimal("0.001")
QUANTITY_SCALE = 1000


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

    Decimal из каталога переводится в точную дробь целых чисел (``Fraction``), поэтому
    умножение, деление и суммирование не зависят от точности контекста Decimal.
    Округление до 3 знаков ROUND_HALF_UP выполняется один раз — после суммирования.
    Результат отсортирован по ingredient_id.
    """
    sums: dict[int, Fraction] = defaultdict(Fraction)
    meta: dict[int, tuple[str, str]] = {}

    for line in lines:
        if line.servings <= 0 or line.base_servings <= 0:
            raise ValueError("servings and base_servings must be positive.")
        if not line.quantity.is_finite() or line.quantity <= 0:
            raise ValueError("quantity must be a positive finite Decimal.")
        sums[line.ingredient_id] += Fraction(line.quantity) * line.servings / line.base_servings
        meta.setdefault(line.ingredient_id, (line.name, line.unit))

    items = []
    for ingredient_id in sorted(sums):
        name, unit = meta[ingredient_id]
        items.append(
            ShoppingItem(
                ingredient_id=ingredient_id,
                name=name,
                unit=unit,
                quantity=_round_half_up(sums[ingredient_id]),
            )
        )
    return items


def _round_half_up(value: Fraction) -> Decimal:
    """Точно округляет положительную дробь до 0.001 по правилу ROUND_HALF_UP."""
    thousandths, remainder = divmod(value.numerator * QUANTITY_SCALE, value.denominator)
    if remainder * 2 >= value.denominator:
        thousandths += 1
    return Decimal(f"{thousandths}E-3")


def format_quantity(quantity: Decimal) -> str:
    """Единое строковое представление количества для JSON, CSV и TXT."""
    return format(quantity.quantize(QUANTITY_STEP, ROUND_HALF_UP), "f")
