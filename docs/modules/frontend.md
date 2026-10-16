# FT-06 — frontend

## Результат

`frontend/` полностью заменён на модульное vanilla JavaScript приложение. Пользовательский
сценарий FT-01…FT-05 доступен через UI: гостевой каталог, регистрация и отдельный login,
реакции, избранное, ручные рационы, shopping list и backend CSV/TXT export.

Frontend не содержит копии server state в localStorage. После reload real mode снова читает
session, feed, favorites, meal plans и выбранные данные через API.

## Стек и структура

- HTML5, CSS, vanilla JavaScript, ES modules;
- Vite 8.3.4 — dev server, `/api/` proxy и production build;
- Node built-in test runner, без отдельного test framework;
- локальные Manrope, favicon и фотографии прежнего прототипа.

Ключевые каталоги:

- `src/api/` — единый HTTP client, real API facade и изолированный demo adapter;
- `src/api/demo-recipes.js` — дополнительные блюда; вместе с исходными шестью дают 52
  варианта только для demo mode, с составом, шагами и совместимостью с приёмами пищи;
- `src/views/` — чистые render-функции экранов;
- `src/components/` — карточка и detail рецепта;
- `src/state/` — структура runtime state и сброс приватных данных;
- `src/utils/` — DOM escaping, форматирование, plan helpers, Blob download;
- `src/app.js` — controller событий, загрузок и мутаций;
- `tests/` — API/CSRF/errors/demo/plan/feed tests.

## API client

`ApiClient` принимает только URL под `/api/v1/`, добавляет query parameters, всегда отправляет
`credentials: "include"` и централизованно обрабатывает:

- JSON и текстовые ошибки;
- `204 No Content` как `null`;
- 400 `validation`, 401/403 `auth`, 404 `not_found`, 5xx `server`;
- fetch failure как отдельный `network` error;
- Blob response и filename/filename* из `Content-Disposition`.

Native browser `fetch` вызывается через глобальный объект, а не как метод экземпляра
`ApiClient`: это сохраняет обязательный receiver браузерного API. Отдельный тест
защищает от возврата `Illegal invocation`, ошибочно выглядевшего как network failure.

UI обновляет favorite/feed/plan только после успешного ответа. Ошибка не приводит к
optimistic success. 403 показывает повторный вход; client дополнительно перечитывает session,
чтобы отличить гостя от ещё существующей сессии с CSRF-проблемой.

Пагинированные catalog/favorites/plans собираются по `next` с `limit=100`. Feed всегда читает
первую страницу `limit=30&offset=0`; после swipe выполняется новый запрос первой страницы,
старый offset не увеличивается.

## Session и CSRF

1. При boot: `GET /api/v1/auth/session/`.
2. Django устанавливает `csrftoken`; session DTO определяет guest/authenticated state.
3. Перед POST/PUT/PATCH/DELETE client читает актуальный `csrftoken` из cookie.
4. Если cookie нет, client повторно вызывает session endpoint.
5. Unsafe request получает `X-CSRFToken`, JSON body и session cookie.
6. После login `RealApi` обязательно повторно читает session endpoint, поэтому следующий
   unsafe request использует ротированный CSRF token.
7. Logout очищает runtime private state и возвращает публичную ленту.

После подтверждённого `POST logout/` (204) `RealApi.logout()` возвращает guest session.
Controller сразу очищает приватные данные и отрисовывает гостя; дополнительный GET session
для CSRF выполняется отдельно, его ошибка показывается, но не отменяет успешный выход.
Если сам POST не прошёл, состояние аккаунта сохраняется и сообщение об успешном выходе не появляется.

Все загрузки привязаны к поколению сессии, ID аккаунта и номеру запроса конкретного ресурса.
Поколение меняется при login/logout (включая повторный вход тем же аккаунтом) и смене/сбросе
авторизации. Устаревшие результаты и ошибки игнорируются до изменения state; проверка
повторяется и после асинхронного session refresh при 403. Это относится также к персональной
ленте. При boot/login рационы не загружаются до открытия соответствующего раздела.

Пароль используется только для текущего register/login request. Session token, cookies и
пароль не записываются в browser storage.

## Backend endpoints

