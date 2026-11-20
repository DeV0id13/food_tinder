# CI/CD performance baseline and verification

Baseline from GitHub Actions (20 Nov 2026, `master` at `edf3262`):

| CI run | Seven parallel checks | Gate/queue | Deploy job | Total |
| --- | ---: | ---: | ---: | ---: |
| #52 | 94 s | 14 s | 111 s | 219 s |
| #50 | 95 s | 14 s | 82 s | 191 s |
| #48 | 99 s | 19 s | 79 s | 197 s |

On run #52, backend tests took **48.07 s** (363 passed); the full backend
job took 90 s. The deploy job included 32 s of image rebuilding, 10 s of
image pushing, and 63 s of server work. Manual Environment approval can
increase total wall-clock time and is intentionally retained.

## Changes in this PR

- The pytest-only `MD5PasswordHasher` speeds functional authentication tests.
  Production Django password hashers are untouched.
- Python uses uv 0.13.9, committed `uv.lock` (78 locked packages) and
  GitHub Actions uv dependency caches; pnpm uses its own lockfile cache.
- Buildx uses remote GitHub Actions caches for **backend only**. Frontend
  remote cache export took 29.3 s on a ~5 s build, so it is disabled.
- A Dockerfile-specific backend ignore file prevents frontend/docs changes
  from invalidating the backend image layers; tests and mypy helper remain
  available in the development target.
- Each production image is built exactly once per workflow run; the backend
  artifact is scanned before publication. Only `push` to `master` can publish
  SHA-tagged images, and only the gated production job can deploy them.
- On the server, only web/proxy images are pulled, and migrations plus static
  collection run in one temporary container. Persistent volume initialization
  is documented as a one-time operation.

## How to verify

1. On the PR, confirm the **seven** required checks are green. No `deploy`
   job, GHCR publication, or production Environment approval should occur.
2. Review `backend` logs: `uv run --locked --only-group dev pytest --durations=20`
   must report the slowest tests without reducing test count.
3. Review `docker` logs: the production image is scanned twice (full report and
   blocking HIGH/CRITICAL gate). Failed scans must prevent publish and deploy.
4. Compare cold/warm runs for backend Buildx cache scopes
   `foodtinder-backend-dev` and `foodtinder-backend-prod`; frontend builds
   without GHA Docker cache export. CI must pass `uv lock --check`.
5. After approved merge, verify each image has a GHCR tag exactly equal to
   `GITHUB_SHA` and that the `deploy production` job waits for production
   Environment approval even if both images were published already.
6. On the VM, verify `compose pull web proxy`, one ephemeral web invocation,
   healthy Postgres/web/proxy and the /api/v1/health/ response.
7. Compare the end-to-end duration of several ordinary master push runs with
   #52/#50/#48; exclude the human approval interval when measuring machine speed.

Security constraints retained: pinned Actions, full Gitleaks history scan,
Semgrep, Ruff, mypy, PostgreSQL migrations/tests, frontend tests, Trivy
HIGH/CRITICAL gate, `needs` on all seven checks, SHA verification and a
reviewer-protected `production` Environment.

Baseline PR run before uv migration: 363 passed in 10.27 s vs 48.07 s on
master; backend job 40 s vs ~90 s before. Docker cache reduced the
development target from 45 s to 8 s on warm cache. Re-run all seven checks
after migrating to uv and compare the new measurements; production speed remains
unverified until an approved merge and full deploy.
