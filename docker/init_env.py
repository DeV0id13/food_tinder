"""Create a local .env with fresh secrets; never overwrite an existing configuration."""

import secrets
from pathlib import Path

root = Path(__file__).resolve().parent.parent
template = (root / ".env.example").read_text(encoding="utf-8")
template = template.replace(
    "DJANGO_SECRET_KEY=\n", f"DJANGO_SECRET_KEY={secrets.token_urlsafe(64)}\n"
)
template = template.replace(
    "POSTGRES_PASSWORD=\n", f"POSTGRES_PASSWORD={secrets.token_urlsafe(32)}\n"
)
with (root / ".env").open("x", encoding="utf-8", newline="\n") as target:
    target.write(template)
print("Created .env with fresh local secrets.")
