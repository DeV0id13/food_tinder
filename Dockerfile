FROM python:3.12-alpine3.24 AS base

# Alpine security updates: includes patched krb5-libs without weakening the Trivy gate.
RUN apk upgrade --no-cache

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN addgroup -S app && adduser -S -D -G app app
COPY pyproject.toml /app/pyproject.toml
RUN python -m pip install --no-cache-dir "pip>=25.1" "setuptools==80.9.0" \
    && python -m pip install --no-cache-dir --group base

FROM base AS development
RUN python -m pip install --no-cache-dir --group dev
RUN mkdir -p /app/staticfiles /app/media/recipes \
    && chown app:app /app/staticfiles /app/media /app/media/recipes
COPY --chown=app:app . /app/
USER app
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

FROM base AS production
# Build-only packaging tools are not needed to serve Django requests.
# Remove their vendored vulnerable fixtures from the final runtime image.
RUN python -m pip install --no-cache-dir --group prod \
    && python -m pip uninstall -y setuptools wheel pip
RUN mkdir -p /app/staticfiles /app/media/recipes \
    && chown app:app /app/staticfiles /app/media /app/media/recipes
COPY --chown=app:app . /app/
USER app
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--access-logfile", "-", "--error-logfile", "-"]
