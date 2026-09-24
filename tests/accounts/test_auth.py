from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import UserProfile

pytestmark = pytest.mark.django_db

BASE = "/api/v1/auth/"
PASSWORD = "Valid_pass123"
EMPTY_PROFILE = {
    "date_of_birth": None,
    "gender": "",
    "height_cm": None,
    "weight_kg": None,
}


def csrf_client():
    client = APIClient(enforce_csrf_checks=True)
    response = client.get(f"{BASE}session/")
    assert response.status_code == 200
    return client


def csrf_header(client):
    return {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}


def create_user(email="reader@example.com"):
    return get_user_model().objects.create_user(email=email, password=PASSWORD)


def test_register_creates_user_and_profile_without_login():
    client = csrf_client()
    response = client.post(
        f"{BASE}register/",
        {"email": " Reader@Example.COM ", "password": PASSWORD},
        format="json",
        **csrf_header(client),
    )

    assert response.status_code == 201
    user = get_user_model().objects.get(email="reader@example.com")
    assert response.json() == {"id": user.pk, "email": user.email}
    assert user.check_password(PASSWORD)
    assert user.password != PASSWORD
    assert UserProfile.objects.filter(user=user).exists()
    assert "no-store" in response["Cache-Control"]
    assert client.get(f"{BASE}session/").json() == {
        "authenticated": False,
        "id": None,
        "email": None,
    }


def test_register_rolls_back_user_when_profile_creation_fails():
    client = csrf_client()
    with patch("apps.accounts.views.UserProfile.objects.create", side_effect=RuntimeError):
        with pytest.raises(RuntimeError):
            client.post(
                f"{BASE}register/",
                {"email": "reader@example.com", "password": PASSWORD},
                format="json",
                **csrf_header(client),
            )
    assert not get_user_model().objects.exists()
    assert not UserProfile.objects.exists()


def test_duplicate_email_with_different_case_is_field_error():
    create_user()
    client = csrf_client()
    response = client.post(
        f"{BASE}register/",
        {"email": "READER@EXAMPLE.COM", "password": PASSWORD},
        format="json",
        **csrf_header(client),
    )
    assert response.status_code == 400
    assert set(response.json()) == {"email"}
    assert get_user_model().objects.count() == 1


def test_case_insensitive_db_constraint_error_is_mapped_to_email():
    # bulk_create bypasses User.save(), leaving mixed case to exercise lower(email).
    get_user_model().objects.bulk_create([get_user_model()(email="Reader@Example.COM")])
    client = csrf_client()
    with patch.object(
        get_user_model().objects,
        "create_user",
        wraps=get_user_model().objects.create_user,
    ) as create:
        response = client.post(
            f"{BASE}register/",
            {"email": "reader@example.com", "password": PASSWORD},
            format="json",
            **csrf_header(client),
        )

    assert create.called  # The database constraint, including a race, reaches the API handler.
    assert response.status_code == 400
    assert set(response.json()) == {"email"}
    assert get_user_model().objects.count() == 1


@pytest.mark.parametrize("password", ["short", "alllowercase_123", "Valid_pass123!"])
def test_register_rejects_invalid_password(password):
    client = csrf_client()
    response = client.post(
        f"{BASE}register/",
        {"email": "reader@example.com", "password": password},
        format="json",
        **csrf_header(client),
    )
    assert response.status_code == 400
    assert "password" in response.json()
    assert not get_user_model().objects.exists()


def test_anonymous_register_requires_csrf():
    client = csrf_client()
    payload = {"email": "reader@example.com", "password": PASSWORD}
    assert client.post(f"{BASE}register/", payload, format="json").status_code == 403
    assert (
        client.post(
            f"{BASE}register/", payload, format="json", HTTP_X_CSRFTOKEN="wrong"
        ).status_code
        == 403
    )
    assert (
        client.post(f"{BASE}register/", payload, format="json", **csrf_header(client)).status_code
        == 201
    )


