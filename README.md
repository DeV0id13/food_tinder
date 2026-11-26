# FoodTinder

FoodTinder помогает выбирать рецепты, составлять рацион на 1, 3 или 7 дней и
получать список покупок из сохранённого плана. Рецепты доступны гостям. Свайпы,
избранное, рационы и отметки о покупках привязаны к аккаунту. Покупки можно
выгрузить в CSV или TXT.

**Стек** — Python 3.12+, Django 5.2 LTS, DRF, PostgreSQL 16+, vanilla JS и Vite.
Зависимости закреплены в `uv.lock` и `frontend/pnpm-lock.yaml`. В production
Gunicorn запускает Django, а Caddy раздаёт сайт, static и media на одном origin.

## Демонстрация

После клонирования нужны Docker с Compose v2 и make. Из корня выполните:

```sh
make demo
```

Откройте [FoodTinder на 127.0.0.1:8080](http://127.0.0.1:8080/).
Команда собирает образы с закреплёнными зависимостями, генерирует отдельный
`.env.demo` и загружает 24 демонстрационных рецепта. Повторный запуск
сохраняет учётные записи, правки и тома. Для остановки используйте
`make demo-stop`, для просмотра журналов — `make demo-logs`.

На демонстрации отфильтруйте каталог по завтракам, зарегистрируйте аккаунт,
добавьте рецепт в избранное, составьте рацион на день и экспортируйте покупки.
Для проверки Admin создайте пользователя через
`docker compose --env-file .env.demo -f compose.demo.yaml exec web python manage.py createsuperuser`.

## Среда разработки

Нужны Git, Docker с Compose v2, Node.js 22.13+ (подходит Node.js 24) и pnpm 11.
Из корня репозитория создайте локальный `.env` со случайными секретами:

```sh
docker run --rm -v "${PWD}:/workspace" -w /workspace python:3.12-slim python docker/init_env.py
docker compose build web
docker compose up -d --wait postgres
docker compose run --rm web python manage.py migrate
docker compose up -d web
```

Существующий `.env` сохраняется. Django слушает `http://127.0.0.1:8000`.
Запустите frontend в отдельном терминале и откройте `http://localhost:5173/`:

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Для работы с пустым каталогом создайте администратора командой
`docker compose run --rm web python manage.py createsuperuser` и откройте
`http://localhost:8000/admin/`. Каталог также можно наполнить через
[импорт](docs/modules/catalog.md#импорт-каталога). Остановка через
`docker compose down` сохраняет данные в именованном томе.

Если Django запускается на хосте, установите **uv 0.13.9**, выполните
`uv sync --locked --only-group dev` и передайте переменные локальной PostgreSQL
процессу Django. Compose читает `.env` при запуске контейнеров. Подробности
приведены в [инструкции frontend](frontend/README.md).

## Архитектура и документация

| Модуль | Ответственность |
| --- | --- |
| [accounts](docs/modules/accounts.md) | Email-вход, Django-сессии, профиль, лимиты входа и регистрации |
| [catalog](docs/modules/catalog.md) | Рецепты, ингредиенты, состав, фотографии, Admin и импорт |
| [preferences](docs/modules/preferences.md) | Лента, лайки, временные дизлайки, закладки и отмена свайпа |
| [planning](docs/modules/planning.md) | Рационы, слоты, порции и атомарное сохранение |
| [shopping](docs/modules/shopping.md) | Расчёт покупок, отметки и экспорт |

- [Архитектура и последовательность сохранения рациона](docs/architecture.md)
- [ER-диаграмма и ограничения данных](docs/data-model.md)
- [CI/CD и разница между PR и push в master](docs/ci-cd.md)
- [Зачем приняты архитектурные решения](docs/adr/README.md)
- [API, Swagger UI, ReDoc и сессии](docs/api.md)
- [Готовность, логирование, лимиты и production](docs/deployment.md)
- [Gunicorn, производительность и замеры каталога](docs/performance.md)
- [Мониторинг Prometheus и Grafana](docs/monitoring.md)

В режиме разработки Swagger UI доступен на `http://localhost:8000/api/docs/`,
схема на `/api/schema/`, ReDoc на `/api/redoc/`. `GET /api/v1/health/`
показывает, что HTTP-процесс жив. `GET /api/v1/ready/` проверяет PostgreSQL.
После production deploy мониторинг доступен на `/grafana/` и `/prometheus/`
того же origin с существующей staff-сессией Django (без SSH и отдельного пароля).

## Проверки

Для backend нужен тестовый PostgreSQL. Команды запускаются из корня.

```sh
docker compose run --rm web pytest
docker compose run --rm web pytest --cov --cov-report=term-missing --cov-report=html --cov-report=xml
docker compose run --rm web ruff check .
docker compose run --rm web ruff format --check .
docker compose run --rm web python .github/scripts/run_mypy.py
docker compose run --rm web python manage.py check
docker compose run --rm web python manage.py makemigrations --check --dry-run
docker compose run --rm web python manage.py spectacular --validate --fail-on-warn --file /tmp/foodtinder-openapi.yaml
uv lock --check
```

Coverage включает ветвления в `apps`, `common` и `config` с порогом 94,43%.
CI сохраняет `coverage.xml` и `htmlcov/` из одного прогона. Для просмотра
отчётов на хосте запускайте coverage в локальном uv-окружении или используйте
артефакт `backend-coverage` в GitHub Actions.

Из `frontend/` выполните `pnpm test`, `pnpm lint` и `pnpm build`.
Порядок сквозной проверки в [frontend README](frontend/README.md#ручная-проверка).
