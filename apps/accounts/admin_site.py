from django.contrib.admin import AdminSite
from django.contrib.auth.decorators import login_not_required
from django.http import HttpRequest, HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect

from .rate_limit import AuthRateLimited, limit_auth_attempt


class FoodTinderAdminSite(AdminSite):
    @method_decorator(never_cache)
    @method_decorator(csrf_protect)
    @login_not_required
    def login(
        self, request: HttpRequest, extra_context: dict[str, object] | None = None
    ) -> HttpResponse:
        if request.method == "POST":
            try:
                limit_auth_attempt(request, "admin_login")
            except AuthRateLimited as error:
                return HttpResponse(
                    f"Слишком много попыток входа. Повторите попытку через {error.wait} сек.",
                    status=429,
                    content_type="text/plain; charset=utf-8",
                    headers={"Retry-After": str(error.wait)},
                )
        return super().login(request, extra_context)
