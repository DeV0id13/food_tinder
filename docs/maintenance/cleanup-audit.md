# FT-MAINT — аудит FoodTinder MVP

База — `master` на `5a031d9db820beb10e433bf77d029237a341ccf7`, сверена с GitHub перед созданием `chore/mvp-cleanup`. Телеметрия production и обращения к отдельным статическим URL недоступны. Проверки выполняются на локальных сборках и временной PostgreSQL 16 без подключения к данным проекта.

## Точки входа

| Область | Как используется |
| --- | --- |
| Django и DRF | `config/settings.py` регистрирует приложения и настройки Django sessions/DRF. `config/urls.py` подключает Admin, health и пять API под `/api/v1/`. `accounts` обслуживает регистрацию, сессию, профиль и аккаунт; `catalog` — публичные рецепты; `preferences` — ленту, свайпы, отмену и закладки; `planning` — планы и слоты; `shopping` — расчёт, отметки и экспорт. |
| Динамические подключения Django | `admin.py` обнаруживается Django, DRF загружает authentication/permissions из settings, `planning/urls.py` регистрирует converter, `ShoppingConfig.ready()` подключает сброс покупок после изменения слотов. Очистка фото вызывается обработчиком `pre_delete` в `catalog/models.py`. Миграции и пути Django Storage учитываются отдельно от прямых импортов. |
| Frontend | `frontend/index.html` → `src/main.js` → `src/app.js`, ES-модули экранов и API, `src/styles.css`. Контроллер читает URL, историю и атрибуты событий из сгенерированных шаблонов. Vite проксирует `/api/` и `/media/`, копирует `public/` в `dist/`. |
| Сборка и эксплуатация | `compose.yaml` запускает Django и PostgreSQL. Production использует Gunicorn/WSGI, образы из GHCR и Caddy через `compose.prod.yaml`, `Dockerfile` и `deploy/`. Caddy раздаёт SPA, static и media и проксирует API/Admin. `ci.yml` запускает проверки и gated deploy для push в master; `security.yml` запускает отдельный scan. |
| CLI, проверки и данные | `manage.py` запускает миграции, `collectstatic`, `createsuperuser` и `import_catalog`. Манифест используется при ручном импорте; инструкции — в `docs/modules/catalog.md`. `docker/init_env.py` генерирует локальный `.env`, `frontend/dev-lan.sh` использует `frontend/compose.lan.yaml`. Pytest, Node test runner и CI читают собственные настройки и fixtures. |

## Кандидаты

Проверки кандидатов начаты до правок. Поиск по отслеживаемым файлам включал `git grep` по именам и ссылкам, `git log --all` по истории путей и `git log -G` по символам. Для Python проверены импорты и низкочастотные определения с учётом подключений выше. Для frontend сопоставлены ES-импорты, шаблоны, обработчики событий, CSS и тесты.

