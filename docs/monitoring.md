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

Каждый одобренный production deploy автоматически запускает Prometheus,
Grafana и node_exporter после проверки приложения. Не нужны .env.monitoring,
отдельный пароль Grafana, SSH-туннель или новые публичные порты.

Откройте на том же origin, что FoodTinder:

- /grafana/ — Grafana, домашний дашборд FoodTinder (также /grafana/d/foodtinder/foodtinder).
- /prometheus/ — интерфейс и API Prometheus.
- /admin/ — вход с существующим staff-аккаунтом Django.

Гость перенаправляется на вход Django Admin, обычный пользователь получает 403.
Caddy проверяет активную staff-сессию на каждом запросе, включая ресурсы и API.
Grafana получает проверенный идентификатор staff через auth proxy, создаёт
Viewer при первом входе и не требует собственного пароля. Вход Grafana по
паролю и анонимный доступ выключены. Выход из Django Admin закрывает дальнейший
доступ к обоим сервисам. Django cookies и Authorization не передаются
мониторингу. Prometheus не включает admin/lifecycle API.

Grafana строит root URL из первого значения CSRF_TRUSTED_ORIGINS, которое
должно быть точным основным origin (как в production-инструкции).
Для текущего временного HTTP-развёртывания это http://130.193.45.53.
На HTTPS-домене используйте существующий HTTPS origin. HTTP не шифрует
staff-сессию: используйте HTTPS перед реальной эксплуатацией.

Порты 3000, 9090, 9100, 9180 и 8000 не публикуются на хосте. Caddy
блокирует /metrics, /_metrics/ и внутренний маршрут авторизации.
Prometheus и Caddy подключены к обеим сетям, Grafana и node_exporter
находятся в отдельной сети без прямого доступа к PostgreSQL.
У node_exporter нет Docker socket, привилегированного режима и Linux
capabilities. Read-only mount корня нужен для statfs корневого раздела,
а /proc и /proc/1/net поставляют счётчики хоста и его интерфейсов.
Для контейнеров используйте docker stats; готовность PostgreSQL проверяет Django.

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
compose exec -T prometheus wget -qO- http://127.0.0.1:9090/prometheus/api/v1/targets
compose exec -T prometheus wget -qO- http://web:8000/_metrics/
compose exec -T prometheus wget -qO- http://proxy:9180/metrics
compose stats --no-stream
```

Запишите несколько выборок CPU и RAM через `compose stats` в покое и при
сопоставимом трафике. Проверьте свободное место через `df -h /`, перезапуски
и OOM через `docker inspect`, размер `prometheus_data` и логов через
`docker system df -v`. Сравните с работой без профиля. Фактический расход
зависит от числа серий, нагрузки и сохраняемой истории.

Остановить мониторинг до следующего деплоя можно командой
`compose stop prometheus grafana node-exporter`. Это сохраняет приложение и
оба тома мониторинга. Следующий одобренный деплой запускает профиль снова.
При необходимости отключить сбор
метрик Django задайте `FOODTINDER_METRICS_ENABLED=0` в `.env.prod` и
пересоздайте только `web`. Корреляция запросов сохраняется.

Deploy по одобренному SHA запускает профиль после проверки приложения,
переиспользует здоровые контейнеры с неизменной конфигурацией и проверяет
четыре цели Prometheus. Изменение версии образа или git tree SHA каталога
deploy/monitoring приводит к пересозданию затронутых сервисов. Ошибка
мониторинга отмечает deploy как неуспешный, не останавливая уже проверенное
приложение. Для ручного обновления
выполните `compose pull prometheus grafana node-exporter`, затем
`compose up -d --no-deps --force-recreate prometheus grafana node-exporter`.
Остановка и обновление сохраняют именованные `prometheus_data` и `grafana_data`.
Сделайте резервную копию перед обновлением несовместимой версии Grafana.
