#!/usr/bin/env bash
# Isolated CI stack, never uses a real production environment or database.
set -euo pipefail
test ! -e .env.prod
umask 077
export IMAGE_TAG=ci-monitoring
compose() {
  docker compose --project-name ft-monitoring-ci -f compose.prod.yaml --env-file .env.prod --profile monitoring "$@"
}
cleanup() {
  compose down -v --remove-orphans || true
  rm -f .env.prod
}
trap cleanup EXIT
cat > .env.prod <<'EOF'
DJANGO_SECRET_KEY=ci-monitoring-placeholder
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
CSRF_TRUSTED_ORIGINS=http://127.0.0.1
DJANGO_TRUST_PROXY_HEADERS=true
SECURE_SSL_REDIRECT=false
SESSION_COOKIE_SECURE=false
CSRF_COOKIE_SECURE=false
POSTGRES_DB=foodtinder_ci
POSTGRES_USER=foodtinder_ci
POSTGRES_PASSWORD=ci-monitoring-placeholder
POSTGRES_HOST=postgres
SITE_ADDRESS=:80
EOF
docker tag foodtinder-backend:ci-prod ghcr.io/dev0id13/food_tinder-backend:"$IMAGE_TAG"
docker build -f deploy/Dockerfile.frontend -t ghcr.io/dev0id13/food_tinder-frontend:"$IMAGE_TAG" .
compose up -d --wait postgres
compose run --rm --no-deps -T web python manage.py migrate --noinput
compose up -d --wait --wait-timeout 120 web proxy prometheus grafana node-exporter

origin=http://127.0.0.1
curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 2 "$origin/api/v1/ready/" >/dev/null
status() {
  curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' "$@"
}
for path in /grafana/ /prometheus/ /grafana/api/user /prometheus/api/v1/targets; do
  test "$(status -H 'X-FoodTinder-Monitoring-User: admin' "$origin$path")" = 302
done
for path in /metrics /_metrics/ /_monitoring_auth/grafana/; do
  test "$(status "$origin$path")" = 404
done

session() {
  local role=$1
  compose exec -T web python manage.py shell --verbosity 0 -c "
from django.contrib.auth import get_user_model
from django.test import Client
user = get_user_model().objects.create_user(email='monitoring-$role@example.test', is_staff='$role' == 'staff')
client = Client()
client.force_login(user)
print(client.cookies['sessionid'].value)
" </dev/null
}
ordinary=$(session ordinary)
staff=$(session staff)
for path in /grafana/ /prometheus/ /grafana/api/user /prometheus/api/v1/targets; do
  test "$(status -b "sessionid=$ordinary" -H 'X-FoodTinder-Monitoring-User: admin' "$origin$path")" = 403
done

curl --fail --silent --show-error --max-time 20 -b "sessionid=$staff" \
  -H 'X-FoodTinder-Monitoring-User: admin' "$origin/grafana/api/user" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["login"].startswith("foodtinder-staff-")'
curl --fail --silent --show-error --max-time 20 -b "sessionid=$staff" \
  "$origin/grafana/api/dashboards/uid/foodtinder" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["dashboard"]["uid"] == "foodtinder"'
curl --fail --silent --show-error --location --max-redirs 5 --max-time 20 -b "sessionid=$staff" \
  "$origin/grafana/" >/dev/null
curl --fail --silent --show-error --location --max-redirs 5 --max-time 20 -b "sessionid=$staff" \
  "$origin/prometheus/" >/dev/null
curl --fail --silent --show-error --max-time 20 -b "sessionid=$staff" \
  "$origin/prometheus/api/v1/targets" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["status"] == "success"'
compose stop prometheus grafana node-exporter
curl --fail --silent --show-error "$origin/api/v1/ready/" >/dev/null
echo "Browser monitoring authorization, dashboards and application independence verified."
