"""Run one shared mypy command without relying on local or production .env files.

This module is intentionally usable from pre-commit on Windows, macOS and Linux.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    # Django-stubs imports settings; explicit dummy settings avoid leaking real credentials.
    env.update(
        {
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "DJANGO_SECRET_KEY": "ft07-typecheck-only-not-a-real-secret",
            "DJANGO_DEBUG": "true",
            "DJANGO_ALLOWED_HOSTS": "localhost,127.0.0.1",
            "POSTGRES_DB": "foodtinder_typecheck",
            "POSTGRES_USER": "foodtinder_typecheck",
            "POSTGRES_PASSWORD": "ft07-typecheck-only-not-a-password",
            "POSTGRES_HOST": "127.0.0.1",
            "POSTGRES_PORT": "5432",
        }
    )
    return subprocess.call([sys.executable, "-m", "mypy"], cwd=root, env=env)


if __name__ == "__main__":
    sys.exit(main())
