import asyncio
from threading import Lock
from time import monotonic

from asgiref.sync import async_to_sync
from django.db import connections
from psycopg import AsyncConnection, Error, generators, waiting
from psycopg.conninfo import make_conninfo
from psycopg.pq import ExecStatus

PROBE_TIMEOUT_SECONDS = 2
PROBE_CACHE_SECONDS = 1
_probe_lock = Lock()
_last_probe: tuple[float, bool] | None = None


async def _probe(conninfo: str) -> bool:
    async with asyncio.timeout(PROBE_TIMEOUT_SECONDS):
        connection = await AsyncConnection.connect(conninfo)
        try:
            # Use the nonblocking libpq exchange so closing an unresponsive socket
            # cannot trigger a second network round trip to cancel the query.
            connection.pgconn.send_query(b"SELECT 1")
            results = await waiting.wait_async(
                generators.execute(connection.pgconn), connection.pgconn.socket
            )
            return len(results) == 1 and results[0].status == ExecStatus.TUPLES_OK
        finally:
            await connection.close()


def _check_database() -> bool:
    # A fresh connection checks that a worker can connect using the deployed
    # settings even if another worker still has an open connection.
    params = connections["default"].get_connection_params()
    libpq_options = {
        name: value
        for name, value in params.items()
        if name not in {"context", "cursor_factory", "prepare_threshold"}
    }
    try:
        return async_to_sync(_probe)(make_conninfo(**libpq_options))
    except (Error, OSError, TimeoutError):
        return False


def database_ready() -> bool:
    """Share a probe result within each worker, including during database outages."""
    global _last_probe
    with _probe_lock:
        if _last_probe is not None and monotonic() < _last_probe[0]:
            return _last_probe[1]
        ready = _check_database()
        _last_probe = (monotonic() + PROBE_CACHE_SECONDS, ready)
        return ready
