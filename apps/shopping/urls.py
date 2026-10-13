from django.urls import path

from .views import shopping_list, shopping_list_export

app_name = "shopping"

urlpatterns = [
    path("", shopping_list, name="shopping-list"),
    path("export/", shopping_list_export, name="shopping-list-export"),
]
