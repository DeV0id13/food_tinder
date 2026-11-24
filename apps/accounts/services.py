from django.db import IntegrityError, transaction
from rest_framework import serializers

from .models import User, UserProfile


def register_user(*, email: str, password: str, first_name: str) -> User:
    try:
        with transaction.atomic():
            user = User.objects.create_user(email=email, password=password, first_name=first_name)
            UserProfile.objects.create(user=user)
    except IntegrityError as exc:
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError(
                {"email": ["This email is already registered."]}
            ) from exc
        raise
    return user


def change_user_email(user_id: int, new_email: str, current_password: str) -> User:
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user_id)
        if not user.check_password(current_password):
            raise serializers.ValidationError({"current_password": ["Incorrect current password."]})
        if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
            raise serializers.ValidationError({"email": ["This email is already registered."]})
        user.email = new_email
        try:
            # Savepoint lets us map a concurrent unique-email conflict to a 400.
            with transaction.atomic():
                user.save(update_fields=["email"])
        except IntegrityError as exc:
            raise serializers.ValidationError(
                {"email": ["This email is already registered."]}
            ) from exc
    return user
