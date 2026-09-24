from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from .validators import validate_meal_types, validate_steps


class Ingredient(models.Model):
    class Unit(models.TextChoices):
        GRAM = "g", "g"
        MILLILITER = "ml", "ml"
        PIECE = "pcs", "pcs"

    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=200)
    unit = models.CharField(max_length=3, choices=Unit.choices)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(unit__in=["g", "ml", "pcs"]), name="catalog_ingredient_valid_unit"
            )
        ]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if self.pk and type(self).objects.filter(pk=self.pk).exclude(unit=self.unit).exists():
            if self.recipeingredient_set.exists():
                raise ValidationError({"unit": "Unit cannot change after the ingredient is used."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class Recipe(models.Model):
    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField()
    image_url = models.URLField(blank=True)
    cooking_time_minutes = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    difficulty = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    base_servings = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    meal_types = models.JSONField(validators=[validate_meal_types])
    steps = models.JSONField(validators=[validate_steps])
    is_active = models.BooleanField(default=False)

    kcal_per_serving = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    protein_g_per_serving = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    fat_g_per_serving = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    carbs_g_per_serving = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    estimated_price_rub_per_serving = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(cooking_time_minutes__gt=0), name="catalog_time_gt_0"
            ),
            models.CheckConstraint(
                condition=Q(difficulty__gte=1, difficulty__lte=5), name="catalog_difficulty_1_5"
            ),
            models.CheckConstraint(condition=Q(base_servings__gt=0), name="catalog_servings_gt_0"),
            *[
                models.CheckConstraint(
                    condition=Q(**{f"{field}__gte": 0}) | Q(**{f"{field}__isnull": True}),
                    name=f"catalog_{field}_nonnegative",
                )
                for field in (
                    "kcal_per_serving",
                    "protein_g_per_serving",
                    "fat_g_per_serving",
                    "carbs_g_per_serving",
                    "estimated_price_rub_per_serving",
                )
            ],
        ]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class RecipeIngredient(models.Model):
    recipe = models.ForeignKey(Recipe, on_delete=models.CASCADE, related_name="ingredient_lines")
    ingredient = models.ForeignKey(Ingredient, on_delete=models.PROTECT)
    quantity = models.DecimalField(
        max_digits=12, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))]
    )

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="catalog_quantity_gt_0"),
            models.UniqueConstraint(
                fields=["recipe", "ingredient"], name="catalog_unique_recipe_ingredient"
            ),
        ]

    def __str__(self):
        return f"{self.recipe}: {self.ingredient} ({self.quantity})"

    def clean(self):
        super().clean()
        if self.ingredient_id and isinstance(self.quantity, Decimal):
            if (
                self.ingredient.unit == Ingredient.Unit.PIECE
                and self.quantity != self.quantity.to_integral_value()
            ):
                raise ValidationError({"quantity": "Piece quantities must be whole numbers."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
