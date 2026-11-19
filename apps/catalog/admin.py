from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import router
from django.forms.models import BaseInlineFormSet

from .models import Ingredient, Recipe, RecipeIngredient, delete_unused_recipe_photo_on_commit


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

    def save_model(self, request, obj, form, change):
        if not change:
            return super().save_model(request, obj, form, change)

        using = router.db_for_write(self.model, instance=obj)
        previous = self.model.objects.using(using).select_for_update().only("photo").get(pk=obj.pk)
        old_photo = previous.photo
        if "photo" not in form.changed_data:
            obj.photo = old_photo.name

        super().save_model(request, obj, form, change)
        if old_photo and old_photo.name != obj.photo.name:
            delete_unused_recipe_photo_on_commit(old_photo.storage, old_photo.name, using=using)
