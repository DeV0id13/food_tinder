# Semgrep CE rules for FoodTinder

These rules are authored and reviewed **inside this repository**, not loaded from
the mutable Semgrep Registry. The exact content is pinned by the Git commit in PR #15.
No `auto`, external registry or Semgrep Cloud account is required.

- `python-dangerous.yaml`: Python dynamic code, shell execution and interpolated SQL.
- `django-web.yaml`: unsafe HTML handling and explicit CSRF bypass.
- `javascript.yaml`: JavaScript dynamic code, Node shell execution and document.write.

Only the first-party `apps/`, `common/`, `config/`, `manage.py` and
`frontend/` paths are scanned. Generated files, distribution artifacts and vendor
dependencies are excluded. The rules are heuristic: they do not replace tests of
CSRF, permissions or stored XSS. The frontend uses templated `innerHTML` for
trusted HTML templates; blanket banning it would produce false positives.
No rules are silently suppressed by whole-module allowlists.

To update rules, review an explicit diff and repeat positive/negative fixtures with
`semgrep scan --config .github/security/semgrep --error --metrics=off ...`.
