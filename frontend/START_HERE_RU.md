# FoodTinder frontend: быстрый старт

Это реализация FT-06, подключённая к Django API. Старый автономный localStorage-прототип
заменён; backend является источником всех пользовательских данных.

## Запуск с настоящим backend

1. Подготовьте PostgreSQL, примените миграции и выполните `python manage.py seed_demo_recipes`
   из окружения backend. Запустите Django на `http://127.0.0.1:8000`.
2. В этом каталоге выполните:

   ```sh
   pnpm install
   pnpm dev
   ```

3. Откройте `http://localhost:5173/`.

Vite передаёт `/api/` в Django с `changeOrigin: false`. Используйте именно `localhost`,
чтобы session cookies и CSRF работали в согласованной same-origin схеме.

Готовые auth/catalog/preferences подключены: регистрация, вход, 12 рецептов, реакции
и избранное работают с Django. FT-04 planning пока отсутствует, поэтому рационы,
покупки и экспорт в real mode недоступны. Для проверки этих экранов используйте
явный demo mode, а не отключение CSRF или автоматический fallback.

## Явный demo mode

Если нужно проверить интерфейс без готовых FT-01…FT-05, откройте:

```text
http://localhost:5173/?demo=1
```

Demo обозначен banner, не включается после ошибок real API и хранит данные только в памяти.
Вход: `demo@foodtinder.local` / `DemoPass_1`.
В demo доступны 52 блюда; этот набор не импортируется в настоящую БД.

## Проверки

```sh
pnpm test
pnpm lint
pnpm build
```

Полное описание архитектуры, CSRF-flow и manual smoke test находится в `README.md`.
