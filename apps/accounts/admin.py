from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .forms import EmailUserChangeForm, EmailUserCreationForm
from .models import User, UserProfile


@admin.register(User)
class EmailUserAdmin(UserAdmin):
    add_form = EmailUserCreationForm
    form = EmailUserChangeForm
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "is_staff", "is_active")
    search_fields = ("email", "first_name", "last_name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        (
            "Permissions",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "usable_password", "password1", "password2"),
            },
        ),
    )


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "date_of_birth", "gender")
    search_fields = ("user__email",)
    autocomplete_fields = ("user",)
