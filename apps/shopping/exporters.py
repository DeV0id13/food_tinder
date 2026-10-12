"""Представление готового списка покупок в файлах. Количества здесь не считаются."""

import csv
import io

from .calculation import ShoppingItem, format_quantity

CSV_HEADER = ("ingredient", "quantity", "unit")
EMPTY_TXT_MESSAGE = "Список покупок пуст"
FORMULA_PREFIXES = ("=", "+", "-", "@")
FORMULA_CONTROL_PREFIXES = ("\t", "\r", "\n")


def protect_csv_text(value: str) -> str:
    """Не даёт табличному редактору выполнить текстовую ячейку как формулу."""
    if value.startswith(FORMULA_CONTROL_PREFIXES) or value.lstrip().startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def render_csv(items: list[ShoppingItem]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    for item in items:
        writer.writerow(
            (
                protect_csv_text(item.name),
                format_quantity(item.quantity),
                protect_csv_text(item.unit),
            )
        )
    return buffer.getvalue().encode("utf-8-sig")


def render_txt(items: list[ShoppingItem]) -> bytes:
    if not items:
        return f"{EMPTY_TXT_MESSAGE}\n".encode()
    lines = [f"[ ] {item.name} — {format_quantity(item.quantity)} {item.unit}" for item in items]
    return ("\n".join(lines) + "\n").encode()
