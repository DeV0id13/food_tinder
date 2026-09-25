# FT-02 — каталог рецептов

## Модели и ограничения

- `Ingredient`: уникальный `slug`, название и каноническая единица `g`, `ml` или `pcs`. Используемый ингредиент защищён от удаления (`PROTECT`), а его единица не меняется через модель или Admin.
- `Recipe`: уникальный `slug`, карточка, время приготовления, сложность 1–5, базовое число порций, непустые массивы `meal_types` и `steps`, флаг активности. Пять необязательных показателей на порцию — `Decimal(10,2)` с неотрицательными значениями; `null` означает неизвестное значение. Они не вычисляются из состава.
- `RecipeIngredient`: связь рецепта с ингредиентом, уникальная пара и положительное `Decimal(12,3)` количество на **весь** рецепт с `base_servings` порциями. Для `pcs` количество целое. Простые инварианты подкреплены ограничениями PostgreSQL, правила JSON и `pcs` проверяются моделью.

## Admin

Ингредиенты и рецепты редактируются в Django Admin; строки состава — inline рецепта. Неактивный рецепт может оставаться без состава. Для активного рецепта formset проверяет итоговые inline-строки с учётом добавления и удаления, поэтому создание рецепта вместе с первой строкой допускается, а публикация без строк отвергается.

## Публичный API

Оба endpoint доступны гостю и вошедшему пользователю; клиентское редактирование каталога отсутствует.

| Метод | Путь | Результат |
| --- | --- | --- |
| GET | `/api/v1/recipes/` | Активные рецепты, `id` по возрастанию, страница `count/next/previous/results` |
| GET | `/api/v1/recipes/<recipe_id>/` | Активный рецепт с шагами и составом; неактивный/неизвестный ID даёт 404 |

Локальная `LimitOffsetPagination`: `limit=30` по умолчанию, максимум 100, `offset=0`. `RecipeSummary` содержит только `id`, `title`, `image_url`, `cooking_time_minutes`, `difficulty`, `base_servings`, `meal_types` и пять справочных показателей на порцию. `RecipeDetail` добавляет `description`, `steps` и `ingredients`; строка состава содержит только `ingredient_id`, `name`, `unit`, `quantity`. Decimal передаётся строкой с точкой; `quantity` всегда с тремя знаками. `slug` и `is_active` в DTO отсутствуют.

## Демонстрационные данные

`python manage.py seed_demo_recipes` в одной транзакции создаёт 12 активных рецептов и общие ингредиенты по стабильным slug. Команда при повторном запуске находит существующие записи и не обновляет их поля или состав. Она не создаёт пользователей. Контрольные `demo-rice-chicken` (рис 200.000 g, курица 300.000 g) и `demo-rice-milk` (рис 100.000 g, молоко 200.000 ml) имеют `base_servings=2`, допускают lunch/dinner и используют один Ingredient риса. Их ID следует получать по slug из БД.

## Миграции, проверки и интеграция

Модельная схема создана миграцией `apps/catalog/migrations/0001_initial.py`. Для PostgreSQL выполняются `python manage.py migrate` и `python manage.py seed_demo_recipes`. Проверки модуля: `pytest tests/catalog`, `ruff check apps/catalog tests/catalog`, `ruff format --check apps/catalog tests/catalog`, `python manage.py check`, `python manage.py makemigrations --check --dry-run` и общий `pytest` через Compose.

После merge интегратору нужно добавить в `config/urls.py`:

```python
path("api/v1/recipes/", include("apps.catalog.urls"))
```

До этого API тестируется через `tests/catalog/urls.py`. Других подключений и новых зависимостей не требуется.
