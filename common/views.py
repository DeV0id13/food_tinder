from django.views.decorators.cache import never_cache
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from .readiness import database_ready


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request: Request) -> Response:
    """Process liveness only; database readiness is checked separately."""
    return Response({"status": "ok"})


@never_cache
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def ready(request: Request) -> Response:
    if database_ready():
        return Response({"status": "ok"})
    return Response({"status": "unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