| Файл или символ | Причина | Доказательства | Риск | Рекомендация | Статус |
| --- | --- | --- | --- | --- | --- |
| `frontend/public/assets/manrope-{1,3,4}.ttf` | Три доставляемых файла шрифта без ссылок. | `git grep -n -e 'manrope-' -e 'Manrope'` на базе и просмотр шаблонов: только `src/styles.css` загружает `manrope-0.ttf` и `manrope-2.ttf`. Нет динамического построения имени шрифта. `git log --all -- frontend/public/assets/manrope-1.ttf frontend/public/assets/manrope-3.ttf frontend/public/assets/manrope-4.ttf` ведёт к прототипу. Все три находятся в `dist/assets/` через Vite public copy. | Прямые URL трёх файлов исчезнут из сборки. Ссылок из MVP нет, внешние обращения не измерены. | Удалить файлы и сравнить build и хеши оставшихся ассетов, включая лицензию. | Подтверждён до правок |
| `frontend/src/styles.css`, `.button-danger` | Остаток оформления кнопок. | Поиск по репозиторию находит только два селектора. Проверены HTML, шаблоны экранов, слоты, модалки, `classList` и интерполяция классов: ни один путь не создаёт класс. `.button-ghost` генерируется, в том числе для удаления слота и сброса покупок. | Ошибка в общей группе могла бы снять стиль с рабочих кнопок. | Удалить только два селектора; сравнить CSS и запустить frontend тесты и build. | Подтверждён до правок |
| `frontend/src/constants.js::VIEW_TITLES` | Таблица подписей без потребителей. | Поиск символа и карта ES-импортов находят только объявление. Заголовки и навигацию рендерят шаблоны, маршруты находятся в `utils/routes.js`; установки `document.title` из этой таблицы нет. Нет динамического доступа к exports. | Низкий, frontend не публикует библиотеку. | Удалить; сравнить JS-артефакт и тесты навигации. | Подтверждён до правок |
| `frontend/src/views/recipes-view.js::catalogMatches` и реэкспорт `filterRecipes` | Лишний экспорт локального helper и переадресация тестового импорта. | `catalogMatches` вызывается внутри view для результата и счётчика. Реэкспорт нужен только `frontend/tests/ui-helpers.test.mjs`; исходный helper уже импортирует `slot-picker.js` напрямую из `utils/search.js`. Нет динамической загрузки view по имени export. | Низкий. Фильтрация и её тестовые утверждения сохраняются. | Сделать `catalogMatches` локальной, тест импортирует `filterRecipes` из исходного модуля. Сверить bundle и тесты поиска и фильтров. | Подтверждён до правок |
| `README.md`, `AGENTS.md`, `frontend/README.md`, `docs/modules/{accounts,preferences}.md` | Инструкции от scaffold, FT-06 и FT-03 противоречат рабочему MVP. | `config/urls.py`, `apps/accounts/views.py`, `apps/preferences/views.py`, `apps/planning/editor.py`, `frontend/src/state/plan-drafts.js` и `utils/auto-plan.js` подтверждают актуальные API, эффект лайка, окно отмены, пакетную проверку избранного, данные аккаунта и автоподбор. | Устаревшая инструкция ведёт к неверной ручной проверке; массовая правка затруднила бы сверку. | Обновить конкретные утверждения и ссылки, сохранить команды и материалы проверки. | Подтверждён до правок |
| `docs/ITERATION_1_CONTRACT.md`, `docs/TEAM_TASKS.md`, `docs/modules/{frontend,devops}.md` | Исторические спецификации и отчёты местами читаются как текущие инструкции. | Контракт и задачи привязаны к `3962480`; документы модулей описывают исходные границы FT-06/FT-07. Текущие возможности описаны в корневом и frontend README, отдельный deploy — в `docs/deployment.md`. | Перенос может сломать ссылки и лишить проект учебных материалов. | Отметить контекст и дать ссылку на текущие инструкции, сохранив исторические пути и содержательные материалы. | Подтверждён до правок |
| `docs/deployment.md`, раздел про импорт каталога | Утверждение, что management command не входит в образ, расходится со сборкой. | `Dockerfile` копирует репозиторий в `/app`, команда лежит в `apps/catalog/management/commands/`, а `.dockerignore` исключает локальный `catalog-import`. | Низкий. Резервное копирование, допуск и процедура релиза остаются в инструкции. | Уточнить, что в образе есть команда и манифест, а локальные фотографии подготавливаются отдельно. | Подтверждён до правок |

## Требует решения

