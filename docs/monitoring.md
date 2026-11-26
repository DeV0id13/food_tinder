# Prometheus и Grafana на VM

Профиль `monitoring` добавляет три сервиса в существующий production Compose.
Prometheus хранит временные ряды и опрашивает Django, Caddy и node_exporter каждые
20 секунд с дедлайном 5 секунд. Grafana автоматически загружает источник и
дашборд **FoodTinder · RED / USE**. Лимиты памяти Prometheus, Grafana и
node_exporter составляют 192, 240 и 32 МиБ (464 МиБ суммарно). Квоты CPU
составляют 0,35, 0,35 и 0,10 ядра. Для TSDB заданы 7 дней и 512 МБ.
WAL, текущий head и промежуточные файлы компактации могут занимать
дополнительное место. Оставляйте запас диска.

## Запуск и доступ

Выполните на VM с кодом развёрнутого SHA. Создайте новый файл только при
первой настройке. Если файл существует, он сохраняется вместе с паролем.

```sh
cd /opt/foodtinder
umask 077
test -e .env.monitoring || (set -C; printf 'GF_SECURITY_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env.monitoring)
export IMAGE_TAG=<развёрнутый-sha>
sudo env IMAGE_TAG="$IMAGE_TAG" docker compose -f compose.prod.yaml --env-file .env.prod \
  --profile monitoring up -d --no-deps prometheus grafana node-exporter
```

С рабочего компьютера поднимите туннель и откройте `http://127.0.0.1:3000`.
Используйте `admin` и пароль из `.env.monitoring`, переданный защищённым каналом.
Гостевой вход и самостоятельная регистрация отключены. Пароль из окружения
применяется при первом создании базы Grafana. Для ротации существующего пароля
используйте Grafana, а затем синхронизируйте локальный файл.

```sh
ssh -N -L 127.0.0.1:3000:127.0.0.1:3000 <vm-user>@<vm-host>
```

Порты 9090, 9100, 9180 и 8000 доступны только в приватных сетях Compose.
Grafana публикуется на 127.0.0.1. Публичный Caddy блокирует `/metrics`
и `/_metrics/`. Prometheus подключён к обеим сетям, а Grafana и node_exporter
находятся в отдельной сети без доступа к PostgreSQL. У node_exporter нет
Docker socket, привилегированного режима и Linux capabilities. Read-only
mount корня нужен для statfs корневого раздела, `/proc` и `/proc/1/net`
поставляют счётчики хоста и его интерфейсов. Включены только CPU, RAM,
файловая система, диск, сеть и PSI. Для контейнеров используйте `docker stats`
при диагностике. Проверка PostgreSQL показывает readiness через приложение.
Для неё не требуется отдельный пользователь или передача реквизитов экспортёру.

## Интерпретация дашборда

- **Caddy** считает весь обслуженный HTTP-трафик, включая HTML, статику, медиа,
  API и автоматические перенаправления HTTP → HTTPS. Prometheus оставляет
  одну внешнюю цепочку обработчиков на вход, чтобы не суммировать внутренние
  счётчики Caddy.
- **Django API** считает запросы, дошедшие до приложения, с фиксированным
  методом, именем маршрута Django и группой статуса. Необработанные пути
  получают метку `unresolved`. Гистограмма хранит маршрут без метода и статуса.
  Readiness-запросы к Django также входят в API. Сами scrape-запросы исключены.
- RPS и ошибки вычисляются через `rate` по окну 2 минуты. p50/p95/p99
  используют `histogram_quantile` по агрегированным бакетам. Пустые ряды
  означают отсутствие наблюдений. Серверные задержки и ответы измеряются
  отдельно от клиентских обрывов и тайм-аутов k6.
- Django делит mmap-файлы между workers. Всё содержимое каталога очищается
  при старте master в изолированном контейнере. При замене worker удаляется
  его live gauge, а counters и histogram сохраняются до перезапуска master.
  Prometheus `rate` обрабатывает сброс счётчиков. Для обновления используйте
  пересоздание контейнера, без одновременного запуска двух masters в нём.
- `X-Request-ID` создаёт Caddy перед проксированием и возвращает браузеру.
  Django принимает только UUID заданного формата и добавляет его в логи
  запроса. По ID можно сопоставить Caddy, Gunicorn и события Django.
  Сырые параметры запроса и заголовки в их access-логах исключены.

## Проверка, обновление и остановка

```sh
compose() {
  sudo env IMAGE_TAG="$IMAGE_TAG" docker compose -f compose.prod.yaml \
    --env-file .env.prod --profile monitoring "$@"
}
compose ps
compose logs --tail 50 prometheus grafana node-exporter
compose exec -T prometheus promtool check config /etc/foodtinder/prometheus.yml
compose exec -T prometheus wget -qO- http://127.0.0.1:9090/api/v1/targets
compose exec -T prometheus wget -qO- http://web:8000/_metrics/
compose exec -T prometheus wget -qO- http://proxy:9180/metrics
compose stats --no-stream
```

Запишите несколько выборок CPU и RAM через `compose stats` в покое и при
сопоставимом трафике. Проверьте свободное место через `df -h /`, перезапуски
и OOM через `docker inspect`, размер `prometheus_data` и логов через
`docker system df -v`. Сравните с работой без профиля. Фактический расход
зависит от числа серий, нагрузки и сохраняемой истории.

Остановить мониторинг можно командой `compose stop prometheus grafana node-exporter`.
Чтобы очередной деплой не запустил профиль снова, переименуйте свой
`.env.monitoring` в `.env.monitoring.disabled` с сохранением прав 600. Эти действия
сохраняют приложение и оба тома мониторинга. При необходимости отключить сбор
метрик Django задайте `FOODTINDER_METRICS_ENABLED=0` в `.env.prod` и
пересоздайте только `web`. Корреляция запросов сохраняется.

Deploy по одобренному SHA обновляет опциональный профиль после проверки
приложения, если есть непустой `.env.monitoring`. Для ручного обновления
выполните `compose pull prometheus grafana node-exporter`, затем
`compose up -d --no-deps --force-recreate prometheus grafana node-exporter`.
Остановка и обновление сохраняют именованные `prometheus_data` и `grafana_data`.
Сделайте резервную копию перед обновлением несовместимой версии Grafana.
