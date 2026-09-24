from django.urls import path

from .views import RecipeDetailView, RecipeListView

urlpatterns = [
    path("", RecipeListView.as_view(), name="recipe-list"),
    path("<int:recipe_id>/", RecipeDetailView.as_view(), name="recipe-detail"),
]
