DEMO_COMPOSE = docker compose --project-name foodtinder-demo --env-file .env.demo -f compose.demo.yaml

.PHONY: demo demo-stop demo-logs

demo:
	@test -f .env.demo || docker run --rm --user "$$(id -u):$$(id -g)" \
		-v "$(CURDIR):/workspace" -w /workspace python:3.12-alpine3.24 python docker/init_env.py --demo
	$(DEMO_COMPOSE) build web proxy
	$(DEMO_COMPOSE) up -d --wait postgres
	$(DEMO_COMPOSE) run --rm --no-deps -T web sh -ec 'python manage.py migrate --noinput && python manage.py collectstatic --noinput && python manage.py seed_demo'
	$(DEMO_COMPOSE) up -d --wait web proxy
	@printf '\nFoodTinder demo: http://127.0.0.1:8080/\n'

demo-stop:
	$(DEMO_COMPOSE) down

demo-logs:
	$(DEMO_COMPOSE) logs -f
