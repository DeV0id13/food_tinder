# FoodTinder: Yandex Cloud deployment

The production deploy job is part of the same GitHub Actions CI graph.
On a push to `master` (including a PR merge), all seven CI jobs run in parallel.
The `frontend` job builds/tests the client and publishes its immutable SHA-tagged
image; the `docker` job builds the backend once, scans that exact production
image with Trivy, and publishes it with the same commit SHA **only after both
Trivy scans pass**. Pull request and manual CI runs build and scan but never
publish images or deploy. After **all seven checks** pass, the deploy job
**waits for the required reviewer approval** from the `production` GitHub
Environment. The deploy job never rebuilds an image. Configure required reviewers when setting
up the GitHub Environment.

## One-time prerequisites

- Ubuntu VM `foodtinder-prod`, user `foodtinder-mac`, Docker Compose.
- Security group: inbound SSH (22) from a restricted source, web 80/443 from
  the Internet; **never** expose PostgreSQL 5432 or Django 8000.
- A permanent public IP and, before real use, a domain with DNS A record.
- Restrict the GitHub `production` environment to the protected `master`
  branch. Consider required reviewers.
- Python production dependencies come from `uv.lock` (installed with uv
  during Docker build); no package manager is required on the Yandex VM.
- GitHub repository Actions must have permission to publish GHCR packages.
  Both `ghcr.io/dev0id13/food_tinder-backend` and
  `ghcr.io/dev0id13/food_tinder-frontend` must be publicly pullable, or the VM
  must separately authenticate to GHCR with a read-only package token.
- Repository/environment secrets:
  - `DEPLOY_HOST`: VM public IPv4 / DNS name.
  - `DEPLOY_SSH_KEY`: a dedicated private deployment key authorized for
    `foodtinder-mac` (not a personal SSH key).
  - `DEPLOY_KNOWN_HOSTS`: verified SSH host-key entry for the VM, obtained by
    independent comparison against the server's host-key fingerprint.
- `/opt/foodtinder` cloned from the repository with its `master` branch.
  There must be no local edits to tracked files; deployment resets tracked
  files to the exact commit from GitHub.

## Secrets on the server

Create `/opt/foodtinder/.env.prod` with mode 600 and its owner set to
`foodtinder-mac`. **Never commit this file.** Example placeholders:

```dotenv
DJANGO_SECRET_KEY=REPLACE_WITH_LONG_RANDOM_SECRET
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=YOUR_DOMAIN
CSRF_TRUSTED_ORIGINS=https://YOUR_DOMAIN
POSTGRES_DB=foodtinder
POSTGRES_USER=foodtinder
POSTGRES_PASSWORD=REPLACE_WITH_LONG_RANDOM_PASSWORD
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_SSLMODE=prefer
DJANGO_TRUST_PROXY_HEADERS=true
SITE_ADDRESS=YOUR_DOMAIN
```

The proxy automatically provisions TLS certificates when a real DNS name
resolves to the VM and ports 80/443 are reachable. Use HTTPS before real user
accounts. For **temporary local/public-IP troubleshooting only**, use
`SITE_ADDRESS=:80`, `DJANGO_ALLOWED_HOSTS=130.193.45.53`,
`CSRF_TRUSTED_ORIGINS=http://130.193.45.53`,
`SECURE_SSL_REDIRECT=false`, `SESSION_COOKIE_SECURE=false` and
`CSRF_COOKIE_SECURE=false`. Do not use that HTTP setup for real accounts.

## One-time volume ownership

Production uses the unprivileged `app` user. The `staticfiles` and
`recipe_photos` volumes must be writable by `app`. Existing servers that ran
the earlier pipeline already have these permissions. On a **new deployment**,
start PostgreSQL and initialize permissions once using the published master
image (do not run a recursive chown on every release):

```sh
cd /opt/foodtinder
sudo env IMAGE_TAG=<published-master-sha> docker compose -f compose.prod.yaml --env-file .env.prod up -d --wait postgres
sudo env IMAGE_TAG=<published-master-sha> docker compose -f compose.prod.yaml --env-file .env.prod run --rm -T --user root web sh -c 'chown -R app:app /app/staticfiles /app/media/recipes'
```

The deploy job checks write access before migrations/collectstatic and fails
with a clear error if ownership has not been initialized. No production data
or volumes are deleted by the workflow.

## Deploy

1. Merge an approved PR to `master`. Seven CI checks run automatically,
   while the images are built in the `docker` and `frontend` jobs.
