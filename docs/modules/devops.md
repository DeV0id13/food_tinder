# FT-07 — Pre-commit, CI, typecheck and security

## Scope and status

This PR configures the product code quality gates, not a deployment. GitHub Actions
run seven required jobs on PRs targeting `master`, pushes to `master` and manual
dispatch. A separate weekly security workflow re-scans the production image.

The originally planned `pyproject.toml` integration was included directly in PR #15
because pre-commit and typecheck cannot run without those dev dependencies and plugin
settings; this deviation was accepted by the repository owner. No runtime dependencies
were upgraded as part of FT-07. `master` must not be merged into or from this PR
without review of the actual pipeline results.

## Exact pinned versions

| Component | Version / provenance |
| --- | --- |
| Python | 3.12 (GitHub Actions and pre-commit) |
| pre-commit | 3.8.0 in `pyproject.toml` |
| Ruff | 0.16.8 in both `pyproject.toml` and hook v0.16.8 |
| mypy | 1.18.2 |
| django-stubs | 6.1.2 (supports Django 5.2 partially; matched to DRF stubs 3.18.2) |
| djangorestframework-stubs | 3.18.2 (DRF 3.18) |
| Gitleaks | v8.21.2 (Go module github.com/zricethezav/gitleaks/v8 + local hook) |
| Semgrep CE | 1.122.0 and setuptools 80.9.0 installed only in the sast job |
| Trivy CLI | v0.76.2, through trivy-action pinned at 0.35.0 |
| Actions | Full 40-char commit SHAs in both workflow files, release annotated inline |
| Node.js | 22 for frontend job |
| PostgreSQL | major 16 for backend; test-only user/password |

Go module packages are checked through the standard Go checksum database.
Trivy uses an exact release version, not `latest`. The release SHAs of GitHub
Actions are fixed in `ci.yml` and `security.yml`. Review these pins before
bumping tools, and keep the Ruff hook aligned with `pyproject.toml`.
Transitive Python dev dependencies are not currently locked by a lockfile;
the direct pins do **not** claim a byte-for-byte reproducible entire environment.

## Windows (PowerShell)

