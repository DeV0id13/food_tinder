from decimal import Decimal, localcontext

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
        (11, "g", "400"),
        (12, "g", "450"),
        (13, "ml", "200"),
    ]


def test_contract_example_after_servings_change_and_slot_removal():
    assert as_rows(aggregate_shopping_items(contract_lines(servings_a=1))) == [
        (11, "g", "200"),
        (12, "g", "150"),
        (13, "ml", "200"),
    ]
    assert as_rows(aggregate_shopping_items(contract_lines(servings_a=1, with_b=False))) == [
        (11, "g", "100"),
        (12, "g", "150"),
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
        (11, "g", "40"),
        (13, "ml", "150"),
    ]


def test_rounding_happens_only_after_summation():
    # Округлять каждую строку нельзя: 0.0004 × 3 = 0.0012, итог 1, а не 3.
    lines = [line(RICE, "0.001", servings=2, base_servings=5) for _ in range(3)]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "1")]


def test_non_terminating_division_keeps_exact_sum():
    # 100/3 + 100/3 + 100/3 = 100; построчное округление вверх дало бы 102.
    lines = [line(RICE, "100.000", servings=1, base_servings=3) for _ in range(3)]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "100")]


def test_different_base_servings_are_combined_without_intermediate_rounding():
    # 0.001/3 + 0.001/6 = 0.0005 ровно; округляем один раз вверх до 1.
    lines = [
        line(RICE, "0.001", servings=1, base_servings=3),
        line(RICE, "0.001", servings=1, base_servings=6),
    ]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "1")]


def test_large_common_denominator_does_not_lose_precision():
    # Точная сумма 11.0005 должна стать 12 даже при больших общих знаменателях.
    bases = [114, 493, 386, 498, 479, 227, 94, 406, 482, 113, 451, 437]
    lines = [line(RICE, "0.057", servings=1, base_servings=bases[0])] + [
        line(RICE, str(base), servings=1, base_servings=base) for base in bases[1:]
    ]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "12")]


def test_result_does_not_depend_on_decimal_context_precision():
    # 123.456 × 7 / 3 = 288.064, поэтому итог 289 при любом prec.
    lines = [line(RICE, "123.456", servings=7, base_servings=3)]

    with localcontext(prec=3):
        [item] = aggregate_shopping_items(lines)

    assert format_quantity(item.quantity) == "289"


def test_tiny_positive_fraction_rounds_up_to_one():
    lines = [line(RICE, "0.001", servings=1, base_servings=2)]

    assert as_rows(aggregate_shopping_items(lines)) == [(11, "g", "1")]


def test_float_sensitive_values_stay_exact():
    # В float 0.1 + 0.2 != 0.3.
    lines = [
        line(MILK, "0.100", servings=1, base_servings=1),
        line(MILK, "0.200", servings=1, base_servings=1),
    ]

    [item] = aggregate_shopping_items(lines)
    assert item.quantity == Decimal("1")
    assert isinstance(item.quantity, Decimal)


def test_pieces_are_rounded_up_to_whole_units():
    lines = [line(EGG, "3.000", servings=1, base_servings=2)]

    assert as_rows(aggregate_shopping_items(lines)) == [(14, "pcs", "2")]


@pytest.mark.parametrize(
    ("quantity", "servings", "base_servings"),
    [("1.000", 0, 2), ("1.000", 1, 0), ("0", 1, 1), ("-1.000", 1, 1), ("NaN", 1, 1)],
)
def test_invalid_line_values_are_rejected(quantity, servings, base_servings):
    with pytest.raises(ValueError):
        aggregate_shopping_items(
            [line(RICE, quantity, servings=servings, base_servings=base_servings)]
        )


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("400", "400"),
        ("1E+3", "1000"),
        ("0.0005", "1"),
        ("12.3456", "13"),
        ("12.000", "12"),
        ("0", "0"),
    ],
)
def test_format_quantity_always_rounds_up_to_whole_units(value, expected):
    assert format_quantity(Decimal(value)) == expected


@pytest.mark.parametrize(
    ("ingredient", "amount", "expected"),
    [
        (RICE, "283.333", "284"),
        (MILK, "48.667", "49"),
        (EGG, "2.333", "3"),
        (RICE, "0.001", "1"),
        (MILK, "150.000", "150"),
    ],
)
def test_all_units_are_whole_numbers_after_aggregation(ingredient, amount, expected):
    [item] = aggregate_shopping_items([line(ingredient, amount, servings=1, base_servings=1)])
    assert format_quantity(item.quantity) == expected
    assert item.quantity == item.quantity.to_integral_value()


def test_rounding_occurs_once_after_summing_and_is_not_reflected_in_version():
    first = [line(RICE, "0.400", servings=1, base_servings=1)]
    second = [line(RICE, "0.400", servings=1, base_servings=1)]
    [combined] = aggregate_shopping_items(first + second)
    [single] = aggregate_shopping_items(first)
    assert combined.quantity == single.quantity == Decimal("1")
    assert combined.quantity_version != single.quantity_version
