from django.urls import path

from .views import clear_purchases, purchase, shopping_list, shopping_list_export

app_name = "shopping"

urlpatterns = [
    path("", shopping_list, name="shopping-list"),
    path("export/", shopping_list_export, name="shopping-list-export"),
    path("<int:plan_id>/purchases/", clear_purchases, name="clear-purchases"),
    path("<int:plan_id>/purchases/<int:ingredient_id>/", purchase, name="purchase"),
]
