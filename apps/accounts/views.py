from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth import login as django_login
from django.contrib.auth import logout as django_logout
from django.contrib.auth.models import AnonymousUser
from django.db import transaction
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from .authentication import authenticated_user
from .models import User, UserProfile
from .serializers import (
    AccountNamesSerializer,
    ChangeEmailSerializer,
    LoginSerializer,
    LogoutSerializer,
    ProfileSerializer,
    RegisterSerializer,
)
from .services import change_user_email, register_user


def _require_csrf(request: Request) -> None:
    # SessionAuthentication checks authenticated requests; anonymous requests need this too.
    SessionAuthentication().enforce_csrf(request)


def _session_data(user: User | AnonymousUser) -> dict[str, bool | int | str | None]:
    if isinstance(user, AnonymousUser):
        return {"authenticated": False, "id": None, "email": None}
    return {"authenticated": True, "id": user.pk, "email": user.email}


@never_cache
@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def session(request: Request) -> Response:
    return Response(_session_data(request.user))


@never_cache
@api_view(["POST"])
@permission_classes([AllowAny])
def register(request: Request) -> Response:
    _require_csrf(request)
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = register_user(**serializer.validated_data)
    return Response(
        {"id": user.pk, "email": user.email, "first_name": user.first_name},
        status=status.HTTP_201_CREATED,
    )


@never_cache
@api_view(["POST"])
@permission_classes([AllowAny])
def login(request: Request) -> Response:
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
def logout(request: Request) -> Response:
    _require_csrf(request)
    serializer = LogoutSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    django_logout(request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@never_cache
@api_view(["GET", "PATCH"])
def profile(request: Request) -> Response:
    user = authenticated_user(request)
    current_profile = UserProfile.objects.filter(user=user).first()
    if request.method == "GET":
        return Response(ProfileSerializer(current_profile or UserProfile()).data)

    serializer = ProfileSerializer(current_profile, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        current_profile, _ = UserProfile.objects.get_or_create(user=user)
        for field, value in serializer.validated_data.items():
            setattr(current_profile, field, value)
        current_profile.save()
    return Response(ProfileSerializer(current_profile).data)


def _account_data(user: User) -> dict[str, str]:
    return {"first_name": user.first_name, "last_name": user.last_name, "email": user.email}


@never_cache
@api_view(["GET", "PATCH"])
def account(request: Request) -> Response:
    if request.method == "GET":
        return Response(_account_data(authenticated_user(request)))

    serializer = AccountNamesSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        user = get_user_model().objects.select_for_update().get(pk=authenticated_user(request).pk)
        for field, value in serializer.validated_data.items():
            setattr(user, field, value)
        if serializer.validated_data:
            user.save(update_fields=list(serializer.validated_data))
    return Response(_account_data(user))


@never_cache
@api_view(["POST"])
def change_email(request: Request) -> Response:
    serializer = ChangeEmailSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    current_user = authenticated_user(request)
    user = change_user_email(
        current_user.pk,
        serializer.validated_data["email"],
        serializer.validated_data["current_password"],
    )
    current_user.email = user.email
    return Response(_account_data(user))
