"""Чистый расчёт количеств для списка покупок; ORM здесь не используется."""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal
from fractions import Fraction
from hashlib import sha256


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
    quantity_version: str = ""


def aggregate_shopping_items(lines: Iterable[PlannedLine]) -> list[ShoppingItem]:
    """Суммирует ``quantity × servings / base_servings`` по ingredient_id.

    Decimal из каталога переводится в точную дробь целых чисел (``Fraction``), поэтому
    умножение, деление и суммирование не зависят от точности контекста Decimal.
    Количества для покупки округляются строго вверх до целого один раз —
    после точного суммирования. quantity_version остаётся привязанной к точной
    дроби: изменение количества не теряется при совпадении округлённого числа.
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
        total = sums[ingredient_id]
        items.append(
            ShoppingItem(
                ingredient_id=ingredient_id,
                name=name,
                unit=unit,
                quantity=_round_up(total),
                quantity_version=sha256(f"{unit}:{total}".encode()).hexdigest(),
            )
        )
    return items


def _round_up(value: Fraction) -> Decimal:
    """Точно округляет итоговую положительную дробь до целого вверх."""
    whole, remainder = divmod(value.numerator, value.denominator)
    return Decimal(whole + bool(remainder))


def format_quantity(quantity: Decimal) -> str:
    """Целые единицы для JSON, CSV и TXT, включая устаревшие дробные данные."""
    return format(quantity.to_integral_value(rounding=ROUND_CEILING), "f")
