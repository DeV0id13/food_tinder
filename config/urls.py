import mimetypes

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.decorators.cache import never_cache
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView

from common.api_docs import FoodTinderSwaggerView
from common.monitoring_access import monitoring_access
from common.views import health, ready

urlpatterns = [
    path("admin/", admin.site.urls),
    path("_monitoring_auth/grafana/", monitoring_access, {"destination": "/grafana/"}),
    path("_monitoring_auth/prometheus/", monitoring_access, {"destination": "/prometheus/"}),
    path("api/v1/health/", health, name="health"),
    path("api/v1/ready/", ready, name="ready"),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/recipes/", include("apps.catalog.urls")),
    path("api/v1/preferences/", include("apps.preferences.urls")),
    path("api/v1/meal-plans/", include("apps.planning.urls")),
    path("api/v1/shopping-list/", include("apps.shopping.urls")),
]

if settings.API_DOCS_ENABLED:
    urlpatterns += [
        path("api/schema/", never_cache(SpectacularAPIView.as_view()), name="schema"),
        path("api/docs/", never_cache(FoodTinderSwaggerView.as_view()), name="swagger-ui"),
        path("api/redoc/", never_cache(SpectacularRedocView.as_view()), name="redoc"),
    ]

if settings.DEBUG:
    # The base Alpine image may not have a WebP MIME mapping.
    mimetypes.add_type("image/webp", ".webp")
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
