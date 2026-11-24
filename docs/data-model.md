# ER-диаграмма FoodTinder

Диаграмма показывает прикладные Django-модели и основные поля. Django также
управляет таблицами сессий, групп, permissions и журнала Admin.

```mermaid
erDiagram
    USER ||--o| USER_PROFILE : has
    USER ||--o{ USER_RECIPE_STATE : owns
    RECIPE ||--o{ USER_RECIPE_STATE : receives
    USER ||--o| LAST_SWIPE : has
    USER_RECIPE_STATE ||--o{ LAST_SWIPE : snapshots
    RECIPE ||--o{ RECIPE_INGREDIENT : contains
    INGREDIENT ||--o{ RECIPE_INGREDIENT : is_used_in
    USER ||--o{ MEAL_PLAN : owns
    MEAL_PLAN ||--o{ MEAL_PLAN_SLOT : contains
    RECIPE ||--o{ MEAL_PLAN_SLOT : is_chosen_for
    MEAL_PLAN ||--o{ PURCHASED_INGREDIENT : tracks
    INGREDIENT ||--o{ PURCHASED_INGREDIENT : is_checked

    USER {
        bigint id PK
        string email UK
        string first_name
        string last_name
        string password
    }
    USER_PROFILE {
        bigint id PK
        bigint user_id FK,UK
        date date_of_birth
        string gender
        int height_cm
        decimal weight_kg
        string avatar
    }
    AUTH_RATE_BUCKET {
        string key PK
        datetime expires_at
        int attempts
    }
    RECIPE {
        bigint id PK
        string slug UK
        string title
        string photo
        string image_url
        int cooking_time_minutes
        int difficulty
        int base_servings
        json meal_types
        json steps
        boolean is_active
    }
    INGREDIENT {
        bigint id PK
        string slug UK
        string name
        string unit
    }
    RECIPE_INGREDIENT {
        bigint id PK
        bigint recipe_id FK
        bigint ingredient_id FK
        decimal quantity
    }
    USER_RECIPE_STATE {
        bigint id PK
        bigint user_id FK
        bigint recipe_id FK
        datetime liked_at
        datetime disliked_until
        boolean is_favorite
        datetime favorited_at
    }
    LAST_SWIPE {
        bigint id PK
        bigint user_id FK,UK
        bigint state_id FK
        uuid token
        string session_hash
        datetime swiped_at
        boolean state_created
        datetime liked_at
        datetime disliked_until
        boolean is_favorite
        datetime favorited_at
    }
    MEAL_PLAN {
        bigint id PK
        bigint user_id FK
        string title
        date start_date
        int duration_days
        json enabled_meals
        bigint version
        uuid creation_key
        string creation_digest
    }
    MEAL_PLAN_SLOT {
        bigint id PK
        bigint plan_id FK
        bigint recipe_id FK
        int day_index
        string meal_type
        int servings
    }
    PURCHASED_INGREDIENT {
        bigint id PK
        bigint plan_id FK
        bigint ingredient_id FK
        string quantity_version
    }
```

- `User` требует непустой email и уникальность по `lower(email)`. `UserProfile`
  и `LastSwipe` имеют уникальный FK пользователя. `LastSwipe` хранит состояние
  перед свайпом, связанное с сессией.
- `AuthRateBucket` имеет независимый HMAC-ключ по операции и адресу, индекс по
  `expires_at` и неотрицательный счётчик. Связи с аккаунтами отсутствуют.
- Рецепты и ингредиенты имеют уникальные slug. Postgres проверяет единицы
  `g/ml/pcs`, положительные время, базовые порции и количество, сложность 1–5,
  а также неотрицательность необязательных показателей КБЖУ и цены. Строка
  состава уникальна по `(recipe_id, ingredient_id)`.
- Состояние рецепта уникально по `(user_id, recipe_id)`. Рацион допускает только
  1, 3 или 7 дней. Непустой `creation_key` уникален в пределах пользователя.
- Слот уникален по `(plan_id, day_index, meal_type)`. Индекс дня 0–6, порции 1–20
  и допустимые типы приёмов пищи защищены в БД. Редактор проверяет, что день и
  приём пищи включены в конкретном рационе и рецепт подходит к слоту.
- Отметка уникальна по `(plan_id, ingredient_id)` и действительна для точной
  версии количества. Удаление плана каскадно удаляет слоты и отметки. Рецепты
  в слотах и ингредиенты в составе защищены Django от удаления через `PROTECT`.