2. The exact production backend image is scanned by Trivy before its SHA tag
   can be pushed to GHCR. PRs never publish images.
3. After **all seven** checks succeed, the `deploy production` job waits for
   the `production` Environment reviewer. Click **Review deployments** and approve.
   No second CI run is required.
4. The deploy job checks `origin/master` against the approved commit SHA,
   pulls **only web and proxy** images, runs migrations and collectstatic in one
   temporary container, and updates the web/proxy services without rebuilding.
5. The workflow verifies that `postgres`, `web` and `proxy` are running and
   retries Django readiness with a configured Host. The internal check
   emulates HTTPS when TLS is terminated outside Django. For the current
   `SITE_ADDRESS=:80` configuration, it also checks readiness through Caddy over
   loopback using the configured HTTP Host and loads the frontend.
6. The deploy job is **not** triggered for pull requests or manual dispatch.
   Keep required Environment reviewers and master branch protection enabled.
7. To diagnose `IMAGE_TAG is missing`, ensure Compose gets the tag through
   `sudo env IMAGE_TAG=...` rather than relying on exported shell variables.

Routine application deployments deliberately do not `docker compose pull`
PostgreSQL. Update PostgreSQL independently after a verified backup and
maintenance planning. The scheduled `security.yml` Trivy re-scan stays enabled.

Persistent named Docker volumes: `postgres_data`, `recipe_photos`,
`staticfiles`, `caddy_data`, `caddy_config`. Never run `down -v` in
production. Database migrations are **not** rolled back automatically.

## Health, readiness and logging

| Probe | Success | Failure |
| --- | --- | --- |
| `GET /api/v1/health/` | 200 and `{"status":"ok"}` from the HTTP process | HTTP process or proxy unavailable |
| `GET /api/v1/ready/` | 200 and `{"status":"ok"}` after authenticating to PostgreSQL and running `SELECT 1` | 503 and `{"status":"unavailable"}` on failure or timeout |

Both probes are public. Readiness bypasses session loading, uses a fresh short
connection with a two-second deadline and sends `Cache-Control: no-store`.
Its HTTP body contains only the status. The deploy job makes a bounded number
of attempts while the services start.

Django writes JSON lines to stderr in production and readable text in dev.
`DJANGO_LOG_LEVEL` defaults to `INFO` and accepts `DEBUG`, `INFO`, `WARNING`,
`ERROR` and `CRITICAL`. The format includes a UTC timestamp, event, severity,
HTTP status or resolved view when available and safe exception context. Auth
events record successful registration/login and the first limit rejection
in each window. Gunicorn access entries include HTTP status and duration.

The [auth limits and defaults](modules/accounts.md#лимиты-авторизации) require
no new `.env.prod` variables. Production Compose trusts the dedicated client
IP header because only Caddy exposes the app to the network. Caddy overwrites
that header with its immediate peer address. Keep Gunicorn's port private.
The migration creates only the independent counter table and its expiry
index. [API documentation](api.md) is disabled in production by default.

For HTTPS use exact `DJANGO_ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`
and leave secure cookies and redirect enabled. Enable
`DJANGO_TRUST_PROXY_HEADERS=true` behind the existing trusted Caddy proxy.
HSTS defaults to zero, configured through `DJANGO_SECURE_HSTS_SECONDS`,
`DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` and `DJANGO_SECURE_HSTS_PRELOAD`.
Use `POSTGRES_SSLMODE=verify-full` when PostgreSQL is configured with a
trusted TLS certificate. Email settings use `EMAIL_BACKEND`, `EMAIL_HOST`,
`EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`,
`EMAIL_USE_SSL`, `EMAIL_TIMEOUT` and `DEFAULT_FROM_EMAIL`; select at most one
of TLS or SSL. Password reset is currently unavailable.

## Catalog images and backups

The repository contains the import command and a tracked metadata manifest.
Catalog records live in PostgreSQL; uploaded recipe photos live in the
`recipe_photos` volume. New installations start with an empty catalog. See
[the catalog import guide](modules/catalog.md#импорт-каталога) for preparation
and validation of import inputs.

Back up PostgreSQL with `pg_dump` and the `recipe_photos` Docker volume;
store encrypted copies off-VM and test restoration. Back up before migrations.
The initial workflow does not automatically implement backup or rollback.

## Budget and operational cautions

The 2 GiB VM has limited memory; the images are built on GitHub-hosted runners.
Monitor RAM, disk, Docker image buildup, Yandex Cloud spending and logs.
The first run may require making GHCR packages public or configuring registry
authentication on the server. Do not run production with demo/default secrets.