def test_login_creates_session_and_rotates_csrf_token():
    user = create_user()
    client = csrf_client()
    old_token = client.cookies["csrftoken"].value
    response = client.post(
        f"{BASE}login/",
        {"email": "READER@EXAMPLE.COM", "password": PASSWORD},
        format="json",
        **csrf_header(client),
    )
    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "id": user.pk, "email": user.email}
    assert client.cookies["sessionid"].value
    assert client.cookies["csrftoken"].value != old_token
    assert client.get(f"{BASE}session/").json() == response.json()
    assert (
        client.post(f"{BASE}logout/", {}, format="json", HTTP_X_CSRFTOKEN=old_token).status_code
        == 403
    )
    assert (
        client.post(f"{BASE}logout/", {}, format="json", **csrf_header(client)).status_code == 204
    )


def test_anonymous_login_requires_csrf():
    create_user()
    client = csrf_client()
    payload = {"email": "reader@example.com", "password": PASSWORD}
    assert client.post(f"{BASE}login/", payload, format="json").status_code == 403
    assert (
        client.post(f"{BASE}login/", payload, format="json", **csrf_header(client)).status_code
        == 200
    )


def test_login_uses_same_error_for_unknown_email_and_wrong_password():
    create_user()
    client = csrf_client()
    errors = []
    for email, password in (
        ("absent@example.com", PASSWORD),
        ("not-an-email", PASSWORD),
        ("reader@example.com", "Wrong_pass123"),
    ):
        response = client.post(
            f"{BASE}login/",
            {"email": email, "password": password},
            format="json",
            **csrf_header(client),
        )
        assert response.status_code == 400
        assert set(response.json()) == {"non_field_errors"}
        errors.append(response.json())
    assert errors[0] == errors[1] == errors[2]
    assert client.get(f"{BASE}session/").json()["authenticated"] is False


def test_logout_and_repeated_anonymous_logout_require_csrf():
    user = create_user()
    client = csrf_client()
    client.force_login(user)
    assert client.post(f"{BASE}logout/", {}, format="json").status_code == 403
    assert (
        client.post(f"{BASE}logout/", {}, format="json", **csrf_header(client)).status_code == 204
    )
    assert client.get(f"{BASE}session/").json()["authenticated"] is False
    assert client.post(f"{BASE}logout/", {}, format="json").status_code == 403
    assert (
        client.post(f"{BASE}logout/", {}, format="json", **csrf_header(client)).status_code == 204
    )


def test_logout_rejects_unknown_fields_without_ending_session():
    user = create_user()
    client = csrf_client()
    client.force_login(user)
    response = client.post(
        f"{BASE}logout/", {"user_id": user.pk}, format="json", **csrf_header(client)
    )
    assert response.status_code == 400
    assert "user_id" in response.json()
    assert client.get(f"{BASE}session/").json()["authenticated"] is True


def test_profile_requires_authentication():
    client = csrf_client()
    assert client.get(f"{BASE}profile/").status_code == 403
    assert (
        client.patch(f"{BASE}profile/", {}, format="json", **csrf_header(client)).status_code == 403
    )


def test_authenticated_profile_patch_requires_csrf():
    user = create_user()
    client = csrf_client()
    client.force_login(user)
    assert client.patch(f"{BASE}profile/", {"height_cm": 180}, format="json").status_code == 403
    assert not UserProfile.objects.filter(user=user).exists()


def test_get_profile_returns_only_own_basic_fields_without_cache():
    user = create_user()
    UserProfile.objects.create(
        user=user,
        date_of_birth=date(1990, 1, 2),
        gender=UserProfile.Gender.FEMALE,
        height_cm=170,
        weight_kg=Decimal("65.25"),
        avatar="avatars/private.png",
    )
    client = csrf_client()
    client.force_login(user)
    response = client.get(f"{BASE}profile/")
    assert response.status_code == 200
    assert response.json() == {
        "date_of_birth": "1990-01-02",
        "gender": "female",
        "height_cm": 170,
        "weight_kg": "65.25",
    }
    assert "no-store" in response["Cache-Control"]


