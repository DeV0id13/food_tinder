# FT-03 — preferences

Реализованы состояние пользователя для рецепта, реакции, избранное, персональная лента и selector для FT-04.

## Файлы

- \`apps/preferences/models.py\` — \`UserRecipeState\`, уникальность \`(user, recipe)\`.
- \`apps/preferences/serializers.py\` — RecipeSummary, RecipeState и входные serializers.
- \`apps/preferences/views.py\` — feed, swipes, favorite, favorites.
- \`apps/preferences/selectors.py\` — \`is_favorite(*, user_id, recipe_id)\`.
- \`apps/preferences/urls.py\` — маршруты FT-03.
- \`apps/preferences/migrations/0001_initial.py\` — миграция состояния.
- \`docs/modules/preferences.md\` — интеграционные указания.

## Интеграция

После слияния FT-02 и появления \`apps.catalog.models.Recipe\` добавить единственный include:

\`\`\`python
path("api/v1/preferences/", include("apps.preferences.urls")),
\`\`\`

в \`config/urls.py\`. Этот общий файл в FT-03 не изменяется.

Миграция FT-03 зависит от \`apps.catalog 0001_initial\`.

## Поведение

- like сохраняет первое \`liked_at\`;
- like снимает активный dislike;
- dislike действует до следующей полуночи UTC;
- expired dislike не удаляется, но перестаёт влиять на feed;
- favorite не меняет like/dislike;
- снятие favorite сохраняет остальные состояния;
- inactive recipe нельзя лайкнуть/dislike или добавить в favorite, но favorite можно снять;
- feed гостя показывает все активные рецепты, feed пользователя исключает его лайки и активные dislike;
- состояния пользователей полностью изолированы;
- feed/favorites сортируются по recipe.id asc;
- pagination: limit 1..100, default 30, offset >= 0.
