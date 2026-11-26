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
3. Review `docker` logs: one full JSON scan plus the HIGH/CRITICAL gate on
   that exact report. Failed scans or a failed gate must prevent publish and deploy.
4. Compare cold/warm runs for backend Buildx cache scopes
   `foodtinder-backend-dev` and `foodtinder-backend-prod`; frontend builds
   without GHA Docker cache export. CI must pass `uv lock --check`.
5. After approved merge, verify each image has a GHCR tag exactly equal to
   `GITHUB_SHA` and that the `deploy production` job waits for production
   Environment approval even if both images were published already.
6. On the VM, verify `compose pull web proxy`, one ephemeral web invocation,
   healthy Postgres/web/proxy and the `/api/v1/ready/` response.
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

## Follow-up: 26 Nov 2026

Master run #70 (68363b7) measured 170 s for docker, 57 s for backend,
31 s for frontend. The full browser monitoring Compose test consumed 66 s,
including a second frontend image build, image downloads and service startup.
The previous master run #64 measured 109 s for docker; #60 measured 81 s.

Changes in the follow-up:

- Remove the full Caddy monitoring integration test and its script per project
  owner decision. Keep Django authorization tests, Caddy config validation,
  Compose/promtool checks, Gunicorn metrics smoke, and the four-target
  production check. This removes automated end-to-end coverage of monitoring
  browser routes; check them manually after a change to monitoring.
- Frontend packages the existing Vite dist via a separate BuildKit context.
  The default Dockerfile target still builds from source for make demo.
- Validate the development target without loading an unused image. Retain
  dependency-layer caches and scan/publish the exact production image.
- One full JSON Trivy scan, with a fail-closed HIGH/CRITICAL gate on the same
  report and unit tests for the gate. Weekly scans use the same policy.
- Faster initial healthcheck polling, unchanged steady-state intervals for
  production services. Reuse unchanged healthy monitoring containers and
  pinned local images; the git tree SHA in their labels invalidates the
  containers when bind-mounted monitoring configuration changes.

The seven required jobs and approval are unchanged. There is no artifact
transfer between jobs because each image is now only needed in its own job.
Measure the new critical path in GitHub Actions; the target is approximately
60–90 seconds for CI with warm caches, not a guaranteed duration.
