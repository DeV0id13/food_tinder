from decimal import Decimal

import pytest

from apps.shopping.calculation import PlannedLine, aggregate_shopping_items, format_quantity

RICE = (11, "Рис", "g")
CHICKEN = (12, "Курица", "g")
MILK = (13, "Молоко", "ml")
EGG = (14, "Яйцо", "pcs")


def line(ingredient, quantity, *, servings, base_servings):
    ingredient_id, name, unit = ingredient
    return PlannedLine(
        ingredient_id=ingredient_id,
        name=name,
        unit=unit,
        quantity=Decimal(quantity),
        servings=servings,
        base_servings=base_servings,
    )


def as_rows(items):
    return [(item.ingredient_id, item.unit, format_quantity(item.quantity)) for item in items]


def contract_lines(*, servings_a=3, with_b=True):
    lines = [
        line(RICE, "200.000", servings=servings_a, base_servings=2),
        line(CHICKEN, "300.000", servings=servings_a, base_servings=2),
    ]
    if with_b:
        lines += [
            line(RICE, "100.000", servings=2, base_servings=2),
            line(MILK, "200.000", servings=2, base_servings=2),
        ]
    return lines


def test_contract_example():
    assert as_rows(aggregate_shopping_items(contract_lines())) == [
        (11, "g", "400.000"),
        (12, "g", "450.000"),
        (13, "ml", "200.000"),
    ]


def test_contract_example_after_servings_change_and_slot_removal():
    assert as_rows(aggregate_shopping_items(contract_lines(servings_a=1))) == [
        (11, "g", "200.000"),
        (12, "g", "150.000"),
        (13, "ml", "200.000"),
    ]
    assert as_rows(aggregate_shopping_items(contract_lines(servings_a=1, with_b=False))) == [
        (11, "g", "100.000"),
        (12, "g", "150.000"),
    ]


def test_empty_plan_gives_no_items():
    assert aggregate_shopping_items([]) == []


def test_same_ingredient_from_several_slots_is_one_sorted_row():
    lines = [
        line(MILK, "50.000", servings=1, base_servings=1),
        line(RICE, "10.000", servings=1, base_servings=1),
        line(MILK, "50.000", servings=2, base_servings=1),
        line(RICE, "10.000", servings=3, base_servings=1),
    ]

    assert as_rows(aggregate_shopping_items(lines)) == [
        (11, "g", "40.000"),
        (13, "ml", "150.000"),
    ]


def test_rounding_happens_only_after_summation():
    # Каждая строка 0.0004 после масштабирования округлилась бы до 0.000; сумма 0.0012 → 0.001.
    lines = [line(RICE, "0.001", servings=2, base_servings=5) for _ in range(3)]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "0.001")]


def test_non_terminating_division_keeps_exact_sum():
    # 100/3 + 100/3 + 100/3 = 100; построчное округление дало бы 99.999.
    lines = [line(RICE, "100.000", servings=1, base_servings=3) for _ in range(3)]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "100.000")]


def test_different_base_servings_are_combined_without_intermediate_rounding():
    # 0.001/3 + 0.001/6 = 0.0005 ровно → ROUND_HALF_UP даёт 0.001.
    lines = [
        line(RICE, "0.001", servings=1, base_servings=3),
        line(RICE, "0.001", servings=1, base_servings=6),
    ]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "0.001")]


def test_half_up_rounding_of_final_sum():
    lines = [line(RICE, "0.001", servings=1, base_servings=2)]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "0.001")]


def test_float_sensitive_values_stay_exact():
    # В float 0.1 + 0.2 != 0.3.
    lines = [
        line(MILK, "0.100", servings=1, base_servings=1),
        line(MILK, "0.200", servings=1, base_servings=1),
    ]

    [item] = aggregate_shopping_items(lines)
    assert item.quantity == Decimal("0.300")
    assert isinstance(item.quantity, Decimal)


def test_pieces_are_not_rounded_to_whole_units():
    lines = [line(EGG, "3.000", servings=1, base_servings=2)]

    assert as_rows(aggregate_shopping_items(lines)) == [(14, "pcs", "1.500")]


@pytest.mark.parametrize(("servings", "base_servings"), [(0, 2), (1, 0)])
def test_non_positive_servings_are_rejected(servings, base_servings):
    with pytest.raises(ValueError):
        aggregate_shopping_items(
            [line(RICE, "1.000", servings=servings, base_servings=base_servings)]
        )


@pytest.mark.parametrize(
    ("value", "expected"),
    [("400", "400.000"), ("1E+3", "1000.000"), ("0.0005", "0.001"), ("12.3456", "12.346")],
)
def test_format_quantity_has_three_decimal_places(value, expected):
    assert format_quantity(Decimal(value)) == expected
