# FoodTinder Backend

Основа backend FoodTinder для командной разработки. На этом этапе реализованы
пользователь, профиль и инфраструктура; рецепты, свайпы, рекомендации, планы питания
и списки покупок будут отдельными задачами.

## Stack

- Python 3.12+, Django 5.2 LTS, Django REST Framework.
- PostgreSQL 16+, Django ORM и migrations.
- Django sessions, SessionAuthentication, Django Admin.
- psycopg 3 для PostgreSQL, Pillow для проверки изображений в ImageField.
- Docker / Docker Compose; Gunicorn в production image.
- pytest, pytest-django, Ruff.

Прямые Python-зависимости закреплены точными версиями в `[dependency-groups]`
файла `pyproject.toml`: группы `base`, `dev` и `prod`.
Окружение development не устанавливает Gunicorn; production не устанавливает инструменты тестирования.

## Architecture

Модульный монолит: один Django-проект и одна PostgreSQL БД, разделение по предметным областям.

| App | Ответственность |
| --- | --- |
| accounts | Пользователь, профиль, аутентификация; позднее ограничения питания |
| catalog | Будущие рецепты, ингредиенты, теги, оборудование, категории и шаги |
| preferences | Будущие реакции, избранное, история и выдача ленты |
| planning | Будущие планы питания и слоты |
| shopping | Будущие списки покупок и CSV/TXT экспорт |

`catalog`, `preferences`, `planning` и `shopping` пока содержат только AppConfig.
Общие слои добавляются по необходимости: сейчас в `common` находится health view,
а искусственных service/repository/selector слоёв нет.

```text
.
├── manage.py
├── config/              # settings, URLs, WSGI, ASGI
├── apps/
│   ├── accounts/        # User, UserProfile, Admin, validator, migration
│   ├── catalog/
│   ├── preferences/
│   ├── planning/
│   └── shopping/
├── common/
├── tests/
├── docker/init_env.py
├── Dockerfile
├── compose.yaml
├── .env.example
├── pyproject.toml       # Python dependencies, pytest, Ruff
└── README.md
```

### Пользователи и пароли

`AUTH_USER_MODEL=accounts.User` задан до первой миграции. Поля username нет;
единственный логин — обязательный email. В FoodTinder весь email считается
регистронезависимым, нормализуется в нижний регистр, а уникальность дополнительно
защищена индексом PostgreSQL на `lower(email)`. Методы `create_user()` и
`create_superuser()` проверяют нормализованный email стандартным Django `validate_email`;
пустой или некорректный email приводит к `ValidationError` до сохранения пользователя.
Пароли, permissions, группы,
сессии и админка используют стандартные механизмы Django.

Пароль: минимум 10 символов, только `A-Z`, `a-z`, `0-9` и `_`;
обязательны строчная и заглавная буквы, цифра и подчёркивание.
Фраза «только латинские буквы» трактуется как запрет других алфавитов:
цифры и `_` разрешены, поскольку они обязательны по требованиям.
Также включены стандартные проверки сходства с данными пользователя и распространённых паролей.
Django проверяет пароль в Admin/createsuperuser. Как и стандартный Django,
`create_user()` сам не вызывает password validation: будущий API должен вызывать
`django.contrib.auth.password_validation.validate_password` перед сохранением.

Профиль — отдельная необязательная запись OneToOne; создаётся явно, сейчас через Admin.
Никаких сигналов для автоматического создания и медицинских расчётов нет.
Локальные аватары хранятся в `media/`, исключённой из Git.

### API

| Метод и путь | Ответ |
| --- | --- |
| GET /api/v1/health/ | `{"status":"ok"}` |
| GET /api/v1/auth/session/ | `{"authenticated":false,"id":null,"email":null}` для гостя; id/email вошедшего пользователя |

