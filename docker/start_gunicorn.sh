#!/bin/sh
set -eu

# The production container owns this directory. Set it before Python imports
# prometheus_client so counters and gauges use its multiprocess mmap storage.
if [ "${FOODTINDER_METRICS_ENABLED:-1}" = 1 ]; then
    export PROMETHEUS_MULTIPROC_DIR=/tmp/foodtinder-prometheus
    install -d -m 700 "$PROMETHEUS_MULTIPROC_DIR"
else
    unset PROMETHEUS_MULTIPROC_DIR
fi
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --access-logfile - --error-logfile - "$@"
