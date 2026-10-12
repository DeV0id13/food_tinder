from django.urls import include, path

urlpatterns = [
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/recipes/", include("apps.catalog.urls")),
    path("api/v1/preferences/", include("apps.preferences.urls")),
    path("api/v1/meal-plans/", include("apps.planning.urls")),
    path("api/v1/shopping-list/", include("apps.shopping.urls")),
]
