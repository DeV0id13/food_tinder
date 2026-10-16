# FoodTinder frontend: быстрый старт

Это реализация FT-06, подключённая к Django API. Старый автономный localStorage-прототип
заменён; backend является источником всех пользовательских данных.

## Запуск с настоящим backend

1. Запустите Django на `http://127.0.0.1:8000`.
2. В этом каталоге выполните:

   ```sh
   pnpm install
   pnpm dev
   ```

3. Откройте `http://localhost:5173/`.

Vite передаёт `/api/` в Django с `changeOrigin: false`. Используйте именно `localhost`,
чтобы session cookies и CSRF работали в согласованной same-origin схеме.

## Явный demo mode

Если нужно проверить интерфейс без готовых FT-01…FT-05, откройте:

```text
http://localhost:5173/?demo=1
```

Demo обозначен banner, не включается после ошибок real API и хранит данные только в памяти.
Вход: `demo@foodtinder.local` / `DemoPass_1`.

## Проверки

```sh
pnpm test
pnpm lint
pnpm build
```

Полное описание архитектуры, CSRF-flow и manual smoke test находится в `README.md`.
