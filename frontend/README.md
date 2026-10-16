# FoodTinder frontend — FT-06

Минимальный frontend первой итерации FoodTinder. Это SPA без UI-фреймворка: HTML, CSS,
vanilla JavaScript с ES modules и Vite как dev server/build tool. Backend API — единственный
источник аккаунта, рецептов, реакций, избранного, рационов и покупок.

## Возможности

- публичные лента и каталог рецептов, подробная карточка;
- регистрация без автоматического входа, отдельные login/logout;
- Django session cookie и CSRF для всех изменяющих запросов;
- Like, «Не сегодня» и Favorite как три независимых действия;
- избранное, загружаемое с backend;
- создание и выбор рационов на 1, 3 или 7 дней;
- выбор активных приёмов пищи: breakfast, lunch, snack, dinner;
- добавление, замена и удаление слота, изменение servings от 1 до 20;
- фильтрация списка избранного по совместимости с meal type;
- server-driven shopping list;
- скачивание CSV/TXT из ответа backend с Blob и Content-Disposition;
- явные loading, empty, validation, auth/CSRF, not found, server и network states;
- отдельный явно включаемый demo mode без автоматического fallback.

Приложение не хранит server state, пароль или session token в `localStorage`/`sessionStorage`.
Guest dislike живёт только в памяти открытой страницы. После reload real mode заново получает
сессию и данные с backend.

## Требования

- Node.js 22.12+ (подходит и Node.js 24);
- pnpm 11+;
- для real mode — Django backend на `http://127.0.0.1:8000`;
- запуск frontend через `http://localhost:5173`, не через `file://` и не через `127.0.0.1`.

Backend нужно подготовить из корня репозитория по корневому `README.md`: PostgreSQL,
миграции и демонстрационные рецепты. В этой ветке подключены готовые FT-01 (auth),
FT-02 (catalog) и FT-03 (preferences). FT-04 пока не интегрирован в эту ветку; FT-05 зависит от него,
поэтому рационы, покупки и экспорт пока проверяются в явном demo mode. Ошибки real API
не подменяются демо-данными.

## Установка

Из каталога `frontend/`:

```sh
pnpm install
```

Версии frontend-зависимостей зафиксированы в `package.json` и `pnpm-lock.yaml`.

## Real API mode

1. Запустить Django на `http://127.0.0.1:8000`.
2. В `frontend/` выполнить:

   ```sh
   pnpm dev
   ```

3. Открыть `http://localhost:5173/`.

Real mode включён по умолчанию. Ошибки настоящего API показываются пользователю и никогда
не переключают приложение в demo mode.

### Подготовка настоящего backend

С Docker из корня репозитория (предварительно создать `.env` по корневому README):

```sh
docker compose build web
docker compose up -d --wait postgres
docker compose run --rm web python manage.py migrate
docker compose run --rm web python manage.py seed_demo_recipes
docker compose up -d web
```

Если Django запускается на хосте, нужны Python 3.12+, PostgreSQL 16+, виртуальное окружение
с `pip >= 25.1` и зависимости `python -m pip install --group dev`. Передайте переменные
из `.env` в окружение процесса; Django сам этот файл не читает. Укажите `POSTGRES_HOST=127.0.0.1`
и реальный порт локальной БД (вместо Compose hostname `postgres`), затем выполните:

```sh
python manage.py migrate
python manage.py seed_demo_recipes
python manage.py runserver 127.0.0.1:8000
```

В seed backend сейчас 12 рецептов; 52 блюда demo mode — отдельный набор, который
не импортируется в настоящую БД. Для готовых сценариев откройте frontend без `?demo=1`:
гостевой каталог → регистрация → отдельный вход → избранное и реакции → logout.
Перезагрузка страницы восстанавливает настоящую сессию и избранное из PostgreSQL.
Начальная загрузка и login не запрашивают отсутствующие meal plans; запрос выполняется
при переходе в соответствующий раздел. Полный real smoke ниже требует интеграции FT-04.
При 404 коллекции планов UI сообщает «Рационы пока недоступны» (или «Список покупок
пока недоступен») и предлагает вернуться к рецептам. Это не пустой план и не успешная
загрузка; автоматического перехода в demo нет. Сетевые ошибки, 403 и 5xx остаются ошибками.

### Dev proxy и CSRF

Vite проксирует `/api/` на `http://127.0.0.1:8000`:

```js
proxy: {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: false,
  },
}
```

Так браузер работает с одним origin `localhost:5173`, а proxy сохраняет исходный Host.
Отключать Django CSRF или менять CORS не нужно.

При старте клиент вызывает `GET /api/v1/auth/session/`, получает cookie `csrftoken`, читает
её непосредственно перед unsafe request и отправляет `X-CSRFToken`. Все запросы используют
`credentials: "include"`. После login клиент повторно вызывает session endpoint, потому что
Django ротирует CSRF token.

## Demo mode

Demo включается только явным URL:

```text
http://localhost:5173/?demo=1
```

На странице постоянно виден жёлтый banner «Демо-режим». Real и demo API реализованы разными
классами. Сетевая ошибка real mode не включает demo автоматически.

Встроенный demo-вход:

```text
demo@foodtinder.local
DemoPass_1
```

