"""Internal Caddy authorization subrequests for monitoring interfaces."""

from django.http import HttpRequest, HttpResponse, HttpResponseForbidden, HttpResponseRedirect
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


@never_cache
@require_safe
def monitoring_access(request: HttpRequest, destination: str) -> HttpResponse:
    # destination is a fixed URLconf argument, never a browser-provided redirect.
    user = request.user
    if not user.is_authenticated:
        return HttpResponseRedirect(f"{reverse('admin:login')}?next={destination}")
    if not user.is_active or not user.is_staff:
        return HttpResponseForbidden("Staff access required.")
    return HttpResponse(
        status=204,
        headers={"X-FoodTinder-Monitoring-User": f"foodtinder-staff-{user.pk}"},
    )