Health проверяет работоспособность HTTP-процесса, не доступность БД.
Сессия проверяется через Django session cookie. Оба endpoint публичны, только для чтения.
По умолчанию новые DRF endpoints требуют аутентификации.
Session response запрещён для кеширования. Signup/login/profile CRUD пока отсутствуют;
для ручной проверки сессии можно войти в Admin и открыть session endpoint в том же браузере.
Для инициализации CSRF frontend вызывает `GET /api/v1/auth/session/`: endpoint
устанавливает cookie `csrftoken` даже для анонимного пользователя через `ensure_csrf_cookie`.
Затем frontend передаёт значение cookie в заголовке `X-CSRFToken` изменяющих запросов.

## Requirements

- Git.
- Docker Engine / Docker Desktop с Linux containers и Docker Compose v2.
- Свободный локальный порт 8000.
- Python на хосте не обязателен: все команды ниже выполняются в контейнерах.

## Python dependencies

Все прямые Python-зависимости объявлены в `pyproject.toml` стандартными
[группами PEP 735](https://packaging.python.org/en/latest/specifications/dependency-groups/).
Настройки pytest и Ruff находятся в том же файле.

| Группа | Состав |
| --- | --- |
| `base` | Django, DRF, psycopg и Pillow |
| `dev` | `base` + pytest, pytest-django и Ruff |
| `prod` | `base` + Gunicorn |

Для установки групп нужен **pip >= 25.1**. Dockerfile обеспечивает эту версию
и устанавливает нужную группу автоматически. Приложение запускается из исходников;
сборка собственного Python-пакета для установки зависимостей не требуется.

При работе в активированном virtualenv или CI выполняйте из корня репозитория:

```sh
python -m pip install "pip>=25.1"
python -m pip install --group dev
```

Для отдельного production-окружения вместо `--group dev` используйте `--group prod`.
При необходимости установить только общие библиотеки — `--group base`.
Группы `dev` и `prod` включают `base`, перечислять общие библиотеки повторно не нужно.
Установка группы добавляет зависимости, но не удаляет ранее установленные пакеты:
development и production должны использовать отдельные окружения.

После изменения зависимостей пересоберите соответствующий Docker target.
Прямые версии закреплены; отдельный lock-файл транзитивных зависимостей пока не используется.
Переменные окружения и PostgreSQL для запуска Django настраиваются как обычно:
установка группы сама по себе не загружает `.env` и не запускает БД.

## Local Development

Команды выполняются из корня проекта; подходят для PowerShell и обычной Unix shell.

1. Клонировать репозиторий (основная стабильная ветка — `master`):

   ```sh
   git clone https://github.com/DeV0id13/food_tinder.git
   cd food_tinder
   ```

   Для разработки отдельной задачи создать ветку от актуального `master`, например:

   ```sh
   git switch -c feat/ft-01-accounts
   ```

2. Создать `.env` из `.env.example` с новыми случайными секретами:

   ```sh
   docker run --rm -v "${PWD}:/workspace" -w /workspace python:3.12-slim python docker/init_env.py
   ```

   Скрипт не перезаписывает существующий `.env`. При наличии Python 3.12+ достаточно
   `python docker/init_env.py`. Секреты не выводятся в терминал.
   Настройки загружает Docker Compose; Django не читает `.env` автоматически.

3. Собрать web image и поднять PostgreSQL:

   ```sh
   docker compose build web
   docker compose up -d --wait postgres
   ```

4. Применить миграции:

   ```sh
   docker compose run --rm web python manage.py migrate
   ```

5. Создать администратора, задав email и пароль интерактивно:

   ```sh
   docker compose run --rm web python manage.py createsuperuser
   ```

6. Запустить backend:

   ```sh
   docker compose up -d web
   docker compose logs --tail=50 web
   ```

7. Открыть [Django Admin](http://localhost:8000/admin/).
8. Открыть [health endpoint](http://localhost:8000/api/v1/health/) или проверить командой:

   ```sh
   docker compose exec web python -c "from urllib.request import urlopen; print(urlopen('http://127.0.0.1:8000/api/v1/health/').read().decode())"
   ```

Compose запускает только `web` и `postgres`; web ждёт успешного healthcheck БД.
Миграции применяются явно, без гонок при старте нескольких процессов.
Код примонтирован для autoreload. PostgreSQL не публикует порт на хост;
`POSTGRES_HOST=postgres` работает внутри Compose network.
Web доступен только на loopback хоста. Данные БД сохраняются в named volume.
Смена POSTGRES_PASSWORD после создания volume требует отдельно изменить пароль роли в БД.

Остановить сервисы, сохранив данные:

```sh
docker compose down
```

## Tests

Тесты используют **PostgreSQL**, отдельную временную БД `test_foodtinder`.
Локальная роль PostgreSQL из Compose может создавать тестовые БД.
Не запускайте тесты с production credentials.

```sh
docker compose run --rm web pytest
```

Проверяются system check, health/session, email-пользователь и аутентификация,
ограничения БД, валидатор пароля, профиль, Admin и CSRF.
Временный POST endpoint для проверки SessionAuthentication существует только в тестовом URLConf.

## Lint

```sh
docker compose run --rm web ruff check .
docker compose run --rm web ruff format --check .
```

Автоформатирование: `docker compose run --rm web ruff format .`.

## Migrations

```sh
docker compose run --rm web python manage.py makemigrations
docker compose run --rm web python manage.py migrate
docker compose run --rm web python manage.py makemigrations --check --dry-run
docker compose run --rm web python manage.py check
```

Миграции коммитятся вместе с моделями. Учебные SQLite базы не используются и не переносятся.

## Environment and production

`.env.example` предназначен для локальной разработки, настоящие секреты в Git не попадают.
Django прекращает запуск без DJANGO_SECRET_KEY, POSTGRES_DB, POSTGRES_USER или POSTGRES_PASSWORD.
Для production используйте отдельное окружение и секреты, а не локальный `.env`:

- `DJANGO_DEBUG=false`, конкретные `DJANGO_ALLOWED_HOSTS` (список через запятую).
- `CSRF_TRUSTED_ORIGINS` — точные HTTPS origins браузерного приложения.
- При DEBUG=false по умолчанию включены secure session/CSRF cookies и HTTPS redirect.
  Эти настройки можно явно менять через `SESSION_COOKIE_SECURE`,
  `CSRF_COOKIE_SECURE`, `SECURE_SSL_REDIRECT`.
- HSTS по умолчанию выключен независимо от DEBUG:
  `DJANGO_SECURE_HSTS_SECONDS=0`, `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=false`,
  `DJANGO_SECURE_HSTS_PRELOAD=false`. Включайте HSTS только после подтверждения
  корректной HTTPS-конфигурации production-домена; отдельно проверьте поддомены
  перед включением includeSubDomains и preload. Прежние имена переменных
  `SECURE_HSTS_*` без префикса `DJANGO_` больше не используются.
- Same-origin deployment использует Django sessions и CSRF middleware.
  Для будущих изменяющих запросов frontend должен передавать `X-CSRFToken`.
- `DJANGO_TRUST_PROXY_HEADERS=true` допустим только за доверенным TLS proxy,
  который удаляет присланный клиентом `X-Forwarded-Proto` и выставляет его сам.
- `POSTGRES_*` задают подключение, `POSTGRES_SSLMODE=verify-full` — для БД с
  настроенным доверенным TLS сертификатом. Production роль должна иметь
  минимальные необходимые права, без superuser/CREATEDB.
- `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`,
  `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `EMAIL_USE_SSL`, `EMAIL_TIMEOUT`,
  `DEFAULT_FROM_EMAIL` настраивают почту. TLS и SSL одновременно не включают.
  Password reset flow пока не реализован.

Production image собирается отдельно и по умолчанию запускает Gunicorn от непривилегированного пользователя:

```sh
docker build --target production -t foodtinder-backend:prod .
```

При развёртывании передайте environment variables, выполните `python manage.py migrate`,
`python manage.py collectstatic --noinput` и `python manage.py check --deploy`
в production окружении. Пока HSTS выключен, deploy check выдаёт ожидаемое предупреждение;
рассмотрите остальные предупреждения отдельно. TLS termination и раздача `staticfiles/` / `media/`
должны обеспечиваться платформой размещения; Gunicorn их не обслуживает.
Production deployment и внешние сервисы в этот scaffold не входят.
