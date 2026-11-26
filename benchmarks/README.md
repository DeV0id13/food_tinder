# Локальный нагрузочный стенд

Используйте свежую демонстрационную базу на выделенном тестовом хосте.
Скрипт разрешает запросы только к `http://127.0.0.1:8080`, а подготовка
данных проверяет имя, адрес базы и флаг demo в контейнере. CSRF и лимиты
регистрации и входа остаются включёнными.

Понадобятся Docker Compose, make и k6 v2.3.0. Запустите из корня репозитория:

```sh
make demo
(
  set -eu
  umask 077
  run=$(mktemp -d)
  run_id=$(openssl rand -hex 8)
  compose() { docker compose --project-name foodtinder-demo --env-file .env.demo -f compose.demo.yaml "$@"; }
  cleanup() {
    compose exec -T web python - cleanup "$run_id" < benchmarks/fixtures.py
    rm -f "$run/fixture.json"
  }
  trap cleanup EXIT
  export FT_ENABLE_LOCAL_BENCHMARK=1 FT_FIXTURE="$run/fixture.json"
  compose exec -T web python - seed "$run_id" 12 < benchmarks/fixtures.py > "$FT_FIXTURE"
  FT_PHASE=smoke FT_VUS=12 k6 run benchmarks/foodtinder.js
  FT_PHASE=load FT_NONCE=warmup FT_RATE=1 FT_DURATION=30s FT_VUS=12 k6 run benchmarks/foodtinder.js
  FT_PHASE=load FT_NONCE=measured FT_RATE=2 FT_DURATION=120s FT_VUS=12 k6 run benchmarks/foodtinder.js
)
```

`FT_RATE` задаёт старты сценариев за секунду, а `FT_VUS` ограничивает число VU
и не может превышать число подготовленных сессий (максимум 192). Дождитесь
завершения каждого прогона (до 6 секунд drain после окна нагрузки).
k6 останавливает прогон выше 5% неожиданных HTTP-ответов после первых 10 секунд.
Увеличивайте интенсивность по одному шагу, следя за CPU, RAM и readiness стенда.
Файл `fixture.json` содержит действующие cookies. Не добавляйте его в Git.
Cleanup удаляет только синтетических пользователей этого прогона и их сессии.
