import mimetypes

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from common.views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/health/", health, name="health"),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/recipes/", include("apps.catalog.urls")),
    path("api/v1/preferences/", include("apps.preferences.urls")),
    path("api/v1/meal-plans/", include("apps.planning.urls")),
    path("api/v1/shopping-list/", include("apps.shopping.urls")),
]

if settings.DEBUG:
    # The base Alpine image may not have a WebP MIME mapping.
    mimetypes.add_type("image/webp", ".webp")
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
