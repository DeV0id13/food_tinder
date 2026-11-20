from django.urls import path

from .views import favorite, favorites, feed, swipes, undo_swipe

app_name = "preferences"

urlpatterns = [
    path("feed/", feed, name="feed"),
    path("swipes/", swipes, name="swipes"),
    path("swipes/undo/", undo_swipe, name="undo-swipe"),
    path("favorites/", favorites, name="favorites"),
    path("favorites/<int:recipe_id>/", favorite, name="favorite"),
]
