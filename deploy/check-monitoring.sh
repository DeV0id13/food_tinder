#!/usr/bin/env bash
set -euo pipefail

tag=${1:?Deployed image SHA is required}
compose() {
  sudo -n env IMAGE_TAG="$tag" docker compose -f compose.prod.yaml --env-file .env.prod --profile monitoring "$@"
}
# Container readiness alone does not guarantee successful scraping.
for attempt in {1..12}; do
  if compose exec -T prometheus wget -qO- http://127.0.0.1:9090/prometheus/api/v1/targets </dev/null |
    python3 -c 'import json, sys; targets = json.load(sys.stdin)["data"]["activeTargets"]; expected = {"prometheus", "django", "caddy", "node"}; sys.exit(0 if {t["labels"]["job"] for t in targets if t["health"] == "up"} == expected else 1)'; then
    echo "Monitoring: all four Prometheus targets UP."
    exit 0
  fi
  sleep 5
done
echo "Monitoring: scrape targets did not become healthy; the application remains running." >&2
exit 1
