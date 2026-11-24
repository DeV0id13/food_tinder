import logging
from datetime import datetime, timedelta
from ipaddress import IPv6Address, ip_address
from math import ceil
from typing import Literal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import Throttled
from rest_framework.request import Request

from .models import AuthRateBucket

AuthOperation = Literal["login", "register"]
logger = logging.getLogger("foodtinder.auth")


def client_ip(request: Request) -> str:
    forwarded = (
        request.META.get("HTTP_X_FOODTINDER_CLIENT_IP")
        if settings.AUTH_RATE_LIMIT_TRUST_PROXY
        else None
    )
    for value in (forwarded, request.META.get("REMOTE_ADDR")):
        if not isinstance(value, str) or "%" in value:
            continue
        try:
            address = ip_address(value)
        except ValueError:
            continue
        if isinstance(address, IPv6Address) and address.ipv4_mapped:
            return str(address.ipv4_mapped)
        return str(address)
    # A missing address gets one shared bucket instead of bypassing the limiter.
    return "unknown"


def _purge_expired(now: datetime) -> None:
    with transaction.atomic():
        keys = list(
            AuthRateBucket.objects.filter(expires_at__lte=now)
            .order_by("expires_at")
            .select_for_update(skip_locked=True)
            .values_list("pk", flat=True)[:128]
        )
        if keys:
            AuthRateBucket.objects.filter(pk__in=keys).delete()


def limit_auth_attempt(request: Request, operation: AuthOperation) -> None:
    limit, seconds = settings.AUTH_RATE_LIMITS[operation]
    key = salted_hmac(
        "accounts.rate-limit", f"{operation}:{client_ip(request)}", algorithm="sha256"
    ).hexdigest()
    now = timezone.now()
    with transaction.atomic():
        bucket, created = AuthRateBucket.objects.select_for_update().get_or_create(
            pk=key, defaults={"expires_at": now + timedelta(seconds=seconds)}
        )
        new_window = created or bucket.expires_at <= now
        if new_window:
            bucket.expires_at = now + timedelta(seconds=seconds)
            bucket.attempts = 0
        first_rejection = bucket.attempts == limit
        if bucket.attempts <= limit:
            bucket.attempts += 1
            bucket.save(update_fields=["attempts", "expires_at"])

    # Keep cleanup cheap and bounded. It runs separately from the write lock above.
    if new_window:
        _purge_expired(now)
    if bucket.attempts > limit:
        if first_rejection:
            logger.warning("auth_rate_limited", extra={"operation": operation})
        retry_after = max(1, ceil((bucket.expires_at - timezone.now()).total_seconds()))
        raise Throttled(wait=retry_after)
