FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --create-home app
COPY requirements/ /app/requirements/
RUN python -m pip install --no-cache-dir -r requirements/base.txt

FROM base AS development
RUN python -m pip install --no-cache-dir -r requirements/dev.txt
RUN mkdir -p /app/staticfiles /app/media && chown app:app /app/staticfiles /app/media
COPY --chown=app:app . /app/
USER app
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

FROM base AS production
RUN python -m pip install --no-cache-dir -r requirements/prod.txt
RUN mkdir -p /app/staticfiles /app/media && chown app:app /app/staticfiles /app/media
COPY --chown=app:app . /app/
USER app
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--access-logfile", "-", "--error-logfile", "-"]
