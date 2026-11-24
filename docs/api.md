# Документация API

| Маршрут | Назначение |
| --- | --- |
| `/api/schema/` | OpenAPI 3 в YAML. Для JSON добавьте `?format=json` |
| `/api/docs/` | Swagger UI с отправкой запросов |
| `/api/redoc/` | ReDoc для чтения спецификации |

Схема описывает API пяти модулей и служебные проверки. Она содержит параметры
пагинации и маршрутов, ограничения записи, ошибки и медиа-типы экспорта.
CSV выдаётся как `text/csv` с UTF-8 BOM, TXT как `text/plain` с UTF-8.
Проверка без предупреждений выполняется через
`python manage.py spectacular --file /tmp/foodtinder-openapi.yaml --validate --fail-on-warn`.

При `DJANGO_DEBUG=true` документация доступна по умолчанию. В production её
маршруты по умолчанию отключены. Чтобы дать сотрудникам доступ в production,
установите `DJANGO_API_DOCS_ENABLED=true` и используйте существующую Django-сессию
пользователя с `is_staff`. Включение необязательно для обновления действующего
стенда. Swagger UI и ReDoc загружают ресурсы из `/static/` через Caddy после
обычного `collectstatic`.

## Сессия и CSRF в Swagger UI

1. Откройте документацию на origin Django или Caddy. В режиме dev используйте
   `http://localhost:8000/api/docs/`. На этом же origin можно войти через
   `POST /api/v1/auth/login/` в Swagger. Для закрытой production-документации
   сначала войдите через Django Admin.
2. `GET /api/v1/auth/session/` выдаёт CSRF-cookie гостю и показывает текущую
   сессию. Вход ротирует CSRF-cookie.
3. Выполните защищённый запрос, например `PATCH /api/v1/auth/account/` с именем.
   Браузер отправляет HttpOnly cookie сессии сам. Swagger читает текущую
   `csrftoken` перед каждым изменяющим запросом и посылает `X-CSRFToken`.
   Кнопка Authorize для cookie не нужна.
4. Сторонние API-клиенты передают cookie сессии и актуальный заголовок явно.
   Отказ доступа или проверки CSRF возвращает 403. После исчерпания лимита
   входа или регистрации API возвращает 429 и `Retry-After` в секундах.

Изменения состояния, в том числе вход, регистрация и выход, проходят прежние
проверки сессии, CSRF и прав на ресурсы.
