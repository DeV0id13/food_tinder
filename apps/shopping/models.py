from django.db import models


class PurchasedIngredient(models.Model):
    plan = models.ForeignKey(
        "planning.MealPlan", on_delete=models.CASCADE, related_name="purchased_ingredients"
    )
    ingredient = models.ForeignKey("catalog.Ingredient", on_delete=models.CASCADE)
    quantity_version = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("plan", "ingredient"), name="shopping_unique_purchased_ingredient"
            ),
        ]
