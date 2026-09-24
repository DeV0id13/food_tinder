from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth import login as django_login
from django.contrib.auth import logout as django_logout
from django.db import IntegrityError, transaction
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import UserProfile
from .serializers import LoginSerializer, LogoutSerializer, ProfileSerializer, RegisterSerializer


def _require_csrf(request):
    # SessionAuthentication checks authenticated requests; anonymous requests need this too.
    SessionAuthentication().enforce_csrf(request)


def _session_data(user):
    authenticated = user.is_authenticated
    return {
        "authenticated": authenticated,
        "id": user.pk if authenticated else None,
        "email": user.email if authenticated else None,
    }


@never_cache
@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def session(request):
    return Response(_session_data(request.user))


@never_cache
@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    _require_csrf(request)
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = serializer.validated_data["email"]
    try:
        with transaction.atomic():
            user = get_user_model().objects.create_user(
                email=email, password=serializer.validated_data["password"]
            )
            UserProfile.objects.create(user=user)
    except IntegrityError as exc:
        if get_user_model().objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError(
                {"email": ["This email is already registered."]}
            ) from exc
        raise
    return Response({"id": user.pk, "email": user.email}, status=status.HTTP_201_CREATED)


@never_cache
@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    _require_csrf(request)
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = authenticate(
        request=request,
        email=serializer.validated_data["email"],
        password=serializer.validated_data["password"],
    )
    if user is None:
        raise serializers.ValidationError({"non_field_errors": ["Invalid credentials."]})
    django_login(request, user)
    return Response(_session_data(user))


@never_cache
@api_view(["POST"])
@permission_classes([AllowAny])
def logout(request):
    _require_csrf(request)
    serializer = LogoutSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    django_logout(request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@never_cache
@api_view(["GET", "PATCH"])
def profile(request):
    current_profile = UserProfile.objects.filter(user=request.user).first()
    if request.method == "GET":
        return Response(ProfileSerializer(current_profile or UserProfile()).data)

    serializer = ProfileSerializer(current_profile, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        current_profile, _ = UserProfile.objects.get_or_create(user=request.user)
        for field, value in serializer.validated_data.items():
            setattr(current_profile, field, value)
        current_profile.save()
    return Response(ProfileSerializer(current_profile).data)