Demo state хранится только в памяти вкладки и сбрасывается при reload. Это средство локальной
проверки UI, а не замена PostgreSQL и не режим миграции данных.

В демо-каталоге 52 разных блюда: каши, яйца и тосты, супы, салаты, паста, блюда с мясом,
рыбой и бобовыми, десерты и перекусы. У каждого есть состав на 2 порции, шаги приготовления,
время и совместимые приёмы пищи. На завтрак, обед, перекус и ужин доступно минимум по
10 вариантов. Откройте «Рецепты», добавьте блюда звёздочкой в «Избранное», затем создайте
«Рацион» и выберите их в соответствующих слотах. Вход обязателен для избранного и рационов.

Данные дополнительных блюд находятся в `src/api/demo-recipes.js`. Существующие фотографии
используются как иллюстрации; если подходящей нет, показывается заглушка. Неизвестные КБЖУ
и цена передаются как `null`. Этот набор используется только в demo mode; в real mode
каталог по-прежнему приходит из backend.

## Команды

```sh
pnpm dev          # Vite dev server, localhost:5173, proxy /api/
pnpm test         # Node test runner
pnpm lint         # синтаксическая проверка критичных JS-модулей
pnpm build        # production build в frontend/dist/
pnpm preview      # просмотр готового build на localhost:4173
```

`dist/` и `node_modules/` игнорируются Git.

Регрессионные проверки контроллера находятся в `tests/app-state.test.mjs`: ответы двух
рационов/покупок в обратном порядке, поздние ошибки, смена аккаунта и logout с сетевой
ошибкой последующего session request. Интеграция готовых серверных маршрутов проверяется
`pytest tests/test_frontend_integration.py` на PostgreSQL (с загруженным окружением backend).

## Структура

```text
frontend/
├── index.html
├── vite.config.js
├── package.json
├── pnpm-lock.yaml
├── public/assets/              # локальные изображения, favicon, Manrope
├── src/
│   ├── api/
│   │   ├── api-client.js       # URL, cookies, CSRF, JSON/204/blob, ошибки
│   │   ├── real-api.js         # контракт /api/v1/
│   │   ├── demo-api.js         # отдельный in-memory demo adapter
│   │   ├── demo-recipes.js     # дополнительные блюда демо-каталога
│   │   └── index.js            # явный выбор режима
│   ├── components/
│   ├── state/
│   ├── utils/
│   ├── views/
│   ├── app.js                  # controller и server-state orchestration
│   ├── main.js
│   └── styles.css
└── tests/
```

## Manual smoke test FT-06

### Real backend

1. Запустить PostgreSQL и Django, применить миграции, добавить demo recipes.
2. Запустить `pnpm dev`, открыть `http://localhost:5173/`.
3. Убедиться, что banner demo отсутствует, а sidebar показывает `Real API`.
4. Как гость открыть «Лента» и «Рецепты», открыть подробности рецепта.
5. Нажать Like: должен открыться экран входа, server state не меняется.
6. Вернуться в ленту и нажать «Не сегодня»: карточка скрывается только до reload.
7. Зарегистрировать новый email и валидный пароль. Убедиться, что UI предлагает войти и
   пользователь всё ещё гость.
8. Войти. В DevTools проверить session cookie; пароль и токены не должны появиться в storage.
9. Нажать звезду. Карточка остаётся на месте, а рецепт появляется в «Избранном».
10. Нажать Like. Должна загрузиться новая первая страница feed и следующая карточка.
11. На другой карточке нажать «Не сегодня» и проверить следующую актуальную карточку.
12. Добавить в избранное минимум по одному совместимому рецепту для нужных meal types.
13. Открыть «Рационы», создать планы на 1, 3 и 7 дней с разными enabled meals.
14. Переключить активный сохранённый план в select.
15. В плане на 1 день назначить favorite recipe в совместимый слот.
16. Изменить servings, сохранить и reload страницы: слот и порции должны прийти с backend.
17. Заменить рецепт в слоте другим совместимым favorite recipe.
18. Удалить слот; повторное удаление допустимого пустого слота не должно ломать UI.
19. Открыть «Покупки», выбрать план и сверить ingredient name, quantity, unit.
20. Изменить servings/slot, вернуться в покупки и нажать «Обновить»: список должен измениться.
21. Скачать CSV и TXT. Проверить имена из `Content-Disposition` и содержимое backend-файлов.
22. Удалить план и убедиться, что он исчез из select.
23. Выйти; приватные экраны должны предлагать вход, публичный каталог остаётся доступен.
24. Войти снова/в другом браузере и проверить восстановление favorites и meal plans с backend.
25. Остановить backend, повторить запрос и убедиться в network error без переключения в demo.
26. Проверить 400 на невалидной форме, 403/expired session и 404 удалённого плана: UI должен
   показывать ошибку и не изображать успешное действие.

### Demo UI

Открыть `http://localhost:5173/?demo=1`, использовать встроенные credentials и повторить
основной UI-сценарий. После reload demo-данные должны сброситься. Этот результат нельзя
засчитывать как проверку backend integration.

## Ограничения первой итерации

Нет drag-and-drop, автозаполнения рациона, профиля, undo, истории свайпов, суммарных КБЖУ,
бюджета и отметок purchased. Frontend не рассчитывает shopping list и не генерирует экспорт.
Production deployment и reverse proxy не входят в FT-06.
