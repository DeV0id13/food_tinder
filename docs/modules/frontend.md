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
проверяет подключение всех URLConf и полный cookie/CSRF сценарий auth/catalog/preferences/
planning/shopping с реальной PostgreSQL через основной `config.urls`, включая восстановление
планов и порций в новой сессии.

Ручной сценарий описан в `frontend/README.md`. Проверяются также 1280 px без горизонтального
overflow, loading/empty/error states, независимость Favorite/Like, 1/3/7 plans, servings,
replace, актуальные покупки и оба download действия.

### Интеграция с настоящим backend (19 ноября 2026)

В `ft-06` уже присутствуют модели, миграции и API всех FT-01…FT-05. По текущему поручению
пользователя в `config/urls.py` добавлены недостающие подключения:

- `/api/v1/meal-plans/` → `apps.planning.urls`.
- `/api/v1/shopping-list/` → `apps.shopping.urls`.

Auth, catalog и preferences были подключены ранее. Контракты моделей/API, permissions,
Django sessions, CSRF, settings и зависимости не менялись. Новые миграции не нужны.
На локальной PostgreSQL применены существующие миграции и выполнен `seed_demo_recipes`
(12 рецептов без перезаписи имеющихся данных). Frontend запущен через Vite на
`http://localhost:5173/`, Django — в Compose на порту 8000.

Проверки:

- `docker compose exec -T web pytest`: **317 passed**, 22 существующих предупреждения
  Django о будущей смене схемы URLField.
- `pytest tests/test_frontend_integration.py -q`: **16 passed**. Общие маршруты, CSRF,
  регистрация без автовхода, вход, избранное/реакции, планы 1/3/7, порции, пересчёт,
  CSV/TXT, восстановление данных в новой сессии и удаление через API.
- Ruff check и format check `config/urls.py tests/test_frontend_integration.py`: успешно.
- `manage.py check`: успешно; `makemigrations --check --dry-run`: изменений нет.
- `npm test`: **51 passed**; `npm run lint` и `npm run build`: успешно.
- `npm run test:integration`: **1 passed** через настоящий Vite proxy, Django и PostgreSQL.
  Используются реальные `ApiClient`/`RealApi`, независимые cookie jars и Origin
  `http://localhost:5173`. Проверены регистрация, ротация CSRF после входа, отдельное
  избранное и лайк, планы 1/3/7, порции, покупки, CSV/TXT, вход тем же аккаунтом из
  новой сессии, сохранённые данные, удаление слота и запрет приватных запросов после выхода.

Live-проверка находится в `frontend/tests/backend-integration.test.mjs` и запускается отдельно:
ей нужны работающие dev-сервисы и заполненный каталог. Она создаёт случайный тестовый аккаунт
`ft06-smoke-…@example.test`, удаляет только собственные планы и снимает своё избранное.
Тестовый аккаунт и его лайк остаются в локальной базе; пароль нигде не выводится и не сохраняется.
Чужие записи и Docker volumes проверка не меняет. Внешний адрес сервера не допускается.

В приватном окне Firefox проверены регистрация без автоматического входа, отдельный вход,
избранное, создание рациона на три дня, назначение рецепта и изменение числа порций.
После изменения с трёх до четырёх порций покупки пересчитались с 300 до 400 г риса и с 450
до 600 г курицы. Firefox подтвердил скачивание CSV и TXT. После перезагрузки в браузере
сохранились сессия и избранное. Восстановление рациона и порций в новой сессии проверено
через Vite и API, как описано выше. Ручной сценарий находится в `frontend/README.md`.

## Ограничения

Пользовательские данные real mode сохраняются в PostgreSQL. Покупки вычисляются из плана
и состава рецептов, без отдельной таблицы или копии в browser storage. Demo mode остаётся
явным и независимым. Набор из 52 demo-блюд не переносится в настоящую БД автоматически.

Не входят profile UI, drag-and-drop, автоплан, ML, undo, история, суммарные КБЖУ, бюджет,
purchased state и production deploy. Backend-изменения ограничены подключением готовых
маршрутов и связанными интеграционными проверками.