| Область | Endpoints |
| --- | --- |
| Auth | `GET auth/session/`, `POST auth/register/`, `POST auth/login/`, `POST auth/logout/` |
| Catalog | `GET recipes/`, `GET recipes/<id>/` |
| Preferences | `GET preferences/feed/`, `POST preferences/swipes/`, `PUT preferences/favorites/<id>/`, `GET preferences/favorites/` |
| Planning | `GET/POST meal-plans/`, `GET/DELETE meal-plans/<id>/`, `PUT/DELETE meal-plans/<id>/slots/<day>/<meal>/` |
| Shopping | `GET shopping-list/?plan_id=`, `GET shopping-list/export/?plan_id=&file_type=csv\|txt` |

Все пути добавляются к `/api/v1/`; завершающий slash сохранён.

## Feed, guest и favorites

- Feed публичен; вошедший пользователь получает персональные исключения от backend.
- Like гостя открывает экран входа.
- Guest dislike добавляет ID только в runtime `Set`, не отправляется и исчезает при reload.
- Authenticated like/dislike вызывает API, затем перезагружает первую страницу feed.
- Favorite — отдельный PUT. Он меняет звезду/коллекцию после успеха и не скрывает карточку.
- Favorite IDs строятся из server favorites response, так как RecipeSummary не содержит
  `is_favorite`.

## Meal plan flow

Создание передаёт только `start_date`, `duration_days` (1/3/7) и непустой
`enabled_meals`. Список планов сортирует backend; UI выбирает активный ID и отдельно получает
PlanDetail. Дни вычисляются только для отображения из start_date/day_index.

Для каждого enabled slot UI показывает favorite recipes, у которых `meal_types` содержит
meal type слота. PUT одновременно создаёт, меняет servings или заменяет recipe. Если ранее
сохранённый рецепт уже удалён из favorites, он остаётся доступным как current option, чтобы
разрешённое backend изменение одних servings продолжало работать. DELETE slot и DELETE plan
вызывают только согласованные endpoints.

После любой slot/plan mutation cached shopping response инвалидируется. При открытии покупок
или по кнопке «Обновить» выполняется новый backend request.

При переключении рациона запрос запоминает выбранный ID и свой номер. Ответ применяется,
только если ID, номер запроса и сессия всё ещё актуальны. Старые данные убираются на время
загрузки. Перед изменением слота/удалением плана проверяется совпадение отображённого и
выбранного ID; операция использует зафиксированный ID, а picker блокируется на время мутации.
Те же проверки действуют для списка покупок и CSV/TXT. Инвалидация покупок отменяет право
ожидающего старого ответа обновить UI.

## Shopping и export

Frontend показывает `name`, точную decimal-string `quantity` и `unit` из response. Никаких
коэффициентов, агрегации или округления в JS нет.

CSV/TXT запрашиваются с `file_type`; ответ читается как Blob. Имя берётся из
`Content-Disposition` с fallback. Содержимое файлов не генерируется frontend.

## Demo mode

`?demo=1` выбирает `DemoApi` до старта приложения. Banner остаётся видимым на каждом экране.
Adapter реализует тот же интерфейс отдельно от `RealApi`, хранит данные только в памяти и
сбрасывается при reload. Ошибки real API никогда не создают и не включают `DemoApi`.

Demo нужен для независимой разработки, пока интегратор не подключил FT-01…FT-05. Его smoke
test не заменяет проверку реального Django/PostgreSQL.

## Dev proxy

`vite.config.js` проксирует `/api` на `http://127.0.0.1:8000` с `changeOrigin: false`.
Frontend открывается через `http://localhost:5173`. Backend settings, CORS и CSRF не менялись.

## Проверки FT-06

Автоматически:

```sh
pnpm test
pnpm lint
pnpm build
```

Тесты покрывают URL building, absolute pagination links, cookie parsing, CSRF bootstrap/header,
credentials, JSON и 204, HTTP/network classification, Blob filename, explicit real/demo choice,
регистрацию без автовхода, demo favorite/swipe/plan/shopping/export, совместимость meal type,
day/slot helpers и guest memory-only dislike.

