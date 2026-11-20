# FoodTinder: Yandex Cloud deployment

The production deploy job is part of the same GitHub Actions CI graph.
On a push to `master` (including a PR merge), all seven CI jobs run.
After they pass, the deploy job **waits for the required reviewer approval**
from the `production` GitHub Environment. Pull request runs never deploy.
Configure and **save** Required reviewers before merging this change,
otherwise the deploy job may start without approval.

## One-time prerequisites

- Ubuntu VM `foodtinder-prod`, user `foodtinder-mac`, Docker Compose.
- Security group: inbound SSH (22) from a restricted source, web 80/443 from
  the Internet; **never** expose PostgreSQL 5432 or Django 8000.
- A permanent public IP and, before real use, a domain with DNS A record.
- Restrict the GitHub `production` environment to the protected `master`
  branch. Consider required reviewers.
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

## Deploy

1. Merge an approved PR to `master`. Seven CI checks run automatically.
2. After all seven succeed, the `deploy production` job waits for the
   `production` Environment reviewer. Click **Review deployments** and approve.
   No second CI run is required.
3. The job builds and pushes images with immutable SHA tags, validates
   Compose, pulls images, applies migrations and collects Django static files.
4. For the temporary `SITE_ADDRESS=:80` configuration, the workflow also
   checks the Caddy reverse proxy via localhost. For a real HTTPS domain,
   verify public DNS, TLS and the browser separately.
5. The deploy job is **not** triggered for pull requests or manual dispatch.
   Treat the `production` Environment reviewer requirement as a critical
   protection; it must be saved before merges.
6. To diagnose `IMAGE_TAG is missing`, ensure Compose gets the tag through
   `sudo env IMAGE_TAG=...` rather than relying on exported shell variables.

Persistent named Docker volumes: `postgres_data`, `recipe_photos`,
`staticfiles`, `caddy_data`, `caddy_config`. Never run `down -v` in
production. Database migrations are **not** rolled back automatically.

## Catalog images and backups

The backend image includes the recipe import command and the tracked manifest.
Prepare photo inputs separately in the ignored `catalog-import` directory.
A fresh database will not automatically contain the 62 recipe records or 58
photographs verified locally in FT-06. Import approved data and upload source
photos separately using `docs/modules/catalog.md`. Do not assume that the
manifest contains the image bytes.

Back up PostgreSQL with `pg_dump` and the `recipe_photos` Docker volume;
store encrypted copies off-VM and test restoration. Back up before migrations.
The initial workflow does not automatically implement backup or rollback.

## Budget and operational cautions

The 2 GiB VM has limited memory; the images are built on GitHub-hosted runners.
Monitor RAM, disk, Docker image buildup, Yandex Cloud spending and logs.
The first run may require making GHCR packages public or configuring registry
authentication on the server. Do not run production with demo/default secrets.
