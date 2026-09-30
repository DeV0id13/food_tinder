# FT-03 — preferences

Модуль `preferences` реализует пользовательское состояние рецептов: лайки, суточные дизлайки, избранное и персональную ленту.

## Файлы

- `apps/preferences/models.py` — модель `UserRecipeState` и уникальность `(user, recipe)`.
- `apps/preferences/serializers.py` — `RecipeSummary`, `RecipeState` и входные serializers.
- `apps/preferences/views.py` — feed, swipes, favorite и favorites.
- `apps/preferences/selectors.py` — `is_favorite(*, user_id, recipe_id)` для FT-04.
- `apps/preferences/urls.py` — маршруты FT-03.
- `apps/preferences/migrations/0001_initial.py` — миграция состояния пользователя.
- `tests/preferences/` — API-тесты и отдельный тестовый URLConf.

## Интеграция

Для подключения API интегратор должен добавить в `config/urls.py`:

```python
path("api/v1/preferences/", include("apps.preferences.urls")),
```

Общий файл `config/urls.py` в рамках FT-03 не изменяется.

Миграция `apps/preferences/migrations/0001_initial.py` зависит от:

```python
("catalog", "0001_initial")
```

и от текущей модели пользователя через `settings.AUTH_USER_MODEL`.

Для локальных тестов используется отдельный `tests/preferences/urls.py`, поэтому корневой URLConf проекта изменять для тестирования FT-03 не требуется.

## API

Доступны следующие endpoints:

- `GET /api/v1/preferences/feed/` — публичная персонализированная лента; для гостя возвращает все активные рецепты без пользовательских исключений.
- `POST /api/v1/preferences/swipes/` — сохранить `like` или `dislike`; требуется аутентификация.
- `PUT /api/v1/preferences/favorites/<recipe_id>/` — добавить или удалить рецепт из избранного; требуется аутентификация.
- `GET /api/v1/preferences/favorites/` — список активных избранных рецептов текущего пользователя; требуется аутентификация.

`feed` и `favorites` используют стандартный DRF `LimitOffsetPagination`:

- `limit=30` по умолчанию;
- максимальный `limit=100`;
- `offset=0` по умолчанию;
- `next` и `previous` содержат URL либо `null`.

## Поведение

- `like` сохраняет первое значение `liked_at`; повторный like не меняет исходный timestamp.
- `like` снимает активный dislike.
- `dislike` действует до следующей полуночи UTC.
- Истёкший `disliked_until` не удаляется из БД, но больше не влияет на feed.
- `favorite` не изменяет `liked_at` и `disliked_until`.
- Удаление из избранного сохраняет остальные состояния рецепта.
- Лайк или дизлайк неактивного рецепта возвращает `404`.
- Неактивный рецепт нельзя добавить в избранное, но существующую отметку избранного можно снять.
- Feed авторизованного пользователя исключает его лайкнутые рецепты и рецепты с активным dislike.
- Состояния разных пользователей полностью изолированы.
- Добавление рецепта в избранное само по себе не скрывает его из feed.
- `feed` и `favorites` сортируются по `recipe.id` по возрастанию.
- Неизвестные поля write-запросов, включая `user_id`, отклоняются с `400`.
- `is_favorite` принимает только настоящий JSON boolean: `true` или `false`.

## Selector для FT-04

Planning использует только публичный selector:

```python
is_favorite(*, user_id: int, recipe_id: int) -> bool
```

Функция читает состояние конкретного пользователя и рецепта и не требует импорта views или serializers модуля `preferences`.