`tests/app-state.test.mjs` проверяет управляемыми Promise обратный порядок ответов рационов
и покупок, поздние network/403 ошибки, повторный запрос того же ID, смену аккаунта A → logout → B,
сброс авторизации и logout 204 с ошибкой GET session. `tests/test_frontend_integration.py`
проверяет подключение готовых URLConf и общий cookie/CSRF сценарий auth/catalog/preferences
с реальной PostgreSQL через основной `config.urls`.

Ручной сценарий описан в `frontend/README.md`. Проверяются также 1280 px без горизонтального
overflow, loading/empty/error states, независимость Favorite/Like, 1/3/7 plans, servings,
replace, актуальные покупки и оба download действия.

### Проверено при исправлении PR #18 (16 октября 2026)

- `pnpm test`: 47 passed; `pnpm lint` и `pnpm build`: успешно.
- Django с PostgreSQL 16.14: все миграции применены, `seed_demo_recipes` создал 12 рецептов.
- `pytest`: 202 passed, 1 skipped (shopping API требует отсутствующий FT-04),
  22 предупреждения Django о будущей смене схемы URLField.
- Ruff check и format check для `config/urls.py` и `tests/test_frontend_integration.py`:
  успешно; `manage.py check` и `makemigrations --check --dry-run`: успешно, новых миграций нет.
- В браузере через `localhost:5173` и настоящий proxy проверены гостевой feed, предложение
  входа по Like, регистрация без автовхода, login, отдельный Favorite без исчезновения
  карточки, Like/Dislike со следующей карточкой, detail, восстановление сессии/избранного
  после reload и logout. Отсутствующий FT-04 показывает 404, не переключая режим.
- В явном demo проверены 52 блюда, планы 1/3/7, выбор сохранённого плана, совместимый
  favorite в слоте, изменение servings и рецепта, удаление слота, актуализация/пустое
  состояние shopping и CSV/TXT actions.
- При ширине viewport 1280 px горизонтального overflow нет.

Полный real E2E рационов/покупок/экспорта не заявляется пройденным: нужен FT-04.

## Интеграционные зависимости и ограничения

По явному разрешению пользователя в этом PR подключены готовые `apps.catalog.urls`
к `/api/v1/recipes/` и `apps.preferences.urls` к `/api/v1/preferences/`. Auth уже подключён.
Контракты, permissions, session authentication, CSRF и settings не менялись.

Оставшиеся зависимости: в `ft-06` FT-04 пока содержит только AppConfig, без models/selectors/urls.
Поэтому `/api/v1/meal-plans/` ещё недоступен. FT-05 готов, но его services импортирует
`apps.planning.selectors`; подключение shopping URLConf до FT-04 сломает загрузку проекта.
После FT-04 нужно подключить оба оставшихся URLConf, применить его миграции и выполнить
полный real smoke (планы, servings, покупки и экспорт). Frontend отображает настоящую API
ошибку для отсутствующих маршрутов, без автоматического demo fallback.

Не входят profile UI, drag-and-drop, автоплан, ML, undo, история, суммарные КБЖУ, бюджет,
purchased state и production deploy. Backend-изменения этого PR ограничены подключением
готовых маршрутов и связанными интеграционными проверками.

### Уточнение интерфейса после проверки пользователем

Готовая реализация FT-04 найдена в `origin/feat/ft-04-planning`, но не в `master`/`ft-06`.
Пользователь явно отказался от её слияния в рамках текущего исправления. Backend не менялся.
Отсутствующий collection endpoint (404) теперь даёт понятное сообщение о недоступности
рационов/покупок с переходом к рецептам, без дублирующего общего not-found banner.
Ошибка коллекции хранится отдельно в `plansError`, очищается перед повторным запросом
и при смене сессии. Остальные HTTP/network ошибки и 404 отдельного плана не маскируются.

Экран аккаунта больше не содержит технических объяснений про backend, Django, cookies,
CSRF и browser storage. Подсказка пароля отражает действующие правила, а успешная регистрация
по-прежнему только предлагает отдельно войти. При ширине до 1120 px форма и описание идут
одной колонкой, чтобы текст не сжимался в узкий столбец.

Проверки: `pnpm test` — 51 passed; `pnpm lint` и `pnpm build` — успешно.