def test_legacy_user_get_is_empty_without_creating_profile_then_patch_creates_it():
    user = create_user()
    client = csrf_client()
    client.force_login(user)
    response = client.get(f"{BASE}profile/")
    assert response.status_code == 200
    assert response.json() == EMPTY_PROFILE
    assert not UserProfile.objects.filter(user=user).exists()

    response = client.patch(
        f"{BASE}profile/", {"height_cm": 181}, format="json", **csrf_header(client)
    )
    assert response.status_code == 200
    assert response.json() == {**EMPTY_PROFILE, "height_cm": 181}
    assert UserProfile.objects.get(user=user).height_cm == 181


def test_patch_profile_updates_full_then_partial():
    user = create_user()
    UserProfile.objects.create(user=user)
    client = csrf_client()
    client.force_login(user)
    response = client.patch(
        f"{BASE}profile/",
        {
            "date_of_birth": "1994-05-06",
            "gender": "other",
            "height_cm": 175,
            "weight_kg": "73.40",
        },
        format="json",
        **csrf_header(client),
    )
    assert response.status_code == 200
    assert response.json() == {
        "date_of_birth": "1994-05-06",
        "gender": "other",
        "height_cm": 175,
        "weight_kg": "73.40",
    }
    response = client.patch(f"{BASE}profile/", {"gender": ""}, format="json", **csrf_header(client))
    assert response.status_code == 200
    assert response.json() == {
        "date_of_birth": "1994-05-06",
        "gender": "",
        "height_cm": 175,
        "weight_kg": "73.40",
    }


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        (
            {"date_of_birth": (timezone.localdate() + timedelta(days=1)).isoformat()},
            "date_of_birth",
        ),
        ({"height_cm": 0}, "height_cm"),
        ({"height_cm": -1}, "height_cm"),
        ({"height_cm": 32768}, "height_cm"),
        ({"weight_kg": "0"}, "weight_kg"),
        ({"weight_kg": "-1.00"}, "weight_kg"),
        ({"weight_kg": "1000.00"}, "weight_kg"),
        ({"gender": "invalid"}, "gender"),
        ({"unknown": "value"}, "unknown"),
        ({"user": 99}, "user"),
        ({"user_id": 99}, "user_id"),
        ({"email": "other@example.com"}, "email"),
        ({"avatar": "avatars/other.png"}, "avatar"),
    ],
)
def test_patch_profile_rejects_invalid_or_forbidden_fields_without_creating_profile(payload, field):
    user = create_user()
    client = csrf_client()
    client.force_login(user)
    response = client.patch(f"{BASE}profile/", payload, format="json", **csrf_header(client))
    assert response.status_code == 400
    assert field in response.json()
    assert not UserProfile.objects.filter(user=user).exists()


def test_profile_is_always_scoped_to_current_user():
    alice = create_user("alice@example.com")
    bob = create_user("bob@example.com")
    UserProfile.objects.create(user=alice, height_cm=160)
    UserProfile.objects.create(user=bob, height_cm=180)
    client = csrf_client()
    client.force_login(bob)
    assert client.get(f"{BASE}profile/").json()["height_cm"] == 180
    response = client.patch(
        f"{BASE}profile/",
        {"user_id": alice.pk, "height_cm": 190},
        format="json",
        **csrf_header(client),
    )
    assert response.status_code == 400
    assert UserProfile.objects.get(user=alice).height_cm == 160
    assert UserProfile.objects.get(user=bob).height_cm == 180
    response = client.patch(
        f"{BASE}profile/", {"height_cm": 185}, format="json", **csrf_header(client)
    )
    assert response.status_code == 200
    assert UserProfile.objects.get(user=alice).height_cm == 160
    assert UserProfile.objects.get(user=bob).height_cm == 185
