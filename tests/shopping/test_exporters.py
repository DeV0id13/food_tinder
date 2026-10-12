import csv
import io
from decimal import Decimal

import pytest

from apps.shopping.calculation import ShoppingItem
from apps.shopping.exporters import protect_csv_text, render_csv, render_txt

ITEMS = [
    ShoppingItem(ingredient_id=11, name="Рис", unit="g", quantity=Decimal("400.000")),
    ShoppingItem(ingredient_id=13, name="Молоко", unit="ml", quantity=Decimal("200")),
]


def parse_csv(content: bytes):
    assert content.startswith(b"\xef\xbb\xbf")
    return list(csv.reader(io.StringIO(content.decode("utf-8-sig")), delimiter=";"))


def test_csv_has_bom_header_and_rows():
    content = render_csv(ITEMS)

    assert content.decode("utf-8-sig").splitlines()[0] == "ingredient;quantity;unit"
    assert parse_csv(content) == [
        ["ingredient", "quantity", "unit"],
        ["Рис", "400.000", "g"],
        ["Молоко", "200.000", "ml"],
    ]


def test_empty_csv_contains_header_only():
    assert parse_csv(render_csv([])) == [["ingredient", "quantity", "unit"]]


def test_txt_lines():
    assert render_txt(ITEMS).decode("utf-8") == "[ ] Рис — 400.000 g\n[ ] Молоко — 200.000 ml\n"


def test_empty_txt_has_message():
    assert render_txt([]).decode("utf-8") == "Список покупок пуст\n"


def test_csv_escapes_separators_quotes_and_newlines():
    name = 'Соус "Острый"; с перцем\nи солью'
    content = render_csv([ShoppingItem(1, name, "g", Decimal("1"))])

    assert parse_csv(content) == [["ingredient", "quantity", "unit"], [name, "1.000", "g"]]
    assert '"Соус ""Острый""; с перцем' in content.decode("utf-8-sig")


@pytest.mark.parametrize(
    "name",
    [
        "=1+1",
        "+79990000000",
        "-2+3",
        "@SUM(A1)",
        '=HYPERLINK("http://example.com";"x")',
        "  =1+1",
        "\t=1+1",
        "\r=1+1",
    ],
)
def test_csv_neutralizes_formulas(name):
    [_, row] = parse_csv(render_csv([ShoppingItem(1, name, "g", Decimal("1"))]))

    assert row[0] == "'" + name
    assert row[1:] == ["1.000", "g"]


@pytest.mark.parametrize("value", ["Рис", "Масло 82%", "Сыр 'Российский'", "1=1", ""])
def test_safe_text_is_not_changed(value):
    assert protect_csv_text(value) == value
