import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from traceback import extract_tb

AUTH_EVENTS = {"registration_succeeded", "login_succeeded", "auth_rate_limited"}


def _event_fields(record: logging.LogRecord) -> dict[str, object]:
    # Never format record.args, raw URLs, request objects or exception messages.
    event = "django_event"
    if (
        record.name == "foodtinder.auth"
        and isinstance(record.msg, str)
        and record.msg in AUTH_EVENTS
    ):
        event = record.msg
    elif record.name == "django.request":
        event = "http_response"
    elif record.name.startswith("django.security."):
        event = record.name.rsplit(".", 1)[-1]
    fields: dict[str, object] = {
        "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
        "level": record.levelname,
        "logger": record.name,
        "event": event,
    }
    status = getattr(record, "status_code", None)
    if type(status) is int:
        fields["status"] = status
    operation = getattr(record, "operation", None)
    if operation in ("login", "register"):
        fields["operation"] = operation
    match = getattr(getattr(record, "request", None), "resolver_match", None)
    if match and match.view_name:
        fields["view"] = match.view_name
    if record.exc_info and record.exc_info[0]:
        fields["exception"] = record.exc_info[0].__name__
        fields["stack"] = [
            f"{Path(frame.filename).name}:{frame.lineno}:{frame.name}"
            for frame in extract_tb(record.exc_info[2])[-10:]
        ]
    return fields


class ApplicationFormatter(logging.Formatter):
    def __init__(self, json_output: bool = False) -> None:
        super().__init__()
        self.json_output = json_output

    def format(self, record: logging.LogRecord) -> str:
        if not self.json_output and record.name == "django.server":
            # Retain the dev server's access line without reflecting the raw request target.
            return f"{record.levelname} django.server HTTP {getattr(record, 'status_code', '')}"
        fields = _event_fields(record)
        if self.json_output:
            return json.dumps(fields, ensure_ascii=False)
        details = " ".join(
            f"{key}={value}"
            for key, value in fields.items()
            if key not in {"timestamp", "level", "logger", "event"}
        )
        prefix = " ".join(str(fields[key]) for key in ("timestamp", "level", "logger", "event"))
        return f"{prefix} {details}".rstrip()
