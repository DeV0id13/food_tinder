import pytest
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import FieldDoesNotExist, ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.urls import reverse

from apps.accounts.models import UserProfile

PASSWORD = "Foundation_123"


def test_django_system_checks():
    call_command("check")


def test_health(client):
    response = client.get("/api/v1/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_anonymous_session(client):
    assert "csrftoken" not in client.cookies
    response = client.get("/api/v1/auth/session/")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "id": None, "email": None}
    assert "no-store" in response["Cache-Control"]
    assert response.cookies["csrftoken"].value


@pytest.mark.django_db
def test_email_user_and_session(client):
    User = get_user_model()
    user = User.objects.create_user(" Reader@Example.COM ", PASSWORD)
    assert user.email == "reader@example.com"
    assert user.check_password(PASSWORD)
    assert not user.is_staff
    assert not user.is_superuser
    with pytest.raises(FieldDoesNotExist):
        User._meta.get_field("username")
    assert authenticate(email="READER@example.com", password=PASSWORD) == user
    assert authenticate(email=user.email, password="incorrect") is None
    assert client.login(email=user.email, password=PASSWORD)
    assert "csrftoken" not in client.cookies
    response = client.get("/api/v1/auth/session/")
    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "id": user.pk, "email": user.email}
    assert response.cookies["csrftoken"].value
    user.is_active = False
    user.save(update_fields=["is_active"])
    assert authenticate(email=user.email, password=PASSWORD) is None


@pytest.mark.django_db
@pytest.mark.parametrize("email", ["reader@example.com", "READER@EXAMPLE.COM"])
def test_email_unique_even_when_bypassing_save(email):
    User = get_user_model()
    User.objects.create_user("reader@example.com", PASSWORD)
    with transaction.atomic(), pytest.raises(IntegrityError):
        User.objects.bulk_create([User(email=email)])


@pytest.mark.django_db
@pytest.mark.parametrize("email", ["", " ", None, "not-an-email"])
@pytest.mark.parametrize("method", ["create_user", "create_superuser"])
def test_invalid_email_rejected(email, method):
    User = get_user_model()
    with pytest.raises(ValidationError):
        getattr(User.objects, method)(email, PASSWORD)
    assert not User.objects.exists()


@pytest.mark.django_db
def test_database_rejects_empty_email():
    with transaction.atomic(), pytest.raises(IntegrityError):
        get_user_model().objects.bulk_create([get_user_model()(email="")])


@pytest.mark.django_db
def test_superuser():
    user = get_user_model().objects.create_superuser("admin@example.com", PASSWORD)
    assert user.is_staff and user.is_superuser
    assert user.check_password(PASSWORD)


@pytest.mark.django_db
@pytest.mark.parametrize("flag", ["is_staff", "is_superuser"])
def test_invalid_superuser_flags(flag):
    with pytest.raises(ValueError):
        get_user_model().objects.create_superuser("admin@example.com", PASSWORD, **{flag: False})


def test_password_valid():
    validate_password(PASSWORD)


@pytest.mark.parametrize(
    "password",
    [
        "foundation_123",  # no uppercase
        "FOUNDATION_123",  # no lowercase
        "Foundation_abc",  # no digit
        "Foundation1234",  # no underscore
        "Foundation_123я",  # Cyrillic
        "Abcd_123",  # too short
        "Foundation_123!",  # unsupported punctuation
        "Foundation_123 ",  # whitespace
        "Foundation_１２３",  # non-ASCII digits
    ],
)
def test_password_invalid(password):
    with pytest.raises(ValidationError) as error:
        validate_password(password)
    assert "invalid_product_password" in [item.code for item in error.value.error_list]


@pytest.mark.django_db
def test_user_profile():
    user = get_user_model().objects.create_user("reader@example.com", PASSWORD)
    profile = UserProfile.objects.create(user=user)
    assert user.profile == profile
    assert profile.user == user
    with transaction.atomic(), pytest.raises(IntegrityError):
        UserProfile.objects.create(user=user)
    user.delete()
    assert not UserProfile.objects.filter(pk=profile.pk).exists()


@pytest.mark.django_db
def test_admin_can_create_and_edit_email_user(admin_client):
    response = admin_client.post(
        reverse("admin:accounts_user_add"),
        {
            "email": "New@Example.com",
            "usable_password": "true",
            "password1": PASSWORD,
            "password2": PASSWORD,
            "_save": "Save",
        },
    )
    assert response.status_code == 302
    user = get_user_model().objects.get(email="new@example.com")
    assert user.check_password(PASSWORD)
    response = admin_client.get(reverse("admin:accounts_user_change", args=[user.pk]))
    assert response.status_code == 200
    form = response.context["adminform"].form
    assert "username" not in form.fields
    response = admin_client.post(
        reverse("admin:accounts_user_change", args=[user.pk]),
        {
            "email": "Changed@Example.com",
            "first_name": "Reader",
            "last_name": "",
            "is_active": "on",
            "date_joined_0": user.date_joined.strftime("%Y-%m-%d"),
            "date_joined_1": user.date_joined.strftime("%H:%M:%S"),
            "_save": "Save",
        },
    )
    assert response.status_code == 302
    user.refresh_from_db()
    assert user.email == "changed@example.com"
    assert user.first_name == "Reader"
    assert user.check_password(PASSWORD)
    assert admin_client.get(reverse("admin:accounts_userprofile_add")).status_code == 200


@pytest.mark.django_db
def test_admin_rejects_case_insensitive_duplicate(admin_client):
    get_user_model().objects.create_user("reader@example.com", PASSWORD)
    response = admin_client.post(
        reverse("admin:accounts_user_add"),
        {
            "email": "READER@example.com",
            "usable_password": "true",
            "password1": PASSWORD,
            "password2": PASSWORD,
        },
    )
    assert response.status_code == 200
    assert response.context["adminform"].form.errors


@pytest.mark.django_db
def test_admin_login_requires_csrf():
    from django.test import Client

    client = Client(enforce_csrf_checks=True)
    response = client.post(
        reverse("admin:login"), {"username": "admin@example.com", "password": PASSWORD}
    )
    assert response.status_code == 403