| Файл или символ | Доказательства и риск | Статус |
| --- | --- | --- |
| `apps/preferences/selectors.py`, `apps/planning/views.py`, endpoint `.../slots/...` | `is_favorite` вызывается одиночной записью слота, `favorite_recipe_ids` — редактором пакета. Хотя UI сохраняет черновик через bulk POST/PUT, одиночный endpoint есть в URLConf, API-контракте и используется live smoke. Объединение или удаление потребует отдельно оценить клиентов, статус ошибок и блокировки. | Сохранено |
| Django Admin, signals, ASGI, `collectstatic`, опциональный media backend, почтовые настройки | Есть регистрации в Django и документированные эксплуатационные сценарии. Для настроек, активируемых окружением, локальный поиск не доказывает отсутствие использования. Удаление может нарушить обслуживание данных, Admin или восстановление. | Сохранено |
| `pyproject.toml`, `frontend/package.json`, `pnpm-lock.yaml` | Django/DRF используются напрямую, psycopg — через Django PostgreSQL backend, Pillow — в проверках фото и ImageField, Gunicorn — Docker CMD. Pytest/pytest-django, Ruff и pre-commit запускаются проверками. Mypy загружает django-stubs и DRF stubs через плагины. Vite — единственная прямая frontend-зависимость и обслуживает dev и build. `npm start` — альтернативный CLI-вызов dev server, отсутствие вызовов в Git не доказывает отсутствие локальных пользователей. | Сохранено |
| Dockerfile, Compose, Caddy и GitHub Actions | Повторяющаяся установка `base` и включающих её групп работает в отдельных слоях; изменения затронули бы сборку. Отдельные Compose-конфигурации обслуживают тома, LAN и production. CI/deploy и scheduled scan запускаются разными событиями. История #19–#22 и `ci.yml` подтверждают необходимость Environment, SSH, `IMAGE_TAG`, проверок и запрета захвата stdin. | Сохранено |
| `import_catalog`, `docs/catalog/recipes.json`, `frontend/public/assets/editorial/`, шрифты 0 и 2 и лицензия | Импорт документирован и проверяется в `tests/catalog/test_seed.py`; Django Admin и API используют media. `auth-view.js` грузит фото кухни, `shell.js` ссылается на фотоатрибуцию, шрифты связаны с `@font-face`. Дополнительные рецепты и фото служат наполнению и восстановлению. | Сохранено |
| `frontend/START_HERE_RU.md`, скриншоты FT-09 и FT-10 | Короткая инструкция LAN полезна как самостоятельная точка входа, даже без входящих ссылок. Скриншоты нужны для истории и учебной проверки, часть имеет явные ссылки из frontend README. | Сохранено |

## Baseline

Количество строк — физические строки отслеживаемых текстовых файлов, включая пустые. Файлы с NUL в первых 8000 байтах считаются бинарными. Backend включает `apps/`, `common/`, `config/` и `manage.py`. Backend-тесты находятся в `tests/`, frontend-тесты учтены внутри `frontend/`. Документация включает `docs/`, корневые README и AGENTS.

| Область | Файлы | Текстовые файлы | Строки |
| --- | ---: | ---: | ---: |
| Backend | 70 | 70 | 2972 |
| Backend-тесты | 26 | 26 | 4491 |
| Frontend | 53 | 47 | 6529 |
| Документация | 21 | 14 | 5348 |
| Инфраструктура и конфигурация | 23 | 23 | 950 |
| Всего | 193 | 180 | 20290 |

- Прямые зависимости из `pyproject.toml`: 4 base, 7 дополнительных dev, 1 дополнительная prod. Из `frontend/package.json`: 1 dev, 0 runtime.
- `npm run build` (Node 26.13.1, Vite 8.3.4): 12 файлов, 749 140 байт в `frontend/dist`. Размер — сумма байтов обычных файлов.
- `npm test`: 90 passed. `npm run lint`: успешно.
- Сборки `docker build --target development`, `docker build --target production` и `docker build -f deploy/Dockerfile.frontend` выполнены из чистого снимка Git. На Docker Desktop (linux/arm64) `docker image inspect .Size` показывает 360 558 796, 252 213 210 и 88 852 243 байта соответственно.
- `pnpm run test:integration` в Node 22: 1 passed с настоящим Vite proxy, Django и временной PostgreSQL 16 с двумя тестовыми рецептами.
- `ruff check .` и `ruff format --check .` (99 файлов), `python .github/scripts/run_mypy.py` (55 исходников) — успешно в development image с кэшами в `/tmp`.
- `python manage.py check`, `makemigrations --check --dry-run` и `migrate --noinput` — успешно на чистой PostgreSQL 16.15.
- `pytest -q` на PostgreSQL 16.15: 363 passed, 40 существующих предупреждений Django Admin по схеме URL.
- [CI на baseline master](https://github.com/DeV0id13/food_tinder/actions/runs/44729037594): completed/success; интервал GitHub API `run_started_at → updated_at` составил 3 мин 17 с для всего запуска.
