from rest_framework.exceptions import NotFound

from .models import MealPlan


def get_plan_for_user(*, user, plan_id: int) -> MealPlan:
    """Return the plan only when it belongs to ``user``; otherwise raise 404."""
    try:
        return MealPlan.objects.prefetch_related("slots__recipe").get(pk=plan_id, user=user)
    except MealPlan.DoesNotExist as exc:
        raise NotFound from exc
