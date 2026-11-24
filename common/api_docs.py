from django.conf import settings
from drf_spectacular.utils import extend_schema
from drf_spectacular.views import SpectacularSwaggerView
from rest_framework.request import Request
from rest_framework.response import Response


class FoodTinderSwaggerView(SpectacularSwaggerView):
    template_name_js = "api/swagger.js"

    @extend_schema(exclude=True)
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        response = super().get(request, *args, **kwargs)
        response.data["csrf_cookie_name"] = settings.CSRF_COOKIE_NAME
        return response
