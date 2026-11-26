FROM python:3.12-alpine3.24 AS base

# Keep Alpine security updates: patched OS packages are covered by Trivy.
RUN apk upgrade --no-cache

# uv is used at build time; the Django application itself is not a wheel.
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /usr/local/bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app
RUN addgroup -S app && adduser -S -D -G app app
COPY pyproject.toml uv.lock /app/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --only-group base --no-install-project --python /usr/local/bin/python

FROM base AS development
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --only-group dev --no-install-project --python /usr/local/bin/python
RUN mkdir -p /app/staticfiles /app/media/recipes \
    && chown app:app /app/staticfiles /app/media /app/media/recipes
COPY --chown=app:app . /app/
USER app
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

FROM base AS production
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --only-group prod --no-install-project --python /usr/local/bin/python
# Remove obsolete, unused Python packaging tools from the runtime image.
# uv removes system pip/setuptools/wheel; uv itself is only needed during build.
RUN uv pip uninstall --system pip setuptools wheel && rm -f /usr/local/bin/uv
RUN mkdir -p /app/staticfiles /app/media/recipes \
    && chown app:app /app/staticfiles /app/media /app/media/recipes
COPY --chown=app:app . /app/
USER app
EXPOSE 8000
CMD ["sh", "/app/docker/start_gunicorn.sh"]
