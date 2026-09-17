from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@never_cache
@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def session(request):
    authenticated = request.user.is_authenticated
    return Response(
        {
            "authenticated": authenticated,
            "id": request.user.pk if authenticated else None,
            "email": request.user.email if authenticated else None,
        }
    )
