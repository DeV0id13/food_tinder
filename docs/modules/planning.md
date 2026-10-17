# FT-04 — planning

Модуль `planning` реализует ручной конструктор рациона: планы на 1/3/7 дней, их слоты и порции.
Рецепты берутся из избранного пользователя через публичный selector модуля `preferences`.

## Файлы

- `apps/planning/models.py` — модели `MealPlan` и `MealPlanSlot`, валидатор `enabled_meals` и ограничения БД.
- `apps/planning/serializers.py` — входные serializers, `PlanSummary`, `PlanDetail` и `Slot`.
- `apps/planning/views.py` — list/create планов, detail/delete плана, PUT/DELETE слота.
- `apps/planning/selectors.py` — `get_plan_for_user(*, user, plan_id)` для FT-05 и
  `get_locked_plan_for_user(*, user, plan_id)` для записей под `SELECT FOR UPDATE`.
- `apps/planning/urls.py` — маршруты FT-04; `day_index` использует локальный знаковый конвертер `sint`.
- `apps/planning/migrations/0001_initial.py` — миграция планов и слотов.
- `tests/planning/` — API-тесты и отдельный тестовый URLConf.

## Модели и ограничения

- `MealPlan`: `user` (FK CASCADE), `start_date`, `duration_days` из `{1, 3, 7}`, непустой JSON-массив
  `enabled_meals` без повторов. Значение `duration_days` защищено ограничением БД.
- `MealPlanSlot`: `plan` (FK CASCADE, `related_name="slots"`), `day_index` 0..6, `meal_type` из
  `breakfast/lunch/snack/dinner`, `recipe` (FK PROTECT на `catalog.Recipe`), `servings` 1..20.
  Уникальность `(plan, day_index, meal_type)` и диапазоны защищены ограничениями БД.
- `day_index=0` соответствует `start_date`. Пустой слот — отсутствие строки; у слота максимум один рецепт.
- Модель не имеет FK на `preferences`: доступность выбора проверяется через selector.

## Интеграция

Для подключения API интегратор должен добавить в `config/urls.py`:

```python
path("api/v1/meal-plans/", include("apps.planning.urls")),
```

Общий файл `config/urls.py` в рамках FT-04 не изменяется. До merge API тестируется через
`tests/planning/urls.py`, поэтому корневой URLConf проекта для тестов не редактируется.

Миграция `apps/planning/migrations/0001_initial.py` зависит от:

```python
("catalog", "0001_initial")
```

и от текущей модели пользователя через `settings.AUTH_USER_MODEL`. Обратной зависимости от
`preferences` и `shopping` нет: `is_favorite` вызывается на уровне кода view, а не схемы БД.

## API

Все endpoints приватные: гость получает `403` при текущей `SessionAuthentication`. Ответы
исключены из публичного кеширования (`Cache-Control: no-store`).

| Метод | Путь | Результат |
| --- | --- | --- |
| GET | `/api/v1/meal-plans/` | Страница `PlanSummary`, сортировка `id` по убыванию |
| POST | `/api/v1/meal-plans/` | `201` `PlanDetail` с пустыми `slots` |
| GET | `/api/v1/meal-plans/<plan_id>/` | `200` `PlanDetail` |
| DELETE | `/api/v1/meal-plans/<plan_id>/` | `204`, каскадно удаляет слоты |
| PUT | `/api/v1/meal-plans/<plan_id>/slots/<day_index>/<meal_type>/` | `200` `Slot`, идемпотентно создаёт/заменяет |
| DELETE | `/api/v1/meal-plans/<plan_id>/slots/<day_index>/<meal_type>/` | `204`, в том числе для пустого допустимого слота |

`PlanSummary`: `{id, start_date, duration_days, enabled_meals}`.
`PlanDetail` добавляет `slots`, отсортированные по `day_index`, затем по порядку
`breakfast/lunch/snack/dinner`. `Slot`: `{day_index, meal_type, recipe_id, recipe_title, servings}`.

Список использует локальную `LimitOffsetPagination`: `limit=30` по умолчанию, максимум 100, `offset=0`.
Неизвестные поля записи, включая `user_id`, отклоняются с `400`. Владельцем плана всегда становится
`request.user`.

## Поведение

- Создать или заменить рецепт в слоте можно только активным рецептом из своего избранного.
- Если рецепт слота не изменился (меняются только порции), рецепт повторно не проверяется на
  избранное и активность: ранее сохранённый рецепт остаётся, даже если его убрали из избранного.
  Совместимость `meal_type` с актуальным `recipe.meal_types` проверяется всегда, в том числе при
  смене только порций: каталог мог изменить допустимые приёмы пищи после сохранения слота.
- Рецепт не из избранного — `400` по полю `recipe_id`; неактивный или несуществующий новый рецепт — `404`.
- Невалидный `day_index` (включая отрицательный), выключенный приём пищи, несовместимый `meal_type` или `servings` вне 1..20 — `400`.
- Доступ к плану проверяется первым: чужой или отсутствующий план даёт `404`, вложенные endpoints не
  раскрывают данные чужих планов — это относится и к `day_index=-1`.
- Повторный PUT обновляет тот же слот; уникальность защищена БД (семантика «последняя запись побеждает»).
  Конкурентный тест `TestPlanningConcurrentSlotPut` (только PostgreSQL, `transaction=True`, два потока
  с независимыми соединениями за барьером) проверяет: оба PUT дают `200`, в БД ровно одна строка,
  а `(recipe_id, servings)` целиком совпадают с одним из payload.
- Все записи (PUT/DELETE слота, DELETE плана) выполняются в `transaction.atomic()` с блокировкой
  строки плана через `SELECT FOR UPDATE`; порядок блокировок единый — сначала план, затем слоты.
  План, удалённый конкурентным запросом, даёт `404`, а не `500`.
- Период, `start_date` и `enabled_meals` после создания не изменяются; несколько планов с одинаковыми
  датами разрешены.

## Selector для FT-05

Покупки используют только публичную функцию:

```python
get_plan_for_user(*, user, plan_id: int) -> MealPlan
```

Она возвращает план только его владельцу, иначе возбуждает `rest_framework.exceptions.NotFound`.

## Проверки

```sh
docker compose run --rm web pytest tests/planning
docker compose run --rm web ruff check apps/planning tests/planning
docker compose run --rm web ruff format --check apps/planning tests/planning
docker compose run --rm web python manage.py check
docker compose run --rm web python manage.py makemigrations --check --dry-run
```
