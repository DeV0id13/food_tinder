from django.urls import path

from .views import favorite, favorites, feed, swipes

app_name = "preferences"

urlpatterns = [
    path("feed/", feed, name="feed"),
    path("swipes/", swipes, name="swipes"),
    path("favorites/", favorites, name="favorites"),
    path("favorites/<int:recipe_id>/", favorite, name="favorite"),
]
