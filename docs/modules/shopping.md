# FT-05 — shopping

Модуль `shopping` рассчитывает список покупок по собственному сохранённому плану
и отдаёт его как JSON, CSV и TXT. Собственных таблиц и миграций нет: источник истины —
текущий план (`planning`) и состав рецептов (`catalog`), которые модуль только читает.

## Файлы

- `apps/shopping/calculation.py` — чистая функция `aggregate_shopping_items` и
  `format_quantity`; без ORM, поэтому тестируется без БД.
- `apps/shopping/services.py` — `get_shopping_list_for_user`: проверка владельца через
  `apps.planning.selectors.get_plan_for_user` и чтение `plan.slots`,
  `slot.recipe.ingredient_lines`, `line.ingredient` одним prefetch.
- `apps/shopping/exporters.py` — `render_csv`, `render_txt`; количества не считают,
  а получают готовый результат расчёта.
- `apps/shopping/serializers.py`, `views.py`, `urls.py` — HTTP-слой.
- `tests/shopping/` — тесты расчёта, экспорта и API с отдельным тестовым URLConf.

## Интеграция

После слияния FT-04 интегратор добавляет в `config/urls.py`:

```python
path("api/v1/shopping-list/", include("apps.shopping.urls")),
```

Модуль импортирует `apps.planning.selectors`, поэтому подключать URLConf можно только
после FT-04. Миграций нет; ни один другой модуль не зависит от `shopping`.

`tests/shopping/test_api.py` пропускается через `pytest.importorskip`, пока в master нет
`apps.planning.models`. Тесты расчёта и экспорта работают и без planning.

## API

| Метод и путь | Результат |
| --- | --- |
| GET `/api/v1/shopping-list/?plan_id=<id>` | 200 `{"plan_id", "items": [{ingredient_id, name, unit, quantity}]}` |
| GET `/api/v1/shopping-list/export/?plan_id=<id>&file_type=csv\|txt` | 200, файл `attachment; filename="shopping-list-<id>.<ext>"` |

- Гость — 403; чужой или несуществующий план — 404 (без раскрытия данных и без файла).
- Отсутствующий, пустой, нецелый или вне диапазона `1..2^63-1` `plan_id` — 400 по полю `plan_id`.
- Отсутствующий или неизвестный `file_type` (в том числе `CSV` в другом регистре) — 400
  по полю `file_type`. Параметры проверяются до обращения к плану.
- Формат файла задаёт только `file_type`: export-view использует локальный
  `FileTypeContentNegotiation` и не отвечает 406 на `Accept: text/csv`, `text/plain` и т.п.
  Ошибки 400/403/404 при любом `Accept` возвращаются как JSON. Глобальные настройки DRF не меняются.
- Ответы помечены `never_cache` (`Cache-Control: no-store, private, ...`).
- Content-Type: `text/csv; charset=utf-8` и `text/plain; charset=utf-8`.

## Расчёт

Для каждого ингредиента: `sum(line.quantity × slot.servings / recipe.base_servings)`.

- Decimal из каталога переводится в точную дробь целых чисел (`fractions.Fraction`):
  умножение, деление и суммирование не зависят от точности контекста Decimal
  (`prec=28`) и величины знаменателей. Затем — единственное целочисленное округление
  до 3 знаков по правилу `ROUND_HALF_UP`, результат снова Decimal.
  float не используется, построчного и промежуточного округления нет.
- Один ингредиент из разных слотов и дней — одна строка; единица берётся из Ingredient.
- `pcs` не округляется до целых (`1.500`).
- Порядок строк — ingredient.id по возрастанию, одинаковый во всех форматах.
- Строковое количество во всех форматах формирует одна функция `format_quantity`.

## Форматы файлов

- CSV: UTF-8 с BOM, разделитель `;`, заголовок `ingredient;quantity;unit`, строки `\r\n`.
  Разделители, кавычки и переводы строк экранирует модуль `csv`. Текстовая ячейка,
  у которой первый значимый символ `=`, `+`, `-`, `@`, или которая начинается с
  табуляции/перевода строки, получает префикс `'`.
- TXT: UTF-8, строка `[ ] Рис — 400.000 g` на продукт.
- Пустой план: JSON `items: []`, CSV только с заголовком, TXT `Список покупок пуст`.

## Ограничения

- Изменение каталога влияет на последующий расчёт: снимков состава нет по контракту.
- Не входят отметки «куплено», ручные товары, объединение планов, цены и упаковки.
