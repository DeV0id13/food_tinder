from django.contrib import admin
from django.core.exceptions import ValidationError
from django.forms.models import BaseInlineFormSet

from .models import Ingredient, Recipe, RecipeIngredient


class RecipeIngredientInlineFormSet(BaseInlineFormSet):
    def clean(self):
        super().clean()
        if not self.instance.is_active or any(self.errors):
            return
        if not any(
            form.cleaned_data and not form.cleaned_data.get("DELETE", False) for form in self.forms
        ):
            raise ValidationError("An active recipe needs at least one ingredient line.")


class RecipeIngredientInline(admin.TabularInline):
    model = RecipeIngredient
    formset = RecipeIngredientInlineFormSet
    extra = 1


@admin.register(Ingredient)
class IngredientAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "unit")
    search_fields = ("name", "slug")


@admin.register(Recipe)
class RecipeAdmin(admin.ModelAdmin):
    list_display = ("title", "slug", "is_active", "cooking_time_minutes", "difficulty")
    list_filter = ("is_active", "difficulty")
    search_fields = ("title", "slug")
    inlines = (RecipeIngredientInline,)
