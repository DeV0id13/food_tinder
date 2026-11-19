# FoodTinder frontend

Установите зависимости командой `pnpm install --frozen-lockfile` из `frontend/`.
Подготовьте локальный `.env` по [корневой инструкции](../README.md) и запустите Docker Desktop.
Из корня репозитория выполните:

```sh
docker compose build web
./frontend/dev-lan.sh start
```

Откройте адрес из терминала. Для остановки используйте `./frontend/dev-lan.sh stop`.
Админка доступна на `http://localhost:8000/admin/`. Каталог можно заполнить из админки
или [массовым импортом](../docs/modules/catalog.md#импорт-каталога).

Из `frontend/` используйте `pnpm test`, `pnpm lint` и `pnpm build`.
Полный сценарий проверяет `pnpm run test:integration` при запущенных сервисах и заполненном каталоге.
