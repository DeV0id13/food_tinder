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
- Python and pnpm caches are keyed by dependency manifests.
- Buildx uses remote GitHub Actions caches across ephemeral runners.
- A Dockerfile-specific backend ignore file prevents frontend/docs/tests changes
  from invalidating the backend image layers.
- Each production image is built exactly once per workflow run; the backend
  artifact is scanned before publication. Only `push` to `master` can publish
  SHA-tagged images, and only the gated production job can deploy them.
- On the server, only web/proxy images are pulled, and migrations plus static
  collection run in one temporary container. Persistent volume initialization
  is documented as a one-time operation.

## How to verify

1. On the PR, confirm the **seven** required checks are green. No `deploy`
   job, GHCR publication, or production Environment approval should occur.
2. Review `backend` logs: `pytest --durations=20` must report the slowest tests
   and should run faster than the baseline without reducing test count.
3. Review `docker` logs: the production image is scanned twice (full report and
   blocking HIGH/CRITICAL gate). Failed scans must prevent publish and deploy.
4. Compare a cold build and subsequent warm-cache run; GitHub cache scopes are
   `foodtinder-backend-dev`, `foodtinder-backend-prod`, `foodtinder-frontend`.
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

No actual post-change speedup should be claimed until GitHub Actions completes
on this branch and, after a reviewed merge, on production.
