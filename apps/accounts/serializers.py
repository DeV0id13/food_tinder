from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import serializers

from .models import UserProfile


class StrictFieldsSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError(
                    {field: ["Unknown field."] for field in sorted(unknown)}
                )
        return super().to_internal_value(data)


class RegisterSerializer(StrictFieldsSerializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_email(self, value):
        return get_user_model().objects.normalize_email(value)

    def validate(self, attrs):
        user = get_user_model()(email=attrs["email"])
        try:
            validate_password(attrs["password"], user=user)
        except ValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from exc
        return attrs


class LoginSerializer(StrictFieldsSerializer):
    email = serializers.CharField(allow_blank=True)
    password = serializers.CharField(write_only=True, trim_whitespace=False, allow_blank=True)

    def validate_email(self, value):
        return get_user_model().objects.normalize_email(value)


class LogoutSerializer(StrictFieldsSerializer):
    pass


class ProfileSerializer(StrictFieldsSerializer, serializers.ModelSerializer):
    date_of_birth = serializers.DateField(allow_null=True, required=False)
    gender = serializers.ChoiceField(
        choices=UserProfile.Gender.choices, allow_blank=True, required=False
    )
    height_cm = serializers.IntegerField(
        allow_null=True, min_value=1, max_value=32767, required=False
    )
    weight_kg = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal("0.01"),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = UserProfile
        fields = ("date_of_birth", "gender", "height_cm", "weight_kg")

    def validate_date_of_birth(self, value):
        if value is not None and value > timezone.localdate():
            raise serializers.ValidationError("Date of birth cannot be in the future.")
        return value