From the repository root, with Python 3.12 on PATH:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install "pip>=25.1"
python -m pip install --group dev
pre-commit validate-config
pre-commit install
pre-commit run --all-files
python .github/scripts/run_mypy.py
```

## Linux / macOS

```sh
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install "pip>=25.1"
python -m pip install --group dev
pre-commit validate-config
pre-commit install
pre-commit run --all-files
python .github/scripts/run_mypy.py
```

Clone does not install hooks automatically: every developer must run
`pre-commit install`. Hooks may fix whitespace, formatting or safe Ruff findings;
review those changes and run `git add` plus `git commit` again. In PyCharm,
choose the same `.venv` as the Python interpreter and enable Git hooks.
`pre-commit run --all-files` is an optional full check; individual commits use
staged checks. Do not use production credentials.

The local mypy hook and CI both call
`python .github/scripts/run_mypy.py`. That cross-platform helper sets only
disposable non-production settings for the isolated process; it never accesses
a live database. `[tool.mypy].files` in `pyproject.toml` defines the shared
scope: `apps/`, `common/`, `config/`, `manage.py`. Migrations are excluded;
the test suite is not part of mandatory mypy coverage. No global error ignore,
import skip or disable-on-failure is enabled. Type failures in product modules
must be fixed by the module owner, not hidden in FT-07.

## CI: jobs and gates

- `lint`: `ruff check .`, `ruff format --check .`, and YAML/JSON/TOML,
  merge conflicts, whitespace/EOF and line endings using pre-commit.
- `typecheck`: cross-platform mypy helper, Django/DRF plugins, whole configured scope.
- `secrets`: Gitleaks v8.21.2 on the full available checkout history, including
  intermediate commits where a secret was subsequently removed. The CLI uses
  `.github/security/gitleaks.toml` and redacts values; local staged hook uses
  the **same** config and Gitleaks version. The complete history must be fetched.
- `sast`: pinned Semgrep CE and in-repository Python/Django/JavaScript rules.
  Scopes: `apps/`, `common/`, `config/`, `manage.py`, `frontend/`.
  Generated migrations, node_modules and dist are excluded. The reviewed rules
  cover code execution, shell commands, interpolated SQL, explicit CSRF bypass,
  `mark_safe` and JS dynamic execution/document.write. Findings **and**
  configuration errors fail the job.
- `backend`: healthy isolated PostgreSQL 16, Django check, missing migration
  detection, apply migrations on clean DB, complete pytest suite.
- `frontend`: Node.js 22, `npm ci` only if lockfile exists (error if new
  dependencies lack lockfile), `npm test`, `npm run build` and existence
  check for `frontend/dist/index.html`.
- `docker`: builds both Docker targets and scans **the just-built production
  image**, packages from OS and Python including transitives. Trivy gets a full
  table report (all severities); its separate HIGH/CRITICAL gate fails the job,
  including unpatched issues. The full and blocking reports are artifacts even
  if the gate fails. Scanner errors also fail, never treated as a clean run.

A pinned rule set can miss novel issues; Semgrep/Trivy are not substitutes
for tests of permissions, CSRF or business logic. Production image scanning
does not cover dev-only Python packages or future npm dependencies.

## Secret and vulnerability exceptions

Current project ships no active Trivy ignore file and no broad Semgrep
suppressions. For each false positive, record the **exact CVE/rule,
package/line, explanation, approving owner and expiry date** in a review.
For Trivy use `.github/security/.trivyignore.yaml` with a documented
`expired_at` per entry; do not use `--ignore-unfixed` or an unbounded
`.trivyignore`. Expired entries cease to be ignored. Suppress a specific
Semgrep rule at an exact location with explanation; never ignore a whole
application. For Gitleaks, an actual exposed credential must first be
revoked/rotated; a reviewed false-positive fingerprint may be allowlisted
without storing its secret value. Do not include raw secrets in logs or PR.

Gitleaks v8 is in maintenance/security-fix mode; replacing it with a different
scanner is a separate design decision.

## Weekly Trivy assessment

`.github/workflows/security.yml` runs on `master` each Monday at
**04:00 UTC** and supports manual `workflow_dispatch`. It builds the
production target with `docker build --pull` and scans with a fresh Trivy
database (`cache: false`) and the same vulnerability policy. Failures can
be found under **GitHub → Actions → security → weekly-trivy**; inspect the
uploaded full report. GitHub registers scheduled and manually dispatched
workflows only after the workflow exists on the **default branch**. Until PR
#15 is merged, the `security` workflow cannot be manually validated there;
do not claim otherwise.

## Negative/control scenarios before acceptance

Use only **disposable test data in a throwaway branch or separate local clone**:
do not commit actual credentials. Show:
1. Pre-commit rejects an intentionally malformed YAML/JSON file and a safely
   identified dummy secret on stage; mypy sees a newly introduced type error.
2. Gitleaks detects an unmistakably synthetic secret added in one commit and
   removed in the next, even though the final working-tree diff is clean.
3. Semgrep reports a Python `eval(...)` and JavaScript `eval(...)` fixture,
   with a nonzero exit status; a normal fixture passes.
4. Trivy HIGH/CRITICAL produces a failed gate and a full artifact, with no
   `ignore-unfixed`. Trigger a scanner error and confirm failure.
5. Record an unsuccessful and a successful **real** CI run; verify that all
   seven jobs execute after updating the PR. Re-check after base-branch updates.

None of the negative checks, audit results, local host tests or CI runs
are claimed complete by this document merely because configuration exists.
Use the actual **Actions** run history for evidence.

## Repository-owner handoff (admin actions)

After a successful run, the repository owner should make the exact contexts
`lint`, `typecheck`, `secrets`, `sast`, `backend`, `frontend`, `docker`
required on `master`, bind them to the GitHub Actions source, require a
PR, up-to-date branch, apply protection to admins and block direct pushes.
Verify a failing/absent required check blocks merge. Enable **GitHub secret
scanning + Push Protection** at repository level, inspect bypass permissions,
and test only with a clearly invalid fixture. Do not weaken existing rulesets.

**Currently verified:** workflow source files are provided in PR #15.
**Not verified by this document:** active repository branch/ruleset protection,
Push Protection settings, a successful seven-job run, historical credential
audit or a verified manual weekly-security run. These must be checked
separately before closing issue #9.

## Troubleshooting

- Hooks not firing: `pre-commit install` must be run per clone, and the
  configured interpreter must have `--group dev` installed.
- Django-stubs settings errors: use the shared mypy helper, not bare
  `python -m mypy` without a disposable environment.
- Missing schema/table in backend CI: inspect PostgreSQL health, `migrate`,
  database user CREATE DATABASE permission and pytest-db creation.
- Gitleaks only seeing final diff: verify `fetch-depth: 0` and
  `gitleaks git . --log-opts="--all"`, not `protect` in CI.
- SAST scan error: test rule syntax and install the exact version in this
  document; check Semgrep's exit code.
- Trivy failing unexpectedly: review full report artifact and update image
  dependencies via their respective owners. Scanner database/network failures
  are not silently skipped.

CI is quality assurance only: no image publishing, CD, server provisioning,
hosting, DNS, TLS or deployment is introduced here.
