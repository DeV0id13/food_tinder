import asyncio

from asgiref.sync import async_to_sync
from django.db import connections
from psycopg import AsyncConnection, Error, generators, waiting
from psycopg.conninfo import make_conninfo
from psycopg.pq import ExecStatus

PROBE_TIMEOUT_SECONDS = 2


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


def database_ready() -> bool:
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
