"""Create a local environment with fresh secrets and preserve existing files."""

import argparse
import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--demo", action="store_true")
demo = parser.parse_args().demo
name = ".env.demo" if demo else ".env"
path = root / name

template = (root / ".env.example").read_text(encoding="utf-8")
template = template.replace(
    "DJANGO_SECRET_KEY=\n", f"DJANGO_SECRET_KEY={secrets.token_urlsafe(64)}\n"
)
template = template.replace(
    "POSTGRES_PASSWORD=\n", f"POSTGRES_PASSWORD={secrets.token_urlsafe(32)}\n"
)
if demo:
    template = template.replace("DJANGO_DEBUG=true", "DJANGO_DEBUG=false")
    template = template.replace("POSTGRES_DB=foodtinder\n", "POSTGRES_DB=foodtinder_demo\n")
    template = template.replace(
        "DJANGO_TRUST_PROXY_HEADERS=false", "DJANGO_TRUST_PROXY_HEADERS=true"
    )
    template += (
        "\nSECURE_SSL_REDIRECT=false\nSESSION_COOKIE_SECURE=false\nCSRF_COOKIE_SECURE=false\n"
    )

try:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print(f"Kept existing {name}.")
else:
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as target:
        target.write(template)
    print(f"Created {name} with fresh local secrets.")
